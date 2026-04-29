# Design: FEAT-013 Product Console

## Design Summary

Product Console 是用户可访问的浏览器控制台，也是控制面状态的查询和命令入口。它由 Dashboard、Dashboard Board、Spec Workspace、Skill Center、Subagent Console、Runner Console 和 Review Center 组成，只通过 Control Plane API 查询和发起受控命令，不直接修改 Git 工作区。现有 Query/ViewModel 和 HTTP JSON endpoint 是后端契约，不是 UI 交付物。

CHG-009 修正：FEAT-013 必须交付真实前端应用入口、页面路由、组件、状态反馈和浏览器级验收；不能把 API、ViewModel、测试 fixture 或静态说明文本当作用户 UI。

Implementation update：Product Console UI 采用 Vite React，前端入口位于 `apps/product-console`。UI 通过 Tailwind CSS、Radix UI primitives 和 repo-owned shadcn-style primitives 实现，消费现有 `/console/*` Control Plane API/ViewModel，并保留 `docs/features/feat-013-product-console/assets/product-console-concept.png` 作为视觉概念验收基线。

## Components

| Component | Responsibility |
|---|---|
| Dashboard View | 聚合项目健康、Feature、任务、Subagent、失败、审批、成本、PR 和风险。 |
| Dashboard Board View | 展示任务依赖、diff、测试结果、审批状态和失败恢复历史，并发起受控拖拽、批量排期和批量运行命令。 |
| Spec Workspace View | 展示 Feature Spec、澄清、Checklist、计划、数据模型、契约、任务图和版本 diff。 |
| Skill Center View | 展示项目本地 `.agents/skills/*/SKILL.md` 元数据和文件路径。 |
| Subagent Console View | 展示 run、CLI subagent event、Evidence、Status Check、token 和状态。 |
| Runner Console View | 展示 Runner 在线、Codex 版本、安全配置、queue、日志和心跳。 |
| Review Center View | 展示 ReviewItem、风险筛选、diff、Evidence 和审批动作。 |
| Console Command Gateway | 将 UI 动作转换为 Control Plane 命令。 |
| Frontend App Shell | 提供浏览器入口、导航、路由、布局、错误边界、加载态和页面切换。 |
| shadcn/ui Component Layer | 提供表格、标签页、按钮、弹窗、状态徽标、命令菜单、表单和审计反馈组件。 |

## Data Ownership

- Owns: 前端应用入口、页面路由、UI 组件、UI View Model、Dashboard Query Model、Console Action Command。
- Reads: Control Plane API、Audit/Metrics、Evidence、Memory 投影、Review 查询。
- Writes: 受控命令请求；不直接写 Git、worktree 或 artifact。

## State and Flow

1. 用户在浏览器打开 Product Console。
2. Frontend App Shell 加载全局项目上下文、导航和默认 Dashboard 页面。
3. Dashboard Query Service 聚合状态并通过页面组件展示真实数据、加载态、空态或错误态。
4. 用户进入具体工作台查看证据、diff、日志、任务图或执行命令。
5. Console Command Gateway 将拖拽、批量排期、批量运行、暂停、恢复、终止和重试等动作提交为受控命令。
6. Control Plane 更新状态，Console 显示成功、阻塞或失败反馈并重新查询。

## Dependencies

- FEAT-001 至 FEAT-012 提供各自查询模型和命令入口。
- FEAT-014 提供指标、审计和持久状态。
- HLD 指定 React + Next.js 或 Vite React、shadcn/ui、Tailwind CSS 和 Radix UI primitives 作为默认 UI 栈；如实现阶段已有宿主框架，必须在本设计中记录替代栈与验收影响。

## Review and Evidence

- Console 展示 Evidence 摘要时必须保留跳转到来源证据的能力。
- 所有审批、拖拽、批量排期、批量运行、暂停、恢复、终止、重试和规则写入动作必须写审计。
- UI 验收必须包含浏览器级验证：首屏非空、导航可用、核心页面渲染真实状态、空态/错误态可见、至少一个受控命令动作有用户反馈。
- API 单元测试、ViewModel 快照或 HTTP JSON 响应只能证明后端契约，不能单独作为 Product Console 完成证据。
- 浏览器验收命令：`npm run console:test`。构建验收命令：`npm run console:build`。
