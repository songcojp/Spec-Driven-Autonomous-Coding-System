# Tasks: FEAT-004 Orchestration and State Machine

- [x] TASK-001: 定义 Feature 和 Task 状态机枚举、合法迁移表和 review_needed reason。
- [x] TASK-002: 实现 Task Graph Builder，生成 task_id、标题、描述、来源需求、验收、允许文件、依赖、并行性、风险、Skill、Subagent、预估工作量和状态。
- [x] TASK-003: 实现 Board State Machine，限定 Backlog、Ready、Scheduled、Running、Checking、Review Needed、Blocked、Failed、Done 和 Delivered。
- [x] TASK-004: 实现 Project Scheduler 和 Feature Selector，动态读取 ready Feature 并记录候选摘要和选择原因。
- [x] TASK-005: 实现 Planning Pipeline，按顺序调用 technical-context、research-decision、architecture-plan、data-model、contract-design 和 task-slicing Skill。
- [x] TASK-006: 实现 Feature Scheduler，基于任务依赖、风险、文件范围、Runner、worktree、预算、窗口和审批推进任务。
- [x] TASK-007: 实现 Feature Aggregator，聚合任务状态和验收结果。
- [x] TASK-008: 添加状态机测试，覆盖合法迁移、非法迁移、review_needed reason、blocked 和 failed。
- [x] TASK-009: 添加调度测试，验证 Project Memory 不是候选真实来源。
- [ ] TASK-010: 实现调度触发模式记录与受控入口，覆盖立即执行、指定时间、每日、每小时、夜间、工作日、依赖完成、CI 失败和审批通过。
- [ ] TASK-011: 将 `quickstart-validation-skill` 和 `spec-consistency-analysis-skill` 作为 Planning Pipeline 强制阶段执行，失败时进入 Review Needed 并保留证据。
