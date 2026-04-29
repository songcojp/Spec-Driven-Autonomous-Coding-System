# Tasks: FEAT-012 Delivery and Spec Evolution

- [x] TASK-001: 定义 PullRequestRecord、DeliveryReport 和 SpecEvolutionSuggestion 数据模型。
- [x] TASK-002: 实现 Delivery Gate，检查 Feature done、Evidence、测试、审批、合并前检查和回滚方案。
- [x] TASK-003: 实现 PR Generator，通过本机 `gh` CLI 生成包含需求、任务、测试、风险、审批和回滚信息的 PR。
- [x] TASK-004: 实现 Delivery Reporter，汇总完成内容、变更文件、验收结果、测试摘要、失败恢复、风险项和下一步建议。
- [x] TASK-005: 实现 Spec Evolution Advisor，生成带来源证据和影响范围的建议。
- [x] TASK-006: 实现 PR 创建失败路径，进入 blocked 或 Review Needed 并保留交付证据。
- [x] TASK-007: 添加测试，验证 PR 正文追踪、交付报告完整性和 Spec Evolution 来源映射。

## Code Review and Final Test Gate

- Review loop: 3 Codex review passes completed before the blocker; pass 1 and pass 2 fix batches cleared stale approval, prepare-request delivery state, evidence-less Spec Evolution suggestions, failed PR state, artifact-root placement, and fallback rollback issues.
- Blocker resolution: owner-approved narrow repair fixed the pass 3 P1 findings by blocking unresolved open review items even without approval records, and by evaluating only current status-check evidence after reruns.
- Review quality: all three review passes were useful; no regression tests were run between review/fix passes before the loop blocker.
- Final regression: `timeout 180s node --test tests/delivery.test.ts tests/review-center.test.ts tests/status-checker.test.ts` passed, 103 tests.
- Final full suite: `timeout 600s node --test tests/*.test.ts` passed, 230 tests.
