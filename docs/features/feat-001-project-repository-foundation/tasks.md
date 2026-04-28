# Tasks: FEAT-001 Project and Repository Foundation

- [ ] TASK-001: 定义 Project、RepositoryConnection 和 ProjectHealthCheck 的持久化字段，覆盖 REQ-001 至 REQ-003 的必填项。
- [ ] TASK-002: 实现项目创建命令，保存项目名称、目标、类型、技术偏好、目标仓库、默认分支、运行环境和自动化开关。
- [ ] TASK-003: 实现仓库连接读取逻辑，返回当前分支、最新 commit、未提交变更、当前 PR、CI、任务分支和 worktree 摘要。
- [ ] TASK-004: 实现 Project Health Checker，检测 Git、包管理器、测试命令、构建命令、Codex 配置、AGENTS.md、Spec 目录、未提交变更和敏感文件风险。
- [ ] TASK-005: 将健康检查状态归类为 `ready`、`blocked` 或 `failed`，并持久化原因。
- [ ] TASK-006: 覆盖缺少 Git 仓库的 EDGE-001 流程，确认自动执行被阻止。
- [ ] TASK-007: 添加单元测试或集成测试，验证项目创建、仓库读取和健康检查状态输出。
- [ ] TASK-008: 更新 Dashboard 查询模型所需的项目和仓库状态字段。
