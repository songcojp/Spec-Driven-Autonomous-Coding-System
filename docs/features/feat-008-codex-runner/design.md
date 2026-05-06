# Design: FEAT-008 CLI Adapter

## Design Summary

CLI Adapter 是 Execution Adapter Layer 的本机进程 provider。它由 BullMQ `cli.run` Worker 触发，读取 Scheduler Job、Execution Record、payload context、当前项目 workspace、Execution Policy 和 active CLI Adapter JSON 配置，在目标项目 workspace root 中调用编码 CLI，采集事件、日志、心跳和结构化输出，并把结果写入 Execution Record、raw logs 和 Status Checker。Codex CLI 是默认 adapter preset；Google Gemini CLI 作为内置可选 adapter preset；命令模板、参数映射、输出解析和 session resume 规则由 adapter 配置承载。后续 `rpc.run` 由 RPC Adapter 承载，不复用 CLI Adapter。

CLI Adapter 不接收 Product Console 的直接 CLI 执行请求。Console、Spec Workspace 或 Task Board 的执行类动作必须先成为受控命令，经 Control Plane 校验、审计、Scheduler Job 和 Execution Record 后，才由 Execution Adapter Worker 通过 active CLI Adapter 执行。

本 Feature 是旧 `CLI Runner` 设计的迁移来源。新设计不得继续新增 Runner 概念；历史 `RunnerPolicy`、`RunnerHeartbeat`、`CliSessionRecord` 可在实现迁移期保留兼容名称，但对外接口统一收敛到 `ExecutionPolicy`、`ExecutionHeartbeat`、`ExecutionSessionRecord` 和 `ExecutionAdapter*V1`。

## Components

| Component | Responsibility |
|---|---|
| BullMQ CLI Adapter Worker | 从 Execution Adapter queue 领取 `cli.run` job，执行 Execution Record 并回写状态。 |
| Execution Policy Resolver | 根据风险和任务类型解析 sandbox、approval、model、profile、schema 和 workspace root。 |
| CLI Adapter Registry | 读取、校验和启用 CLI Adapter JSON 配置，保留上一份可用 active 配置。 |
| CLI Adapter Runtime | 根据 active adapter 配置启动 Codex CLI、Google Gemini CLI 或后续等价编码 CLI，处理 JSON/JSONL event stream、SkillOutputContractV1 和 session resume。 |
| Skill Invocation Prompt Builder | 将 Spec/UI 受控命令转换为 CLI skill invocation contract，并要求编码 CLI 在项目 workspace 内读取 `.agents/skills/*/SKILL.md`。 |
| Execution Heartbeat | 每 10 至 30 秒记录在线状态和当前任务。 |
| Raw Log Collector | 采集输出并执行敏感信息脱敏。 |
| Safety Gate Adapter | 在高风险文件、危险命令或权限提升时阻止或路由 Review。 |
| Execution Adapter Projection | 将 CLI events / stdout / stderr / SkillOutputContractV1 投影为 `ExecutionAdapterEventV1` 和 `ExecutionAdapterResultV1`。 |

## Data Ownership

- Owns: ExecutionPolicy、CliAdapterConfig、ExecutionHeartbeat、ExecutionSessionRecord、RawExecutionLog。
- Reads: SchedulerJobRecord、ExecutionRecord、WorktreeRecord、Execution Policy、Safety Rules、payload context 风险。
- Emits: Execution Record 更新、Status Check 请求、Review Needed 触发。

## State and Flow

1. Scheduler Trigger 创建 Execution Record 并 enqueue `cli.run` job；payload `operation` 区分 `feature_execution`、`generate_ears`、`generate_hld`、`generate_ui_spec`、`split_feature_specs` 等操作。Feature 级 `feature_execution` 直接以当前项目 workspace 中完整 Feature Spec 目录作为执行输入，不依赖 `task_graph_tasks` / `tasks` 表。
2. Execution Policy Resolver 从当前项目 repository `local_path` / `target_repo_path` 解析 workspace root 并生成执行配置。
3. CLI Adapter Registry 读取 active adapter 配置并合并 Execution Policy 约束。
4. Skill Invocation Prompt Builder 根据 payload context 生成 `SkillInvocationContractV1`，其中 expected artifacts 为 `{ path, kind, required }` 对象，constraints 记录 allowed files、risk、sandbox 和 approval policy；开发阶段默认 sandbox 为 `danger-full-access`，approval policy 为 `never`。Feature 级 `feat-implement-skill` 的 sourcePaths 必须包含 Feature Spec `requirements.md`、`design.md`、`tasks.md`，并在 prompt 中要求执行 `tasks.md` 的具体实现任务。
5. Execution Adapter Worker 构建 `ExecutionAdapterInvocationV1`，并把 Skill contract 作为 invocation payload 的内容协议字段携带。
6. Safety Gate 检查是否允许执行。
7. CLI Adapter Runtime 在目标项目 workspace root 中运行 active 编码 CLI。
8. Heartbeat 周期更新。
9. Raw Log Collector 归档脱敏日志和 JSON 事件。
10. Worker 校验 `SkillOutputContractV1`，再投影 `ExecutionAdapterResultV1`、持久化 session/log/status check，并按结果回写 Execution Record 与相关 context 状态。

workspace root 不得回退到 SpecDrive Control Plane 进程 cwd。路径缺失、不可读、不是可用 workspace，或缺少执行所需 `.agents/skills/*` / `AGENTS.md` 时，CLI Adapter 必须 blocked 并把原因写入 Execution Record summary 和 Execution Console。

Execution Adapter 侧代码负责 workspace 校验、policy 合并、adapter dry-run、危险命令和 forbidden files 检查、心跳、日志、session 和状态回写；CLI skill prompt 只负责执行或推理内容，不负责维护状态机、审计、重试和项目隔离不变式。

## Unified Adapter Interfaces

CLI Adapter 必须接受 HLD 7.8 定义的 `ExecutionAdapterInvocationV1`，并输出 `ExecutionAdapterEventV1` / `ExecutionAdapterResultV1`。CLI 专属字段放入 config 或 result 的 provider details 中：

- config: `executable`、`argumentTemplate`、`resumeArgumentTemplate`、`environmentAllowlist`、`outputMapping`。
- invocation: `workspaceRoot`、`operation`、`sourcePaths`、`expectedArtifacts`、`constraints`、`outputSchema`。
- provider session: `command`、`args`、`cwd`、`sessionId`、`exitCode`、`startedAt`、`completedAt`。
- result: `status`、`summary`、`skillOutput`、`producedArtifacts`、`traceability`、`nextAction`、`rawLogRefs`、`error`。
- run report: 每个 run 在 `.autobuild/runs/<executionId>/report.json` 保留一份合并报告，内容包括 exit/session、SkillOutputContractV1、contract validation、produced artifacts、usage、log refs 和 error。

## Skill Contracts

`SkillInvocationContractV1` 是 Execution Adapter 传给 CLI Skill 的唯一输入协议，包含 `contractVersion`、`executionId`、`projectId`、`workspaceRoot`、`operation`、`skillSlug`、`requestedAction`、`sourcePaths`、`imagePaths`、`expectedArtifacts`、`traceability` 和 `constraints`。

`SkillOutputContractV1` 是 CLI Skill 的唯一结构化输出协议，包含 `contractVersion`、`executionId`、`skillSlug`、`requestedAction`、`status`、`summary`、`nextAction`、`producedArtifacts`、`traceability` 和 `result`。Execution Adapter 必须校验输出协议与输入协议匹配；协议缺失、JSON 无效、execution/skill/action/traceability 不匹配或必需 artifact 缺失时，Execution Record 进入 `review_needed`。`result` 是灵活对象，允许 Skill 写入专用执行详情；调用端不维护按 Skill 分支的专用 result schema。

对于无 `taskId` 的 Feature 级 `feature_execution`，`feat-implement-skill` 必须把 Feature Spec 目录作为实现范围：先读取 `requirements.md`、`design.md`、`tasks.md`，再修改代码、测试、配置或必要文档。仅创建报告 JSON、仅复述计划、或把 `tasks.md` 标记为完成而没有实际产物，都不得视为成功输出。

## CLI Adapter JSON Config

Adapter 配置使用 JSON 持久化，并由 JSON Schema 校验。最小字段包括 `id`、`display_name`、`schema_version`、`executable`、`argument_template`、`config_schema`、`form_schema`、`defaults`、`environment_allowlist`、`output_mapping` 和 `status`。配置状态为 `draft|active|disabled|invalid`。

保存或启用配置前必须执行 dry-run，检查命令模板变量、必填字段、安全策略、workspace root 和 output schema 映射。dry-run 失败时不得覆盖 active 配置；新 Execution Record 必须继续使用上一份 active 配置或进入 blocked。

内置 adapter preset 包括 `codex-cli` 和 `gemini-cli`。Gemini CLI 使用 headless `--output-format stream-json`、`--skip-trust`、`--approval-mode` 和 `-p` 输出 JSONL 事件；由于 Gemini CLI 不提供 Codex 风格自定义 `--output-schema` 参数，CLI Adapter 通过 prompt 约束 SkillOutputContractV1，并在执行后从 `init`、`message`、`tool_use`、`tool_result`、`error`、`result` 事件提取 session、token usage、assistant text 和 SkillOutputContractV1。`gemini-acp` 属于 RPC Adapter provider，不进入 CLI Adapter 配置。

## Dependencies

- FEAT-007 提供 workspace root。
- FEAT-004 通过 `<executor>.run` job 提供统一执行入口；Feature 执行统一使用 `operation = "feature_execution"`，并由 Feature Spec 目录而非平台 task 表驱动。
- FEAT-009 接收执行结果并生成状态判断。
- FEAT-011 处理高风险审批。
- FEAT-013 提供 Product Console 系统设置中的 JSON / JSON Schema 表单配置管理 UI，并在 Execution Console 展示配置健康摘要。

## Review and Observability

- 高权限、危险命令和 forbidden files 必须触发 Review Needed。
- CLI Adapter 配置保存、dry-run、启用、禁用和失败必须写审计。
- 原始日志需要脱敏 token、password、secret、key 和 connection string。
- `cli.run` job 的 queue、job id、attempts、payload、status 和 error 必须在 `scheduler_job_records` 中可审计。
- Skill invocation prompt 必须在 Execution Record metadata 中追踪输入 contract、输出 contract、contract validation、`workspaceRoot`、`skillSlug`、`sourcePaths`、`expectedArtifacts` 和 `traceability`。
