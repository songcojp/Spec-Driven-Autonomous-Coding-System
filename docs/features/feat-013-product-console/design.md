# Design: FEAT-013 Product Console

## Design Summary

Product Console 是用户可访问的浏览器控制台，也是控制面状态的查询和命令入口。它由 Project Switcher、Dashboard、Project Home、Spec Workspace、Skill Center、Subagent Console、Runner Console、Review Center 和 Language Switcher 组成，只通过 Control Plane API 查询和发起受控命令，不直接修改 Git 工作区。现有 Query/ViewModel 和 HTTP JSON endpoint 是后端契约，不是 UI 交付物。

CHG-009 修正：FEAT-013 必须交付真实前端应用入口、页面路由、组件、状态反馈和浏览器级验收；不能把 API、ViewModel、测试 fixture 或静态说明文本当作用户 UI。

Implementation update：Product Console UI 采用 Vite React，前端入口位于 `apps/product-console`。UI 通过 Tailwind CSS、Radix UI primitives 和 repo-owned shadcn-style primitives 实现，消费现有 `/console/*` Control Plane API/ViewModel，并保留 `docs/features/feat-013-product-console/assets/product-console-concept.png` 作为视觉概念验收基线。

ADD-004 update：Product Console 首次打开默认中文，App Shell 提供语言切换控件并持久化用户选择。语言资源只覆盖界面文案；Evidence、diff、日志、文件路径、命令输出和用户输入内容作为事实数据保持原文。

ADD-005 update：App Shell 提供导入现有项目、新建项目表单、项目列表和当前项目切换控件。导入和新建是两个不同表单：导入表单只收集已有项目目录，并通过 `/projects/scan` 自动识别项目名称、默认分支、仓库来源和技术栈；新建表单收集项目名称、目标、类型、技术偏好、workspace 目录名、默认分支和自动化开关。当前项目上下文来自 FEAT-001 的 ProjectSelectionContext；所有页面查询和受控命令都必须携带 `project_id`，并在缺失或不匹配时展示 blocked 反馈。新建项目表单统一提交 `workspace/<project-slug>` 作为项目目录；导入现有项目保留用户填写的已有目录。

CHG-010 update：原一级 “Dashboard Board / Board / 看板” 页面正式命名为 “Project Home / 项目主页”。Project Home 是当前单个项目的概览入口，聚合项目身份、仓库/分支、活跃 Feature、运行摘要、风险、最近 PR、Evidence / 审计事件和任务看板。Task Board / 任务看板保留为 Project Home 内部任务状态与受控操作分区；现有 `/console/dashboard-board` 查询、Board ViewModel 和 board command action 不在本次改名中迁移。

CHG-011 update：阶段 1 项目初始化由 FEAT-001 的 Project Service 自动完成。Spec Workspace 只展示项目创建/导入、Git 仓库、`.autobuild/` / Spec Protocol、项目宪章、Project Memory、健康检查和当前项目上下文的自动初始化状态、事实来源和阻塞原因，不提供逐步手动执行这些子步骤的入口。

CHG-012 update：阶段 2 需求录入先自动扫描 Spec Sources。扫描范围包括 PRD、EARS、requirements、HLD、design、已有 Feature Spec、tasks 和 README / 索引等文档；UI 展示发现数量、来源路径、类型、缺失项、冲突项和需要澄清的问题。阶段 2 允许扫描已有 HLD / Feature Spec 作为事实源，但 HLD 生成、Feature Spec 拆分和规划流水线仍属于选中 Feature 的阶段 3 受控操作。

## Components

| Component | Responsibility |
|---|---|
| Project Switcher | 展示项目列表、当前项目、项目健康摘要、导入入口和新建表单，并触发项目切换。 |
| Dashboard View | 聚合项目健康、Feature、任务、Subagent、失败、审批、成本、PR 和风险。 |
| Project Home View | 作为单个当前项目的概览入口，展示项目身份、仓库/分支、活跃 Feature、运行摘要、风险、最近 PR、Evidence / 审计事件，并承载 Task Board 分区。 |
| Task Board Section | 展示任务依赖、diff、测试结果、审批状态和失败恢复历史，并发起受控拖拽、批量排期和批量运行命令。 |
| Spec Workspace View | 展示阶段 1 自动项目初始化、阶段 2 需求录入、Spec Sources 扫描、Feature Spec、澄清、Checklist、计划、数据模型、契约、任务图和版本 diff。 |
| Skill Center View | 展示项目本地 `.agents/skills/*/SKILL.md` 元数据和文件路径。 |
| Subagent Console View | 展示 run、CLI subagent event、Evidence、Status Check、token 和状态。 |
| Runner Console View | 展示 Runner 在线、Codex 版本、安全配置、queue、日志和心跳。 |
| Review Center View | 展示 ReviewItem、风险筛选、diff、Evidence 和审批动作。 |
| Console Command Gateway | 将 UI 动作转换为 Control Plane 命令。 |
| Frontend App Shell | 提供浏览器入口、导航、路由、布局、错误边界、加载态、项目切换、语言切换和页面切换。 |
| Locale Provider | 管理默认中文、语言资源、语言偏好持久化和 UI 文案查找。 |
| shadcn/ui Component Layer | 提供表格、标签页、按钮、弹窗、状态徽标、命令菜单、表单和审计反馈组件。 |

## Data Ownership

- Owns: 前端应用入口、页面路由、UI 组件、UI View Model、Dashboard Query Model、Console Action Command、UI locale preference、UI project selection state。
- Reads: Control Plane API、Audit/Metrics、Evidence、Memory 投影、Review 查询。
- Writes: 受控命令请求；不直接写 Git、worktree 或 artifact。

## State and Flow

1. 用户在浏览器打开 Product Console。
2. Frontend App Shell 读取持久化语言偏好；没有偏好时默认中文，并加载项目列表、当前项目上下文、导航和默认 Dashboard 页面。
3. Dashboard Query Service 按当前 `project_id` 聚合状态并通过页面组件展示真实数据、加载态、空态或错误态。
4. 用户进入具体工作台查看证据、diff、日志、任务图或执行命令。
5. Spec Workspace 从项目、仓库连接、项目宪章、Project Memory、Feature、Requirement 和审计事件派生 PRD 流程阶段状态；阶段 1 展示自动项目初始化事实和阻塞原因，阶段 2 展示 Spec Sources 自动扫描、PRD 上传、格式识别、已有 HLD / Feature Spec / tasks 盘点、EARS / Feature Spec 生成、澄清、质量检查和 Feature Spec Pool 状态。
6. Console Command Gateway 将拖拽、批量排期、批量运行、暂停、恢复、终止、重试和 PRD 流程动作连同当前 `project_id` 提交为受控命令；阶段 3 的 HLD、Feature 拆分和规划流水线不得混入阶段 2。
7. Control Plane 更新状态，Console 显示成功、阻塞或失败反馈并重新查询。
8. 用户切换语言后，App Shell 保存偏好并重新渲染界面文案；事实数据保持 API 返回原文。
9. 用户切换项目后，App Shell 更新当前项目上下文，重新查询所有项目级页面；若命令返回 `project_id` 缺失或不匹配，展示阻塞反馈并保留原页面状态。
10. 用户在导入现有项目表单设置目录后，Console 调用只读 `/projects/scan` 扫描 Git、包管理器、SpecDrive 目录和仓库来源，并把扫描结果作为导入项目默认信息。

## Dependencies

- FEAT-001 至 FEAT-012 提供各自查询模型和命令入口。
- FEAT-001 提供项目目录、项目创建、ProjectSelectionContext 和项目级查询隔离。
- FEAT-014 提供指标、审计和持久状态。
- HLD 指定 React + Next.js 或 Vite React、shadcn/ui、Tailwind CSS 和 Radix UI primitives 作为默认 UI 栈；如实现阶段已有宿主框架，必须在本设计中记录替代栈与验收影响。

## Review and Evidence

- Console 展示 Evidence 摘要时必须保留跳转到来源证据的能力。
- 所有审批、拖拽、批量排期、批量运行、暂停、恢复、终止、重试和规则写入动作必须写审计。
- UI 验收必须包含浏览器级验证：首屏非空、导航可用、核心页面渲染真实状态、空态/错误态可见、至少一个受控命令动作有用户反馈。
- UI 多语言验收必须覆盖首次打开默认中文、切换语言、刷新后保留语言偏好，以及 Evidence、diff、日志、文件路径和命令输出保持原文。
- UI 多项目验收必须覆盖项目创建入口、项目列表、项目切换、刷新后保留当前项目，以及不同项目数据不串读。
- UI Spec Sources 验收必须覆盖阶段 2 自动扫描状态、PRD / EARS / HLD / Feature Spec / tasks 等来源类型、缺失项、冲突项和阶段 2 不展示阶段 3 生成/拆分/规划入口。
- API 单元测试、ViewModel 快照或 HTTP JSON 响应只能证明后端契约，不能单独作为 Product Console 完成证据。
- 浏览器验收命令：`npm run console:test`。构建验收命令：`npm run console:build`。
