# FEAT-018 RPC Adapter: Codex App Server Provider — 需求

Feature ID: FEAT-018
Feature 名称: RPC Adapter: Codex App Server Provider
状态: done
里程碑: M8
依赖: FEAT-004、FEAT-008、FEAT-014

## 目标

新增 `rpc.run` executor/adapter，并以 `codex-app-server` 作为首个 RPC provider，使 Execution Adapter Layer 能通过 Codex 官方 app-server JSON-RPC 协议启动或恢复 thread/turn，并把事件流、审批状态和输出校验结果写入 Execution Record。`codex.app_server.run` 仅作为迁移期兼容别名保留。

## 来源需求

| 需求 ID | 描述 | 来源 |
|---|---|---|
| REQ-080 | 提供 Codex app-server Adapter | VSCode 插件 PRD 第 7.7 节 |
| REQ-081 | 记录 app-server Execution Projection | VSCode 插件 PRD 第 7.7 至 7.9 节 |

## 验收标准

- [x] Execution Adapter Worker 可消费 `codex.app_server.run` Job；后续迁移为 `rpc.run`。
- [x] RPC Adapter 支持 initialize/initialized、thread/start、thread/resume、turn/start、turn/interrupt。
- [x] thread id、turn id、transport、model、cwd、output schema 写入 Execution Record。
- [x] turn/item 事件持续写入 raw logs。
- [x] app-server 无法启动、未登录或协议不兼容时 Execution Record 标记 failed。

## 迁移约束

- 新设计不得继续使用 Runner 作为 app-server 调用边界。
- RPC Adapter 必须接受 `ExecutionAdapterInvocationV1`，输出 `ExecutionAdapterEventV1` / `ExecutionAdapterResultV1`。
- Codex app-server provider 的 thread/turn/approval/event stream 是 RPC provider details，不得泄漏为 Scheduler 或 UI 的专用状态机。
- HTTP/JSON-RPC/WebSocket 远程 provider 后续应复用同一 RPC Adapter 接口，不新建第二套 app-server-only 运行模型。
