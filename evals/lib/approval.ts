import type { Agent } from "@mastra/core/agent";
import { canonicalToolName } from "../../src/mastra/lib/scorer-trace";

export type ApprovalRecord = {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
};

export type EvalRunExtras = {
  /** Tool calls that suspended and were auto-approved, in order. */
  evalApprovals: ApprovalRecord[];
  /** Model that answered, from the provider response. */
  evalModelId?: string;
};

const MAX_APPROVALS = 6;

/**
 * `calculate-refund` and `process-return-request` are declared with
 * `requireApproval: true`, and `runEvals` has no approval hook: a suspended run
 * would come back with `finishReason: "suspended"` and be scored as if the agent
 * had said nothing.
 *
 * This proxy wraps `generate` so every suspension is approved and resumed, then
 * hands the final result back to `runEvals` unchanged. Approving automatically is
 * what lets the suite exercise the write path at all; whether the write was
 * *allowed* is still decided by the deterministic scorers.
 */
export function createEvalTarget(
  agent: Agent,
  options: { persist?: boolean } = {},
) {
  const persist = options.persist ?? true;
  const withApprovals = async (input: any, options: any) => {
    let result = (await agent.generate(input, options)) as any;
    const approvals: ApprovalRecord[] = [];

    while (result?.finishReason === "suspended") {
      const payload = result.suspendPayload;
      if (!payload?.toolCallId) {
        throw new Error(
          "agent suspended without a toolCallId; cannot auto-approve the run",
        );
      }
      if (approvals.length >= MAX_APPROVALS) {
        throw new Error(
          `agent suspended ${MAX_APPROVALS} times without finishing; treating as an approval loop`,
        );
      }

      approvals.push({
        toolName: canonicalToolName(String(payload.toolName ?? "unknown")),
        toolCallId: payload.toolCallId,
        args: (payload.args ?? {}) as Record<string, unknown>,
      });

      result = await agent.approveToolCallGenerate({
        ...(options as any),
        runId: result.runId,
        toolCallId: payload.toolCallId,
      });
    }

    return Object.assign(result, {
      evalApprovals: approvals,
      evalModelId: result?.response?.modelId,
    } satisfies EvalRunExtras);
  };

  return new Proxy(agent, {
    get(target, property, receiver) {
      if (property === "generate") return withApprovals;

      // `runEvals` writes scores through `target.getMastraInstance().getStorage()`.
      // Handing it a storage-less view is the least invasive way to honour
      // `--no-persist` without changing how the agent itself runs.
      if (property === "getMastraInstance" && !persist) {
        return () => {
          const instance = target.getMastraInstance();
          if (!instance) return instance;
          return new Proxy(instance, {
            get(innerTarget, innerProperty, innerReceiver) {
              if (innerProperty === "getStorage") return () => undefined;
              const value = Reflect.get(innerTarget, innerProperty, innerReceiver);
              return typeof value === "function" ? value.bind(innerTarget) : value;
            },
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Agent;
}
