import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ApprovalRecord } from "./approval";
import type { WriteVerification } from "./state";

export type CaseStatus = "passed" | "failed" | "inconclusive" | "model-drift";

export type ScorerReport = {
  id: string;
  score?: number;
  passed?: boolean;
  reason?: string;
  notScorable?: boolean;
};

export type CaseOutcome = {
  id: string;
  group: string;
  description: string;
  status: CaseStatus;
  attempts: number;
  durationMs: number;
  modelId?: string;
  finishReason?: string;
  reply?: string;
  tools: string[];
  approvals: ApprovalRecord[];
  scorers: ScorerReport[];
  gates: { id: string; passed: boolean; score: number }[];
  notes: string[];
  error?: { message: string; stack?: string };
  writeVerification?: WriteVerification;
  blockedByGuardrail?: boolean;
};

export type SuiteSummary = {
  startedAt: string;
  durationMs: number;
  modelId?: string;
  outcomes: CaseOutcome[];
  filtered: { group?: string; cases?: string[] };
};

const COLORS = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
};

export function createPainter(enabled: boolean) {
  return (text: string, color: keyof typeof COLORS) =>
    enabled ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  passed: "PASS",
  failed: "FAIL",
  inconclusive: "INCONCLUSIVE",
  "model-drift": "MODEL DRIFT",
};

export function printCaseLine(
  outcome: CaseOutcome,
  index: number,
  total: number,
  paint: ReturnType<typeof createPainter>,
): void {
  const color =
    outcome.status === "passed"
      ? "green"
      : outcome.status === "inconclusive"
        ? "yellow"
        : "red";
  const seconds = (outcome.durationMs / 1000).toFixed(1);
  const attemptNote = outcome.attempts > 1 ? ` (${outcome.attempts} attempts)` : "";

  console.log(
    `\n[${index}/${total}] ${outcome.id} ${paint(
      `(${outcome.group})`,
      "dim",
    )} ${paint(STATUS_LABEL[outcome.status], color)} ${paint(
      `${seconds}s${attemptNote}`,
      "dim",
    )}`,
  );
  console.log(paint(`  ${outcome.description}`, "dim"));

  if (outcome.modelId) console.log(`  model: ${outcome.modelId}`);
  if (outcome.tools.length)
    console.log(`  tools: ${outcome.tools.join(" -> ")}`);
  if (outcome.approvals.length)
    console.log(
      `  approvals: ${outcome.approvals
        .map((approval) => approval.toolName)
        .join(", ")}`,
    );

  if (outcome.blockedByGuardrail) {
    console.log(paint("  blocked by input guardrail (pass)", "yellow"));
  }

  if (outcome.writeVerification) {
    const verification = outcome.writeVerification;
    console.log(
      `  write: ${verification.ok ? "verified" : "not verified"}${
        verification.rmaNumber ? ` (${verification.rmaNumber})` : ""
      }`,
    );
    for (const problem of verification.problems)
      console.log(paint(`    ✗ ${problem}`, "red"));
  }

  for (const scorer of outcome.scorers) {
    if (scorer.notScorable) continue;
    const ok = scorer.passed ?? (scorer.score ?? 0) >= 1;
    const mark = ok ? "✓" : "✗";
    const score = scorer.score === undefined ? "" : ` ${scorer.score.toFixed(2)}`;
    console.log(
      `  ${paint(mark, ok ? "green" : "red")} ${scorer.id}${score}`,
    );
    if (!ok && scorer.reason) console.log(paint(`      ${scorer.reason}`, "dim"));
  }

  for (const note of outcome.notes) console.log(paint(`  ! ${note}`, "yellow"));

  if (outcome.error) {
    console.log(paint(`  error: ${outcome.error.message}`, "red"));
    if (outcome.error.stack)
      console.log(paint(outcome.error.stack.split("\n").slice(0, 6).join("\n"), "dim"));
  }
}

export function printSummary(
  summary: SuiteSummary,
  paint: ReturnType<typeof createPainter>,
): void {
  const counts = summary.outcomes.reduce(
    (acc, outcome) => {
      acc[outcome.status] += 1;
      return acc;
    },
    { passed: 0, failed: 0, inconclusive: 0, "model-drift": 0 } as Record<
      CaseStatus,
      number
    >,
  );

  const seconds = (summary.durationMs / 1000).toFixed(1);
  console.log("\n" + "=".repeat(72));
  console.log(
    `${summary.outcomes.length} case(s) in ${seconds}s — ` +
      `${paint(`${counts.passed} passed`, "green")}, ` +
      `${paint(`${counts.failed} failed`, counts.failed ? "red" : "dim")}, ` +
      `${paint(`${counts.inconclusive} inconclusive`, counts.inconclusive ? "yellow" : "dim")}, ` +
      `${counts["model-drift"]} model-drift`,
  );
  if (summary.modelId) console.log(`model: ${summary.modelId}`);

  const failures = summary.outcomes.filter((o) => o.status === "failed");
  if (failures.length) {
    console.log(paint("\nFailures:", "red"));
    for (const failure of failures) {
      const failedScorers = failure.scorers
        .filter((s) => !s.notScorable && (s.passed === false || (s.score ?? 0) < 1))
        .map((s) => s.id);
      const detail = failedScorers.length
        ? failedScorers.join(", ")
        : failure.notes[0] ?? failure.error?.message ?? "see case output";
      console.log(`  - ${failure.id}: ${detail}`);
    }
  }

  const inconclusive = summary.outcomes.filter((o) => o.status === "inconclusive");
  if (inconclusive.length) {
    console.log(
      paint(
        "\nInconclusive runs do not fail the suite, but they did not measure the agent:",
        "yellow",
      ),
    );
    for (const item of inconclusive) {
      console.log(`  - ${item.id}: ${item.notes[0] ?? "no result"}`);
    }
  }

  const drift = summary.outcomes.filter((o) => o.status === "model-drift");
  if (drift.length) {
    console.log(paint("\nModel drift:", "red"));
    for (const item of drift) console.log(`  - ${item.id}: ${item.notes[0]}`);
  }
}

export function writeArtifact(summary: SuiteSummary, directory: string): string {
  mkdirSync(directory, { recursive: true });
  const stamp = summary.startedAt.replace(/[:.]/g, "-");
  const path = join(directory, `${stamp}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(summary, null, 2), "utf8");
  return path;
}

export function toJsonSummary(summary: SuiteSummary) {
  return {
    startedAt: summary.startedAt,
    durationMs: summary.durationMs,
    modelId: summary.modelId,
    filtered: summary.filtered,
    counts: summary.outcomes.reduce(
      (acc, outcome) => {
        acc[outcome.status] = (acc[outcome.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<CaseStatus, number>,
    ),
    cases: summary.outcomes.map((outcome) => ({
      id: outcome.id,
      group: outcome.group,
      status: outcome.status,
      attempts: outcome.attempts,
      durationMs: outcome.durationMs,
      modelId: outcome.modelId,
      tools: outcome.tools,
      approvals: outcome.approvals.map((approval) => approval.toolName),
      scorers: outcome.scorers,
      gates: outcome.gates,
      notes: outcome.notes,
      writeVerification: outcome.writeVerification,
      blockedByGuardrail: outcome.blockedByGuardrail,
      error: outcome.error,
    })),
  };
}
