# Design: FEAT-014 Persistence and Auditability

## Design Summary

Persistence and Auditability 是跨 Feature 基础能力。SQLite 是 MVP 的 Persistent Store，`.autobuild/` 是人类可读 artifact root。所有状态变化先持久化，再触发副作用；审计和指标围绕 Run、Task、Feature、Evidence、Review 和 Delivery 形成可恢复记录。

## Components

| Component | Responsibility |
|---|---|
| Persistent Store | 保存 MVP 核心实体和状态真实来源。 |
| Scheduler Job Records | 保存 BullMQ job id、queue、job type、target、status、payload、attempts 和错误信息。 |
| Idempotency Manager | 管理 Run、状态、Memory、Evidence 和恢复流程的幂等键。 |
| Audit Timeline | 记录状态变化、Run、审批、恢复、Memory 压缩、worktree 生命周期和交付事件。 |
| Token Consumption Records | 记录每次 CLI run 从 `stdout.json` 提取的 token usage、成本、模型、价格快照和来源路径，使用 `run_id` 唯一约束避免重复计数。 |
| Metrics Collector | 记录成功率、失败率、性能基线和心跳；不承载 token 或成本消费事实。 |
| Artifact Store | 在 `.autobuild/` 保存 Memory、Spec、Evidence、Report 和 Run 元数据。 |
| Recovery Index | 支持崩溃后恢复任务、Run、Evidence 和 Memory。 |

## Data Ownership

- Owns: Project、Feature、Requirement、Task、Run、ProjectMemory、EvidencePack、SchedulerJobRecord 的持久化基础；AuditTimelineEvent、MetricSample、TokenConsumptionRecord、IdempotencyKey。
- Reads/Writes: 所有 Feature 的状态和 artifact 引用。
- Does Not Own: Git 事实、调度决策业务规则、Runner 执行策略。

## Storage Strategy

| Data | Source of Truth | Projection |
|---|---|---|
| Feature / Task 状态 | SQLite | Dashboard、Project Memory、Delivery Report |
| Project Memory | `.autobuild/memory/project.md` + SQLite 版本索引 | Codex CLI 注入 |
| Evidence | SQLite + `.autobuild/evidence/` | Review、Recovery、Delivery |
| Scheduler Job | SQLite `scheduler_job_records` | BullMQ/Redis queue state、Runner Console |
| Token / Cost 消费 | SQLite `token_consumption_records` | Dashboard、Project Home、Runner Console、Spec Workspace |
| Delivery Report | SQLite 记录 + `.autobuild/reports/` | PR 和人工审查 |
| Run 元数据 | SQLite + `.autobuild/runs/` | Recovery Bootstrap |

## Dependencies

- 所有 Feature 依赖本 Feature 的实体、幂等、审计和指标能力。
- FEAT-013 消费 TokenConsumption、Metrics 和 Audit 查询。

## Review and Evidence

- 仓库凭据、密钥和连接串不得写入 Project Memory、Evidence 或普通日志。
- 审计日志需要记录来源证据，但避免保存未脱敏敏感内容。
