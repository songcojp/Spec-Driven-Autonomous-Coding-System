# Tasks: FEAT-001 Project and Repository Foundation

- [x] TASK-001: 定义 Project、RepositoryConnection 和 ProjectHealthCheck 的持久化字段，覆盖 REQ-001 至 REQ-003 的必填项。
- [x] TASK-002: 实现项目创建命令，保存项目名称、目标、类型、技术偏好、目标仓库、默认分支、运行环境和自动化开关。
- [x] TASK-003: 实现仓库连接读取逻辑，返回当前分支、最新 commit、未提交变更、当前 PR、CI、任务分支和 worktree 摘要。
- [x] TASK-004: 实现 Project Health Checker，检测 Git、包管理器、测试命令、构建命令、Codex 配置、AGENTS.md、Spec 目录、未提交变更和敏感文件风险。
- [x] TASK-005: 将健康检查状态归类为 `ready`、`blocked` 或 `failed`，并持久化原因。
- [x] TASK-006: 覆盖缺少 Git 仓库的 EDGE-001 流程，确认自动执行被阻止。
- [x] TASK-007: 添加单元测试或集成测试，验证项目创建、仓库读取和健康检查状态输出。
- [x] TASK-008: 更新 Dashboard 查询模型所需的项目和仓库状态字段。
- [x] TASK-009: 实现 Project Constitution 创建/导入命令，校验项目目标、工程原则、边界规则、审批规则和默认约束，并绑定到 Project 初始化事实源。
- [x] TASK-010: 实现 ProjectConstitution 版本记录和审计事件，支持查询当前有效版本与历史版本。
- [x] TASK-011: 在宪章变更后标记受影响 Feature、Task 或 Run 需要重新校验，并让 Project Memory、Scheduler、Review Center 和 Feature Spec 流程可读取当前宪章。
- [x] TASK-012: 补充 Project `trust_level` schema、创建输入、查询输出和默认值，并让安全策略与调度流程可读取该信任级别。
- [ ] TASK-013: 实现项目目录查询，支持多个 AutoBuild 项目导入、新建、列出、生命周期状态和最近活动时间。
- [ ] TASK-014: 实现 ProjectSelectionContext，保存当前项目、切换来源和最近切换时间，并让查询层可读取。
- [ ] TASK-015: 为项目级查询、健康检查、Project Memory 初始化、Feature 选择、调度入口和 Evidence 查询增加 `project_id` 隔离校验与阻塞反馈。
- [ ] TASK-016: 实现项目初始化目录规则：导入现有项目保留用户目录，新建项目统一创建到 `workspace/<project-slug>`，并初始化 `.autobuild/`。
- [ ] TASK-017: 将项目创建/导入命令编排为阶段 1 自动初始化闭环，自动完成仓库探测或连接、Spec Protocol、项目宪章、Project Memory、健康检查和当前项目上下文，失败时返回结构化阻塞原因。
- [ ] TASK-018: 添加单元或集成测试，验证创建新项目和导入现有项目后阶段 1 自动初始化完成；覆盖宪章缺失、Spec Protocol 初始化失败和健康检查 blocked 的反馈。
