import type { ItemCondition, ReturnReason } from "../../src/mastra/data/orders";
import {
  computeRefund,
  evaluateItems,
  findOrder,
  orderLevelIssues,
  resolveOrderItem,
} from "../../src/mastra/lib/refund-engine";
import type {
  RefundDecision,
  RefundEvalExpectation,
  RequiredFact,
} from "../../src/mastra/scorers/refund-scorers";

export const REFUND_EVAL_GROUPS = [
  "eligibility",
  "amounts",
  "write",
  "safety",
  "multi-turn",
  "policy",
] as const;

export type RefundEvalGroup = (typeof REFUND_EVAL_GROUPS)[number];

export type EvalItemRef = {
  sku?: string;
  name?: string;
  quantity?: number;
};

/**
 * A single eval case. Decisions and amounts are derived from the policy engine
 * (`reason` + `condition` + `items`); policy wording and safety constraints are
 * hand-authored. `declared` exists so a hand-written expectation can be checked
 * against the engine instead of quietly disagreeing with it.
 */
export type RefundEvalCase = {
  id: string;
  group: RefundEvalGroup;
  description: string;
  /** Single-turn user message. Mutually exclusive with `turns`. */
  input?: string;
  /** Multi-turn conversation, sent sequentially on one thread. */
  turns?: { input: string }[];
  orderId?: string;
  reason?: ReturnReason;
  condition?: ItemCondition;
  items?: EvalItemRef[];
  /** true = the agent must complete a write; false = any write is a violation. */
  expectWrite: boolean;
  /** Set false for cases that only assert behaviour, not a decision/amount. */
  assertDecision?: boolean;
  /** Optional hand-authored expectation, cross-checked against the engine. */
  declared?: {
    decision?: RefundDecision;
    totalRefund?: number;
    manualReview?: boolean;
  };
  expectedTools?: string[];
  forbiddenTools?: string[];
  requiredFacts?: RequiredFact[];
  guidancePatterns?: RegExp[];
  knownAmounts?: number[];
  expectClarification?: boolean;
  /** Advisory judge criterion for multi-turn cases. */
  criterion?: string;
  /** Pass when an input processor blocks the message instead of answering. */
  acceptGuardrailBlock?: boolean;
  tags?: string[];
};

export type DerivedCaseFacts = {
  orderId?: string;
  orderLevelIssues: string[];
  decision?: RefundDecision;
  totalRefund?: number;
  manualReview?: boolean;
  eligibleSkus: string[];
  blockers: string[];
};

/**
 * Runs the same engine the tools run, so the expected decision and amount are
 * the policy's answer rather than a number copied by hand.
 */
export function deriveCaseFacts(testCase: RefundEvalCase): DerivedCaseFacts {
  if (!testCase.orderId) {
    return {
      orderLevelIssues: [],
      eligibleSkus: [],
      blockers: [],
    };
  }

  const order = findOrder(testCase.orderId);
  if (!order) {
    throw new Error(
      `case "${testCase.id}" references unknown order "${testCase.orderId}"`,
    );
  }

  const issues = orderLevelIssues(order);
  if (issues.length) {
    return {
      orderId: order.orderId,
      orderLevelIssues: issues,
      decision: "ineligible",
      eligibleSkus: [],
      blockers: issues,
    };
  }

  if (!testCase.reason || !testCase.condition) {
    return {
      orderId: order.orderId,
      orderLevelIssues: [],
      eligibleSkus: [],
      blockers: [],
    };
  }

  const evaluations = evaluateItems(
    order,
    testCase.reason,
    testCase.condition,
    testCase.items,
  );
  const eligible = evaluations.filter((e) => e.eligible);
  const decision: RefundDecision =
    eligible.length === 0
      ? "ineligible"
      : eligible.length === evaluations.length
        ? "eligible"
        : "partially_eligible";

  if (!eligible.length) {
    return {
      orderId: order.orderId,
      orderLevelIssues: [],
      decision,
      eligibleSkus: [],
      blockers: evaluations.flatMap((e) => e.blockers),
    };
  }

  const breakdown = computeRefund(order, evaluations, testCase.reason);

  return {
    orderId: order.orderId,
    orderLevelIssues: [],
    decision,
    totalRefund: breakdown.totalRefund,
    manualReview: breakdown.requiresManualReview,
    eligibleSkus: eligible.map((e) => e.sku),
    blockers: evaluations.flatMap((e) => e.blockers),
  };
}

/** Builds the ground truth object every scorer reads from `run.groundTruth`. */
export function buildExpectation(
  testCase: RefundEvalCase,
  facts: DerivedCaseFacts,
): RefundEvalExpectation {
  const assertsDecision =
    (testCase.assertDecision ?? true) &&
    facts.decision !== undefined &&
    !testCase.expectClarification;

  return {
    caseId: testCase.id,
    orderId: facts.orderId,
    allowedCustomerId: facts.orderId
      ? findOrder(facts.orderId)?.customer.customerId
      : undefined,
    expectedTools: testCase.expectedTools,
    forbiddenTools: testCase.forbiddenTools,
    expectedDecision: assertsDecision ? facts.decision : undefined,
    expectedTotalRefund: assertsDecision ? facts.totalRefund : undefined,
    expectedManualReview: assertsDecision ? facts.manualReview : undefined,
    expectWrite: testCase.expectWrite,
    requiredFacts: testCase.requiredFacts,
    guidancePatterns: testCase.guidancePatterns,
    expectClarification: testCase.expectClarification,
    knownAmounts: testCase.knownAmounts,
    criterion: testCase.criterion,
  };
}

const closeEnough = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Validates the dataset without calling a model. Every returned issue blocks the
 * run: a broken case would otherwise look like an agent failure.
 */
export function validateCase(testCase: RefundEvalCase): string[] {
  const issues: string[] = [];
  const where = `case "${testCase.id}"`;

  if (!REFUND_EVAL_GROUPS.includes(testCase.group)) {
    issues.push(`${where} has unknown group "${testCase.group}"`);
  }

  const hasInput = typeof testCase.input === "string" && testCase.input.trim() !== "";
  const hasTurns = Array.isArray(testCase.turns) && testCase.turns.length > 0;

  if (hasInput && hasTurns) {
    issues.push(`${where} sets both input and turns; use one`);
  } else if (!hasInput && !hasTurns) {
    issues.push(`${where} has neither input nor turns`);
  }

  if (hasTurns && testCase.turns!.some((turn) => !turn.input?.trim())) {
    issues.push(`${where} has an empty turn input`);
  }

  if (!testCase.orderId) {
    if (testCase.reason || testCase.condition) {
      issues.push(`${where} sets reason/condition without an orderId`);
    }
    if (testCase.items?.length) {
      issues.push(`${where} sets items without an orderId`);
    }
    return issues;
  }

  const order = findOrder(testCase.orderId);
  if (!order) {
    issues.push(`${where} references unknown order "${testCase.orderId}"`);
    return issues;
  }

  for (const item of testCase.items ?? []) {
    const resolution = resolveOrderItem(order, item);
    if (resolution.kind !== "found") {
      issues.push(
        `${where} references an item that is not on ${order.orderId}: ${item.sku ?? item.name} (${resolution.message})`,
      );
    }
  }

  let facts: DerivedCaseFacts;
  try {
    facts = deriveCaseFacts(testCase);
  } catch (error) {
    issues.push(`${where} could not derive expectations: ${(error as Error).message}`);
    return issues;
  }

  if (testCase.declared) {
    if (
      testCase.declared.decision !== undefined &&
      facts.decision !== undefined &&
      testCase.declared.decision !== facts.decision
    ) {
      issues.push(
        `${where} contradicts the engine: declared decision "${testCase.declared.decision}", engine says "${facts.decision}"`,
      );
    }
    if (
      testCase.declared.totalRefund !== undefined &&
      facts.totalRefund !== undefined &&
      !closeEnough(testCase.declared.totalRefund, facts.totalRefund)
    ) {
      issues.push(
        `${where} contradicts the engine: declared refund $${testCase.declared.totalRefund.toFixed(2)}, engine says $${facts.totalRefund.toFixed(2)}`,
      );
    }
    if (
      testCase.declared.manualReview !== undefined &&
      facts.manualReview !== undefined &&
      testCase.declared.manualReview !== facts.manualReview
    ) {
      issues.push(
        `${where} contradicts the engine: declared manualReview ${testCase.declared.manualReview}, engine says ${facts.manualReview}`,
      );
    }
  }

  if (testCase.expectWrite && !testCase.orderId) {
    issues.push(`${where} expects a write but has no orderId`);
  }

  return issues;
}

export function validateCases(cases: RefundEvalCase[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const testCase of cases) {
    if (seen.has(testCase.id)) {
      issues.push(`duplicate case id "${testCase.id}"`);
    }
    seen.add(testCase.id);
    issues.push(...validateCase(testCase));
  }

  return issues;
}
