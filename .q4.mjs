import { DuckDBInstance } from "@duckdb/node-api";
const inst = await DuckDBInstance.create("/tmp/opencode/debug.duckdb", { access_mode: "READ_ONLY" });
const conn = await inst.connect();
const t = await conn.runAndReadAll("select table_name from information_schema.tables");
console.log("TABLES:", t.getRows().map((x)=>x[0]).join(", "));
