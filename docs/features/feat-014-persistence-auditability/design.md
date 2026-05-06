# Design: FEAT-014 Persistence and Auditability

## Design Summary

Persistence and Auditability 是跨 Feature 基础能力。SQLite 是 MVP 的运行时 Persistent Store，`.autobuild/` 是人类可读 artifact root，Feature Spec 目录保存 Spec 流程状态文件。Spec / Feature 状态以 `docs/features/<feature-id>/spec-state.json` 为主事实源；SQLite 只保存可恢复的运行事实、命令回执、Evidence 和轻量活动记录。

## Components

| Component | Responsibility |
|---|---|
| Persistent Store | 保存 MVP 运行实体和执行事实；不再作为 Spec 流程状态主事实源。 |
| Scheduler Job Records | 保存 BullMQ job id、queue、job type、target、status、payload、attempts 和错误信息。 |
| Idempotency Manager | 管理 Run、状态、Memory、Evidence 和恢复流程的幂等键。 |
| Activity Timeline | 记录命令、安全、状态变化和交付摘要；操作者排障以 Job、Execution Record、Skill 输出和 Evidence 为主。 |
| Token Consumption Records | 记录每次 CLI / RPC run 从运行 artifact 提取的 token usage、成本、模型、adapter 级价格快照和来源路径，使用 `run_id` 唯一约束避免重复计数和自动重算。 |
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
| Spec / Feature 流程状态 | `docs/features/<feature-id>/spec-state.json` | Spec Workspace、Scheduler、Runner Prompt |
| Runtime 执行状态 | SQLite `scheduler_job_records` + `execution_records` | Runner Console、Evidence、Project Memory 投影 |
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
