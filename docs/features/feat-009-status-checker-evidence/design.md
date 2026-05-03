# Design: FEAT-009 Status Checker

## Design Summary

Status Checker 将执行结果转换为状态机可消费的判断。它保存轻量 StatusCheckResult，并引用 Execution Record、raw logs、SkillOutput 和产物路径；不再维护独立证据包或证据存储。

## Components

| Component | Responsibility |
|---|---|
| Status Checker | 保存 StatusCheckResult、状态原因、检查摘要、推荐动作和执行结果引用。 |
| Diff Inspector | 检测 Git diff、风险文件和未授权文件。 |
| Command Check Runner | 执行或读取构建、测试、类型检查、lint 和安全扫描结果。 |
| Spec Alignment Checker | 校验 diff、任务、用户故事、需求、验收、测试和 forbidden files 一致性。 |
| Status Decision Engine | 输出 Done、Ready、Scheduled、Review Needed、Blocked 或 Failed。 |
| Execution Result Query Model | 为 Review、Recovery、Delivery 和 Console 提供状态检查、日志和产物查询。 |

## Data Ownership

- Owns: StatusCheckResult、SpecAlignmentResult。
- Reads: Runner 输出、Git diff、Task、Runner policy、SpecSlice、Test 命令。
- Writes: Persistent Store、`.autobuild/reports/`、`.autobuild/runs/`、Audit Timeline、MetricSample。

## State and Flow

1. Runner 完成后提交执行结果。
2. Status Checker 写入 StatusCheckResult，并关联 Execution Record、日志和产物引用。
3. Status Checker 收集 diff、命令、测试、安全和 Spec Alignment。
4. Status Decision Engine 生成状态判断和原因。
5. 状态机、Review Center 或 Recovery Manager 消费判断。

## Dependencies

- FEAT-001 提供项目测试/构建命令发现。
- FEAT-008 提供执行输出。
- FEAT-014 提供状态检查持久化、审计和指标。

## Review and Execution Results

- Review Needed 必须包含具体触发原因和推荐动作。
- StatusCheckResult 持久化失败不能被静默忽略，必须阻断状态推进。
