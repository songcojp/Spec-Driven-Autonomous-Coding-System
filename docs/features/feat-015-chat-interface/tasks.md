# FEAT-015 Chat Interface — 任务

Feature ID: FEAT-015
来源需求: REQ-069、REQ-070、REQ-071、REQ-072、REQ-073
状态: in-progress

---

## 任务列表

### T-015-01 Schema 迁移 v19
状态: done
描述: 在 `src/schema.ts` 中将 `SCHEMA_VERSION` 升至 19，新增 migration v19 创建 `chat_sessions` 和 `chat_messages` 表及索引；导出 `ChatIntentType`、`ChatRiskLevel`、`ChatIntentResult`、`ChatSession`、`ChatMessage`、`ChatAssistantResponse` 类型。
验证: DB 迁移在 `npm test` 中自动执行，schema 版本为 19。
文件: `src/schema.ts`

### T-015-02 Chat 核心模块
状态: done
描述: 创建 `src/chat.ts`，实现 `buildChatContext`、`classifyIntent`（Codex CLI + 规则兜底）、`executeIntent`、`buildCommandInput`、`getOrCreateSession`、`getChatHistory`、`processChatMessage`。
验证: 单元测试 `tests/chat.test.ts` 通过。
文件: `src/chat.ts`

### T-015-03 HTTP 路由
状态: done
描述: 在 `src/server.ts` 中新增 `POST /chat/sessions`、`POST /chat/sessions/:sessionId/messages`、`GET /chat/sessions/:sessionId/messages` 三条路由。
验证: curl 手动验证或测试套件覆盖。
文件: `src/server.ts`

### T-015-04 前端 API 客户端
状态: done
描述: 创建 `apps/product-console/src/lib/chatApi.ts`，封装 `createOrGetChatSession`、`sendChatMessage`、`getChatHistory` 三个 fetch 函数。
验证: `npm run console:build` 无类型错误。
文件: `apps/product-console/src/lib/chatApi.ts`

### T-015-05 前端类型
状态: done
描述: 在 `apps/product-console/src/types.ts` 末尾新增 `ChatIntentType`、`ChatSession`、`ChatMessage`、`ChatAssistantResponse` 类型定义。
验证: `npm run console:build` 无类型错误。
文件: `apps/product-console/src/types.ts`

### T-015-06 ChatPanel 组件
状态: done
描述: 创建 `apps/product-console/src/components/ChatPanel.tsx`，实现 `useChatSession` hook 和 `ChatPanel` 悬浮面板组件，支持高风险确认流程，支持 locale 国际化（zh-CN / en）。
验证: `npm run console:build` 无类型错误；面板可在浏览器中打开、发送消息、查看回复。
文件: `apps/product-console/src/components/ChatPanel.tsx`

### T-015-07 App.tsx 挂载
状态: done
描述: 在 `apps/product-console/src/App.tsx` 中添加 `showChat` state，在 `Toast.Provider` 内渲染 `<ChatPanel>`。
验证: `npm run console:build` 通过；运行时可见聊天图标。
文件: `apps/product-console/src/App.tsx`

### T-015-08 单元测试
状态: done
描述: 创建 `tests/chat.test.ts`，覆盖 session 管理、历史获取、意图分类（规则兜底、mock Codex runner）、意图执行（help/unknown/high-risk/cancel/confirm）、processChatMessage 端到端流程。
验证: `npm test` 通过。
文件: `tests/chat.test.ts`

### T-015-09 规格文档更新
状态: done
描述: 更新 PRD 第 8.10 节、requirements.md REQ-069~073、HLD 第 7.14 节 + 需求覆盖表 + 数据域表；创建 feat-015 Feature Spec 三文件；更新 features/README.md。
验证: 文档一致性检查（`git diff --check`）。
文件:
- `docs/zh-CN/PRD.md`
- `docs/zh-CN/requirements.md`
- `docs/zh-CN/hld.md`
- `docs/features/README.md`
- `docs/features/feat-015-chat-interface/requirements.md`
- `docs/features/feat-015-chat-interface/design.md`
- `docs/features/feat-015-chat-interface/tasks.md`

### T-015-10 全套测试验证
状态: not-started
描述: 运行 `npm test` 全套测试，确认 chat.test.ts 和所有回归测试通过；运行 `npm run console:build` 确认前端构建无错误。
验证: npm test exit code 0；npm run console:build exit code 0。
文件: 不涉及文件修改

---

## 依赖关系

```
T-015-01 → T-015-02 → T-015-03
T-015-02 → T-015-08
T-015-04 → T-015-06
T-015-05 → T-015-06
T-015-06 → T-015-07
T-015-07 → T-015-10
T-015-09 → T-015-10
```

## 已知风险

- `add_requirement` / `change_requirement` / `generate_ears` / `generate_hld` 等中等风险意图需要 `submitConsoleCommand()` 有对应 action 支持；若不支持，`executeIntent` 返回错误消息，不影响系统稳定性，但功能不完整。
- Codex CLI 意图分类的 prompt 质量影响识别准确率；规则兜底仅覆盖主流关键词。
