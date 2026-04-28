# Design: FEAT-009 Status Checker and Evidence

## Design Summary

Status Checker 将执行结果转换为状态机可消费的判断。Evidence Store 保存结构化证据，并为 Review、Recovery、Delivery 和 Metrics 提供统一事实。

## Components

| Component | Responsibility |
|---|---|
| Evidence Store | 保存 Evidence Pack、附件引用、写入耗时和错误。 |
| Diff Inspector | 检测 Git diff、风险文件和未授权文件。 |
| Command Check Runner | 执行或读取构建、测试、类型检查、lint 和安全扫描结果。 |
| Spec Alignment Checker | 校验 diff、任务、用户故事、需求、验收、测试和 forbidden files 一致性。 |
| Status Decision Engine | 输出 Done、Ready、Scheduled、Review Needed、Blocked 或 Failed。 |
| Evidence Query Model | 为 Review、Recovery、Delivery 和 Console 提供查询。 |

## Data Ownership

- Owns: EvidencePack、StatusCheckResult、SpecAlignmentResult。
- Reads: Runner 输出、Git diff、Task、AgentRunContract、SpecSlice、Test 命令。
- Writes: Persistent Store、`.autobuild/evidence/`、Audit Timeline、MetricSample。

## State and Flow

1. Runner 完成后提交执行结果。
2. Evidence Store 写入初始 Evidence。
3. Status Checker 收集 diff、命令、测试、安全和 Spec Alignment。
4. Status Decision Engine 生成状态判断和原因。
5. 状态机、Review Center 或 Recovery Manager 消费判断。

## Dependencies

- FEAT-001 提供项目测试/构建命令发现。
- FEAT-005 提供 Run Contract。
- FEAT-008 提供执行输出。
- FEAT-014 提供 Evidence 持久化、审计和指标。

## Review and Evidence

- Review Needed 必须包含具体触发原因和推荐动作。
- Evidence 写入失败不能被静默忽略，必须阻断状态推进。
