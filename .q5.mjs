import { DuckDBInstance } from "@duckdb/node-api";
const inst = await DuckDBInstance.create("/tmp/opencode/debug.duckdb", { access_mode: "READ_ONLY" });
const conn = await inst.connect();
const r = await conn.runAndReadAll('select name, "spanType", "entityId", "entityName" from span_events order by rowid desc limit 25');
for (const row of r.getRows()) console.log(row.join(" | "));
