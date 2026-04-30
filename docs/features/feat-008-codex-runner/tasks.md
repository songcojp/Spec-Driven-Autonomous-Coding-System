# Tasks: FEAT-008 Codex Runner

- [x] TASK-001: 定义 RunnerPolicy、RunnerHeartbeat、CodexSessionRecord 和 RawExecutionLog 数据模型。
- [x] TASK-002: 实现 Runner Queue Worker，读取可执行 Run 并更新运行状态。
- [x] TASK-003: 实现 Runner Policy Resolver，解析 sandbox、approval、model、profile、output schema、workspace root 和 session resume。
- [x] TASK-004: 实现 Codex CLI Adapter，采集 JSON event stream、命令输出、session id 和退出状态。
- [x] TASK-005: 实现默认安全配置，确认自动执行不使用 `danger-full-access` 或 bypass approvals。
- [x] TASK-006: 实现 Safety Gate Adapter，阻止高风险文件、危险命令、敏感配置和权限提升。
- [x] TASK-007: 实现 Runner 心跳，每 10 至 30 秒更新状态。
- [x] TASK-008: 添加 Runner Policy、安全阻断、心跳和输出采集测试。
- [ ] TASK-009: 将 Codex CLI 调用升级为 Runner CLI Adapter，定义 `CliAdapterConfig` JSON schema、默认 `codex-cli` 配置和 active/draft/invalid 状态。
- [ ] TASK-010: 实现 CLI Adapter 配置校验和 dry-run，覆盖命令模板变量、必填字段、workspace root、安全策略、output mapping 和 session resume 映射。
- [ ] TASK-011: 将 Runner Queue Worker 接入 active CLI Adapter，确保无 active adapter 或配置无效时新 Run blocked，且不影响 running Run。
- [ ] TASK-012: 添加 CLI Adapter 配置、dry-run、active 配置回退、Codex 等价命令生成和无效配置阻塞测试。
- [x] TASK-013: 将 Runner Queue Worker 接入 BullMQ `specdrive:cli-runner` / `cli.run`，由 Worker 调用现有 Codex runner 并持久化 heartbeat、session、raw log、Evidence 和 task/run 状态。
