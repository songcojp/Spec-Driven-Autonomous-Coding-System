# Tasks: FEAT-013 Product Console

- [x] TASK-001: 定义 Dashboard Query Model 和各 Console View Model。
- [x] TASK-002: 实现 Dashboard 聚合查询，展示健康、活跃 Feature、看板数量、Subagent、自动执行次数、失败、审批、成本、PR 和风险。
- [x] TASK-003: 实现 Spec Workspace 查询和创建 Feature 命令入口。
- [x] TASK-004: 实现 Skill Center 查询，展示 Skill 详情、版本、schema、启用状态、日志、成功率、阶段和风险。
- [x] TASK-005: 实现 Subagent Console 查询和终止/重试受控命令入口。
- [x] TASK-006: 实现 Runner Console 查询和暂停/恢复受控命令入口。
- [x] TASK-007: 实现 Review Center 页面查询和审批动作入口。
- [x] TASK-008: 记录看板加载和状态刷新耗时，作为性能基线。
- [x] TASK-009: 添加 UI 或 API 层测试，确认 Console 不直接写 Git 工作区。
- [ ] TASK-010: 实现 Dashboard Board 真实任务状态入口，展示任务依赖、diff、测试结果、审批状态和失败恢复历史。
- [ ] TASK-011: 实现 Board 拖拽意图、批量排期和批量运行的受控命令入口，校验状态机、依赖、高风险和审批约束并记录审计。
- [ ] TASK-012: 初始化或接入真实前端应用入口，采用 HLD 指定的 React + Next.js 或 Vite React，并接入 shadcn/ui、Tailwind CSS 和 Radix UI primitives；若复用宿主框架，更新 design.md 记录替代方案。
- [ ] TASK-013: 实现 Product Console App Shell、导航、路由、布局、加载态、空态、错误态和真实数据态。
- [ ] TASK-014: 实现 Dashboard、Dashboard Board、Spec Workspace、Skill Center、Subagent Console、Runner Console 和 Review Center 的用户可见页面组件，消费现有 Control Plane API/ViewModel。
- [ ] TASK-015: 将创建 Feature、终止/重试 Subagent、暂停/恢复 Runner、审批动作、Board 拖拽意图、批量排期和批量运行暴露为可见控件，并展示成功、阻塞或失败反馈。
- [ ] TASK-016: 添加浏览器级 UI 验证，覆盖首屏非空、页面切换、真实数据渲染、空态/错误态和至少一个受控命令动作；API 层测试不能单独完成此任务。
