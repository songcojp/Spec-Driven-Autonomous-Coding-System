import { randomUUID } from "node:crypto";
import { runSqlite } from "./sqlite.ts";

export type CliSubagentEvent = {
  id: string;
  runId: string;
  status: "created" | "running" | "completed" | "review_needed" | "blocked" | "failed";
  message: string;
  evidence?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  createdAt: string;
};

export type RecordCliSubagentEventInput = Omit<CliSubagentEvent, "id" | "createdAt"> & {
  now?: Date;
};

export function recordCliSubagentEvent(dbPath: string, input: RecordCliSubagentEventInput): CliSubagentEvent {
  const event: CliSubagentEvent = {
    id: randomUUID(),
    runId: input.runId,
    status: input.status,
    message: input.message,
    evidence: input.evidence,
    tokenUsage: input.tokenUsage,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO subagent_events (id, run_id, status, message, evidence, token_usage_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        event.id,
        event.runId,
        event.status,
        event.message,
        event.evidence ?? null,
        JSON.stringify(event.tokenUsage ?? {}),
        event.createdAt,
      ],
    },
  ]);
  return event;
}
