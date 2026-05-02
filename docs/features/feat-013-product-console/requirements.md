# Feature Spec: FEAT-013 Product Console

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 8.1 至 8.9 节页面需求 |
| Requirements | REQ-052, REQ-053, REQ-054, REQ-055, REQ-056, REQ-057, REQ-061, REQ-062, REQ-063, REQ-064, REQ-066, REQ-067, REQ-068, NFR-006, NFR-007, NFR-008, NFR-010 |
| HLD | 7.11 Product Console and Dashboard, 12 Observability and Operability |

Spec Evolution:
- CHG-009：实现证据显示当前仓库只有 Control Plane API、Query/ViewModel 和 API 层测试，没有用户可访问的前端应用、页面路由、组件系统或浏览器验收。FEAT-013 从 `done` 重新打开为 `in-progress`；API/ViewModel 只能作为 UI 后端基础，不能替代 Product Console 用户界面。
- ADD-004：用户要求 UI 支持多语言切换，且默认中文。该需求作为 Product Console patch 处理，必须覆盖界面文案、语言偏好和浏览器级验证。
- ADD-005：用户要求支持项目创建、导入现有项目和多个项目切换。该需求由 FEAT-001 提供项目目录与当前项目上下文，Product Console 必须提供导入/新建表单、项目列表、项目切换控件和项目级查询隔离反馈。
- CHG-010：用户确认原一级“看板 / Board”页面正式命名为“项目主页 / Project Home”。该页面是单个当前项目的概览入口；任务看板保留为页面内的 Task Board 分区和底层状态机能力。
- CHG-011：用户确认项目创建或导入后应自动完成阶段 1 初始化操作。Product Console 只展示阶段 1 自动初始化状态、事实来源和阻塞原因，不把这些子步骤设计成用户逐步手动操作。
- CHG-012：用户确认阶段 2 需要自动扫描 PRD、EARS、HLD、Feature Spec 等。Product Console 必须展示 Spec Sources 自动扫描状态和结果；阶段 2 只扫描已有 HLD / Feature Spec 事实源，不展示 HLD 生成、Feature Spec 拆分或规划流水线入口。
- CHG-014：用户确认阶段 2 的 Spec 扫描和上传必须合并为一个步骤；Product Console 在该步骤内显示“扫描”和“上传”两个按钮，不再把扫描和上传渲染为两个独立阶段步骤。
- CHG-013：2026-04-29 平台边界收缩为调度和状态维护，移除 Skill Center、Subagent Console 和规划流水线入口；Runner 页面仅展示外部执行状态、心跳、日志、证据和状态检测。
- ADD-006：用户要求优化 CLI 调用并升级为 adapter；CLI 配置通过 JSON 管理，支持 JSON 表单并可通过 UI 直接编辑修改。Product Console 必须提供系统设置，并将 CLI Adapter 配置管理放到系统设置下；Runner Console 只展示配置健康摘要和跳转入口。
- CHG-016：用户要求 Spec/UI 操作转换为完整 CLI Skill 调用流程，且 Codex 支持 workspace 时必须传入项目路径。Product Console 必须把 Spec Workspace 和 Task Board 操作转换为受控命令回执，并展示 scheduler job、execution id、workspace、skill phase、blocked reason、contract validation 和最近 Evidence。
- ADD-007：用户确认采用 `docs/ui/task-scheduler-console-concept.png` 作为 Runner / Scheduler UI 实现基线。Runner Console 必须展示调度流水线、BullMQ queue、任务队列表格、scheduler job inspector、workspace、heartbeat、blocked reason、Evidence 摘要和受控命令回执。
- ADD-008：用户要求任务调度中心管理队列任务，支持按条件筛选、查看任务详情、以可读描述呈现任务意图，且页面功能必须接入真实前后端数据，不得使用 demo 或 mock 数据作为完成证据。
- CHG-017：任务调度中心重构为执行 Job 队列视图。Job 与 Feature 解耦，Feature/Task/Project 只作为 payload context；`runs` 领域词替换为 Execution Record / 执行记录；旧 `feature.select -> feature.plan -> cli.run` 流水线废弃。
- CHG-019：用户确认 Feature 编码执行不再依赖 `task_graph_tasks` / `tasks`；`codex-coding-skill` 直接读取 Feature Spec 目录中的 `requirements.md`、`design.md`、`tasks.md` 并执行。Product Console 的 Feature 级调度只需校验完整 Feature Spec 目录和 workspace，不要求 Task Board 任务表存在。

## Scope

- Dashboard 展示项目健康度、当前活跃 Feature、看板任务数量、活跃外部运行、今日自动执行次数、失败任务、待审批任务、成本消耗、最近 PR 和风险提醒。
- Dashboard、Project Home、Runner Console 和 Spec Workspace 的成本与 token 展示必须来自 `token_consumption_records`；不得从 `metric_samples` 读取或累计 token / cost。
- Product Console App Shell 提供导入现有项目入口、新建项目表单、项目列表和当前项目切换控件；当前项目上下文驱动所有页面查询和受控命令，Spec 流程的文件读写、命令执行、状态检查、Evidence 和 Project Memory 操作必须解析到当前项目目录，而不是 Product Console / AutoBuild 进程运行目录。
- Project Home 是当前单个项目的概览入口，展示项目身份、仓库/分支、活跃 Feature、运行摘要、风险、最近 PR、Evidence / 审计事件，并在页面内提供 Task Board 分区。
- Task Board 分区支持受状态机约束的兼容看板拖拽、批量排期、批量运行，以及查看任务依赖、diff、测试结果、审批状态和失败恢复历史；编码执行的主路径以 Feature Spec 目录为输入，不依赖 Task Board 任务表。
- Spec Workspace 支持创建 Feature，并查看 Spec、澄清记录、需求质量 checklist、技术计划、数据模型、契约、Feature Spec `tasks.md` 覆盖情况和 Spec 版本 diff。
- Spec Workspace 的 Spec 操作流程必须拆为“阶段 1 项目初始化”、“阶段 2 需求录入”和“阶段 3 设计规划阶段”：阶段 1 展示自动项目创建/导入、Git 仓库、`.autobuild/` / Spec Protocol、项目宪章、Project Memory、健康检查和当前项目上下文状态；阶段 2 将 Spec Sources 自动扫描和 PRD 上传合并为一个“Spec 扫描与上传”步骤，并在该步骤中显示“扫描”和“上传”两个按钮，同时展示 PR/RP/PRD/EARS 识别、已有 HLD / Feature Spec / tasks 事实源盘点、EARS 文档生成、澄清和质量检查状态；阶段 3 展示已拆分 Feature Spec 推入 Pool、Feature Spec 目录完整性、调度、状态检查和状态聚合。
- Spec Workspace 头部的阶段流程必须默认折叠为可点击状态标签，只展示阶段名称、状态和更新时间；点击阶段标签后展开阶段事实、阻塞原因和阶段内步骤。
- Spec Workflow 的来源、版本、扫描模式、最后扫描时间、运行耗时和阻塞数量必须以标签形式显示在流程说明栏；流程后方不得保留独立提示信息栏。
- 阶段 2 不得展示 HLD 生成、Feature Spec 拆分或规划流水线入口；Feature Spec 拆分是独立受控操作，推入 Feature Spec Pool 只读取已拆分 Feature Spec 和 Skill 产出的队列规划，并按规划结果创建调度队列。
- Skill Center 已移除，Console 不展示平台 Skill 页面。
- Subagent Console 已移除，Console 不展示平台 Subagent 页面或终止/重试动作。
- Runner Console 展示 Runner 在线状态、Codex 版本、sandbox、approval policy、queue、最近日志、心跳、外部执行状态和证据，并支持暂停或恢复 Runner。
- Runner Console 的队列状态必须来自 `scheduler_job_records` 与 Runner heartbeat/session/log，而不是静态 recent logs。
- Runner Console 必须展示 `cli.run` 与后续 `native.run` 的执行队列，不展示固定 Feature 列或旧流水线卡片。
- Runner Console 主列表必须展示 Job：执行名称、执行类型、operation、status、execution id、attempts、updatedAt、workspace。
- Runner Console 的任务队列必须支持按状态和关键词筛选，关键词至少覆盖 job id、job type、operation、execution id、workspace、skill/native 信息、状态和阻塞原因。
- Runner Console 的任务列表必须优先展示可读执行意图；scheduler job id、BullMQ job id、execution id 等 GUID 只能作为辅助事实。
- Runner Console 必须提供 scheduler job / execution detail，展示 Job 基础信息、payload/context、Execution Record、CLI skill 或 native handler、Evidence、logs、error/blocked reason。
- Spec Workspace 和 Runner Console 必须展示 workspace-aware skill invocation 反馈，包括 scheduler job、execution id、workspace、skill phase、blocked reason 和最近 Evidence。
- System Settings 提供 CLI Adapter 配置管理入口，支持原始 JSON 查看/编辑、JSON Schema 表单编辑、token 价格表配置、dry-run 校验、保存草稿、启用/禁用、字段级错误和审计反馈；Runner Console 只展示 active adapter、配置状态和跳转入口。
- Product Console 的查询接口只读取 ViewModel、Evidence、审计、配置 schema 和状态摘要；任何写入状态、触发 Scheduler / Execution Record、执行 CLI、改变审批/规则/配置或写入 Evidence / Project Memory 的动作都必须通过 Console Command Gateway 产生受控命令回执。
- Review Center 页面展示待审批列表、风险筛选、diff、Evidence、审批操作、项目规则写入和 Spec Evolution 写入入口。
- Audit Center 页面展示审计摘要、Audit Timeline、命令回执、阻塞原因、状态转换、Evidence、Execution Record、Job 和 Approval 关联记录，并使用 `docs/ui/audit-center-concept.png` 作为实现基线。
- Product Console 必须提供用户可访问的前端应用入口、页面路由和可交互控件；Control Plane JSON API、Query Model 或 ViewModel 不构成用户 UI 完成证据。
- Product Console 必须默认使用中文界面，并提供可见语言切换入口；切换范围覆盖导航、页面标题、操作按钮、状态标签、空态、错误态、反馈提示和确认信息。

## Non-Scope

- Product Console 不直接写 Git 工作区。
- Dashboard 不是调度或状态真实来源。
- 不定义复杂企业级权限矩阵。
- 不把静态说明页、命令行输出、纯 JSON 响应或仅供测试调用的 ViewModel 当作 Product Console UI。

## User Value

用户可以从一个控制台理解项目健康、自动化进度、任务风险、外部运行状态、Runner 状态和待审批事项，并通过受控命令操作系统。

## Requirements

- Dashboard 可以展示项目级和任务级状态摘要。
- Project Home 可以展示当前项目级概览、运行摘要、风险、最近 PR、Evidence / 审计事件和任务看板入口。
- Task Board 可以展示任务依赖、diff、测试结果、审批状态和失败恢复历史入口。
- Task Board 的拖拽或批量操作只能产生受状态机允许的状态变更或调度请求。
- `schedule_board_tasks` 只执行兼容排期状态迁移；`run_board_tasks` 只入队 `cli.run`，不得由 Console 请求直接执行 CLI。Feature 级编码调度不需要先生成或读取平台 task 表。
- 用户可以从 Spec Workspace 追踪需求到 Feature Spec 目录和 `tasks.md`。
- 用户可以从 Spec Workspace 看到阶段 1 自动项目初始化是否阻塞阶段 2 需求录入，也可以看到阶段 3 设计规划阶段状态；没有 Feature Spec 时仍能看到阶段 1 / 阶段 2 / 阶段 3 Spec 流程。
- 用户可以从 Spec Workspace 查看 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引等 Spec Sources 的自动扫描状态、发现数量、缺失项、冲突和需要澄清的问题。
- 用户可以判断 Runner 是否可执行新任务。
- 用户可以通过系统设置查看 active CLI Adapter，并通过原始 JSON 或 JSON Schema 表单编辑 adapter 配置。
- 用户可以通过系统设置维护 active CLI Adapter 的模型 token 价格表，用于 token 消费明细成本计算。
- 用户保存或启用 CLI Adapter 配置前可以看到 dry-run 校验结果；无效配置不得影响正在运行的 Execution Record。
- 高风险、阻塞或需澄清任务能从 Review Center 被处理。
- 用户可以在浏览器中打开 Product Console，并在 Dashboard、Project Home、Spec Workspace、Runner Console 和 Review Center 之间切换。
- 用户可以从 Product Console 导航进入系统设置，并从 Runner Console 跳转到系统设置中的 CLI 配置页。
- 用户可以导入现有项目或通过表单创建新项目，在项目列表中切换当前项目，并看到各页面随当前项目刷新。
- 每个页面必须有加载态、空态、错误态和真实数据态；页面文案不能替代状态数据、Evidence、diff、日志或命令结果。
- 用户动作必须通过可见控件发起，且控件调用 Control Plane 受控命令后展示成功、阻塞或失败反馈。
- 所有项目级受控命令必须携带当前 `project_id`；缺少或不匹配时展示阻塞反馈，不得静默使用上一个项目。
- 受控命令必须记录 action、entity、requestedBy、reason、payload、accepted/blocked 状态和 audit event；查询接口不得隐藏写入副作用或直接修改 Git、worktree、artifact、数据库状态或 CLI 执行状态。
- Spec Workspace 和 Task Board 的执行类动作必须展示转换后的 CLI skill invocation 状态；项目 workspace 缺失、不可读或缺少所需 Skill 文件时，用户必须看到 blocked reason。
- Feature 级 `schedule_run` 必须在完整 Feature Spec 目录存在时可直接创建 `feature_execution` Execution Record；目录缺失 `requirements.md`、`design.md` 或 `tasks.md` 时必须展示 blocked reason。
- 用户可以切换界面语言并保留选择；Evidence、diff、日志、文件路径、命令输出和用户输入内容保持原文，不被界面翻译层改写。

## Acceptance Criteria

- [ ] Console 所有写操作都通过 Control Plane 命令发起。
- [ ] Dashboard、Project Home、Spec Workspace、Runner Console、Review Center 和 System Settings 的普通接口只提供查询、schema 或只读预览；会落库、调度、执行、审批、配置生效或写 Evidence 的动作均有 command receipt 和审计事件。
- [ ] 批量排期和批量运行保留审计记录，并对高风险、依赖未满足或审批缺失任务给出阻塞原因。
- [ ] 看板加载和状态刷新耗时被记录为性能基线。
- [ ] Runner 心跳、token 消费成本、成功率和失败率可展示。
- [ ] Dashboard 不覆盖 Persistent Store、Project Memory 或 Git 事实。
- [ ] 仓库包含可运行的前端应用入口、路由和页面组件，至少覆盖 Dashboard、Project Home、Spec Workspace、Runner Console 和 Review Center。
- [ ] Product Console 接入 HLD 指定的 React + Next.js 或 Vite React，以及 shadcn/ui + Tailwind CSS + Radix UI primitives，若因宿主框架调整必须在设计中记录替代方案。
- [ ] 浏览器级验证覆盖 Console 首屏、页面切换、真实数据渲染、空态/错误态和一个受控命令动作；API 层测试不能单独满足 UI 验收。
- [ ] FEAT-013 不得标记为 `done`，除非用户可访问 UI 与现有 API/ViewModel 同时完成并通过验证。
- [ ] Product Console 首次打开默认展示中文界面。
- [ ] 语言切换后当前页面和后续导航使用所选语言，刷新后仍保留用户选择。
- [ ] 语言切换不得翻译或改写 Evidence、diff、日志、文件路径、命令输出和用户输入内容。
- [ ] 浏览器级验证覆盖默认中文和至少一次语言切换。
- [ ] Product Console 提供导入现有项目、新建项目表单、项目列表和当前项目切换控件。
- [ ] 导入现有项目和新建项目必须使用不同表单：导入表单只要求设置现有项目目录，并自动扫描项目名称、默认分支、仓库来源和技术栈；新建表单聚焦项目目标、类型、技术偏好和 workspace 目录名。
- [ ] 新建项目表单提交的新项目目录必须为 `workspace/<project-slug>`；导入现有项目提交用户填写的现有项目目录。
- [ ] 切换项目后 Dashboard、Project Home、Spec Workspace、Runner Console 和 Review Center 只展示当前项目数据。
- [ ] 浏览器级验证覆盖创建项目、切换项目、刷新后保持当前项目上下文，以及 `project_id` 缺失/不匹配时的阻塞反馈。
- [ ] Spec Workspace 浏览器级验证覆盖阶段 1 自动项目初始化、阶段 2 需求录入、Spec Sources 自动扫描和 PRD 上传合并为一个步骤、该步骤内“扫描”和“上传”两个按钮的命令回执、项目切换后的数据隔离，以及阶段 2 不出现 HLD 生成、Feature Spec 拆分或规划流水线入口。
- [ ] 阶段 2 扫描结果展示 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引等来源类型，并标记缺失项、冲突项和需要澄清的问题。
- [ ] Spec Workspace 阶段流程默认不展开阶段内步骤；用户点击阶段状态标签后才展开对应阶段详情，且头部流程只以标签承载状态和提示信息。
- [ ] Product Console 提供系统设置入口，系统设置至少包含 CLI 配置页。
- [ ] 系统设置提供 CLI Adapter 配置管理 UI，覆盖原始 JSON 编辑、JSON Schema 表单编辑、token 价格表编辑、dry-run 校验、保存草稿、启用/禁用和字段级错误展示。
- [ ] Runner Console 只展示 CLI Adapter 配置健康摘要和跳转入口，不直接编辑 CLI 配置。
- [ ] Runner Console 浏览器级验证覆盖 `cli.run` / `native.run` 执行队列、Job 列表、execution detail、payload context、workspace、Runner heartbeat、blocked reason 或 Evidence 摘要。
- [ ] Runner Console 浏览器级验证覆盖 Job 队列筛选、执行详情、可读执行描述，以及详情来自真实 ViewModel 字段而不是静态 demo 文案。
- [ ] Audit Center 浏览器级验证覆盖审计摘要、Audit Timeline、事件详情、阻塞原因、Evidence / Approval 关联记录和英文 `Audit Center` 文案。
- [ ] CLI Adapter 表单编辑和原始 JSON 编辑共享同一份配置事实源，切换编辑模式不得丢失未保存修改。
- [ ] 浏览器级验证覆盖 CLI Adapter JSON 编辑、表单编辑、校验失败、成功保存和无效配置不影响 running Execution Record 的反馈。
- [ ] 浏览器级验证覆盖 Spec Workspace / Task Board 执行动作返回 scheduler job、execution id、workspace、skill phase、blocked reason 和 Evidence 摘要。
- [ ] 浏览器级验证覆盖 Feature 级 `schedule_run` 不依赖 `task_graph_tasks` / `tasks`，完整 Feature Spec 目录可入队，缺失三件套时展示 blocked reason。
- [ ] 浏览器级验证覆盖 Runner Console 调度/运行按钮仍返回 command receipt，且不会绕过 Console Command Gateway。

## Risks and Open Questions

- Product Console 需要避免把说明性文本做成替代真实状态的静态页面。
- JSON 表单需要避免产生与 adapter JSON 分离的第二套配置事实源。
- workspace-aware skill invocation 需要避免把平台 Skill Registry 语义重新带回 Console；UI 只展示 CLI 运行状态和证据。
