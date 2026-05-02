# Feature Spec: FEAT-004 Scheduler and State Maintenance

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 2026-04-29 boundary update; Scheduler, State Machine, Audit, Runner observation |
| Requirements | REQ-024 至 REQ-029、REQ-031 至 REQ-036、REQ-060、REQ-068 |
| HLD | Scheduler and State Maintenance |

## Scope

- 不再维护平台 TaskGraph 表；Feature 内部 task 规划和状态由 Feature Spec 的 `tasks.md` 与执行 LLM 管理。
- 维护任务看板列和任务状态自动流转。
- 维护 Feature 状态机，覆盖 `draft`、`ready`、`planning`、`tasked`、`implementing`、`done`、`delivered`、`review_needed`、`blocked` 和 `failed`。
- `push_feature_spec_pool` 从 `docs/features/feature-pool-queue.json` 读取已排好的 Feature 队列，并选择下一个依赖满足的 Feature。
- Scheduler Trigger 只负责把受控命令转换为 executor job；Feature/Task/Project 是 payload context，不是 Job 顶层属性。
- 记录立即执行、指定时间、每日、每小时、夜间、工作日、依赖完成、CI 失败和审批通过等触发模式；事件类触发先记录为受控请求。
- 通过 BullMQ + Redis 调度 `<executor>.run` job；当前支持 `cli.run`，预留 `native.run`，并用 SQLite 保存 `scheduler_job_records` 和 `execution_records`。
- 维护状态聚合、调度审计、状态转换审计和可恢复运行状态。

## Non-Scope

- 不执行 Codex CLI；执行归属 Runner 外部运行观测能力。
- 不直接调用 Skill、Subagent 或 Planning Pipeline；调度器只创建 executor job，由 CLI/native executor 处理真实执行。
- 不维护 Agent Run Contract、Subagent event 或 Skill schema。
- 不进行状态检测实现；检测归属 FEAT-009。
- 不提供 UI 拖拽或展示实现；展示归属 FEAT-013。

## User Value

系统可以从一组 ready Feature 中自动选择下一项工作，把 Feature 拆成可追踪任务，并用状态机让长时间自主执行可审计、可暂停、可恢复。

## Requirements

- Project Scheduler 不得依赖 Project Memory 中的静态候选队列作为真实来源。
- 每次调度运行必须记录触发模式、触发时间、触发来源、触发对象、BullMQ job id、queue、job type、attempts、payload 和调度结果。
- Job 核心字段只保留执行层信息：`id`、`queue_name`、`job_type`、`status`、`payload_json`、`attempts`、`error`、`created_at`、`updated_at`；Feature/Task/Project 不得作为 Job 顶层属性。
- Payload 必须包含 `operation`、`projectId` 和 `context`；Feature 执行统一使用 `operation = "feature_execution"`。
- 调度器不得创建 `feature.select` 或 `feature.plan` job；所有任务激活都进入 `<executor>.run`。
- 真实执行实例必须记录为 Execution Record（执行记录），字段包括 scheduler job、executor type、operation、project id、context、status、started/completed、summary 和 metadata。
- 手动和时间类触发可进入候选选择；CI 失败、审批通过和依赖完成触发在 MVP 中必须先记录为 `recorded` 或 `blocked`，等待上游 Evidence/Review/Dependency 子系统确认后再进入候选选择。
- 任务图不得包含平台 Skill 或 Subagent 字段。
- Feature done 判定必须同时满足任务 Done、Feature 验收、Spec Alignment Check 和必要测试通过。
- 依赖未完成的 Feature 不得进入 implementing。

## Acceptance Criteria

- [ ] Job 列表不包含 Feature/Task/Project 顶层属性；这些信息只出现在 payload context。
- [ ] `push_feature_spec_pool` 不创建 `feature.select` / `feature.plan`，而是按队列规划直接入队 `cli.run` 或后续 `native.run`。
- [ ] Execution Record 与 Evidence、heartbeat、logs 和 session 能关联查询。
- [ ] Running 任务完成检测后可进入 Done、Review Needed、Blocked 或 Failed。
- [ ] Feature 进入 review_needed 时记录 approval_needed、clarification_needed 或 risk_review_needed。
- [ ] 手动、指定时间和周期触发能生成可审计的调度触发记录和 `<executor>.run` scheduler job。
- [ ] Redis 不可用时 scheduler health 为 blocked，API 不崩溃。
- [ ] CI 失败、审批通过和依赖完成触发不得绕过 Feature/Task 边界、审批规则或安全策略。

## Risks and Open Questions

- Project Scheduler 的固定规则需要保持可解释，避免引入不可审计的评分黑盒。
- Dashboard Board 的拖拽或批量操作只产生状态机允许的状态变更或调度请求。
- 事件类触发的上游接入仍依赖 CI、Review Center 和依赖检测事件源；当前实现只保留受控记录和边界保护。
- 旧 FeatureSelectionDecision、平台 TaskGraph 和 `feature.plan` blocked 语义已废弃；Feature 内部任务分解以 `tasks.md` 为准。
