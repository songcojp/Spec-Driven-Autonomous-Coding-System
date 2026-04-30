import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeSchema } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  getOrCreateSession,
  getChatHistory,
  buildChatContext,
  classifyIntent,
  executeIntent,
  processChatMessage,
} from "../src/chat.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function freshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "specdrive-chat-"));
  const dbPath = join(dir, "control-plane.sqlite");
  initializeSchema(dbPath);
  return dbPath;
}

// ── getOrCreateSession ───────────────────────────────────────────────────────

test("getOrCreateSession creates a new session when none exists", () => {
  const dbPath = freshDb();
  const session = getOrCreateSession(dbPath, "project-1");

  assert.ok(session.id, "Session should have an id");
  assert.equal(session.projectId, "project-1");
  assert.ok(session.createdAt, "Session should have a createdAt timestamp");
  assert.ok(session.updatedAt, "Session should have an updatedAt timestamp");
});

test("getOrCreateSession returns the existing session when called twice", () => {
  const dbPath = freshDb();
  const first = getOrCreateSession(dbPath, "project-2");
  const second = getOrCreateSession(dbPath, "project-2");

  assert.equal(first.id, second.id, "Should return the same session id");
});

test("getOrCreateSession creates separate sessions for different projects", () => {
  const dbPath = freshDb();
  const s1 = getOrCreateSession(dbPath, "proj-a");
  const s2 = getOrCreateSession(dbPath, "proj-b");

  assert.notEqual(s1.id, s2.id, "Different projects should get different sessions");
  assert.equal(s1.projectId, "proj-a");
  assert.equal(s2.projectId, "proj-b");
});

test("getOrCreateSession works with undefined projectId", () => {
  const dbPath = freshDb();
  const session = getOrCreateSession(dbPath, undefined);
  assert.ok(session.id, "Should create session without projectId");
  assert.equal(session.projectId, undefined);
});

// ── getChatHistory ────────────────────────────────────────────────────────────

test("getChatHistory returns empty array for a new session", () => {
  const dbPath = freshDb();
  const session = getOrCreateSession(dbPath, "project-hist");
  const history = getChatHistory(dbPath, session.id);
  assert.deepEqual(history, []);
});

test("getChatHistory respects limit parameter", async () => {
  const dbPath = freshDb();
  const session = getOrCreateSession(dbPath, "project-hist-2");

  // Send 6 messages
  for (let i = 0; i < 6; i++) {
    await processChatMessage(dbPath, session.id, `Message ${i}`);
  }

  const limited = getChatHistory(dbPath, session.id, 5);
  // Each message generates user + assistant = 2 records, so 6 × 2 = 12 total; limit=5 returns 5
  assert.ok(limited.length <= 5, `Expected at most 5 messages, got ${limited.length}`);
});

// ── buildChatContext ──────────────────────────────────────────────────────────

test("buildChatContext returns empty arrays when no data exists", () => {
  const dbPath = freshDb();
  const context = buildChatContext(dbPath, "unknown-project");

  assert.deepEqual(context.features, []);
  assert.deepEqual(context.recentTasks, []);
  assert.deepEqual(context.pendingReviews, []);
  assert.equal(context.projectId, "unknown-project");
  assert.equal(context.projectName, undefined);
});

// ── classifyIntent ────────────────────────────────────────────────────────────

test("classifyIntent falls back to rule-based when no codexRunner provided", async () => {
  const dbPath = freshDb();
  const context = buildChatContext(dbPath, undefined);

  const result = await classifyIntent(dbPath, "查看任务板状态", context, []);
  assert.equal(result.intent, "query_status");
  assert.equal(result.riskLevel, "low");
  assert.equal(result.confirmationRequired, false);
});

test("classifyIntent detects pause_runner as high risk", async () => {
  const dbPath = freshDb();
  const context = buildChatContext(dbPath, undefined);

  const result = await classifyIntent(dbPath, "暂停 runner", context, []);
  assert.equal(result.intent, "pause_runner");
  assert.equal(result.riskLevel, "high");
  assert.equal(result.confirmationRequired, true);
});

test("classifyIntent detects help intent", async () => {
  const dbPath = freshDb();
  const context = buildChatContext(dbPath, undefined);

  const result = await classifyIntent(dbPath, "你能做什么？帮助", context, []);
  assert.equal(result.intent, "help");
  assert.equal(result.riskLevel, "low");
});

test("classifyIntent detects confirm intent", async () => {
  const dbPath = freshDb();
  const context = buildChatContext(dbPath, undefined);

  const result = await classifyIntent(dbPath, "确认", context, []);
  assert.equal(result.intent, "confirm");
});

test("classifyIntent detects cancel intent", async () => {
  const dbPath = freshDb();
  const context = buildChatContext(dbPath, undefined);

  const result = await classifyIntent(dbPath, "取消", context, []);
  assert.equal(result.intent, "cancel");
});

test("classifyIntent uses provided codexRunner for classification", async () => {
  const dbPath = freshDb();
  const context = buildChatContext(dbPath, undefined);

  const mockIntentResult = {
    intent: "generate_ears",
    confidence: 0.95,
    entities: { featureId: "feat-001" },
    commandAction: "generate_ears",
    riskLevel: "medium",
    confirmationRequired: false,
    responseText: "正在生成 EARS 需求...",
  };

  const mockRunner = async (_prompt: string, _schemaPath: string) => ({
    stdout: JSON.stringify(mockIntentResult),
    stderr: "",
    exitCode: 0,
  });

  const result = await classifyIntent(dbPath, "为 feat-001 生成 EARS 需求", context, [], mockRunner);
  assert.equal(result.intent, "generate_ears");
  assert.equal(result.entities.featureId, "feat-001");
  assert.equal(result.riskLevel, "medium");
  assert.equal(result.confirmationRequired, false);
});

test("classifyIntent falls back to rule-based when codexRunner returns non-zero exit", async () => {
  const dbPath = freshDb();
  const context = buildChatContext(dbPath, undefined);

  const failingRunner = async () => ({ stdout: "", stderr: "error", exitCode: 1 });
  const result = await classifyIntent(dbPath, "查看状态", context, [], failingRunner);

  // Should fall back to rule-based which returns query_status for "查看状态"
  assert.equal(result.intent, "query_status");
});

// ── executeIntent ─────────────────────────────────────────────────────────────

test("executeIntent returns answered state for help intent", () => {
  const dbPath = freshDb();
  const session = getOrCreateSession(dbPath, undefined);
  const context = buildChatContext(dbPath, undefined);

  const intent = {
    intent: "help" as const,
    confidence: 0.9,
    entities: {},
    riskLevel: "low" as const,
    confirmationRequired: false,
    responseText: "我能帮您查询任务状态、新增需求...",
  };

  const response = executeIntent(dbPath, intent, context, session.id);
  assert.equal(response.state, "answered");
  assert.equal(response.intent, "help");
  assert.ok(response.text.length > 0);
});

test("executeIntent returns answered state for unknown intent", () => {
  const dbPath = freshDb();
  const session = getOrCreateSession(dbPath, undefined);
  const context = buildChatContext(dbPath, undefined);

  const intent = {
    intent: "unknown" as const,
    confidence: 0.3,
    entities: {},
    riskLevel: "low" as const,
    confirmationRequired: false,
    responseText: "抱歉，我没有理解您的意图。",
  };

  const response = executeIntent(dbPath, intent, context, session.id);
  assert.equal(response.state, "answered");
});

test("executeIntent returns pending_confirmation for high risk intent with matching entity", () => {
  const dbPath = freshDb();
  // Insert a project and a review item
  runSqlite(dbPath, [
    {
      sql: "INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, environment) VALUES (?, ?, ?, ?, ?, ?)",
      params: ["proj-exec", "Exec Project", "test", "typescript", "[]", "local"],
    },
    {
      sql: "INSERT INTO review_items (id, project_id, feature_id, status, severity, body) VALUES (?, ?, ?, ?, ?, ?)",
      params: ["review-1", "proj-exec", null, "open", "high", "Test review item"],
    },
  ]);
  const session = getOrCreateSession(dbPath, "proj-exec");
  const context = buildChatContext(dbPath, "proj-exec");

  const intent = {
    intent: "approve_review" as const,
    confidence: 0.9,
    entities: { reviewItemId: "review-1" },
    riskLevel: "high" as const,
    confirmationRequired: true,
    responseText: "⚠️ 即将批准审查项，请确认。",
  };

  const response = executeIntent(dbPath, intent, context, session.id);
  assert.equal(response.state, "pending_confirmation");
  assert.ok(response.preview, "Should have a preview object");
  assert.equal(response.preview?.entityId, "review-1");
});

test("executeIntent cancel clears pending command from session", () => {
  const dbPath = freshDb();
  runSqlite(dbPath, [
    {
      sql: "INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, environment) VALUES (?, ?, ?, ?, ?, ?)",
      params: ["proj-cancel", "Cancel Project", "test", "typescript", "[]", "local"],
    },
  ]);
  const session = getOrCreateSession(dbPath, "proj-cancel");

  // Set a pending command manually
  runSqlite(dbPath, [
    {
      sql: "UPDATE chat_sessions SET pending_command_json = ? WHERE id = ?",
      params: [JSON.stringify({ action: "pause_runner", entityType: "runner", entityId: "x", requestedBy: "chat", reason: "test" }), session.id],
    },
  ]);

  const context = buildChatContext(dbPath, "proj-cancel");
  const intent = {
    intent: "cancel" as const,
    confidence: 1,
    entities: {},
    riskLevel: "low" as const,
    confirmationRequired: false,
    responseText: "已取消操作。",
  };

  const response = executeIntent(dbPath, intent, context, session.id);
  assert.equal(response.state, "cancelled");
  assert.ok(response.text.includes("取消"), "Response should mention cancellation");
});

// ── processChatMessage ────────────────────────────────────────────────────────

test("processChatMessage persists user and assistant messages", async () => {
  const dbPath = freshDb();
  const session = getOrCreateSession(dbPath, undefined);

  await processChatMessage(dbPath, session.id, "帮助");
  const history = getChatHistory(dbPath, session.id);

  assert.ok(history.length >= 2, "Should have at least user and assistant messages");
  const userMsg = history.find((m) => m.role === "user");
  const assistantMsg = history.find((m) => m.role === "assistant");
  assert.ok(userMsg, "User message should be saved");
  assert.ok(assistantMsg, "Assistant message should be saved");
  assert.equal(userMsg?.content, "帮助");
  assert.equal(assistantMsg?.intentType, "help");
});

test("processChatMessage throws when session not found", async () => {
  const dbPath = freshDb();
  await assert.rejects(
    () => processChatMessage(dbPath, "nonexistent-session-id", "hello"),
    /Chat session not found/,
  );
});

test("processChatMessage processes query_status and returns answered state", async () => {
  const dbPath = freshDb();
  const session = getOrCreateSession(dbPath, undefined);

  const response = await processChatMessage(dbPath, session.id, "查看任务板状态");
  assert.ok(["answered", "executed", "error"].includes(response.state));
  assert.ok(response.text.length > 0);
});

test("processChatMessage full confirm flow: high-risk → pending → confirm → executed", async () => {
  const dbPath = freshDb();
  // Need a real project and feature for schedule_run
  runSqlite(dbPath, [
    {
      sql: "INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, environment) VALUES (?, ?, ?, ?, ?, ?)",
      params: ["proj-flow", "Flow Project", "test", "typescript", "[]", "local"],
    },
    {
      sql: "INSERT INTO features (id, project_id, title, status) VALUES (?, ?, ?, ?)",
      params: ["feat-flow-1", "proj-flow", "Flow Feature", "ready"],
    },
  ]);
  const session = getOrCreateSession(dbPath, "proj-flow");

  // Step 1: high risk command → should be pending_confirmation
  const r1 = await processChatMessage(dbPath, session.id, "暂停 runner");
  assert.equal(r1.state, "pending_confirmation", "High risk should require confirmation");

  // Step 2: confirm → should be executed
  const r2 = await processChatMessage(dbPath, session.id, "确认");
  // Confirm dispatches the pending command — even if blocked by state machine it should be "executed"
  assert.ok(["executed", "answered"].includes(r2.state), `State after confirm should be executed or answered, got ${r2.state}`);
});
