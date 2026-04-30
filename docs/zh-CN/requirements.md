# 需求：SpecDrive AutoBuild

## 1. 背景

SpecDrive AutoBuild 是一个以 Spec、Scheduler、Project Memory、Codex Runner 外部运行观测和内部任务状态机驱动，并通过 Dashboard 呈现状态的长时间自主编程系统。它的目标不是让 AI 一次性生成代码，而是让 AI 在可控、可恢复、可审计的工程流程中持续交付代码。

2026-04-29 边界更新：平台能力收缩为项目/Feature/Task 的调度、状态机、状态聚合、审计和 Console 状态展示。平台不再提供 Skill 注册/发现/调用/schema 校验/Skill Center，不再提供 Subagent Runtime/Context Broker/Agent Run Contract/Subagent Console，不再提供 Planning Pipeline 主动编排执行。REQ-010 至 REQ-016、REQ-018、REQ-030、REQ-054 和 REQ-055 均按“已废弃”处理；REQ-043 改为平台中性的 Recovery Dispatch 输入。

## 2. 目标

- 将自然语言、PR、RP、PRD 或 EARS 输入转化为结构化 Feature Spec。
- 基于优先级、依赖、风险和就绪状态自动选择下一个可执行 Feature。
- 自动维护 Feature 从需求到任务图、看板、调度、检测、恢复、审批和交付的状态。
- 将大任务拆分为边界明确、可审计、可调度的任务。
- 为 Codex CLI 会话提供跨会话 Project Memory，避免重复探索和上下文丢失。
- 通过 Evidence Pack、Status Checker 和 Review Center 支持状态判断、失败恢复和人工审批。
- 生成 PR、交付报告和 Spec Evolution 建议，形成可追踪交付闭环。

## 3. 非目标

- MVP 不自研大模型。
- MVP 不自研完整 IDE。
- MVP 不实现企业级复杂权限矩阵。
- MVP 不自动发布到生产环境。
- MVP 不处理多大型仓库复杂微服务自动迁移。
- MVP 不完整替代 Jira、GitHub Issues 或 Linear。
- MVP 不接入 Issue Tracker，仅保留外部链接和追踪字段。
- MVP 不以看板加载、状态刷新和 Evidence 写入性能阈值作为验收门槛。

## 4. 角色

- 用户：输入需求、创建项目、查看进度和交付结果。
- 产品经理：管理产品目标、Feature Spec、验收标准和优先级。
- 开发者：审查任务、代码变更、测试结果、风险和 PR。
- 团队负责人：查看项目健康度、交付进度、审计日志和风险状态。
- 审批人：处理高风险操作、权限提升、需求澄清和失败恢复建议。
- 系统调度器：选择 Feature、调度任务、维护状态机并触发后续流程。
- Codex Runner：执行代码修改、测试、修复和结构化结果输出。

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
- [ ] 已连接仓库可以被后续计划、调度和 Runner 流程使用。
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
THE SYSTEM SHALL 只校验平台 Evidence、Status Check 和 Recovery Dispatch 输入，不校验 Skill schema。

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

WHEN Runner 或外部执行器启动
THE SYSTEM SHALL 不生成 Agent Run Contract；边界由任务、Runner policy、worktree 和 status check 记录表达。

验收：
- [ ] 审计可从任务、Runner policy、Evidence、Status Check 和状态转换中追踪。

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
THE SYSTEM SHALL 通过 Evidence、Status Check、Review、Recovery 和 Feature Aggregator 判断下一步状态。

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

WHEN Codex CLI 会话启动前
THE SYSTEM SHALL 将 Project Memory 内容作为 `[PROJECT MEMORY]` 上下文块注入。

验收：
- [ ] CLI 会话可以从 Project Memory 恢复当前任务、看板状态、上次 Run、阻塞、禁止操作和待审批事项。

### REQ-021：更新 Project Memory
来源：PRD 第 6.5 节 FR-046
优先级：Must

WHEN Run 结束
THE SYSTEM SHALL 根据 Evidence Pack 和 Status Checker 结果幂等更新 Project Memory。

验收：
- [ ] Project Memory 更新已完成任务、任务状态快照、当前 Run 状态、决策、阻塞和失败模式。

### REQ-022：控制 Project Memory 大小
来源：PRD 第 6.5 节 FR-047
优先级：Must

WHEN Project Memory 超过默认 8000 tokens 预算
THE SYSTEM SHALL 压缩旧 Evidence Pack 摘要、历史决策和已完成任务列表，同时保留当前任务、当前状态快照、当前阻塞和禁止操作。

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
THE SYSTEM SHALL 在任务卡片展示标题、Feature、User Story、状态、依赖、计划时间、最近 Runner、Evidence Pack、测试状态、diff 摘要、风险等级和审批状态。

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
THE SYSTEM SHALL 从 Feature Spec Pool 动态读取 ready Feature，并按内置固定规则基于优先级、依赖完成、验收风险和 ready 时长选择下一个 Feature。

验收：
- [ ] Feature 选择结果、候选摘要和选择原因写入 Project Memory。
- [ ] MVP 不提供优先级评分、风险评分或人工覆盖规则的配置入口。

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
THE SYSTEM SHALL 根据优先级、依赖完成情况、验收风险、就绪状态、人工覆盖和 Spec 变更选择并推进 Feature。

验收：
- [ ] Project Scheduler 不依赖 Project Memory 中的静态候选队列作为真实调度来源。
- [ ] 人工覆盖规则在 MVP 中使用内置固定逻辑，不要求用户配置。
- [ ] `schedule_run` 只入队 `feature.select` job 并返回 `scheduleTriggerId` 与 `schedulerJobId`；`selectionDecisionId` 只能由 Worker 执行后产生。
- [ ] `feature.select` Worker 从 SQLite live Feature Pool 读取 `ready` Feature、依赖、优先级、风险和 readySince，并写入 `feature_selection_decisions`。
- [ ] 选中合法 Feature 后必须执行 `ready -> planning` 状态迁移，并入队 `feature.plan`。
- [ ] 调度触发来源、触发时间、触发原因、BullMQ job id 和调度结果被记录到 SQLite 审计/调度记录；Project Memory 只保存投影摘要。
- [ ] 当 planning Skill bridge 未实现或项目 workspace 不可用时，`feature.plan` 必须把 Feature 标记为 blocked，原因固定为 `Planning skill execution bridge is not implemented` 或 workspace 阻塞原因；bridge 可用时只入队 planning CLI run，不得生成假任务图或伪造 Skill 输出。

### REQ-034：运行 Feature Scheduler
来源：PRD 第 6.8 节 FR-061 至 FR-062
优先级：Must

WHEN Feature 内部调度触发
THE SYSTEM SHALL 根据任务依赖、风险、文件范围、Runner 可用性、worktree 状态、成本预算、执行窗口和审批要求推进任务。

验收：
- [ ] Feature Scheduler 只调度依赖已满足且边界允许的任务。
- [ ] `schedule_board_tasks` 只做合法的 `ready -> scheduled` 状态迁移和审计，不直接执行 CLI。
- [ ] `run_board_tasks` 只为已排期任务创建 Run 并入队 `cli.run`，CLI 执行必须由 Runner Worker 完成。

### REQ-035：记录 worktree 隔离状态
来源：PRD 第 6.8 节 FR-063
优先级：Must

WHEN 系统创建或使用 worktree
THE SYSTEM SHALL 记录 worktree 路径、分支名、base commit、目标分支、关联 Feature/Task、Runner 和清理状态。

验收：
- [ ] 合并前执行冲突检测、Spec Alignment Check 和必要测试。
- [ ] 集成测试和端到端测试不得默认共享同一可变本地数据库或缓存实例；测试环境标识、连接串、容器名和清理策略写入 Run Contract 和 Evidence Pack。

### REQ-036：支持长时间恢复
来源：PRD 第 2.1 节目标 11；第 6.8 节 FR-064
优先级：Must

WHEN 系统重启或 Runner 恢复
THE SYSTEM SHALL 恢复未完成 Run、Running 任务、Scheduled 任务、Runner 心跳、Git worktree 状态、Codex session、最近 Evidence Pack 和 Project Memory。

验收：
- [ ] 重启后系统能继续未完成流程或明确标记阻塞原因。

### REQ-037：执行 Codex CLI Run
来源：PRD 第 6.9 节 FR-070
优先级：Must

WHEN 任务需要代码修改、测试或修复
THE SYSTEM SHALL 通过 Runner CLI Adapter 在目标项目 workspace 中调用 Codex CLI，并要求输出符合 Evidence schema。

验收：
- [ ] Codex Runner 产出结构化 Evidence Pack。
- [ ] Codex CLI 进程的 workspace root 来自当前项目 repository `local_path` 或 `target_repo_path`，不得使用 SpecDrive Control Plane 进程目录作为兜底。

### REQ-038：应用 Codex Runner 安全配置
来源：PRD 第 6.9 节 FR-071 至 FR-072
优先级：Must

WHEN Codex Runner 启动
THE SYSTEM SHALL 根据任务风险设置 sandbox mode、approval policy、model、profile、output schema、JSON event stream、workspace root 和 session resume。

验收：
- [ ] 高风险任务不得自动以高权限写入模式执行。

### REQ-039：执行 Runner 安全策略
来源：PRD 第 6.9 节 FR-071 至 FR-072；第 9.1 节
优先级：Must

WHEN 任务涉及高风险文件、危险命令、敏感配置或权限提升
THE SYSTEM SHALL 阻止自动执行或路由到人工审批。

验收：
- [ ] 认证、权限、支付、迁移、密钥和 forbidden files 修改会触发安全规则。

### REQ-065：管理 Runner CLI Adapter
来源：PRD 第 6.9 节 FR-070、FR-073；用户输入“优化cli调用，升级为adapter”
优先级：Must

WHEN Runner 需要启动外部 CLI 执行任务
THE SYSTEM SHALL 通过 active CLI Adapter 解析 executable、argument template、workspace root、session resume、output mode、Evidence 映射和安全能力，不得在调度器或状态机中硬编码 Codex 命令细节。

验收：
- [ ] 默认 `codex-cli` adapter 能生成与现有 Codex 执行等价的命令。
- [ ] Runner Policy 解析结果与 adapter 配置合并后仍保留 sandbox、approval、model、profile、output schema 和 workspace root 约束。
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
- [ ] Runner Console 只展示 CLI Adapter 状态摘要和跳转入口，不直接编辑 CLI 配置。
- [ ] 系统设置页面遵循当前项目上下文、语言切换、加载态、空态、错误态和受控命令反馈规则。

### REQ-068：将 UI / Spec 操作转换为 CLI Skill Invocation
来源：PRD 第 6.9 节 FR-070；用户输入“完善 CLI 调用实现”“Spec/UI 操作转换成 skill 调用完整流程”“Codex 支持 workspace，需要传入项目路径”
优先级：Must

WHEN 用户在 Product Console 或 Spec Workspace 发起需求录入、规划、任务拆分、状态调度或任务运行操作
THE SYSTEM SHALL 将受控命令转换为 CLI skill invocation contract，并通过 active CLI Adapter 在当前项目 workspace 中执行对应 CLI Skill prompt。

验收：
- [ ] invocation contract 至少包含 `projectId`、`workspaceRoot`、`skillSlug`、`sourcePaths`、`expectedArtifacts`、`traceability` 和 `requestedAction`。
- [ ] Stage 2 需求录入操作映射到需求扫描、需求拆解、需求新增或质量检查相关 Skill；Stage 3 planning 操作映射到 planning Skill pipeline；Task Board 运行操作映射到 `codex-coding-skill`。
- [ ] 平台只持久化 Run、scheduler job、Evidence、Status、Review 和 Audit，不恢复平台级 Skill Registry、Skill Center、Skill schema 校验或 SkillRun 表。
- [ ] Runner Console 和 Spec Workspace 能展示 scheduler job、run id、workspace、skill phase、blocked reason 和最近 Evidence。

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
- [ ] 每次恢复动作都有 Evidence Pack 和下一步建议。

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

WHEN 任务修改高风险区域、diff 超阈值、修改 forbidden files、多次失败、测试未通过但建议继续、需求存在高影响歧义、需要提升权限、变更 constitution 或变更架构方案
THE SYSTEM SHALL 将任务路由到 Review Needed。

验收：
- [ ] Review Needed 必须包含具体触发原因和推荐动作。

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

### REQ-051：捕获 Evidence Pack
来源：PRD 第 4.5 节；第 7 节 EvidencePack
优先级：Must

WHEN Subagent Run 结束
THE SYSTEM SHALL 生成结构化 Evidence Pack，包含 run_id、agent_type、task_id、status、summary、执行证据和推荐动作。

验收：
- [ ] Evidence Pack 可被 Status Checker、Review Center、Recovery Agent 和交付报告复用。

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

### REQ-056：提供 Runner Console
来源：PRD 第 8.6 节
优先级：Should

WHEN 用户打开 Runner Console
THE SYSTEM SHALL 展示 Runner 在线状态、Codex 版本、当前 sandbox、approval policy、queue、最近日志和心跳状态，并支持暂停或恢复 Runner。

验收：
- [ ] 用户可以判断 Runner 是否可执行新任务。

### REQ-057：提供 Review Center
来源：PRD 第 8.7 节
优先级：Must

WHEN 用户打开 Review Center
THE SYSTEM SHALL 展示待审批列表、风险筛选、diff、Evidence、审批操作、项目规则写入和 Spec Evolution 写入入口。

验收：
- [ ] 高风险、阻塞或需澄清任务能从 Review Center 被处理。

### REQ-058：持久化 MVP 核心实体
来源：PRD 第 7 节核心数据模型；问题澄清
优先级：Must

WHEN MVP 创建或更新 Project、Feature、Requirement、Task、Run、ProjectMemory 或 EvidencePack
THE SYSTEM SHALL 将该实体的必填字段全部持久化。

验收：
- [ ] Project、Feature、Requirement、Task、Run、ProjectMemory 和 EvidencePack 的必填字段可以从持久层完整读取并用于状态恢复。

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
- [ ] 系统不得翻译 Evidence、diff、日志、文件路径、命令输出或用户输入内容等事实数据。
- [ ] 浏览器级 UI 验证覆盖默认中文和至少一次语言切换。

### REQ-063：支持多项目创建与切换
来源：用户指令：支持项目创建，支持多个项目切换；PRD 第 6.1 节 FR-001；PRD 第 8.1 节
优先级：Must

WHEN 用户在 Product Console 创建、导入、查看或切换 AutoBuild 项目
THE SYSTEM SHALL 维护项目目录和当前项目上下文，并自动完成项目记录、仓库探测或连接、`.autobuild/` / Spec Protocol、项目宪章、Project Memory、健康检查和当前项目上下文初始化，确保所有项目级查询、受控命令、Project Memory 投影、调度入口、审计事件和反馈提示都绑定到当前项目；Spec 流程产生的扫描、上传、生成、调度、状态检查和 Evidence / Memory 写入必须以当前项目目录作为根目录，不得退回到 AutoBuild 自身运行目录。

验收：
- [ ] 用户可以通过项目创建表单创建新项目，新项目目录必须位于统一 `workspace/` 目录下。
- [ ] 用户可以导入现有项目目录，系统将该目录作为项目目录并自动执行仓库探测、Spec Protocol 初始化、项目宪章导入或默认创建、Project Memory 初始化和健康检查。
- [ ] 用户可以创建或导入多个项目，并在项目列表中看到每个项目的名称、项目目录、仓库摘要、健康状态和最近活动时间。
- [ ] 用户切换项目后，Dashboard、Spec Workspace、Runner Console、Review Center 和 Board 都只展示当前项目的数据。
- [ ] 项目级受控命令必须携带当前 `project_id`；缺少或不匹配时不得执行，并返回可观察的阻塞原因。
- [ ] Spec 流程所有文件读写、命令执行和证据路径解析必须使用当前项目目录或其 `.autobuild/`，不得使用 Product Console / AutoBuild 进程的运行目录作为兜底。
- [ ] 普通查询接口只能读取项目状态、ViewModel、schema 或只读预览；项目初始化、调度、执行、配置生效、审批、规则写入和 Evidence / Project Memory 写入必须通过受控命令并写审计。
- [ ] Project Memory 注入、Feature 选择、调度运行和 Evidence 查询不得跨项目复用状态。
- [ ] 阶段 1 自动初始化失败时，系统返回具体阻塞原因，不要求用户在 Product Console 中逐步手动执行初始化子步骤。

### REQ-064：自动扫描 Spec Sources
来源：用户指令：阶段 2 自动扫描 PRD、EARS、HLD、Feature Spec 等；用户指令：阶段 2 将 Spec 扫描和上传合成一个步骤并显示“扫描”“上传”两个按钮；PRD 第 5 节阶段 2；PRD 第 6.2 节 FR-011
优先级：Must

WHEN 项目完成阶段 1 初始化并进入需求录入
THE SYSTEM SHALL 自动扫描当前项目中的 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引等 Spec Sources，识别已有需求格式、规格产物、来源追踪、缺失项和冲突，并将扫描结果提供给 EARS / Feature Spec 生成、澄清和需求质量检查。

验收：
- [ ] 阶段 2 扫描结果包含已发现的 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引路径及其类型。
- [ ] Spec Workspace 阶段 2 必须将 Spec Sources 扫描和 Spec 上传显示为同一个阶段内步骤，并在该步骤内提供“扫描”和“上传”两个按钮，不得拆成两个独立步骤。
- [ ] 系统能区分“扫描已有 HLD / Feature Spec 事实源”和“生成 HLD / 拆分 Feature Spec”两个边界；阶段 2 不得触发 HLD 生成、Feature Spec 拆分或规划流水线。
- [ ] 扫描结果必须标记已有需求、设计和 Feature Spec 的来源追踪关系、缺失项、冲突项和需要澄清的问题。
- [ ] Spec Workspace 必须展示 Spec Sources 自动扫描状态，并在扫描失败或缺少关键来源时给出阻塞原因。

## 7. 非功能需求

### NFR-001：默认沙箱优先
来源：PRD 第 9.1 节
优先级：Must

WHERE 自动执行任务适用
THE SYSTEM SHALL 默认禁止 danger-full-access 和 bypass approvals。

验收：
- [ ] 默认 Runner 配置不使用危险权限。

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

WHEN 调度器或 Runner 崩溃后恢复
THE SYSTEM SHALL 保留任务、Run、Evidence Pack 和 Project Memory 状态。

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

WHEN 系统执行 Subagent 或 Runner 工作
THE SYSTEM SHALL 统计 token、成本、成功率和失败率。

验收：
- [ ] Dashboard 或相关控制台可以展示成本与成功率指标。

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

### NFR-009：Evidence 写入性能
来源：PRD 第 9.4 节
优先级：Could

WHEN Run 生成 Evidence Pack
THE SYSTEM SHALL 记录 Evidence Pack 写入耗时，作为后续性能优化基线。

验收：
- [ ] MVP 验收不以 3 秒写入阈值作为阻塞条件。

### NFR-010：Runner 心跳
来源：PRD 第 9.4 节
优先级：Should

WHILE Runner 在线
THE SYSTEM SHALL 每 10 至 30 秒更新心跳状态。

验收：
- [ ] Runner Console 可以展示最近心跳时间。

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

WHEN Spec、Evidence 或 Memory 超过上下文预算
THE SYSTEM SHALL 使用 Spec 切片、Evidence 摘要和 Memory 压缩控制上下文大小。

### EDGE-008：Agent 偏离需求
来源：PRD 第 6.10 节 FR-082；第 12 节

WHEN diff、任务或测试证据无法映射到需求和验收标准
THE SYSTEM SHALL 阻止 Done 判定，并进入 Spec Alignment 修复或人工审查流程。

### EDGE-009：Evidence 写入失败
来源：PRD 第 4.5 节；第 9.2 节

WHEN Evidence Pack 写入失败
THE SYSTEM SHALL 将任务标记为 blocked 或 failed，并保留可诊断错误。

### EDGE-010：审批决策缺失
来源：PRD 第 6.12 节 FR-101

WHEN 任务处于 Review Needed 但没有审批决策
THE SYSTEM SHALL 暂停受影响任务，并阻止自动进入 Done 或 Delivered。

### EDGE-011：CLI Adapter 配置无效
来源：PRD 第 6.9 节 FR-073；REQ-065、REQ-066

WHEN active CLI Adapter 配置缺失、JSON Schema 校验失败、命令模板无法 dry-run 或安全策略不满足 Runner Policy
THE SYSTEM SHALL 阻止新 Run 启动，将原因展示到系统设置 CLI 配置页和 Runner Console 状态摘要，并保留上一份可用配置或进入 blocked 状态。

验收：
- [ ] 无效配置不会覆盖正在运行的 Run。
- [ ] 用户可以在系统设置 CLI 配置页看到字段级错误、dry-run 错误和修复后的重新校验结果。
- [ ] Runner Console 可以展示配置阻塞摘要，并提供跳转到系统设置修复的入口。

## 9. 追踪矩阵

| 来源 | 需求 ID | 说明 |
|---|---|---|
| PRD 第 1 节 产品定义 | REQ-004, REQ-005, REQ-030, REQ-037, REQ-052, REQ-061 | 产品定位与核心组件 |
| PRD 第 2.1 节 核心目标 | REQ-004, REQ-016, REQ-029, REQ-030, REQ-036, REQ-040, REQ-052 | 目标转化为系统行为 |
| PRD 第 2.2 节 非目标 | 第 3 节 | MVP 排除范围 |
| PRD 第 3 节 核心架构 | REQ-018, REQ-031, REQ-040, REQ-043, REQ-048 | 工作流与状态聚合 |
| PRD 第 4.1 节 Spec Protocol | REQ-004, REQ-005, REQ-007, REQ-008, REQ-009, REQ-053 | Spec 作为事实源 |
| PRD 第 4.2 节 Skill System（废弃） | REQ-010, REQ-011, REQ-012, REQ-013, REQ-054 | 已移除的平台 Skill 能力 |
| PRD 第 4.3 节 Subagent Runtime（废弃） | REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-055 | 已移除的平台 Subagent 能力 |
| PRD 第 4.4 节 Project Memory | REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 | CLI 持久记忆 |
| PRD 第 4.5 节 Evidence Pack | REQ-018, REQ-049, REQ-051 | 状态判断与交付证据 |
| PRD 第 5 节 用户流程 | REQ-029, REQ-030, REQ-033, REQ-034, REQ-040, REQ-046, REQ-059 | 自主执行闭环 |
| PRD 第 6.1 节 项目管理 | REQ-001, REQ-002, REQ-003, REQ-059, REQ-063 | 项目创建、项目切换与健康检查 |
| PRD 第 6.2 节 Spec Protocol Engine | REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009 | Spec 创建与管理 |
| PRD 第 6.3 节 Skill Center（废弃） | REQ-010, REQ-011, REQ-012, REQ-013 | 已移除 |
| PRD 第 6.4 节 Subagent Runtime（废弃） | REQ-014, REQ-015, REQ-017, REQ-018 | 已移除；并行写入由 Workspace/State 约束 |
| PRD 第 6.5 节 Project Memory | REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 | Memory 初始化到版本化 |
| PRD 第 6.6 节 Feature 流水线与选择 | REQ-028, REQ-029, REQ-030, REQ-031, REQ-032 | Feature 生命周期 |
| PRD 第 6.7 节 任务图与看板 | REQ-024, REQ-025, REQ-026, REQ-027 | 任务图与看板行为 |
| PRD 第 6.8 节 Scheduler | REQ-033, REQ-034, REQ-035, REQ-036, REQ-060 | 调度与恢复 |
| PRD 第 6.9 节 Codex Runner | REQ-037, REQ-038, REQ-039, REQ-065, REQ-066, REQ-068 | Runner 执行、CLI Adapter、JSON 配置、workspace-aware Skill invocation 与安全策略 |
| PRD 第 6.10 节 状态检测 | REQ-040, REQ-041, REQ-042 | 验证与状态判断 |
| PRD 第 6.11 节 自动恢复 | REQ-043, REQ-044, REQ-045 | 失败恢复 |
| PRD 第 6.12 节 审批中心 | REQ-046, REQ-047, REQ-057 | 审批触发与处理 |
| PRD 第 6.13 节 PR 与交付 | REQ-048, REQ-049, REQ-050 | 交付生命周期 |
| PRD 第 7 节 核心数据模型 | REQ-001, REQ-004, REQ-024, REQ-051, REQ-058 | 数据模型覆盖范围 |
| PRD 第 8 节 页面需求 | REQ-052, REQ-053, REQ-054, REQ-055, REQ-056, REQ-057, REQ-061, REQ-062, REQ-063, REQ-066, REQ-067, REQ-068 | UI 表面需求与受控 CLI Skill 调用反馈 |
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
| M4：Codex Runner | REQ-035, REQ-037, REQ-038, REQ-039, REQ-065, REQ-066, REQ-068 |
| M5：状态检测与恢复 | REQ-040, REQ-041, REQ-042, REQ-043, REQ-044, REQ-045 |
| M6：审批与交付 | REQ-046, REQ-047, REQ-048, REQ-049, REQ-050, REQ-057 |
| M7：Product Console | REQ-052, REQ-053, REQ-054, REQ-055, REQ-056, REQ-061, REQ-062, REQ-063, REQ-066, REQ-067, REQ-068 |

## 11. 待确认问题

- Review Center 中“大 diff”的默认阈值是什么？
- 哪些风险等级和风险规则必须触发人工审批？
