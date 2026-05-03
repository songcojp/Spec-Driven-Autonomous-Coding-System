# FEAT-021 IDE Workbench Webviews — 设计

Feature ID: FEAT-021
来源需求: REQ-084
HLD 参考: 第 7.15 节 VSCode SpecDrive Extension

## 1. 架构决策

- 在 VSCode 插件中新增三组独立 Webview Web UI：Execution Workbench、Spec Workspace、Feature Spec。
- 三组 Webview 使用独立前端入口、页面结构、状态模型和组件；不复用 Product Console 的页面、路由、导航、App Shell 或组件实现。
- UI 可以复用 shared TypeScript contract、query/command API client、状态枚举和 schema 类型，以保证前后端契约一致。
- extension host 负责 Webview 消息路由、CSP、资源 URI 转换和 Control Plane client 调用；Webview 不直接访问本地文件系统、SQLite 或 Scheduler 内部队列。
- Webview 信息架构拆为三类工作上下文：执行控制、Spec 生命周期控制、Feature Spec 状态总览。
- 三张概念图固定为 UI 基准：`docs/ui/feat-021-execution-workbench-concept.png`、`docs/ui/feat-021-spec-workspace-concept.png`、`docs/ui/feat-021-feature-spec-concept.png`。

## 2. 主要视图

| Webview | View | 说明 |
|---|---|
| Execution Workbench | Queue Timeline | 按 ready、blocked、queued、running、approval_needed、failed、completed 展示 Job 和 Feature/Task 上下文。 |
| Execution Workbench | Auto Run Control | 提供 start auto run、pause automation、resume automation、stop、并发策略和下一步动作预览。 |
| Execution Workbench | Current Execution | 展示当前 Execution Record、thread/turn、步骤进度、raw log refs、diff 摘要和输出校验状态。 |
| Execution Workbench | Blockers and Approvals | 汇总 blocked reason、approval pending、失败原因和可执行恢复动作。 |
| Execution Workbench | Result Projection | 展示 `spec-state.json.lastResult`、nextAction、produced artifacts 和最近状态投影。 |
| Spec Workspace | Lifecycle Pipeline | 展示 PRD 到 Delivery 的 Spec 全流程阶段、阶段状态、当前阶段和下一步动作。 |
| Spec Workspace | Stage Detail | 展示当前阶段来源文档、traceability、required skills、evidence、blockers 和阶段推进按钮。 |
| Spec Workspace | Control Guardrails | 展示 constitution checks、command approvals、safe action confirmations、spec consistency 和 manual approval。 |
| Spec Workspace | Evidence & Traceability | 以表格展示 requirement、feature、artifact、evidence、validation result 和更新时间。 |
| Feature Spec | Feature Card Board | 通过卡片按状态展示 Feature，卡片包含需求覆盖、任务进度、执行状态、Review 状态、依赖、下一步动作和阻塞提示。 |
| Feature Spec | Feature Detail Drawer | 展示选中 Feature 的 artifacts、acceptance、latest run、blockers、traceability 和可执行动作。 |
| Feature Spec | New Feature Dialog | 顶部 New Feature 按钮打开弹出输入框，提交自然语言需求；Webview 只提交受控需求输入，模型按需求新增/变更边界自行判定后续流程。 |
| Feature Spec | Feature Index Sync | 刷新时读取 Feature index 与 `docs/features/*` 目录，合并 Feature 三件套事实，识别 index 漏项、孤儿目录、缺失文件和状态冲突。 |
| Feature Spec | Tasks Projection | 点击 Feature 后解析对应 `tasks.md`，在详情中展示任务 ID、标题、状态、描述和验证命令。 |

## 3. Contract 边界

- 查询输入：`projectId`、`workspaceRoot`、status filter、featureId、executionId。
- 命令输入：`IdeCommandReceiptV1` 支持的 queue action、auto run / pause automation / resume automation 意图、Spec lifecycle controlled command 和 Feature schedule/open artifact intent。
- 输出：Webview 只消费 Control Plane 返回的轻量 view model；完整 raw logs、diff、执行输出、evidence 和 Feature artifacts 通过引用或分页查询加载。
- Product Console 与三组 VSCode Webview 共用持久事实源，但不共用 UI ViewModel 作为事实源。
- Spec Workspace 的全流程操作通过 `runControlledCommand` 或 Spec change request 进入 extension host，由 Control Plane 决定是否生成任务、记录审批或拒绝动作。
- Feature Spec 的调度、打开文档和刷新动作在 VSCode extension host 内执行；调度类动作必须进入 Control Plane command API。
- New Feature 提交使用 Spec change request 或等价受控命令进入需求处理链路，payload 包含 workspaceRoot、source surface、freeform content、current feature selection、visible Feature index snapshot 和 traceability hints；模型负责判定 `requirement-intake-skill` 或 `spec-evolution-skill`，前端不得硬编码路由规则。
- Feature Spec 刷新返回的 view model 必须同时表达 index rows 与 folder scan rows：缺失 index 的目录可生成 sync candidate，存在冲突时返回 blocked reason 和建议路由。
- `tasks.md` 解析只生成 UI 投影，不写入平台 task 表；任务状态以 Markdown 中的状态字段、checkbox 或既有任务段落约定为事实源，无法解析时保留原文引用和 blocked reason。

## 4. 验证策略

- VSCode extension build 覆盖 Webview HTML 生成、CSP、消息路由和 command API 调用的类型约束。
- Node tests 覆盖 IDE query/command contract、queue action payload 和 controlled command receipt。
- Webview 级验证覆盖桌面尺寸下的三组入口可打开、第一屏关键区域可见、审批卡片、失败/阻塞状态和 Feature 卡片详情。
- Webview 级验证覆盖 New Feature 弹窗提交、模型路由 receipt、刷新时 index + folder 同步、index 漏项提示或补齐，以及 Feature 详情 `tasks.md` 任务状态解析。
