# Design: FEAT-005 Subagent Runtime and Context Broker

## Design Summary

Subagent Runtime 将任务转换为受边界约束的 Agent Run。Context Broker 根据 Agent Run Contract 裁剪上下文，Result Merger 将执行结果合并为状态机可消费的下一步动作。

## Components

| Component | Responsibility |
|---|---|
| Subagent Run Factory | 根据任务和 Skill 选择 agent_type 并创建 Run。 |
| Agent Run Contract Builder | 冻结目标、允许文件、只读文件、禁止动作、验收标准和输出 schema。 |
| Context Broker | 构造最小 Spec、Memory、文件和 Evidence 上下文切片。 |
| Result Merger | 去重、冲突检测、风险合并、可信度评估和下一步动作生成。 |
| Subagent Event Recorder | 记录 Run 生命周期、token 使用、状态和事件。 |

## Data Ownership

- Owns: Run、AgentRunContract、ContextSliceRef、SubagentEvent。
- Reads: TaskGraph、SpecSlice、ProjectMemory 摘要、WorkspaceRecord、Skill schema。
- Emits: Evidence Pack、StateTransition 输入和 Console 查询模型。

## State and Flow

1. Feature Scheduler 选择任务。
2. Subagent Run Factory 选择 agent_type。
3. Contract Builder 冻结 Run 边界。
4. Context Broker 裁剪上下文。
5. 写任务请求 Workspace Manager 分配 worktree。
6. Codex Runner 或只读 Subagent 执行。
7. Result Merger 生成下一步动作并更新看板输入。

## Dependencies

- FEAT-002 提供 Spec Slice。
- FEAT-006 提供 Project Memory 投影。
- FEAT-007 提供写任务 worktree。
- FEAT-008 执行 Codex Run。
- FEAT-009 接收 Evidence 并判断状态。

## Review and Evidence

- Agent Run Contract 启动后不应原地修改。
- Contract 与实际 diff 或文件访问不一致时，Status Checker 必须阻止 Done。
