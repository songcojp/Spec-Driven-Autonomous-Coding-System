# Feature Spec: FEAT-001 Project and Repository Foundation

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 6.1 节 FR-001 至 FR-003；第 11 节 M1 |
| Requirements | REQ-001, REQ-002, REQ-003, REQ-059, EDGE-001 |
| HLD | 7.1 Project Management, 10.1 Project Initialization, 12 Observability and Operability |

## Scope

- 创建 AutoBuild 项目并保存项目身份、目标、类型、技术偏好、目标仓库、默认分支、信任级别、运行环境和自动化开关。
- 连接 GitHub、GitLab、本地 Git 或私有 Git 仓库，并读取分支、commit、未提交变更、PR、CI、任务分支和 worktree 状态。
- 导入、创建和版本化项目宪章，并将项目级规则提供给 Project Memory、Scheduler、Review Center 和后续 Feature Spec 流程。
- 执行项目健康检查，覆盖 Git 仓库、包管理器、测试命令、构建命令、Codex 配置、AGENTS.md、Spec Protocol 目录、未提交变更和敏感文件风险。
- 输出 `ready`、`blocked` 或 `failed`，并提供可观察原因。

## Non-Scope

- 不实现完整 Git 平台权限矩阵。
- 不创建 PR 或管理交付报告；交付归属 FEAT-012。
- 不执行 Codex 修改、测试或自动恢复；执行归属 FEAT-008 至 FEAT-010。

## User Value

用户可以把一个真实仓库纳入 AutoBuild 控制面，并在系统开始自动执行前看到项目是否可运行、阻塞在哪里、需要修复哪些基础条件。

## Requirements

- 系统必须能创建和查询 AutoBuild 项目记录。
- 系统必须保存项目信任级别，并让安全策略和调度流程可读取。
- 系统必须支持导入或创建项目宪章，并保留宪章版本记录。
- 系统必须保存仓库连接，并让后续计划、调度和 Runner 流程复用。
- MVP 对 GitHub 状态读取和 PR 创建依赖本机 `gh` CLI 的能力边界，但本 Feature 只负责读取仓库状态。
- 缺少 Git 仓库时必须阻止自动执行，并提示连接或修复仓库。

## Acceptance Criteria

- [ ] 新项目创建后可以被查询，并包含项目身份、信任级别、初始配置和初始状态。
- [ ] 项目宪章可以被 Project Memory、Skill Center、Scheduler、Review Center 和后续 Feature Spec 流程引用。
- [ ] 项目宪章变更触发受影响 Feature 或任务的重新校验。
- [ ] 已连接仓库可以返回当前分支、最新 commit、未提交变更、PR、CI 和 worktree 摘要。
- [ ] 健康检查能返回 `ready`、`blocked` 或 `failed`，且包含原因列表。
- [ ] 缺少 Git 仓库时不会进入自动执行流程。

## Risks and Open Questions

- GitHub、GitLab、本地 Git 和私有 Git 的认证方式差异较大，MVP 应先统一为本地 CLI/路径可观测状态。
- 健康检查命令发现策略需要避免执行破坏性命令。
