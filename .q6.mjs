import { DuckDBInstance } from "@duckdb/node-api";
const inst = await DuckDBInstance.create("/tmp/opencode/debug.duckdb", { access_mode: "READ_ONLY" });
const conn = await inst.connect();
const r = await conn.runAndReadAll(`select name, "spanType", "entityId", "entityName" from span_events where "spanType" in ('tool_call','tool') order by rowid desc limit 20`);
console.log("TOOL SPANS:");
for (const row of r.getRows()) console.log(row.join(" | "));
const d = await conn.runAndReadAll(`select distinct "spanType" from span_events`);
console.log("TYPES:", d.getRows().map(r=>r[0]).join(", "));
