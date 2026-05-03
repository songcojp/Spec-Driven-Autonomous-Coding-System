# Design: FEAT-004 Scheduler and State Maintenance

## Design Summary

Scheduler and State Maintenance 是控制面核心。它通过 BullMQ + Redis 承担真实 job 调度，从 `feature-pool-queue.json` 读取已经排好的 Feature 队列，调用 `feature-selection-skill` 推理选择下一项工作，并把通过代码安全校验的 Feature 转换为 `<executor>.run` Job。Spec / Feature 流程状态以文件为准：`feature-pool-queue.json` 是全局队列，`docs/features/<feature-id>/spec-state.json` 是单 Feature 机器可读状态。SQLite 只保存运行时事实：`scheduler_job_records` 表示队列 Job，`execution_records` 表示真实执行实例。Feature 只是 payload context，不是 Job 顶层属性。

## Components

| Component | Responsibility |
|---|---|
| Scheduler Trigger | 接收调度触发模式，记录受控触发并创建 executor job。 |
| Schedule Trigger Recorder | 记录触发模式、触发时间、触发来源、触发对象、触发结果和阻塞原因。 |
| BullMQ Scheduler Adapter | 将 `cli.run`、`native.run` 等 `<executor>.run` 写入固定 queue，并把 job 元数据同步到 SQLite。 |
| Feature Selection Skill Bridge | 将 Feature Pool Queue、`spec-state.json`、依赖、最近 Execution Record 和 resume/skip hints 交给 `feature-selection-skill`，接收 `select_next_feature` 决策。 |
| Feature Pool Safety Gate | 校验技能选择的 Feature 必须在队列中、三件套完整、依赖满足、无 active `feature_execution`，且 blocked/failed/review_needed/approval_needed 已显式 resume。 |
| Board State Machine | 维护任务看板列和合法状态迁移。 |
| Feature State Machine | 维护 Feature 生命周期和 review_needed reason。 |
| Feature Aggregator | 聚合任务状态并判断 Feature done/blocked/failed/implementing。 |
| Activity Persistence | 保留 command receipt、scheduler job、execution record 和轻量活动记录；复杂审计不再作为操作者主视图。 |

## Data Ownership

- Owns: ScheduleTrigger、SchedulerJobRecord、ExecutionRecord 和文件化 `spec-state.json` 投影。
- Reads: Feature Spec Pool queue、`spec-state.json`、Workspace 状态、Runner 可用性、Review 决策、StatusCheckResult。
- Writes: Scheduler/Execution Persistent Store、Feature `spec-state.json`、Project Memory 选择摘要和轻量 Activity。

## State and Flow

1. Project Scheduler 接收立即执行、指定时间、每日、每小时、夜间、工作日、依赖完成、CI 失败或审批通过等模式，并先由 Schedule Trigger Recorder 生成审计记录。
2. 项目级 `schedule_run` 或 `start_auto_run` 读取 `docs/features/feature-pool-queue.json`，调用 `feature-selection-skill`，不再保留独立 `push_feature_spec_pool` 步骤，也不进行平台二次 `feature.select` / `feature.plan`。
3. 技能返回的下一个可执行 Feature 通过代码安全校验后入队 `<executor>.run`：CLI 使用 `job_type = "cli.run"`，Native 使用 `job_type = "native.run"`，payload 使用 `operation = "feature_execution"`。
4. EARS、HLD、UI Spec、Feature split 等平台操作同样进入 `<executor>.run`，通过 payload `operation` 区分。
5. 创建 Job 时同步创建 Execution Record；Evidence、heartbeat、logs 和 session 统一关联执行记录。
6. Status Checker、Review Center、Recovery Manager 或 Delivery Manager 回写结果后触发状态聚合。

旧设计废弃：`feature.select`、`feature.plan`、FeatureSelectionDecision、平台 TaskGraph / TaskGraphTasks、Feature Plan blocked 语义均不再作为调度模型的一部分。Feature 内部开发任务由 LLM 和 Feature Spec `tasks.md` 管理。

## Dependencies

- FEAT-002 提供 Feature Spec Pool 和需求来源。
- FEAT-007 提供 worktree 可用性和冲突边界。
- FEAT-009 提供状态检测结果。
- FEAT-014 提供 scheduler job、execution record、Evidence 和审计持久化。

## Review and Evidence

- 所有状态转换必须记录触发原因、来源证据和时间。
- 调度运行必须记录触发模式、触发来源、触发对象、BullMQ queue/job type/job id、attempts、payload 和调度结果，且不得绕过安全、审批和边界策略。
- Scheduler Job payload 必须包含 `operation`、`projectId`、`context`；Feature/Task/Project 只允许在 context 中出现。
- 事件类触发必须在记录层保留阻塞原因；没有 CI Evidence、审批记录或依赖完成证据时不得进入候选选择。
- Feature done 不允许只依赖任务卡片完成，必须等待 StatusCheckResult 和验收聚合。
