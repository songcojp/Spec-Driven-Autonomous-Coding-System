# Feature Spec: FEAT-004 Scheduler and State Maintenance

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 2026-04-29 boundary update; Scheduler, State Machine, Audit, Runner observation |
| Requirements | REQ-024 至 REQ-029、REQ-031 至 REQ-036、REQ-060、REQ-068 |
| HLD | Scheduler and State Maintenance |

## Scope

- 生成包含来源需求、验收、允许文件、依赖、并行性、风险、预估工作量和状态的任务图。
- 维护任务看板列和任务状态自动流转。
- 维护 Feature 状态机，覆盖 `draft`、`ready`、`planning`、`tasked`、`implementing`、`done`、`delivered`、`review_needed`、`blocked` 和 `failed`。
- Project Scheduler 从 Feature Spec Pool 动态选择 ready Feature。
- Feature Scheduler 根据依赖、风险、文件范围、Runner 可用性、worktree 状态、成本预算、执行窗口和审批要求推进任务。
- 记录立即执行、指定时间、每日、每小时、夜间、工作日、依赖完成、CI 失败和审批通过等触发模式；事件类触发先记录为受控请求。
- 通过 BullMQ + Redis 调度 `feature.select`、`feature.plan` 和 `cli.run` job，并用 SQLite 保存 scheduler job 事实和审计。
- 维护状态聚合、调度审计、状态转换审计和可恢复运行状态。

## Non-Scope

- 不执行 Codex CLI；执行归属 Runner 外部运行观测能力。
- 不直接调用 Skill、Subagent 或 Planning Pipeline；只在 bridge 可用时把 `feature.plan` 转换为可审计 CLI skill invocation 并交给 Runner。
- 不维护 Agent Run Contract、Subagent event 或 Skill schema。
- 不进行状态检测实现；检测归属 FEAT-009。
- 不提供 UI 拖拽或展示实现；展示归属 FEAT-013。

## User Value

系统可以从一组 ready Feature 中自动选择下一项工作，把 Feature 拆成可追踪任务，并用状态机让长时间自主执行可审计、可暂停、可恢复。

## Requirements

- Project Scheduler 不得依赖 Project Memory 中的静态候选队列作为真实来源。
- Feature 选择必须记录候选摘要、选择原因和 Memory 摘要。
- 每次调度运行必须记录触发模式、触发时间、触发来源、触发对象、BullMQ job id、queue、job type、attempts、payload 和调度结果。
- `schedule_run` 不得同步产生 FeatureSelectionDecision；`selectionDecisionId` 只能由 `feature.select` Worker 写入后出现。
- `feature.plan` 在 Codex Skill planning bridge 缺失时必须 blocked，原因固定为 `Planning skill execution bridge is not implemented`；bridge 可用时必须入队 planning CLI run，不得同步生成或伪造任务图。
- 手动和时间类触发可进入候选选择；CI 失败、审批通过和依赖完成触发在 MVP 中必须先记录为 `recorded` 或 `blocked`，等待上游 Evidence/Review/Dependency 子系统确认后再进入候选选择。
- 任务图不得包含平台 Skill 或 Subagent 字段。
- Feature done 判定必须同时满足任务 Done、Feature 验收、Spec Alignment Check 和必要测试通过。
- 依赖未完成的 Feature 不得进入 implementing。

## Acceptance Criteria

- [ ] 每个任务都能追踪到来源需求和验收标准。
- [ ] 任务只能处于定义看板列之一。
- [ ] Running 任务完成检测后可进入 Done、Review Needed、Blocked 或 Failed。
- [ ] Feature 进入 review_needed 时记录 approval_needed、clarification_needed 或 risk_review_needed。
- [ ] Feature Scheduler 只调度依赖已满足且边界允许的任务。
- [ ] 手动、指定时间和周期触发能生成可审计的调度触发记录和 scheduler job，并由 Worker 进入候选选择。
- [ ] Redis 不可用时 scheduler health 为 blocked，API 不崩溃。
- [ ] CI 失败、审批通过和依赖完成触发不得绕过 Feature/Task 边界、审批规则或安全策略。

## Risks and Open Questions

- Project Scheduler 的固定规则需要保持可解释，避免引入不可审计的评分黑盒。
- Dashboard Board 的拖拽或批量操作只产生状态机允许的状态变更或调度请求。
- 事件类触发的上游接入仍依赖 CI、Review Center 和依赖检测事件源；当前实现只保留受控记录和边界保护。
- Planning Skill bridge 未实现前，Feature 会停在 blocked；接入 Codex Skill bridge 后，`feature.plan` 应入队 planning CLI run，并在 Evidence/status 回写后推进 Feature。
