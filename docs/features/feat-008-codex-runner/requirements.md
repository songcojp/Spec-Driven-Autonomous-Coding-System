# Feature Spec: FEAT-008 Codex Runner

## Source Mapping

| Source | IDs / Sections |
|---|---|
| PRD | 第 6.9 节 FR-070 至 FR-072；第 8.6 节；第 9.1 节 |
| Requirements | REQ-037, REQ-038, REQ-039, REQ-056, REQ-065, REQ-066, REQ-068, NFR-001, NFR-010 |
| HLD | 7.8 Codex Runner, 9 External Integrations, 11 Security, Privacy, and Governance |

## Scope

- 通过 Runner CLI Adapter 调用 Codex CLI 执行代码修改、测试或修复，默认 adapter 为 `codex-cli`。
- 通过 BullMQ `cli.run` job 调度 Runner Worker；Console 运行动作不得直接执行 CLI，后续 `native.run` 由独立 native executor 承载。
- Runner 只消费已审计的 scheduler job / Execution Record / invocation contract，不提供给 Product Console 直接执行 shell 或 CLI 的接口。
- Codex CLI 必须在目标项目 workspace 中启动，workspace root 来自当前项目 repository `local_path` 或 `target_repo_path`。
- 通过 JSON + JSON Schema 管理 CLI Adapter 配置，隔离 executable、argument template、输出映射和 session resume 逻辑。
- 支持 CLI skill invocation contract，将 Spec/UI 操作转换为 Codex workspace 内部 Skill prompt。
- Feature 级 `feature_execution` 通过 `codex-coding-skill` 直接读取 Feature Spec 目录执行；Runner 不要求 `task_graph_tasks` / `tasks` 表存在。
- 根据开发阶段策略和任务上下文设置 sandbox mode、approval policy、model、profile、output schema、JSON event stream、workspace root 和 session resume。
- 开发阶段默认使用 `danger-full-access` 和 `approval=never`，不触发 Codex CLI 人工确认。
- 默认不得使用 bypass approvals；敏感文件、危险命令和 forbidden files 仍由 Safety Gate 阻断。
- 捕获命令输出、JSON event stream、Codex session、原始日志和 Runner 心跳。
- 为 Runner Console 提供在线状态、Codex 版本、sandbox、approval policy、queue、最近日志和心跳状态。

## Non-Scope

- 不决定任务是否完成；状态判断归属 FEAT-009。
- 不创建 worktree；workspace 归属 FEAT-007。
- 不展示 UI；Runner Console 归属 FEAT-013。

## User Value

系统可以用受安全策略约束的方式调用 Codex CLI，让自动编码、测试和修复具备可审计输出、可恢复 session 和可观察心跳。

## Requirements

- Runner CLI Adapter 必须产出结构化 SkillOutputContractV1 或原始执行结果，供 Execution Record、raw logs 和 Status Checker 消费。
- Runner Worker 必须读取已排期 Execution Record、active CLI Adapter、workspace root 和状态检查配置后执行。
- Runner 不得在调度器、状态机或任务图中硬编码 Codex 命令细节。
- Runner 不得绕过受控命令和 Scheduler 直接响应 UI 写操作；所有执行类入口必须有 Execution Record、job、audit 和 raw log 追踪。
- Runner 必须在启动前校验 workspace root；项目路径缺失、不可读或缺少必要 `.agents/skills` / `AGENTS.md` 时进入 blocked。
- `feature_execution` 的 `SkillInvocationContractV1` 必须包含 Feature Spec `requirements.md`、`design.md` 和 `tasks.md` 作为 `sourcePaths`；缺失完整 Feature Spec 目录时，新执行必须 blocked。
- Feature 级 `codex-coding-skill` 不得只生成报告 JSON 或总结计划来满足执行；输出 contract 的 `producedArtifacts` 必须列出实际创建或更新的代码、测试、配置或文档文件。
- CLI skill invocation contract 必须使用 `SkillInvocationContractV1`，包含 `contractVersion`、`executionId`、`projectId`、`workspaceRoot`、`operation`、`skillSlug`、`sourcePaths`、`expectedArtifacts`、`traceability`、`constraints` 和 `requestedAction`。
- CLI skill invocation contract 必须携带当前 `specState`，供 Skill 明确读取 Feature 文件状态而不是查询数据库。
- CLI skill output contract 必须使用 `SkillOutputContractV1`，包含 `contractVersion`、`executionId`、`skillSlug`、`requestedAction`、`status`、`summary`、`nextAction`、`producedArtifacts` 和 `traceability`，并允许技能在 `result` 中写入扩展结果。
- Runner 校验有效输出后必须把状态、结果摘要、产物和下一步动作投影回 `docs/features/<feature-id>/spec-state.json`。
- Runner 必须校验输出 contract 与输入 contract 的 execution、skill、action 和 traceability 是否一致；输出缺失、JSON 不合法、字段不匹配或必需 artifact 缺失时，Execution Record 必须进入 `review_needed` 并保留原因。
- Runner 必须以 `execution_records` 作为执行状态主表；不得为 `cli.run` 创建或更新旧 `runs` 记录。
- CLI Adapter 配置必须以 JSON 为唯一事实源，并支持 dry-run 校验。
- 开发阶段高风险任务默认以 `danger-full-access` 和 `approval=never` 执行；敏感文件、危险命令和 forbidden files 仍必须触发安全规则。
- 认证、权限、支付、迁移、密钥和 forbidden files 修改必须触发安全规则。
- Runner 在线时必须每 10 至 30 秒更新心跳。

## Acceptance Criteria

- [ ] `codex-cli` adapter 可以在指定 workspace root 中启动 Codex CLI。
- [ ] `codex-cli` adapter 在 mock runner 中收到的 cwd 等于目标项目 workspace root。
- [ ] Feature 级 `schedule_run` 可以在完整 Feature Spec 目录存在时产生 `cli.run` scheduler job，Worker 执行后持久化 session/log/status check 并回写 Execution Record 状态。
- [ ] `run_board_tasks` 作为兼容入口仍可产生 `cli.run` scheduler job，但编码执行不依赖 Task Board 或旧 task 表。
- [ ] Spec/UI 操作可以生成 `SkillInvocationContractV1` prompt，并在 Execution Record metadata 中追踪 workspace、skill phase、expected artifacts 和输出 contract 校验结果。
- [ ] 有效 `SkillOutputContractV1` 会写入 Execution Record metadata；无效输出会进入 `review_needed` 而不是被当成成功。
- [ ] Feature 级 coding prompt 明确要求读取 Feature Spec 三件套并执行 `tasks.md`，不能将 report-only completion 当成成功。
- [ ] Runner Policy 能根据开发阶段策略解析 sandbox、approval、model、profile 和输出 schema。
- [ ] CLI Adapter JSON 配置可以校验、保存草稿、启用，并在无效时阻塞新 Execution Record。
- [ ] workspace root 缺失、不可读或缺少所需 Skill 文件时，新 Execution Record blocked 且给出可观察原因。
- [ ] 默认 Runner 配置使用 `danger-full-access` 和 `approval=never`。
- [ ] Runner Console 可以展示最近心跳时间和当前安全配置。

## Risks and Open Questions

- Codex CLI 输出格式、命令参数和 session resume 能力需要通过适配层隔离。
- 危险命令和 forbidden files 规则需要与 Review Center 保持一致。
