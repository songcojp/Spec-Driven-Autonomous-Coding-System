# Feature Spec: FEAT-005 CLI Subagent Audit Integration

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 4.3 节；第 6.4 节 FR-030 至 FR-033；第 8.4 节 |
| Requirements | REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-055, NFR-011 |
| HLD | 7.5 CLI Subagent Audit Integration, 10.3 Autonomous Execution Loop, 13 Deployment and Runtime Topology |

## Scope

- 记录 Codex CLI subagent 委托过程中的关键生命周期事件。
- 为 Subagent Console 提供 run、evidence、status check 和 token usage 视图。
- 保留写入型任务与 Workspace Isolation 的关联。
- 通过 Status Checker/Evidence 判断任务真实状态。

## Non-Scope

- 不实现自定义 Agent Run Contract。
- 不实现 Context Broker 或最小上下文切片。
- 不实现 Result Merger。
- 不替代 Codex CLI 原生 subagent 调度和上下文传递。

## User Value

开发者可以恢复和审计跨 session 的执行状态，同时不再维护与 CLI 重复的上下文裁剪和结果归并逻辑。

## Requirements

- Subagent 委托上下文由 Codex CLI 原生能力负责。
- SpecDrive 必须记录可审计的 run、event、evidence 和 status check 结果。
- 写入型任务隔离必须由 Workspace Isolation 和 Runner policy 表达。
- Console 不得依赖自定义 context slice 或 result merge 表。

## Acceptance Criteria

- [ ] schema v14 移除 AgentRunContract、ContextSliceRef 和 ResultMerge 持久表。
- [ ] CLI subagent event 可以写入并从 Console 查询。
- [ ] Subagent Console 使用 run/evidence/status check 数据展示执行状态。
- [ ] 任务完成判断仍由 Status Checker 和验收聚合负责。

## Risks and Open Questions

- CLI subagent 的细粒度上下文不可由 SpecDrive 重放，审计粒度转向 run/event/evidence/status。
- 如未来 CLI 暴露更丰富的 delegation telemetry，应接入 telemetry 记录而不是恢复 Context Broker。
