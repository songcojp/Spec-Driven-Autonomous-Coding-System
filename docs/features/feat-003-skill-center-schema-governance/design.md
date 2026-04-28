# Design: FEAT-003 Skill Center and Schema Governance

## Design Summary

Skill System 提供可复用工程能力的注册、匹配、schema 校验和版本治理。Skill Executor 不直接决定业务状态，而是把校验结果、执行结果和失败证据交给 Orchestration、Evidence Store 和 Review Center。

## Components

| Component | Responsibility |
|---|---|
| Skill Registry | 保存 Skill 元数据并支持按阶段、触发条件、风险等级查询。 |
| MVP Skill Seed | 从 PRD 第 6.3 节 FR-021 初始化内置 Skill。 |
| Schema Validator | 校验 Skill input schema 和 output schema。 |
| Skill Version Manager | 管理版本、启停、项目覆盖、团队共享和回滚。 |
| Skill Run Recorder | 记录 SkillRun、SchemaValidationResult 和执行摘要。 |

## Data Ownership

- Owns: Skill、SkillVersion、SkillRun、SchemaValidationResult。
- Reads: PRD 内置 Skill 清单、项目级 Skill 覆盖配置。
- Emits: Evidence Pack 或状态事件。

## State and Flow

1. 系统初始化 MVP Skill Seed。
2. Orchestrator 根据阶段和触发条件查询 Skill。
3. Skill Executor 校验 input schema。
4. 执行后校验 output schema。
5. 校验失败进入 Review Needed 或 Recovery 路径。
6. 版本变更写入审计和 SkillVersion。

## Dependencies

- FEAT-014 提供持久化和审计。
- FEAT-004 调用计划阶段 Skill。
- FEAT-009 复用 schema 失败 Evidence。

## Review and Evidence

- 新增、删除、重命名内置 Skill 前必须先更新 PRD 第 6.3 节。
- 高风险 Skill 的执行或权限提升必须触发 FEAT-011。
