# Design: FEAT-001 Project and Repository Foundation

## Design Summary

本 Feature 提供项目和仓库接入的控制面基础。Project Service 负责项目实体和初始化命令，Repository Adapter 负责读取 Git 事实，Project Health Checker 负责将环境状态归类为可调度状态。

## Components

| Component | Responsibility |
|---|---|
| Project Service | 创建、查询和更新 Project，保存项目配置和自动化开关。 |
| Repository Adapter | 读取仓库 URL、本地路径、默认分支、当前分支、commit、PR、CI 和 worktree 状态。 |
| Project Health Checker | 检测仓库、包管理器、测试/构建命令、Codex 配置、AGENTS.md、Spec 目录和敏感风险。 |
| Audit Hook | 记录项目创建、仓库连接和健康检查事件。 |

## Data Ownership

- Owns: Project、RepositoryConnection、ProjectHealthCheck。
- Reads: Git CLI、`gh` CLI、文件系统。
- Writes: Persistent Store；必要时写项目初始化事件。

## State and Flow

1. 用户提交项目创建命令。
2. Project Service 持久化 Project 和初始配置。
3. Repository Adapter 读取仓库状态。
4. Project Health Checker 输出 `ready`、`blocked` 或 `failed`。
5. 状态写入持久层并供 Dashboard、Scheduler 和 Review Center 查询。

## Dependencies

- FEAT-014 提供 Project、RepositoryConnection 和 HealthCheckResult 的持久化能力。
- FEAT-013 负责展示项目健康和仓库摘要。

## Review and Evidence

- 健康检查结果必须能作为 Evidence 或审计事件被引用。
- 检测到敏感文件风险时，应交给 FEAT-011 的 Review Center 或安全策略显示。
