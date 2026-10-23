import { Memory } from "@mastra/memory";

export const refundAgentMemory = new Memory({
  options: {
    messageHistory: {
      maxTokens: 8_000,
      atMaxRemoveTokens: 2_000,
    },
    workingMemory: {
      enabled: true,
      useStateSignals: true,
      scope: "thread",
      template: `# Customer Profile

## Customer
- **Name**:
- **Customer ID**:
- **Emails**:
- **Tier**:

## Current return
- **Order ID**:
- **Items**:
- **Reason**:
- **Condition**:
- **Quoted refund**:
- **Customer confirmed**:

## Notes
- **Open questions**:
`,
    },
    generateTitle: {
      model: "cloudflare-workers-ai/@cf/openai/gpt-oss-120b",
      emitEvent: true,
      // instructions:
      //   "Write a short support-ticket title (max 6 words) naming the customer and the issue, e.g. 'Amara Okafor: earbuds return'.",
    },
  },
});
