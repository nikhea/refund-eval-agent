import {
  extractAgentResponseMessages,
  mergeToolInvocations,
} from "@mastra/evals/scorers/utils";
import { refundTools } from "../tools/refund-tools";

/**
 * A flattened view of one tool invocation from an agent run. `mergeToolInvocations`
 * understands both the legacy `content.toolInvocations` shape and the newer
 * `content.parts` shape, so scorers do not have to.
 */
export type ScorerToolInvocation = {
  toolName: string;
  toolCallId: string;
  args: Record<string, any>;
  state?: string;
  result?: any;
  approval?: { id?: string; approved?: boolean; reason?: string };
};

/**
 * Mastra reports tool calls under the key the tool was registered with
 * (`calculateRefundTool`), while the tool itself carries a stable id
 * (`calculate-refund`). Expectations are written against the ids because those
 * are the documented names; this map lets either spelling match.
 */
const TOOL_NAME_ALIASES = new Map<string, string>();
for (const [key, tool] of Object.entries(refundTools)) {
  const id = (tool as { id?: string }).id ?? key;
  TOOL_NAME_ALIASES.set(key, id);
  TOOL_NAME_ALIASES.set(key.toLowerCase(), id);
  TOOL_NAME_ALIASES.set(id, id);
  TOOL_NAME_ALIASES.set(id.toLowerCase(), id);
}

export function canonicalToolName(name: string): string {
  return TOOL_NAME_ALIASES.get(name) ?? TOOL_NAME_ALIASES.get(name.toLowerCase()) ?? name;
}

export function extractScorerToolInvocations(
  output: unknown,
): ScorerToolInvocation[] {
  if (!Array.isArray(output)) return [];

  const byId = new Map<string, ScorerToolInvocation>();
  for (const message of output) {
    for (const invocation of mergeToolInvocations(message as any)) {
      const toolCallId =
        invocation.toolCallId ?? `${invocation.toolName}-${byId.size}`;
      byId.set(toolCallId, {
        toolName: canonicalToolName(invocation.toolName),
        toolCallId,
        args: (invocation.args ?? {}) as Record<string, any>,
        state: invocation.state,
        result: invocation.result,
        approval: invocation.approval as ScorerToolInvocation["approval"],
      });
    }
  }

  return [...byId.values()];
}

export function toolNames(output: unknown): string[] {
  return extractScorerToolInvocations(output).map((i) => i.toolName);
}

/** The last completed result for a tool, or undefined when it never returned. */
export function lastToolResult(
  invocations: ScorerToolInvocation[],
  toolName: string,
): ScorerToolInvocation | undefined {
  const canonical = canonicalToolName(toolName);
  for (let i = invocations.length - 1; i >= 0; i--) {
    if (
      invocations[i].toolName === canonical &&
      invocations[i].result !== undefined
    )
      return invocations[i];
  }
  return undefined;
}

/**
 * Models emit typographic hyphens and quotes ("15‑day", "customer’s"), which
 * would silently break every phrase-based assertion. Normalize before matching
 * so the scorers grade meaning instead of Unicode trivia.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n");
}

/** All assistant text in the run, in order, normalized for matching. */
export function assistantText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  return normalizeText(extractAgentResponseMessages(output as any).join("\n\n")).trim();
}

const MONEY_KEY =
  /(amount|price|total|fee|tax|shipping|refund|subtotal|balance|cost)/i;
const NON_MONEY_KEY = /(rate|percent|qty|quantity|days|count)/i;

/**
 * Collects numbers stored under money-shaped keys from tool results. Walking
 * every number would treat quantities and tax rates as "known amounts" and
 * let a fabricated figure pass.
 */
export function collectMoneyNumbers(value: unknown, out: number[] = []): number[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectMoneyNumbers(entry, out);
    return out;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "number") {
        if (MONEY_KEY.test(key) && !NON_MONEY_KEY.test(key)) out.push(entry);
      } else {
        collectMoneyNumbers(entry, out);
      }
    }
  }

  return out;
}

export type DollarAmount = {
  raw: string;
  value: number;
  hasCents: boolean;
};

export function extractDollarAmounts(text: string): DollarAmount[] {
  const pattern = /\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
  const amounts: DollarAmount[] = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[1];
    amounts.push({
      raw,
      value: Number(raw.replace(/,/g, "")),
      hasCents: raw.includes("."),
    });
  }
  return amounts;
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}
