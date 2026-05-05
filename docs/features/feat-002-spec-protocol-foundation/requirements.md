# Feature Spec: FEAT-002 Spec Protocol Foundation

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 4.1 节；第 6.2 节 FR-010 至 FR-015；第 11 节 M1 |
| Requirements | REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-064, EDGE-002, EDGE-003, EDGE-007 |
| HLD | 7.2 Spec Protocol Engine, 10.2 Requirement Intake to Ready Feature, 14 Testing and Quality Strategy |

## Scope

- 从自然语言、PR、RP、PRD、EARS 或混合输入创建 Feature Spec。
- 自动扫描 PRD、EARS、requirements、HLD、design、已有 Feature Spec、tasks 和 README / 索引等 Spec Sources，并形成需求录入事实输入。
- 将输入拆解为原子化、可测试、可追踪的 EARS 需求。
- 按 feature、user story、requirement、acceptance criteria 和 related files 生成 Spec Slice。
- 拆分 Feature Spec 时固化通用规格规则：若目标项目需要“项目初始化 / Project Initialization”作为第一个 Feature Spec，该 Feature Spec 必须包含项目根目录 `.gitignore` 创建或安全更新要求。
- 维护 Clarification Log、Requirement Checklist 和 Spec Version。
- 阻止未通过 checklist 的 Feature 自动进入 `ready`。

## Non-Scope

- 不执行计划阶段 Skill；计划流水线归属 FEAT-004。
- 不注册或执行 Skill；Skill 治理归属 FEAT-003。
- 不实现 UI 展示；Spec Workspace 归属 FEAT-013。

## User Value

产品经理和开发者可以把原始需求变成可审查、可测试、可切片、可版本化的 Feature Spec，使后续自动编码不会基于模糊输入行动。

## Requirements

- Feature Spec 必须包含名称、目标、角色、用户故事、优先级、验收场景、需求、成功指标、实体、假设、不做范围和风险点。
- Spec Sources 扫描必须识别 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引等来源类型、路径、来源追踪、缺失项、冲突项和澄清项。
- 每条 EARS 需求只描述一个可观察行为，并映射到 Feature Spec、验收标准和测试场景。
- 歧义输入必须生成带状态和来源上下文的 Clarification Log。
- Requirement Checklist 必须覆盖完整性、清晰度、一致性、可测量性、场景覆盖、边界条件、非功能属性、依赖、假设、歧义和冲突。
- Spec 变更必须按 MAJOR、MINOR 或 PATCH 规则生成版本记录。
- Spec / Feature 流程状态必须以 `docs/features/<feature-id>/spec-state.json` 作为机器可读事实源；Markdown 继续作为人类阅读和评审入口。
- 项目初始化类首个 Feature Spec 必须要求创建或安全更新项目根目录 `.gitignore`；缺失时创建，已存在时只追加缺失的本地运行产物忽略规则，不得覆盖用户已有内容。

## Acceptance Criteria

- [ ] 每个生成的 Feature Spec 都能追踪到输入来源，并包含可审查验收信息。
- [ ] 阶段 2 自动扫描结果可以作为 EARS 生成、澄清和需求质量检查的输入，且不触发 HLD 生成、Feature Spec 拆分或规划流水线。
- [ ] 每条需求只描述一个可观察行为，并能追踪到 Feature、验收标准和测试场景。
- [ ] Coding Agent 默认只能读取当前任务相关的 Spec 切片。
- [ ] 当拆分结果包含项目初始化作为首个 Feature Spec 时，生成的 `requirements.md`、`design.md` 和 `tasks.md` 都包含 `.gitignore` 创建或安全更新的需求、设计约束和实现任务。
- [ ] 未通过 checklist 的 Feature 不得自动进入 `ready`。
- [ ] Spec 版本记录能说明版本号、变更类型和变更原因。
- [ ] `spec-state.json` 能记录 status、dependencies、blocked reasons、current job、last result、next action 和 history，并拒绝 workspace 外路径。

## Risks and Open Questions

- 重复 Feature 的判定需要在语义相似度和人工确认之间保持保守。
- Spec Slice 的粒度会直接影响 Subagent 上下文质量，需要在 FEAT-005 中做端到端验证。

## Spec Evolution

- CHG-012 / REQ-064 作为本 Feature 的 Spec Sources 扫描 patch 处理；FEAT-013 负责展示扫描状态和用户可见反馈。
- CHG-043 / REQ-006 固化为 Feature Spec 拆分规则：项目初始化类首个 Feature Spec 必须包含 `.gitignore` 创建或安全更新要求，不限定于当前 SpecDrive 项目自身。
