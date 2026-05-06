# Feature Spec Index: SpecDrive AutoBuild

本文依据 `docs/zh-CN/PRD.md`、`docs/zh-CN/requirements.md` 和 `docs/zh-CN/hld.md` 拆分 MVP Feature Spec。`docs/zh-CN/design.md` 已作废，仅作为历史快照保留。拆分原则为垂直可验收、需求可追踪、实现边界清晰，并优先沿 HLD 第 15 节建议的子系统边界落地。

| Feature ID | Feature | Folder | Status | Primary Requirements | Suggested Milestone | Dependencies |
|---|---|---|---|---|---|---|
| FEAT-000 | System Bootstrap | `feat-000-system-bootstrap` | done | REQ-011、REQ-058、NFR-004 | M0 | None |
| FEAT-001 | Project and Repository Foundation | `feat-001-project-repository-foundation` | done | REQ-001 至 REQ-003、REQ-059、REQ-063 | M1 | FEAT-000 |
| FEAT-002 | Spec Protocol Foundation | `feat-002-spec-protocol-foundation` | done | REQ-004 至 REQ-009、REQ-064 | M1 | FEAT-000 |
| FEAT-003 | CLI Skill Directory Discovery | `feat-003-skill-center-schema-governance` | done | REQ-010 至 REQ-013 | M1 | FEAT-000 |
| FEAT-004 | Orchestration and State Machine | `feat-004-orchestration-state-machine` | done | REQ-024 至 REQ-034、REQ-060、REQ-068 | M2 | FEAT-001、FEAT-002、FEAT-014 |
| FEAT-005 | CLI Subagent Audit Integration | `feat-005-subagent-runtime-context-broker` | done | REQ-014 至 REQ-018、REQ-055 | M3 | FEAT-004、FEAT-007 |
| FEAT-006 | Project Memory and Recovery Projection | `feat-006-project-memory-recovery-projection` | done | REQ-019 至 REQ-023、REQ-036 | M3 | FEAT-004 |
| FEAT-007 | Workspace Isolation | `feat-007-workspace-isolation` | done | REQ-017、REQ-032、REQ-035 | M3/M4 | FEAT-004 |
| FEAT-008 | CLI Adapter | `feat-008-codex-runner` | done / needs-terminology-migration | REQ-037 至 REQ-039、REQ-056、REQ-065、REQ-066、REQ-068 | M4 | FEAT-007 |
| FEAT-009 | Status Checker | `feat-009-status-checker-execution results` | done | REQ-040 至 REQ-042、REQ-051 | M5 | FEAT-004、FEAT-008 |
| FEAT-010 | Failure Recovery | `feat-010-failure-recovery` | done | REQ-043 至 REQ-045 | M5 | FEAT-008、FEAT-009 |
| FEAT-011 | Review Center | `feat-011-review-center` | done | REQ-046、REQ-047、REQ-057 | M6 | FEAT-004、FEAT-009 |
| FEAT-012 | Delivery and Spec Evolution | `feat-012-delivery-spec-evolution` | done | REQ-048 至 REQ-050 | M6 | FEAT-009、FEAT-011 |
| FEAT-013 | Product Console | `feat-013-product-console` | in-progress | REQ-052 至 REQ-056、REQ-061 至 REQ-064、REQ-066 至 REQ-068 | M2-M7 | FEAT-001、FEAT-004、FEAT-008 |
| FEAT-014 | Persistence and Auditability | `feat-014-persistence-auditability` | done | REQ-058、NFR-003 至 NFR-012 | Cross-cutting | FEAT-000 |
| FEAT-015 | Chat Interface | `feat-015-chat-interface` | in-progress | REQ-069 至 REQ-073 | M7 | FEAT-013、FEAT-004、FEAT-014 |
| FEAT-016 | SpecDrive IDE Foundation | `feat-016-specdrive-ide-foundation` | done | REQ-074、REQ-075 | M8 | FEAT-001、FEAT-002、FEAT-004、FEAT-014 |
| FEAT-017 | IDE Spec Interaction | `feat-017-ide-spec-interaction` | todo | REQ-076 至 REQ-078 | M8 | FEAT-016、FEAT-002、FEAT-012 |
| FEAT-018 | RPC Adapter: Codex RPC Provider | `feat-018-codex-rpc-adapter` | done / needs-terminology-migration | REQ-080、REQ-081 | M8 | FEAT-004、FEAT-008、FEAT-014 |
| FEAT-019 | IDE Execution Loop | `feat-019-ide-execution-loop` | done / execution-preference-followup | REQ-079、REQ-081、REQ-082、REQ-086 | M8 | FEAT-016、FEAT-018、FEAT-004、FEAT-008、FEAT-014 |
| FEAT-020 | IDE Diagnostics and UX Refinement | `feat-020-ide-diagnostics-ux` | done | REQ-083 | M8 | FEAT-016、FEAT-017、FEAT-019 |
| FEAT-021 | IDE Workbench Webviews | `feat-021-ide-execution-webview` | done / execution-preference-followup | REQ-084、REQ-086 | M8 | FEAT-016、FEAT-019、FEAT-020 |
| FEAT-022 | IDE System Settings Webview | `feat-022-ide-system-settings-webview` | done / execution-preference-followup | REQ-085、REQ-086 | M8 | FEAT-016、FEAT-018、FEAT-021 |

FEAT-013 当前补充 Execution Adapter / Scheduler UI refinement：任务调度中心已改为执行队列视图，主列表展示 `scheduler_job_records` 中的 `cli.run` / 后续 `rpc.run` Job，并下钻到 Execution Record、payload context、执行结果 和日志。旧 `feature.select -> feature.plan -> cli.run` 流水线卡片已废弃；Feature 级编码执行由 `feat-implement-skill` 直接读取 Feature Spec 目录中的 `requirements.md`、`design.md`、`tasks.md`，不再依赖平台 `task_graph_tasks` / `tasks` 表。

2026-05-02 update：Spec / Feature 流程状态已文件化。`docs/features/feature-pool-queue.json` 是 Scheduler 读取的全局队列，`docs/features/<feature-folder>/spec-state.json` 是单 Feature 的机器可读状态。Product Console 的 Execution Adapter / Scheduler 页面以 Job、Execution Record、Skill 输出、next action 和 execution result 解释队列；Audit 仅保留轻量活动记录，不再作为主排障入口。

2026-05-03 update：自主执行下一 Feature 选择由 `feature-selection-skill` 负责推理，输入为 Feature Pool Queue、Feature index、Feature `spec-state.json`、依赖完成情况、最近 Execution Record 和 resume/skip hints。Control Plane 只执行通过队列、三件套、依赖、resume 和 active execution 安全校验的选择，并把 CLI/app-server 的 `approval_needed`、`blocked`、`review_needed`、`failed` 投影到 Feature `spec-state.json` 和 Execution Workbench。独立 `push_feature_spec_pool` 步骤已废弃，项目级 `schedule_run` 和 `start_auto_run` 直接承担 Feature 选择与入队执行。

2026-05-03 adapter redesign：执行层不再使用 Runner 作为核心概念，统一改为 Execution Adapter Layer。FEAT-008 是 CLI Adapter 迁移来源，负责 `cli.run`、Codex CLI、Gemini CLI 和本机进程执行；FEAT-018 是 RPC Adapter 迁移来源，负责 `rpc.run`、Codex RPC、HTTP/JSON-RPC/WebSocket 远程执行。迁移顺序为先落 `ExecutionAdapterConfigV1` / `ExecutionAdapterInvocationV1` / `ExecutionAdapterEventV1` / `ExecutionAdapterResultV1` 接口，再迁移 Codex CLI provider，再迁移 Codex RPC provider，最后清理 UI、数据库兼容字段和历史命名。

## Dependency Tree

依赖树以主解锁路径为主线，每个 Feature 只出现一次；存在多上游依赖的 Feature 在节点后标出额外前置项。

```text
FEAT-000 System Bootstrap
├── FEAT-001 Project and Repository Foundation
├── FEAT-002 Spec Protocol Foundation
├── FEAT-003 CLI Skill Directory Discovery
├── FEAT-014 Persistence and Auditability
└── FEAT-004 Orchestration and State Machine
    (requires FEAT-001, FEAT-002, FEAT-014)
    ├── FEAT-006 Project Memory and Recovery Projection
    ├── FEAT-007 Workspace Isolation
    │   ├── FEAT-005 CLI Subagent Audit Integration
    │   │   (also requires FEAT-004)
    │   └── FEAT-008 CLI Adapter
    │       ├── FEAT-009 Status Checker
    │       │   (also requires FEAT-004)
    │       │   ├── FEAT-010 Failure Recovery
    │       │   │   (also requires FEAT-008)
    │       │   └── FEAT-011 Review Center
    │       │       (also requires FEAT-004)
    │       │       └── FEAT-012 Delivery and Spec Evolution
    │       │           (also requires FEAT-009)
    │       └── FEAT-013 Product Console
    │           (also requires FEAT-001, FEAT-004)
    └── FEAT-016 SpecDrive IDE Foundation
        (also requires FEAT-001, FEAT-002, FEAT-014)
        ├── FEAT-017 IDE Spec Interaction
        │   (also requires FEAT-002, FEAT-012)
        ├── FEAT-018 RPC Adapter: Codex RPC Provider
        │   (also requires FEAT-008, FEAT-014)
        │   └── FEAT-019 IDE Execution Loop
        │       (also requires FEAT-008, FEAT-014, FEAT-016)
        │       └── FEAT-020 IDE Diagnostics and UX Refinement
        │           (also requires FEAT-017)
        │           └── FEAT-021 IDE Workbench Webviews
        │               └── FEAT-022 IDE System Settings Webview
```

### Direct Dependencies

| Feature ID | Direct Dependencies |
|---|---|
| FEAT-000 | None |
| FEAT-001 | FEAT-000 |
| FEAT-002 | FEAT-000 |
| FEAT-003 | FEAT-000 |
| FEAT-004 | FEAT-001、FEAT-002、FEAT-014 |
| FEAT-005 | FEAT-004、FEAT-007 |
| FEAT-006 | FEAT-004 |
| FEAT-007 | FEAT-004 |
| FEAT-008 | FEAT-007 |
| FEAT-009 | FEAT-004、FEAT-008 |
| FEAT-010 | FEAT-008、FEAT-009 |
| FEAT-011 | FEAT-004、FEAT-009 |
| FEAT-012 | FEAT-009、FEAT-011 |
| FEAT-013 | FEAT-001、FEAT-004、FEAT-008 |
| FEAT-014 | FEAT-000 |
| FEAT-015 | FEAT-013、FEAT-004、FEAT-014 |
| FEAT-016 | FEAT-001、FEAT-002、FEAT-004、FEAT-014 |
| FEAT-017 | FEAT-016、FEAT-002、FEAT-012 |
| FEAT-018 | FEAT-004、FEAT-008、FEAT-014 |
| FEAT-019 | FEAT-016、FEAT-018、FEAT-004、FEAT-008、FEAT-014 |
| FEAT-020 | FEAT-016、FEAT-017、FEAT-019 |
| FEAT-021 | FEAT-016、FEAT-019、FEAT-020 |
| FEAT-022 | FEAT-016、FEAT-018、FEAT-021 |

## Delivery Order

1. FEAT-000 bootstraps the control-plane runtime, artifact root and schema foundation.
2. FEAT-001, FEAT-002, FEAT-003 and FEAT-014 establish the project, spec, CLI skill discovery and persistence foundations.
3. FEAT-004 turns ready Feature Specs into auditable executor jobs, Execution Records and state transitions.
4. FEAT-005, FEAT-006 and FEAT-007 provide CLI delegation observation, memory projection and workspace isolation.
5. FEAT-008 enables local CLI execution through CLI Adapter.
6. FEAT-009 and FEAT-010 close the check and recovery loop.
7. FEAT-011 and FEAT-012 provide approval and delivery closure.
8. FEAT-013 exposes the operational surfaces over the control-plane state.
9. FEAT-016 to FEAT-020 add the VSCode IDE surface, RPC Adapter for Codex RPC, IDE execution loop, and diagnostics refinement after Product Console and Execution Adapter foundations exist.
10. FEAT-021 adds independent VSCode Webview Web UIs for Execution Workbench, Spec Workspace, and Feature Spec; they must not reuse Product Console pages, routes, navigation, App Shell, or component implementation.

## Spec Evolution Notes

| Item | Feature | Decision | Follow-up |
|---|---|---|---|
| ADD-001 | FEAT-001 | 项目宪章创建、导入和生命周期管理作为 FEAT-001 patch 处理，不拆分独立 Feature。 | 执行 `feat-001-project-repository-foundation/tasks.md` 中的 `TASK-009` 至 `TASK-011`。 |
| CHG-001 | FEAT-001 | Project `trust_level` 属于项目基础数据模型 patch，不拆分新 Feature。 | 执行 `feat-001-project-repository-foundation/tasks.md` 中的 `TASK-012`。 |
| ADD-002 | FEAT-004 | 调度触发模式作为 FEAT-004 patch 处理，不拆分独立 Feature。MVP 已实现触发记录、手动入口和时间类入口；CI 失败、审批通过、依赖完成先记录为受控事件触发请求，不直接绕过调度边界。 | 已执行 `feat-004-orchestration-state-machine/tasks.md` 中的 `TASK-010` 至 `TASK-012`。 |
| CHG-003 | FEAT-004 | `quickstart-validation` 与 `spec-consistency-analysis` 作为后续 Orchestration patch 处理。 | 后续执行计划流水线强制阶段任务。 |
| CHG-002 / CHG-004 | FEAT-007 | 并行写入策略和测试资源隔离属于 Workspace Isolation 安全边界 patch。 | 执行 `feat-007-workspace-isolation/tasks.md` 中的 `TASK-009` 至 `TASK-010`。 |
| ADD-003 / CHG-005 | FEAT-013 | Dashboard Board 操作和入口作为 Product Console patch 处理，所有写操作走受控命令。 | 已执行 `feat-013-product-console/tasks.md` 中的 `TASK-010` 至 `TASK-011`。 |
| ADD-004 | FEAT-013 | Product Console 增加界面多语言切换，首次打开默认中文；执行结果、diff、日志、路径、命令输出和用户输入保持原文。 | 已执行 `feat-013-product-console/tasks.md` 中的 `TASK-017` 至 `TASK-019`。 |
| ADD-005 | FEAT-001 / FEAT-013 | 支持导入现有项目、在统一 `workspace/` 目录下创建新项目，并在 Product Console 中切换当前项目上下文；所有查询、命令、Memory 投影和调度入口按 `project_id` 隔离。 | Product Console UI 已执行 `TASK-020` 至 `TASK-022`；FEAT-001 仍需执行 `TASK-013` 至 `TASK-016` 补项目目录/上下文持久化与初始化目录规则。 |
| CHG-011 | FEAT-001 / FEAT-013 | 阶段 1 项目初始化应在用户选择创建或导入项目后自动完成，不再要求用户逐步手动执行项目、仓库、Spec Protocol、项目宪章和 Project Memory 子步骤。 | FEAT-001 执行 `TASK-017` 至 `TASK-018`；FEAT-013 执行 `TASK-026` 展示自动初始化状态和阻塞反馈。 |
| CHG-043 | FEAT-002 | Feature Spec 拆分规则必须固化：若拆分结果包含项目初始化作为首个 Feature Spec，该 Feature Spec 必须包含项目根目录 `.gitignore` 创建或安全更新要求，且该规则面向目标项目规格生成，不绑定当前仓库。 | 执行 `feat-002-spec-protocol-foundation/tasks.md` 中的 `TASK-014`，并同步 `task-slicing-skill`。 |
| CHG-012 | FEAT-013 / FEAT-002 | 阶段 2 需求录入需要自动扫描 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引等 Spec Sources；扫描已有 HLD / Feature Spec 不等于生成 HLD 或拆分 Feature Spec。 | FEAT-013 执行 `TASK-027` 至 `TASK-028`；后续 FEAT-002 patch 提供 Spec Sources 扫描模型和生成 EARS 文档的事实输入。 |
| ADD-006 | FEAT-008 / FEAT-013 | CLI 调用升级为 CLI Adapter；adapter 配置以 JSON 为唯一事实源，并通过 Product Console 系统设置中的 JSON 表单直接编辑、dry-run 校验和启用；Execution Console 只展示配置健康摘要和跳转入口。 | 已执行 FEAT-008 `TASK-009` 至 `TASK-012`（CLI Adapter 配置持久化、dry-run 校验、Execution Adapter 阶段阻断路径、通过单测验证）；已执行 FEAT-013 `TASK-029` 至 `TASK-032`（System Settings 页面、CLI 配置页、JSON 编辑器 + 表单编辑器、受控命令 dry-run / 保存草稿 / 启用 / 禁用）；FEAT-013 `TASK-033` 浏览器级验证待执行。 |
| ADD-008 | FEAT-008 / FEAT-013 | CLI Adapter 增加 Google Gemini CLI 支持；`codex-cli` 仍为默认 preset，`gemini-cli` 可在 System Settings 中加载、编辑、dry-run 并启用。Gemini CLI 通过 headless JSON/JSONL 输出接入，仍以 SkillOutputContractV1 作为 SpecDrive 执行契约。 | 当前 patch 增加内置 `gemini-cli` preset、provider-neutral session/response 解析、Settings preset UI 和 adapter/scheduler/console 单测；不新增数据库表或 schema migration。 |
| CHG-017 | FEAT-008 / FEAT-013 | 实现过程发现 Execution Adapter Queue Worker 在 `cli_adapter_configs` 表非空但无 active row 时不阻断新 Run，且 SettingsPage 缺少 `disable_cli_adapter_config` 按鈕。 | 已在 `src/scheduler.ts` `loadRunnerTaskContext` 补充适配器数龐查询并添加阻断逻辑；已在 SettingsPage 添加禁用按鈕；已补充 CLI Adapter 校验、normalize 和阻断行为单测；全部 298 测试通过。 |
| CHG-015 | FEAT-004 / FEAT-008 / FEAT-013 / FEAT-014 | 调度系统升级为 BullMQ + Redis；SQLite 仍是业务事实源。当前模型由 CHG-018 收敛为 `<executor>.run` Job + Execution Record，`run_board_tasks` / Spec 操作入队 `cli.run` 后由 Worker 执行。 | 已执行 FEAT-004、FEAT-008、FEAT-013、FEAT-014 scheduler job / execution record 持久化与控制台展示。 |
| CHG-016 | FEAT-004 / FEAT-008 / FEAT-013 | Product Console / Spec 操作转换为 CLI skill invocation contract，并通过 active CLI Adapter 在当前项目 workspace 中调用编码 CLI；平台不恢复 Skill Registry 或 Skill Center。 | 已执行 FEAT-004 `TASK-017`、FEAT-008 `TASK-014` 至 `TASK-016`、FEAT-013 `TASK-035` 至 `TASK-036`。 |
| CHG-027 | FEAT-008 | Execution Adapter 从 Codex 专用执行层收敛为通用 CLI Adapter；`codex-cli` 保留为默认 preset，`gemini-cli` 保留为内置可选 preset，Codex RPC adapter 继续独立。 | 当前 patch 将代码模块、类型、execution result kind、Console 字段和 session 持久化改为 provider-neutral CLI 命名；新增 `cli_session_records` 兼容迁移并保留旧 `codex_session_records`。 |
| CHG-028 | FEAT-008 / FEAT-018 / FEAT-013 / FEAT-019 | 执行层从 Runner 概念重构为 Execution Adapter Layer；先定义统一适配层接口，再迁移 Codex CLI 与 Codex RPC provider。 | FEAT-008 作为 CLI Adapter 迁移来源；FEAT-018 作为 RPC Adapter 迁移来源；新任务不得继续引入 Runner 对外概念，历史实现名称仅作为兼容过渡。 |
| CHG-049 | FEAT-008 / FEAT-018 | Execution Adapter 输入规范收敛为唯一 `ExecutionAdapterInvocationV1`；独立 `SkillInvocationContractV1` 废弃并降级为内嵌 `skillInstruction`。 | Scheduler / Adapter 只管理 Feature 级执行；Feature 内部 `tasks.md` 由 CLI / RPC agent 自主读取和执行。Provider prompt 只说明任务、路径和输出要求，不内联上下文、不序列化完整 invocation。 |
| CHG-029 | FEAT-008 / FEAT-018 / FEAT-013 | Gemini Adapter 演进分为两条 provider：`gemini-cli` 继续属于 CLI Adapter headless `stream-json` provider，`gemini-acp` 新增为 RPC Adapter stdio JSON-RPC provider。 | FEAT-008 补 Gemini CLI 当前参数与输出解析；FEAT-018 从 Codex-only RPC provider 演进为多 provider RPC Adapter；Product Console System Settings 分开展示 CLI preset 与 RPC preset。 |
| CHG-019 | FEAT-004 / FEAT-008 / FEAT-013 | Feature 级编码执行改为 Feature Spec 目录驱动；`feat-implement-skill` 读取 `requirements.md`、`design.md`、`tasks.md` 后直接执行，不依赖 `task_graph_tasks` / `tasks` 表。 | 已同步 FEAT-004 `TASK-020`、FEAT-008 `TASK-017`、FEAT-013 `TASK-043`，并补充 feature-level `schedule_run` blocked/入队测试。 |
| CHG-025 | FEAT-004 / FEAT-008 / FEAT-019 / FEAT-021 | 下一 Feature 选择改为 `feature-selection-skill` 推理，代码保留队列、三件套、依赖、resume 和 active execution 安全校验；非持续执行状态投影到 Feature 执行结果。 | 已执行 patch，新增 `feature-selection-skill`、selection result 校验、approval pending spec-state 投影和测试覆盖。 |
| CHG-026 | FEAT-004 / FEAT-013 / FEAT-019 / FEAT-021 | 独立 `push_feature_spec_pool` 步骤废弃；任务调度全流程由项目级 `schedule_run` 和 `start_auto_run` 读取 Feature Pool Queue、选择下一 Feature、创建 `<executor>.run` Job 和 Execution Record。 | 已执行 patch，移除 public action 和 UI 步骤，保留 `feature-pool-queue.json` 作为调度输入事实源。 |
| CHG-009 | FEAT-013 | 当前 Product Console 实现只覆盖 Control Plane API 和 ViewModel，不能替代 PRD 第 8 节要求的用户可操作 UI。 | 已补真实前端应用、页面路由、shadcn/ui 组件体系和浏览器级验收。 |
| ADD-007 | FEAT-016 至 FEAT-020 | SpecDrive 增加 VSCode 插件作为 IDE 原生日常入口，不替代 Product Console，也不复用 Codex VS 插件私有 UI。 | 先执行 FEAT-016 只读入口，再执行 FEAT-017 文档交互、FEAT-018 Codex RPC Adapter、FEAT-019 执行闭环、FEAT-020 Diagnostics / UX refinement。 |
| CHG-021 | FEAT-016、FEAT-017、FEAT-019、FEAT-020 | 日常 Spec 操作入口从 Product Console 扩展到 VSCode IDE；Product Console 保留系统设置、adapter 配置、队列调试和全局状态总览。 | IDE 动作必须走 Control Plane command API，状态事实源仍为 workspace 文件、scheduler_job_records、execution_records 和 command receipt。 |
| CHG-022 | FEAT-018、FEAT-019 | RPC Adapter 增加迁移期兼容的 `codex.rpc.run` provider，与 `cli.run` 并存，并收敛到 `rpc.run`。 | Execution Adapter Layer 是唯一调用 app-server thread/turn API 的组件；Execution Record 扩展 thread/turn/transport/raw logs/approval/output schema 投影。 |
| CHG-023 | FEAT-021 | VSCode 插件开发独立 Webview Web UI，不复用当前 Product Console Web UI；核心关注任务调度和自动执行、Spec 全流程控制、Feature Spec 卡片总览。 | 新增 FEAT-021，必须提供 Execution Workbench、Spec Workspace、Feature Spec 三组 VSCode IDE Webview。 |
| CHG-024 | FEAT-021 | VSCode Feature Spec Webview 顶部 New Feature 输入提交后进入需求新增/变更模型判定；刷新同步 Feature index 与 Feature 文件夹；Feature 详情解析 `tasks.md` 任务状态。 | 已执行 `T-021-09` 至 `T-021-12`；`requirement-intake-skill` 已同步 Feature index 责任。 |
| CHG-043 | FEAT-019 / FEAT-021 / FEAT-022 | VSCode Feature Spec Webview 支持 Feature 多选调度；Schedule Selected 和单 Feature Schedule 都必须携带 Job 级 provider adapter，并由 adapter id 推导 `runMode`，为每个 Feature 创建独立 `feature_execution` Job。 | 已执行 FEAT-021 `T-021-20`；复用 REQ-086 的执行偏好解析与 adapter 校验。 |
| CHG-048 | FEAT-013 / FEAT-014 / FEAT-021 / FEAT-022 | token 计费按执行实际 adapter 设置：CLI 与 RPC adapter 都在 `defaults.costRates` 维护模型费率，`token_consumption_records.pricing_json` 保存 adapter id、adapter kind、model 和费率快照；历史记录不得因费率变更自动重算。 | 新增 Product Console / VSCode System Settings pricing 投影和后端 adapter 级成本计算测试；不新增历史重算命令。 |
| CHG-045 | FEAT-021 | Feature Spec Webview 在 blocked / block 或 need review / review_needed 状态显示 `Pass` 按钮；点击后通过受控命令将 Feature 和当前或最近执行记录同步为 completed。 | 已执行 FEAT-021 `T-021-22`；更新 `spec-state.json`、features、execution_records 和 scheduler_job_records 的完成投影。 |
| CHG-007 | FEAT-010 | 失败重试上限、2/4/8 分钟退避和失败指纹已由现有实现与测试覆盖。 | 无需重新执行 Feature Spec。 |
| CHG-006 / CHG-008 | Mainline Docs | Issue Tracker 非目标和性能阈值基线记录是文档约束，不形成实现任务。 | 无需执行 Feature Spec。 |
