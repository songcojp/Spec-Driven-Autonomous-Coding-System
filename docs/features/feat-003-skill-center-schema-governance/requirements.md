# Feature Spec: FEAT-003 Skill Center and Schema Governance

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 4.2 节；第 6.3 节 FR-020 至 FR-023；第 11 节 M1 |
| Requirements | REQ-010, REQ-011, REQ-012, REQ-013 |
| HLD | 7.3 Skill System, 9 Integration and Interface Strategy, 11 Security, Privacy, and Governance |

## Scope

- 注册 Skill 元数据，包括名称、描述、触发条件、输入输出 schema、允许上下文、所需工具、风险等级、适用阶段、成功标准和失败处理规则。
- 初始化 MVP 内置 Skill 清单，并以 PRD 第 6.3 节 FR-021 为唯一事实源。
- 在 Skill 执行前校验 input schema，在执行后校验 output schema。
- 支持 Skill 版本号、变更记录、启用/禁用、项目级覆盖、团队级共享和版本回滚。

## Non-Scope

- 不实现每个 Skill 的完整业务算法。
- 不调度计划流水线；流水线归属 FEAT-004。
- 不展示 Skill Center UI；展示归属 FEAT-013。

## User Value

团队可以把可复用工程方法固化为受治理的 Skill，并用 schema、风险等级和版本记录约束自动化行为。

## Requirements

- 已注册 Skill 必须能被 Orchestrator 查询和匹配。
- MVP Skill 列表、触发条件和 schema 必须与 PRD 第 6.3 节一致。
- schema 校验失败时不得进入下一阶段，必须生成 Evidence Pack 并进入 review_needed 或失败恢复流程。
- 用户可以查看 Skill 版本历史并回滚到可用版本。

## Acceptance Criteria

- [ ] Skill Registry 可以创建、查询和匹配 Skill。
- [ ] MVP 内置 Skill 清单与 PRD 第 6.3 节 FR-021 一致。
- [ ] Skill 输入或输出 schema 校验失败时不会推进状态机。
- [ ] Skill 版本变更可审计，并支持回滚到历史版本。

## Risks and Open Questions

- 内置 Skill 清单需要防止实现和 PRD 漂移。
- 项目级覆盖和团队级共享在 MVP 中可以先实现数据模型，复杂分发策略后置。
