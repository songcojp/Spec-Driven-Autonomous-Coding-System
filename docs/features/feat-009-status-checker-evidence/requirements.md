# Feature Spec: FEAT-009 Status Checker and Evidence

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 4.5 节；第 6.10 节 FR-080 至 FR-082；第 7 节 EvidencePack |
| Requirements | REQ-040, REQ-041, REQ-042, REQ-051, EDGE-008, EDGE-009, NFR-005, NFR-009 |
| HLD | 7.9 Status Checker and Evidence Store, 14 Testing and Quality Strategy |

## Scope

- 在每次 Run 后检测 Git diff、构建、单元测试、集成测试、类型检查、lint、安全扫描、敏感信息扫描、Spec Alignment、任务完成度、风险文件和未授权文件。
- 检查 diff、task、user story、requirement、acceptance criteria、测试覆盖和 forbidden files 的一致性。
- 输出 Done、Ready、Scheduled、Review Needed、Blocked 或 Failed 的状态判断和原因。
- 生成结构化 Evidence Pack，包含 run_id、agent_type、task_id、status、summary、执行证据和推荐动作。
- 将 Evidence Pack 提供给 Status Checker、Review Center、Recovery Agent 和交付报告复用。

## Non-Scope

- 不执行 Codex CLI；执行归属 FEAT-008。
- 不生成恢复任务；恢复归属 FEAT-010。
- 不执行审批；审批归属 FEAT-011。

## User Value

系统不会凭主观判断宣称任务完成，而是基于 diff、测试、安全、Spec Alignment 和 Evidence 输出可审计状态。

## Requirements

- 每次 Run 后都必须有状态检测结果和证据。
- 与 Spec 不一致的变更不得直接进入 Done。
- 连续失败超过阈值时任务进入 Failed。
- Evidence 写入失败时任务必须进入 blocked 或 failed，并保留可诊断错误。
- Evidence 写入耗时必须被记录为后续性能优化基线。

## Acceptance Criteria

- [ ] Status Checker 可以消费 Runner 输出并生成 StatusCheckResult。
- [ ] Spec Alignment 不通过时任务不会进入 Done。
- [ ] Evidence Pack 可被 Review、Recovery 和 Delivery 查询复用。
- [ ] Evidence 写入失败会标记 blocked 或 failed。

## Risks and Open Questions

- 完整 diff 是否默认进入 Evidence artifact，还是只保存摘要并引用 Git commit，仍待确认。
- 目标仓库测试命令不固定，需要从 Project Health Checker 发现结果读取。
