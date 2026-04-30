# Tasks: FEAT-004 Scheduler and State Maintenance

- [x] TASK-001: 定义 Feature 和 Task 状态机枚举、合法迁移表和 review_needed reason。
- [x] TASK-002: 实现 Task Graph Builder，生成 task_id、标题、描述、来源需求、验收、允许文件、依赖、并行性、风险、预估工作量和状态。
- [x] TASK-003: 实现 Board State Machine，限定 Backlog、Ready、Scheduled、Running、Checking、Review Needed、Blocked、Failed、Done 和 Delivered。
- [x] TASK-004: 实现 Project Scheduler 和 Feature Selector，动态读取 ready Feature 并记录候选摘要和选择原因。
- [x] TASK-005: 移除平台 Planning Pipeline 执行入口和持久化表。
- [x] TASK-006: 实现 Feature Scheduler，基于任务依赖、风险、文件范围、Runner、worktree、预算、窗口和审批推进任务。
- [x] TASK-007: 实现 Feature Aggregator，聚合任务状态和验收结果。
- [x] TASK-008: 添加状态机测试，覆盖合法迁移、非法迁移、review_needed reason、blocked 和 failed。
- [x] TASK-009: 添加调度测试，验证 Project Memory 不是候选真实来源。
- [x] TASK-010: 定义 Schedule Trigger 模型、触发模式枚举和触发结果，覆盖手动、指定时间、周期和受控事件触发。
- [x] TASK-011: 实现调度触发记录与受控入口，持久化触发模式、触发时间、来源、对象、结果和阻塞原因，并让 accepted 手动/时间触发进入 Feature 选择。
- [x] TASK-012: 添加调度触发测试，验证手动/时间类触发可进入选择，CI/审批/依赖事件不会绕过边界。
- [x] TASK-013: 任务图和调度状态移除 Skill/Subagent 字段。
- [x] TASK-014: 将调度入口重构为 BullMQ + Redis job，固定 queue 为 `specdrive:feature-scheduler` / `specdrive:cli-runner`，并新增 `scheduler_job_records` SQLite 审计事实。
- [x] TASK-015: 将 `schedule_run` 改为只登记 trigger 并 enqueue `feature.select`；Feature selection decision 由 Worker 从 live Feature Pool 选择后产生。
- [x] TASK-016: 实现 `feature.plan` bridge-missing blocked 语义，固定原因 `Planning skill execution bridge is not implemented`，且不生成假 TaskGraph。
- [x] TASK-017: 将 `feature.plan` 接入 Workspace-aware Codex Skill Bridge：bridge 可用时创建 planning Run 并入队 CLI Adapter；项目 workspace 缺失、不可读或缺少所需 Skill 文件时 blocked，且不生成假 TaskGraph。
