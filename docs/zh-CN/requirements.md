# 需求：SpecDrive AutoBuild

## 1. 背景

SpecDrive AutoBuild 是一个以 Spec、Scheduler、Project Memory、CLI Adapter 外部运行观测和内部任务状态机驱动，并通过 Dashboard 呈现状态的长时间自主编程系统。它的目标不是让 AI 一次性生成代码，而是让 AI 在可控、可恢复、可审计的工程流程中持续交付代码。

2026-04-29 边界更新：平台能力收缩为项目/Feature/Task 的调度、状态机、状态聚合、审计和 Console 状态展示。平台不再提供 Skill 注册/发现/调用/schema 校验/Skill Center，不再提供 Subagent Runtime/Context Broker/Agent Run Contract/Subagent Console，不再提供 Planning Pipeline 主动编排执行。REQ-010 至 REQ-016、REQ-018、REQ-030、REQ-054 和 REQ-055 均按“已废弃”处理；REQ-043 改为平台中性的 Recovery Dispatch 输入。

2026-05-01 调度队列重构：平台只维护执行队列 Job 和 Execution Record / 执行记录。Job 类型表示 executor（如 `cli.run`、`native.run`），payload `operation` 表示任务操作（如 `feature_execution`、`generate_ears`、`generate_hld`、`generate_ui_spec`、`split_feature_specs`）。Feature/Task/Project 不再是 Job 顶层属性，只能出现在 payload `context` 中。`feature.select`、`feature.plan`、`feature_planning`、FeatureSelectionDecision、平台 TaskGraph 写入和 `feature.plan` blocked 语义均废弃；Feature 内部 task 状态由 LLM 与 Feature Spec `tasks.md` 管理。

## 2. 目标

- 将自然语言、PR、RP、PRD 或 EARS 输入转化为结构化 Feature Spec。
- 基于优先级、依赖、风险和就绪状态自动选择下一个可执行 Feature。
- 自动维护 Feature 从需求到任务图、看板、调度、检测、恢复、审批和交付的状态。
- 将大任务拆分为边界明确、可审计、可调度的任务。
- 为编码 CLI 会话提供跨会话 Project Memory，避免重复探索和上下文丢失。
- 通过 Execution Result、Status Checker 和 Review Center 支持状态判断、失败恢复和人工审批。
- 生成 PR、交付报告和 Spec Evolution 建议，形成可追踪交付闭环。

## 3. 非目标

- MVP 不自研大模型。
- MVP 不自研完整 IDE。
- MVP 不实现企业级复杂权限矩阵。
- MVP 不自动发布到生产环境。
- MVP 不处理多大型仓库复杂微服务自动迁移。
- MVP 不完整替代 Jira、GitHub Issues 或 Linear。
- MVP 不接入 Issue Tracker，仅保留外部链接和追踪字段。
- MVP 不以看板加载、状态刷新和 执行结果记录性能阈值作为验收门槛。

## 4. 角色

- 用户：输入需求、创建项目、查看进度和交付结果。
- 产品经理：管理产品目标、Feature Spec、验收标准和优先级。
- 开发者：审查任务、代码变更、测试结果、风险和 PR。
- 团队负责人：查看项目健康度、交付进度、审计日志和风险状态。
- 审批人：处理高风险操作、权限提升、需求澄清和失败恢复建议。
- 系统调度器：选择 Feature、调度任务、维护状态机并触发后续流程。
- CLI Adapter：通过 active 编码 CLI 执行代码修改、测试、修复和结构化结果输出。

## 5. 用户故事

- 作为用户，我希望提交自然语言需求，以便系统生成结构化 Feature Spec。
- 作为产品经理，我希望系统把 PRD 拆解为可测试需求和验收标准，以便客观判断交付结果。
- 作为开发者，我希望系统把 Feature 拆成边界明确的任务，以便自主编码过程可审查、可恢复。
- 作为开发者，我希望平台只调度边界明确的任务，以便执行过程可审计、可恢复且不会混淆状态来源。
- 作为团队负责人，我希望通过 Dashboard 和审计日志查看进度、失败和交付证据，以便掌握项目状态。
- 作为审批人，我希望高风险或失败任务自动进入 Review Center，以便不安全工作不会自动合并。
- 作为开发者，我希望 CLI 调用由可配置 adapter 管理，以便后续扩展不同 CLI、模型 profile 和输出格式时不修改调度核心。
- 作为开发者，我希望在 Product Console 的系统设置中用 JSON 表单编辑 CLI adapter 配置，以便调整命令参数、安全策略和输出映射时仍有 schema 校验与审计记录。
- 作为用户，我希望 Product Console 提供系统设置入口，以便集中管理跨页面、跨 Run 的系统级配置。
- 作为用户，我希望通过自然语言聊天面板提问和下达指令，以便在不离开当前页面的情况下查询状态、提交需求变更和触发调度。
- 作为审批人，我希望高风险指令在聊天面板中给出操作预览并等待我确认，以便我能审查后再决定是否执行。

## 6. 功能需求

### REQ-001：创建 AutoBuild 项目
来源：PRD 第 6.1 节 FR-001
优先级：Must

WHEN 用户开始创建 AutoBuild 项目
THE SYSTEM SHALL 创建项目记录，并保存项目名称、产品目标、项目类型、技术偏好、目标仓库、默认分支、信任级别、运行环境和自动化开关。

验收：
- [ ] 新项目创建后可以被查询，并包含项目身份、信任级别、初始配置和初始状态。

### REQ-002：连接 Git 仓库
来源：PRD 第 6.1 节 FR-002
优先级：Must

WHEN 用户为项目连接 GitHub、GitLab、本地 Git 或私有 Git 仓库
THE SYSTEM SHALL 保存仓库连接，并展示当前分支、最新 commit、未提交变更、当前 PR、CI 状态、任务分支和 worktree 状态。

验收：
- [ ] 已连接仓库可以被后续计划、调度和 Execution Adapter 流程使用。
- [ ] MVP 通过本机 `gh` CLI 执行 GitHub 仓库状态读取和 PR 创建，不单独建模 Git 平台权限矩阵。

### REQ-003：执行项目健康检查
来源：PRD 第 6.1 节 FR-003
优先级：Must

WHEN 用户或调度器请求项目健康检查
THE SYSTEM SHALL 检测 Git 仓库、包管理器、测试命令、构建命令、Codex 配置、AGENTS.md、Spec Protocol 目录、未提交变更和敏感文件风险。

验收：
- [ ] 健康检查返回 ready、blocked 或 failed，并提供可观察原因。

### REQ-004：创建 Feature Spec
来源：PRD 第 2.1 节目标 1；第 6.2 节 FR-010
优先级：Must

WHEN 用户提交自然语言产品需求
THE SYSTEM SHALL 生成包含 Feature 名称、目标、角色、用户故事、优先级、验收场景、需求、成功指标、实体、假设、不做范围和风险点的 Feature Spec。

验收：
- [ ] 每个生成的 Feature Spec 都能追踪到输入来源，并包含可审查的验收信息。

### REQ-005：拆解 PRD 为 EARS 需求
来源：PRD 第 6.2 节 FR-011
优先级：Must

WHEN Spec Protocol Engine 处理 PR、RP、PRD、EARS 或混合格式需求
THE SYSTEM SHALL 将行为拆解为原子化、可测试、带来源追踪的 EARS 需求。

验收：
- [ ] 每条需求只描述一个可观察行为，并映射到 Feature Spec、验收标准和测试场景。

### REQ-006：切分 Feature Spec
来源：PRD 第 6.2 节 FR-012
优先级：Must

WHEN Feature Spec 过大或执行任务需要更小上下文
THE SYSTEM SHALL 按 feature、user story、requirement、acceptance criteria 和 related files 切分 Spec。

验收：
- [ ] Coding Agent 默认只能读取当前任务相关的 Spec 切片。
- [ ] Feature Spec 拆分是独立受控操作；拆分完成后不再存在单独“推入 Feature Spec Pool”步骤，任务调度直接读取 `feature-pool-queue.json`。
- [ ] 当拆分结果包含项目初始化作为第一个 Feature Spec 时，该 Feature Spec 必须包含项目根目录 `.gitignore` 创建或安全更新需求；缺失时创建，已存在时只追加缺失的本地运行产物忽略规则，不得覆盖用户已有内容。

### REQ-007：维护 Clarification Log
来源：PRD 第 6.2 节 FR-013
优先级：Must

WHEN 系统发现需求缺失、歧义或冲突
THE SYSTEM SHALL 记录澄清问题、推荐答案、用户答案、影响范围、时间戳和决策责任人。

验收：
- [ ] 歧义输入会生成带状态和来源上下文的澄清记录。

### REQ-008：维护 Requirement Checklist
来源：PRD 第 6.2 节 FR-014
优先级：Must

WHEN Feature Spec 进入质量检查
THE SYSTEM SHALL 生成需求质量 checklist，覆盖完整性、清晰度、一致性、可测量性、场景覆盖、边界条件、非功能属性、依赖、假设、歧义和冲突。

验收：
- [ ] 未通过 checklist 的 Feature 不得自动进入 ready 状态。

### REQ-009：版本化 Spec
来源：PRD 第 6.2 节 FR-015
优先级：Must

WHEN Spec 发生变更
THE SYSTEM SHALL 按 MAJOR、MINOR 或 PATCH 规则生成新的 Spec 版本。

验收：
- [ ] Spec 版本记录能说明版本号、变更类型和变更原因。

### REQ-010：注册 Skill（废弃）
来源：PRD 第 4.2 节；第 6.3 节 FR-020
优先级：Must

WHEN 用户或系统试图注册 Skill
THE SYSTEM SHALL 不保存平台级 Skill 注册信息，并要求外部 CLI 或仓库治理自行处理 Skill 文件。

验收：
- [ ] 平台 schema、API 和 Console 不包含 Skill Registry。

### REQ-011：提供 MVP 内置 Skill（废弃）
来源：PRD 第 6.3 节 FR-021
优先级：Must

WHEN 系统初始化
THE SYSTEM SHALL 不写入内置 Skill 种子数据。

验收：
- [ ] Bootstrap readiness 不要求项目 Skill 文件存在。

### REQ-012：校验 Skill 输入输出 Schema（废弃）
来源：PRD 第 6.3 节 FR-022
优先级：Must

WHEN 外部运行产生结果
THE SYSTEM SHALL 只校验平台 执行结果、Status Check 和 Recovery Dispatch 输入，不校验 Skill schema。

验收：
- [ ] 平台状态迁移不依赖 Skill input/output schema。

### REQ-013：管理 Skill 版本（废弃）
来源：PRD 第 6.3 节 FR-023
优先级：Should

WHEN Skill 文件发生变更
THE SYSTEM SHALL 不维护平台级版本、启用/禁用、项目级覆盖或回滚记录。

验收：
- [ ] Console 不提供 Skill Center。

### REQ-014：定义 Subagent 类型（废弃）
来源：PRD 第 6.4 节 FR-030
优先级：Must

WHEN 外部执行器运行任务
THE SYSTEM SHALL 不创建平台 Subagent Run 或 agent_type。

验收：
- [ ] 平台任务图不包含 subagent 字段。

### REQ-015：创建 Agent Run Contract（废弃）
来源：PRD 第 4.3 节；第 6.4 节 FR-031
优先级：Must

WHEN Execution Adapter 或外部执行器启动
THE SYSTEM SHALL 不生成 Agent Run Contract；边界由任务、Execution Policy、worktree 和 status check 记录表达。

验收：
- [ ] 审计可从任务、Execution Policy、执行结果、Status Check 和状态转换中追踪。

### REQ-016：限制 Subagent 上下文（废弃）
来源：PRD 第 2.1 节目标 6；第 4.3 节
优先级：Must

WHEN 系统调度任务
THE SYSTEM SHALL 只维护任务边界、允许文件、依赖和状态，不负责 Subagent 上下文切片。

验收：
- [ ] 平台不保存 Subagent context broker 数据。

### REQ-017：隔离并行写入
来源：PRD 第 6.4 节 FR-032；第 6.8 节 FR-063
优先级：Must

WHEN 多个写入型任务并行执行
THE SYSTEM SHALL 为每个并行 Feature、任务或任务组创建独立 Git worktree 和隔离分支。

验收：
- [ ] 任意并行写入都能追踪到独立 worktree、分支、任务标识和合并目标。
- [ ] 只读 Subagent 可以并行；不同文件的 Coding Agent 可以并行；同一文件、同一分支写任务默认串行；高风险任务必须由单 Agent 执行。

### REQ-018：合并 Subagent 结果（废弃）
来源：PRD 第 6.4 节 FR-033
优先级：Must

WHEN 外部运行完成
THE SYSTEM SHALL 通过 执行结果、Status Check、Review、Recovery 和 Feature Aggregator 判断下一步状态。

验收：
- [ ] 看板状态变更后，Project Memory 状态快照被同步更新。

### REQ-019：初始化 Project Memory
来源：PRD 第 4.4 节；第 6.5 节 FR-044
优先级：Must

WHEN 项目创建完成
THE SYSTEM SHALL 初始化 `.autobuild/memory/project.md`，包含项目名称、目标、默认分支、当前 Spec 版本、初始任务状态快照和空运行记录。

验收：
- [ ] 新项目包含可读取的 Project Memory 文件。

### REQ-020：注入 Project Memory
来源：PRD 第 4.4 节；第 6.5 节 FR-045
优先级：Must

WHEN 编码 CLI 会话启动前
THE SYSTEM SHALL 将 Project Memory 内容作为 `[PROJECT MEMORY]` 上下文块注入。

验收：
- [ ] CLI 会话可以从 Project Memory 恢复当前任务、看板状态、上次 Run、阻塞、禁止操作和待审批事项。

### REQ-021：更新 Project Memory
来源：PRD 第 6.5 节 FR-046
优先级：Must

WHEN Run 结束
THE SYSTEM SHALL 根据 Execution Result 和 Status Checker 结果幂等更新 Project Memory。

验收：
- [ ] Project Memory 更新已完成任务、任务状态快照、当前 Run 状态、决策、阻塞和失败模式。

### REQ-022：控制 Project Memory 大小
来源：PRD 第 6.5 节 FR-047
优先级：Must

WHEN Project Memory 超过默认 8000 tokens 预算
THE SYSTEM SHALL 压缩旧 Execution Result 摘要、历史决策和已完成任务列表，同时保留当前任务、当前状态快照、当前阻塞和禁止操作。

验收：
- [ ] 每次压缩操作都写入审计日志。

### REQ-023：版本化 Project Memory
来源：PRD 第 6.5 节 FR-048
优先级：Should

WHEN Project Memory 发生变更
THE SYSTEM SHALL 生成包含时间戳和 run_id 的版本记录。

验收：
- [ ] 用户可以查看 Project Memory 历史版本并执行回滚。

### REQ-024：生成任务图
来源：PRD 第 6.7 节 FR-050
优先级：Must

WHEN Feature 计划阶段完成
THE SYSTEM SHALL 生成包含 task_id、标题、描述、来源需求、用户故事、验收标准、允许文件、依赖、并行性、风险、所需 Skill、所需 Subagent、预估工作量和状态的任务图。

验收：
- [ ] 每个任务都能追踪到来源需求和验收标准。

### REQ-025：维护看板列
来源：PRD 第 6.7 节 FR-051
优先级：Must

WHEN 项目创建任务看板
THE SYSTEM SHALL 提供 Backlog、Ready、Scheduled、Running、Checking、Review Needed、Blocked、Failed、Done 和 Delivered 列。

验收：
- [ ] 任务只能处于已定义看板列之一。

### REQ-026：自动流转任务状态
来源：PRD 第 6.7 节 FR-052
优先级：Must

WHEN 任务执行、检测、审批或交付结果变化
THE SYSTEM SHALL 按定义状态机自动流转任务状态。

验收：
- [ ] Running 任务完成检测后可进入 Done、Review Needed、Blocked 或 Failed。

### REQ-027：展示任务卡片
来源：PRD 第 6.7 节 FR-053
优先级：Should

WHEN 用户查看任务看板
THE SYSTEM SHALL 在任务卡片展示标题、Feature、User Story、状态、依赖、计划时间、最近执行通道、Execution Result、测试状态、diff 摘要、风险等级和审批状态。

验收：
- [ ] 用户可从任务卡片定位最近证据和风险信息。

### REQ-028：维护 Feature 状态机
来源：PRD 第 6.6 节 FR-054
优先级：Must

WHEN Feature 生命周期推进
THE SYSTEM SHALL 按 draft、ready、planning、tasked、implementing、done、delivered、review_needed、blocked 和 failed 状态机流转。

验收：
- [ ] 进入 review_needed 时必须记录 approval_needed、clarification_needed 或 risk_review_needed 细分原因。

### REQ-029：自动选择 Feature
来源：PRD 第 6.6 节 FR-055
优先级：Must

WHEN Project Scheduler 触发且存在可执行候选
THE SYSTEM SHALL 从 `feature-pool-queue.json` 和 Feature `spec-state.json` 动态读取 ready Feature，并调用 `feature-selection-skill` 选择下一个 Feature。

验收：
- [ ] Feature 选择结果、候选摘要和选择原因写入 Project Memory。
- [ ] MVP 不提供优先级评分、风险评分或人工覆盖规则的配置入口。
- [ ] 项目级 `schedule_run` 或 `start_auto_run` 读取 Skill 已规划好的机器可读队列产物，按规划结果同步候选记录并创建调度队列；不得由代码解析文档依赖关系或重新执行 Feature 拆分。

### REQ-030：自动驱动 Feature 计划流水线（废弃）
来源：PRD 第 6.6 节 FR-056
优先级：Must

WHEN Feature 进入 planning
THE SYSTEM SHALL 只维护 planning 状态和后续任务图/调度状态，不自动调用 Skill 或 Planning Pipeline。

验收：
- [ ] `planning_pipeline_runs` 不属于最终 schema。
- [ ] 任务图由已批准的 Feature Spec 或外部计划成果导入，不由平台流水线主动生成。

### REQ-031：聚合 Feature 状态
来源：PRD 第 6.6 节 FR-057
优先级：Must

WHEN 任一任务状态发生变化
THE SYSTEM SHALL 聚合该 Feature 下所有任务状态，并自动判断 Feature 是否 done、blocked、failed 或仍在 implementing。

验收：
- [ ] Feature done 判定同时满足任务 Done、Feature 验收、Spec Alignment Check 和必要测试通过。

### REQ-032：支持多 Feature 并行策略
来源：PRD 第 6.6 节 FR-058
优先级：Could

IF 项目级 Feature 并行开关启用
THEN THE SYSTEM SHALL 只允许互不影响文件和依赖的 Feature 并行 implementing，并为每个并行 Feature 使用独立 Git worktree 和隔离分支。

验收：
- [ ] 依赖未完成的 Feature 不得进入 implementing。

### REQ-033：运行 Project Scheduler
来源：PRD 第 6.8 节 FR-061 至 FR-062
优先级：Must

WHEN 项目级调度触发
THE SYSTEM SHALL 读取 `feature-pool-queue.json` 中已经规划好的 Feature 队列，调用 `feature-selection-skill` 执行 `select_next_feature` 推理选择，并把通过代码安全校验的工作转换为 `<executor>.run` Job。

验收：
- [ ] Project Scheduler 不依赖 Project Memory 中的静态候选队列作为真实调度来源。
- [ ] `feature-selection-skill` 的 `result` 至少返回 `decision`、`featureId`、`reason`、`blockedReasons`、`dependencyFindings`、`resumeRequiredFeatures` 和 `skippedFeatures`。
- [ ] 代码必须拒绝选择技能返回的非法 Feature、缺失三件套 Feature、依赖未完成 Feature、未显式 resume 的 blocked/failed/review_needed/approval_needed Feature，以及同项目已有 active `feature_execution` 时的选择。
- [ ] Spec/Feature 流程状态以 `docs/features/<feature-id>/spec-state.json` 为机器可读事实源，数据库只保存运行时执行事实；Feature 状态使用 `status`，最近执行状态使用 `executionStatus`，队列状态动作必须同步两者与 Execution Record。
- [ ] 项目级 `schedule_run` 和 `start_auto_run` 只创建 `<executor>.run` Job 并返回 `scheduleTriggerId`、`schedulerJobId` 和 `executionId`；独立 `push_feature_spec_pool` public action 不再存在。
- [ ] 项目级调度支持 blocked Feature 的显式 resume 和操作者 skip to next；缺失三件套、依赖未完成或未恢复的 blocked Feature 不得进入执行队列。
- [ ] Job 顶层不得包含 Feature/Task/Project 属性；这些业务上下文只能写入 payload `context`。
- [ ] Feature 执行统一使用 `operation = "feature_execution"`。
- [ ] 调度触发来源、触发时间、触发原因、BullMQ job id 和调度结果被记录到 SQLite 审计/调度记录；Project Memory 只保存投影摘要。
- [ ] Execution Record 记录真实执行实例，并与 执行结果、heartbeat、logs 和 session 关联。
- [ ] `approval_needed`、`blocked`、`review_needed`、`failed` 和合同校验失败必须投影到 Feature `spec-state.json.lastResult`、blocked reason 或 next action，且不得被自动执行循环当作可持续状态继续推进。

### REQ-034：运行 Feature Scheduler
来源：PRD 第 6.8 节 FR-061 至 FR-062
优先级：Must

WHEN Feature 内部调度触发
THE SYSTEM SHALL 根据任务依赖、风险、文件范围、Execution Adapter 可用性、worktree 状态、成本预算、执行窗口和审批要求推进任务。

验收：
- [ ] Feature Scheduler 只调度依赖已满足且边界允许的任务。
- [ ] `schedule_board_tasks` 只做合法的 `ready -> scheduled` 状态迁移和审计，不直接执行 CLI。
- [ ] `run_board_tasks` 只为已排期任务创建 Run 并入队 `cli.run`，CLI 执行必须由 Execution Adapter Worker 完成。

### REQ-035：记录 worktree 隔离状态
来源：PRD 第 6.8 节 FR-063
优先级：Must

WHEN 系统创建或使用 worktree
THE SYSTEM SHALL 记录 worktree 路径、分支名、base commit、目标分支、关联 Feature/Task、执行通道 和清理状态。

验收：
- [ ] 合并前执行冲突检测、Spec Alignment Check 和必要测试。
- [ ] 集成测试和端到端测试不得默认共享同一可变本地数据库或缓存实例；测试环境标识、连接串、容器名和清理策略写入 Run Contract 和 Execution Result。

### REQ-036：支持长时间恢复
来源：PRD 第 2.1 节目标 11；第 6.8 节 FR-064
优先级：Must

WHEN 系统重启或 Execution Adapter 恢复
THE SYSTEM SHALL 恢复未完成 Run、Running 任务、Scheduled 任务、Execution Adapter 心跳、Git worktree 状态、CLI session、最近 Execution Result 和 Project Memory。

验收：
- [ ] 重启后系统能继续未完成流程或明确标记阻塞原因。

### REQ-037：通过 CLI Adapter 执行编码 CLI
来源：PRD 第 6.9 节 FR-070
优先级：Must

WHEN 任务需要代码修改、测试或修复
THE SYSTEM SHALL 通过 CLI Adapter 在目标项目 workspace 中调用 Codex CLI、Google Gemini CLI 或后续等价编码 CLI，并要求输出符合 SkillOutput/Execution Result schema。

验收：
- [ ] CLI Adapter 产出结构化 Execution Result。
- [ ] 编码 CLI 进程的 workspace root 来自当前项目 repository `local_path` 或 `target_repo_path`，不得使用 SpecDrive Control Plane 进程目录作为兜底。

### REQ-038：应用 Execution Adapter Layer 安全配置
来源：PRD 第 6.9 节 FR-071 至 FR-072
优先级：Must

WHEN Execution Adapter Layer 启动
THE SYSTEM SHALL 根据开发阶段策略和任务上下文设置 sandbox mode、approval policy、model、profile、output schema、JSON event stream、workspace root 和 session resume。

验收：
- [ ] 开发阶段默认 Execution Policy 使用 `danger-full-access` 和 `approval=never`。
- [ ] 高风险任务在开发阶段不触发编码 CLI 人工确认；敏感文件、危险命令和 forbidden files 仍由 Safety Gate 阻断。

### REQ-039：执行 Execution Adapter 安全策略
来源：PRD 第 6.9 节 FR-071 至 FR-072；第 9.1 节
优先级：Must

WHEN 任务涉及高风险文件、危险命令、敏感配置或权限提升
THE SYSTEM SHALL 阻止自动执行或路由到人工审批。

验收：
- [ ] 认证、权限、支付、迁移、密钥和 forbidden files 修改会触发安全规则。

### REQ-065：管理 CLI Adapter
来源：PRD 第 6.9 节 FR-070、FR-073；用户输入“优化cli调用，升级为adapter”
优先级：Must

WHEN Execution Adapter Layer 需要启动外部 CLI 执行任务
THE SYSTEM SHALL 通过 active CLI Adapter 解析 executable、argument template、workspace root、session resume、output mode、执行结果映射和安全能力，不得在调度器或状态机中硬编码 Codex 或 Gemini 命令细节。

验收：
- [ ] 默认 `codex-cli` adapter 能生成与现有 Codex 执行等价的命令。
- [ ] 系统提供 `codex-cli` 和 `gemini-cli` 内置 preset；Gemini CLI 通过 headless `--output-format stream-json` 输出接入，使用 `--skip-trust`、`--approval-mode` 和 `-p` 承载非交互执行，并由 Execution Adapter 从 `init`、`message`、`tool_use`、`tool_result`、`error`、`result` 事件中提取 session、日志、token usage 和 SkillOutputContractV1 做事后校验。
- [ ] Execution Policy 解析结果与 adapter 配置合并后仍保留 sandbox、approval、model、profile、output schema 和 workspace root 约束。
- [ ] CLI / RPC adapter 的 `defaults.costRates` 是模型 token 费率唯一配置入口；每次 token 成本计算必须使用该次执行最终 adapter 的费率快照，不得使用当前 active adapter 费率重算历史。
- [ ] active CLI Adapter 必须在启动前解析并校验项目 workspace root；项目路径缺失、不可读或不是可用 workspace 时，新 Run 进入 blocked 并展示原因。
- [ ] CLI Adapter 变更写入审计日志，并且不影响已经 running 的 Run。
- [ ] 无 active adapter 或 adapter 配置无效时，Run 进入 blocked 并给出可观察原因。

### REQ-066：通过系统设置 JSON 表单管理 CLI Adapter 配置
来源：PRD 第 6.9 节 FR-073；PRD 第 8.9 节系统设置；用户输入“cli配置通过json管理，支持json表单管理，通过ui直接编辑修改”“增加系统设置，将Cli配置放到系统设置下”
优先级：Must

WHEN 用户在 Product Console 打开系统设置中的 CLI 配置页
THE SYSTEM SHALL 提供 CLI Adapter 配置管理界面，支持查看原始 JSON、通过 JSON Schema 生成的表单编辑配置、执行 dry-run 校验、保存草稿、启用配置和展示校验错误。

验收：
- [ ] CLI Adapter 配置以 JSON 作为唯一事实源，表单编辑和原始 JSON 编辑互相同步。
- [ ] 保存前必须通过 JSON Schema、命令模板、安全策略和必填字段校验。
- [ ] 用户可以编辑命令参数、安全策略、默认 model/profile、输出映射、session resume 和环境变量 allowlist。
- [ ] 配置保存、启用、禁用和校验失败都写入审计日志并在 UI 展示反馈。
- [ ] Product Console 浏览器级验证覆盖 JSON 编辑、表单编辑、校验失败和成功保存。

### REQ-067：提供系统设置
来源：PRD 第 8.9 节系统设置；用户输入“增加系统设置，将Cli配置放到系统设置下”
优先级：Must

WHEN 用户打开 Product Console
THE SYSTEM SHALL 提供系统设置入口，用于集中管理跨页面、跨 Run 的系统级配置，并将 CLI Adapter 配置管理放在系统设置下。

验收：
- [ ] Product Console 导航或 App Shell 提供系统设置入口。
- [ ] 系统设置至少包含 CLI 配置页，并能展示 active adapter、配置状态、schema 版本、最近 dry-run 和审计反馈。
- [ ] Execution Console 只展示 CLI Adapter 状态摘要和跳转入口，不直接编辑 CLI 配置。
- [ ] 系统设置页面遵循当前项目上下文、语言切换、加载态、空态、错误态和受控命令反馈规则。

### REQ-068：将 UI / Spec 操作转换为 Execution Adapter Invocation
来源：PRD 第 6.9 节 FR-070；用户输入“完善 CLI 调用实现”“Spec/UI 操作转换成 skill 调用完整流程”“Codex 支持 workspace，需要传入项目路径”
优先级：Must

WHEN 用户在 Product Console、Spec Workspace、VSCode Webview 或自动调度中发起需求录入、规划、任务拆分、Feature 执行或状态调度操作
THE SYSTEM SHALL 将受控命令转换为 `ExecutionAdapterInvocationV1`，并通过其中的 `skillInstruction` 指示 CLI / RPC agent 在当前项目 workspace 中执行对应任务。

验收：
- [ ] `ExecutionAdapterInvocationV1` 是唯一 adapter 输入协议，至少包含 `executionId`、`projectId`、`workspaceRoot`、`operation`、`featureId`、`specState`、`traceability`、`constraints`、`outputSchema` 和 `skillInstruction`。
- [ ] `skillInstruction` 至少包含 `skillSlug`、`requestedAction`、`sourcePaths`、`expectedArtifacts`、`imagePaths` 和可选 `operatorInput`；系统不再生成独立 `SkillInvocationContractV1`。
- [ ] provider prompt 只说明本次要执行的 Feature 级任务、需要读取的 workspace 路径和期望输出，不内联源文件内容、不序列化完整 invocation、也不承担上下文管理。
- [ ] Feature 执行只管理到 Feature 级；Feature 内部 `tasks.md` 由 CLI / RPC agent 自主读取和执行，Scheduler / Execution Adapter 不追踪 Feature 内 task 状态。
- [ ] Stage 2 需求录入操作映射到需求扫描、需求拆解、需求新增或质量检查相关 Skill；Stage 3 planning 操作映射到 planning Skill pipeline；Feature 运行操作映射到 `feat-implement-skill`。
- [ ] 平台只持久化 Run、scheduler job、执行结果、Status、Review 和 Audit，不恢复平台级 Skill Registry、Skill Center、Skill schema 校验或 SkillRun 表。
- [ ] Execution Console 和 Spec Workspace 能展示 scheduler job、run id、workspace、skill phase、blocked reason 和最近执行结果。

### REQ-040：检测任务完成度
来源：PRD 第 6.10 节 FR-080
优先级：Must

WHEN Run 结束
THE SYSTEM SHALL 检测 Git diff、构建、单元测试、集成测试、类型检查、lint、安全扫描、敏感信息扫描、Spec alignment、任务完成度、风险文件和未授权文件。

验收：
- [ ] 每次 Run 后都有状态检测结果和证据。

### REQ-041：检查 Spec Alignment
来源：PRD 第 6.10 节 FR-082
优先级：Must

WHEN 系统检测 Run 结果
THE SYSTEM SHALL 检查 diff、task、user story、requirement、acceptance criteria、测试覆盖和 forbidden files 之间的一致性。

验收：
- [ ] 与 Spec 不一致的变更不得直接进入 Done。

### REQ-042：生成状态判断
来源：PRD 第 6.10 节 FR-081
优先级：Must

WHEN Status Checker 汇总检测结果
THE SYSTEM SHALL 将任务判断为 Done、Ready、Scheduled、Review Needed、Blocked 或 Failed，并给出原因。

验收：
- [ ] 连续失败超过阈值时任务进入 Failed。

### REQ-043：生成恢复调度输入
来源：PRD 第 6.11 节 FR-090
优先级：Must

WHEN 任务失败且可尝试自动恢复
THE SYSTEM SHALL 生成恢复任务和平台中性的 Recovery Dispatch 输入。

验收：
- [ ] 恢复任务包含失败类型、失败命令、摘要、相关文件、历史尝试、禁止重试项和最大重试次数，且不包含固定 Skill slug。

### REQ-044：执行恢复策略
来源：PRD 第 6.11 节 FR-091
优先级：Must

WHEN Recovery Agent 处理失败任务
THE SYSTEM SHALL 支持自动修复、回滚当前任务修改、拆分任务、降级为只读分析、请求人工审批、更新 Spec 或更新任务依赖。

验收：
- [ ] 每次恢复动作都有 Execution Result 和下一步建议。

### REQ-045：防止重复失败循环
来源：PRD 第 6.11 节 FR-092
优先级：Must

WHEN 同一任务重复失败
THE SYSTEM SHALL 记录失败原因、修复方案、禁止重复策略、失败次数和失败模式指纹，并对同一失败模式最多自动重试 3 次，重试等待时间依次为 2 分钟、4 分钟和 8 分钟。

验收：
- [ ] 达到最大重试次数后系统停止自动重试并进入人工处理路径。
- [ ] 失败模式指纹至少由 task_id、失败阶段、失败命令或检查项、规范化错误摘要和相关文件集合生成。
- [ ] 禁止重复策略记录已导致同一指纹重复失败的修复方案、命令和文件范围，并阻止再次自动执行相同尝试。

### REQ-046：触发 Review Needed
来源：PRD 第 6.12 节 FR-100
优先级：Must

WHEN 任务修改高风险区域、diff 超阈值、修改 forbidden files、多次失败、测试未通过但建议继续、需求存在高影响歧义、需要提升权限、变更 constitution、变更架构方案、触发 AGENTS.md / 项目宪章声明的人工授权规则，或 Project Memory / 项目健康检查发现与持久状态、Git 事实或安全策略冲突且需要人工判断
THE SYSTEM SHALL 将任务路由到 Review Needed。

验收：
- [ ] Review Needed 必须包含具体触发原因和推荐动作。
- [ ] 进入 `review_needed` 的执行结果必须创建可查询的 ReviewItem；Product Console 和 VSCode Webview 必须复用同一 ReviewItem 审批事实源。

### REQ-047：支持审批操作
来源：PRD 第 6.12 节 FR-101
优先级：Must

WHEN 审批人打开 Review Center
THE SYSTEM SHALL 展示任务目标、关联 Spec、Agent Run Contract、diff 摘要、测试结果、风险说明、推荐动作和可选操作。

验收：
- [ ] 审批人可以批准继续、拒绝、要求修改、回滚、拆分任务、更新 Spec 或标记完成。

### REQ-048：创建 Pull Request
来源：PRD 第 6.13 节 FR-110
优先级：Must

WHEN Feature 达到交付条件
THE SYSTEM SHALL 通过本机 `gh` CLI 创建包含 Feature 摘要、完成任务、关联 requirements、测试结果、风险说明、审批记录、回滚方案和未完成事项的 PR。

验收：
- [ ] PR 内容可以追踪到需求、任务和证据。

### REQ-049：生成交付报告
来源：PRD 第 6.13 节 FR-111
优先级：Must

WHEN 一轮交付完成
THE SYSTEM SHALL 生成包含完成内容、变更文件、验收结果、测试摘要、失败和恢复记录、风险项、下一步建议和 Spec 演进建议的交付报告。

验收：
- [ ] 每次 PR 交付都有对应交付报告。

### REQ-050：从交付约束演进 Spec
来源：PRD 第 6.13 节 FR-112
优先级：Should

WHEN 实现发现需求不准确、验收标准不可测、代码库现实与计划冲突、审批改变范围、测试暴露边界缺失或运行指标暴露新约束
THE SYSTEM SHALL 建议更新 Spec。

验收：
- [ ] Spec Evolution 建议包含来源证据和影响范围。

### REQ-051：捕获 Execution Result
来源：PRD 第 4.5 节；第 7 节 ExecutionResult
优先级：Must

WHEN Subagent Run 结束
THE SYSTEM SHALL 生成结构化 Execution Result，包含 run_id、agent_type、task_id、status、summary、执行证据和推荐动作。

验收：
- [ ] Execution Result 可被 Status Checker、Review Center、Recovery Agent 和交付报告复用。

### REQ-052：展示 Dashboard 状态
来源：PRD 第 8.1 节；第 8.5 节
优先级：Should

WHEN 用户打开 Dashboard
THE SYSTEM SHALL 展示项目健康度、当前活跃 Feature、看板任务数量、运行中的 Subagent、今日自动执行次数、失败任务、待审批任务、成本消耗、最近 PR 和风险提醒。

验收：
- [ ] Dashboard 可以展示项目级和任务级状态摘要。
- [ ] Dashboard Board 能展示任务依赖、diff、测试结果、审批状态和失败恢复历史入口。

### REQ-053：提供 Spec Workspace
来源：PRD 第 8.2 节
优先级：Should

WHEN 用户打开 Spec Workspace
THE SYSTEM SHALL 支持创建 Feature，并查看 Spec、澄清记录、需求质量 checklist、技术计划、数据模型、契约、任务图和 Spec 版本 diff。

验收：
- [ ] 用户可以从 Spec Workspace 追踪需求到任务图。

### REQ-054：提供 Skill Center（废弃）
来源：PRD 第 8.3 节
优先级：Should

WHEN 用户打开 Product Console
THE SYSTEM SHALL 不显示 Skill Center。

验收：
- [ ] Console 导航和 API 不包含 Skill Center。

### REQ-055：提供 Subagent Console（废弃）
来源：PRD 第 8.4 节
优先级：Should

WHEN 用户打开 Product Console
THE SYSTEM SHALL 不显示 Subagent Console 或 Subagent 终止/重试动作。

验收：
- [ ] Console 导航和 API 不包含 Subagent Console。

### REQ-056：提供 Execution Console
来源：PRD 第 8.6 节
优先级：Should

WHEN 用户打开 Execution Console
THE SYSTEM SHALL 展示 Execution Adapter 在线状态、active CLI adapter、当前模型、当前 sandbox、approval policy、queue、最近日志和心跳状态，并支持暂停或恢复 Execution Adapter。

验收：
- [ ] 用户可以判断 Execution Adapter Layer 是否可执行新任务。

### REQ-057：提供 Review Center
来源：PRD 第 8.7 节
优先级：Must

WHEN 用户打开 Review Center
THE SYSTEM SHALL 展示待审批列表、风险筛选、diff、执行结果、审批操作、项目规则写入和 Spec Evolution 写入入口。

验收：
- [ ] 高风险、阻塞或需澄清任务能从 Review Center 被处理。

### REQ-058：持久化 MVP 核心实体
来源：PRD 第 7 节核心数据模型；问题澄清
优先级：Must

WHEN MVP 创建或更新 Project、Feature、Requirement、Task、Run、ProjectMemory 或 ExecutionResult
THE SYSTEM SHALL 将该实体的必填字段全部持久化。

验收：
- [ ] Project、Feature、Requirement、Task、Run、ProjectMemory 和 ExecutionResult 的必填字段可以从持久层完整读取并用于状态恢复。

### REQ-059：管理项目宪章
来源：PRD 第 5 节阶段 1；第 6.3 节 FR-021
优先级：Must

WHEN 用户完成项目创建和仓库连接
THE SYSTEM SHALL 支持导入或创建项目宪章，并将项目目标、工程原则、边界规则、审批规则和默认约束纳入项目初始化事实源。

验收：
- [ ] 项目宪章可以被 Project Memory、Scheduler、Review Center 和后续 Feature Spec 流程引用。
- [ ] 项目宪章变更必须保留版本记录，并触发受影响 Feature 或任务的重新校验。

### REQ-060：支持调度触发模式
来源：PRD 第 6.8 节 FR-060
优先级：Must

WHEN 用户或系统配置自动执行触发方式
THE SYSTEM SHALL 支持立即执行、指定时间执行、每日执行、每小时巡检、夜间自动执行、工作日执行、依赖完成后执行、CI 失败后执行和审批通过后执行。

验收：
- [ ] 每次调度运行都能追踪触发模式、触发时间、触发来源、触发对象、BullMQ queue/job type/job id、payload、attempts、错误和调度结果。
- [ ] 手动触发立即入队；指定时间触发使用 delayed job；每日、每小时、夜间和工作日触发使用 repeatable job。
- [ ] CI 失败、审批通过和依赖完成触发不得绕过 Feature/Task 边界、审批规则或安全策略。
- [ ] Redis 不可用时 scheduler health 为 blocked，API 和 Console 不得崩溃。

### REQ-061：提供 Dashboard Board 操作
来源：PRD 第 8.5 节
优先级：Should

WHEN 用户打开 Dashboard Board
THE SYSTEM SHALL 支持看板拖拽、批量排期、批量运行，以及查看任务依赖、diff、测试结果、审批状态和失败恢复历史。

验收：
- [ ] 拖拽或批量操作只能产生受状态机允许的状态变更或调度请求。
- [ ] 批量排期和批量运行必须保留审计记录，并对高风险、依赖未满足或审批缺失任务给出阻塞原因。
- [ ] Dashboard Board 不得通过普通查询接口、前端本地状态或直接 CLI 调用改变任务状态；拖拽、批量排期和批量运行必须产生受控命令回执。

### REQ-062：支持 UI 多语言切换
来源：用户指令：UI 支持多语言切换，默认中文；PRD 第 8.8 节
优先级：Should

WHEN 用户打开 Product Console
THE SYSTEM SHALL 默认使用中文界面，并提供可见的语言切换入口，使用户可以切换受支持的界面语言。

验收：
- [ ] Product Console 首次打开时默认展示中文导航、页面标题、操作按钮、状态标签、空态、错误态和反馈提示。
- [ ] 用户切换语言后，当前页面与后续页面导航使用所选语言展示，并保留用户的语言选择。
- [ ] 系统不得翻译 执行结果、diff、日志、文件路径、命令输出或用户输入内容等事实数据。
- [ ] 浏览器级 UI 验证覆盖默认中文和至少一次语言切换。

### REQ-063：支持多项目创建与切换
来源：用户指令：支持项目创建，支持多个项目切换；PRD 第 6.1 节 FR-001；PRD 第 8.1 节
优先级：Must

WHEN 用户在 Product Console 创建、导入、查看或切换 AutoBuild 项目
THE SYSTEM SHALL 维护项目目录和当前项目上下文，并自动完成项目记录、仓库探测或连接、`.autobuild/` / Spec Protocol、项目宪章、Project Memory、健康检查和当前项目上下文初始化，确保所有项目级查询、受控命令、Project Memory 投影、调度入口、审计事件和反馈提示都绑定到当前项目；Spec 流程产生的扫描、上传、生成、调度、状态检查和 execution result / Memory 写入必须以当前项目目录作为根目录，不得退回到 AutoBuild 自身运行目录。

WHEN 控制面首次启动或连接到新的 `.autobuild/autobuild.db`
THE SYSTEM SHALL 使用空项目数据库作为真实初始状态，不得把示例项目、历史项目或其他数据库中的项目投影到当前项目列表。

WHEN 用户创建或导入项目目录
THE SYSTEM SHALL 将项目目录解析为规范化绝对路径，并在 Project 记录和 Repository Connection 持久层强制唯一；若该路径已经绑定到其他项目，系统必须阻止创建并返回已有项目标识。

WHEN 用户需要演示数据
THE SYSTEM SHALL 仅在用户显式触发“导入 Demo 种子数据”时将 Demo 数据写入当前数据库；导入后不得自动切换当前项目，Demo 项目必须像普通项目一样由用户手动选择。

验收：
- [ ] 用户可以通过项目创建表单创建新项目，新项目目录必须位于统一 `workspace/` 目录下。
- [ ] 用户可以导入现有项目目录，系统将该目录作为项目目录并自动执行仓库探测、Spec Protocol 初始化、项目宪章导入或默认创建、Project Memory 初始化和健康检查。
- [ ] 首次安装或空数据库启动时，项目列表为空；内置示例数据不得与真实项目列表合并。
- [ ] 同一规范化项目目录不得被多个项目记录或仓库连接重复绑定；重复创建必须返回可观察阻塞原因和已有项目 ID。
- [ ] Demo 数据只能作为显式导入的种子数据进入持久层；运行时不得使用 bundled Demo 数据作为查询失败、空库或项目切换的自动兜底。
- [ ] Demo 种子导入成功后刷新项目列表但不自动切换当前项目。
- [ ] 用户可以创建或导入多个项目，并在项目列表中看到每个项目的名称、项目目录、仓库摘要、健康状态和最近活动时间。
- [ ] 用户切换项目后，Dashboard、Spec Workspace、Execution Console、Review Center 和 Board 都只展示当前项目的数据。
- [ ] 项目级受控命令必须携带当前 `project_id`；缺少或不匹配时不得执行，并返回可观察的阻塞原因。
- [ ] Spec 流程所有文件读写、命令执行和证据路径解析必须使用当前项目目录或其 `.autobuild/`，不得使用 Product Console / AutoBuild 进程的运行目录作为兜底。
- [ ] 普通查询接口只能读取项目状态、ViewModel、schema 或只读预览；项目初始化、调度、执行、配置生效、审批、规则写入和 execution result / Project Memory 写入必须通过受控命令并写审计。
- [ ] Project Memory 注入、Feature 选择、调度运行和 执行结果查询不得跨项目复用状态。
- [ ] 阶段 1 自动初始化失败时，系统返回具体阻塞原因，不要求用户在 Product Console 中逐步手动执行初始化子步骤。

### REQ-064：自动扫描 Spec Sources
来源：用户指令：阶段 2 自动扫描 PRD、EARS、HLD、Feature Spec 等；用户指令：阶段 2 将 Spec 扫描和上传合成一个步骤并显示“扫描”“上传”两个按钮；PRD 第 5 节阶段 2；PRD 第 6.2 节 FR-011
优先级：Must

WHEN 项目完成阶段 1 初始化并进入需求录入
THE SYSTEM SHALL 自动扫描当前项目中的 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引等 Spec Sources，识别已有需求格式、规格产物、来源追踪、缺失项和冲突，并将扫描结果提供给 EARS 生成、澄清和需求质量检查。

验收：
- [ ] 阶段 2 扫描结果包含已发现的 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引路径及其类型。
- [ ] Spec Workspace 阶段 2 必须将 Spec Sources 扫描和 Spec 上传显示为同一个阶段内步骤，并在该步骤内提供“扫描”和“上传”两个按钮，不得拆成两个独立步骤。
- [ ] 系统能区分“扫描已有 HLD / Feature Spec 事实源”和“生成 HLD / 拆分 Feature Spec”两个边界；阶段 2 不得触发 HLD 生成、Feature Spec 拆分或规划流水线。
- [ ] 扫描结果必须标记已有需求、设计和 Feature Spec 的来源追踪关系、缺失项、冲突项和需要澄清的问题。
- [ ] Spec Workspace 必须展示 Spec Sources 自动扫描状态，并在扫描失败或缺少关键来源时给出阻塞原因。

### REQ-069：提供 Chat Interface 悬浮面板
来源：用户输入"需要在现在系统实现一个聊天功能"；PRD 第 8.10 节
优先级：Should

WHEN 用户打开 Product Console
THE SYSTEM SHALL 在所有页面展示可折叠的悬浮对话面板，支持用户输入自然语言指令并接收结构化反馈，且面板不遮挡主要页面内容。

验收：
- [ ] 悬浮面板默认折叠，通过右下角图标切换展开/折叠状态。
- [ ] 展开面板展示对话历史、输入框、发送按钮和加载状态指示器。
- [ ] 面板支持中文和英文界面切换，与全局 locale 同步。
- [ ] 面板在桌面和移动端宽度下均可使用。

### REQ-070：识别用户自然语言意图并分类
来源：用户输入"他能识别用户输入的意图，使用受控指令或skill完成工作"；REQ-069
优先级：Should

WHEN 用户在 Chat Interface 发送消息
THE SYSTEM SHALL 调用 Codex CLI 对消息进行意图分类，识别意图类型（query_status、query_review、add_requirement、change_requirement、schedule_run、pause_execution_adapter、resume_execution_adapter、approve_review、reject_review、generate_ears、generate_hld、help、cancel、confirm、unknown），并在 Codex 不可用时退回基于关键词的规则分类。

验收：
- [ ] 分类结果包含意图类型、置信度、风险等级（low/medium/high）、确认要求和提取的实体信息。
- [ ] Codex 调用失败或超时时，系统使用规则分类并在响应中标注 fallback。
- [ ] 同一会话消息历史被作为上下文传递给意图分类器，以支持多轮对话。
- [ ] 未能识别的意图返回 unknown 类型并给出帮助提示。

### REQ-071：执行低风险和中等风险意图
来源：用户输入"查询任务状态等"；REQ-070
优先级：Should

WHEN Chat Interface 识别到低风险（query_status、query_review、help、cancel、confirm）或中等风险（generate_ears、generate_hld、add_requirement、change_requirement）意图
THE SYSTEM SHALL 立即将意图转换为对应受控命令并执行，不要求额外确认，并将执行结果或摘要以自然语言格式返回给用户。

验收：
- [ ] 查询意图返回项目状态、Feature 列表、任务看板摘要或 Review 待审批项。
- [ ] 生成类意图通过 `submitConsoleCommand` 提交受控命令并返回命令回执摘要。
- [ ] 所有执行结果都写入 chat_messages 表的 `command_receipt_json` 字段，并标记 command_status 为 executed。

### REQ-072：高风险意图需用户确认后执行
来源：用户输入"高风险操作需要二次确认"；REQ-070
优先级：Should

WHEN Chat Interface 识别到高风险意图（schedule_run、pause_execution_adapter、resume_execution_adapter、approve_review、reject_review）
THE SYSTEM SHALL 向用户展示操作预览（动作类型、目标实体类型和 ID、请求原因），将待确认命令存储在 chat_sessions.pending_command_json，等待用户在当前会话中发送 confirm 或 cancel 意图后才执行，并在超出当前会话时清除 pending 状态。

验收：
- [ ] 高风险意图不得自动执行，必须展示预览并返回 state=pending_confirmation。
- [ ] pending_command_json 只存储一个待确认命令；新的高风险意图会覆盖旧的未确认命令。
- [ ] 确认后执行通过 `submitConsoleCommand` 完成，并清除 pending_command_json。
- [ ] 取消后返回 state=cancelled，清除 pending_command_json，并告知用户操作已取消。
- [ ] 当前项目 ID 缺失或不匹配时，高风险命令返回 blocked 并给出原因。

### REQ-073：持久化 Chat Session 和消息历史
来源：REQ-069；REQ-072；PRD 第 7 节核心数据模型
优先级：Should

WHEN 用户在 Chat Interface 发送或接收消息
THE SYSTEM SHALL 将会话（chat_sessions）、用户消息、意图分类结果、命令回执和助手回复持久化到 SQLite 数据库，以 project_id 关联项目，每个项目维护一个活跃会话，支持会话重连时恢复消息历史。

验收：
- [ ] chat_sessions 表存储会话 ID、project_id、pending_command_json、created_at 和 updated_at。
- [ ] chat_messages 表存储消息 ID、session_id、role、content、intent_type、command_action、command_status、command_receipt_json 和 created_at。
- [ ] 同一 project_id 重新打开面板时，系统返回同一活跃会话并加载最近消息历史（默认最多 50 条）。
- [ ] 消息持久化失败不得阻塞用户发送操作；失败时记录错误日志。

### REQ-074：识别 VSCode SpecDrive 工作区
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` REQ-VSC-001；`docs/zh-CN/vscode-app-plan.md` FEAT-016
优先级：Should

WHEN 用户在 VSCode 打开工作区
THE SYSTEM SHALL 识别当前目录是否包含 SpecDrive 文档结构、Feature 队列和 `.autobuild` 运行状态，并建立 VSCode 插件到本地 Control Plane 的只读连接。

验收：
- [ ] 支持多语言结构：`docs/<language>/PRD.md`、`docs/<language>/requirements.md`、`docs/<language>/hld.md`。
- [ ] 支持单语言结构：`docs/PRD.md`、`docs/requirements.md`、`docs/hld.md`。
- [ ] 能识别 `docs/features/README.md`、`docs/features/feature-pool-queue.json` 和各 Feature `spec-state.json`。
- [ ] 未识别到 SpecDrive 项目时，插件显示初始化或连接提示，不执行调度。

### REQ-075：提供 VSCode Spec Explorer
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` REQ-VSC-002、REQ-VSC-003；`docs/zh-CN/vscode-app-plan.md` FEAT-016
优先级：Should

WHEN 工作区被识别为 SpecDrive 项目
THE SYSTEM SHALL 在 VSCode Activity Bar 或 Explorer 中展示 PRD、requirements、HLD、Feature Specs、Feature 状态和 Task Queue 状态。

验收：
- [ ] 左侧树显示 PRD、EARS Requirements、HLD、Feature Specs 和 Task Queue。
- [ ] Feature 节点显示 status、priority、dependencies、blocked reason 和最近执行结果。
- [ ] Task Queue 按 queued、running、approval_needed、blocked、failed、completed 分组。
- [ ] 点击节点打开对应文件、状态面板、Execution Record 或最近 Codex 会话。

### REQ-076：提供 VSCode 文档 Hover、CodeLens 和 Comments
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` REQ-VSC-004 至 REQ-VSC-006；`docs/zh-CN/vscode-app-plan.md` FEAT-017
优先级：Should

WHEN 用户打开 PRD、requirements、HLD 或 Feature Spec
THE SYSTEM SHALL 通过 VSCode Hover、CodeLens 和 Comments 提供行级/段落级 Spec 交互，允许用户提交澄清、需求新增、需求变更、生成 EARS、更新设计和拆分 Feature 的意图。

验收：
- [ ] Hover 显示 requirement id、Feature、traceability、spec-state 和可用动作。
- [ ] CodeLens 动作必须转换为受控命令，不得直接修改运行状态。
- [ ] Comment 包含文件路径、range、原文片段、问题、建议答案、用户答案和状态。
- [ ] Codex 修改文档后 Comment 标记为 resolved、superseded 或 failed。

### REQ-077：提交 SpecChangeRequest 时校验源文本
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` 第 7.4 节；`docs/zh-CN/vscode-app-plan.md` FEAT-017
优先级：Must

WHEN 用户从 VSCode 提交澄清、新增需求或需求变更
THE SYSTEM SHALL 生成 `SpecChangeRequestV1`，携带 source file、range、textHash、intent、comment、targetRequirementId 和 traceability，并由 Control Plane 校验源文本是否仍匹配。

验收：
- [ ] 新需求没有目标 requirement id 时路由到 requirement intake。
- [ ] 已有 requirement id 的修改路由到 spec evolution。
- [ ] 原文已变化时返回 `stale_source`，要求用户重新确认。
- [ ] 文档写入由 Codex 执行并通过 Git diff 呈现；VSCode 插件只提交意图。

### REQ-078：提供 IDE 受控命令接口
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` 第 7.3 节；`docs/zh-CN/vscode-app-plan.md` Interfaces And Contracts
优先级：Must

WHEN VSCode 插件触发有副作用动作
THE SYSTEM SHALL 通过 Control Plane command API 接收 IDE action，校验 projectId、workspaceRoot、source path、adapter config 和权限边界，并返回 `IdeCommandReceiptV1`。

验收：
- [ ] VSCode 插件不得直接写 `spec-state.json`、`execution_records` 或 `scheduler_job_records`。
- [ ] IDE action 至少覆盖 `submit_spec_change_request`、`enqueue_feature`、`run_feature_now`、`run_task_now`、`pause_job`、`resume_job`、`retry_execution`、`cancel_execution`、`skip_feature`、`reprioritize_job`、`approve_app_server_request`。
- [ ] 查询类动作可以读取文件或调用 query API；落盘、调度、取消、重试、审批或修改配置必须走受控命令。

### REQ-079：管理 VSCode Task Queue 动作
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` REQ-VSC-003、第 7.6 节；`docs/zh-CN/vscode-app-plan.md` FEAT-019
优先级：Should

WHEN 用户在 VSCode Spec Explorer 中操作 Task Queue
THE SYSTEM SHALL 支持 enqueue、run now、pause、resume、retry、cancel、skip、reprioritize 和 refresh，并同步 scheduler_job_records、execution_records 与 spec-state 摘要。

验收：
- [ ] queued Job 的 cancel 只更新 Job 状态；running Job 的 cancel 必须通过 Execution Adapter 调用 `turn/interrupt`。
- [ ] retry 必须引用上一条 execution id，并创建新的 Job 和 Execution Record。
- [ ] 缺失 `requirements.md`、`design.md`、`tasks.md` 的 Feature 显示 blocked，不允许直接执行。
- [ ] `reprioritize` 只改变调度顺序，不修改 Feature 文档内容。

### REQ-080：提供 RPC Adapter 与多 Provider 执行
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` 第 7.7 节；`docs/zh-CN/vscode-app-plan.md` FEAT-018
优先级：Must

WHEN Execution Adapter Layer 消费 `rpc.run` Job 或迁移期兼容的 `codex.rpc.run` Job
THE SYSTEM SHALL 通过 RPC Adapter 连接或启动 active RPC provider；内置 provider 至少包括 `codex-rpc` 和 `gemini-acp`，其中 `codex.rpc.run` 继续作为 Codex RPC 兼容别名，新的远程或进程内执行统一进入 `rpc.run`。

验收：
- [ ] Execution Adapter Layer 是唯一允许调用 `turn/start` 的 SpecDrive 组件。
- [ ] VSCode 插件只能发起受控命令和订阅状态，不能绕过 RPC Adapter 与 app-server 交互。
- [ ] app-server 进程、thread id、turn id、transport、model、cwd 和 output schema 必须记录到 Execution Record。
- [ ] Gemini ACP provider 必须通过 `gemini --acp` stdio JSON-RPC 完成 `initialize`、`newSession` 或 `loadSession`、`prompt`、`cancel`、permission request 和 session update 消费。
- [ ] HTTP/JSON-RPC/WebSocket/ACP 远程或进程内 provider 必须复用同一 RPC Adapter 接口，不得新增 app-server-only 执行模型。
- [ ] app-server 无法启动、未登录或协议不兼容时，Execution Record 标记 failed，并给出可操作错误。

### REQ-081：记录 RPC Execution Projection
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` 第 7.7 至 7.9 节；`docs/zh-CN/vscode-app-plan.md` Interfaces And Contracts
优先级：Must

WHEN RPC provider session、turn 或 prompt 运行、审批或完成
THE SYSTEM SHALL 将 provider session id、threadId、turnId、eventRefs、approvalState、producedArtifacts、summary、error 和 output schema 校验结果统一投影到 Execution Record、raw logs 和 `spec-state.json.lastResult`。

验收：
- [ ] app-server turn/item 事件和 Gemini ACP `session/update`、permission request、prompt response 持续写入 raw logs，并可由 VSCode 状态面板增量查看。
- [ ] `SkillOutputContractV1` 校验通过后，Execution Record 标记 completed，并更新 Feature `spec-state.json`。
- [ ] output schema 校验失败时，Execution Record 标记 failed，保留 raw output 供重试或恢复。
- [ ] Gemini ACP permission pending 投影为 `approval_needed`，不写入 SkillOutputContractV1.status。
- [ ] `SkillOutputContractV1` 的通用机器契约由 CLI/RPC Adapter 调用端定义和校验；所有 Skill 输出必须包含 `summary`、`nextAction`、`producedArtifacts`、Feature 级 `traceability` 和 `result`。
- [ ] `result` 必须是机器可读对象，允许不同 Skill 写入专用执行详情；调用端不得按 `skillSlug` 硬编码专用字段校验。
- [ ] 不新增重型 Execution Result；聊天记录、provider 事件流、raw logs 和 Execution Record 共同构成执行证据。

### REQ-082：支持 VSCode app-server 审批交互
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` 第 7.8 节；`docs/zh-CN/vscode-app-plan.md` FEAT-019
优先级：Must

WHEN Codex RPC 发出 approval request
THE SYSTEM SHALL 将 pending request 写入 Execution Record 并推送给 VSCode 插件，由用户选择 accept、acceptForSession、decline 或 cancel 后再返回 app-server。

验收：
- [ ] approval pending 必须可恢复；VSCode 重载后仍能重新显示待处理审批。
- [ ] 未响应审批不得自动通过。
- [ ] `acceptForSession` 只在当前 app-server thread/session 范围生效。
- [ ] 审批记录作为轻量活动记录和 Execution Record 状态，不进入独立审计中心。

### REQ-083：提供 VSCode Diagnostics 和体验增强
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` REQ-VSC-007；`docs/zh-CN/vscode-app-plan.md` FEAT-020
优先级：Should

WHEN VSCode 插件扫描 Spec 文档或订阅运行状态
THE SYSTEM SHALL 用 Diagnostics、状态过滤、日志增量渲染、diff 摘要、Product Console 跳转和插件重载恢复提升日常 IDE 使用体验。

验收：
- [ ] 缺失 requirement id、缺失 acceptance criteria、缺失三件套时显示 warning。
- [ ] blocked / failed Feature 对应文件或节点显示 problem marker。
- [ ] Diagnostics 必须来自文件扫描、spec-state 或 Control Plane 查询结果。
- [ ] 插件重载后可以恢复 Spec Explorer、Task Queue、pending approval 和最近执行状态。

### REQ-084：提供独立 VSCode Execution Workbench Webview
来源：`docs/zh-CN/vscode-codex-rpc-prd.md` REQ-VSC-017；用户指令“为 VS 插件开发独立的 Web UI，不要复用现在的 Web UI，核心关注任务调度和自动执行”
优先级：Must

WHEN 用户在 VSCode 中打开 SpecDrive 任务执行入口
THE SYSTEM SHALL 展示独立于 Product Console 的 Execution Workbench Webview，用于任务调度和自动执行控制。

WHEN 用户在 VSCode Feature Spec Webview 顶部点击 New Feature 并提交自然语言内容
THE SYSTEM SHALL 将提交内容转换为受控需求输入，由模型判定进入需求新增流程或需求变更流程，并返回可追踪的 command receipt。

WHEN VSCode Feature Spec Webview 刷新 Feature 列表
THE SYSTEM SHALL 同步读取 Feature index 和 `docs/features/*` Feature 文件夹，并在发现 index 漏项时更新 Feature index 或返回明确的同步阻塞原因。

WHEN VSCode Feature Spec Webview 中选中的 Feature 处于 need review / review_needed 状态
THE SYSTEM SHALL 显示与 Product Console 一致的 ReviewItem 审批入口，并通过 Control Plane `approve_review` 受控命令恢复继续执行。

WHEN VSCode Feature Spec Webview 中选中的 Feature 处于 blocked / block 或 need review / review_needed 状态
THE SYSTEM SHALL 隐藏默认 `Pass` 按钮；`mark_feature_complete` 只作为临时状态重置命令保留，用于通过 Control Plane 受控命令将 Feature 状态、Feature `spec-state.json.executionStatus`、当前或最近 `feature_execution` Execution Record 和对应 Scheduler Job 标记为 completed。

验收：
- [ ] Webview 使用独立前端入口、布局、状态模型和组件，不复用 Product Console 的页面、路由、导航、App Shell 或组件实现。
- [ ] 第一屏默认展示 Job 队列、当前运行、下一步动作、阻塞原因、自动执行开关和审批待办。
- [ ] 用户可以从 Webview 发起 enqueue、run now、auto run、pause automation、resume automation、retry、cancel、skip 和 reprioritize。
- [ ] Webview 通过 VSCode extension host 调用 Control Plane query/command API，不直接访问 SQLite、Scheduler 内部队列、`scheduler_job_records`、`execution_records` 或 `spec-state.json`。
- [ ] Webview 可以复用 shared contract、TypeScript 类型和 query/command API，但不得把 Product Console ViewModel 作为插件 UI 的事实源。
- [ ] 顶部 New Feature 以弹出输入框收集自然语言需求，提交后不得由前端硬编码判断新增或变更；必须交给模型按 `requirement-intake-skill` / `spec-evolution-skill` 边界判定。
- [ ] 刷新 Feature Spec 视图时同时扫描 `docs/features/README.md` 和 `docs/features/*` 三件套目录；因需求新增不经过拆分流程导致 index 漏项时，刷新流程必须补齐 Feature index 或报告需要人工处理的冲突。
- [ ] 需求新增 Skill 在创建或更新 Feature Spec 后必须同步 `docs/features/README.md`，写入 Feature ID、名称、Folder、Status、Primary Requirements、Suggested Milestone 和 Dependencies。
- [ ] 用户点击 Feature 后，右侧详情必须解析对应 `tasks.md`，展示任务列表、任务状态、描述和验证命令；缺失或不可解析时展示 blocked reason。
- [ ] need review / review_needed Feature 的 `Review` 操作必须使用 ReviewItem 的 `approve_review` 受控命令，与 Product Console 审批后继续执行的行为保持一致。
- [ ] blocked / block 或 need review / review_needed Feature 的临时 `Pass` 重置命令必须只通过受控命令执行，不得由 VSCode Webview 直接写 `spec-state.json`、`execution_records` 或 `scheduler_job_records`；Webview 默认不展示 `Pass` 按钮。
- [ ] Execution Workbench 必须以摘要优先方式展示结构化 Skill 输出：状态、summary、nextAction、traceability、produced artifacts、常见 result 分组和完整 JSON 审计视图。
- [ ] Execution Workbench 必须把 produced artifacts 展示为可扫描表格，并把 `commands`、`verification`、`decision`、`blockers`、`findings`、`risks`、`coverage`、`openQuestions`、`updatedDocuments` 等常见 result 字段分组展示。
- [ ] 未识别的 result 字段必须保留在 Additional Result JSON 中，不得丢弃。
- [ ] Feature Spec Webview 的 Feature 详情必须把 token / cost 标注为最后一次有效执行费用；Execution Workbench / Execution Workspace 按选中的 Job / Run 展示单次费用，如需总成本则按 Job 历史累计，并保留两位小数四舍五入。
- [ ] Feature Spec Webview 中 Feature 的 Schedule / Run 入口必须依据 Feature 当前状态和执行安全闸启用或阻塞，不得把同一 Feature 的历史多次 Job 记录当作重复执行错误。

### REQ-085：在 VSCode IDE 中管理系统设置
来源：用户指令“vscode ide添加系统设置”
优先级：Must

WHEN 用户在 VSCode 中打开 SpecDrive 系统设置入口
THE SYSTEM SHALL 展示独立 System Settings Webview，用于查看和管理 CLI Adapter 与 RPC Adapter 配置。

验收：
- [ ] VSCode 插件提供 `SpecDrive: Open System Settings` 命令和 Spec Explorer title action。
- [ ] System Settings Webview 展示 CLI Adapter 与 RPC Adapter 的 active、draft、preset、schemaVersion、status、validation errors、last dry-run / last probe。
- [ ] 用户可以在 Webview 中编辑 JSON 配置，并触发 validate、save draft、activate 和 disable。
- [ ] 所有配置修改必须通过 VSCode extension host 调用 Control Plane command API，不得直接写 SQLite、配置文件或运行事实源。
- [ ] VSCode System Settings 与 Product Console System Settings 共享 `cli_adapter_configs`、`rpc_adapter_configs` 和审计事实源，不创建 IDE 专属配置状态。
- [ ] Product Console 与 VSCode System Settings 必须在 CLI / RPC adapter JSON 中展示模型 token 费率摘要；Product Console 表单编辑必须写回对应 adapter 的 `defaults.costRates`，不得创建独立费率事实源。
- [ ] 配置无效或启用失败时，Webview 展示 blocked / validation 反馈，并且不得覆盖现有 active adapter。

### REQ-086：配置项目级与 Job 级执行偏好
来源：用户指令“按照spec流程实现系统级别和任务级别的服务商和run模式（cli，rpc）的设置”；后续澄清“provider 就是对应 Execution Adapter Layer 的 adapter”。
优先级：Must

WHEN 用户在 System Settings 或 Execution Workbench 中选择执行方式
THE SYSTEM SHALL 支持按项目保存系统级默认 provider adapter，并允许新建 Job 时用 Job 级 provider adapter 覆盖项目默认；系统必须由 adapter id 所属配置表推导 `runMode`。

验收：
- [ ] 项目级执行偏好必须保存在 SQLite，包含 adapter id；`runMode` (`cli` / `rpc`) 为由 adapter id 推导的内部调度字段。
- [ ] `cli` provider 必须来自 `cli_adapter_configs.id`，`rpc` provider 必须来自 `rpc_adapter_configs.id`。
- [ ] 新建 Job 的执行偏好优先级必须为 Job payload > 项目默认 > 兼容默认 `cli + active CLI adapter`。
- [ ] `runMode = cli` 必须创建 `cli.run` Job；`runMode = rpc` 必须创建 `rpc.run` Job。
- [ ] adapter id 缺失、不存在、disabled 或 invalid 时，调度必须 blocked，且不得覆盖已有 active adapter；用户界面不得要求单独选择 run mode。
- [ ] Retry 必须继承 previous execution 的 `runMode` 与 adapter id，不因新的项目默认而静默切换。
- [ ] token 成本计算必须沿用同一执行偏好优先级解析出的 adapter；adapter id 不存在或模型费率缺失时仍记录 token 消耗，成本为 0，`pricing_status = missing_rate`。
- [ ] VSCode Execution Workbench 必须在 Enqueue、Run Now、Start Auto Run 前提供 Job 级 provider adapter 选择。
- [ ] VSCode Feature Spec Webview 必须支持多选 Feature；点击 Schedule 时为每个选中的 Feature 创建新 Job，并允许本次调度指定 Job 级 provider adapter。
- [ ] Queue item、Execution detail、审计 payload 和 Execution Record 必须展示或记录最终执行偏好及来源。

## 7. 非功能需求

### NFR-001：默认沙箱优先
来源：PRD 第 9.1 节
优先级：Must

WHERE 开发阶段自动执行任务适用
THE SYSTEM SHALL 默认使用 danger-full-access 和 approval=never，避免编码 CLI 人工确认阻塞开发流。

验收：
- [ ] 默认 Execution Adapter 配置使用最大编码 CLI sandbox 权限且不请求人工确认。
- [ ] 默认 Execution Adapter 配置不得使用 bypass approvals；需要无确认执行时使用 `approval=never`。

### NFR-002：支持回滚
来源：PRD 第 9.1 节；第 9.2 节
优先级：Must

WHEN 自动修改产生不可接受结果
THE SYSTEM SHALL 支持回滚自动修改和失败任务重放。

验收：
- [ ] 高风险或失败修改有可执行回滚路径。

### NFR-003：Run 幂等
来源：PRD 第 9.2 节
优先级：Must

WHEN 相同 Run 或恢复流程被重放
THE SYSTEM SHALL 避免重复产生不可控副作用。

验收：
- [ ] Project Memory 和状态更新支持幂等重放。

### NFR-004：崩溃恢复
来源：PRD 第 9.2 节
优先级：Must

WHEN 调度器或 Execution Adapter 崩溃后恢复
THE SYSTEM SHALL 保留任务、Run、Execution Result 和 Project Memory 状态。

验收：
- [ ] 恢复后任务不会静默丢失。

### NFR-005：审计时间线
来源：PRD 第 9.3 节
优先级：Must

WHEN 任务、Run、审批或状态发生变化
THE SYSTEM SHALL 记录可追踪时间线。

验收：
- [ ] 用户可以查看每次状态变化的时间、原因和来源。

### NFR-006：成本与成功率统计
来源：PRD 第 9.3 节
优先级：Should

WHEN 系统执行 Subagent 或 Execution Adapter 工作
THE SYSTEM SHALL 统计 token、成本、成功率和失败率。

WHEN 同一个 Feature 被多次排队或执行
THE SYSTEM SHALL 保留每次 Job / Execution Record 的 token 与成本记录，并只在 Feature 投影中展示最后一次有效执行的 token 与成本。

验收：
- [ ] Dashboard 或相关控制台可以展示成本与成功率指标。
- [ ] `token_consumption_records.pricing_json` 必须保存 `adapterId`、`adapterKind`、`model`、费率快照或缺失原因；已落库记录不得因 adapter 费率修改被自动重算。
- [ ] `token_consumption_records` 必须按 `run_id` 表示单次执行费用；同一 `feature_id` 的多次执行不得互相覆盖。
- [ ] Feature Spec 页面只展示 Feature 最后一次有效执行的 token / cost；需要统计同一 Feature 多次执行总成本时，必须从 Job / Execution Record 历史累计 `token_consumption_records`。
- [ ] Feature 是否可以再次 queued 或 run 必须依据 Feature 当前状态、依赖、安全闸和 active execution 判断，不得因历史 Job 中存在相同 Feature 的多次执行记录而阻塞。

### NFR-007：看板性能
来源：PRD 第 9.4 节
优先级：Could

WHEN 看板任务数不超过 1000
THE SYSTEM SHALL 记录看板加载耗时，作为后续性能优化基线。

验收：
- [ ] MVP 验收不以 2 秒加载阈值作为阻塞条件。

### NFR-008：状态刷新性能
来源：PRD 第 9.4 节
优先级：Could

WHEN 任务状态变化
THE SYSTEM SHALL 记录任务状态刷新耗时，作为后续性能优化基线。

验收：
- [ ] MVP 验收不以 5 秒刷新阈值作为阻塞条件。

### NFR-009：执行结果记录性能
来源：PRD 第 9.4 节
优先级：Could

WHEN Run 生成 Execution Result
THE SYSTEM SHALL 记录 Execution Result 写入耗时，作为后续性能优化基线。

验收：
- [ ] MVP 验收不以 3 秒写入阈值作为阻塞条件。

### NFR-010：Execution Adapter 心跳
来源：PRD 第 9.4 节
优先级：Should

WHILE Execution Adapter 在线
THE SYSTEM SHALL 每 10 至 30 秒更新心跳状态。

验收：
- [ ] Execution Console 可以展示最近心跳时间。

### NFR-011：只读 Subagent 并发
来源：PRD 第 9.4 节
优先级：Could

WHEN 只读 Subagent 任务可并行
THE SYSTEM SHALL 支持至少 10 个并发只读 Subagent。

验收：
- [ ] 只读并发不会写入共享工作区。

### NFR-012：MVP 自动化成功指标
来源：PRD 第 10 节
优先级：Should

WHEN MVP 运行在目标范围内
THE SYSTEM SHALL 追踪 Feature Spec 自动生成成功率、PR/EARS 拆解准确率、澄清问题有效率、任务图可执行率、低风险任务自动完成率、状态判断准确率、失败恢复率、PR 交付报告生成率和任务可追踪覆盖率。

验收：
- [ ] 系统能报告 PRD 第 10 节列出的 MVP 目标指标。

## 8. 边界场景与错误处理

### EDGE-001：缺少 Git 仓库
来源：PRD 第 6.1 节 FR-002 至 FR-003

WHEN 项目没有可用 Git 仓库
THE SYSTEM SHALL 阻止自动执行，并提示用户连接或修复仓库。

### EDGE-002：需求存在歧义
来源：PRD 第 6.2 节 FR-013；第 6.12 节 FR-100

WHEN 需求、验收标准、技术边界或用户意图不清楚
THE SYSTEM SHALL 进入 clarification_needed，并记录 Clarification Log。

### EDGE-003：Feature Spec 重复
来源：PRD 第 6.2 节；第 6.6 节

WHEN 新 Feature 与现有 Feature 目标和验收范围重复
THE SYSTEM SHALL 提示重复风险，并要求合并、覆盖或保留为独立 Feature。

### EDGE-004：并行写入冲突
来源：PRD 第 6.4 节 FR-032；第 6.8 节 FR-063；第 12 节

WHEN 并行任务写入同一文件、高冲突目录、数据库 schema、锁文件或公共配置
THE SYSTEM SHALL 禁止并行写入或要求独立隔离并进入合并前冲突检测。

### EDGE-005：共享运行时资源污染
来源：PRD 第 6.8 节 FR-063；第 12 节

WHEN 并行任务依赖数据库、缓存、消息队列、搜索索引、外部 API 或文件上传目录
THE SYSTEM SHALL 要求 mock、命名空间隔离、临时容器、独立实例或串行执行。

### EDGE-006：Project Memory 过期
来源：PRD 第 4.4 节；第 6.5 节；第 12 节

WHEN Project Memory 与 Feature Spec Pool、仓库或 Dashboard 状态冲突
THE SYSTEM SHALL 通过代码核查确认真实状态，以仓库代码、Git 状态和文件系统检查结果为准，并修正 Dashboard、Feature Spec Pool 或 Project Memory 的状态漂移。

### EDGE-007：上下文过大
来源：PRD 第 6.2 节 FR-012；第 6.5 节 FR-047；第 12 节

WHEN Spec、执行结果 或 Memory 超过上下文预算
THE SYSTEM SHALL 使用 Spec 切片、执行结果摘要和 Memory 压缩控制上下文大小。

### EDGE-008：Agent 偏离需求
来源：PRD 第 6.10 节 FR-082；第 12 节

WHEN diff、任务或测试证据无法映射到需求和验收标准
THE SYSTEM SHALL 阻止 Done 判定，并进入 Spec Alignment 修复或人工审查流程。

### EDGE-009：执行结果记录失败
来源：PRD 第 4.5 节；第 9.2 节

WHEN Execution Result 写入失败
THE SYSTEM SHALL 将任务标记为 blocked 或 failed，并保留可诊断错误。

### EDGE-010：审批决策缺失
来源：PRD 第 6.12 节 FR-101

WHEN 任务处于 Review Needed 但没有审批决策
THE SYSTEM SHALL 暂停受影响任务，并阻止自动进入 Done 或 Delivered。

### EDGE-011：CLI Adapter 配置无效
来源：PRD 第 6.9 节 FR-073；REQ-065、REQ-066

WHEN active CLI Adapter 配置缺失、JSON Schema 校验失败、命令模板无法 dry-run 或安全策略不满足 Execution Policy
THE SYSTEM SHALL 阻止新 Run 启动，将原因展示到系统设置 CLI 配置页和 Execution Console 状态摘要，并保留上一份可用配置或进入 blocked 状态。

验收：
- [ ] 无效配置不会覆盖正在运行的 Run。
- [ ] 用户可以在系统设置 CLI 配置页看到字段级错误、dry-run 错误和修复后的重新校验结果。
- [ ] Execution Console 可以展示配置阻塞摘要，并提供跳转到系统设置修复的入口。

## 9. 追踪矩阵

| 来源 | 需求 ID | 说明 |
|---|---|---|
| PRD 第 1 节 产品定义 | REQ-004, REQ-005, REQ-030, REQ-037, REQ-052, REQ-061 | 产品定位与核心组件 |
| PRD 第 2.1 节 核心目标 | REQ-004, REQ-016, REQ-029, REQ-030, REQ-036, REQ-040, REQ-052 | 目标转化为系统行为 |
| PRD 第 2.2 节 非目标 | 第 3 节 | MVP 排除范围；VSCode 插件不是完整 IDE，也不复用 Codex VS 插件私有 UI |
| PRD 第 3 节 核心架构 | REQ-018, REQ-031, REQ-040, REQ-043, REQ-048 | 工作流与状态聚合 |
| PRD 第 4.1 节 Spec Protocol | REQ-004, REQ-005, REQ-007, REQ-008, REQ-009, REQ-053 | Spec 作为事实源 |
| PRD 第 4.2 节 Skill System（废弃） | REQ-010, REQ-011, REQ-012, REQ-013, REQ-054 | 已移除的平台 Skill 能力 |
| PRD 第 4.3 节 Subagent Runtime（废弃） | REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-055 | 已移除的平台 Subagent 能力 |
| PRD 第 4.4 节 Project Memory | REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 | CLI 持久记忆 |
| PRD 第 4.5 节 Execution Result | REQ-018, REQ-049, REQ-051 | 状态判断与交付证据 |
| PRD 第 5 节 用户流程 | REQ-029, REQ-030, REQ-033, REQ-034, REQ-040, REQ-046, REQ-059 | 自主执行闭环 |
| PRD 第 6.1 节 项目管理 | REQ-001, REQ-002, REQ-003, REQ-059, REQ-063 | 项目创建、项目切换与健康检查 |
| PRD 第 6.2 节 Spec Protocol Engine | REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009 | Spec 创建与管理 |
| PRD 第 6.3 节 Skill Center（废弃） | REQ-010, REQ-011, REQ-012, REQ-013 | 已移除 |
| PRD 第 6.4 节 Subagent Runtime（废弃） | REQ-014, REQ-015, REQ-017, REQ-018 | 已移除；并行写入由 Workspace/State 约束 |
| PRD 第 6.5 节 Project Memory | REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 | Memory 初始化到版本化 |
| PRD 第 6.6 节 Feature 流水线与选择 | REQ-028, REQ-029, REQ-030, REQ-031, REQ-032 | Feature 生命周期 |
| PRD 第 6.7 节 任务图与看板 | REQ-024, REQ-025, REQ-026, REQ-027 | 任务图与看板行为 |
| PRD 第 6.8 节 Scheduler | REQ-033, REQ-034, REQ-035, REQ-036, REQ-060 | 调度与恢复 |
| PRD 第 6.9 节 Execution Adapter Layer | REQ-037, REQ-038, REQ-039, REQ-065, REQ-066, REQ-068, REQ-080, REQ-081, REQ-082 | Execution Adapter 执行、CLI Adapter、Codex RPC Adapter、JSON 配置、workspace-aware Skill invocation 与安全策略 |
| PRD 第 6.10 节 状态检测 | REQ-040, REQ-041, REQ-042 | 验证与状态判断 |
| PRD 第 6.11 节 自动恢复 | REQ-043, REQ-044, REQ-045 | 失败恢复 |
| PRD 第 6.12 节 审批中心 | REQ-046, REQ-047, REQ-057 | 审批触发与处理 |
| PRD 第 6.13 节 PR 与交付 | REQ-048, REQ-049, REQ-050 | 交付生命周期 |
| PRD 第 7 节 核心数据模型 | REQ-001, REQ-004, REQ-024, REQ-051, REQ-058 | 数据模型覆盖范围 |
| PRD 第 8 节 页面需求 | REQ-052, REQ-053, REQ-054, REQ-055, REQ-056, REQ-057, REQ-061, REQ-062, REQ-063, REQ-066, REQ-067, REQ-068 | Product Console UI 表面需求与受控 CLI Skill 调用反馈 |
| PRD 第 8.11 节 VSCode IDE | REQ-074, REQ-075, REQ-076, REQ-077, REQ-078, REQ-079, REQ-080, REQ-081, REQ-082, REQ-083, REQ-084, REQ-085 | VSCode 工作区识别、Spec Explorer、文档交互、Task Queue、独立 Execution Workbench Webview、Codex RPC Adapter、审批、Diagnostics 和系统设置 |
| PRD 第 9 节 非功能需求 | NFR-001 至 NFR-011 | 安全、稳定、可观测性、性能 |
| PRD 第 10 节 成功指标 | NFR-012 | MVP 成功指标 |
| PRD 第 11 节 MVP 版本规划 | 第 10 节 | 发布顺序参考 |
| PRD 第 12 节 关键风险与对策 | EDGE-004 至 EDGE-008 | 风险驱动边界场景 |

## 10. MVP 版本映射

| 里程碑 | 需求 ID |
|---|---|
| M1：Spec Protocol + Skill 基础 | REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012, REQ-013, REQ-058, REQ-059, REQ-063 |
| M2：Plan + Task Graph + Feature 选择器 | REQ-024, REQ-025, REQ-026, REQ-027, REQ-028, REQ-029, REQ-030, REQ-031, REQ-060 |
| M3：Subagent Runtime + Project Memory | REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 |
| M4：Execution Adapter Layer | REQ-035, REQ-037, REQ-038, REQ-039, REQ-065, REQ-066, REQ-068 |
| M5：状态检测与恢复 | REQ-040, REQ-041, REQ-042, REQ-043, REQ-044, REQ-045 |
| M6：审批与交付 | REQ-046, REQ-047, REQ-048, REQ-049, REQ-050, REQ-057 |
| M7：Product Console | REQ-052, REQ-053, REQ-054, REQ-055, REQ-056, REQ-061, REQ-062, REQ-063, REQ-066, REQ-067, REQ-068 |
| M8：SpecDrive IDE | REQ-074, REQ-075, REQ-076, REQ-077, REQ-078, REQ-079, REQ-080, REQ-081, REQ-082, REQ-083, REQ-084, REQ-085 |

## 11. 待确认问题

- Review Center 中“大 diff”的默认阈值是什么？
- 哪些风险等级和风险规则必须触发人工审批？
