# 项目级 Skill 说明

本文说明当前项目级 Skill 的用途、调用边界、输入输出和协作关系。项目级 Skill 的源文件位于 `.agents/skills/<skill-name>/SKILL.md`，本文是面向产品、设计、实现与评审流程的导航说明，不替代具体 Skill 文件。

## 使用原则

1. 普通问答、简单阅读、小范围文档修正和直接缺陷修复，默认使用普通 Codex 工作流。
2. 只有当用户明确点名 Skill、明确要求项目工作流，或任务需要受治理的 SpecDrive 流程时，才调用项目级 Skill。
3. 新能力优先判断应写成 Skill 还是代码：
   - 如果能力是提示驱动的规划、拆解、分析、评审或上下文收集，优先写成 Skill。
   - 如果能力需要持久状态、结构性约束、状态机、审计记录或可机器查询输出，才写成代码。
4. Skill 产物必须保持可追踪：需求 ID、Feature Spec、任务、证据和交付记录之间要能互相定位。
5. 当仓库事实与规格文档冲突时，先走规格演进或需求新增流程，不要绕过规格直接编码。

## 生命周期视图

| 阶段 | 主要 Skill | 目的 |
| --- | --- | --- |
| 项目治理 | `project-constitution-skill` | 建立项目目标、仓库边界、信任级别、审批规则和受保护路径。 |
| 需求生成 | `pr-ears-requirement-decomposition-skill` | 将 PRD、PR/RP 或自然语言产品输入拆成可测试的 EARS 需求。 |
| 需求变更 | `requirement-intake-skill`, `spec-evolution-skill`, `ambiguity-clarification-skill` | 处理新增需求、已有需求修订和阻塞性歧义。 |
| 需求质量门 | `requirements-checklist-skill` | 检查需求是否原子、可观察、可测试、可追踪。 |
| 项目级设计 | `create-project-hld`, `ui-spec-skill` | 生成项目 HLD、页面清单、UI Spec 和概念图。 |
| Feature 规划 | `technical-context-skill`, `research-decision-skill`, `architecture-plan-skill`, `data-model-skill`, `contract-design-skill`, `quickstart-validation-skill`, `task-slicing-skill`, `spec-consistency-analysis-skill` | 从 Feature Spec 进入技术上下文、决策、架构、数据、契约、可启动性、任务拆分和一致性检查。 |
| 自主执行选择 | `feature-selection-skill` | 从 Feature Spec Pool 中推理选择下一项可执行 Feature。 |
| 实现与验证 | `feat-implement-skill`, `test-execution-skill`, `failure-recovery-skill` | 在受控范围内实现、运行测试、处理失败恢复。 |
| 评审与交付 | `review-report-skill`, `pr-generation-skill`, `workflow-hook-skill` | 生成评审结论、提交/PR、生命周期副作用和审计证据。 |

## Spec => Skill Contract

所有由 Spec Workspace、Feature Pool 或 Runner 调起的项目级 Skill 均通过 `ExecutionAdapterInvocationV1.skillInstruction` 接收任务指令。Adapter 输入必须包含 `workspaceRoot`、Feature 级上下文、当前 `specState`、traceability、constraints、输出 schema，以及 `skillInstruction` 中的 `skillSlug`、`requestedAction`、`sourcePaths`、`expectedArtifacts` 和可选操作员输入。Skill 不应从数据库推断 Spec 状态。

Skill 输出必须使用 `SkillOutputContractV1`，包含 `status`、`summary`、`nextAction`、`producedArtifacts`、Feature 级 traceability 和 result。Runner 校验输出后将状态投影回 `docs/features/<feature-id>/spec-state.json`，同时把执行事实保存在 Execution Record、runner heartbeats 和 raw logs 中。通用输出 Contract 的机器真源在调用端 schema；项目级 Skill 文档只补充本技能 `result` 的专用字段语义，供 Execution Workbench 分组展示执行详情。

## Skill 清单

### 需求与规格类

| Skill | 当前内容状态 | 何时使用 | 主要输入 | 主要输出 |
| --- | --- | --- | --- | --- |
| `pr-ears-requirement-decomposition-skill` | 较完整 | PRD、PR/RP、产品 brief 或自然语言输入需要转为 EARS 需求时。 | PRD、产品请求、功能 brief、语言路径。 | `US-*` 用户故事、`REQ-*`、`NFR-*`、`EDGE-*`、追踪矩阵、开放问题。 |
| `requirement-intake-skill` | 较完整 | 新增一个尚不存在的需求、用户故事、能力、约束或边界条件时。 | 用户输入、PRD、requirements、HLD、Feature Spec。 | 新需求 ID、受影响文档、验收标准、下游同步说明。 |
| `spec-evolution-skill` | 较完整 | 已存在的 `REQ-*`、`NFR-*`、`EDGE-*` 需要修订、废弃、澄清或被证据推翻时。 | 现有需求、变更证据、实现/测试/评审结果。 | 变更分类、更新文档、影响范围、评审路由和残余风险。 |
| `ambiguity-clarification-skill` | 较完整 | 需求、验收、数据边界、API、UI、安全或交付责任存在阻塞性歧义时。 | PRD、requirements、Feature Spec、设计、任务、最新证据。 | 阻塞问题、非阻塞假设、规格更新建议、后续路由。 |
| `requirements-checklist-skill` | 基础骨架 | Feature Spec 进入 ready 或规划消费需求前。 | requirements、PRD 来源、验收标准、开放问题。 | 通过/失败结论、按 ID 列出的缺口、需澄清或风险评审项。 |

### 设计与规划类

| Skill | 当前内容状态 | 何时使用 | 主要输入 | 主要输出 |
| --- | --- | --- | --- | --- |
| `create-project-hld` | 较完整 | Spec Workspace 触发生成或重建项目级 HLD 时。 | `docs/zh-CN/PRD.md`、`requirements.md`、现有 HLD、Feature 索引、仓库事实。 | `docs/zh-CN/hld.md`，包含 17 个固定章节、需求覆盖、架构边界和风险。 |
| `ui-spec-skill` | 较完整 | HLD 已存在，需要生成 UI Spec 和主要页面概念图时。 | PRD、EARS requirements、HLD、Feature index、目标 featureId。 | `docs/ui/ui-spec.md` 或 `docs/features/<featureId>/ui-spec.md`，以及 `docs/ui/concepts/*.png`。 |
| `technical-context-skill` | 基础骨架 | Feature 进入规划后的第一步，需要收集仓库事实、命令、模块和约束。 | Feature requirements、design、tasks、HLD、Feature index、仓库文件。 | 技术上下文摘要、现有模式、候选实现面、风险与未知项。 |
| `research-decision-skill` | 基础骨架 | 规划中需要对依赖、实现方式或技术方案做有界决策时。 | HLD、仓库约定、需求、技术上下文。 | 决策结论、选择理由、拒绝方案、影响文件和测试。 |
| `architecture-plan-skill` | 基础骨架 | Feature requirements 需要转成可实现的技术计划时。 | Feature requirements、design、HLD、技术上下文、研究决策。 | Feature 架构计划、组件边界、状态/错误/审计行为、实现约束。 |
| `data-model-skill` | 基础骨架 | Feature 涉及持久化、迁移、状态记录、视图模型、事件、证据或审计时。 | requirements、feature design、HLD 数据域、现有 schema/model。 | 实体字段、迁移计划、生命周期规则、测试和证据要求。 |
| `contract-design-skill` | 基础骨架 | 需要 API、CLI、事件、文件、ViewModel、Skill 输入或证据契约时。 | requirements、design、HLD 接口策略、技术上下文、现有接口模式。 | 契约摘要、字段形状、校验与错误行为、兼容性说明、契约测试。 |
| `quickstart-validation-skill` | 基础骨架 | 任务拆分前确认实现路径可启动、可测试、符合项目宪法时。 | 架构计划、数据模型、契约计划、仓库命令、`memory/constitution.md` 或等价文件。 | go/blocked 决策、命令检查、测试可行性、宪法合规结论、阻塞项。 |
| `task-slicing-skill` | 较完整 | 将 PRD/EARS/HLD 拆成 Feature Specs，或维护 Feature Spec 内的 `tasks.md` 执行清单时。 | PRD、EARS、HLD、Feature planning 输出、现有 Feature Spec。 | `docs/features/<feature-id>/requirements.md`、`design.md`、`tasks.md`、Feature 索引和 `feature-pool-queue.json`。 |
| `spec-consistency-analysis-skill` | 基础骨架 | 规划结束或实现前，检查 requirements、design、tasks、数据模型、契约和 quickstart 是否一致。 | Feature requirements、design、tasks、HLD、全部规划输出。 | 一致性结论、需求到任务覆盖表、矛盾或陈旧假设、修复项。 |

### 实现、测试与恢复类

| Skill | 当前内容状态 | 何时使用 | 主要输入 | 主要输出 |
| --- | --- | --- | --- | --- |
| `feature-selection-skill` | 基础骨架 | 自主执行循环需要从 Feature Pool Queue 中选择下一项可执行 Feature 时。 | `feature-pool-queue.json`、Feature index、各 Feature `spec-state.json`、依赖完成情况、最近 Execution Record、resume/skip hints。 | `select_next_feature` 决策：selected/none/blocked、featureId、reason、blockedReasons、dependencyFindings、resumeRequiredFeatures、skippedFeatures。 |
| `feat-implement-skill` | 基础骨架 | 有已批准 Feature Spec、设计约束、允许文件范围和验证命令的受控实现；Feature 级执行可直接读取 Feature Spec 目录，不要求平台 task 表。 | Feature Spec 目录（`requirements.md`、`design.md`、`tasks.md`）、限制性需求、设计约束、允许文件范围、验证命令。 | 代码/测试/配置/必要文档变更、验证结果、残余风险、`SkillOutputContractV1`。 |
| `test-execution-skill` | 基础骨架 | 需要目标测试、回归测试、浏览器测试、构建或验收验证时。 | 任务/Feature 验收标准、仓库测试命令、运行环境。 | 命令结果、失败分类、Status Checker 可消费证据、下一步建议。 |
| `failure-recovery-skill` | 基础骨架 | 任务失败、命令失败、状态检查失败或 Runner 报错后，需要受限恢复时。 | 失败类型、失败命令、摘要、相关文件、fingerprint、历史尝试、重试上限。 | 恢复分类、执行动作、变更文件或重试命令、验证证据、剩余重试预算。 |

### 评审、交付与钩子类

| Skill | 当前内容状态 | 何时使用 | 主要输入 | 主要输出 |
| --- | --- | --- | --- | --- |
| `review-report-skill` | 中等完整 | 需要代码、规格或交付评审结论，尤其需要检查实现是否偏离 `REQ-*` 时。 | diff、requirements、design、tasks、测试证据、Review Center 上下文。 | 阻塞问题、建议项、规格漂移发现、证据引用、审批或修复建议。 |
| `pr-generation-skill` | 基础骨架 | 实现、测试、评审完成后，需要提交、推送和创建 PR 时。 | 干净的目标 diff、Feature/任务范围、验证证据、远端配置。 | commit hash、分支、PR URL 或失败证据、交付说明。 |
| `workflow-hook-skill` | 中等完整 | 生命周期状态变化只需要执行一个确定的副作用时。 | 触发事件、当前状态、目标副作用、相关证据。 | 触发事件、已执行副作用、幂等键或重复处理说明、失败路由。 |

### 仓库探查与治理类

| Skill | 当前内容状态 | 何时使用 | 主要输入 | 主要输出 |
| --- | --- | --- | --- | --- |
| `repo-probe-skill` | 基础骨架 | 需要只读探索仓库事实、文件归属、命令、依赖或实现模式时。 | 明确的问题、Feature、模块或文件集合。 | 有证据的仓库事实、相关路径和命令、可复用约定、未知项。 |
| `project-constitution-skill` | 基础骨架 | 建立或更新项目章程、目标、边界、默认分支、信任级别或治理基线时。 | PRD、requirements、仓库元数据、现有 constitution。 | 项目身份、仓库和分支契约、信任/审批规则、评审路由、证据追踪。 |

## 推荐调用顺序

### 新产品需求进入系统

1. `pr-ears-requirement-decomposition-skill`
2. `requirements-checklist-skill`
3. `create-project-hld`
4. `ui-spec-skill`，仅当产品存在 UI 或控制台页面。
5. `task-slicing-skill`
6. `spec-consistency-analysis-skill`

### 单个 Feature 进入实现前规划

1. `technical-context-skill`
2. `research-decision-skill`
3. `architecture-plan-skill`
4. `data-model-skill`，仅当涉及数据、状态、事件、证据或审计。
5. `contract-design-skill`，仅当涉及接口、文件、事件、ViewModel 或 Skill 契约。
6. `quickstart-validation-skill`
7. `task-slicing-skill`
8. `spec-consistency-analysis-skill`

### 已规划任务进入编码交付

1. `feat-implement-skill`
2. `test-execution-skill`
3. `failure-recovery-skill`，仅当验证失败且允许恢复。
4. `review-report-skill`
5. `pr-generation-skill`
6. `workflow-hook-skill`，用于状态更新、证据挂载、审计记录或最终快照。

## 当前补充优先级

当前 Skill 文件已经有名称、description 和基础流程，但以下 Skill 仍偏“骨架化”，后续应优先补充输入契约、产物模板、质量门和示例：

1. `technical-context-skill`
2. `research-decision-skill`
3. `architecture-plan-skill`
4. `data-model-skill`
5. `contract-design-skill`
6. `requirements-checklist-skill`
7. `quickstart-validation-skill`
8. `spec-consistency-analysis-skill`
9. `feat-implement-skill`
10. `test-execution-skill`
11. `failure-recovery-skill`
12. `pr-generation-skill`
13. `repo-probe-skill`
14. `project-constitution-skill`

优先补充顺序建议遵循执行风险：先补规划和一致性检查类，再补编码、测试和交付类。这样可以先把“什么应该被做、什么不能被做”固定下来，再让执行类 Skill 消费这些边界。

## 维护规则

1. 新增 Skill 时，同时更新本文的清单、生命周期视图和推荐调用顺序。
2. 修改 Skill 行为边界时，同步更新 `AGENTS.md`、相关 Feature Spec、HLD 或变更管理文档。
3. Skill 如果新增机器可消费产物，应说明产物路径、JSON 结构、必填字段、失败路由和验证方式。
4. Skill 如果只是提示工作流，不应在代码中硬编码同等逻辑；代码只负责校验、持久化、状态机和证据归档。
5. 对已有 Skill 做大幅扩展时，应保留旧触发语义，除非通过 `spec-evolution-skill` 明确记录破坏性变更。
