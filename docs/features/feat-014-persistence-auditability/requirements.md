# Feature Spec: FEAT-014 Persistence and Auditability

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 7 节核心数据模型；第 9 至 10 节非功能需求和成功指标 |
| Requirements | REQ-058, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009, NFR-010, NFR-011, NFR-012 |
| HLD | 8 Data Domains and Ownership, 11 Security, Privacy, and Governance, 12 Observability and Operability, 13 Deployment and Runtime Topology |

## Scope

- 持久化 MVP 核心实体 Project、Feature、Requirement、Task、Run、ProjectMemory 和 EvidencePack 的必填字段。
- 支持 Run、状态、Memory 和 Evidence 更新的幂等重放。
- 保留任务、Run、Evidence Pack 和 Project Memory 状态以支持崩溃恢复。
- 记录任务、Run、审批和状态变化的审计时间线。
- 统计 token、成本、成功率、失败率、看板加载耗时、状态刷新耗时、Evidence 写入耗时和 Runner 心跳。
- 追踪 MVP 自动化成功指标。

## Non-Scope

- 不实现外部 PostgreSQL 迁移；MVP 采用 SQLite。
- 不实现企业级复杂权限矩阵。
- 不替代各业务 Feature 的领域逻辑。

## User Value

系统具备可靠的状态真实来源、审计追踪和运行指标，使长时间自动化流程可恢复、可解释、可衡量。

## Requirements

- Project、Feature、Requirement、Task、Run、ProjectMemory 和 EvidencePack 的必填字段必须可从持久层完整读取并用于状态恢复。
- SchedulerJobRecord 必须持久化 BullMQ job id、queue、job type、target、status、payload、attempts、error、created/updated 时间。
- 相同 Run 或恢复流程被重放时，必须避免重复产生不可控副作用。
- 调度器或 Runner 崩溃后恢复时，任务不能静默丢失。
- 用户可以查看每次状态变化的时间、原因和来源。
- Dashboard 或相关控制台可以展示成本与成功率指标。
- 系统能报告 PRD 第 10 节列出的 MVP 目标指标。

## Acceptance Criteria

- [ ] 核心实体必填字段全部持久化并可恢复。
- [ ] 调度 job record 能同时展示 Feature Scheduler 和 CLI Runner job 的当前状态。
- [ ] 幂等键覆盖 Run、状态、Memory 和 Evidence 更新。
- [ ] Audit Timeline 记录状态变化、Run、审批、恢复、Memory 压缩、worktree 生命周期和交付事件。
- [ ] Metrics 可以记录成本、成功率、失败率、性能基线和心跳。
- [ ] 崩溃恢复测试不会丢失未完成任务。

## Risks and Open Questions

- SQLite 足够支撑 MVP，但团队协作和远程 Runner 需要后续迁移 PostgreSQL。
- 指标采样不能影响核心状态机的可靠性。
