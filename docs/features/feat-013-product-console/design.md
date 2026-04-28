# Design: FEAT-013 Product Console

## Design Summary

Product Console 是控制面状态的查询和命令入口。它由 Dashboard、Spec Workspace、Skill Center、Subagent Console、Runner Console 和 Review Center 组成，只通过 Control Plane API 查询和发起受控命令，不直接修改 Git 工作区。

## Components

| Component | Responsibility |
|---|---|
| Dashboard View | 聚合项目健康、Feature、任务、Subagent、失败、审批、成本、PR 和风险。 |
| Spec Workspace View | 展示 Feature Spec、澄清、Checklist、计划、数据模型、契约、任务图和版本 diff。 |
| Skill Center View | 展示 Skill 元数据、版本、schema、启用状态、日志、成功率和风险。 |
| Subagent Console View | 展示 Run Contract、上下文切片、Evidence、token、状态、终止和重试入口。 |
| Runner Console View | 展示 Runner 在线、Codex 版本、安全配置、queue、日志和心跳。 |
| Review Center View | 展示 ReviewItem、风险筛选、diff、Evidence 和审批动作。 |
| Console Command Gateway | 将 UI 动作转换为 Control Plane 命令。 |

## Data Ownership

- Owns: UI View Model、Dashboard Query Model、Console Action Command。
- Reads: Control Plane API、Audit/Metrics、Evidence、Memory 投影、Review 查询。
- Writes: 受控命令请求；不直接写 Git、worktree 或 artifact。

## State and Flow

1. 用户打开 Console。
2. Dashboard Query Service 聚合状态。
3. 用户进入具体工作台查看证据或执行命令。
4. Console Command Gateway 提交受控命令。
5. Control Plane 更新状态，Console 重新查询。

## Dependencies

- FEAT-001 至 FEAT-012 提供各自查询模型和命令入口。
- FEAT-014 提供指标、审计和持久状态。

## Review and Evidence

- Console 展示 Evidence 摘要时必须保留跳转到来源证据的能力。
- 所有审批、暂停、恢复、终止、重试和规则写入动作必须写审计。
