# Design: FEAT-005 Retired - Platform Subagent Runtime Removed

## Design Summary

本 Feature 已废弃。Subagent 委托若由外部 CLI 提供，SpecDrive 不再建模其上下文、agent type、run contract 或事件流。

## Data and API Impact

- 删除 Subagent Console view model 和 HTTP endpoint。
- 最终 schema 删除 `subagent_events`；历史迁移只作为升级路径保留。
- `TaskGraphTask` 不再保存 `subagent`。
- Dashboard 指标从 running subagents 收缩为 active external runs。

## Integration Rule

外部执行器可以通过 Runner、Evidence Pack、Status Check 和 Recovery Dispatch 输入向平台反馈结果；平台不反向调用或管理 Subagent。
