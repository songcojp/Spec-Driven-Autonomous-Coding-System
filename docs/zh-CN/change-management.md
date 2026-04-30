# 需求新增与变更处理机制

本文定义当 PRD、需求文档、HLD、Feature Spec、实现证据或人工审查暴露新增需求、需求缺口、需求变更或覆盖不足时，后续应如何分诊、落地、验证和提交。

每批变更完成机制判断后，使用 [需求新增与变更待处置清单](change-disposition-checklist.md) 区分新增项和变更项，并交给人工 Spec 流程决定后续动作。

## 1. 触发来源

以下任一情况都必须进入本机制：

- PRD 与 `requirements.md` 对比后发现缺失、覆盖不足或数据模型字段遗漏。
- 实现、测试、代码审查、交付报告或运行证据暴露原需求不准确、不可测试或不可实现。
- 用户明确提出新增能力、约束、页面、状态、数据字段、边界场景或非功能要求。
- Feature Spec 执行中发现已拆分任务与当前 PRD/REQ/HLD 不一致。
- 审批、风险评审或项目宪章变更影响现有需求、设计或执行范围。

## 2. 分诊分类

每个变更项先建立一条分诊记录，至少包含：

| 字段 | 说明 |
|---|---|
| 来源 | PRD 段落、用户指令、review finding、测试结果、delivery report、实现证据或审批决定。 |
| 类型 | `ADD`、`CHANGE`、`DEPRECATE`、`CLARIFY`、`TRACEABILITY_FIX`。 |
| 版本级别 | `MAJOR`、`MINOR`、`PATCH`。 |
| 影响 ID | 受影响的 `REQ-*`、`NFR-*`、`EDGE-*`、Feature Spec 或 HLD section。 |
| 风险路由 | `none`、`clarification_needed`、`risk_review_needed`、`approval_needed`。 |
| 处理状态 | `triaged`、`documenting`、`downstream_sync`、`reviewing`、`ready_to_commit`、`blocked`。 |

版本级别判定：

- `MAJOR`：改变产品目标、核心边界、架构方向、交付模型、兼容性合同或安全/审批模型。
- `MINOR`：新增用户故事、能力、约束、页面、状态、数据字段、调度策略或验收范围。
- `PATCH`：修正文案、追踪矩阵、验收细节、开放问题、来源映射或非行为性说明。

## 3. 处理路径

### 3.1 新增需求

使用 `requirement-intake-skill` 技能，并按以下顺序处理：

1. 确认事实源：优先定位 PRD 段落、用户指令或明确证据。
2. 判断 ID 类型：功能行为进入 `REQ-*`，质量属性进入 `NFR-*`，错误/边界/恢复路径进入 `EDGE-*`。
3. 若改变产品范围、页面、数据模型、里程碑、风险或非目标，先更新 PRD。
4. 更新 `requirements.md`：新增稳定 ID、来源、优先级、EARS statement 和可测试验收。
5. 更新追踪矩阵、MVP 映射和开放问题。
6. 若影响架构、数据所有权、状态机、接口、安全、调度或技术栈，更新 `hld.md`；`design.md` 已作废，不再作为同步目标。
7. 若影响可执行拆分，更新 `docs/features/README.md` 和受影响 Feature Spec。

### 3.2 需求变更

使用 `spec-evolution-skill` 技能，并按以下顺序处理：

1. 定位被变更需求的当前事实源和所有引用位置。
2. 判断是否保持原 ID：语义相同则保留 ID；语义替换则标记 superseded/deprecated，并新增 ID。
3. 若来自实现、测试、review 或交付证据，记录证据来源和影响范围。
4. 更新 PRD、`requirements.md`、HLD、Feature Spec，顺序与新增需求一致。
5. 如果影响 active 或 done 的 Feature Spec，必须更新 Feature Spec 状态或备注，避免后续执行沿用旧假设。

### 3.3 覆盖缺口修复

当问题来自“PRD 已有，但 requirements/HLD/Feature Spec 未覆盖”时：

1. 不优先修改 PRD，除非 PRD 本身不清楚或与事实冲突。
2. 在 `requirements.md` 中补齐 REQ/NFR/EDGE 或增强既有需求。
3. 同步追踪矩阵和 MVP 映射。
4. 同步 HLD requirement coverage、子系统职责和 Feature Spec decomposition。
5. 同步受影响 Feature Spec 的 `requirements.md`、`design.md`，必要时同步 `tasks.md`。

## 4. 下游同步清单

每次新增或变更需求后，必须逐项检查：

- [ ] PRD 是否需要更新产品范围、页面、数据模型、风险、非目标或里程碑。
- [ ] `requirements.md` 是否有稳定 ID、来源、优先级、EARS statement 和验收。
- [ ] 追踪矩阵是否包含新增或变更的 ID。
- [ ] MVP 映射是否仍反映交付顺序。
- [ ] HLD requirement coverage 是否包含新增或变更的 ID。
- [ ] HLD 子系统职责、数据所有权、状态机、接口或安全策略是否需要同步。
- [ ] `docs/zh-CN/hld.md` 是否需要同步受控命令、接口、代码职责、数据所有权、状态机、安全策略、调度或技术栈。
- [ ] `docs/features/README.md` 是否需要更新 Primary Requirements、依赖或状态。
- [ ] 受影响 Feature Spec 的 `requirements.md` 是否同步 scope、requirements 和 acceptance。
- [ ] 受影响 Feature Spec 的 `design.md` 是否同步组件、数据、流程、依赖和证据。
- [ ] 受影响 Feature Spec 的 `tasks.md` 是否需要新增、重开或标记后续任务。
- [ ] active/done Feature 是否需要标记 stale、needs-sync、follow-up 或 reopening。
- [ ] 开放问题是否新增、关闭或改为 review routing。

## 5. Feature 状态处理

当新增或变更影响 Feature Spec 时，按 Feature 当前状态处理：

| Feature 状态 | 处理方式 |
|---|---|
| `todo` / `ready` | 直接同步 requirements/design/tasks 和 feature index。 |
| `in-progress` | 暂停执行，更新任务边界，必要时要求 clarification 或 risk review。 |
| `done` | 不直接改实现结论；新增 follow-up、Spec Evolution 或重新打开任务，并记录为什么 done 结果受影响。 |
| `delivered` | 通过 Spec Evolution 记录新版本，并生成后续 Feature 或 patch 需求。 |

## 6. 审查与阻塞规则

以下情况不得直接进入 `ready_to_commit`：

- 需求意图、用户价值、验收或技术边界不清楚。
- 变更影响架构、审批规则、安全策略、项目宪章或高风险文件。
- 新需求缺少来源证据或无法追踪到 PRD/用户指令/实现证据。
- 变更使已完成 Feature 的验收结论失效，但没有下游处理记录。
- PRD、requirements、HLD 和 Feature Spec 对同一行为描述冲突。

路由规则：

- 意图或验收不清楚：`clarification_needed`。
- 扩大范围、影响架构/依赖/实现证据：`risk_review_needed`。
- 涉及权限、安全、项目宪章、审批规则或高风险操作：`approval_needed`。

## 7. 提交与记录

建议把提交按职责拆分：

1. 主线规格提交：PRD、`requirements.md`、HLD。
2. Feature Spec 同步提交：`docs/features/README.md` 和受影响 feature folders。
3. 技能或机制提交：`.agents/skills/*` 或本文档。
4. 实现提交：代码、测试和迁移。

提交前必须执行：

- [ ] `git diff --check`
- [ ] 搜索新增/变更 ID，确认主线文档和下游 Feature Spec 都能被找到。
- [ ] 检查工作区是否有用户或其他任务留下的无关修改。
- [ ] 在提交说明中写明变更类型、影响 ID 和是否包含下游同步。

## 8. 最小行动清单

处理每个新增或变更项时，至少完成以下步骤：

1. 记录来源和分类。
2. 判断是新增、变更、废弃、澄清还是追踪修复。
3. 分配版本级别和风险路由。
4. 更新主线文档。
5. 同步追踪矩阵与 MVP 映射。
6. 同步 HLD。
7. 同步 Feature Spec。
8. 处理 active/done/delivered Feature 的状态影响。
9. 跑一致性搜索和 `git diff --check`。
10. 按职责拆分提交。
