import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { runSqlite } from "./sqlite.ts";
import { submitConsoleCommand, buildDashboardBoardView, buildReviewCenterView } from "./product-console.ts";
import type { SchedulerClient } from "./scheduler.ts";
import type {
  ChatAssistantResponse,
  ChatIntentResult,
  ChatIntentType,
  ChatMessage,
  ChatRiskLevel,
  ChatSession,
} from "./schema.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatContext = {
  projectId: string | undefined;
  projectName: string | undefined;
  features: Array<{ id: string; title: string; status: string }>;
  recentTasks: Array<{ id: string; title: string; status: string; featureId: string }>;
  pendingReviews: Array<{ id: string; body: string; severity: string }>;
};

type HistoryEntry = { role: string; content: string };

// ---------------------------------------------------------------------------
// Intent → Risk mapping
// ---------------------------------------------------------------------------

const INTENT_RISK: Record<ChatIntentType, ChatRiskLevel> = {
  query_status: "low",
  query_review: "low",
  help: "low",
  unknown: "low",
  add_requirement: "medium",
  change_requirement: "medium",
  generate_ears: "medium",
  generate_hld: "medium",
  schedule_run: "high",
  pause_runner: "high",
  resume_runner: "high",
  approve_review: "high",
  reject_review: "high",
  confirm: "low",
  cancel: "low",
};

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export function buildChatContext(dbPath: string, projectId: string | undefined): ChatContext {
  const result = runSqlite(dbPath, [], [
    {
      name: "project",
      sql: "SELECT id, name FROM projects WHERE id = ? LIMIT 1",
      params: projectId ? [projectId] : ["__none__"],
    },
    {
      name: "features",
      sql: projectId
        ? "SELECT id, title, status FROM features WHERE project_id = ? ORDER BY updated_at DESC LIMIT 20"
        : "SELECT id, title, status FROM features ORDER BY updated_at DESC LIMIT 20",
      params: projectId ? [projectId] : [],
    },
    {
      name: "tasks",
      sql: projectId
        ? `SELECT t.id, t.title, t.status, t.feature_id
           FROM tasks t
           JOIN features f ON f.id = t.feature_id
           WHERE f.project_id = ?
           ORDER BY t.updated_at DESC LIMIT 20`
        : "SELECT id, title, status, feature_id FROM tasks ORDER BY updated_at DESC LIMIT 20",
      params: projectId ? [projectId] : [],
    },
    {
      name: "reviews",
      sql: projectId
        ? "SELECT id, body, severity FROM review_items WHERE project_id = ? AND status = 'open' LIMIT 10"
        : "SELECT id, body, severity FROM review_items WHERE status = 'open' LIMIT 10",
      params: projectId ? [projectId] : [],
    },
  ]);

  const projectRow = result.queries.project[0];
  return {
    projectId,
    projectName: projectRow ? String(projectRow.name) : undefined,
    features: result.queries.features.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
    })),
    recentTasks: result.queries.tasks.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
      featureId: String(row.feature_id ?? ""),
    })),
    pendingReviews: result.queries.reviews.map((row) => ({
      id: String(row.id),
      body: String(row.body),
      severity: String(row.severity),
    })),
  };
}

// ---------------------------------------------------------------------------
// Intent classification prompt
// ---------------------------------------------------------------------------

function buildClassificationPrompt(
  userMessage: string,
  context: ChatContext,
  history: HistoryEntry[],
): string {
  const recentHistory = history.slice(-5).map((m) => `${m.role}: ${m.content}`).join("\n");
  const featuresText = context.features.length
    ? context.features.map((f) => `  - ${f.id}: "${f.title}" [${f.status}]`).join("\n")
    : "  (none)";
  const tasksText = context.recentTasks.length
    ? context.recentTasks.slice(0, 10).map((t) => `  - ${t.id}: "${t.title}" [${t.status}] (feature: ${t.featureId})`).join("\n")
    : "  (none)";
  const reviewsText = context.pendingReviews.length
    ? context.pendingReviews.map((r) => `  - ${r.id}: "${r.body.slice(0, 80)}" [${r.severity}]`).join("\n")
    : "  (none)";

  return [
    "You are the SpecDrive AutoBuild assistant. Classify the user's intent from the message below.",
    "",
    "## Project Context",
    `Project ID: ${context.projectId ?? "(none)"}`,
    `Project Name: ${context.projectName ?? "(none)"}`,
    "",
    "Features:",
    featuresText,
    "",
    "Recent Tasks:",
    tasksText,
    "",
    "Pending Reviews:",
    reviewsText,
    "",
    "## Conversation History (last 5 messages)",
    recentHistory || "(none)",
    "",
    "## User Message",
    userMessage,
    "",
    "## Instructions",
    "Return a JSON object matching this schema exactly:",
    JSON.stringify({
      type: "object",
      required: ["intent", "confidence", "entities", "riskLevel", "confirmationRequired", "responseText"],
      properties: {
        intent: {
          type: "string",
          enum: [
            "query_status", "query_review", "add_requirement", "change_requirement",
            "schedule_run", "pause_runner", "resume_runner", "approve_review", "reject_review",
            "generate_ears", "generate_hld", "confirm", "cancel", "help", "unknown",
          ],
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        entities: {
          type: "object",
          properties: {
            featureId: { type: "string" },
            taskId: { type: "string" },
            reviewItemId: { type: "string" },
            requirementText: { type: "string" },
            changeDescription: { type: "string" },
          },
        },
        commandAction: { type: "string" },
        riskLevel: { type: "string", enum: ["low", "medium", "high"] },
        confirmationRequired: { type: "boolean" },
        responseText: { type: "string" },
      },
    }, null, 2),
    "",
    "Intent mapping:",
    "- query_status: asking about feature, task, or board status",
    "- query_review: asking about reviews, approvals, pending items",
    "- add_requirement: wants to add a new requirement to a feature",
    "- change_requirement: wants to change/update an existing requirement",
    "- schedule_run: wants to schedule a task or feature run",
    "- pause_runner: wants to pause the runner",
    "- resume_runner: wants to resume the runner",
    "- approve_review: wants to approve a review item",
    "- reject_review: wants to reject a review item",
    "- generate_ears: wants to generate EARS requirements for a feature",
    "- generate_hld: wants to generate HLD for a feature",
    "- confirm: user is confirming a previously proposed action",
    "- cancel: user is cancelling a previously proposed action",
    "- help: user wants to know what the assistant can do",
    "- unknown: cannot determine intent",
    "",
    "Risk levels: low=read-only/safe, medium=write but reversible, high=state-change or runner control",
    "confirmationRequired must be true when riskLevel is high.",
    "responseText should be a brief friendly Chinese or English reply matching the user's language.",
    "Extract entity IDs from context only — do not invent IDs.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Intent classification (calls Codex CLI)
// ---------------------------------------------------------------------------

export async function classifyIntent(
  dbPath: string,
  userMessage: string,
  context: ChatContext,
  history: HistoryEntry[],
  codexRunner?: (prompt: string, outputSchemaPath: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
): Promise<ChatIntentResult> {
  const prompt = buildClassificationPrompt(userMessage, context, history);

  // If no runner is provided, fall back to rule-based classification
  if (!codexRunner) {
    return ruleBasedClassification(userMessage);
  }

  // Write output schema for intent result
  const outputSchemaPath = join(tmpdir(), `chat-intent-schema-${randomUUID()}.json`);
  const outputSchema = {
    type: "object",
    required: ["intent", "confidence", "entities", "riskLevel", "confirmationRequired", "responseText"],
    properties: {
      intent: { type: "string" },
      confidence: { type: "number" },
      entities: { type: "object" },
      commandAction: { type: "string" },
      riskLevel: { type: "string" },
      confirmationRequired: { type: "boolean" },
      responseText: { type: "string" },
    },
  };
  writeFileSync(outputSchemaPath, JSON.stringify(outputSchema));

  try {
    const result = await codexRunner(prompt, outputSchemaPath);
    if (result.exitCode !== 0) {
      return ruleBasedClassification(userMessage);
    }

    // Parse JSON output from Codex — look for JSON in stdout
    const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return ruleBasedClassification(userMessage);
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<ChatIntentResult>;
    const intent = (parsed.intent ?? "unknown") as ChatIntentType;
    const riskLevel = INTENT_RISK[intent] ?? "low";
    return {
      intent,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.8,
      entities: parsed.entities ?? {},
      commandAction: parsed.commandAction,
      riskLevel,
      confirmationRequired: riskLevel === "high",
      responseText: parsed.responseText ?? getDefaultResponseText(intent),
    };
  } catch {
    return ruleBasedClassification(userMessage);
  }
}

// ---------------------------------------------------------------------------
// Rule-based fallback classifier
// ---------------------------------------------------------------------------

function ruleBasedClassification(message: string): ChatIntentResult {
  const lower = message.toLowerCase();

  // Confirm/cancel
  if (/^(确认|confirm|yes|是的|好的|执行|proceed)\s*$/i.test(lower.trim())) {
    return makeResult("confirm", "low", message);
  }
  if (/^(取消|cancel|no|不|不要|放弃)\s*$/i.test(lower.trim())) {
    return makeResult("cancel", "low", message);
  }

  // Help
  if (lower.includes("help") || lower.includes("帮助") || lower.includes("能做什么") || lower.includes("功能")) {
    return makeResult("help", "low", message);
  }

  // Runner control
  if (lower.includes("暂停") || lower.includes("pause")) {
    return makeResult("pause_runner", "high", message);
  }
  if (lower.includes("恢复") || lower.includes("resume")) {
    return makeResult("resume_runner", "high", message);
  }

  // Scheduling
  if ((lower.includes("调度") || lower.includes("schedule") || lower.includes("运行") || lower.includes("run")) && !lower.includes("状态")) {
    return makeResult("schedule_run", "high", message);
  }

  // Review operations
  if (lower.includes("批准") || lower.includes("approve")) {
    return makeResult("approve_review", "high", message);
  }
  if (lower.includes("拒绝") || lower.includes("reject")) {
    return makeResult("reject_review", "high", message);
  }

  // EARS / HLD generation
  if (lower.includes("ears") || lower.includes("需求生成") || lower.includes("生成需求")) {
    return makeResult("generate_ears", "medium", message);
  }
  if (lower.includes("hld") || lower.includes("架构") || lower.includes("设计文档")) {
    return makeResult("generate_hld", "medium", message);
  }

  // Requirement management
  if (lower.includes("新增需求") || lower.includes("add requirement") || lower.includes("新建需求")) {
    return makeResult("add_requirement", "medium", message);
  }
  if (lower.includes("修改需求") || lower.includes("变更需求") || lower.includes("update requirement") || lower.includes("change requirement")) {
    return makeResult("change_requirement", "medium", message);
  }

  // Query
  if (lower.includes("状态") || lower.includes("status") || lower.includes("查看") || lower.includes("查询") || lower.includes("任务板")) {
    return makeResult("query_status", "low", message);
  }
  if (lower.includes("review") || lower.includes("审查") || lower.includes("审核") || lower.includes("待审")) {
    return makeResult("query_review", "low", message);
  }

  return makeResult("unknown", "low", message);
}

function makeResult(intent: ChatIntentType, risk: ChatRiskLevel, message: string): ChatIntentResult {
  return {
    intent,
    confidence: 0.7,
    entities: {},
    riskLevel: risk,
    confirmationRequired: risk === "high",
    responseText: getDefaultResponseText(intent),
  };
}

function getDefaultResponseText(intent: ChatIntentType): string {
  const map: Record<ChatIntentType, string> = {
    query_status: "正在查询任务状态...",
    query_review: "正在查询审查列表...",
    add_requirement: "已识别新增需求意图，正在准备执行...",
    change_requirement: "已识别变更需求意图，正在准备执行...",
    schedule_run: "⚠️ 即将调度任务，请确认后执行。",
    pause_runner: "⚠️ 即将暂停 Runner，请确认后执行。",
    resume_runner: "⚠️ 即将恢复 Runner，请确认后执行。",
    approve_review: "⚠️ 即将批准审查项，请确认后执行。",
    reject_review: "⚠️ 即将拒绝审查项，请确认后执行。",
    generate_ears: "正在为该 Feature 生成 EARS 需求...",
    generate_hld: "正在为该 Feature 生成 HLD...",
    confirm: "正在执行已确认的操作...",
    cancel: "已取消操作。",
    help: "我能帮您：查询任务/Feature 状态、新增或变更需求、调度运行、暂停/恢复 Runner、批准或拒绝审查、生成 EARS 需求和 HLD。",
    unknown: "抱歉，我没有理解您的意图。请尝试更具体的描述，例如：「查看任务板状态」或「为 feat-001 新增需求」。",
  };
  return map[intent];
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

export function executeIntent(
  dbPath: string,
  intent: ChatIntentResult,
  context: ChatContext,
  sessionId: string,
  options: { scheduler?: SchedulerClient } = {},
): ChatAssistantResponse {
  const messageId = randomUUID();

  // Help / unknown — text-only responses
  if (intent.intent === "help" || intent.intent === "unknown") {
    return {
      messageId,
      state: "answered",
      text: intent.responseText,
      intent: intent.intent,
    };
  }

  // Cancel — clear pending command
  if (intent.intent === "cancel") {
    runSqlite(dbPath, [
      {
        sql: "UPDATE chat_sessions SET pending_command_json = NULL, updated_at = datetime('now') WHERE id = ?",
        params: [sessionId],
      },
    ]);
    return {
      messageId,
      state: "cancelled",
      text: "已取消操作。",
      intent: "cancel",
    };
  }

  // Confirm — execute pending command
  if (intent.intent === "confirm") {
    const session = getSession(dbPath, sessionId);
    if (!session?.pendingCommandJson) {
      return {
        messageId,
        state: "answered",
        text: "当前没有待确认的操作。",
        intent: "confirm",
      };
    }
    try {
      const pending = JSON.parse(session.pendingCommandJson) as Parameters<typeof submitConsoleCommand>[1];
      const receipt = submitConsoleCommand(dbPath, pending, options);
      // Clear pending
      runSqlite(dbPath, [
        {
          sql: "UPDATE chat_sessions SET pending_command_json = NULL, updated_at = datetime('now') WHERE id = ?",
          params: [sessionId],
        },
      ]);
      return {
        messageId,
        state: "executed",
        text: receipt.status === "accepted"
          ? `✅ 操作已执行：${receipt.action} (${receipt.entityId})`
          : `❌ 操作被拦截：${receipt.blockedReasons?.join("; ") ?? "unknown"}`,
        intent: "confirm",
        receipt: {
          action: receipt.action,
          status: receipt.status,
          runId: receipt.runId,
          schedulerJobId: receipt.schedulerJobId,
          blockedReasons: receipt.blockedReasons,
        },
      };
    } catch (error) {
      return {
        messageId,
        state: "error",
        text: `执行失败：${error instanceof Error ? error.message : String(error)}`,
        intent: "confirm",
      };
    }
  }

  // Query intents — read-only
  if (intent.intent === "query_status") {
    try {
      const board = buildDashboardBoardView(dbPath, context.projectId);
      const total = board.tasks.length;
      const done = board.tasks.filter((t) => t.status === "done" || t.status === "delivered").length;
      const running = board.tasks.filter((t) => t.status === "running" || t.status === "checking").length;
      const blocked = board.tasks.filter((t) => t.status === "blocked").length;
      return {
        messageId,
        state: "answered",
        text: `任务板状态：共 ${total} 个任务，已完成 ${done}，运行中 ${running}，阻塞 ${blocked}。`,
        intent: "query_status",
      };
    } catch {
      return { messageId, state: "answered", text: "暂时无法获取任务状态。", intent: "query_status" };
    }
  }

  if (intent.intent === "query_review") {
    try {
      const reviews = buildReviewCenterView(dbPath, context.projectId);
      const open = reviews.reviewItems.filter((r) => r.status === "open").length;
      return {
        messageId,
        state: "answered",
        text: open > 0
          ? `待审查项：${open} 个，请前往「审计中心」查看详情。`
          : "当前没有待审查项。",
        intent: "query_review",
      };
    } catch {
      return { messageId, state: "answered", text: "暂时无法获取审查列表。", intent: "query_review" };
    }
  }

  // MEDIUM risk: execute immediately
  if (intent.riskLevel === "medium") {
    return executeMediumRiskIntent(dbPath, intent, context, messageId, options);
  }

  // HIGH risk: store pending command, return preview
  return buildPendingConfirmation(dbPath, intent, context, sessionId, messageId);
}

function executeMediumRiskIntent(
  dbPath: string,
  intent: ChatIntentResult,
  context: ChatContext,
  messageId: string,
  options: { scheduler?: SchedulerClient },
): ChatAssistantResponse {
  try {
    const commandInput = buildCommandInput(intent, context);
    if (!commandInput) {
      return {
        messageId,
        state: "answered",
        text: `无法识别操作目标。请指定 Feature ID，例如：「为 feat-001 生成 EARS 需求」。`,
        intent: intent.intent,
      };
    }
    const receipt = submitConsoleCommand(dbPath, commandInput, options);
    return {
      messageId,
      state: "executed",
      text: receipt.status === "accepted"
        ? `✅ 已提交：${receipt.action} (${receipt.entityId})`
        : `❌ 被拦截：${receipt.blockedReasons?.join("; ") ?? "unknown"}`,
      intent: intent.intent,
      receipt: {
        action: receipt.action,
        status: receipt.status,
        runId: receipt.runId,
        schedulerJobId: receipt.schedulerJobId,
        blockedReasons: receipt.blockedReasons,
      },
    };
  } catch (error) {
    return {
      messageId,
      state: "error",
      text: `执行失败：${error instanceof Error ? error.message : String(error)}`,
      intent: intent.intent,
    };
  }
}

function buildPendingConfirmation(
  dbPath: string,
  intent: ChatIntentResult,
  context: ChatContext,
  sessionId: string,
  messageId: string,
): ChatAssistantResponse {
  const commandInput = buildCommandInput(intent, context);
  if (!commandInput) {
    return {
      messageId,
      state: "answered",
      text: `无法识别操作目标。请指定具体 Feature 或 Review ID。`,
      intent: intent.intent,
    };
  }

  // Store pending command in session
  runSqlite(dbPath, [
    {
      sql: "UPDATE chat_sessions SET pending_command_json = ?, updated_at = datetime('now') WHERE id = ?",
      params: [JSON.stringify(commandInput), sessionId],
    },
  ]);

  const actionLabel: Record<string, string> = {
    schedule_run: "调度任务",
    pause_runner: "暂停 Runner",
    resume_runner: "恢复 Runner",
    approve_review: "批准审查",
    reject_review: "拒绝审查",
  };

  return {
    messageId,
    state: "pending_confirmation",
    text: `⚠️ 即将执行【${actionLabel[intent.intent] ?? intent.intent}】，请输入「确认」继续，或「取消」放弃。`,
    intent: intent.intent,
    preview: {
      action: commandInput.action,
      entityType: commandInput.entityType,
      entityId: commandInput.entityId,
      payloadSummary: JSON.stringify(commandInput.payload ?? {}).slice(0, 200),
    },
  };
}

function buildCommandInput(
  intent: ChatIntentResult,
  context: ChatContext,
): Parameters<typeof submitConsoleCommand>[1] | undefined {
  const projectId = context.projectId ?? "";
  const { entities } = intent;

  switch (intent.intent) {
    case "schedule_run": {
      const featureId = entities.featureId ?? context.features[0]?.id;
      if (!featureId) return undefined;
      return {
        action: "schedule_run",
        entityType: "feature",
        entityId: featureId,
        requestedBy: "chat",
        reason: "Requested via chat interface",
        payload: { projectId, featureId },
      };
    }
    case "pause_runner":
      return {
        action: "pause_runner",
        entityType: "runner",
        entityId: projectId || "default",
        requestedBy: "chat",
        reason: "Requested via chat interface",
        payload: { projectId },
      };
    case "resume_runner":
      return {
        action: "resume_runner",
        entityType: "runner",
        entityId: projectId || "default",
        requestedBy: "chat",
        reason: "Requested via chat interface",
        payload: { projectId },
      };
    case "approve_review": {
      const reviewItemId = entities.reviewItemId ?? context.pendingReviews[0]?.id;
      if (!reviewItemId) return undefined;
      return {
        action: "approve_review",
        entityType: "review_item",
        entityId: reviewItemId,
        requestedBy: "chat",
        reason: "Approved via chat interface",
        payload: { projectId, decision: "approve_continue" },
      };
    }
    case "reject_review": {
      const reviewItemId = entities.reviewItemId ?? context.pendingReviews[0]?.id;
      if (!reviewItemId) return undefined;
      return {
        action: "approve_review",
        entityType: "review_item",
        entityId: reviewItemId,
        requestedBy: "chat",
        reason: "Rejected via chat interface",
        payload: { projectId, decision: "reject" },
      };
    }
    case "generate_ears": {
      const featureId = entities.featureId ?? context.features.find((f) => f.status === "ready")?.id ?? context.features[0]?.id;
      if (!featureId) return undefined;
      return {
        action: "generate_ears",
        entityType: "feature",
        entityId: featureId,
        requestedBy: "chat",
        reason: "Generate EARS requirements via chat",
        payload: { projectId, featureId },
      };
    }
    case "generate_hld": {
      const featureId = entities.featureId ?? context.features.find((f) => f.status === "ready")?.id ?? context.features[0]?.id;
      if (!featureId) return undefined;
      return {
        action: "generate_hld",
        entityType: "feature",
        entityId: featureId,
        requestedBy: "chat",
        reason: "Generate HLD via chat",
        payload: { projectId, featureId },
      };
    }
    case "add_requirement": {
      const featureId = entities.featureId ?? context.features[0]?.id;
      if (!featureId) return undefined;
      return {
        action: "update_spec",
        entityType: "feature",
        entityId: featureId,
        requestedBy: "chat",
        reason: `Add requirement: ${entities.requirementText ?? "new requirement"}`,
        payload: {
          projectId,
          featureId,
          requirementText: entities.requirementText ?? "",
          changeType: "add_requirement",
        },
      };
    }
    case "change_requirement": {
      const featureId = entities.featureId ?? context.features[0]?.id;
      if (!featureId) return undefined;
      return {
        action: "write_spec_evolution",
        entityType: "feature",
        entityId: featureId,
        requestedBy: "chat",
        reason: `Change requirement: ${entities.changeDescription ?? "change"}`,
        payload: {
          projectId,
          featureId,
          changeDescription: entities.changeDescription ?? entities.requirementText ?? "",
        },
      };
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

function getSession(dbPath: string, sessionId: string): ChatSession | undefined {
  const result = runSqlite(dbPath, [], [
    { name: "session", sql: "SELECT * FROM chat_sessions WHERE id = ? LIMIT 1", params: [sessionId] },
  ]);
  const row = result.queries.session[0];
  if (!row) return undefined;
  return rowToSession(row);
}

export function getOrCreateSession(dbPath: string, projectId: string | undefined): ChatSession {
  const existing = runSqlite(dbPath, [], [
    {
      name: "session",
      sql: "SELECT * FROM chat_sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1",
      params: [projectId ?? null],
    },
  ]);
  const row = existing.queries.session[0];
  if (row) {
    return rowToSession(row);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  runSqlite(dbPath, [
    {
      sql: "INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      params: [id, projectId ?? null, "Chat Session", now, now],
    },
  ]);
  return { id, projectId, title: "Chat Session", createdAt: now, updatedAt: now };
}

function rowToSession(row: Record<string, unknown>): ChatSession {
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : undefined,
    title: row.title ? String(row.title) : undefined,
    pendingCommandJson: row.pending_command_json ? String(row.pending_command_json) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function saveMessage(
  dbPath: string,
  message: Omit<ChatMessage, "createdAt">,
): ChatMessage {
  const now = new Date().toISOString();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO chat_messages
        (id, session_id, role, content, intent_type, command_action, command_status, command_receipt_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        message.id,
        message.sessionId,
        message.role,
        message.content,
        message.intentType ?? null,
        message.commandAction ?? null,
        message.commandStatus ?? null,
        message.commandReceiptJson ?? null,
        now,
      ],
    },
  ]);
  return { ...message, createdAt: now };
}

export function getChatHistory(
  dbPath: string,
  sessionId: string,
  limit = 50,
): ChatMessage[] {
  const result = runSqlite(dbPath, [], [
    {
      name: "messages",
      sql: "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?",
      params: [sessionId, limit],
    },
  ]);
  return result.queries.messages.map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    role: String(row.role) as ChatMessage["role"],
    content: String(row.content),
    intentType: row.intent_type ? (String(row.intent_type) as ChatIntentType) : undefined,
    commandAction: row.command_action ? String(row.command_action) : undefined,
    commandStatus: row.command_status ? String(row.command_status) : undefined,
    commandReceiptJson: row.command_receipt_json ? String(row.command_receipt_json) : undefined,
    createdAt: String(row.created_at),
  }));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function processChatMessage(
  dbPath: string,
  sessionId: string,
  userMessage: string,
  options: {
    scheduler?: SchedulerClient;
    codexRunner?: (prompt: string, outputSchemaPath: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  } = {},
): Promise<ChatAssistantResponse> {
  // Fetch session context
  const session = getSession(dbPath, sessionId);
  if (!session) {
    throw new Error(`Chat session not found: ${sessionId}`);
  }

  // Save user message
  saveMessage(dbPath, {
    id: randomUUID(),
    sessionId,
    role: "user",
    content: userMessage,
  });

  // Build context
  const context = buildChatContext(dbPath, session.projectId);

  // Get history for classification context
  const history = getChatHistory(dbPath, sessionId, 10).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Classify intent
  const intent = await classifyIntent(dbPath, userMessage, context, history, options.codexRunner);

  // Override intent to "confirm" if session has a pending command and message looks like confirmation
  const isPendingSession = Boolean(session.pendingCommandJson);
  const resolvedIntent = isPendingSession && intent.intent === "unknown"
    ? { ...intent, intent: "confirm" as ChatIntentType }
    : intent;

  // Dispatch
  const response = executeIntent(dbPath, resolvedIntent, context, sessionId, options);

  // Save assistant message
  saveMessage(dbPath, {
    id: response.messageId,
    sessionId,
    role: "assistant",
    content: response.text,
    intentType: response.intent,
    commandAction: response.preview?.action ?? response.receipt?.action,
    commandStatus: response.state,
    commandReceiptJson: response.receipt ? JSON.stringify(response.receipt) : undefined,
  });

  // Update session timestamp
  runSqlite(dbPath, [
    { sql: "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?", params: [sessionId] },
  ]);

  return response;
}
