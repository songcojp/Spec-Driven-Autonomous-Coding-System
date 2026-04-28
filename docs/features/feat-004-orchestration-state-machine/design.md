# Design: FEAT-004 Orchestration and State Machine

## Design Summary

Orchestration 是控制面核心。它从 Feature Spec Pool 读取候选，执行计划流水线，生成 Task Graph，维护 Feature/Task 状态机，并根据检测、审批、恢复和交付结果推进状态。

## Components

| Component | Responsibility |
|---|---|
| Project Scheduler | 动态读取 ready Feature 候选并选择下一 Feature。 |
| Feature Selector | 基于优先级、依赖完成、验收风险和 ready 时长输出选择原因。 |
| Planning Pipeline | 调用计划阶段 Skill 并生成可执行计划结果。 |
| Task Graph Builder | 生成任务图和任务依赖。 |
| Board State Machine | 维护任务看板列和合法状态迁移。 |
| Feature State Machine | 维护 Feature 生命周期和 review_needed reason。 |
| Feature Scheduler | 在 Feature 内推进可执行任务。 |
| Feature Aggregator | 聚合任务状态并判断 Feature done/blocked/failed/implementing。 |

## Data Ownership

- Owns: FeatureSelectionDecision、TaskGraph、Task、TaskSchedule、StateTransition。
- Reads: Feature Spec Pool、Skill Registry、Workspace 状态、Runner 可用性、Review 决策、StatusCheckResult。
- Writes: Persistent Store、Project Memory 选择摘要、Audit Timeline。

## State and Flow

1. Project Scheduler 触发。
2. Feature Selector 从 Feature Spec Pool 动态计算 ready 候选。
3. 选中的 Feature 进入 `planning`。
4. Planning Pipeline 运行计划阶段 Skill。
5. Task Graph Builder 生成任务图，Feature 进入 `tasked`。
6. Feature Scheduler 调度满足依赖的任务。
7. Status Checker、Review Center 或 Recovery Manager 回写结果后触发状态聚合。

## Dependencies

- FEAT-002 提供 Feature Spec Pool 和需求来源。
- FEAT-003 提供计划阶段 Skill。
- FEAT-007 提供 worktree 可用性和冲突边界。
- FEAT-009 提供状态检测结果。
- FEAT-014 提供状态幂等和审计。

## Review and Evidence

- 所有状态转换必须记录触发原因、来源证据和时间。
- Feature done 不允许只依赖任务卡片完成，必须等待 StatusCheckResult 和验收聚合。
