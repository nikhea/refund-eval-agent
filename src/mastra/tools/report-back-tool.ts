// src/mastra/tools/signal-peer-tool.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { createToolLogger } from "../lib/tool-logging";

export const reportbackTool = createTool({
  id: "reportbackTool",
  description: "Sends a anwser to another agent thread",
  inputSchema: z.object({
    message: z.string().describe("Message to send to the peer agent"),
  }),
  outputSchema: z.object({
    action: z.string(),
    success: z.boolean(),
  }),
  execute: async (
    {
      // resourceId, threadId,
      message,
    },
    context,
  ) => {
    const agent = context.agent; // the agent running this tool
    const mastra = context.mastra; // 👈 get it here

    if (!agent) throw new Error("Agent context not available.");
    if (!mastra) throw new Error("Mastra instance not available.");

    const log = createToolLogger("active-agent-weatherSignalTool", context);

    log.done("result", "reportbackTool called", {
      agentIdx: agent.agentId,
      resourceId: agent.resourceId,
      threadId: agent.threadId,
      ...agent,
    });

    const refund = mastra.getAgent("refundAgent");

    // const result = refund.sendMessage(message, {
    //   resourceId: "refund-agent",
    //   threadId: "f940ea22-4e58-4318-a763-f952f1dbbdf0",
    //   ifIdle: {
    //     behavior: "wake",
    //   },
    //   ifActive: {
    //     behavior: "deliver",
    //   },
    // });

    const { record, decision } = await refund.sendNotificationSignal(
      {
        source: "active-agent",
        kind: "peer-message",
        priority: "high",
        summary: message,
        dedupeKey: `peer:${agent.threadId}:${Date.now()}`,
      },
      {
        resourceId: "refund-agent",
        threadId: "f940ea22-4e58-4318-a763-f952f1dbbdf0",
      },
    );

    // const accepted = await result.accepted;

    return {
      //   action: accepted.action,
      action: record.status,
      success: true,
    };
  },
});
