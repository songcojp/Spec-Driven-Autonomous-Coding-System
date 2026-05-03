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
