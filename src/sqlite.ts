import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { BootstrapError } from "./errors.ts";

export type SqlStatement = {
  sql: string;
  params?: unknown[];
};

export type SqlQuery = {
  name: string;
  sql: string;
  params?: unknown[];
};

export type SqliteResult = {
  changes: number;
  queries: Record<string, Record<string, unknown>[]>;
};

export function runSqlite(
  dbPath: string,
  statements: SqlStatement[] = [],
  queries: SqlQuery[] = [],
): SqliteResult {
  mkdirSync(dirname(dbPath), { recursive: true });

  const payload = JSON.stringify({ dbPath, statements, queries });
  const python = `
import json
import sqlite3
import sys

payload = json.loads(sys.stdin.read())
connection = sqlite3.connect(payload["dbPath"])
connection.row_factory = sqlite3.Row
changes = 0
queries = {}

try:
    for statement in payload.get("statements", []):
        cursor = connection.execute(statement["sql"], statement.get("params", []))
        if cursor.rowcount and cursor.rowcount > 0:
            changes += cursor.rowcount
    connection.commit()

    for query in payload.get("queries", []):
        cursor = connection.execute(query["sql"], query.get("params", []))
        queries[query["name"]] = [dict(row) for row in cursor.fetchall()]
except Exception as exc:
    connection.rollback()
    print(str(exc), file=sys.stderr)
    sys.exit(1)
finally:
    connection.close()

print(json.dumps({"changes": changes, "queries": queries}))
`;

  const result = spawnSync("python3", ["-c", python], {
    input: payload,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  });

  if (result.status !== 0) {
    throw new BootstrapError("sqlite", "SQLite operation failed", {
      dbPath,
      stderr: result.stderr.trim(),
      stdout: result.stdout.trim(),
    });
  }

  try {
    return JSON.parse(result.stdout) as SqliteResult;
  } catch (error) {
    throw new BootstrapError("sqlite", "SQLite adapter returned invalid JSON", {
      stdout: result.stdout,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
