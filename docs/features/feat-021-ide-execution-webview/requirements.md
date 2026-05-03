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
- [x] `Feature Spec` 刷新时同时读取 `docs/features/README.md` 和 `docs/features/*` 目录中的 `requirements.md` / `design.md` / `tasks.md`，并识别 index 漏项、孤儿目录、缺失三件套和状态冲突。
- [x] 因需求新增流程未经过 Feature 拆分而导致 `docs/features/README.md` 未更新时，刷新流程必须补齐 Feature index，或在存在冲突时展示 `clarification_needed` / `risk_review_needed` 阻塞。
- [x] 需求新增 Skill 创建或更新 Feature Spec 时必须同步 `docs/features/README.md`，写入 Feature ID、Feature、Folder、Status、Primary Requirements、Suggested Milestone 和 Dependencies。
- [x] 点击 Feature 后，详情面板必须解析该 Feature 的 `tasks.md`，展示任务 ID、任务标题、状态、描述和验证命令；Markdown 缺失或格式无法解析时展示 blocked reason。
