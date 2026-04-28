# Feature Spec: FEAT-013 Product Console

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 8.1 至 8.7 节页面需求 |
| Requirements | REQ-052, REQ-053, REQ-054, REQ-055, REQ-056, REQ-057, NFR-006, NFR-007, NFR-008, NFR-010 |
| HLD | 7.11 Product Console and Dashboard, 12 Observability and Operability |

## Scope

- Dashboard 展示项目健康度、当前活跃 Feature、看板任务数量、运行中 Subagent、今日自动执行次数、失败任务、待审批任务、成本消耗、最近 PR 和风险提醒。
- Spec Workspace 支持创建 Feature，并查看 Spec、澄清记录、需求质量 checklist、技术计划、数据模型、契约、任务图和 Spec 版本 diff。
- Skill Center 展示 Skill 列表、详情、版本、schema、启用状态、执行日志、成功率、适用阶段和风险等级。
- Subagent Console 展示当前 Subagent、Run Contract、上下文切片、Evidence Pack、token 使用、运行状态，并支持终止和重试。
- Runner Console 展示 Runner 在线状态、Codex 版本、sandbox、approval policy、queue、最近日志和心跳状态，并支持暂停或恢复 Runner。
- Review Center 页面展示待审批列表、风险筛选、diff、Evidence、审批操作、项目规则写入和 Spec Evolution 写入入口。

## Non-Scope

- Product Console 不直接写 Git 工作区。
- Dashboard 不是调度或状态真实来源。
- 不定义复杂企业级权限矩阵。

## User Value

用户可以从一个控制台理解项目健康、自动化进度、任务风险、Subagent 状态、Runner 状态和待审批事项，并通过受控命令操作系统。

## Requirements

- Dashboard 可以展示项目级和任务级状态摘要。
- 用户可以从 Spec Workspace 追踪需求到任务图。
- 用户可以查看 Skill 是否启用以及最近执行情况。
- 用户可以定位每个 Subagent 的输入、输出和当前状态。
- 用户可以判断 Runner 是否可执行新任务。
- 高风险、阻塞或需澄清任务能从 Review Center 被处理。

## Acceptance Criteria

- [ ] Console 所有写操作都通过 Control Plane 命令发起。
- [ ] 看板加载和状态刷新耗时被记录为性能基线。
- [ ] Runner 心跳、成本、成功率和失败率可展示。
- [ ] Dashboard 不覆盖 Persistent Store、Project Memory 或 Git 事实。

## Risks and Open Questions

- Dashboard Board 是否允许拖拽改变状态仍待确认；MVP 默认只允许受控命令。
- Product Console 需要避免把说明性文本做成替代真实状态的静态页面。
