# Feature Spec: FEAT-011 Review Center

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 6.12 节 FR-100 至 FR-101；第 8.7 节 |
| Requirements | REQ-046, REQ-047, REQ-057, EDGE-010 |
| HLD | 7.12 Review Center, 10.4 Review and Recovery Workflow, 11 Security, Privacy, and Governance |

## Scope

- 接收高风险区域、diff 超阈值、forbidden files、多次失败、测试未通过但建议继续、高影响歧义、权限提升、constitution 变更或架构方案变更触发的 Review Needed。
- 展示任务目标、关联 Spec、Agent Run Contract、diff 摘要、测试结果、风险说明、推荐动作和可选操作。
- 支持批准继续、拒绝、要求修改、回滚、拆分任务、更新 Spec 或标记完成。
- Review Center 页面展示待审批列表、风险筛选、diff、Evidence、审批操作、项目规则写入和 Spec Evolution 写入入口。

## Non-Scope

- 不实现所有 UI 细节；通用 Console 框架归属 FEAT-013。
- 不执行回滚或修改；具体动作由 Recovery、Workspace 或 Spec 组件执行。
- 不决定大 diff 默认阈值；该阈值仍为开放问题。

## User Value

审批人可以在高风险或不确定任务继续前看到完整上下文和证据，并通过受控动作把系统带回安全路径。

## Requirements

- Review Needed 必须包含具体触发原因和推荐动作。
- 审批人可以执行批准继续、拒绝、要求修改、回滚、拆分任务、更新 Spec 或标记完成。
- 高风险、阻塞或需澄清任务能从 Review Center 被处理。
- 任务处于 Review Needed 但没有审批决策时，不得自动进入 Done 或 Delivered。

## Acceptance Criteria

- [ ] ReviewItem 包含触发原因、风险等级、关联 Evidence 和推荐动作。
- [ ] 审批动作能写入 ApprovalRecord 并回流状态机。
- [ ] 缺少审批决策时受影响任务暂停。
- [ ] Review Center 可以处理 clarification_needed、approval_needed 和 risk_review_needed。

## Risks and Open Questions

- “大 diff”的默认阈值仍待确认。
- 哪些风险等级、文件模式和命令必须强制触发人工审批仍待确认。
