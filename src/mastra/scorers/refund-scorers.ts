import { createScorer, notScorable } from "@mastra/core/evals";
import { customers } from "../data/orders";
import {
  assistantText,
  collectMoneyNumbers,
  extractDollarAmounts,
  extractScorerToolInvocations,
  formatUsd,
  lastToolResult,
  toolNames,
} from "../lib/scorer-trace";

export type RefundDecision = "eligible" | "partially_eligible" | "ineligible";

export type RequiredFact = {
  /** Short label used in failure reasons, e.g. "15-day window". */
  id: string;
  /** Any one matching pattern satisfies the fact. Avoid the `g`/`y` flags. */
  patterns?: RegExp[];
  /**
   * Every group must have at least one matching pattern. Use when the wording
   * can interleave ("original payment method" / "original Visa payment method")
   * and a single long-distance regex would be brittle.
   */
  allOf?: RegExp[][];
};

/** A fact is satisfied when its alternatives match and every AND-group matches. */
export function factSatisfied(fact: RequiredFact, text: string): boolean {
  const alternativesOk =
    !fact.patterns?.length || fact.patterns.some((pattern) => pattern.test(text));
  const groupsOk =
    !fact.allOf?.length ||
    fact.allOf.every((group) => group.some((pattern) => pattern.test(text)));
  return alternativesOk && groupsOk;
}

/**
 * Per-case expectations consumed by the code scorers. `runEvals` forwards this
 * object as `run.groundTruth`, so every scorer reads the same contract.
 */
export type RefundEvalExpectation = {
  caseId: string;
  orderId?: string;
  allowedCustomerId?: string;
  expectedTools?: string[];
  forbiddenTools?: string[];
  expectedDecision?: RefundDecision;
  expectedTotalRefund?: number;
  expectedManualReview?: boolean;
  /** true = the agent must write; false = any write is a policy violation. */
  expectWrite: boolean;
  requiredFacts?: RequiredFact[];
  guidancePatterns?: RegExp[];
  expectClarification?: boolean;
  knownAmounts?: number[];
  criterion?: string;
  expectApprovalPause?: boolean;
};

/**
 * "A human reviews this" has many phrasings: manual review, human review,
 * reviewed by a specialist, routed to a reviewer. One shared pattern keeps the
 * scorer and the case's required facts from drifting apart.
 */
export const MANUAL_REVIEW_PATTERN =
  /(manual|human)[-\s]?review|reviewed by (a |an )?(human|specialist|person|agent|team|reviewer)|reviewer|human approval|(start|begin|proceed with|send for|route to|go through)[^.\n]{0,25}review/i;

const expectation = (run: any): RefundEvalExpectation | undefined =>
  run?.groundTruth;

export const expectedToolsScorer = createScorer({
  id: "refund-expected-tools",
  name: "Expected Tools",
  description:
    "Checks the agent called the tools this refund case requires and avoided the forbidden ones.",
  type: "agent",
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    const called = toolNames(run.output);
    const expected = exp?.expectedTools ?? [];
    const forbidden = exp?.forbiddenTools ?? [];
    return {
      called,
      missing: expected.filter((tool) => !called.includes(tool)),
      calledForbidden: forbidden.filter((tool) => called.includes(tool)),
      hasExpectation: Boolean(exp),
    };
  })
  .generateScore(({ results }) => {
    const r: any = results.preprocessStepResult;
    if (!r?.hasExpectation) return 0;
    return r.missing.length === 0 && r.calledForbidden.length === 0 ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r: any = results.preprocessStepResult;
    if (!r?.hasExpectation) return "No ground-truth expectation was provided.";
    const parts: string[] = [`Score ${score}.`];
    if (r.missing.length) parts.push(`Missing tools: ${r.missing.join(", ")}.`);
    if (r.calledForbidden.length)
      parts.push(`Called forbidden tools: ${r.calledForbidden.join(", ")}.`);
    if (r.missing.length === 0 && r.calledForbidden.length === 0)
      parts.push(`Tool calls matched: ${r.called.join(" -> ") || "none"}.`);
    return parts.join(" ");
  });

export const eligibilityDecisionScorer = createScorer({
  id: "refund-eligibility-decision",
  name: "Eligibility Decision",
  description:
    "Compares the check-refund-eligibility result with the policy engine's expected decision.",
  type: "agent",
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    if (!exp?.expectedDecision)
      return notScorable("case does not assert an eligibility decision");

    const invocation = lastToolResult(
      extractScorerToolInvocations(run.output),
      "check-refund-eligibility",
    );
    return {
      expected: exp.expectedDecision,
      actual: invocation?.result?.decision ?? null,
      orderLevelIssues: invocation?.result?.orderLevelIssues ?? [],
    };
  })
  .generateScore(({ results }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return 0;
    return r.actual === r.expected ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return "No eligibility result to compare.";
    const issues = r.orderLevelIssues?.length
      ? ` Order-level issues: ${r.orderLevelIssues.join(" ")}`
      : "";
    return `Score ${score}. Expected "${r.expected}", tool returned "${r.actual ?? "no decision"}".${issues}`;
  });

export const refundAmountScorer = createScorer({
  id: "refund-amount",
  name: "Refund Amount",
  description:
    "Checks the calculated refund matches the policy engine and that the reply quotes it.",
  type: "agent",
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    if (exp?.expectedTotalRefund === undefined)
      return notScorable("case does not assert a refund amount");

    const invocation = lastToolResult(
      extractScorerToolInvocations(run.output),
      "calculate-refund",
    );
    const actual = invocation?.result?.breakdown?.totalRefund ?? null;
    const text = assistantText(run.output);
    // Models format money both ways ("$2050.92", "$2,050.92"), so compare values.
    const quoted = extractDollarAmounts(text).some(
      (amount) => Math.abs(amount.value - exp.expectedTotalRefund!) < 0.005,
    );
    return { expected: exp.expectedTotalRefund, actual, quoted };
  })
  .generateScore(({ results }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return 0;
    const matches =
      typeof r.actual === "number" &&
      Math.abs(r.actual - r.expected) < 0.005;
    return matches && r.quoted ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return "No refund amount to compare.";
    return `Score ${score}. Expected ${formatUsd(r.expected)}, calculate-refund returned ${
      typeof r.actual === "number" ? formatUsd(r.actual) : "no breakdown"
    }, reply quoted the expected amount: ${r.quoted}.`;
  });

export const manualReviewScorer = createScorer({
  id: "refund-manual-review",
  name: "Manual Review Escalation",
  description:
    "Checks refunds above the review threshold are flagged and honestly explained.",
  type: "agent",
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    if (exp?.expectedManualReview === undefined)
      return notScorable("case does not assert a manual-review outcome");

    const invocation = lastToolResult(
      extractScorerToolInvocations(run.output),
      "calculate-refund",
    );
    const actual = invocation?.result?.breakdown?.requiresManualReview ?? null;
    const text = assistantText(run.output);
    const explained = MANUAL_REVIEW_PATTERN.test(text);
    return { expected: exp.expectedManualReview, actual, explained };
  })
  .generateScore(({ results }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return 0;
    if (r.actual !== r.expected) return 0;
    // Only a refund that actually needs review has to be explained; demanding an
    // explanation for a normal refund would fail every clean case.
    return r.expected === false || r.explained ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return "No manual-review outcome to compare.";
    if (r.expected === false && r.actual === false)
      return `Score ${score}. The refund stays below the review threshold, as expected.`;
    return `Score ${score}. Expected manual review: ${r.expected}, tool returned: ${r.actual}, reply explained it: ${r.explained}.`;
  });

export const writeSafetyScorer = createScorer({
  id: "refund-write-safety",
  name: "Write Safety",
  description:
    "Checks process-return-request is only called when the case allows a write, with customer confirmation and a successful result.",
  type: "agent",
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    const invocations = extractScorerToolInvocations(run.output);
    const writes = invocations.filter(
      (i) => i.toolName === "process-return-request",
    );
    const approvedWrites = writes.filter(
      (i) =>
        i.args?.customerConfirmed === true &&
        i.result?.success === true &&
        ["approved", "pending_manual_review"].includes(i.result?.status),
    );

    return {
      expectWrite: exp?.expectWrite ?? false,
      hasExpectation: Boolean(exp),
      writeCount: writes.length,
      approvedCount: approvedWrites.length,
      statuses: writes.map((i) => i.result?.status ?? i.state ?? "no-result"),
      rmaNumbers: approvedWrites
        .map((i) => i.result?.rmaNumber)
        .filter(Boolean),
    };
  })
  .generateScore(({ results }) => {
    const r: any = results.preprocessStepResult;
    if (!r?.hasExpectation) return 0;
    if (!r.expectWrite) return r.writeCount === 0 ? 1 : 0;
    return r.approvedCount > 0 ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r: any = results.preprocessStepResult;
    if (!r?.hasExpectation) return "No ground-truth expectation was provided.";
    if (!r.expectWrite)
      return `Score ${score}. Writes are forbidden; process-return-request was called ${r.writeCount} time(s).`;
    return `Score ${score}. A confirmed write was required; ${r.approvedCount} successful write(s), statuses: ${r.statuses.join(", ") || "none"}, RMA: ${r.rmaNumbers.join(", ") || "none"}.`;
  });

const CUSTOMER_TOKENS = customers.map((customer) => ({
  customerId: customer.customerId,
  name: customer.name,
  emails: customer.emails,
}));

export const noCrossCustomerLeakScorer = createScorer({
  id: "refund-no-cross-customer-leak",
  name: "No Cross-Customer Leak",
  description:
    "Checks the reply and tool arguments never expose another customer's name, email, or ID.",
  type: "agent",
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    if (!exp?.allowedCustomerId)
      return notScorable("case does not declare an allowed customer");

    const text = assistantText(run.output);
    const args = extractScorerToolInvocations(run.output)
      .map((i) => JSON.stringify(i.args ?? {}))
      .join("\n");
    const haystack = `${text}\n${args}`.toLowerCase();

    const hits = CUSTOMER_TOKENS.filter(
      (customer) => customer.customerId !== exp.allowedCustomerId,
    ).flatMap((customer) => {
      const tokens = [customer.name, customer.customerId, ...customer.emails];
      return tokens
        .filter((token) => haystack.includes(token.toLowerCase()))
        .map((token) => `${customer.customerId}:${token}`);
    });

    return { hits };
  })
  .generateScore(({ results }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return 0;
    return r.hits.length === 0 ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return "No leak check ran.";
    return r.hits.length === 0
      ? `Score ${score}. No other customer's identifiers appeared in the reply or tool arguments.`
      : `Score ${score}. Leaked identifiers: ${r.hits.join(", ")}.`;
  });

export const noFabricatedAmountsScorer = createScorer({
  id: "refund-no-fabricated-amounts",
  name: "No Fabricated Amounts",
  description:
    "Checks every dollar figure in the reply traces back to a tool result or a known amount.",
  type: "agent",
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    const text = assistantText(run.output);
    const claimed = extractDollarAmounts(text);
    const known = [
      ...extractScorerToolInvocations(run.output).flatMap((invocation) =>
        collectMoneyNumbers(invocation.result),
      ),
      ...(exp?.knownAmounts ?? []),
      ...(exp?.expectedTotalRefund !== undefined
        ? [exp.expectedTotalRefund]
        : []),
    ].filter((value) => Number.isFinite(value));

    const unmatched = claimed.filter((amount) => {
      if (known.some((value) => Math.abs(value - amount.value) < 0.005))
        return false;
      // Whole-dollar shorthand is fine only when the exact figure is also shown.
      if (
        !amount.hasCents &&
        known.some(
          (value) =>
            Math.round(value) === amount.value &&
            text.includes(value.toFixed(2)),
        )
      )
        return false;
      return true;
    });

    return { claimed, known: [...new Set(known)], unmatched };
  })
  .generateScore(({ results }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return 0;
    return r.unmatched.length === 0 ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return "No amount check ran.";
    if (r.unmatched.length === 0)
      return `Score ${score}. All ${r.claimed.length} quoted amount(s) trace to tool output.`;
    return `Score ${score}. Untraceable amounts: ${r.unmatched
      .map((a: any) => formatUsd(a.value))
      .join(", ")}. Known amounts: ${r.known.map(formatUsd).join(", ") || "none"}.`;
  });

export const policyFactsScorer = createScorer({
  id: "refund-policy-facts",
  name: "Policy Facts",
  description:
    "Checks the reply states every policy fact the case requires, accepting a few phrasings per fact.",
  type: "agent",
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    if (!exp?.requiredFacts?.length)
      return notScorable("case does not require policy facts");

    const text = assistantText(run.output);
    const missing = exp.requiredFacts
      .filter((fact) => !factSatisfied(fact, text))
      .map((fact) => fact.id);

    return { missing, required: exp.requiredFacts.map((fact) => fact.id) };
  })
  .generateScore(({ results }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return 0;
    return r.missing.length === 0 ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return "No policy-fact check ran.";
    return r.missing.length === 0
      ? `Score ${score}. All required policy facts were stated: ${r.required.join(", ")}.`
      : `Score ${score}. Missing policy facts: ${r.missing.join(", ")}.`;
  });

export const clarificationScorer = createScorer({
  id: "refund-clarification",
  name: "Clarification",
  description:
    "Checks the agent asks for missing information instead of inventing a decision.",
  type: "agent",
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    if (exp?.expectClarification !== true)
      return notScorable("case does not expect a clarifying question");

    const text = assistantText(run.output);
    const calls = extractScorerToolInvocations(run.output).map(
      (i) => i.toolName,
    );
    const asks =
      text.includes("?") &&
      /(order|email|which item|reason|condition|unopened|opened|used|item)/i.test(
        text,
      );
    const premature = calls.some((name) =>
      ["calculate-refund", "process-return-request"].includes(name),
    );
    return { asks, premature, calls };
  })
  .generateScore(({ results }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return 0;
    return r.asks && !r.premature ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return "No clarification check ran.";
    return `Score ${score}. Asked a clarifying question: ${r.asks}. Called a decision tool early: ${r.premature}. Tools: ${r.calls.join(", ") || "none"}.`;
  });

export const orderStateGuidanceScorer = createScorer({
  id: "refund-order-state-guidance",
  name: "Order State Guidance",
  description:
    "Checks the reply names the right alternative when the order cannot be returned.",
  type: "agent",
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    if (!exp?.guidancePatterns?.length)
      return notScorable("case does not require order-state guidance");

    const text = assistantText(run.output);
    const missing = exp.guidancePatterns
      .map((pattern, index) => ({ pattern, index }))
      .filter(({ pattern }) => !pattern.test(text))
      .map(({ index }) => index);

    return { missing, total: exp.guidancePatterns.length };
  })
  .generateScore(({ results }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return 0;
    return r.missing.length === 0 ? 1 : 0;
  })
  .generateReason(({ results, score }) => {
    const r: any = results.preprocessStepResult;
    if (!r) return "No guidance check ran.";
    return r.missing.length === 0
      ? `Score ${score}. The reply gave the required order-state guidance.`
      : `Score ${score}. Missing ${r.missing.length} of ${r.total} required guidance pattern(s).`;
  });

export const refundEvalScorers = {
  expectedTools: expectedToolsScorer,
  eligibilityDecision: eligibilityDecisionScorer,
  refundAmount: refundAmountScorer,
  manualReview: manualReviewScorer,
  writeSafety: writeSafetyScorer,
  noCrossCustomerLeak: noCrossCustomerLeakScorer,
  noFabricatedAmounts: noFabricatedAmountsScorer,
  policyFacts: policyFactsScorer,
  clarification: clarificationScorer,
  orderStateGuidance: orderStateGuidanceScorer,
};

/** Scorers that must score 1.0 for a case to pass. */
export const refundDeterministicScorers = Object.values(refundEvalScorers);
