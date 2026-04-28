# Tasks: FEAT-014 Persistence and Auditability

- [ ] TASK-001: 设计 SQLite schema，覆盖 Project、Feature、Requirement、Task、Run、ProjectMemory 和 EvidencePack 必填字段。
- [ ] TASK-002: 实现 Repository/DAO 层，支持核心实体创建、查询、更新和恢复读取。
- [ ] TASK-003: 实现 Idempotency Manager，覆盖 Run、状态转移、Memory 更新、Evidence 写入和恢复流程。
- [ ] TASK-004: 实现 Audit Timeline，记录状态、Run、审批、恢复、Memory 压缩、worktree 生命周期和交付事件。
- [ ] TASK-005: 实现 Metrics Collector，记录 token、成本、成功率、失败率、看板加载、状态刷新、Evidence 写入和 Runner 心跳。
- [ ] TASK-006: 实现 `.autobuild/` artifact 目录约定，覆盖 memory、specs、evidence、reports 和 runs。
- [ ] TASK-007: 实现 Recovery Index，支持崩溃后定位未完成 Run、任务、Evidence 和 Memory。
- [ ] TASK-008: 添加持久化完整性测试，确认核心实体必填字段可完整读取。
- [ ] TASK-009: 添加幂等和崩溃恢复测试，确认重复重放不会产生不可控副作用。
- [ ] TASK-010: 添加敏感信息保护测试，确认 token、password、secret、key 和 connection string 不进入普通日志。
