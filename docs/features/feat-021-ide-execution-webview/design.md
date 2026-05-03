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
| Feature Spec | Feature Category Panels | 通过可折叠分类 panel 展示 Feature；顺序固定为 `Blocked`、`In-Process`、`Todo`、`Ready`、`Done`，其中 Done 默认折叠，其它默认展开；panel header 显示展开/折叠状态图标；panel 内 Feature list 自适应换行，不显示水平滚动条。 |
| Feature Spec | Feature Detail Drawer | 展示选中 Feature 的 artifacts、acceptance、latest run、blockers、traceability 和可执行动作。 |
| Feature Spec | New Feature Dialog | 顶部 New Feature 按钮打开弹出输入框，提交自然语言需求；Webview 只提交受控需求输入，模型按需求新增/变更边界自行判定后续流程。 |
| Feature Spec | Feature Index Source | 刷新时以 `docs/features/README.md` 作为 Feature 身份来源；只读取 index 中 folder 对应的三件套事实，非 index 目录和数据库 Feature 记录不生成 Feature 列表项。 |
| Feature Spec | View Toggle | 顶部第一个控件是单个视图切换按钮；Feature List 视图下按钮显示 `Dependency Graph`，Dependency Graph 视图下按钮显示 `Feature List`。 |
| Feature Spec | Tasks Projection | 点击 Feature 后解析对应 `tasks.md`，在详情中展示任务 ID、标题、状态、描述和验证命令。 |
| Feature Spec | Review Clarification Dialog | 当选中 Feature 状态为 `need review` / `review_needed` 时显示 Review 入口；点击后弹出澄清输入框，提交后以 `clarification` 意图进入 Spec change request。 |

## 3. Contract 边界

- 查询输入：`projectId`、`workspaceRoot`、status filter、featureId、executionId。
- 命令输入：`IdeCommandReceiptV1` 支持的 queue action、auto run / pause automation / resume automation 意图、Spec lifecycle controlled command 和 Feature schedule/open artifact intent。
- 输出：Webview 只消费 Control Plane 返回的轻量 view model；完整 raw logs、diff、执行输出、evidence 和 Feature artifacts 通过引用或分页查询加载。
- Product Console 与三组 VSCode Webview 共用持久事实源，但不共用 UI ViewModel 作为事实源。
- Spec Workspace 的全流程操作通过 `runControlledCommand` 或 Spec change request 进入 extension host，由 Control Plane 决定是否生成任务、记录审批或拒绝动作。
- Feature Spec 的调度、打开文档和刷新动作在 VSCode extension host 内执行；调度类动作必须进入 Control Plane command API。
- New Feature 提交使用 Spec change request 或等价受控命令进入需求处理链路，payload 包含 workspaceRoot、source surface、freeform content、current feature selection、visible Feature index snapshot 和 traceability hints；模型负责判定 `requirement-intake-skill` 或 `spec-evolution-skill`，前端不得硬编码路由规则。
- Review 澄清提交使用 Spec change request，payload 包含 workspaceRoot、Feature ID、Feature status、来源 Feature Spec 文档和澄清文本；前端固定提交 `clarification` 意图，不直接生成需求变更、需求新增或 Review 结论。
- Feature Spec 刷新返回的 view model 必须以 index rows 生成 Feature 节点；folder scan 仅用于校验 index 中的 folder 是否存在、读取 `requirements.md` / `design.md` / `tasks.md` / `spec-state.json` 和生成 missing-folder / missing-file blocked reason。未写入 index 的目录、数据库 Feature 记录和历史同步残留不得生成 Feature 节点；Webview 不渲染独立 `Feature Index Sync` 区块。
- Dependency Graph 只读取 Feature view model 中的 `dependencies`，按“依赖项 -> 依赖它的 Feature”展示层级；缺失依赖必须作为 missing dependency 节点展示，不得静默丢弃；树节点支持折叠和展开，默认展开根节点及二级节点。
- `tasks.md` 解析只生成 UI 投影，不写入平台 task 表；任务状态以 Markdown 中的状态字段、checkbox 或既有任务段落约定为事实源，无法解析时保留原文引用和 blocked reason。
- Feature Spec 详情面板不展示 Evidence 区域或 Evidence 验收项；Evidence 已从该详情上下文移除，详情只保留 artifacts、tasks、acceptance、blockers、traceability 和操作入口。
- Feature 分类展示只影响 VSCode Webview 投影，不改变 Feature 状态机；存在 blocked reason 或 blocked 状态的 Feature 进入 `Blocked` panel；运行中、执行中或 in-progress 的 Feature 进入 `In-Process` panel；除 `ready`、`done` / `delivered` / `completed`、blocked 和 in-process 外，其它状态进入 `Todo` panel。
- Feature panel 内的 Feature list 使用自适应换行布局，不能依赖水平滚动条或 panel 内垂直滚动条展示卡片。

## 4. 验证策略

- VSCode extension build 覆盖 Webview HTML 生成、CSP、消息路由和 command API 调用的类型约束。
- Node tests 覆盖 IDE query/command contract、queue action payload 和 controlled command receipt。
- Webview 级验证覆盖桌面尺寸下的三组入口可打开、第一屏关键区域可见、审批卡片、失败/阻塞状态和 Feature 卡片详情。
- Webview 级验证覆盖 New Feature 弹窗提交、模型路由 receipt、刷新时 Feature 身份只来自 index、非 index 目录不进入 Feature 列表、界面不显示 `Feature Index Sync` 信息区块，以及 Feature 详情 `tasks.md` 任务状态解析。
- Webview 级验证覆盖 `need review` / `review_needed` Feature 的 Review 入口、澄清提交 receipt，以及 Feature 详情不再出现 Evidence 验收项。
- Webview 级验证覆盖 Feature 分类 panel 顺序、折叠/展开行为、展开/折叠状态图标、Done 默认折叠，以及 panel 内 Feature list 自适应换行且不出现水平滚动条。
- Webview 级验证覆盖单个视图切换按钮显示在第一个控件位置、点击后切换 Feature List / Dependency Graph 并修改按钮文字、树状层级展示、默认展开二级节点、节点折叠/展开、缺失依赖提示，以及点击 Feature 节点后仍能选中详情。
