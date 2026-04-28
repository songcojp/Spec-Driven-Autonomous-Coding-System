# Feature Spec: FEAT-010 Failure Recovery

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 6.11 节 FR-090 至 FR-092；第 9.2 节 |
| Requirements | REQ-043, REQ-044, REQ-045, NFR-002, NFR-003 |
| HLD | 7.10 Recovery Manager, 10.4 Review and Recovery Workflow, 11 Security, Privacy, and Governance |

## Scope

- 当任务失败且可尝试自动恢复时，生成恢复任务并调用 `failure-recovery-skill`。
- Recovery Agent 支持自动修复、回滚当前任务修改、拆分任务、降级为只读分析、请求人工审批、更新 Spec 或更新任务依赖。
- 记录失败原因、修复方案、禁止重复策略、失败次数和失败模式指纹。
- 对同一失败模式最多自动重试 3 次，退避时间为 2 分钟、4 分钟和 8 分钟。

## Non-Scope

- 不执行基础状态检测；检测归属 FEAT-009。
- 不处理人工审批 UI；审批归属 FEAT-011。
- 不实现 workspace 创建；回滚边界归属 FEAT-007。

## User Value

自动化失败后，系统可以基于证据尝试有限恢复，并在重复失败或高风险时停止盲目重试，转入人工处理路径。

## Requirements

- 恢复任务必须包含失败类型、失败命令、摘要、相关文件、历史尝试、禁止重试项和最大重试次数。
- 每次恢复动作都必须有 Evidence Pack 和下一步建议。
- 达到最大重试次数后系统停止自动重试并进入人工处理路径。
- 失败模式指纹至少由 task_id、失败阶段、失败命令或检查项、规范化错误摘要和相关文件集合生成。
- 禁止重复策略必须阻止再次自动执行已导致同一指纹失败的方案、命令和文件范围。

## Acceptance Criteria

- [ ] 可恢复失败会生成 RecoveryTask 并调用 failure-recovery-skill。
- [ ] 自动恢复动作能写入 Evidence Pack。
- [ ] 同一失败模式第 4 次不会自动重试。
- [ ] 重试退避按 2、4、8 分钟记录。

## Risks and Open Questions

- 自动回滚可能影响用户手动修改，必须依赖 FEAT-007 的 workspace 边界。
- 判断“同一失败模式”的规范化摘要需要可测试且可解释。
