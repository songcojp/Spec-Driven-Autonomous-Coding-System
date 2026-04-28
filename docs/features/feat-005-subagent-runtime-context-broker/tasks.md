# Tasks: FEAT-005 Subagent Runtime and Context Broker

- [x] TASK-001: 定义 Run、AgentRunContract、ContextSliceRef 和 SubagentEvent 数据模型。
- [x] TASK-002: 实现 agent_type 选择逻辑，覆盖 Spec、Clarification、Repo Probe、Architecture、Task、Coding、Test、Review、Recovery 和 State。
- [x] TASK-003: 实现 Agent Run Contract Builder，冻结目标、文件边界、禁止动作、验收和输出 schema。
- [x] TASK-004: 实现 Context Broker，组合 Spec Slice、Project Memory 摘要、文件片段和相关 Evidence。
- [x] TASK-005: 实现写入型任务到 Workspace Manager 的分配前置检查。
- [x] TASK-006: 实现 Result Merger 的结果去重、冲突标记、风险合并和下一步动作输出。
- [x] TASK-007: 添加只读 Subagent 并发测试，确认不会写共享工作区。
- [x] TASK-008: 添加 Contract 越界测试，确认未授权文件访问或 diff 会进入 Review Needed。
