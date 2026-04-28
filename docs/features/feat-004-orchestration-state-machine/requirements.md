# Feature Spec: FEAT-004 Orchestration and State Machine

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 6.6 至 6.8 节 FR-050 至 FR-064；第 11 节 M2 |
| Requirements | REQ-024, REQ-025, REQ-026, REQ-027, REQ-028, REQ-029, REQ-030, REQ-031, REQ-032, REQ-033, REQ-034 |
| HLD | 7.4 Orchestration and State Machine, 10.3 Autonomous Execution Loop, 14 Testing and Quality Strategy |

## Scope

- 生成包含来源需求、验收、允许文件、依赖、并行性、风险、所需 Skill、Subagent 和状态的任务图。
- 维护任务看板列和任务状态自动流转。
- 维护 Feature 状态机，覆盖 `draft`、`ready`、`planning`、`tasked`、`implementing`、`done`、`delivered`、`review_needed`、`blocked` 和 `failed`。
- Project Scheduler 从 Feature Spec Pool 动态选择 ready Feature。
- Feature Scheduler 根据依赖、风险、文件范围、Runner 可用性、worktree 状态、成本预算、执行窗口和审批要求推进任务。
- 计划流水线自动调用技术上下文、研究决策、架构计划、数据模型、契约设计和任务切片 Skill。

## Non-Scope

- 不执行 Codex CLI；执行归属 FEAT-008。
- 不进行状态检测实现；检测归属 FEAT-009。
- 不提供 UI 拖拽或展示实现；展示归属 FEAT-013。

## User Value

系统可以从一组 ready Feature 中自动选择下一项工作，把 Feature 拆成可追踪任务，并用状态机让长时间自主执行可审计、可暂停、可恢复。

## Requirements

- Project Scheduler 不得依赖 Project Memory 中的静态候选队列作为真实来源。
- Feature 选择必须记录候选摘要、选择原因和 Memory 摘要。
- 任一计划阶段失败时 Feature 进入 Review Needed 并保留失败证据。
- Feature done 判定必须同时满足任务 Done、Feature 验收、Spec Alignment Check 和必要测试通过。
- 依赖未完成的 Feature 不得进入 implementing。

## Acceptance Criteria

- [ ] 每个任务都能追踪到来源需求和验收标准。
- [ ] 任务只能处于定义看板列之一。
- [ ] Running 任务完成检测后可进入 Done、Review Needed、Blocked 或 Failed。
- [ ] Feature 进入 review_needed 时记录 approval_needed、clarification_needed 或 risk_review_needed。
- [ ] Feature Scheduler 只调度依赖已满足且边界允许的任务。

## Risks and Open Questions

- Project Scheduler 的固定规则需要保持可解释，避免引入不可审计的评分黑盒。
- Dashboard 是否允许拖拽改变状态仍待确认；本 Feature 默认仅支持受控状态命令。
