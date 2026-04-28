# Tasks: FEAT-008 Codex Runner

- [ ] TASK-001: 定义 RunnerPolicy、RunnerHeartbeat、CodexSessionRecord 和 RawExecutionLog 数据模型。
- [ ] TASK-002: 实现 Runner Queue Worker，读取可执行 Run 并更新运行状态。
- [ ] TASK-003: 实现 Runner Policy Resolver，解析 sandbox、approval、model、profile、output schema、workspace root 和 session resume。
- [ ] TASK-004: 实现 Codex CLI Adapter，采集 JSON event stream、命令输出、session id 和退出状态。
- [ ] TASK-005: 实现默认安全配置，确认自动执行不使用 `danger-full-access` 或 bypass approvals。
- [ ] TASK-006: 实现 Safety Gate Adapter，阻止高风险文件、危险命令、敏感配置和权限提升。
- [ ] TASK-007: 实现 Runner 心跳，每 10 至 30 秒更新状态。
- [ ] TASK-008: 添加 Runner Policy、安全阻断、心跳和输出采集测试。
