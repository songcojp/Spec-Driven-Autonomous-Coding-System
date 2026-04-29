# Design: FEAT-003 CLI Skill Directory Discovery

## Design Summary

Skill 调用、触发和上下文交付由 Codex CLI 原生处理。SpecDrive 只发现项目本地 `.agents/skills/*/SKILL.md`，用于 bootstrap readiness、Console 展示和编排说明，不再维护 SQL Skill Registry、schema 校验、版本回滚或项目覆盖。

## Components

| Component | Responsibility |
|---|---|
| Skill Directory Discovery | 扫描 `.agents/skills/<slug>/SKILL.md`，以目录名作为稳定 slug。 |
| Skill Metadata Reader | 从 `SKILL.md` frontmatter 读取 name、description 和文件路径。 |
| Bootstrap Skill Check | 确认项目至少存在一个本地 Skill 文件。 |
| Console Skill View | 展示文件系统发现到的 Skill 清单，不展示 SQL schema、版本或成功率。 |

## Data Ownership

- Owns: 无 SQL Skill 数据；Skill 源文件归 `.agents/skills/*/SKILL.md` 所有。
- Reads: 项目本地 Skill 文件。
- Emits: bootstrap readiness 和 Console 查询模型。

## State and Flow

1. Bootstrap 初始化 artifact 和 schema。
2. Skill Directory Discovery 扫描项目本地 `.agents/skills`。
3. 若没有可用 `SKILL.md`，bootstrap 返回可观测错误。
4. Console 按文件系统事实展示 Skill，不参与执行调度。

## Dependencies

- FEAT-000 提供 bootstrap 入口。
- Codex CLI 原生 Skill 机制负责发现、调用、上下文和执行。

## Review and Evidence

- 不允许重新引入 SQL Skill Registry、schema_validation_results、skill_versions 或 skill_project_overrides。
- Skill 行为治理应写入 `SKILL.md` 和项目文档，而不是数据库注册表。
