# Design: FEAT-001 Project and Repository Foundation

## Design Summary

本 Feature 提供项目、项目宪章和仓库接入的控制面基础。Project Service 负责项目实体和初始化命令，Project Constitution Service 负责项目级规则事实源，Repository Adapter 负责读取 Git 事实，Project Health Checker 负责将环境状态归类为可调度状态。

## Components

| Component | Responsibility |
|---|---|
| Project Service | 创建、查询和更新 Project，保存项目配置、信任级别和自动化开关。 |
| Project Constitution Service | 导入、创建和版本化项目宪章，并暴露项目目标、工程原则、边界规则和审批规则。 |
| Repository Adapter | 读取仓库 URL、本地路径、默认分支、当前分支、commit、PR、CI 和 worktree 状态。 |
| Project Health Checker | 检测仓库、包管理器、测试/构建命令、Codex 配置、AGENTS.md、Spec 目录和敏感风险。 |
| Audit Hook | 记录项目创建、仓库连接和健康检查事件。 |

## Data Ownership

- Owns: Project、ProjectConstitution、RepositoryConnection、ProjectHealthCheck。
- Reads: Git CLI、`gh` CLI、文件系统。
- Writes: Persistent Store；必要时写项目初始化事件。

## State and Flow

1. 用户提交项目创建命令。
2. Project Service 持久化 Project 和初始配置。
3. Project Constitution Service 导入或创建项目宪章，并写入版本记录。
4. Repository Adapter 读取仓库状态。
5. Project Health Checker 输出 `ready`、`blocked` 或 `failed`。
6. 状态写入持久层并供 Dashboard、Scheduler、Project Memory 和 Review Center 查询。

## Constitution Follow-up Flow

1. 用户在项目初始化阶段选择导入已有宪章或创建默认宪章。
2. Project Constitution Service 校验宪章包含项目目标、工程原则、边界规则、审批规则和默认约束。
3. 服务写入 ProjectConstitution 当前版本和版本历史，并将版本号绑定到 Project 初始化事实源。
4. 宪章发生变更时，系统记录变更版本并标记受影响 Feature、Task 或 Run 需要重新校验。
5. Project Memory、Scheduler、Review Center 和 Feature Spec 流程按 Project ID 读取当前有效宪章。

## Dependencies

- FEAT-014 提供 Project、RepositoryConnection 和 HealthCheckResult 的持久化能力。
- FEAT-013 负责展示项目健康和仓库摘要。

## Review and Evidence

- 健康检查结果必须能作为 Evidence 或审计事件被引用。
- 检测到敏感文件风险时，应交给 FEAT-011 的 Review Center 或安全策略显示。
- 项目宪章创建、导入和变更必须形成可追踪审计事件，并能指向对应 ProjectConstitution 版本。
