# Tasks: FEAT-014 Persistence and Auditability

- [x] TASK-001: 设计 SQLite schema，覆盖 Project、Feature、Requirement、Task、Run、ProjectMemory 和 EvidencePack 必填字段。
- [x] TASK-002: 实现 Repository/DAO 层，支持核心实体创建、查询、更新和恢复读取。
- [x] TASK-003: 实现 Idempotency Manager，覆盖 Run、状态转移、Memory 更新、Evidence 写入和恢复流程。
- [x] TASK-004: 实现 Audit Timeline，记录状态、Run、审批、恢复、Memory 压缩、worktree 生命周期和交付事件。
- [x] TASK-005: 实现 Metrics Collector，记录 token、成本、成功率、失败率、看板加载、状态刷新、Evidence 写入和 Runner 心跳。
- [x] TASK-006: 实现 `.autobuild/` artifact 目录约定，覆盖 memory、specs、evidence、reports 和 runs。
- [x] TASK-007: 实现 Recovery Index，支持崩溃后定位未完成 Run、任务、Evidence 和 Memory。
- [x] TASK-008: 添加持久化完整性测试，确认核心实体必填字段可完整读取。
- [x] TASK-009: 添加幂等和崩溃恢复测试，确认重复重放不会产生不可控副作用。
- [x] TASK-010: 添加敏感信息保护测试，确认 token、password、secret、key 和 connection string 不进入普通日志。
- [x] TASK-011: 将 Spec / Feature 流程状态文件化，保留 SQLite 作为 Scheduler Job、Execution Record、logs、Evidence 和轻量 Activity 事实源。
- [x] TASK-012: 将 token 成本计算改为按执行实际 adapter 的 CLI / RPC `defaults.costRates` 生成价格快照，保留已落库 run_id 的历史成本不自动重算。
