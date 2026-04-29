# Feature Spec: FEAT-000 AutoBuild System Bootstrap

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 7 节核心数据模型；第 9.2 节 NFR-003、NFR-004 |
| Requirements | REQ-058, REQ-011, NFR-004 |
| HLD | 5 Technology Stack, 8 Data Domains, 9 Integration (Artifact Root Decision), 13 Deployment and Runtime Topology, 15 Feature Spec Decomposition Guidance |

## Scope

- 创建 `.autobuild/` artifact root 目录树（`memory/`、`specs/`、`evidence/`、`reports/`、`runs/`）。
- 初始化 SQLite Persistent Store，创建 MVP 所需全部表结构，并支持幂等重复初始化和 schema 版本迁移。
- 检查项目本地 `.agents/skills/*/SKILL.md` 是否可发现，确保 CLI Skill Directory 可用。
- 启动 Control Plane 进程，读取并合并运行时配置（端口、artifact root、SQLite 路径、Runner 配置、日志级别）。
- 暴露系统就绪状态（`/health` 或等价机制），供 Dashboard、Runner 和健康检查依赖。
- 支持 NFR-004 要求的崩溃恢复：重启后正确识别已完成初始化状态，不重复创建资源。

## Non-Scope

- 不创建具体业务实体（Project、Feature、Task、Run 等）；业务实体创建属于 FEAT-001 至 FEAT-014。
- 不实现 Dashboard UI；UI 归属 FEAT-013。
- 不实现 Project Memory 初始化；Memory 初始化属于 FEAT-006（REQ-019）。
- 不实现 Skill 执行逻辑；Skill 执行属于 Codex CLI 原生能力。
- 不实现 Runner Worker 进程管理；Runner 归属 FEAT-008。

## User Value

系统管理员或开发者在本地首次运行 AutoBuild 时，Bootstrap 保证运行环境（目录、数据库、项目本地 Skill 文件）自动准备就绪，无需手动初始化步骤，且重启后不会因重复初始化破坏已有数据。

## Requirements

- 系统必须在首次启动时创建 `.autobuild/` 目录树。若目录已存在则跳过，不覆盖已有 artifact。
- 系统必须在首次启动时创建 SQLite schema；若 schema 已存在且版本兼容则跳过；若存在版本差异则执行迁移。
- 系统必须在 schema 初始化完成后检查项目本地 Skill 文件，确保 Skill Center 可用（联动 FEAT-003）。
- 系统必须在 Bootstrap 完成后暴露可观察的就绪状态，以供 Dashboard、Scheduler 和 Health Checker 判断。
- Bootstrap 必须幂等：重复执行或重启后不产生重复资源或破坏性副作用。
- Bootstrap 失败时必须输出可观察的错误原因，并阻止后续业务流程启动。

## Acceptance Criteria

- [ ] 首次启动后 `.autobuild/memory/`、`.autobuild/specs/`、`.autobuild/evidence/`、`.autobuild/reports/`、`.autobuild/runs/` 目录均存在。
- [ ] 首次启动后 SQLite 数据库文件存在，MVP 所需核心表（Project、Feature、Requirement、Task、Run、ProjectMemory、EvidencePack 等）已创建。
- [ ] 重启后重复执行 Bootstrap，不创建重复目录、不重置数据库。
- [ ] Bootstrap 完成后系统就绪接口返回可用状态。
- [ ] Bootstrap 失败（如磁盘权限不足、SQLite 迁移失败）时，系统输出明确错误并拒绝启动业务流程。
- [ ] 项目本地 Skill 文件在 Bootstrap 完成后可被 Skill Center 查询到（联动 FEAT-003 验收）。

## Risks and Open Questions

- Schema 迁移策略：MVP 是否需要完整迁移框架（如 Drizzle migrate / Flyway）还是简单版本号比对？
- CLI Skill Directory 与 FEAT-003 的协作边界：Bootstrap 只做存在性检查，FEAT-003 负责文件系统发现和 Console metadata。
- `.autobuild/` 根目录默认位置已确认：MVP 使用目标仓库根目录下的 `.autobuild/`；若 Control Plane 不在目标仓库根目录启动，必须通过 `AppConfig.artifactRoot` 显式指向目标仓库的 artifact root。
