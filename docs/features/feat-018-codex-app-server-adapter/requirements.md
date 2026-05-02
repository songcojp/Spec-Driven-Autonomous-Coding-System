# FEAT-018 Codex App Server Adapter — 需求

Feature ID: FEAT-018
Feature 名称: Codex App Server Adapter
状态: done
里程碑: M8
依赖: FEAT-004、FEAT-008、FEAT-014

## 目标

新增 `codex.app_server.run` executor/adapter，使 Runner 能通过 Codex 官方 app-server JSON-RPC 协议启动或恢复 thread/turn，并把事件流、审批状态和输出校验结果写入 Execution Record。

## 来源需求

| 需求 ID | 描述 | 来源 |
|---|---|---|
| REQ-080 | 提供 Codex app-server Adapter | VSCode 插件 PRD 第 7.7 节 |
| REQ-081 | 记录 app-server Execution Projection | VSCode 插件 PRD 第 7.7 至 7.9 节 |

## 验收标准

- [x] Runner 可消费 `codex.app_server.run` Job。
- [x] Adapter 支持 initialize/initialized、thread/start、thread/resume、turn/start、turn/interrupt。
- [x] thread id、turn id、transport、model、cwd、output schema 写入 Execution Record。
- [x] turn/item 事件持续写入 raw logs。
- [x] app-server 无法启动、未登录或协议不兼容时 Execution Record 标记 failed。
