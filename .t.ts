import { mastra } from "./src/mastra/index";
const a = mastra.getAgent("weatherAgent");
const calls: string[] = [];
const t0 = Date.now();
await a.generate("What is the weather in Paris?", { resourceId: "dbg3", threadId: "dbg3-thread", maxSteps: 6,
  onStepFinish: (s: any) => { for (const c of s.toolCalls ?? []) calls.push(c.payload?.toolName); console.log("STEP", calls.join(","), Date.now()-t0); } });
console.log("DONE", JSON.stringify(calls), Date.now()-t0);
process.exit(0);
