import { Agent, ModelWithRetries } from "@mastra/core/agent";
import { refundTools } from "../tools/refund-tools";
import { refundAgentMemory } from "../memory/refundAgent.memory";
import { refundAgentMemoryInstructions } from "../instructions/refundAgent.instructions";
import {
  BatchPartsProcessor,
  TokenCostControl,
  RegexFilterProcessor,
  RegexRule,
  StreamErrorRetryProcessor,
  TokenLimiter,
  UnicodeNormalizer,
  PrefillErrorHandler,
  ProviderHistoryCompat,
} from "@mastra/core/processors";
import { EnsureFinalResponseProcessor } from "../processor/ensure-final-response";
import { DateInjectorProcessor } from "../processor/DateInjectorProcessor";
import { askUserTool } from "@mastra/core/tools";
import { weatherAgent } from "./weather-agent";
import { weatherSignalTool } from "../tools/sendWeatherSignal-tools";

const MAX_STEPS = 10;

const rules: RegexRule[] | undefined = [
  {
    name: "env-style-secrets",
    pattern:
      /[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|URL)[A-Z0-9_]*\s*=\s*\S+/gi,
  },
  // {
  //   name: "sql-query",
  //   pattern:
  //     /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|UNION)\b[\s\S]*/gi,
  //   replacement: "[SQL_REDACTED]",
  // },
  // 1. Classic tautology-based injection
  {
    name: "sql-tautology",
    pattern: /('|\")\s*(or|and)\s+('|\")?\s*\d+\s*=\s*\d+/gi,
  },

  // 2. Always-true conditions (admin bypass style)
  {
    name: "sql-always-true-condition",
    pattern: /(\bor\b|\band\b)\s+(\d+\s*=\s*\d+|'[^']*'\s*=\s*'[^']*')/gi,
  },

  // 3. Comment injection attempts
  // {
  //   name: "sql-comment-bypass",
  //   pattern: /(--|#|\/\*)/g,
  // },

  // 4. UNION-based injection (data extraction attempts)
  {
    name: "sql-union-injection",
    pattern: /\bunion\b\s+(all\s+)?\bselect\b/gi,
  },

  // 5. Stacked queries (multiple statements)
  {
    name: "sql-stacked-queries",
    pattern: /;\s*(select|insert|update|delete|drop|alter)\b/gi,
  },

  // 6. Dangerous schema operations
  {
    name: "sql-destructive-commands",
    pattern: /\b(drop|truncate|alter|create)\b\s+(table|database|schema)/gi,
  },

  // 7. Time-based blind injection hints
  {
    name: "sql-time-based-injection",
    pattern: /\b(sleep|benchmark|pg_sleep)\s*\(/gi,
  },
  {
    name: "sql-encoded-attack",
    pattern: /(%27|%22|%3D|%2D%2D)/gi,
  },
  {
    name: "sql-in-url-params",
    pattern:
      /(\?|&)(id|user|query|search)=.*(select|union|drop|insert|delete)/gi,
  },
  {
    name: "openai-api-key",
    pattern: /[A-Z_]*API_KEY\s*=\s*[a-zA-Z0-9_\-]+/g,
    replacement: "[REDACTED_API_KEY]",
  },
];

const models: ModelWithRetries[] = [
  {
    model: "ollama-cloud/gpt-oss:120b",
    maxRetries: 3,
  },
  {
    model: "openrouter/deepseek/deepseek-v4-flash:free",
    maxRetries: 3,
  },
  {
    model: "openrouter/deepseek/deepseek-v4-flash:free",
    maxRetries: 3,
  },
  {
    model: "nvidia/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    maxRetries: 1,
  },
  {
    model: "ollama-cloud/minimax-m2.5",
    maxRetries: 2,
  },

  {
    model: "groq/openai/gpt-oss-120b",
    maxRetries: 2,
    modelSettings: {
      timeout: {
        totalMs: 30000, // fail the run if it takes longer than 30s
        stepMs: 10000, // fail an individual model call after 10s
        firstChunkMs: 3000, // fail if no content chunk within 3s
      },
    },
  },
  {
    model: "google/gemini-2.5-pro",
    maxRetries: 2,
  },
];
export const refundAgent = new Agent({
  id: "refund-agent",
  name: "Refund Agent",
  // description:
  // "Handles order lookups, refund eligibility, refund calculation and return processing.",
  model: models,
  tools: {
    // ...refundTools,
    weatherSignalTool,
    // askUserTool
  },
  // agents: { weatherAgent },

  memory: refundAgentMemory,
  instructions: "you are a helpful assistance",
  // ?? refundAgentMemoryInstructions,
  inputProcessors: [
    new UnicodeNormalizer({
      stripControlChars: true,
      collapseWhitespace: true,
    }),
    new TokenLimiter(127000),
    new RegexFilterProcessor({
      presets: [
        // "pii",
        "secrets",
        "urls",
      ],
      strategy: "block",
      phase: "input",
      rules,
    }),
    new TokenCostControl({
      maxCost: 0.005,
      scope: "thread",
      window: "24h",
      strategy: "block",
      includeBreakdown: true,
      warnAtPercent: 80,
      message: "Token cost limit exceeded. Please try again later.",
    }),
    new EnsureFinalResponseProcessor(MAX_STEPS),
    // new DateInjectorProcessor(),
  ],
  outputProcessors: [
    new BatchPartsProcessor({
      batchSize: 10,
      maxWaitTime: 100,
      emitOnNonText: true,
    }),
  ],
  errorProcessors: [
    new StreamErrorRetryProcessor(),
    new PrefillErrorHandler(),
    new ProviderHistoryCompat(),
  ],
  errorProcessorDefaults: false,
  maxProcessorRetries: 5,
  defaultOptions: {
    maxSteps: MAX_STEPS,
    autoResumeSuspendedTools: true,
  },
  // Paths resolve against process.cwd() (LocalSkillSource basePath), not this file.
  skills: ["../skills/refund-policy-guide"],
});
