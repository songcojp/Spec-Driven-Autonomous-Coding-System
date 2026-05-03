# FEAT-015 Chat Interface — 设计

Feature ID: FEAT-015
来源需求: REQ-069、REQ-070、REQ-071、REQ-072、REQ-073
HLD 参考: 第 7.14 节 Chat Interface

---

## 1. 架构决策

### 1.1 意图分类策略

- 优先使用默认 CLI adapter（通过 `runCommand()`）进行 LLM 意图分类，传入结构化 prompt + JSON output schema。
- Codex 不可用（exit code 非 0、超时、未安装）时，退回 `ruleBasedClassification()`——基于关键词的同步函数，覆盖 15 种意图类型。
- 分类结果类型：`ChatIntentResult { intent, confidence, entities, riskLevel, confirmationRequired, responseText }`。

理由：CLI Runner 是系统已有的外部 CLI 执行机制（`src/cli-runner.ts`），复用它不引入新依赖；规则兜底保证默认 CLI 不可用时仍可正常工作。

### 1.2 命令派发策略

- 所有状态变更操作必须经过 `submitConsoleCommand()`（`src/product-console.ts`），保证审计、幂等和安全门。
- 查询类操作（query_status、query_review）直接读取 SQLite，不经过 submitConsoleCommand，返回快照文本。
- help / unknown 意图不触发任何命令，只返回说明文本。

### 1.3 高风险确认流程

- 高风险意图触发时：序列化命令为 `pending_command_json` 存入 `chat_sessions` 表，返回 `state=pending_confirmation` + `preview` 对象。
- 后续 `confirm` 意图：从 `chat_sessions` 读取 `pending_command_json`，调用 `submitConsoleCommand()`，清除 `pending_command_json`，返回命令回执。
- 后续 `cancel` 意图：直接清除 `pending_command_json`，返回 `state=cancelled`。
- 同一 session 内同时只允许一个 pending 命令。

### 1.4 持久化

- SQLite schema（migration v19）：`chat_sessions`、`chat_messages` 两张表，通过 `runSqlite()` 执行。
- 每个 project_id 维护一个活跃 session（SELECT existing → INSERT if not exists）。
- 消息历史默认读取最近 50 条（ORDER BY created_at DESC LIMIT 50，返回时反序为正序）。

---

## 2. 模块边界

| 模块 | 路径 | 职责 |
|---|---|---|
| Chat 核心 | `src/chat.ts` | context 构建、意图分类、意图执行、session/消息持久化 |
| HTTP 路由 | `src/server.ts` | POST /chat/sessions、POST/GET /chat/sessions/:id/messages |
| 前端 API 客户端 | `apps/product-console/src/lib/chatApi.ts` | fetch 封装 |
| 前端 UI 组件 | `apps/product-console/src/components/ChatPanel.tsx` | 悬浮面板、useChatSession hook |
| 前端挂载 | `apps/product-console/src/App.tsx` | showChat 状态、ChatPanel 渲染 |
| Schema 类型 | `src/schema.ts` | ChatIntentType、ChatRiskLevel、ChatSession、ChatMessage、ChatAssistantResponse |
| DB 迁移 | `src/schema.ts` MIGRATIONS | migration v19：CREATE TABLE chat_sessions / chat_messages |

---

## 3. 数据模型

### chat_sessions

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | nanoid |
| project_id | TEXT NULL | 关联项目 |
| title | TEXT NULL | 可选会话标题 |
| pending_command_json | TEXT NULL | 序列化的高风险待确认命令 JSON |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

### chat_messages

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | nanoid |
| session_id | TEXT FK | 关联 chat_sessions.id |
| role | TEXT | "user" \| "assistant" |
| content | TEXT | 消息正文 |
| intent_type | TEXT NULL | 识别到的意图类型（仅 assistant 消息） |
| command_action | TEXT NULL | 派发的命令 action（仅 assistant 消息） |
| command_status | TEXT NULL | "executed" \| "pending_confirmation" \| "cancelled" \| "error" |
| command_receipt_json | TEXT NULL | ConsoleCommandReceipt 序列化 JSON |
| created_at | TEXT | ISO 8601 |

---

## 4. HTTP API

### POST /chat/sessions
请求体：`{ projectId?: string }`
响应：`ChatSession`

### POST /chat/sessions/:sessionId/messages
请求体：`{ content: string }`
响应：`ChatAssistantResponse { messageId, text, intent, state, preview?, receipt? }`

state 取值：`answered` | `executed` | `pending_confirmation` | `cancelled` | `error`

### GET /chat/sessions/:sessionId/messages?limit=N
响应：`ChatMessage[]`（按 created_at 升序，最多 limit 条，默认 50）

---

## 5. 前端组件

### ChatPanel Props

```typescript
{
  open: boolean;
  onToggle: () => void;
  projectId: string;
  locale?: string;    // "zh-CN" | "en"
}
```

### useChatSession Hook

- `open=true` 时调用 `createOrGetChatSession(projectId)` 初始化 session，加载历史消息。
- `sendMessage(text)` → POST messages → 追加 assistant 消息到状态，处理 pending_confirmation。
- `confirmCommand()` → 发送"确认"消息。
- `cancelCommand()` → 发送"取消"消息，清除前端 pendingConfirmation 状态。

---

## 6. 安全考量

- Chat Interface 通过 `submitConsoleCommand()` 派发所有有后果的操作，继承其审计、幂等和安全门约束。
- 高风险意图必须二次确认，防止自然语言解析错误导致误操作。
- `pending_command_json` 不跨会话传播（每次初始化新 session 时，旧 session 的 pending 命令不会自动继承）。
- 意图分类 prompt 不应包含用户敏感凭据；系统只传入项目摘要上下文（feature 列表、任务摘要、review 摘要），不传入完整代码或密钥。

---

## 7. 验证策略

- 单元测试：`tests/chat.test.ts`，覆盖 getOrCreateSession、getChatHistory、classifyIntent（规则兜底和 mock Codex runner）、executeIntent（help/unknown/high-risk/cancel/confirm）、processChatMessage（端到端流程）。
- 前端构建验证：`npm run console:build` 通过，无 TypeScript 类型错误。
- 运行时验证：`npm run dev` 启动后，可在 Product Console 右下角看到聊天图标，展开后可发送消息并收到回复。
