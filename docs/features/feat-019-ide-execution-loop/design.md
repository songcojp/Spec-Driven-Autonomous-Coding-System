# FEAT-019 IDE Execution Loop — 设计

Feature ID: FEAT-019
来源需求: REQ-079、REQ-081、REQ-082
HLD 参考: 第 7.15 节 VSCode SpecDrive Extension、第 9 节 Codex App Server Adapter

## 1. 架构决策

- Spec Explorer Task Queue 是 IDE 侧任务操作主入口。
- 所有队列动作调用 Control Plane command API，返回 command receipt。
- Control Plane / Scheduler / Runner 根据 Job 状态分别处理 queued、running、approval_needed、blocked、failed、completed。
- approval request 由 Runner 挂起并写入 Execution Record，VSCode 插件只提交 approval command。
- 下一 Feature 选择由 `feature-selection-skill` 返回 `select_next_feature` 决策；IDE 只展示选择原因、阻塞原因和恢复动作，不在前端重算优先级或依赖。

## 2. 状态规则

- queued cancel：只更新 Job 状态。
- running cancel：Runner 调用 `turn/interrupt`。
- retry：保留 previousExecutionId、failureReason 和 newExecutionId 关系。
- resume blocked Feature：必须清除或更新 blocked reason。
- approval_needed、blocked、review_needed 和 failed 都是非可持续状态：必须投影到 Feature `spec-state.json` 和 Execution Record 后暂停自动继续，等待 approve、resume、retry、skip 或澄清。

## 3. 验证策略

- Node tests 覆盖 queue actions、retry/cancel state transitions 和 approval persistence。
- VSCode extension tests 覆盖 Execution Record Webview、approval panel 和 reload recovery。
