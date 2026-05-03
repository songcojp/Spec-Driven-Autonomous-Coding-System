# FEAT-018 RPC Adapter: Multi Provider — 需求

Feature ID: FEAT-018
Feature 名称: RPC Adapter: Multi Provider
状态: done
里程碑: M8
依赖: FEAT-004、FEAT-008、FEAT-014

## 目标

新增 `rpc.run` executor/adapter，并以 `codex-app-server` 作为首个 RPC provider，使 Execution Adapter Layer 能通过 Codex 官方 app-server JSON-RPC 协议启动或恢复 thread/turn，并把事件流、审批状态和输出校验结果写入 Execution Record。当前演进新增 `gemini-acp` provider，通过 `gemini --acp` stdio JSON-RPC 启动或恢复 Gemini session、发送 prompt、消费 session update 与 permission request。`codex.app_server.run` 仅作为迁移期兼容别名保留。

## 来源需求

| 需求 ID | 描述 | 来源 |
|---|---|---|
| REQ-080 | 提供 RPC Adapter 与多 Provider 执行 | VSCode 插件 PRD 第 7.7 节；Gemini ACP 演进 |
| REQ-081 | 记录 RPC Execution Projection | VSCode 插件 PRD 第 7.7 至 7.9 节；Gemini ACP 演进 |

## 验收标准

- [x] Execution Adapter Worker 可消费 `codex.app_server.run` Job；后续迁移为 `rpc.run`。
- [x] RPC Adapter 支持 initialize/initialized、thread/start、thread/resume、turn/start、turn/interrupt。
- [x] thread id、turn id、transport、model、cwd、output schema 写入 Execution Record。
- [x] turn/item 事件持续写入 raw logs。
- [x] app-server 无法启动、未登录或协议不兼容时 Execution Record 标记 failed。
- [ ] RPC Adapter 可通过 active `gemini-acp` provider 启动 `gemini --acp`、initialize、newSession/loadSession、prompt、cancel，并将 session update 与 permission request 写入 raw logs。
- [ ] Gemini ACP permission request 投影为 `approval_needed`，prompt 成功输出经 SkillOutputContractV1 校验后写入 Execution Record 和 Feature `spec-state.json`。

## 迁移约束

- 新设计不得继续使用 Runner 作为 app-server 调用边界。
- RPC Adapter 必须接受 `ExecutionAdapterInvocationV1`，输出 `ExecutionAdapterEventV1` / `ExecutionAdapterResultV1`。
- Codex app-server provider 的 thread/turn/approval/event stream 和 Gemini ACP provider 的 session/prompt/permission/session update 都是 RPC provider details，不得泄漏为 Scheduler 或 UI 的专用状态机。
- HTTP/JSON-RPC/WebSocket 远程 provider 后续应复用同一 RPC Adapter 接口，不新建第二套 app-server-only 运行模型。
