# Feature Spec: FEAT-005 Retired - Platform Subagent Runtime Removed

## Status

Retired by the 2026-04-29 product boundary update.

## Decision

SpecDrive AutoBuild 不再提供平台级 Subagent Runtime、Context Broker、Agent Run Contract、Subagent event 表或 Subagent Console。平台不创建、不管理、不终止、不重试 Subagent；只维护任务调度、状态机、外部运行状态、Evidence、Status Check、Review、Recovery 和 Audit。

## Replacement Scope

- Runner Console 仅展示外部执行队列、心跳、日志、证据和状态检测结果。
- SQLite 最终 schema 不保留 `subagent_events` 或 `planning_pipeline_runs`。
- 任务图不包含 `subagent` 字段。
- Console 不提供 `/console/subagents` API 或 Subagent Console 页面。

## Acceptance Criteria

- [ ] 平台 API 不暴露 Subagent 管理入口。
- [ ] Console 导航不包含 Subagent Console。
- [ ] 状态聚合只依赖任务状态、Runner 运行状态、Evidence、Status Check、Review 和 Recovery。
