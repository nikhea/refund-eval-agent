import { checks } from "@mastra/evals/checks";

/**
 * Cheap structural gates. These are not correctness assertions — they catch runs
 * that never actually ran: a tool threw, the agent looped, or the cost guard
 * replaced the answer.
 *
 * `maxToolCalls` is 16 rather than the agent's `MAX_STEPS` of 10 because memory
 * writes (`setWorkingMemory`) are tool calls too and a multi-turn conversation
 * legitimately makes several.
 */
export const refundEvalChecks = {
  noToolErrors: checks.noToolErrors(),
  maxToolCalls: checks.maxToolCalls(16),
  tokenCostGuard: checks.excludes("Token cost limit exceeded"),
  usedNoTools: checks.usedNoTools(),
};

/** Gates every case must satisfy. */
export const refundEvalGates = [
  refundEvalChecks.noToolErrors,
  refundEvalChecks.maxToolCalls,
  refundEvalChecks.tokenCostGuard,
];
