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
- [x] TASK-010: 定义 Schedule Trigger 模型、触发模式枚举和触发结果，覆盖手动、指定时间、周期和受控事件触发。
- [x] TASK-011: 实现调度触发记录与受控入口，持久化触发模式、触发时间、来源、对象、结果和阻塞原因，并让 accepted 手动/时间触发进入 Feature 选择。
- [x] TASK-012: 添加 ADD-002 调度触发测试，验证手动/时间类触发可进入选择，CI/审批/依赖事件不会绕过边界。
- [ ] TASK-013: 将 `quickstart-validation-skill` 和 `spec-consistency-analysis-skill` 作为 Planning Pipeline 强制阶段执行，失败时进入 Review Needed 并保留证据。
