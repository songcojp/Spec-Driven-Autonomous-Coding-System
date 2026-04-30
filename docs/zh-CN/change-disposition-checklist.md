# 需求新增与变更待处置清单

本文记录从 PRD 与需求文档对比中识别出的新增项和变更项，供人工 Spec 后续流程逐项处置。本文不是通用模板；它是当前这一批问题的待处理清单。

状态说明：

- `待人工确认`：需要你判断是否进入后续 Spec 流程。
- `已写入主线文档`：已进入 PRD、requirements 或 HLD，但仍可能需要人工决定执行策略。
- `需同步实现`：需要后续 Feature Spec、任务或代码实现跟进。
- `需拆分后续 Feature`：不宜塞回已完成 Feature，需要单独形成后续工作。
- `无需执行`：主线文档和已实现/已测试行为已经覆盖，或该项仅为非目标/约束澄清。

## 新增清单

| ID | 新增项 | 来源 | 当前文档状态 | 建议后续处置 |
|---|---|---|---|---|
| ADD-001 | 项目宪章创建、导入和生命周期管理 | PRD 第 5 节阶段 1；FR-021 `project-constitution-skill` | 已写入 `REQ-059`、HLD、FEAT-001；已同步为 FEAT-001 follow-up | 作为已完成 FEAT-001 的 follow-up 处理，不拆独立 Project Constitution Feature；后续实现 `TASK-009` 至 `TASK-011`。 |
| ADD-002 | 调度触发模式 | PRD 第 6.8 节 FR-060 | 已写入 `REQ-060`、HLD、FEAT-004 | MVP 先实现触发记录与手动/定时入口；CI 失败、审批通过和依赖完成先作为受控事件触发记录，不直接绕过边界进入执行。 |
| ADD-003 | Dashboard Board 操作能力 | PRD 第 8.5 节 | 已写入 `REQ-061`、HLD、FEAT-013 | 人工确认拖拽、批量排期、批量运行的 MVP 范围；建议先做受控命令，不直接改状态。 |
| ADD-004 | Product Console UI 多语言切换，默认中文 | 用户指令；PRD 第 8.8 节 | 已写入 `REQ-062`、HLD / Feature Spec design、FEAT-013 | 作为已完成 FEAT-013 的 Product Console patch 处理；需实现语言切换、默认中文、语言偏好持久化和浏览器级验证。 |
| ADD-005 | 项目创建、现有项目导入与多项目切换 | 用户指令；PRD 第 6.1 节 FR-001；PRD 第 8.1 节 | 已写入 `REQ-063`、HLD / Feature Spec design、FEAT-001、FEAT-013 | 作为 FEAT-001 + FEAT-013 联合 patch：FEAT-001 补项目目录、workspace 初始化规则和当前项目上下文，FEAT-013 补导入/新建表单、项目列表和项目切换 UI。 |

## 变更清单

| ID | 变更项 | 来源 | 当前文档状态 | 建议后续处置 |
|---|---|---|---|---|
| CHG-001 | Project 数据模型补充 `trust_level` / 信任级别 | PRD 第 7 节 Project 数据模型；NFR-001 安全策略 | 已增强 `REQ-001`、HLD、FEAT-001 | 人工确认现有 Project schema/实现是否已有字段；如没有，进入后续 schema migration 或 FEAT-001 patch。 |
| CHG-002 | 并行写入策略补全 | PRD 第 6.4 节 FR-032 | 已增强 `REQ-017`、FEAT-007 | 人工确认只读并发、不同文件并发、同文件串行、高风险单 Agent 是否都需要实现为调度规则。 |
| CHG-003 | 计划流水线补充 `quickstart-validation` 与 `spec-consistency-analysis` | PRD 第 6.3 节 FR-021；第 6.6 节 FR-056 | 已增强 `REQ-030`、FEAT-004 | 人工确认这两个 Skill 是内置 Skill 记录即可，还是需要进入 Orchestration 的强制执行步骤。 |
| CHG-004 | Worktree 隔离补充集成测试/E2E 测试资源隔离 | PRD 第 6.8 节 FR-063 | 已增强 `REQ-035`、FEAT-007 | 人工确认测试环境隔离记录落在 Run Contract、Evidence Pack、workspace schema 还是测试运行器配置中。 |
| CHG-005 | Dashboard 基础状态补充 Board 状态入口 | PRD 第 8.1 与 8.5 节 | 已增强 `REQ-052`、FEAT-013 | 人工确认 UI 是否只展示入口，还是在同一 Feature 内实现完整 Board 交互。 |
| CHG-006 | PRD 明确 MVP 不接入 Issue Tracker | PRD 非目标 | 已写入 PRD | 人工确认 requirements/HLD 是否需要补充为显式非目标或约束；当前未新增 REQ。 |
| CHG-007 | PRD 明确失败自动重试上限与退避策略 | PRD 第 6.11 节 FR-092 | 已写入 PRD | 人工确认现有 failure recovery 实现是否已匹配 3 次、2/4/8 分钟退避和失败指纹规则。 |
| CHG-008 | PRD 明确性能阈值在 MVP 中只作基线记录 | PRD 第 9.4 节 | 已写入 PRD | 人工确认 requirements 中 NFR-007 至 NFR-009 是否已足够表达；当前看起来已覆盖。 |
| CHG-011 | 阶段 1 项目初始化自动完成 | 用户指令：项目创建或导入流程应自动完成用户流程第一阶段操作；PRD 第 5 节阶段 1；REQ-063 | 已写入 PRD、requirements、HLD / Feature Spec design、FEAT-001、FEAT-013 | 作为 FEAT-001 + FEAT-013 patch：FEAT-001 编排自动初始化闭环；FEAT-013 展示自动状态和阻塞原因。 |
| CHG-012 | 阶段 2 自动扫描 Spec Sources | 用户指令：阶段 2 自动扫描 PRD、EARS、HLD、Feature Spec 等；PRD 第 5 节阶段 2；REQ-064 | 已写入 PRD、requirements、HLD / Feature Spec design、FEAT-002、FEAT-013 | 作为 FEAT-002 + FEAT-013 patch：FEAT-002 提供扫描模型；FEAT-013 展示扫描状态，且阶段 2 不触发 HLD 生成、Feature Spec 拆分或规划流水线。 |
| CHG-014 | 阶段 2 扫描和上传合并为一个步骤 | 用户指令：spec流程阶段2，spec扫描和上传合成一个步骤，显示扫描、上传两个按钮；REQ-064；FEAT-013 | 已写入 PRD、requirements、HLD / Feature Spec design、FEAT-013 | 作为 FEAT-013 patch：ViewModel 只暴露一个阶段 2 步骤，UI 在该步骤中保留扫描和上传两个按钮及命令回执。 |
| CHG-009 | Product Console 完成标准修正：API/ViewModel 不能替代用户 UI | 用户审查；实现证据 `src/product-console.ts`、`src/server.ts`、`tests/product-console.test.ts` | 已同步 FEAT-013 和技能契约 | 重新打开 FEAT-013；补真实前端应用、页面组件、浏览器级验收，并修复拆分/执行技能避免再次漏 UI。 |
| CHG-015 | Runner 重构为 BullMQ + Redis 调度系统 | 用户指令；实现证据 `src/scheduler.ts`、`src/index.ts`、`src/product-console.ts`、`tests/scheduler.test.ts` | 已写入 PRD、requirements、HLD / Feature Spec design、FEAT-004、FEAT-008、FEAT-013、FEAT-014 | 作为 FEAT-004 / FEAT-008 / FEAT-013 / FEAT-014 联合 patch：`schedule_run` 只入队，`feature.plan` bridge 缺失时 blocked，`cli.run` 由 Worker 执行，SQLite 保存 scheduler job record。 |

## 人工处置顺序建议

1. 先处理 `CHG-007`，因为它可能影响已交付的 Failure Recovery 实现行为。
2. 再处理 `CHG-001` 和 `ADD-001`，因为它们影响项目基础数据和项目初始化流程。
3. 再处理 `ADD-002`、`CHG-002`、`CHG-003`、`CHG-004`，因为它们影响调度和执行安全边界。
4. 最后处理 `ADD-003`、`CHG-005` 和 `CHG-009`，因为它们主要影响 Product Console 交互层。
5. `CHG-006` 和 `CHG-008` 可作为文档一致性检查项，不一定需要立刻形成实现任务。

## 关闭条件

- [x] 每个 `ADD-*` 都已决定：进入现有 Feature patch、拆分新 Feature、暂缓或拒绝。
- [x] 每个 `CHG-*` 都已决定：只保留文档、同步 Feature Spec、修改实现、补测试或无需动作。
- [x] 影响已完成 Feature 的项已形成 follow-up、Spec Evolution 或 reopening 记录。
- [x] 需要实现的项已写入对应 Feature Spec 或任务。
- [x] 无需实现的项已在人工审查记录中说明原因。

## 本次处置记录

| ID | 处理结论 | 下游同步 | 状态 |
|---|---|---|---|
| ADD-001 | 进入现有 FEAT-001 patch，不拆分新 Feature。 | 已在 FEAT-001 requirements、design、tasks 中标记项目宪章 follow-up，并保留 `REQ-059` 追踪。 | 需同步实现 |
| ADD-002 | 进入 FEAT-004 patch；MVP 已实现触发模式记录与受控入口，手动/时间类触发进入 BullMQ Feature 选择 job，CI 失败、审批通过和依赖完成作为可记录触发源，不要求接入外部 CI/审批系统。 | 已在 FEAT-004 requirements/design/tasks、Feature Index、实现和测试中覆盖 `REQ-060`；`schedule_run` 受控命令会记录 trigger 并入队 `feature.select`，Feature Selection Decision 由 Worker 执行后产生。 | 已同步实现 |
| ADD-003 | 进入 FEAT-013 patch；MVP 支持受状态机约束的拖拽意图、批量排期和批量运行命令，不允许 UI 直接改状态或写 Git。 | 已在 FEAT-013 requirements/design 覆盖 `REQ-061`；需补充 FEAT-013 patch 任务并实现受控命令/审计。 | 需同步实现 |
| ADD-004 | 进入 FEAT-013 patch；Product Console 首次打开默认中文，并支持用户切换界面语言且保留偏好。 | 已在 PRD、requirements、HLD / Feature Spec design、Feature Index、FEAT-013 requirements/design/tasks、Product Console UI 和浏览器级测试覆盖 `REQ-062`。 | 已同步实现 |
| ADD-005 | 进入 FEAT-001 与 FEAT-013 patch；系统需支持导入现有项目、在统一 `workspace/` 目录下创建新项目、项目目录、当前项目上下文和项目级 UI 切换，所有查询、命令、Memory 投影和调度入口按 `project_id` 隔离。 | 已在 PRD、requirements、HLD / Feature Spec design、Feature Index、FEAT-001 requirements/design/tasks 和 FEAT-013 requirements/design/tasks 覆盖 `REQ-063`；FEAT-013 UI 已实现并通过浏览器测试，FEAT-001 持久化上下文仍需后续执行。 | 需同步实现 |
| CHG-001 | 进入 FEAT-001 patch；当前代码未发现 `trust_level` project schema 字段，需补 schema、创建输入、查询输出和安全/调度可读路径。 | FEAT-001 requirements 已包含信任级别；需补充 FEAT-001 patch 任务并执行实现。 | 需同步实现 |
| CHG-002 | 进入 FEAT-007 patch；并行写入策略按 MVP 固化为：只读可并行、不同文件可并行、同文件/同分支默认串行、高风险单 Agent。 | FEAT-007 requirements 已覆盖策略；需补充 FEAT-007 patch 任务并实现/验证调度可消费的隔离判定。 | 需同步实现 |
| CHG-003 | 进入 FEAT-004 patch；`quickstart-validation` 与 `spec-consistency-analysis` 不只是 Skill Catalog 记录，计划流水线必须在对应阶段执行或显式阻塞。 | FEAT-004 requirements/design 已覆盖；需补充 FEAT-004 patch 任务并实现强制阶段。 | 需同步实现 |
| CHG-004 | 进入 FEAT-007 patch；测试资源隔离记录落在 Run Contract 与 Evidence Pack，workspace schema 保存可审计边界，测试运行器配置作为执行输入。 | FEAT-007 requirements 已覆盖；需补充 FEAT-007 patch 任务并实现隔离记录/校验。 | 需同步实现 |
| CHG-005 | 并入 FEAT-013 patch；Board 状态入口与 ADD-003 同批处理，先展示真实任务状态和入口，再通过受控命令排期/运行。 | FEAT-013 requirements/design 已覆盖；与 ADD-003 共用 patch 任务。 | 需同步实现 |
| CHG-006 | 仅保留文档一致性；PRD、requirements、HLD 和 Feature Spec design 已明确 MVP 不接入 Issue Tracker，仅保留外部链接/追踪字段。 | 无需新增 REQ 或 Feature Spec；后续实现不得新增 Issue Tracker 深度集成。 | 无需执行 |
| CHG-007 | 已由 FEAT-010 实现覆盖；代码和测试已包含同一失败模式最多 3 次、2/4/8 分钟退避、失败指纹和禁止重复策略。 | FEAT-010 requirements/design/tasks 与 `tests/recovery.test.ts` 已覆盖；无需重新执行 feature spec。 | 无需执行 |
| CHG-008 | 仅保留文档一致性；PRD、requirements 和 HLD 已明确性能阈值在 MVP 中作为基线记录，不作为阻塞验收门槛。 | 无需新增 Feature Spec；FEAT-013 继续记录看板加载/状态刷新基线。 | 无需执行 |
| CHG-011 | 进入 FEAT-001 / FEAT-013 patch；阶段 1 由系统在创建或导入项目后自动完成初始化闭环。 | 已同步 PRD、REQ-063、HLD / Feature Spec design、Feature Index、FEAT-001 requirements/design/tasks 和 FEAT-013 requirements/design/tasks。 | 需同步实现 |
| CHG-012 | 进入 FEAT-002 / FEAT-013 patch；阶段 2 自动扫描 Spec Sources，扫描 HLD / Feature Spec 事实源但不生成 HLD 或拆分 Feature Spec。 | 已新增 REQ-064，并同步 PRD、HLD / Feature Spec design、Feature Index、FEAT-002 requirements/design/tasks 和 FEAT-013 requirements/design/tasks。 | 需同步实现 |
| CHG-014 | 进入 FEAT-013 patch；阶段 2 将 Spec 扫描和上传合并为一个“Spec 扫描与上传”步骤，并在同一步骤内提供“扫描”和“上传”两个按钮。 | 已同步 PRD、REQ-064、HLD / Feature Spec design、FEAT-013 requirements/design/tasks、Product Console UI 和浏览器级测试。 | 已同步实现 |
| CHG-009 | 重新打开 FEAT-013；当前 API/ViewModel 只能作为 Product Console 后端契约，不能替代用户可操作 UI。 | 已更新 FEAT-013 requirements/design/tasks、Feature Index 和 `task-slicing-skill` / `codex-coding-skill` 技能契约。 | 需同步实现 |
| CHG-015 | 进入 FEAT-004 / FEAT-008 / FEAT-013 / FEAT-014 patch；调度需求由 BullMQ + Redis 承载，SQLite 继续作为业务事实和审计源。 | 已同步 PRD、requirements、HLD / Feature Spec design、Feature Index、FEAT-004 requirements/design/tasks、FEAT-008 requirements/design/tasks、FEAT-013 requirements/tasks 和 FEAT-014 requirements/design；实现和测试已覆盖。 | 已同步实现 |

## Feature Spec Execute 评估

| 优先级 | Feature | 触发项 | 建议执行方式 | 说明 |
|---|---|---|---|---|
| P0 | FEAT-001 Project and Repository Foundation | ADD-001、ADD-005、CHG-001 | 执行 `codex-coding-skill` patch | 已完成 Feature 出现数据模型、项目宪章和多项目上下文 follow-up；需补 schema/API/tests。 |
| P1 | FEAT-004 Orchestration and State Machine | CHG-003 | 执行后续 `codex-coding-skill` patch | ADD-002 已完成；计划流水线强制阶段仍需后续处理。 |
| P1 | FEAT-004 / FEAT-008 / FEAT-013 / FEAT-014 Scheduler Integration | CHG-015 | 已执行 patch | BullMQ + Redis 调度、scheduler job record、`feature.select` / `feature.plan` / `cli.run` Worker 和 Console 队列状态已实现；后续只剩 Codex Skill planning bridge。 |
| P1 | FEAT-007 Workspace Isolation | CHG-002、CHG-004 | 执行 `codex-coding-skill` patch | 并行写入和测试资源隔离属于执行安全边界。 |
| P2 | FEAT-013 Product Console | ADD-003、ADD-005、CHG-005、CHG-009 | 执行 `codex-coding-skill` patch | 必须交付真实浏览器 UI、页面路由、组件系统、项目切换入口和浏览器级验收；现有 API/ViewModel 不足以标记完成。 |
| - | FEAT-010 Failure Recovery | CHG-007 | 不执行 | 已实现且测试覆盖。 |
| - | 主线文档一致性 | CHG-006、CHG-008 | 不执行 | 非目标和性能基线约束已在文档中表达。 |
