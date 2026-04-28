# Design: FEAT-012 Delivery and Spec Evolution

## Design Summary

Delivery Manager 在 Feature 满足 done 和合并前检查后创建 PR、生成 Delivery Report，并根据实现证据提出 Spec Evolution 建议。交付不是状态机的旁路，而是 Evidence、Review 和验收结果的汇总投影。

## Components

| Component | Responsibility |
|---|---|
| Delivery Gate | 判断 Feature 是否达到 PR 创建条件。 |
| PR Generator | 通过本机 `gh` CLI 创建 PR 或生成 PR 请求内容。 |
| Delivery Reporter | 汇总完成内容、文件、验收、测试、恢复、风险和下一步建议。 |
| Spec Evolution Advisor | 从 Evidence、审批、测试和实现约束生成 Spec 更新建议。 |
| Rollback Plan Builder | 汇总分支、worktree、base commit 和回滚说明。 |

## Data Ownership

- Owns: PullRequestRecord、DeliveryReport、SpecEvolutionSuggestion。
- Reads: Feature、Task、Requirement、Evidence、ApprovalRecord、WorktreeRecord、StatusCheckResult。
- Writes: PR 记录、`.autobuild/reports/`、状态机交付事件。

## State and Flow

1. Feature Aggregator 判定 Feature done。
2. Delivery Gate 检查 Evidence、验收、审批和合并前状态。
3. PR Generator 生成 PR 内容并调用 `gh`。
4. Delivery Reporter 写交付报告。
5. Spec Evolution Advisor 写建议。
6. 状态机进入 delivered 或 blocked/review_needed。

## Dependencies

- FEAT-004 提供 Feature done 判定。
- FEAT-007 提供合并前状态和回滚边界。
- FEAT-009 提供 Evidence 和 StatusCheckResult。
- FEAT-011 提供审批记录。

## Review and Evidence

- PR 和 Delivery Report 必须引用需求、任务、测试和审批证据。
- 未完成事项和风险不能被隐藏，必须进入报告。
