# Design: FEAT-008 Codex Runner

## Design Summary

Codex Runner 是执行层入口。它由 BullMQ `cli.run` Worker 触发，读取 Run、Task、WorktreeRecord、Runner Policy 和 active CLI Adapter JSON 配置，在指定 workspace root 中调用 Codex CLI，采集事件、日志、心跳和结构化输出，并把结果交给 Evidence Store 和 Status Checker。Codex CLI 是 MVP 默认 adapter；命令模板、参数映射、输出解析和 session resume 规则由 adapter 配置承载。

## Components

| Component | Responsibility |
|---|---|
| BullMQ CLI Runner Worker | 从 `specdrive:cli-runner` 领取 `cli.run` job，执行 Run 并回写状态。 |
| Runner Policy Resolver | 根据风险和任务类型解析 sandbox、approval、model、profile、schema 和 workspace root。 |
| CLI Adapter Registry | 读取、校验和启用 CLI Adapter JSON 配置，保留上一份可用 active 配置。 |
| Codex CLI Adapter | 根据 `codex-cli` 配置启动 Codex CLI，处理 JSON event stream、Evidence 映射和 session resume。 |
| Runner Heartbeat | 每 10 至 30 秒记录在线状态和当前任务。 |
| Raw Log Collector | 采集输出并执行敏感信息脱敏。 |
| Safety Gate Adapter | 在高风险文件、危险命令或权限提升时阻止或路由 Review。 |

## Data Ownership

- Owns: RunnerPolicy、CliAdapterConfig、RunnerHeartbeat、CodexSessionRecord、RawExecutionLog。
- Reads: SchedulerJobRecord、Run、WorktreeRecord、Runner policy、Safety Rules、Task 风险。
- Emits: Evidence Pack 输入、Status Check 请求、Review Needed 触发。

## State and Flow

1. Feature Scheduler 为已排期任务创建 Run 并 enqueue `cli.run` job。
2. Runner Policy Resolver 生成执行配置。
3. CLI Adapter Registry 读取 active adapter 配置并合并 Runner Policy 约束。
4. Safety Gate 检查是否允许执行。
5. Codex CLI Adapter 在 workspace root 中运行。
6. Heartbeat 周期更新。
7. Raw Log Collector 归档脱敏日志和 JSON 事件。
8. Worker 持久化 session/log/evidence/status check，并按结果回写 Run 与 Task 状态。

## CLI Adapter JSON Config

Adapter 配置使用 JSON 持久化，并由 JSON Schema 校验。最小字段包括 `id`、`display_name`、`schema_version`、`executable`、`argument_template`、`config_schema`、`form_schema`、`defaults`、`environment_allowlist`、`output_mapping` 和 `status`。配置状态为 `draft|active|disabled|invalid`。

保存或启用配置前必须执行 dry-run，检查命令模板变量、必填字段、安全策略、workspace root 和 Evidence 输出映射。dry-run 失败时不得覆盖 active 配置；新 Run 必须继续使用上一份 active 配置或进入 blocked。

## Dependencies

- FEAT-007 提供 workspace root。
- FEAT-009 接收执行结果并生成状态判断。
- FEAT-011 处理高风险审批。
- FEAT-013 提供 Product Console 系统设置中的 JSON / JSON Schema 表单配置管理 UI，并在 Runner Console 展示配置健康摘要。

## Review and Evidence

- 高权限、危险命令和 forbidden files 必须触发 Review Needed。
- CLI Adapter 配置保存、dry-run、启用、禁用和失败必须写审计。
- 原始日志需要脱敏 token、password、secret、key 和 connection string。
- `cli.run` job 的 queue、job id、attempts、payload、status 和 error 必须在 `scheduler_job_records` 中可审计。
