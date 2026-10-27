// src/mastra/tools/signal-peer-tool.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { weatherAgent } from "../agents/weather-agent";
import { createToolLogger } from "../lib/tool-logging";

export const weatherSignalTool = createTool({
  id: "weather-signal-tool",
  description: "Sends a signal to another agent thread",
  inputSchema: z.object({
    // resourceId: z.string().describe('Resource ID of the target agent thread'),
    // threadId: z.string().describe('Thread ID of the target agent thread'),
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
    const log = createToolLogger("active-agent-weatherSignalTool", context);

    log.done("result", "weatherSignalTool returned", {
      agentId: agent?.agentId,
      resourceId: agent?.resourceId,
      threadId: agent?.threadId,
      ...agent,
    });

    const result = weatherAgent.sendMessage(message, {
      resourceId: "weather-agent",
      threadId: "59d1f0fc-e726-4140-b79f-c9de737730b2",
      ifIdle: {
        behavior: "wake",
      },
      ifActive: {
        behavior: "deliver",
      },
    });

    const accepted = await result.accepted;

    return {
      action: accepted.action,
      success: true,
    };
  },
});
