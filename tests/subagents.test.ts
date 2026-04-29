import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import { recordCliSubagentEvent } from "../src/subagents.ts";

test("subagent schema keeps only CLI event observation state", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const tables = listTables(dbPath);
  assert.equal(tables.includes("subagent_events"), true);
  assert.equal(tables.includes("agent_run_contracts"), false);
  assert.equal(tables.includes("context_slice_refs"), false);
  assert.equal(tables.includes("result_merges"), false);
});

test("CLI subagent events can be recorded without custom context slices", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const event = recordCliSubagentEvent(dbPath, {
    runId: "RUN-CLI",
    status: "running",
    message: "CLI delegated implementation.",
    evidence: "Delegation handled by Codex CLI.",
    tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    now: new Date("2026-04-29T12:00:00.000Z"),
  });

  const rows = runSqlite(dbPath, [], [
    { name: "events", sql: "SELECT * FROM subagent_events WHERE id = ?", params: [event.id] },
  ]).queries.events;

  assert.equal(rows.length, 1);
  assert.equal(rows[0].run_id, "RUN-CLI");
  assert.equal(rows[0].status, "running");
  assert.deepEqual(JSON.parse(String(rows[0].token_usage_json)), { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "subagents-")), ".autobuild", "autobuild.db");
}
