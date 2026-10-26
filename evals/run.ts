#!/usr/bin/env bun
/**
 * Refund agent eval runner.
 *
 * Runs the real `refundAgent` through `runEvals` one case at a time, so a case
 * that fails or hangs cannot take the suite down with it. Deterministic scorers
 * decide pass/fail; LLM judges are advisory and never fail a run.
 *
 * Usage:
 *   bun run evals                    # smoke (6 cases), no judges
 *   bun run evals:full               # every case, judges included
 *   bun run evals -- --group safety --no-judges
 *   bun run evals -- --dry-run
 */
import { runEvals } from "@mastra/core/evals";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

import {
  refundDeterministicScorers,
} from "../src/mastra/scorers/refund-scorers";
import { refundEvalJudges } from "../src/mastra/scorers/refund-judges";
import { refundEvalGates, refundEvalChecks } from "../src/mastra/scorers/refund-checks";
import {
  assistantText,
  extractScorerToolInvocations,
  toolNames,
} from "../src/mastra/lib/scorer-trace";
import { refundEvalCases, smokeCases } from "./cases/refund-cases";
import { createEvalTarget } from "./lib/approval";
import {
  buildExpectation,
  deriveCaseFacts,
  type RefundEvalCase,
  type RefundEvalGroup,
} from "./lib/expectations";
import { preflight, printCaseTable, reportIssues } from "./lib/preflight";
import {
  captureOrderState,
  restoreState,
  snapshotState,
  verifyWriteMutation,
  type OrderState,
} from "./lib/state";
import {
  createPainter,
  printCaseLine,
  printSummary,
  toJsonSummary,
  writeArtifact,
  type CaseOutcome,
  type CaseStatus,
  type ScorerReport,
  type SuiteSummary,
} from "./lib/report";

const DEFAULT_TIMEOUT_MS = 180_000;
const MULTI_TURN_TIMEOUT_FACTOR = 5 / 3;

type Options = {
  full: boolean;
  groups: RefundEvalGroup[];
  caseIds: string[];
  judges: boolean;
  judgesExplicit: boolean;
  persist: boolean;
  json: boolean;
  expectModel?: string;
  timeoutMs: number;
  resetDb: boolean;
  dryRun: boolean;
  debug: boolean;
  color: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    full: false,
    groups: [],
    caseIds: [],
    judges: false,
    judgesExplicit: false,
    persist: true,
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    resetDb: false,
    dryRun: false,
    debug: false,
    color: process.stdout.isTTY === true,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case "--full":
        options.full = true;
        break;
      case "--smoke":
        options.full = false;
        break;
      case "--group":
        options.groups.push(...(next().split(",") as RefundEvalGroup[]));
        break;
      case "--case":
        options.caseIds.push(...next().split(","));
        break;
      case "--judges":
        options.judges = true;
        options.judgesExplicit = true;
        break;
      case "--no-judges":
        options.judges = false;
        options.judgesExplicit = true;
        break;
      case "--no-persist":
        options.persist = false;
        break;
      case "--json":
        options.json = true;
        break;
      case "--expect-model":
        options.expectModel = next();
        break;
      case "--timeout":
        options.timeoutMs = Number(next());
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
          throw new Error("--timeout must be a positive number of milliseconds");
        break;
      case "--reset-db":
        options.resetDb = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--debug":
        options.debug = true;
        break;
      case "--no-color":
        options.color = false;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--":
        // `bun run evals -- --flag` forwards the separator; ignore it.
        break;
      default:
        throw new Error(`unknown flag "${arg}" (try --help)`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Refund agent evals

  --smoke            run the smoke subset (default)
  --full             run every case, judges on unless --no-judges
  --group <names>    comma-separated groups: eligibility, amounts, write,
                     safety, multi-turn, policy
  --case <ids>       comma-separated case ids
  --judges           run the advisory LLM judges
  --no-judges        skip the judges (default for smoke)
  --no-persist       do not write scores to evals.db
  --json             print a JSON summary instead of the table
  --expect-model <m> fail as model-drift when a fallback model answers
  --timeout <ms>     per-case timeout (multi-turn gets 1.67x), default 180000
  --reset-db         delete evals.db and evals.duckdb before starting
  --dry-run          validate the dataset and print the case table, no model
  --debug            print the agent's full reply for each case
  --no-color         disable ANSI colour
`);
}

const EVAL_DB_URL = "file:./evals.db";
const EVAL_DUCKDB_PATH = "evals.duckdb";

/** Must run before `src/mastra/index.ts` is imported: it reads these at load. */
function applyEvalEnv(options: Options): void {
  process.env.MASTRA_DB_URL ??= EVAL_DB_URL;
  process.env.MASTRA_DUCKDB_PATH ??= EVAL_DUCKDB_PATH;
  if (options.json) {
    // JSON on stdout has to be the only thing on stdout.
    process.env.LOG_LEVEL = "silent";
  } else {
    process.env.LOG_LEVEL ??= options.debug ? "debug" : "warn";
  }
}

function resetEvalDatabases(): void {
  const targets = [
    "evals.db",
    "evals.db-wal",
    "evals.db-shm",
    "evals.duckdb",
    "evals.duckdb.wal",
  ];
  for (const target of targets) rmSync(resolve(process.cwd(), target), { force: true });
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`case exceeded its ${Math.round(ms / 1000)}s timeout`);
    this.name = "TimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const INCONCLUSIVE_PATTERNS = [
  /token cost limit exceeded/i,
  /rate limit|429|too many requests/i,
  /econnreset|econnrefused|etimedout|fetch failed|socket hang up/i,
  /overloaded|service unavailable|502|503|504/i,
  /no output|empty (response|output)/i,
  /api key|unauthorized|401|403/i,
];

const GUARDRAIL_PATTERNS = [
  /tripwire/i,
  /regex[- ]filter/i,
  /blocked by (an? )?(input )?(processor|guardrail|filter)/i,
  /content (was )?blocked/i,
];

function errorChainMessage(error: unknown): string {
  const parts: string[] = [];
  let current: any = error;
  for (let depth = 0; current && depth < 6; depth++) {
    parts.push(String(current.message ?? current));
    current = current.cause;
  }
  return parts.join(" | ");
}

function looksLikeGuardrail(error: unknown): boolean {
  const message = errorChainMessage(error);
  return GUARDRAIL_PATTERNS.some((pattern) => pattern.test(message));
}

function looksInconclusive(error: unknown): boolean {
  const message = errorChainMessage(error);
  return INCONCLUSIVE_PATTERNS.some((pattern) => pattern.test(message));
}

function modelMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const normalize = (value: string) => value.toLowerCase().trim();
  const want = normalize(expected);
  const got = normalize(actual);
  return (
    want === got ||
    want.endsWith(`/${got}`) ||
    got.endsWith(`/${want}`) ||
    want.split("/").pop() === got
  );
}

function toScorerReports(
  scorerResults: Record<string, any> | undefined,
): ScorerReport[] {
  if (!scorerResults) return [];
  return Object.entries(scorerResults).map(([id, result]) => {
    if (result?.notScorable) {
      return { id, notScorable: true, reason: String(result.reason ?? "") };
    }
    return {
      id,
      score: typeof result?.score === "number" ? result.score : undefined,
      reason: typeof result?.reason === "string" ? result.reason : undefined,
      passed: typeof result?.score === "number" ? result.score >= 1 : false,
    };
  });
}

type AttemptInput = {
  testCase: RefundEvalCase;
  expectation: ReturnType<typeof buildExpectation>;
  target: ReturnType<typeof createEvalTarget>;
  scorers: any[];
  timeoutMs: number;
  before?: OrderState;
};

type AttemptResult = {
  outcome: CaseOutcome;
  timedOut: boolean;
};

async function runAttempt(input: AttemptInput): Promise<AttemptResult> {
  const { testCase, expectation, target, scorers, timeoutMs, before } = input;
  const startedAt = performance.now();
  const captured: {
    targetResult?: any;
    scorerResults?: Record<string, any>;
  } = {};

  const dataItem = testCase.turns?.length
    ? {
        turns: testCase.turns.map((turn) => ({
          input: turn.input,
          // Per-turn gates: a tool that throws in turn 1 fails turn 1 instead of
          // being averaged into the whole conversation.
          gates: [refundEvalChecks.noToolErrors],
        })),
        groundTruth: expectation,
      }
    : { input: testCase.input, groundTruth: expectation };

  const base = {
    id: testCase.id,
    group: testCase.group,
    description: testCase.description,
    attempts: 1,
    durationMs: 0,
    tools: [] as string[],
    approvals: [],
    scorers: [] as ScorerReport[],
    gates: [],
    notes: [] as string[],
  };

  let timedOut = false;

  try {
    const evalResult = await withTimeout(
      runEvals({
        data: [dataItem as any],
        target,
        scorers,
        gates: refundEvalGates,
        concurrency: 1,
        onItemComplete: ({ targetResult, scorerResults }) => {
          captured.targetResult = targetResult;
          captured.scorerResults = scorerResults as Record<string, any>;
        },
      }),
      timeoutMs,
    );

    const targetResult = captured.targetResult;
    const output = targetResult?.scoringData?.output;
    const text = assistantText(output);
    const tools = toolNames(output);
    const scorersReport = toScorerReports(captured.scorerResults);
    const gates = evalResult.gateResults ?? [];
    const durationMs = Math.round(performance.now() - startedAt);

    const outcome: CaseOutcome = {
      ...base,
      durationMs,
      status: "passed",
      modelId: targetResult?.evalModelId,
      finishReason: targetResult?.finishReason,
      reply: text,
      tools,
      approvals: targetResult?.evalApprovals ?? [],
      scorers: scorersReport,
      gates,
    };

    if (!targetResult) {
      outcome.status = "inconclusive";
      outcome.notes.push("runEvals returned without a target result");
      return { outcome, timedOut };
    }

    if (/token cost limit exceeded/i.test(text)) {
      outcome.status = "inconclusive";
      outcome.notes.push("TokenCostControl blocked the run");
      return { outcome, timedOut };
    }

    if (text.trim() === "" && tools.length === 0) {
      outcome.status = "inconclusive";
      outcome.notes.push("the agent produced no text and called no tools");
      return { outcome, timedOut };
    }

    if (targetResult.finishReason === "error") {
      outcome.status = "inconclusive";
      outcome.notes.push("the model finished with finishReason=error");
      return { outcome, timedOut };
    }

    if (targetResult.finishReason === "length") {
      outcome.status = "failed";
      outcome.notes.push("the reply was truncated (finishReason=length)");
      return { outcome, timedOut };
    }

    if (evalResult.verdict !== "passed") {
      outcome.status = "failed";
      const failing = (evalResult.thresholdResults ?? [])
        .filter((result) => !result.passed)
        .map((result) => `${result.id}=${result.averageScore.toFixed(2)}`);
      const failingGates = gates
        .filter((gate) => !gate.passed)
        .map((gate) => `gate:${gate.id}=${gate.score.toFixed(2)}`);
      outcome.notes.push(
        `verdict=${evalResult.verdict ?? "none"}${
          [...failing, ...failingGates].length
            ? ` (${[...failing, ...failingGates].join(", ")})`
            : ""
        }`,
      );
      return { outcome, timedOut };
    }

    if (testCase.expectWrite) {
      const verification = verifyWriteMutation(
        testCase.orderId,
        before,
        targetResult?.scoringData?.output
          ? extractScorerToolInvocations(targetResult.scoringData.output)
          : [],
      );
      outcome.writeVerification = verification;
      if (!verification.ok) {
        outcome.status = "failed";
        outcome.notes.push("the write did not land in the order state");
        return { outcome, timedOut };
      }
    }

    return { outcome, timedOut };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);

    if (error instanceof TimeoutError) {
      timedOut = true;
      return {
        timedOut,
        outcome: {
          ...base,
          durationMs,
          status: "inconclusive",
          notes: [error.message],
        },
      };
    }

    if (testCase.acceptGuardrailBlock && looksLikeGuardrail(error)) {
      return {
        timedOut,
        outcome: {
          ...base,
          durationMs,
          status: "passed",
          blockedByGuardrail: true,
          notes: ["the input guardrail blocked the message before the model saw it"],
        },
      };
    }

    if (looksInconclusive(error)) {
      return {
        timedOut,
        outcome: {
          ...base,
          durationMs,
          status: "inconclusive",
          notes: [errorChainMessage(error).slice(0, 300)],
        },
      };
    }

    return {
      timedOut,
      outcome: {
        ...base,
        durationMs,
        status: "failed",
        notes: ["the harness threw while running this case"],
        error: {
          message: (error as Error)?.message ?? String(error),
          stack: (error as Error)?.stack,
        },
      },
    };
  }
}


async function runCase(
  testCase: RefundEvalCase,
  options: Options,
  target: ReturnType<typeof createEvalTarget>,
  scorers: any[],
): Promise<CaseOutcome> {
  const facts = deriveCaseFacts(testCase);
  const expectation = buildExpectation(testCase, facts);
  const timeoutMs =
    testCase.turns?.length && testCase.turns.length > 1
      ? Math.round(options.timeoutMs * MULTI_TURN_TIMEOUT_FACTOR)
      : options.timeoutMs;

  let attempts = 0;
  let outcome: CaseOutcome | undefined;

  while (attempts < 2) {
    attempts++;
    const snapshot = snapshotState();
    const before = testCase.orderId
      ? captureOrderState(testCase.orderId)
      : undefined;

    try {
      const result = await runAttempt({
        testCase,
        expectation,
        target,
        scorers,
        timeoutMs,
        before,
      });
      outcome = { ...result.outcome, attempts };

      // A timeout already burned the full budget; retrying it only doubles the wait.
      if (outcome.status !== "inconclusive" || result.timedOut) break;
      if (attempts >= 2) break;
    } finally {
      restoreState(snapshot);
    }
  }

  const finalOutcome = outcome ?? {
    id: testCase.id,
    group: testCase.group,
    description: testCase.description,
    status: "failed" as CaseStatus,
    attempts,
    durationMs: 0,
    tools: [],
    approvals: [],
    scorers: [],
    gates: [],
    notes: ["the case produced no outcome"],
  };

  if (
    options.expectModel &&
    finalOutcome.status !== "inconclusive" &&
    finalOutcome.modelId &&
    !modelMatches(options.expectModel, finalOutcome.modelId)
  ) {
    return {
      ...finalOutcome,
      status: "model-drift",
      notes: [
        ...finalOutcome.notes,
        `expected model "${options.expectModel}" but "${finalOutcome.modelId}" answered`,
      ],
    };
  }

  return finalOutcome;
}

function selectCases(options: Options): RefundEvalCase[] {
  let cases = options.full ? [...refundEvalCases] : [...smokeCases];

  if (options.groups.length) {
    cases = cases.filter((testCase) => options.groups.includes(testCase.group));
  }
  if (options.caseIds.length) {
    cases = cases.filter((testCase) => options.caseIds.includes(testCase.id));
  }

  return cases;
}

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }

  if (options.help) {
    printHelp();
    return 0;
  }

  if (options.resetDb) resetEvalDatabases();
  applyEvalEnv(options);

  const cases = selectCases(options);
  if (!cases.length) {
    console.error("No cases matched the filters.");
    return 2;
  }

  const preflightResult = preflight(cases);
  if (preflightResult.issues.length) {
    reportIssues(preflightResult.issues);
    return 2;
  }

  if (options.dryRun) {
    printCaseTable(preflightResult);
    console.log("\nDataset is valid. No model calls were made.");
    return 0;
  }

  const paint = createPainter(options.color);
  const startedAt = new Date().toISOString();
  const startedMs = performance.now();

  const { mastra } = await import("../src/mastra/index");
  const agent = mastra.getAgent("refundAgent");
  const target = createEvalTarget(agent, { persist: options.persist });

  const useJudges = options.judgesExplicit ? options.judges : options.full;
  const scorers = [
    ...refundDeterministicScorers.map((scorer) => ({
      scorer,
      threshold: 1,
    })),
    ...(useJudges
      ? [refundEvalJudges.policyCommunication, refundEvalJudges.conversationJudge]
      : []),
  ];

  if (!options.json) {
    console.log(
      `Refund agent evals — ${options.full ? "full" : "smoke"} suite, ${
        cases.length
      } case(s)${useJudges ? ", judges on" : ", judges off"}`,
    );
    console.log(
      `scorers: ${refundDeterministicScorers.length} deterministic${
        useJudges ? " + 2 advisory judges" : ""
      }`,
    );
  }

  const outcomes: CaseOutcome[] = [];

  try {
    for (const [index, testCase] of cases.entries()) {
      const outcome = await runCase(testCase, options, target, scorers);
      outcomes.push(outcome);
      if (!options.json) printCaseLine(outcome, index + 1, cases.length, paint);
      if (!options.json && options.debug && outcome.reply) {
        console.log(paint("\n  --- reply ---", "cyan"));
        console.log(
          outcome.reply
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n"),
        );
      }
    }
  } finally {
    // Give in-flight workflow cleanup a moment so shutdown does not race it.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    await mastra.shutdown().catch(() => undefined);
  }

  const summary: SuiteSummary = {
    startedAt,
    durationMs: Math.round(performance.now() - startedMs),
    modelId: outcomes.find((outcome) => outcome.modelId)?.modelId,
    outcomes,
    filtered: {
      group: options.groups.join(",") || undefined,
      cases: options.caseIds.length ? options.caseIds : undefined,
    },
  };

  if (options.json) {
    console.log(JSON.stringify(toJsonSummary(summary), null, 2));
  } else {
    printSummary(summary, paint);
  }

  const artifact = writeArtifact(summary, resolve(process.cwd(), "evals/results"));
  if (!options.json) console.log(`\nartifact: ${artifact}`);

  const failed = outcomes.filter(
    (outcome) => outcome.status === "failed" || outcome.status === "model-drift",
  ).length;
  const inconclusive = outcomes.filter(
    (outcome) => outcome.status === "inconclusive",
  ).length;

  if (failed > 0) return 1;
  if (inconclusive > 0) {
    console.log(
      paint(
        `\n${inconclusive} case(s) were inconclusive: the suite measured nothing for them, but nothing failed.`,
        "yellow",
      ),
    );
  }
  return 0;
}

const exitCode = await main();
process.exit(exitCode);
