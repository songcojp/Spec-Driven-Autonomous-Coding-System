# Design: FEAT-004 Scheduler and State Maintenance

## Design Summary

Scheduler and State Maintenance 是控制面核心。它通过 BullMQ + Redis 承担真实 job 调度，从 Feature Spec Pool 读取候选，维护 Feature/Task 状态机，并根据 Runner observation、Status Check、Review、Recovery 和 Delivery 结果推进状态。SQLite 仍是业务事实源和审计源。它不伪造 Skill 输出，不创建 Subagent，也不在 planning bridge 缺失时生成假任务图；bridge 可用时只创建 planning CLI run 并等待 Runner Evidence 回写。

## Components

| Component | Responsibility |
|---|---|
| Project Scheduler | 动态读取 ready Feature 候选，接收调度触发模式并选择下一 Feature。 |
| Schedule Trigger Recorder | 记录触发模式、触发时间、触发来源、触发对象、触发结果和阻塞原因。 |
| BullMQ Scheduler Adapter | 将 `feature.select`、`feature.plan` 和 `cli.run` 写入固定 queue，并把 job 元数据同步到 SQLite。 |
| Feature Selector | 基于优先级、依赖完成、验收风险和 ready 时长输出选择原因。 |
| Task Graph Builder | 生成任务图和任务依赖，不写入 Skill/Subagent 字段。 |
| Board State Machine | 维护任务看板列和合法状态迁移。 |
| Feature State Machine | 维护 Feature 生命周期和 review_needed reason。 |
| Feature Scheduler | 在 Feature 内推进可执行任务。 |
| Feature Aggregator | 聚合任务状态并判断 Feature done/blocked/failed/implementing。 |
| Audit Persistence | 持久化调度触发、状态转换和状态聚合证据。 |

## Data Ownership

- Owns: FeatureSelectionDecision、ScheduleTrigger、SchedulerJobRecord、TaskGraph、Task、TaskSchedule、StateTransition、AuditTimelineEvent。
- Reads: Feature Spec Pool、Workspace 状态、Runner 可用性、Review 决策、StatusCheckResult。
- Writes: Persistent Store、Project Memory 选择摘要、Audit Timeline。

## State and Flow

1. Project Scheduler 接收立即执行、指定时间、每日、每小时、夜间、工作日、依赖完成、CI 失败或审批通过等模式，并先由 Schedule Trigger Recorder 生成审计记录。
2. 手动触发立即 enqueue `feature.select`；指定时间触发使用 delayed job；每日、每小时、夜间和工作日触发使用 repeatable job；事件类触发在边界证据不足时只记录为受控事件请求。
3. `feature.select` Worker 从 Feature Spec Pool 动态计算 live ready 候选，写入 FeatureSelectionDecision。
4. 选中的 Feature 执行 `ready -> planning` 并 enqueue `feature.plan`。
5. `feature.plan` 在 Codex Skill planning bridge 未实现或项目 workspace 不可用时执行 `planning -> blocked`，原因固定为 `Planning skill execution bridge is not implemented` 或 workspace 阻塞原因；bridge 可用时入队 planning CLI run，不得同步生成假 TaskGraph。
6. Feature Scheduler 将合法任务执行 `ready -> scheduled`；`run_board_tasks` 创建 Run 并 enqueue `cli.run`，CLI 执行归 FEAT-008 Worker。
7. Status Checker、Review Center、Recovery Manager 或 Delivery Manager 回写结果后触发状态聚合。

## Dependencies

- FEAT-002 提供 Feature Spec Pool 和需求来源。
- FEAT-007 提供 worktree 可用性和冲突边界。
- FEAT-009 提供状态检测结果。
- FEAT-014 提供状态幂等和审计。

## Review and Evidence

- 所有状态转换必须记录触发原因、来源证据和时间。
- 调度运行必须记录触发模式、触发来源、触发对象、BullMQ queue/job type/job id、attempts、payload 和调度结果，且不得绕过安全、审批和边界策略。
- 事件类触发必须在记录层保留阻塞原因；没有 CI Evidence、审批记录或依赖完成证据时不得进入候选选择。
- Feature done 不允许只依赖任务卡片完成，必须等待 StatusCheckResult 和验收聚合。
