# Feature Spec: FEAT-013 Product Console

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 8.1 至 8.7 节页面需求 |
| Requirements | REQ-052, REQ-053, REQ-054, REQ-055, REQ-056, REQ-057, REQ-061, REQ-062, REQ-063, NFR-006, NFR-007, NFR-008, NFR-010 |
| HLD | 7.11 Product Console and Dashboard, 12 Observability and Operability |

Spec Evolution:
- CHG-009：实现证据显示当前仓库只有 Control Plane API、Query/ViewModel 和 API 层测试，没有用户可访问的前端应用、页面路由、组件系统或浏览器验收。FEAT-013 从 `done` 重新打开为 `in-progress`；API/ViewModel 只能作为 UI 后端基础，不能替代 Product Console 用户界面。
- ADD-004：用户要求 UI 支持多语言切换，且默认中文。该需求作为 Product Console patch 处理，必须覆盖界面文案、语言偏好和浏览器级验证。
- ADD-005：用户要求支持项目创建、导入现有项目和多个项目切换。该需求由 FEAT-001 提供项目目录与当前项目上下文，Product Console 必须提供导入/新建表单、项目列表、项目切换控件和项目级查询隔离反馈。

## Scope

- Dashboard 展示项目健康度、当前活跃 Feature、看板任务数量、运行中 Subagent、今日自动执行次数、失败任务、待审批任务、成本消耗、最近 PR 和风险提醒。
- Product Console App Shell 提供导入现有项目入口、新建项目表单、项目列表和当前项目切换控件；当前项目上下文驱动所有页面查询和受控命令。
- Dashboard Board 支持受状态机约束的看板拖拽、批量排期、批量运行，以及查看任务依赖、diff、测试结果、审批状态和失败恢复历史。
- Spec Workspace 支持创建 Feature，并查看 Spec、澄清记录、需求质量 checklist、技术计划、数据模型、契约、任务图和 Spec 版本 diff。
- Skill Center 展示项目本地 `.agents/skills/*/SKILL.md` 发现到的 Skill 列表、详情和文件路径。
- Subagent Console 展示 CLI delegation 相关 run、Subagent event、Evidence Pack、Status Check、token 使用和运行状态。
- Runner Console 展示 Runner 在线状态、Codex 版本、sandbox、approval policy、queue、最近日志和心跳状态，并支持暂停或恢复 Runner。
- Review Center 页面展示待审批列表、风险筛选、diff、Evidence、审批操作、项目规则写入和 Spec Evolution 写入入口。
- Product Console 必须提供用户可访问的前端应用入口、页面路由和可交互控件；Control Plane JSON API、Query Model 或 ViewModel 不构成用户 UI 完成证据。
- Product Console 必须默认使用中文界面，并提供可见语言切换入口；切换范围覆盖导航、页面标题、操作按钮、状态标签、空态、错误态、反馈提示和确认信息。

## Non-Scope

- Product Console 不直接写 Git 工作区。
- Dashboard 不是调度或状态真实来源。
- 不定义复杂企业级权限矩阵。
- 不把静态说明页、命令行输出、纯 JSON 响应或仅供测试调用的 ViewModel 当作 Product Console UI。

## User Value

用户可以从一个控制台理解项目健康、自动化进度、任务风险、Subagent 状态、Runner 状态和待审批事项，并通过受控命令操作系统。

## Requirements

- Dashboard 可以展示项目级和任务级状态摘要。
- Dashboard Board 可以展示任务依赖、diff、测试结果、审批状态和失败恢复历史入口。
- Dashboard Board 的拖拽或批量操作只能产生受状态机允许的状态变更或调度请求。
- 用户可以从 Spec Workspace 追踪需求到任务图。
- 用户可以查看 Skill 是否启用以及最近执行情况。
- 用户可以定位每个 Subagent 的输入、输出和当前状态。
- 用户可以判断 Runner 是否可执行新任务。
- 高风险、阻塞或需澄清任务能从 Review Center 被处理。
- 用户可以在浏览器中打开 Product Console，并在 Dashboard、Dashboard Board、Spec Workspace、Skill Center、Subagent Console、Runner Console 和 Review Center 之间切换。
- 用户可以导入现有项目或通过表单创建新项目，在项目列表中切换当前项目，并看到各页面随当前项目刷新。
- 每个页面必须有加载态、空态、错误态和真实数据态；页面文案不能替代状态数据、Evidence、diff、日志或命令结果。
- 用户动作必须通过可见控件发起，且控件调用 Control Plane 受控命令后展示成功、阻塞或失败反馈。
- 所有项目级受控命令必须携带当前 `project_id`；缺少或不匹配时展示阻塞反馈，不得静默使用上一个项目。
- 用户可以切换界面语言并保留选择；Evidence、diff、日志、文件路径、命令输出和用户输入内容保持原文，不被界面翻译层改写。

## Acceptance Criteria

- [ ] Console 所有写操作都通过 Control Plane 命令发起。
- [ ] 批量排期和批量运行保留审计记录，并对高风险、依赖未满足或审批缺失任务给出阻塞原因。
- [ ] 看板加载和状态刷新耗时被记录为性能基线。
- [ ] Runner 心跳、成本、成功率和失败率可展示。
- [ ] Dashboard 不覆盖 Persistent Store、Project Memory 或 Git 事实。
- [ ] 仓库包含可运行的前端应用入口、路由和页面组件，至少覆盖 Dashboard、Dashboard Board、Spec Workspace、Skill Center、Subagent Console、Runner Console 和 Review Center。
- [ ] Product Console 接入 HLD 指定的 React + Next.js 或 Vite React，以及 shadcn/ui + Tailwind CSS + Radix UI primitives，若因宿主框架调整必须在设计中记录替代方案。
- [ ] 浏览器级验证覆盖 Console 首屏、页面切换、真实数据渲染、空态/错误态和一个受控命令动作；API 层测试不能单独满足 UI 验收。
- [ ] FEAT-013 不得标记为 `done`，除非用户可访问 UI 与现有 API/ViewModel 同时完成并通过验证。
- [ ] Product Console 首次打开默认展示中文界面。
- [ ] 语言切换后当前页面和后续导航使用所选语言，刷新后仍保留用户选择。
- [ ] 语言切换不得翻译或改写 Evidence、diff、日志、文件路径、命令输出和用户输入内容。
- [ ] 浏览器级验证覆盖默认中文和至少一次语言切换。
- [ ] Product Console 提供导入现有项目、新建项目表单、项目列表和当前项目切换控件。
- [ ] 导入现有项目和新建项目必须使用不同表单：导入表单聚焦现有项目目录，新建表单聚焦项目目标、类型、技术偏好和 workspace 目录名。
- [ ] 新建项目表单提交的新项目目录必须为 `workspace/<project-slug>`；导入现有项目提交用户填写的现有项目目录。
- [ ] 切换项目后 Dashboard、Board、Spec Workspace、Skill Center、Subagent Console、Runner Console 和 Review Center 只展示当前项目数据。
- [ ] 浏览器级验证覆盖创建项目、切换项目、刷新后保持当前项目上下文，以及 `project_id` 缺失/不匹配时的阻塞反馈。

## Risks and Open Questions

- Product Console 需要避免把说明性文本做成替代真实状态的静态页面。
