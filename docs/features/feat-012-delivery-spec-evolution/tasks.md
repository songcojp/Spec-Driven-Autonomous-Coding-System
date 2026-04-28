# Tasks: FEAT-012 Delivery and Spec Evolution

- [ ] TASK-001: 定义 PullRequestRecord、DeliveryReport 和 SpecEvolutionSuggestion 数据模型。
- [ ] TASK-002: 实现 Delivery Gate，检查 Feature done、Evidence、测试、审批、合并前检查和回滚方案。
- [ ] TASK-003: 实现 PR Generator，通过本机 `gh` CLI 生成包含需求、任务、测试、风险、审批和回滚信息的 PR。
- [ ] TASK-004: 实现 Delivery Reporter，汇总完成内容、变更文件、验收结果、测试摘要、失败恢复、风险项和下一步建议。
- [ ] TASK-005: 实现 Spec Evolution Advisor，生成带来源证据和影响范围的建议。
- [ ] TASK-006: 实现 PR 创建失败路径，进入 blocked 或 Review Needed 并保留交付证据。
- [ ] TASK-007: 添加测试，验证 PR 正文追踪、交付报告完整性和 Spec Evolution 来源映射。
