# Feature Spec: FEAT-005 Subagent Runtime and Context Broker

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 4.3 节；第 6.4 节 FR-030 至 FR-033；第 8.4 节 |
| Requirements | REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-055, NFR-011 |
| HLD | 7.5 Subagent Runtime and Context Broker, 10.3 Autonomous Execution Loop, 13 Deployment and Runtime Topology |

## Scope

- 按职责创建 Spec、Clarification、Repo Probe、Architecture、Task、Coding、Test、Review、Recovery 或 State Agent 类型。
- 为每次 Run 生成 Agent Run Contract，声明 run_id、agent_type、task_id、目标、允许文件、只读文件、禁止动作、验收标准和输出 schema。
- 通过 Context Broker 只提供当前任务所需的 Spec、Memory 和文件片段。
- 将写入型任务路由到 Workspace Manager 分配隔离 worktree。
- 合并 Subagent Run 结果，去重、检测冲突、合并风险、评估可信度、生成下一步动作并更新看板状态。
- 为 Subagent Console 提供 Run Contract、上下文切片、Evidence、token 使用和运行状态。

## Non-Scope

- 不直接执行 Codex CLI；执行归属 FEAT-008。
- 不创建 worktree；隔离实现归属 FEAT-007。
- 不实现 Console UI；展示归属 FEAT-013。

## User Value

开发者可以确认每个 Subagent 只拿到完成任务所需的最小上下文，并且每次执行边界都能被审计和复现。

## Requirements

- 每个 Run 都必须有明确 agent_type，并与任务责任匹配。
- Subagent 的执行边界必须能从 Agent Run Contract 中被审计。
- Subagent 不得默认继承完整主上下文。
- 任意并行写入都必须能追踪到独立 worktree、分支、任务标识和合并目标。
- 只读 Subagent 并发不得写入共享工作区。

## Acceptance Criteria

- [ ] Agent Run Contract 可完整描述执行边界。
- [ ] Context Broker 输出的上下文切片可追踪到 Spec Slice、Memory 摘要和允许文件。
- [ ] 写入型 Subagent Run 创建前必须完成 workspace 分配。
- [ ] Subagent Console 可以定位每个 Subagent 的输入、输出和当前状态。

## Risks and Open Questions

- Context Slice 过窄会导致任务失败，过宽会造成污染，需要在 Status Checker 中持续反馈。
- Subagent 类型是否允许项目扩展需要与 Skill System 的版本治理保持一致。
