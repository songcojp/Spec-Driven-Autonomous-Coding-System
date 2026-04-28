# 需求：SpecDrive AutoBuild

## 1. 背景

SpecDrive AutoBuild 是一个以 Spec、Skill、Subagent、Project Memory、Codex Runner 和 Dashboard State Machine 驱动的长时间自主编程系统。它的目标不是让 AI 一次性生成代码，而是让 AI 在可控、可恢复、可审计的工程流程中持续交付代码。

## 2. 目标

- 将自然语言、PR、RP、PRD 或 EARS 输入转化为结构化 Feature Spec。
- 基于优先级、依赖、风险和就绪状态自动选择下一个可执行 Feature。
- 自动驱动 Feature 从需求到计划、任务图、看板、执行、检测、恢复、审批和交付。
- 将大任务拆分为上下文隔离、边界明确、可审计的 Subagent Run。
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
- Subagent：在受限上下文中执行需求、设计、编码、测试、审查或恢复任务。
- Codex Runner：执行代码修改、测试、修复和结构化结果输出。

## 5. 用户故事

- 作为用户，我希望提交自然语言需求，以便系统生成结构化 Feature Spec。
- 作为产品经理，我希望系统把 PRD 拆解为可测试需求和验收标准，以便客观判断交付结果。
- 作为开发者，我希望系统把 Feature 拆成边界明确的任务，以便自主编码过程可审查、可恢复。
- 作为开发者，我希望 Subagent 只读取必要上下文，以便并行执行时减少上下文污染和越界修改。
- 作为团队负责人，我希望通过 Dashboard 和审计日志查看进度、失败和交付证据，以便掌握项目状态。
- 作为审批人，我希望高风险或失败任务自动进入 Review Center，以便不安全工作不会自动合并。

## 6. 功能需求

### REQ-001：创建 AutoBuild 项目
来源：PRD 第 6.1 节 FR-001
优先级：Must

WHEN 用户开始创建 AutoBuild 项目
THE SYSTEM SHALL 创建项目记录，并保存项目名称、产品目标、项目类型、技术偏好、目标仓库、默认分支、运行环境和自动化开关。

验收：
- [ ] 新项目创建后可以被查询，并包含项目身份、初始配置和初始状态。

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

### REQ-010：注册 Skill
来源：PRD 第 4.2 节；第 6.3 节 FR-020
优先级：Must

WHEN 用户或系统注册 Skill
THE SYSTEM SHALL 保存 Skill 的名称、描述、触发条件、输入输出 schema、允许上下文、所需工具、风险等级、适用阶段、成功标准和失败处理规则。

验收：
- [ ] 已注册 Skill 能被 Orchestrator 查询和匹配。

### REQ-011：提供 MVP 内置 Skill
来源：PRD 第 6.3 节 FR-021
优先级：Must

WHEN 系统初始化 MVP Skill Center
THE SYSTEM SHALL 以 PRD 第 6.3 节 FR-021 作为唯一事实源，提供 `project-constitution-skill`、`requirement-intake-skill`、`pr-ears-requirement-decomposition-skill`、`ambiguity-clarification-skill`、`requirements-checklist-skill`、`technical-context-skill`、`research-decision-skill`、`architecture-plan-skill`、`data-model-skill`、`contract-design-skill`、`quickstart-validation-skill`、`task-slicing-skill`、`spec-consistency-analysis-skill`、`repo-probe-skill`、`codex-coding-skill`、`test-execution-skill`、`failure-recovery-skill`、`review-report-skill`、`pr-generation-skill`、`spec-evolution-skill` 和 `workflow-hook-skill`。

验收：
- [ ] MVP Skill 列表、触发条件和 schema 与 PRD 第 6.3 节一致；新增、删除或重命名内置 Skill 前必须先更新 PRD 第 6.3 节。

### REQ-012：校验 Skill 输入输出 Schema
来源：PRD 第 6.3 节 FR-022
优先级：Must

WHEN Orchestrator 执行 Skill
THE SYSTEM SHALL 在执行前校验输入 schema，并在返回后校验输出 schema。

验收：
- [ ] schema 校验失败时不得进入下一阶段，并生成 Evidence Pack 进入 review_needed 或失败恢复流程。

### REQ-013：管理 Skill 版本
来源：PRD 第 6.3 节 FR-023
优先级：Should

WHEN Skill 发生变更或需要项目级覆盖
THE SYSTEM SHALL 支持版本号、变更记录、启用/禁用、项目级覆盖、团队级共享和版本回滚。

验收：
- [ ] 用户可以查看 Skill 版本历史并回滚到可用版本。

### REQ-014：定义 Subagent 类型
来源：PRD 第 6.4 节 FR-030
优先级：Must

WHEN 系统创建 Subagent Run
THE SYSTEM SHALL 按职责选择 Spec、Clarification、Repo Probe、Architecture、Task、Coding、Test、Review、Recovery 或 State Agent 类型。

验收：
- [ ] 每个 Run 都有明确 agent_type，并与任务责任匹配。

### REQ-015：创建 Agent Run Contract
来源：PRD 第 4.3 节；第 6.4 节 FR-031
优先级：Must

WHEN Subagent 启动
THE SYSTEM SHALL 生成 Agent Run Contract，声明 run_id、agent_type、task_id、目标、允许文件、只读文件、禁止动作、验收标准和输出 schema。

验收：
- [ ] Subagent 的执行边界可以从 Agent Run Contract 中被审计。

### REQ-016：限制 Subagent 上下文
来源：PRD 第 2.1 节目标 6；第 4.3 节
优先级：Must

WHEN 系统准备 Subagent 上下文
THE SYSTEM SHALL 只提供完成当前任务所需的上下文切片。

验收：
- [ ] Subagent 不会默认继承完整主上下文。

### REQ-017：隔离并行写入
来源：PRD 第 6.4 节 FR-032；第 6.8 节 FR-063
优先级：Must

WHEN 多个写入型任务并行执行
THE SYSTEM SHALL 为每个并行 Feature、任务或任务组创建独立 Git worktree 和隔离分支。

验收：
- [ ] 任意并行写入都能追踪到独立 worktree、分支、任务标识和合并目标。

### REQ-018：合并 Subagent 结果
来源：PRD 第 6.4 节 FR-033
优先级：Must

WHEN Subagent Run 完成
THE SYSTEM SHALL 通过 Result Merger 去重、检测冲突、合并风险、评估可信度、生成下一步动作并更新看板状态。

验收：
- [ ] 看板状态变更后，Project Memory 状态快照被同步更新。

### REQ-019：初始化 Project Memory
来源：PRD 第 4.4 节；第 6.5 节 FR-044
优先级：Must

WHEN 项目创建完成
THE SYSTEM SHALL 初始化 `.specdriver/memory/project.md`，包含项目名称、目标、默认分支、当前 Spec 版本、初始任务状态快照和空运行记录。

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

### REQ-030：自动驱动 Feature 计划流水线
来源：PRD 第 6.6 节 FR-056
优先级：Must

WHEN Feature 进入 planning
THE SYSTEM SHALL 自动执行 technical-context、research-decision、architecture-plan、data-model、contract-design 和 task-slicing 等 Skill，并在完成后进入 tasked。

验收：
- [ ] 任一计划阶段失败时 Feature 进入 Review Needed，并保留失败证据。

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
来源：PRD 第 6.8 节 FR-060 至 FR-062
优先级：Must

WHEN 项目级调度触发
THE SYSTEM SHALL 根据优先级、依赖完成情况、验收风险、就绪状态、人工覆盖和 Spec 变更选择并推进 Feature。

验收：
- [ ] Project Scheduler 不依赖 Project Memory 中的静态候选队列作为真实调度来源。
- [ ] 人工覆盖规则在 MVP 中使用内置固定逻辑，不要求用户配置。

### REQ-034：运行 Feature Scheduler
来源：PRD 第 6.8 节 FR-061 至 FR-062
优先级：Must

WHEN Feature 内部调度触发
THE SYSTEM SHALL 根据任务依赖、风险、文件范围、Runner 可用性、worktree 状态、成本预算、执行窗口和审批要求推进任务。

验收：
- [ ] Feature Scheduler 只调度依赖已满足且边界允许的任务。

### REQ-035：记录 worktree 隔离状态
来源：PRD 第 6.8 节 FR-063
优先级：Must

WHEN 系统创建或使用 worktree
THE SYSTEM SHALL 记录 worktree 路径、分支名、base commit、目标分支、关联 Feature/Task、Runner 和清理状态。

验收：
- [ ] 合并前执行冲突检测、Spec Alignment Check 和必要测试。

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
THE SYSTEM SHALL 通过 Codex Runner 调用 Codex CLI，并要求输出符合 Evidence schema。

验收：
- [ ] Codex Runner 产出结构化 Evidence Pack。

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

### REQ-043：调用失败恢复 Skill
来源：PRD 第 6.11 节 FR-090
优先级：Must

WHEN 任务失败且可尝试自动恢复
THE SYSTEM SHALL 生成恢复任务并调用 failure-recovery-skill。

验收：
- [ ] 恢复任务包含失败类型、失败命令、摘要、相关文件、历史尝试、禁止重试项和最大重试次数。

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

### REQ-053：提供 Spec Workspace
来源：PRD 第 8.2 节
优先级：Should

WHEN 用户打开 Spec Workspace
THE SYSTEM SHALL 支持创建 Feature，并查看 Spec、澄清记录、需求质量 checklist、技术计划、数据模型、契约、任务图和 Spec 版本 diff。

验收：
- [ ] 用户可以从 Spec Workspace 追踪需求到任务图。

### REQ-054：提供 Skill Center
来源：PRD 第 8.3 节
优先级：Should

WHEN 用户打开 Skill Center
THE SYSTEM SHALL 展示 Skill 列表、详情、版本、输入输出 schema、启用状态、执行日志、成功率、适用阶段和风险等级。

验收：
- [ ] 用户可以查看 Skill 是否启用以及最近执行情况。

### REQ-055：提供 Subagent Console
来源：PRD 第 8.4 节
优先级：Should

WHEN 用户打开 Subagent Console
THE SYSTEM SHALL 展示当前 Subagent、Run Contract、上下文切片、Evidence Pack、token 使用、运行状态，并支持终止和重试。

验收：
- [ ] 用户可以定位每个 Subagent 的输入、输出和当前状态。

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

## 9. 追踪矩阵

| 来源 | 需求 ID | 说明 |
|---|---|---|
| PRD 第 1 节 产品定义 | REQ-004, REQ-005, REQ-030, REQ-037, REQ-052 | 产品定位与核心组件 |
| PRD 第 2.1 节 核心目标 | REQ-004, REQ-016, REQ-029, REQ-030, REQ-036, REQ-040, REQ-052 | 目标转化为系统行为 |
| PRD 第 2.2 节 非目标 | 第 3 节 | MVP 排除范围 |
| PRD 第 3 节 核心架构 | REQ-018, REQ-031, REQ-040, REQ-043, REQ-048 | 工作流与状态聚合 |
| PRD 第 4.1 节 Spec Protocol | REQ-004, REQ-005, REQ-007, REQ-008, REQ-009, REQ-053 | Spec 作为事实源 |
| PRD 第 4.2 节 Skill System | REQ-010, REQ-011, REQ-012, REQ-013, REQ-054 | Skill 元数据与校验 |
| PRD 第 4.3 节 Subagent Runtime | REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-055 | 上下文隔离执行 |
| PRD 第 4.4 节 Project Memory | REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 | CLI 持久记忆 |
| PRD 第 4.5 节 Evidence Pack | REQ-018, REQ-049, REQ-051 | 状态判断与交付证据 |
| PRD 第 5 节 用户流程 | REQ-029, REQ-030, REQ-033, REQ-034, REQ-040, REQ-046 | 自主执行闭环 |
| PRD 第 6.1 节 项目管理 | REQ-001, REQ-002, REQ-003 | 项目创建与健康检查 |
| PRD 第 6.2 节 Spec Protocol Engine | REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009 | Spec 创建与管理 |
| PRD 第 6.3 节 Skill Center | REQ-010, REQ-011, REQ-012, REQ-013 | Skill 生命周期 |
| PRD 第 6.4 节 Subagent Runtime | REQ-014, REQ-015, REQ-017, REQ-018 | Agent 合同与并行 |
| PRD 第 6.5 节 Project Memory | REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 | Memory 初始化到版本化 |
| PRD 第 6.6 节 Feature 流水线与选择 | REQ-028, REQ-029, REQ-030, REQ-031, REQ-032 | Feature 生命周期 |
| PRD 第 6.7 节 任务图与看板 | REQ-024, REQ-025, REQ-026, REQ-027 | 任务图与看板行为 |
| PRD 第 6.8 节 Scheduler | REQ-033, REQ-034, REQ-035, REQ-036 | 调度与恢复 |
| PRD 第 6.9 节 Codex Runner | REQ-037, REQ-038, REQ-039 | Runner 执行与安全策略 |
| PRD 第 6.10 节 状态检测 | REQ-040, REQ-041, REQ-042 | 验证与状态判断 |
| PRD 第 6.11 节 自动恢复 | REQ-043, REQ-044, REQ-045 | 失败恢复 |
| PRD 第 6.12 节 审批中心 | REQ-046, REQ-047, REQ-057 | 审批触发与处理 |
| PRD 第 6.13 节 PR 与交付 | REQ-048, REQ-049, REQ-050 | 交付生命周期 |
| PRD 第 7 节 核心数据模型 | REQ-001, REQ-004, REQ-024, REQ-051, REQ-058 | 数据模型覆盖范围 |
| PRD 第 8 节 页面需求 | REQ-052, REQ-053, REQ-054, REQ-055, REQ-056, REQ-057 | UI 表面需求 |
| PRD 第 9 节 非功能需求 | NFR-001 至 NFR-011 | 安全、稳定、可观测性、性能 |
| PRD 第 10 节 成功指标 | NFR-012 | MVP 成功指标 |
| PRD 第 11 节 MVP 版本规划 | 第 10 节 | 发布顺序参考 |
| PRD 第 12 节 关键风险与对策 | EDGE-004 至 EDGE-008 | 风险驱动边界场景 |

## 10. MVP 版本映射

| 里程碑 | 需求 ID |
|---|---|
| M1：Spec Protocol + Skill 基础 | REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012, REQ-013, REQ-058 |
| M2：Plan + Task Graph + Feature 选择器 | REQ-024, REQ-025, REQ-026, REQ-027, REQ-028, REQ-029, REQ-030, REQ-031 |
| M3：Subagent Runtime + Project Memory | REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 |
| M4：Codex Runner | REQ-035, REQ-037, REQ-038, REQ-039 |
| M5：状态检测与恢复 | REQ-040, REQ-041, REQ-042, REQ-043, REQ-044, REQ-045 |
| M6：审批与交付 | REQ-046, REQ-047, REQ-048, REQ-049, REQ-050, REQ-057 |

## 11. 待确认问题

- Review Center 中“大 diff”的默认阈值是什么？
- 哪些风险等级和风险规则必须触发人工审批？
