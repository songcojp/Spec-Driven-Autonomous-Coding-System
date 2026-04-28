# Design: FEAT-008 Codex Runner

## Design Summary

Codex Runner 是执行层入口。它读取 Agent Run Contract 和 Runner Policy，在指定 worktree 中调用 Codex CLI，采集事件、日志、心跳和结构化输出，并把结果交给 Evidence Store 和 Status Checker。

## Components

| Component | Responsibility |
|---|---|
| Runner Queue Worker | 从持久队列领取可执行 Run。 |
| Runner Policy Resolver | 根据风险和任务类型解析 sandbox、approval、model、profile、schema 和 workspace root。 |
| Codex CLI Adapter | 启动 Codex CLI，处理 JSON event stream 和 session resume。 |
| Runner Heartbeat | 每 10 至 30 秒记录在线状态和当前任务。 |
| Raw Log Collector | 采集输出并执行敏感信息脱敏。 |
| Safety Gate Adapter | 在高风险文件、危险命令或权限提升时阻止或路由 Review。 |

## Data Ownership

- Owns: RunnerPolicy、RunnerHeartbeat、CodexSessionRecord、RawExecutionLog。
- Reads: AgentRunContract、WorktreeRecord、Safety Rules、Task 风险。
- Emits: Evidence Pack 输入、Status Check 请求、Review Needed 触发。

## State and Flow

1. Feature Scheduler 将任务放入 Runner Queue。
2. Runner Policy Resolver 生成执行配置。
3. Safety Gate 检查是否允许执行。
4. Codex CLI Adapter 在 workspace root 中运行。
5. Heartbeat 周期更新。
6. Raw Log Collector 归档脱敏日志和 JSON 事件。
7. 执行结果进入 Evidence Store 和 Status Checker。

## Dependencies

- FEAT-005 提供 Agent Run Contract。
- FEAT-007 提供 workspace root。
- FEAT-009 接收执行结果并生成状态判断。
- FEAT-011 处理高风险审批。

## Review and Evidence

- 高权限、危险命令和 forbidden files 必须触发 Review Needed。
- 原始日志需要脱敏 token、password、secret、key 和 connection string。
