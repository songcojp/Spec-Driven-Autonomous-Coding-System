# Design: FEAT-005 CLI Subagent Audit Integration

## Design Summary

Subagent 委托、上下文传递和结果归并由 Codex CLI 原生能力负责。SpecDrive 不再构造 Agent Run Contract、Context Slice 或 Result Merge，只记录 CLI delegation 的可观测事件，并把持久价值集中在 runs、runner logs、status checks、evidence、review、recovery 和 audit timeline。

## Components

| Component | Responsibility |
|---|---|
| CLI Subagent Event Recorder | 记录 CLI subagent 生命周期消息、证据和 token usage。 |
| Run Evidence View | 从 `runs`、`subagent_events`、`status_check_results` 和 `evidence_packs` 展示执行状态。 |
| Workspace Boundary Link | 写入型任务仍通过 FEAT-007 worktree 记录表达隔离边界。 |

## Data Ownership

- Owns: `subagent_events` observation records only。
- Reads: `runs`、`raw_execution_logs`、`status_check_results`、`evidence_packs`、`worktree_records`。
- Does not own: AgentRunContract、ContextSliceRef、ResultMerge 或自定义上下文裁剪策略。

## State and Flow

1. Orchestrator 和 Runner 创建持久 run/task 状态。
2. Codex CLI 原生 subagent 能力处理委托和上下文。
3. SpecDrive 只记录重要 CLI subagent event。
4. Status Checker 和 Evidence Store 判断任务是否完成、失败、阻塞或需要 review。
5. Console 从持久 run/evidence/status 数据展示执行情况。

## Dependencies

- FEAT-004 提供任务状态机和调度上下文。
- FEAT-007 提供写任务 worktree 隔离。
- FEAT-008 提供 Codex Runner。
- FEAT-009 提供状态检测和 Evidence。

## Review and Evidence

- 不允许重新引入 `agent_run_contracts`、`context_slice_refs` 或 `result_merges`。
- Done 判断必须依赖 Status Checker/Evidence，而不是 subagent 自报完成。
