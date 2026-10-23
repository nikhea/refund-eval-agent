import { Mastra } from "@mastra/core/mastra";
import { SpanType } from "@mastra/core/observability";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from "@mastra/core/storage";
import {
  ConsoleExporter,
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SamplingStrategyType,
  SensitiveDataFilter,
} from "@mastra/observability";
import { weatherWorkflow } from "./workflows/weather-workflow";
import { weatherAgent } from "./agents/weather-agent";
import {
  toolCallAppropriatenessScorer,
  completenessScorer,
  translationScorer,
} from "./scorers/weather-scorer";
import { refundAgent } from "./agents/refund-agent";

type AppLogLevel = "debug" | "info" | "warn" | "error";
type ObservabilityLogLevel = AppLogLevel | "fatal";

const isProduction = process.env.NODE_ENV === "production";

function isAppLogLevel(value: string | undefined): value is AppLogLevel {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  );
}

function resolveLogLevel(): AppLogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (isAppLogLevel(configured)) {
    return configured;
  }
  return isProduction ? "info" : "debug";
}

const logLevel = resolveLogLevel();

/**
 * Observability log forwarding has its own level so production can keep
 * stdout quiet while still storing debug stage logs, or the other way around.
 * Defaults to the console level.
 */
function resolveObservabilityLogLevel(): ObservabilityLogLevel {
  const configured = process.env.OBSERVABILITY_LOG_LEVEL?.toLowerCase();
  if (isAppLogLevel(configured) || configured === "fatal") {
    return configured;
  }
  return logLevel;
}

const observabilityLogLevel = resolveObservabilityLogLevel();

/**
 * Exporters log their own batching/retry failures. `info` in development
 * surfaces dropped batches and retries early; production stays on `warn`.
 */
function resolveExporterLogLevel(): AppLogLevel {
  const configured =
    process.env.OBSERVABILITY_EXPORTER_LOG_LEVEL?.toLowerCase();
  if (isAppLogLevel(configured)) {
    return configured;
  }
  return isProduction ? "warn" : "info";
}

const exporterLogLevel = resolveExporterLogLevel();

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

type ResolvedSampling =
  | { type: SamplingStrategyType.ALWAYS }
  | { type: SamplingStrategyType.RATIO; probability: number };

/**
 * `OBSERVABILITY_SAMPLE_RATIO=0.25` traces 25% of runs. Invalid values fall
 * back to tracing everything instead of failing at boot.
 */
function resolveSampling(): {
  sampling: ResolvedSampling;
  invalidRatio?: string;
} {
  const raw = process.env.OBSERVABILITY_SAMPLE_RATIO;
  if (raw === undefined || raw.trim() === "") {
    return { sampling: { type: SamplingStrategyType.ALWAYS } };
  }

  const probability = Number(raw);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    return {
      sampling: { type: SamplingStrategyType.ALWAYS },
      invalidRatio: raw,
    };
  }

  return { sampling: { type: SamplingStrategyType.RATIO, probability } };
}

const { sampling, invalidRatio } = resolveSampling();

/** RequestContext keys copied onto spans, e.g. `tenantId,userId`. */
function resolveRequestContextKeys(): string[] {
  return (process.env.OBSERVABILITY_REQUEST_CONTEXT_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

const requestContextKeys = resolveRequestContextKeys();
const includeInternalSpans = envFlag("OBSERVABILITY_INTERNAL_SPANS", false);
const exportLogs = envFlag("OBSERVABILITY_LOGS", true);
// Off by default: ConsoleExporter prints every span start/end, which is noisy.
const consoleSpans = envFlag("OBSERVABILITY_CONSOLE_SPANS", false);

/**
 * One logger for the whole app:
 * - stdout transport (pretty in dev, JSON in production)
 * - automatic export to observability storage, correlated with trace_id/span_id
 * - redaction of secrets so credentials never reach stdout or storage
 */
const logger = new PinoLogger({
  name: "refund-agent",
  level: logLevel,
  prettyPrint: !isProduction,
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "apiKey",
      "*.apiKey",
      "authorization",
      "*.authorization",
      "secret",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
  mixin() {
    return {
      service: "refund-agent",
      env: process.env.NODE_ENV ?? "development",
    };
  },
});

const observability = new Observability({
  configs: {
    default: {
      serviceName: "refund-agent",
      sampling,
      exporters: [
        // Persists traces, logs, metrics, scores and feedback to Mastra Storage.
        new MastraStorageExporter({
          logger,
          logLevel: exporterLogLevel,
          maxBatchSize: 100,
          maxBatchWaitMs: 2_000,
          maxRetries: 3,
        }),
        // Ships the same signals to Mastra Platform (disabled without a token).
        new MastraPlatformExporter({ logger, logLevel: exporterLogLevel }),
        // Debug aid: prints every exported span to the console.
        ...(consoleSpans
          ? [new ConsoleExporter({ logger, logLevel: exporterLogLevel })]
          : []),
      ],
      spanOutputProcessors: [
        new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
      ],
      // Log forwarding is independent from the console transport: in dev the
      // console and storage both keep debug stage logs; in production only
      // info+ reaches storage unless OBSERVABILITY_LOG_LEVEL says otherwise.
      logging: {
        enabled: exportLogs,
        level: observabilityLogLevel,
      },
      // Keep traces focused on agents/workflows/tools instead of streaming noise.
      includeInternalSpans,
      excludeSpanTypes: [SpanType.MODEL_CHUNK],
      requestContextKeys,
    },
  },
});

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent, refundAgent },
  scorers: {
    toolCallAppropriatenessScorer,
    completenessScorer,
    translationScorer,
  },
  storage: new MastraCompositeStore({
    id: "composite-storage",
    default: new LibSQLStore({
      id: "mastra-storage",
      url: "file:./mastra.db",
    }),
    domains: {
      observability: await new DuckDBStore().getStore("observability"),
    },
  }),
  logger,
  loggerOptions: {
    // Inject trace_id/span_id into stdout lines emitted inside agent runs,
    // workflow steps and tool calls so a log line can be matched to its trace.
    correlation: true,
    // Forward the same records to observability storage and exporters.
    export: exportLogs,
  },
  observability,
});

// One structured record describing how observability is wired, so a missing
// exporter, sampler or log level is obvious from the first lines of any log.
logger.info("observability configured", {
  service: "refund-agent",
  consoleLogLevel: logLevel,
  observabilityLogLevel,
  exporterLogLevel,
  logExportEnabled: exportLogs,
  sampling:
    "probability" in sampling
      ? `ratio:${sampling.probability}`
      : sampling.type,
  exporters: [
    "mastra-storage",
    "mastra-platform",
    ...(consoleSpans ? ["console"] : []),
  ],
  includeInternalSpans,
  excludedSpanTypes: [SpanType.MODEL_CHUNK],
  requestContextKeys,
  ...(invalidRatio ? { invalidSampleRatio: invalidRatio } : {}),
});

export { logger };
