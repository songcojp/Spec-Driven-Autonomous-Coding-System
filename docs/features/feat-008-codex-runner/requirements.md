# Feature Spec: FEAT-008 CLI Adapter

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 6.9 节 FR-070 至 FR-072；第 8.6 节；第 9.1 节 |
| Requirements | REQ-037, REQ-038, REQ-039, REQ-056, REQ-065, REQ-066, REQ-068, NFR-001, NFR-010 |
| HLD | 7.8 Execution Adapter Layer, 9 External Integrations, 11 Security, Privacy, and Governance |

## Scope

- 通过 CLI Adapter 调用 Codex CLI、Google Gemini CLI 或后续等价编码 CLI 执行代码修改、测试或修复，默认 adapter 为 `codex-cli`，内置可选 adapter 为 `gemini-cli`。
- 通过 BullMQ `cli.run` job 调度 Execution Adapter Worker；Console 运行动作不得直接执行 CLI，后续远程/app-server 执行由 `rpc.run` 和 RPC Adapter 承载。
- CLI Adapter 只消费已审计的 scheduler job / Execution Record / invocation contract，不提供给 Product Console 直接执行 shell 或 CLI 的接口。
- 编码 CLI 必须在目标项目 workspace 中启动，workspace root 来自当前项目 repository `local_path` 或 `target_repo_path`。
- 通过 JSON + JSON Schema 管理 CLI Adapter 配置，隔离 executable、argument template、输出映射和 session resume 逻辑，并符合 HLD 7.8 的 `ExecutionAdapterConfigV1`。
- 支持 CLI skill invocation contract，将 Spec/UI 操作转换为项目 workspace 内部 Skill prompt。
- Feature 级 `feature_execution` 通过 `feat-implement-skill` 直接读取 Feature Spec 目录执行；CLI Adapter 不要求 `task_graph_tasks` / `tasks` 表存在。
- 根据开发阶段策略和任务上下文设置 sandbox mode、approval policy、model、profile、output schema、JSON event stream、workspace root 和 session resume。
- 开发阶段默认使用 `danger-full-access` 和 `approval=never`，不触发编码 CLI 人工确认。
- 默认不得使用 bypass approvals；敏感文件、危险命令和 forbidden files 仍由 Safety Gate 阻断。
- 捕获命令输出、JSON/JSONL event stream、CLI session、原始日志和 Execution Adapter 心跳。
- 为 Execution Console 提供在线状态、active CLI adapter、当前模型、sandbox、approval policy、queue、最近日志和心跳状态。

## Non-Scope

- 不决定任务是否完成；状态判断归属 FEAT-009。
- 不创建 worktree；workspace 归属 FEAT-007。
- 不展示 UI；Execution Console 归属 FEAT-013。

## User Value

系统可以用受安全策略约束的方式调用 Codex CLI 或 Google Gemini CLI 等编码 CLI，让自动编码、测试和修复具备可审计输出、可恢复 session 和可观察心跳。

## Requirements

- CLI Adapter 必须产出结构化 SkillOutputContractV1 或原始执行结果，并投影为 `ExecutionAdapterResultV1`，供 Execution Record、raw logs 和 Status Checker 消费。
- Execution Adapter Worker 必须读取已排期 Execution Record、active CLI Adapter、workspace root 和状态检查配置后执行。
- CLI Adapter 不得在调度器、状态机或任务图中硬编码 Codex、Gemini 或其他编码 CLI 命令细节。
- CLI Adapter 不得绕过受控命令和 Scheduler 直接响应 UI 写操作；所有执行类入口必须有 Execution Record、job、audit 和 raw log 追踪。
- CLI Adapter 必须在启动前校验 workspace root；项目路径缺失、不可读或缺少必要 `.agents/skills` / `AGENTS.md` 时进入 blocked。
- `feature_execution` 的 `ExecutionAdapterInvocationV1.skillInstruction` 必须包含 Feature Spec `requirements.md`、`design.md` 和 `tasks.md` 作为 `sourcePaths`；缺失完整 Feature Spec 目录时，新执行必须 blocked。
- Feature 级 `feat-implement-skill` 不得只生成报告 JSON 或总结计划来满足执行；输出 contract 的 `producedArtifacts` 必须列出实际创建或更新的代码、测试、配置或文档文件。
- CLI Adapter 必须使用 `ExecutionAdapterInvocationV1` 作为唯一输入协议，并通过内嵌 `skillInstruction` 携带 `skillSlug`、`requestedAction`、`sourcePaths`、`expectedArtifacts`、`imagePaths` 和可选 `operatorInput`。
- `ExecutionAdapterInvocationV1` 必须携带当前 `specState`，供 Skill 明确读取 Feature 文件状态而不是查询数据库。
- CLI provider prompt 只说明本次要执行的 Feature 级任务、workspace 路径和输出要求，不得内联源文件内容或序列化完整 invocation。
- CLI skill output contract 必须使用 `SkillOutputContractV1`，包含 `contractVersion`、`executionId`、`skillSlug`、`requestedAction`、`status`、`summary`、`nextAction`、`producedArtifacts`、Feature 级 `traceability` 和 `result`；`status` 必须覆盖 `queued`、`running`、`waiting_input`、`approval_needed`、`review_needed`、`blocked`、`failed`、`cancelled` 和 `completed`，其中 `review_needed` 只表示真实人工或风险审查门。
- Execution Adapter 校验有效输出后必须把状态、结果摘要、产物和下一步动作投影回 `docs/features/<feature-id>/spec-state.json`。
- Execution Adapter 必须校验输出 contract 与输入 contract 的 execution、skill、action 和 Feature 级 traceability 是否一致；输出缺失、JSON 不合法、字段不匹配、必需 artifact 缺失，或进程结束后最后一条 contract 仍为非终态时，Execution Record 必须进入 `review_needed` 并保留原因。
- CLI Adapter 必须以 `execution_records` 作为执行状态主表；不得为 `cli.run` 创建或更新旧 `runs` 记录。
- 每次 Execution Adapter run 必须在 `.autobuild/runs/<executionId>/report.json` 写入一份独立 Run Report，合并 exit/session、SkillOutputContractV1、contract validation、产物、usage 和 log refs；Feature execution 默认 expected artifact 指向该 run report，不再写入共享 `.autobuild/reports/feature-execution.json`。
- CLI Adapter 配置必须以 JSON 为唯一事实源，并支持 dry-run 校验。
- CLI Adapter 必须提供 `codex-cli` 和 `gemini-cli` 内置 adapter preset；Gemini CLI preset 必须通过 headless JSON/JSONL 输出和 SkillOutputContractV1 事后校验接入，不要求 Gemini CLI 支持 Codex 风格自定义 output schema 参数。
- 开发阶段高风险任务默认以 `danger-full-access` 和 `approval=never` 执行；敏感文件、危险命令和 forbidden files 仍必须触发安全规则。
- 认证、权限、支付、迁移、密钥和 forbidden files 修改必须触发安全规则。
- Execution Adapter Worker 在线时必须每 10 至 30 秒更新心跳。

## Migration Notes

- FEAT-008 原名 CLI Runner；自 2026-05-03 起作为 CLI Adapter 迁移来源维护。
- 新设计不再新增 Runner、Codex Runner、Runner Policy、Runner Heartbeat 或 Runner Console 概念；对外规格统一使用 Execution Adapter Layer、Execution Policy、Execution Heartbeat 和 Execution Console。
- `src/cli-adapter.ts`、provider 专用 `src/codex-cli-adapter.ts`、旧数据库表或旧 UI 字段可作为兼容实现逐步迁移，但不得成为新接口命名依据。

## Acceptance Criteria

- [ ] `codex-cli` adapter 可以在指定 workspace root 中启动 Codex CLI。
- [ ] `gemini-cli` adapter 可以通过 active CLI Adapter 配置在指定 workspace root 中启动 Google Gemini CLI。
- [ ] `codex-cli` adapter 在 mock CLI adapter 中收到的 cwd 等于目标项目 workspace root。
- [ ] Feature 级 `schedule_run` 可以在完整 Feature Spec 目录存在时产生 `cli.run` scheduler job，Worker 执行后持久化 session/log/status check 并回写 Execution Record 状态。
- [ ] `run_board_tasks` 作为兼容入口仍可产生 `cli.run` scheduler job，但编码执行不依赖 Task Board 或旧 task 表。
- [ ] Spec/UI 操作可以生成 `ExecutionAdapterInvocationV1.skillInstruction` 驱动的短 prompt，并在 Execution Record metadata 中追踪 workspace、skill phase、expected artifacts 和输出 contract 校验结果。
- [ ] 有效 `SkillOutputContractV1` 会写入 Execution Record metadata；无效输出会进入 `review_needed` 而不是被当成成功。
- [ ] 每次 run 都有独立 `.autobuild/runs/<executionId>/report.json`，Feature execution 调度默认把该 report 作为 expected artifact。
- [ ] `result` 可以包含 Skill 专用字段，CLI/RPC Adapter 不按 `skillSlug` 做专用字段校验。
- [ ] Feature 级 coding prompt 明确要求读取 Feature Spec 三件套并执行 `tasks.md`，不能将 report-only completion 当成成功。
- [ ] Execution Policy 能根据开发阶段策略解析 sandbox、approval、model、profile 和输出 schema。
- [ ] CLI Adapter JSON 配置可以校验、保存草稿、启用，并在无效时阻塞新 Execution Record。
- [ ] workspace root 缺失、不可读或缺少所需 Skill 文件时，新 Execution Record blocked 且给出可观察原因。
- [ ] 默认 Execution Adapter 配置使用 `danger-full-access` 和 `approval=never`。
- [ ] Execution Console 可以展示最近心跳时间和当前安全配置。

## Risks and Open Questions

- Codex/Gemini CLI 输出格式、命令参数和 session resume 能力需要通过适配层隔离。
- 危险命令和 forbidden files 规则需要与 Review Center 保持一致。
