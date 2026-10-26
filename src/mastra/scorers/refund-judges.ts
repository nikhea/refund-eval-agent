import { createScorer, notScorable } from "@mastra/core/evals";
import { extractAgentResponseMessages } from "@mastra/evals/scorers/utils";
import { z } from "zod";
import { assistantText } from "../lib/scorer-trace";
import type { RefundEvalExpectation } from "./refund-scorers";

export const REFUND_JUDGE_MODEL = "groq/openai/gpt-oss-20b";

const expectation = (run: any): RefundEvalExpectation | undefined =>
  run?.groundTruth;

/**
 * Advisory tone/clarity judge. Policy correctness is already covered by the
 * deterministic scorers, so this only grades how the answer reads.
 */
export const policyCommunicationJudge = createScorer({
  id: "refund-policy-communication",
  name: "Policy Communication",
  description:
    "Advisory judge for clarity, empathy and next steps in a refund explanation.",
  type: "agent",
  judge: {
    model: REFUND_JUDGE_MODEL,
    instructions:
      "You are a strict but fair QA reviewer for customer-support refund conversations. " +
      "Grade only communication quality: clarity, empathy, and whether the customer is told what happens next. " +
      "Do not re-decide eligibility or amounts; those are checked elsewhere. " +
      "Return only the structured JSON requested.",
  },
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    if (exp?.expectClarification)
      return notScorable("case expects a clarifying question, not an explanation");

    const text = assistantText(run.output);
    if (!text) return notScorable("no assistant text to grade");

    return {
      text,
      decision: exp?.expectedDecision ?? "unspecified",
      facts: exp?.requiredFacts?.map((fact) => fact.id) ?? [],
    };
  })
  .analyze({
    description: "Grade the refund explanation",
    outputSchema: z.object({
      clear: z.boolean(),
      empathetic: z.boolean(),
      nextStep: z.boolean(),
      score: z.number().min(0).max(1),
      explanation: z.string(),
    }),
    createPrompt: ({ results }) => {
      const r: any = results.preprocessStepResult;
      return `Grade this refund support reply.

Expected decision: ${r.decision}
Required policy facts: ${r.facts.join(", ") || "none"}

Reply:
"""
${r.text}
"""

Criteria:
- clear: the customer can tell what was decided and why, without jargon.
- empathetic: acknowledges the customer's situation without being saccharine.
- nextStep: states what happens next (return label, review, alternative action) when one applies.

Score 0-1 overall, where 1 is a reply a good support agent would send unchanged.
Return JSON: { "clear": boolean, "empathetic": boolean, "nextStep": boolean, "score": number, "explanation": string }`;
    },
  })
  .generateScore(({ results }) => {
    const r: any = results.analyzeStepResult;
    return typeof r?.score === "number" ? r.score : 0;
  })
  .generateReason(({ results }) => {
    const r: any = results.analyzeStepResult;
    if (!r) return "Judge returned no analysis.";
    return `clear=${r.clear}, empathetic=${r.empathetic}, nextStep=${r.nextStep}. ${r.explanation}`;
  });

/**
 * Whole-conversation judge. The criterion lives on the case's ground truth so
 * one scorer covers every multi-turn scenario.
 */
export const conversationJudge = createScorer({
  id: "refund-conversation-judge",
  name: "Conversation Judge",
  description:
    "Advisory judge that grades a multi-turn refund conversation against a case-specific criterion.",
  type: "agent",
  judge: {
    model: REFUND_JUDGE_MODEL,
    instructions:
      "You grade multi-turn customer-support transcripts against one criterion. " +
      "The transcript lists the customer's messages and the assistant's replies separately, " +
      "each in order; one customer message can produce several assistant replies. " +
      "Judge the whole conversation, including whether earlier turns were ignored and whether " +
      "the assistant acted only after the customer actually authorized it. " +
      "Return only the structured JSON requested.",
  },
})
  .preprocess(({ run }) => {
    const exp = expectation(run);
    if (!exp?.criterion)
      return notScorable("case does not define a conversation criterion");

    const replies = extractAgentResponseMessages(run.output as any)
      .map((text) => text.trim())
      .filter(Boolean);
    if (!replies.length) return notScorable("no assistant turns to grade");

    // `run.output` only carries assistant messages. Without the customer's
    // messages the judge cannot see a confirmation, so ground truth supplies
    // them and the transcript is rendered as two ordered, labelled blocks.
    const customerTurns = (exp.userTurns ?? []).map((text) => text.trim());
    const transcript = [
      customerTurns.length
        ? `CUSTOMER MESSAGES (in order):\n${customerTurns
            .map((text, index) => `${index + 1}. ${text}`)
            .join("\n")}`
        : "",
      `ASSISTANT REPLIES (in order; one customer message can produce several):\n${replies
        .map((text, index) => `${index + 1}. ${text}`)
        .join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return { criterion: exp.criterion, transcript };
  })
  .analyze({
    description: "Grade the conversation against the criterion",
    outputSchema: z.object({
      satisfied: z.boolean(),
      reasoning: z.string(),
    }),
    createPrompt: ({ results }) => {
      const r: any = results.preprocessStepResult;
      return `Conversation transcript:
"""
${r.transcript}
"""

Criterion the conversation must satisfy:
${r.criterion}

Return JSON: { "satisfied": boolean, "reasoning": string }`;
    },
  })
  .generateScore(({ results }) =>
    (results.analyzeStepResult as any)?.satisfied ? 1 : 0,
  )
  .generateReason(({ results }) =>
    String((results.analyzeStepResult as any)?.reasoning ?? ""),
  );

export const refundEvalJudges = {
  policyCommunication: policyCommunicationJudge,
  conversationJudge,
};

type JudgeScorer = { run: (...args: any[]) => Promise<any> };

/**
 * `runEvals` aborts the whole item when a scorer throws, so a judge provider
 * hiccup would turn an advisory opinion into a case failure. This wrapper
 * converts any judge error into a not-scorable result, which is what
 * "advisory" has to mean structurally.
 */
function makeAdvisory<T extends JudgeScorer>(scorer: T): T {
  return new Proxy(scorer, {
    get(target, property, receiver) {
      if (property === "run") {
        return async (args: any) => {
          try {
            return await target.run(args);
          } catch (error) {
            const reason = `advisory judge failed: ${
              (error as Error)?.message ?? String(error)
            }`;
            return {
              runId: "advisory-judge-error",
              notScorable: { step: "analyze", reason },
              reason,
            };
          }
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

/** Runner-facing judges: same scorers, but failures can never fail a case. */
export const advisoryRefundJudges = {
  policyCommunication: makeAdvisory(policyCommunicationJudge),
  conversationJudge: makeAdvisory(conversationJudge),
};
