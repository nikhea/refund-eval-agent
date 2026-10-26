import {
  deriveCaseFacts,
  validateCases,
  type DerivedCaseFacts,
  type RefundEvalCase,
} from "./expectations";

export type PreflightRow = {
  testCase: RefundEvalCase;
  facts: DerivedCaseFacts;
};

export type PreflightResult = {
  rows: PreflightRow[];
  issues: string[];
};

const money = (value: number | undefined) =>
  value === undefined ? "—" : `$${value.toFixed(2)}`;

const pad = (value: string, width: number) =>
  value.length >= width ? value : value + " ".repeat(width - value.length);

/**
 * Loads every case, derives its engine expectations and checks the dataset.
 * The same pass runs before a real suite, so a typo costs nothing instead of
 * turning into a confusing "agent failed" result.
 */
export function preflight(cases: RefundEvalCase[]): PreflightResult {
  const issues = validateCases(cases);
  const rows: PreflightRow[] = [];

  for (const testCase of cases) {
    try {
      rows.push({ testCase, facts: deriveCaseFacts(testCase) });
    } catch (error) {
      issues.push(`case "${testCase.id}": ${(error as Error).message}`);
    }
  }

  return { rows, issues };
}

export function printCaseTable(result: PreflightResult): void {
  const header = [
    pad("CASE", 28),
    pad("GROUP", 12),
    pad("ORDER", 10),
    pad("DECISION", 18),
    pad("REFUND", 10),
    pad("WRITE", 6),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const { testCase, facts } of result.rows) {
    console.log(
      [
        pad(testCase.id, 28),
        pad(testCase.group, 12),
        pad(testCase.orderId ?? "—", 10),
        pad(facts.decision ?? "—", 18),
        pad(money(facts.totalRefund), 10),
        pad(testCase.expectWrite ? "yes" : "no", 6),
      ].join(" "),
    );
  }

  const groups = new Map<string, number>();
  for (const testCase of result.rows.map((row) => row.testCase)) {
    groups.set(testCase.group, (groups.get(testCase.group) ?? 0) + 1);
  }
  console.log(
    `\n${result.rows.length} case(s): ${[...groups.entries()]
      .map(([group, count]) => `${group}=${count}`)
      .join(", ")}`,
  );
}

export function reportIssues(issues: string[]): void {
  console.error("\nDataset validation failed:");
  for (const issue of issues) console.error(`  ✗ ${issue}`);
}
