# FEAT-015 Chat Interface — 需求

Feature ID: FEAT-015
Feature 名称: Chat Interface 自然语言指令面板
状态: in-progress
里程碑: M7
依赖: FEAT-013（Product Console）、FEAT-004（Orchestration and State Machine）、FEAT-014（Persistence and Auditability）

## 目标

在 Product Console 所有页面嵌入可折叠的悬浮对话面板，允许用户以自然语言提问和下达指令，系统识别意图后将其转换为受控命令执行，并持久化对话历史。

## 来源需求

| 需求 ID | 描述 | 来源 |
|---|---|---|
| REQ-069 | 提供 Chat Interface 悬浮面板 | 用户输入"需要在现在系统实现一个聊天功能"；PRD 第 8.10 节 |
| REQ-070 | 识别用户自然语言意图并分类 | 用户输入"他能识别用户输入的意图"；REQ-069 |
| REQ-071 | 执行低风险和中等风险意图 | 用户输入"查询任务状态等"；REQ-070 |
| REQ-072 | 高风险意图需用户确认后执行 | 用户输入"高风险操作需要二次确认"；REQ-070 |
| REQ-073 | 持久化 Chat Session 和消息历史 | REQ-069；REQ-072；PRD 第 7 节核心数据模型 |

## 用户故事

- 作为用户，我希望在任意页面打开聊天面板，输入"查看当前任务状态"，以便立刻得到项目概况而不需要跳转页面。
- 作为用户，我希望输入"新增需求：支持 Dark Mode"，以便聊天面板直接将需求录入系统并返回确认。
- 作为审批人，我希望输入"暂停 Runner"时，聊天面板先展示操作预览并要求确认，以便避免误触发高风险操作。
- 作为用户，我希望关闭并重新打开聊天面板时可以看到历史对话记录。

## 验收标准

REQ-069 验收：
- [ ] 悬浮面板默认折叠，通过右下角图标切换展开/折叠状态。
- [ ] 展开面板展示对话历史、输入框、发送按钮和加载状态指示器。
- [ ] 面板支持中文和英文界面切换，与全局 locale 同步。
- [ ] 面板在桌面和移动端宽度下均可使用。

REQ-070 验收：
- [ ] 分类结果包含意图类型、置信度、风险等级（low/medium/high）、确认要求和提取的实体信息。
- [ ] Codex 调用失败或超时时，系统使用规则分类并在响应中标注 fallback。
- [ ] 同一会话消息历史被作为上下文传递给意图分类器，以支持多轮对话。
- [ ] 未能识别的意图返回 unknown 类型并给出帮助提示。

REQ-071 验收：
- [ ] 查询意图返回项目状态、Feature 列表、任务看板摘要或 Review 待审批项。
- [ ] 生成类意图通过 `submitConsoleCommand` 提交受控命令并返回命令回执摘要。
- [ ] 所有执行结果都写入 chat_messages 表的 `command_receipt_json` 字段，并标记 command_status 为 executed。

REQ-072 验收：
- [ ] 高风险意图不得自动执行，必须展示预览并返回 state=pending_confirmation。
- [ ] pending_command_json 只存储一个待确认命令；新的高风险意图会覆盖旧的未确认命令。
- [ ] 确认后执行通过 `submitConsoleCommand` 完成，并清除 pending_command_json。
- [ ] 取消后返回 state=cancelled，清除 pending_command_json，并告知用户操作已取消。
- [ ] 当前项目 ID 缺失或不匹配时，高风险命令返回 blocked 并给出原因。

REQ-073 验收：
- [ ] chat_sessions 表存储会话 ID、project_id、pending_command_json、created_at 和 updated_at。
- [ ] chat_messages 表存储消息 ID、session_id、role、content、intent_type、command_action、command_status、command_receipt_json 和 created_at。
- [ ] 同一 project_id 重新打开面板时，系统返回同一活跃会话并加载最近消息历史（默认最多 50 条）。
- [ ] 消息持久化失败不得阻塞用户发送操作；失败时记录错误日志。

## 意图类型映射

| 意图类型 | 风险等级 | 对应受控命令 action | 确认要求 |
|---|---|---|---|
| query_status | low | query_status | 否 |
| query_review | low | query_review | 否 |
| help | low | help | 否 |
| cancel | low | cancel | 否 |
| confirm | low | confirm | 否 |
| unknown | low | — | 否 |
| add_requirement | medium | add_requirement | 否 |
| change_requirement | medium | change_requirement | 否 |
| generate_ears | medium | generate_ears | 否 |
| generate_hld | medium | generate_hld | 否 |
| schedule_run | high | schedule_run | 是 |
| pause_runner | high | pause_runner | 是 |
| resume_runner | high | resume_runner | 是 |
| approve_review | high | approve_review | 是 |
| reject_review | high | reject_review | 是 |

## 开放问题

- [ ] `add_requirement` / `change_requirement` 中等风险意图的受控命令在 `submitConsoleCommand` 中是否已支持？如未支持，需在 FEAT-002/FEAT-013 添加。
- [ ] `generate_ears` / `generate_hld` 意图是否在当前 product-console.ts 中已有对应 action？需在实现时核查。
