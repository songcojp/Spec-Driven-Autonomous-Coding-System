# Tasks: FEAT-010 Failure Recovery

- [ ] TASK-001: 定义 RecoveryTask、FailureFingerprint、ForbiddenRetryRecord 和 RetrySchedule 数据模型。
- [ ] TASK-002: 实现 Recovery Router，区分可自动恢复、需审批和不可恢复失败。
- [ ] TASK-003: 实现失败模式指纹生成，覆盖 task_id、阶段、命令或检查项、规范化错误摘要和相关文件集合。
- [ ] TASK-004: 实现 Retry Scheduler，最多 3 次，退避时间为 2、4、8 分钟。
- [ ] TASK-005: 实现 Forbidden Retry Guard，阻止重复失败方案、命令和文件范围。
- [ ] TASK-006: 实现 RecoveryTask 到 failure-recovery-skill 的调用输入。
- [ ] TASK-007: 实现恢复结果处理，支持自动修复、回滚、拆分、只读分析、审批、Spec 更新和依赖更新。
- [ ] TASK-008: 添加测试，覆盖重复失败停止、退避计划、禁止重复策略和 Evidence 记录。
