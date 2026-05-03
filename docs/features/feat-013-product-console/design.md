# Design: FEAT-013 Product Console

## Design Summary

Product Console 是用户可访问的浏览器控制台，也是控制面状态的查询和命令入口。它由 Project Switcher、Dashboard、Project Home、Spec Workspace、Runner Console、Review Center、System Settings 和 Language Switcher 组成，只通过 Control Plane API 查询和发起受控命令，不直接修改 Git 工作区。现有 Query/ViewModel 和 HTTP JSON endpoint 是后端契约，不是 UI 交付物。

CHG-009 修正：FEAT-013 必须交付真实前端应用入口、页面路由、组件、状态反馈和浏览器级验收；不能把 API、ViewModel、测试 fixture 或静态说明文本当作用户 UI。

Implementation update：Product Console UI 采用 Vite React，前端入口位于 `apps/product-console`。UI 通过 Tailwind CSS、Radix UI primitives 和 repo-owned shadcn-style primitives 实现，消费现有 `/console/*` Control Plane API/ViewModel，并保留 `docs/features/feat-013-product-console/assets/product-console-concept.png` 作为视觉概念验收基线。

CHG-017 update：Runner / Task Scheduler 页面采用执行队列视图。该页面从 Runner 状态面板升级为任务调度中心，必须展示 `cli.run` 与后续 `native.run` Job、Execution Record、payload context、右侧 scheduler job inspector、recent triggers、Evidence 摘要和 Runner 日志。该 UI 不恢复 Skill Center 或 Subagent Console，只展示 scheduler job、execution id、workspace、skill phase / native handler、blocked reason 和 Evidence 等执行反馈事实。

Audit Center update：审计中心采用 `docs/ui/audit-center-concept.png` 作为视觉与交互基线。该页面从 Review 列表升级为端到端审计视图，展示审计摘要、筛选工具栏、Audit Timeline、事件详情 inspector、命令回执、阻塞原因、Evidence、Execution Record、Job、状态转换和 Approval 关联记录；英文界面名称统一为 `Audit Center`。

ADD-004 update：Product Console 首次打开默认中文，App Shell 提供语言切换控件并持久化用户选择。语言资源只覆盖界面文案；Evidence、diff、日志、文件路径、命令输出和用户输入内容作为事实数据保持原文。

ADD-005 update：App Shell 提供导入现有项目、新建项目表单、项目列表和当前项目切换控件。导入和新建是两个不同表单：导入表单只收集已有项目目录，并通过 `/projects/scan` 自动识别项目名称、默认分支、仓库来源和技术栈；新建表单收集项目名称、目标、类型、技术偏好、workspace 目录名、默认分支和自动化开关。当前项目上下文来自 FEAT-001 的 ProjectSelectionContext；所有页面查询和受控命令都必须携带 `project_id`，并在缺失或不匹配时展示 blocked 反馈。Spec 流程执行扫描、上传、生成、调度、状态检查和 Evidence / Project Memory 写入时，路径根必须来自当前项目的 `target_repo_path` / repository `local_path`，不得使用 Product Console / AutoBuild 进程的运行目录作为兜底。新建项目表单统一提交 `workspace/<project-slug>` 作为项目目录；导入现有项目保留用户填写的已有目录。

CHG-010 update：原一级 “Dashboard Board / Board / 看板” 页面正式命名为 “Project Home / 项目主页”。Project Home 是当前单个项目的概览入口，聚合项目身份、仓库/分支、活跃 Feature、运行摘要、风险、最近 PR、Evidence / 审计事件和任务看板。Task Board / 任务看板保留为 Project Home 内部任务状态与受控操作分区；现有 `/console/dashboard-board` 查询、Board ViewModel 和 board command action 不在本次改名中迁移。

CHG-011 update：阶段 1 项目初始化由 FEAT-001 的 Project Service 自动完成。Spec Workspace 只展示项目创建/导入、Git 仓库、`.autobuild/` / Spec Protocol、项目宪章、Project Memory、健康检查和当前项目上下文的自动初始化状态、事实来源和阻塞原因，不提供逐步手动执行这些子步骤的入口。

CHG-012 / CHG-014 update：阶段 2 需求录入先自动扫描 Spec Sources。扫描范围包括 PRD、EARS、requirements、HLD、design、已有 Feature Spec、tasks 和 README / 索引等文档；UI 展示发现数量、来源路径、类型、缺失项、冲突项和需要澄清的问题。阶段 2 将 Spec Sources 扫描和 Spec 上传合并为一个“Spec 扫描与上传”步骤，并在该步骤中显示“扫描”和“上传”两个按钮。阶段 2 允许扫描已有 HLD / Feature Spec 作为事实源，但不展示 HLD 生成、Feature Spec 拆分或规划流水线入口。

CHG-013 update：Skill Center 和 Subagent Console 已移除。Runner Console 仅展示外部执行队列、心跳、日志、证据和状态检测结果，不表达平台 Skill/Subagent 调用语义。

ADD-006 update：Product Console 增加 System Settings，并将 CLI Adapter 配置管理放到系统设置下。系统设置中的 CLI 配置页以 FEAT-008 提供的 `CliAdapterConfig` JSON 为唯一事实源，同时提供 `codex-cli` / `gemini-cli` preset、原始 JSON 编辑器和 JSON Schema 生成表单；保存前调用 dry-run 校验命令模板、安全策略、输出映射和 session resume 设置。Runner Console 只展示 active adapter、配置健康摘要和跳转入口。

CHG-016 update：Spec Workspace、Task Board 和 Runner Console 必须展示 workspace-aware CLI skill invocation 的受控执行反馈。Console 不展示或管理平台 Skill Registry；它只显示受控命令转换后的 scheduler job、execution id、项目 workspace、skill phase、blocked reason 和最近 Evidence。所有执行类命令必须携带当前 `project_id`，并由 Control Plane 解析 repository `local_path` / `target_repo_path` 后交给 FEAT-008 的 active CLI Adapter。

## Components

| Component | Responsibility |
|---|---|
| Project Switcher | 展示项目列表、当前项目、项目健康摘要、导入入口和新建表单，并触发项目切换。 |
| Dashboard View | 聚合项目健康、Feature、任务、活跃外部运行、失败、审批、来自 `token_consumption_records` 的成本、PR 和风险。 |
| Project Home View | 作为单个当前项目的概览入口，展示项目身份、仓库/分支、活跃 Feature、运行摘要、风险、最近 PR、Evidence / 审计事件，并承载 Task Board 分区。 |
| Task Board Section | 展示兼容任务状态、diff、测试结果、审批状态和失败恢复历史，并发起受控拖拽、兼容排期和执行入口命令；编码执行事实源是 Feature Spec 目录，不是 Task Board 任务表。 |
| Spec Workspace View | 展示阶段 1 自动项目初始化、阶段 2 需求录入、Spec Sources 扫描、Feature Spec、澄清、Checklist、计划、数据模型、契约、Feature Spec `tasks.md` 覆盖情况和版本 diff。 |
| Runner Console View | 展示 Runner 在线、active CLI adapter、当前模型、安全配置、executor queue、日志、心跳、CLI Adapter 配置健康摘要和系统设置跳转入口。 |
| Scheduler Job List | 展示 `cli.run` 与后续 `native.run` Job 的执行名称、执行类型、operation、status、execution id、attempts 和 updatedAt。 |
| Scheduler Job Inspector | 展示选中 job 的 scheduler job id、BullMQ job id、queue、job type、payload context、Execution Record、workspace、CLI Adapter / native handler、heartbeat、blocked reason 和 Evidence 摘要。 |
| Skill Invocation Feedback | 在 Spec Workspace、Task Board 和 Runner Console 展示 scheduler job、execution id、workspace、skill phase、blocked reason、token 消费明细和 Evidence 摘要。 |
| System Settings View | 承载跨页面、跨 Execution Record 的系统级配置，MVP 至少包含 CLI 配置页。 |
| CLI Adapter Config Panel | 位于 System Settings，展示 active adapter、Codex/Gemini preset、原始 JSON、JSON Schema 表单、token 价格表、dry-run 结果、字段级错误、保存草稿和启用/禁用操作。 |
| Review Center View | 展示 ReviewItem、风险筛选、diff、Evidence 和审批动作。 |
| Audit Center View | 展示 audit timeline、命令回执、阻塞原因、状态转换、Evidence、Execution Record、Job 和 Approval 关联事实。 |
| Console Command Gateway | 将 UI 动作转换为 Control Plane 命令。 |
| Frontend App Shell | 提供浏览器入口、导航、路由、布局、错误边界、加载态、项目切换、语言切换和页面切换。 |
| Locale Provider | 管理默认中文、语言资源、语言偏好持久化和 UI 文案查找。 |
| shadcn/ui Component Layer | 提供表格、标签页、按钮、弹窗、状态徽标、命令菜单、表单和审计反馈组件。 |

## Data Ownership

- Owns: 前端应用入口、页面路由、UI 组件、UI View Model、Dashboard Query Model、Console Action Command、System Settings View Model、CLI Adapter Form View Model、UI locale preference、UI project selection state。
- Reads: Control Plane API、Audit/Metrics、TokenConsumption、Evidence、Memory 投影、Review 查询。
- Writes: 受控命令请求；不直接写 Git、worktree 或 artifact。

## Controlled Command Boundary

Product Console 的查询接口只负责读取 ViewModel、配置 schema、Evidence、审计、状态摘要和表单选项。任何会写入持久状态、触发调度、执行 CLI、改变审批/规则/配置、写入 Evidence 或 Project Memory 的用户动作，都必须提交给 Console Command Gateway，并返回 command receipt。

受控命令必须包含 action、entityType、entityId、requestedBy、reason 和当前 `project_id`（适用项目级动作时）。命令执行前必须完成项目隔离、状态机、依赖、高风险、审批、workspace root 和 CLI Adapter 配置校验；失败时展示 blocked reason 并保留原页面状态。Product Console 不得通过普通 `POST`/`PATCH` ViewModel endpoint、前端本地状态或直接 CLI 调用绕过审计。

普通接口适用于 Dashboard、Project Home、Spec Workspace、Runner Console、Review Center、System Settings 的只读数据加载、过滤、排序、语言切换、配置 schema 读取和只读预览。只读预览一旦升级为落库、初始化、调度、写 artifact 或配置生效，必须转为受控命令。

## State and Flow

1. 用户在浏览器打开 Product Console。
2. Frontend App Shell 读取持久化语言偏好；没有偏好时默认中文，并加载项目列表、当前项目上下文、导航和默认 Dashboard 页面。
3. Dashboard Query Service 按当前 `project_id` 聚合状态，并从 `token_consumption_records` 聚合 token / cost 后通过页面组件展示真实数据、加载态、空态或错误态。
4. 用户进入具体工作台查看证据、diff、日志、Feature Spec `tasks.md` 覆盖情况或执行命令。
5. Spec Workspace 从项目、仓库连接、项目宪章、Project Memory、Feature、Requirement 和审计事件派生 Spec 流程阶段状态；阶段 1 / 阶段 2 / 阶段 3 设计规划与任务调度在工作台头部默认折叠为可点击状态标签，只展示阶段名称、状态和更新时间；流程说明栏用标签显示当前 Spec 来源、版本、扫描模式、最后扫描时间和阻塞数量，不再在流程后方展示独立提示信息栏。用户点击标签后展开自动项目初始化事实、阻塞原因、Spec 扫描与上传（同一步骤内两个按钮）、格式识别、已有 HLD / Feature Spec / tasks 盘点、EARS 文档生成、澄清、质量检查、HLD / UI Spec / Feature Spec 拆分、启动自动执行、执行队列和状态检查状态。
6. Console Command Gateway 将拖拽、批量排期、批量运行、暂停、恢复和 Spec 流程动作连同当前 `project_id` 提交为受控命令；Feature Spec 拆分使用独立 Skill 操作并产出队列规划；项目级 `schedule_run` / `start_auto_run` 读取已拆分 Feature Spec 和机器可读规划结果，调用 `feature-selection-skill` 后创建 scheduler 队列。
7. Control Plane 更新状态，Console 显示成功、阻塞或失败反馈并重新查询。
8. 用户切换语言后，App Shell 保存偏好并重新渲染界面文案；事实数据保持 API 返回原文。
9. 用户切换项目后，App Shell 更新当前项目上下文，重新查询所有项目级页面；若命令返回 `project_id` 缺失或不匹配，展示阻塞反馈并保留原页面状态。
10. 用户在导入现有项目表单设置目录后，Console 调用只读 `/projects/scan` 扫描 Git、包管理器、SpecDrive 目录和仓库来源，并把扫描结果作为导入项目默认信息。
11. 用户从 App Shell 打开 System Settings，或从 Runner Console 的配置健康摘要跳转到系统设置中的 CLI 配置页；Console 加载 active/draft JSON 配置、JSON Schema、token 价格表和 form schema，并在原始 JSON 编辑器与表单之间保持同一份待保存配置状态。
12. 用户执行 dry-run 或保存配置时，Console 调用 Control Plane 受控命令；校验失败展示字段级错误和命令模板错误，校验通过后允许保存草稿或启用配置。
13. 用户从 Spec Workspace 或 Task Board 发起执行类操作时，Console 展示 Control Plane 返回的 command receipt，并在后续刷新中显示 scheduler job、execution id、workspace、skill phase、blocked reason 和最近 Evidence；Feature 级 `schedule_run` 必须以当前项目 workspace 中完整 Feature Spec 目录作为输入，目录缺少 `requirements.md`、`design.md` 或 `tasks.md` 时展示 blocked 反馈而不是依赖平台 task 表兜底。
14. 用户进入 Runner Console 时，Console 先展示 executor queue 健康，再展示 Job 列表；用户选择 Job 后，右侧 inspector 显示该 Job 关联的 Execution Record、payload context、workspace、CLI Adapter / native handler、Runner heartbeat、阻塞原因、Evidence 和日志，所有调度/运行动作仍通过受控命令提交。

## Dependencies

- FEAT-001 至 FEAT-012 提供各自查询模型和命令入口。
- FEAT-001 提供项目目录、项目创建、ProjectSelectionContext 和项目级查询隔离。
- FEAT-014 提供 token 消费明细、指标、审计和持久状态。
- FEAT-008 提供 `CliAdapterConfig`、dry-run 校验、active 配置回退和 Runner 执行接入。
- HLD 指定 React + Next.js 或 Vite React、shadcn/ui、Tailwind CSS 和 Radix UI primitives 作为默认 UI 栈；如实现阶段已有宿主框架，必须在本设计中记录替代栈与验收影响。

## Review and Evidence

- Console 展示 Evidence 摘要时必须保留跳转到来源证据的能力。
- 所有审批、拖拽、批量排期、批量运行、暂停、恢复和规则写入动作必须写审计。
- UI 验收必须包含浏览器级验证：首屏非空、导航可用、核心页面渲染真实状态、空态/错误态可见、至少一个受控命令动作有用户反馈。
- UI 多语言验收必须覆盖首次打开默认中文、切换语言、刷新后保留语言偏好，以及 Evidence、diff、日志、文件路径和命令输出保持原文。
- UI 多项目验收必须覆盖项目创建入口、项目列表、项目切换、刷新后保留当前项目，以及不同项目数据不串读。
- UI Spec Sources 验收必须覆盖阶段 2 自动扫描状态、PRD / EARS / HLD / Feature Spec / tasks 等来源类型、缺失项、冲突项、扫描与上传合并为一个步骤且显示两个按钮，以及阶段 2 不展示阶段 3 生成/拆分/规划入口。
- UI CLI Adapter 验收必须覆盖系统设置入口、Runner Console 跳转、active adapter 展示、原始 JSON 编辑、JSON Schema 表单编辑、dry-run 校验失败、成功保存草稿、启用配置和无效配置不影响 running Execution Record 的反馈。
- UI skill invocation 验收必须覆盖 Spec Workspace / Task Board 执行动作的 scheduler job、execution id、workspace、skill phase、blocked reason 和 Evidence 摘要展示；Feature 级编码调度必须验证完整 Feature Spec 目录可入队，缺失三件套会 blocked，且不依赖 `task_graph_tasks` / `tasks` 表。
- UI scheduler refinement 验收必须覆盖 Runner Console 中 `cli.run`、后续 `native.run`、Job 列表、Execution Record 详情、payload context、scheduler job inspector、workspace、blocked reason 或 Evidence 摘要，以及调度/运行 command receipt。
- API 单元测试、ViewModel 快照或 HTTP JSON 响应只能证明后端契约，不能单独作为 Product Console 完成证据。
- 浏览器验收命令：`npm run console:test`。构建验收命令：`npm run console:build`。
