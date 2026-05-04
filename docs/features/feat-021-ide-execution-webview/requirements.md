# FEAT-021 IDE Workbench Webviews — 需求

Feature ID: FEAT-021
Feature 名称: IDE Workbench Webviews
状态: done
里程碑: M8
依赖: FEAT-016、FEAT-019、FEAT-020

## 目标

为 VSCode 插件开发三组独立 Webview Web UI，不复用当前 Product Console Web UI。三组 UI 分别面向执行控制、Spec 全流程控制和 Feature Spec 总览，使用户在 VSCode 内直接完成 Job 调度、自动执行、Spec 生命周期推进、审批处理、Feature 状态观察和阻塞定位。

## 来源需求

| 需求 ID | 描述 | 来源 |
|---|---|---|
| REQ-084 | 提供独立 VSCode IDE Webview 工作台 | VSCode 插件 PRD REQ-VSC-017 |

## 变更记录

- CHG-024（2026-05-03）：用户要求 VSCode Feature Spec Webview 顶部 New Feature 输入提交后进入需求新增或需求变更流程，由模型自行判定；刷新时同时同步 Feature index 与 Feature 文件夹；需求新增 Skill 必须写入 Feature index；点击 Feature 后详情解析 `tasks.md` 并展示任务状态。影响 REQ-084 和 FEAT-021，已作为 follow-up 完成。
- CHG-025（2026-05-03）：用户要求 VSCode Feature Spec Webview 中状态为 `need review` / `review_needed` 的 Feature Spec 提供 Review 入口；点击后弹出澄清输入框，提交后进入需求澄清流程；Feature Spec 详情不再展示 Evidence 项。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。
- CHG-026（2026-05-03）：用户要求 VSCode Feature Spec Webview 调整分类显示顺序和展示方式：改为横向分类 panel，支持点击折叠/展开；`Block / in-process / Todo` 合并为一个 panel，`Ready` 单独一个 panel，`Done` 单独一个 panel，且 Done 默认折叠、其它默认展开。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。
- CHG-027（2026-05-03）：用户要求在 VSCode Feature Spec Webview 的 Refresh 按钮后增加 `Dependency Graph` 入口；点击后显示 Feature 依赖关系图，并以树状层级关系展示。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。
- CHG-028（2026-05-03）：用户要求 VSCode Feature Spec Webview 不显示 `Feature Index Sync` 信息。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订；刷新仍保留 Feature index 与目录扫描合并能力，但界面移除独立同步信息区块。
- CHG-029（2026-05-03）：用户要求 Feature panel 中的 Feature list 自适应换行，不出现 panel 内垂直滚动条，也不出现水平滚动条。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。
- CHG-030（2026-05-03）：用户要求 VSCode Feature Spec Webview 将 Dependency Graph 入口移到第一个按钮前，并改为 `Feature List` / `Dependency Graph` 视图模式切换；依赖图谱树状节点支持折叠和展开，默认展开二级节点。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。
- CHG-031（2026-05-03）：用户要求 Feature 分类 panel 增加展开和折叠状态图标。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。
- CHG-032（2026-05-03）：用户要求 `Blocked`、`In-Process`、`Todo` 拆分为三个独立 Feature 分类 panel，不再合并展示。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。
- CHG-033（2026-05-03）：用户要求 `Feature List` 和 `Dependency Graph` 合并为一个按钮，点击后修改按钮文字并切换视图。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。
- CHG-034（2026-05-03）：用户确认 VSCode Feature Spec Webview 中 Feature 身份必须从 `docs/features/README.md` 获取，数据库 Feature 记录和非 index 目录不得生成 Feature 列表项；目录扫描只用于校验 index 中的 folder 和读取三件套。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。
- CHG-035（2026-05-04）：用户反馈点击 Clarification 后任务队列中没有出现技能调用任务；澄清提交必须进入 `ambiguity-clarification-skill` 调度队列，而不是只记录 `update_spec` 回执。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。
- CHG-036（2026-05-04）：用户要求 VSCode Execution Workbench 顶部任务操作必须基于选中任务启用；部分按钮必须按选中任务状态切换，例如 Pause / Resume；队列任务必须支持选中操作，避免顶部按钮默认作用于未确认任务。影响 REQ-084 和 FEAT-021，作为完成 Feature 的 follow-up 修订。

## UI 概念图

| Webview | 概念图 |
|---|---|
| Execution Workbench | `docs/ui/feat-021-execution-workbench-concept.png` |
| Spec Workspace | `docs/ui/feat-021-spec-workspace-concept.png` |
| Feature Spec | `docs/ui/feat-021-feature-spec-concept.png` |

## 验收标准

- [x] VSCode 插件新增独立 `Execution Workbench`、`Spec Workspace`、`Feature Spec` 三个 Webview，使用独立前端入口、布局和组件，不复用 Product Console 页面、路由、导航或组件实现。
- [x] `Execution Workbench` 第一屏以任务调度和自动执行为核心，默认展示 Job 队列、当前运行、下一步动作、阻塞原因、自动执行控制和审批待办。
- [x] `Execution Workbench` 支持 enqueue、run now、auto run、pause automation、resume automation、retry、cancel、skip 和 reprioritize。
- [x] `Execution Workbench` 展示 Execution Record、raw log refs、diff 摘要、`SkillOutputContractV1` 校验结果和 `spec-state.json` 投影摘要。
- [x] `Spec Workspace` 展示 PRD、EARS Requirements、HLD、UI Spec、Architecture Plan、Data Model、Contracts、Tasks、Quickstart、Execution、Review、Delivery 的全流程状态，并为当前阶段提供受控推进操作。
- [x] `Spec Workspace` 展示 guardrails、command approvals、safe action confirmations、spec consistency、evidence 和 traceability，所有推进动作都必须可审计。
- [x] `Feature Spec` 通过卡片方式按 Planning、Ready、In Execution、Review、Delivered、Blocked 等状态直观展示 Feature 情况，包括需求覆盖、任务进度、执行状态、Review 状态、依赖、阻塞、下一步动作和最新运行。
- [x] `Feature Spec` 右侧详情面板支持查看选中 Feature 的 artifacts、acceptance、latest run、blockers、traceability，并提供打开需求/设计/任务和调度执行等 VSCode 内操作。
- [x] Webview 所有有副作用动作都通过 extension host 调用 Control Plane command API；不得直接访问 SQLite、Scheduler 内部队列或运行状态文件。
- [x] Webview 可以复用 shared contract/type 定义和 query/command API，但不得把 Product Console ViewModel 作为插件 UI 的事实源。
- [x] `Feature Spec` 顶部提供 New Feature 按钮，点击后弹出输入框；输入自然语言内容并提交后，Webview 只提交受控需求输入，后续由模型判定进入 `requirement-intake-skill` 或 `spec-evolution-skill` 流程。
- [x] New Feature 提交必须展示 command receipt、路由结论、影响文档和阻塞原因；前端不得用关键字、是否填写 requirement id 等规则硬编码新增/变更判定。
- [x] `Feature Spec` 刷新时必须以 `docs/features/README.md` 作为 Feature 身份来源；数据库 Feature 记录和未写入 index 的目录不得生成 Feature 列表项。刷新仍读取 index 中 folder 对应的 `requirements.md` / `design.md` / `tasks.md`，并识别缺失 folder、缺失三件套和状态冲突。
- [x] 因需求新增流程未经过 Feature 拆分而导致 `docs/features/README.md` 未更新时，Feature Spec Webview 不显示该目录为 Feature 列表项，也不显示独立 `Feature Index Sync` 信息区块；应由需求新增 Skill 或后续规格同步补齐 Feature index。
- [x] 需求新增 Skill 创建或更新 Feature Spec 时必须同步 `docs/features/README.md`，写入 Feature ID、Feature、Folder、Status、Primary Requirements、Suggested Milestone 和 Dependencies。
- [x] 点击 Feature 后，详情面板必须解析该 Feature 的 `tasks.md`，展示任务 ID、任务标题、状态、描述和验证命令；Markdown 缺失或格式无法解析时展示 blocked reason。
- [x] 状态为 `need review` / `review_needed` 的 Feature Spec 必须在 Feature Spec Webview 工具栏和详情面板提供 Review 入口；点击后弹出澄清输入框，提交内容以 `clarification` 意图进入 Spec change request，并由 Control Plane 排入 `ambiguity-clarification-skill` 技能调用任务，不由前端硬编码需求变更或新增路由。
- [x] Feature Spec 详情面板不得展示 Evidence 区域或 Evidence 验收项；详情只展示 artifacts、tasks、acceptance、blockers、traceability 和可执行动作。
- [x] Feature Spec Webview 必须按分类 panel 展示 Feature：依次为 `Blocked`、`In-Process`、`Todo`、`Ready`、`Done`；每组可点击折叠/展开并显示展开/折叠状态图标，Done 默认折叠，其它默认展开；panel 中 Feature list 必须自适应换行，不依赖 panel 内垂直滚动条或水平滚动条展示卡片。
- [x] Feature Spec Webview 顶部第一个控件必须是单个视图切换按钮；Feature List 视图下按钮文字显示 `Dependency Graph`，点击后切换到 Dependency Graph 视图并将按钮文字改为 `Feature List`；`Dependency Graph` 视图以树状层级展示 Feature 之间的依赖关系，标出缺失依赖，树节点支持折叠和展开，并默认展开到二级节点。
- [x] `Execution Workbench` 队列任务必须支持选中；Run Now、Pause / Resume、Retry、Cancel、Skip、Reprioritize、Enqueue 等顶部任务按钮必须只在有选中任务且选中任务状态允许该动作时启用；Pause / Resume 作为双态按钮随选中任务状态切换。
