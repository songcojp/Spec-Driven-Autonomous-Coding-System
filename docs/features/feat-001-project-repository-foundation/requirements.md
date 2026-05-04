# Feature Spec: FEAT-001 Project and Repository Foundation

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 6.1 节 FR-001 至 FR-003；第 11 节 M1 |
| Requirements | REQ-001, REQ-002, REQ-003, REQ-059, REQ-063, EDGE-001 |
| HLD | 7.1 Project Management, 10.1 Project Initialization, 12 Observability and Operability |

## Scope

- 创建 AutoBuild 项目并保存项目身份、目标、类型、技术偏好、目标仓库、默认分支、信任级别、运行环境和自动化开关。
- 维护项目目录、项目生命周期状态和当前项目选择上下文，支持导入现有项目、在统一 `workspace/` 目录下创建新项目，以及多个项目切换。
- 连接 GitHub、GitLab、本地 Git 或私有 Git 仓库，并读取分支、commit、未提交变更、PR、CI、任务分支和 worktree 状态。
- 在用户选择导入现有项目或创建新项目后，自动完成仓库探测或连接、`.autobuild/` / Spec Protocol、项目宪章、Project Memory、健康检查和当前项目上下文初始化。
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
- 系统必须能列出多个 AutoBuild 项目，并保存当前项目选择上下文。
- 系统必须把新建项目目录统一创建在 `workspace/` 目录下；导入项目必须保留用户填写的现有项目目录。
- 系统首次连接新的 `.autobuild/autobuild.db` 时必须以空项目列表作为真实初始状态，不得把内置示例项目或其他数据库中的历史项目合并到真实项目列表。
- 系统必须将项目目录规范化为绝对路径，并在 Project 记录和 Repository Connection 持久层强制唯一；重复路径必须阻止创建并返回已有项目标识。
- Demo 数据只能作为用户显式触发的种子导入写入持久层；导入后不得自动切换当前项目。
- 系统必须在项目创建或导入后自动完成阶段 1 初始化闭环，并只在无法自动完成时返回阻塞原因。
- 系统必须保存项目信任级别，并让安全策略和调度流程可读取。
- 系统必须支持导入或创建项目宪章，并保留宪章版本记录。
- 系统必须保存仓库连接，并让后续计划、调度和 Runner 流程复用。
- MVP 对 GitHub 状态读取和 PR 创建依赖本机 `gh` CLI 的能力边界，但本 Feature 只负责读取仓库状态。
- 缺少 Git 仓库时必须阻止自动执行，并提示连接或修复仓库。

## Acceptance Criteria

- [ ] 新项目创建后可以被查询，并包含项目身份、信任级别、初始配置和初始状态。
- [ ] 多个项目可以被创建、导入、列出和切换，且切换后返回当前项目上下文。
- [ ] 新建项目目录位于 `workspace/<project-slug>`；导入项目目录指向用户填写的已有路径。
- [ ] 首次安装或空数据库启动时项目列表为空，内置示例数据不会混入真实项目列表。
- [ ] 同一规范化项目目录不能被两个项目或两个仓库连接重复绑定；重复创建返回冲突和已有项目 ID。
- [ ] Demo 种子导入幂等，重复导入不会创建重复项目，导入成功后刷新列表但不自动切换项目。
- [ ] 项目创建或导入后自动完成仓库探测或连接、`.autobuild/` / Spec Protocol、项目宪章、Project Memory、健康检查和当前项目上下文初始化。
- [ ] 项目级查询、健康检查、Project Memory 初始化和调度入口必须携带当前 `project_id`。
- [ ] 项目宪章可以被 Project Memory、Skill Center、Scheduler、Review Center 和后续 Feature Spec 流程引用。
- [ ] 项目宪章变更触发受影响 Feature 或任务的重新校验。
- [ ] 已连接仓库可以返回当前分支、最新 commit、未提交变更、PR、CI 和 worktree 摘要。
- [ ] 健康检查能返回 `ready`、`blocked` 或 `failed`，且包含原因列表。
- [ ] 缺少 Git 仓库时不会进入自动执行流程。

## Risks and Open Questions

- GitHub、GitLab、本地 Git 和私有 Git 的认证方式差异较大，MVP 应先统一为本地 CLI/路径可观测状态。
- 健康检查命令发现策略需要避免执行破坏性命令。

## Spec Evolution

- ADD-001 已确认作为本 Feature 的 follow-up 处理，不拆分独立 Project Constitution Feature。
- FEAT-001 原完成结论保持不变；项目宪章创建、导入、版本记录和下游重新校验能力进入 patch 任务。
- ADD-005 / REQ-063 作为本 Feature 的项目基础 patch 处理，补项目目录、当前项目选择上下文和项目级命令隔离；Product Console 入口由 FEAT-013 同步。
- CHG-011 / REQ-063 明确阶段 1 不再是用户逐步执行的手动流程；Project Service 必须在创建或导入后自动完成初始化闭环，失败时提供可观察阻塞原因。
