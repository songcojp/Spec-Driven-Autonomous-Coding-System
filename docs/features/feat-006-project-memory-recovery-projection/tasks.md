# Tasks: FEAT-006 Project Memory and Recovery Projection

- [ ] TASK-001: 定义 ProjectMemory、MemoryVersionRecord 和 MemoryCompactionEvent 数据模型。
- [ ] TASK-002: 实现 `.autobuild/memory/project.md` 初始化模板。
- [ ] TASK-003: 实现 `[PROJECT MEMORY]` 注入内容生成，覆盖当前任务、看板快照、上次 Run、阻塞、禁止操作和待审批事项。
- [ ] TASK-004: 实现基于 Evidence、StatusCheckResult 和 StateTransition 的幂等 Memory 更新。
- [ ] TASK-005: 实现 8000 tokens 预算压缩策略，并保留当前任务、状态快照、阻塞和禁止操作。
- [ ] TASK-006: 实现 Memory 版本记录、查看和回滚索引。
- [ ] TASK-007: 实现 Recovery Bootstrap，恢复未完成 Run、Running/Scheduled 任务、Runner 心跳、worktree、Codex session、Evidence 和 Memory。
- [ ] TASK-008: 添加 Memory 过期冲突测试，确认以 Persistent Store、Git 和文件系统为准。
- [ ] TASK-009: 添加幂等重放测试，确认重复 Run 更新不会产生重复副作用。
