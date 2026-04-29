# Feature Spec: FEAT-003 Retired - Platform Skill Center Removed

## Status

Retired by the 2026-04-29 product boundary update.

## Decision

SpecDrive AutoBuild 不再提供平台级 Skill 注册、发现、调用、schema 校验、版本治理、bootstrap readiness 校验或 Skill Center UI。项目本地 `.agents/skills/*/SKILL.md` 可继续作为 Codex CLI 的外部工作流文件存在，但不属于平台数据模型、调度契约或 Console 功能。

## Replacement Scope

- Bootstrap readiness 不再检查项目 Skill 数量。
- SQLite 最终 schema 不保留 `skills`、`skill_versions`、`skill_runs` 或 `skill_project_overrides`。
- Product Console 不再提供 Skill Center 页面或 `/console/skills` API。
- 调度和状态维护不得依赖 `required_skill_slug` 字段。

## Acceptance Criteria

- [ ] 平台初始化不要求存在项目本地 Skill 文件。
- [ ] Console 导航和 API 不暴露 Skill Center。
- [ ] 当前任务图、调度和恢复记录不包含平台 Skill 调用字段。
