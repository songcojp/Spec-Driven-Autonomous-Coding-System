# Tasks: FEAT-011 Review Center

- [ ] TASK-001: 定义 ReviewItem、ApprovalRecord 和 ReviewDecision 数据模型。
- [ ] TASK-002: 实现 Review Router，接收高风险文件、diff 超阈值、forbidden files、多次失败、权限提升、歧义和架构变更触发。
- [ ] TASK-003: 实现 Review Query Service，聚合任务目标、Spec、Run Contract、diff、测试结果、风险说明、Evidence 和推荐动作。
- [ ] TASK-004: 实现审批动作处理，覆盖批准继续、拒绝、要求修改、回滚、拆分任务、更新 Spec 和标记完成。
- [ ] TASK-005: 实现审批缺失阻断规则，确认任务不会进入 Done 或 Delivered。
- [ ] TASK-006: 接入项目规则写入和 Spec Evolution 写入入口。
- [ ] TASK-007: 添加测试，覆盖三类 review_needed reason、审批动作回流和审批缺失阻断。
