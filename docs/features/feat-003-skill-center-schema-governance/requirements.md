# Feature Spec: FEAT-003 CLI Skill Directory Discovery

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 4.2 节；第 6.3 节 FR-020 至 FR-023；第 11 节 M1 |
| Requirements | REQ-010, REQ-011, REQ-012, REQ-013 |
| HLD | 7.3 Skill System, 9 Integration and Interface Strategy, 11 Security, Privacy, and Governance |

## Scope

- 从项目本地 `.agents/skills/*/SKILL.md` 动态发现 Skill。
- 使用 Skill 目录名作为稳定 slug。
- 读取 `SKILL.md` 中的 name、description 和路径用于 Console 展示。
- Bootstrap 只检查项目本地 Skill 文件是否存在，不再 seed 内置 Skill 到 SQLite。

## Non-Scope

- 不实现 SQL Skill Registry。
- 不实现 Skill input/output schema 校验。
- 不实现 Skill 版本管理、启用/禁用、项目覆盖或团队共享数据模型。
- 不决定 Skill 调用；调用由 Codex CLI 原生机制负责。

## User Value

团队仍然通过项目本地 Skill 固化工程方法，同时避免维护一套与 CLI 原生 Skill 机制重复的注册和校验平台。

## Requirements

- 系统必须能发现 `.agents/skills/<slug>/SKILL.md`。
- 系统必须在 bootstrap readiness 中暴露发现到的项目 Skill 数量。
- Console 必须展示文件系统发现到的 Skill 清单。
- 数据库不得再作为 Skill 注册、schema 校验或版本治理的事实源。

## Acceptance Criteria

- [ ] 项目本地 Skill 文件可以被扫描并按 slug 排序展示。
- [ ] 缺少项目本地 Skill 文件时 bootstrap 返回明确错误。
- [ ] schema v14 移除旧 Skill Registry 相关表。
- [ ] Console Skill Center 不再展示 SQL schema、版本、启用状态或成功率。

## Risks and Open Questions

- Skill 质量治理需要依赖 `SKILL.md` 评审和项目文档约束。
- 如未来需要团队级分发，应优先复用 CLI/plugin/skill 安装机制，而不是恢复 SQL 注册表。
