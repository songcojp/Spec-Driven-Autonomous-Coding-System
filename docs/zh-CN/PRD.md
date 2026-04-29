# PR：Spec-Driven Autonomous Coding System

版本：V2.0
状态：正式草案
产品名称：SpecDrive AutoBuild
产品方向：Spec + CLI Skill + CLI Subagent 驱动的长时间自主编程系统

---

## 1. 产品定义

SpecDrive AutoBuild 是一个面向软件团队的长时间自主编程系统。系统以结构化 Spec 管理产品目标和验收标准，以项目本地 CLI Skill 固化可复用工程方法，以 Codex CLI 原生 Subagent 处理委托和上下文传递，以 Project Memory 为 CLI 提供跨会话持久记忆，以 Codex Runner 执行代码修改、测试和修复，以内部任务状态机管理任务流转、审批、恢复和交付，并通过 Dashboard / 看板呈现状态。

产品核心结论：

```text
Spec Protocol
+ CLI Skill Directory
+ CLI Subagent Delegation
+ Project Memory
+ Codex Runner
+ Internal Task State Machine
+ Dashboard View
```

一句话定位：

> 让 AI 在可控、可恢复、可审计的工程流程中持续交付代码。

---

## 2. 产品目标

### 2.1 核心目标

1. 用户输入自然语言需求后，系统生成结构化 Feature Spec。
2. 系统基于优先级和就绪状态自动选择下一个待执行的 Feature Spec。
3. 系统自动驱动 Feature Spec 流水线：技术计划 → 任务图 → 看板 → 调度执行。
4. 系统基于 Spec 生成技术计划、任务图、验收标准和风险规则。
5. 系统将大任务拆分为可调度任务，并通过 CLI 原生 Subagent 委托执行。
6. 系统记录持久 run、evidence、status、review 和 recovery 状态，不再重复实现 CLI 上下文切片。
7. Codex Runner 执行代码修改、测试、修复、PR 生成。
8. Status Checker 自动判断任务完成、失败、阻塞或需要审批。
9. Dashboard 实时呈现由内部任务状态机维护的任务状态和交付进度。
10. 系统以 Project Memory 为每次 CLI 会话提供项目级记忆，支持跨会话恢复目标、决策和阻塞状态。
11. 系统支持长时间运行、失败重试、断点恢复和交付审计。

### 2.2 非目标

MVP 不包含：

* 自研大模型。
* 自研完整 IDE。
* 企业级复杂权限矩阵。
* 生产环境自动发布。
* 多大型仓库复杂微服务自动迁移。
* 完整替代 Jira、GitHub Issues 或 Linear。
* MVP 不接入 Issue Tracker，仅保留外部链接和追踪字段。

---

## 3. 核心架构

```text
User / PM / Developer
        ↓
Product Console
        ↓
Spec Protocol Engine ───────────────┐
        ↓                           │
Requirement Intake + Checklist       │
        ↓                           │
Feature Spec Pool                    │
        ↓                           │
Project Scheduler                    │
        ↓                           │
Feature Selector                     │
        ↓                           │
Planning Pipeline                    │
        ↓                           │
Task Graph + Internal State Machine  │
        ↓                           │
Feature Scheduler                    │
        ↓                           │
Project Memory Store ───────────────┤
        ↓                           │
Subagent Runtime                     │
   ├── Spec Agent                    │
   ├── Clarification Agent           │
   ├── Repo Probe Agent              │
   ├── Architecture Agent            │
   ├── Task Agent                    │
   ├── Coding Agent                  │
   ├── Test Agent                    │
   ├── Review Agent                  │
   └── Recovery Agent                │
        ↓                           │
Codex Runner                         │
        ↓                           │
Git Workspace / Worktree / Branch    │
        ↓                           │
Status Checker                       │
        ↓                           │
Feature / Task State Aggregator      │
        ├── Done → next task / Feature done
        ├── Review Needed → approval_needed / clarification_needed / risk_review_needed
        ├── Blocked → unblock workflow or alternate task
        └── Failed → recovery workflow or manual review
        ↓                           │
PR / Delivery Report / Spec Evolution│
        ↓                           │
Feature Selector ◀───────────────────┘
```

---

## 4. 核心概念

### 4.1 Spec Protocol

Spec Protocol 是系统内部的需求、计划、验收和运行证据协议。它是产品交付的真实源头，支持导出 Markdown，也支持以 JSON/YAML 持久化。

Spec Protocol 包含：

* Product Brief
* Feature Spec
* Clarification Log
* Requirement Checklist
* Technical Plan
* Research Decisions
* Data Model
* Interface Contracts
* Quickstart Scenarios
* Task Graph
* Acceptance Criteria
* Run Evidence
* Review Findings
* Spec Evolution Record

### 4.2 Skill System

Skill 是项目本地 `.agents/skills/*/SKILL.md` 中固化的可复用工程能力。Codex CLI 负责 Skill 发现、调用和上下文处理；SpecDrive 只读取 Skill 文件元数据，用于 bootstrap readiness 和 Console 展示。

### 4.3 Subagent Runtime

Subagent 委托由 Codex CLI 原生能力负责。SpecDrive 不生成 Agent Run Contract 或上下文切片，只记录 CLI 执行周边的 run event、Evidence、Status Check、Review、Recovery 和 Audit 历史。

### 4.4 Project Memory

Project Memory 是面向 CLI 长时间运行的项目级持久记忆文件。每次 Codex CLI 会话启动前，系统将 Project Memory 注入为会话上下文，确保 CLI 无需重新探索即可恢复当前目标、关键决策、已知阻塞和任务进度。

Project Memory 以结构化 Markdown 持久化，保存在 `.autobuild/memory/project.md`，并在每次 Run 结束后由系统自动更新。

Project Memory 包含：

* 当前活跃 Feature 和任务
* **任务看板状态快照**（当前各 Feature 下任务的状态分布）
* **当前 Run 状态**（正在运行/上次运行结果）
* 最近关键决策及其原因
* 已知阻塞和当前处理状态
* 核心架构决策摘要
* 最近 Evidence Pack 摘要
* 待审批事项
* 当前 Spec 版本
* 禁止重复的失败模式

Project Memory 有大小预算（默认 ≤ 8000 tokens），超出时自动压缩旧条目为摘要。

### 4.5 Evidence Pack

Evidence Pack 是每个 Subagent Run 的结构化结果，用于状态判断、审批、恢复和交付报告。

```json
{
  "run_id": "RUN-20260427-001",
  "agent_type": "test-agent",
  "task_id": "T-014",
  "status": "failed",
  "summary": "登录表单校验测试失败",
  "evidence": {
    "commands": ["pnpm test auth"],
    "failed_tests": ["auth-login-form.spec.ts"],
    "likely_cause": "password empty case not handled",
    "related_files": [
      "src/features/auth/LoginForm.tsx",
      "tests/auth-login-form.spec.ts"
    ]
  },
  "recommendation": {
    "next_skill": "failure-recovery-skill",
    "risk": "medium"
  }
}
```

---

## 5. 用户流程

```text
阶段 1：项目初始化
  用户选择创建新项目或导入现有项目
    ↓
  系统自动创建项目记录并连接或探测 Git 仓库
    ↓
  系统自动初始化 Spec Protocol
    ↓
  系统自动导入已有项目宪章或创建默认项目宪章
    ↓
  系统自动初始化 Project Memory、健康检查和当前项目上下文

阶段 2：需求录入
  自动扫描或上传 PRD / 产品需求
    ↓
  自动扫描 PRD、EARS、requirements、HLD、design、Feature Spec、tasks 和 README / 索引等 Spec Sources
    ↓
  识别 PR/RP/PRD/EARS 需求格式和已有规格产物
    ↓
  生成 EARS / Feature Spec
    ↓
  完成关键澄清
    ↓
  通过需求质量检查
    ↓
  Feature 状态 → ready
    ↓
  Feature Spec Pool

阶段 3：自主执行循环
  Project Scheduler 触发 Feature Spec 选择器选择下一个 ready Feature
    ↓
  Feature 状态 → planning
    ↓
  自动生成技术计划、研究结论、数据模型、接口契约
    ↓
  生成任务图
    ↓
  Feature 状态 → tasked
    ↓
  任务进入看板
    ↓
  Feature Scheduler 在当前 Feature 内调度任务执行
    ↓
  Project Memory 注入 CLI 会话上下文
    ↓
  Subagent + Codex Runner 执行编码、测试、修复
    ↓
  Project Memory 更新
    ↓
  Status Checker 判断任务状态
    ├── Done → 更新任务图；若全部任务 Done 且验收通过，Feature 状态 → done
    ├── Review Needed → 人工审批/澄清；通过后回到 Ready 或 Scheduled
    ├── Blocked → 记录阻塞；解除后回到 Ready，无法解除时选择其他可执行任务或 Feature
    └── Failed → 生成恢复任务；超过阈值后进入人工 Review Needed
    ↓
  Feature done → PR / Delivery Report / Spec Evolution
    ↓
  Feature delivered 或当前 Feature 无可继续任务
    ↓
  回到 Feature Spec 选择器选择下一个 Feature
```

---

## 6. 功能需求

### 6.1 项目管理

#### FR-001 创建项目

用户可以创建 AutoBuild 项目并配置：

* 项目名称
* 产品目标
* 项目类型
* 技术偏好
* 项目目录
* 目标仓库或现有项目路径
* 默认分支
* 默认运行环境
* Codex Runner 开关
* 定时任务开关
* 自动 PR 开关

系统必须支持创建多个 AutoBuild 项目，并在 Product Console 中维护当前选中的项目上下文。用户切换项目后，Dashboard、Spec Workspace、Skill Center、Subagent Console、Runner Console、Review Center、Project Memory 投影和调度入口必须只读取当前项目的数据。

项目创建入口必须支持两种路径：

* 导入现有项目：用户填写已有项目目录，系统将该目录作为项目目录并执行仓库探测和健康检查。
* 创建新项目：用户填写项目创建表单，系统在统一 `workspace/` 目录下创建项目目录，并将该目录作为项目后续 Spec、Project Memory、仓库连接和 Runner 工作的基础路径。

无论用户选择导入现有项目还是创建新项目，系统都必须自动完成阶段 1 的初始化闭环：持久化项目、保存或探测仓库连接、初始化 `.autobuild/` / Spec Protocol、导入已有项目宪章或创建默认项目宪章、初始化 Project Memory、执行健康检查并设置当前项目上下文。除非缺少目录权限、Git 仓库不可读、Spec Protocol 初始化失败或宪章内容无法满足项目事实源约束，否则系统不得要求用户逐步手动执行阶段 1 操作。

#### FR-002 连接 Git 仓库

系统支持连接 GitHub、GitLab、本地 Git 仓库和私有仓库，并展示：

* 当前分支
* 最新 commit
* 未提交变更
* 当前 PR
* CI 状态
* 任务对应分支
* Worktree 状态

#### FR-003 项目健康检查

系统检测：

* 是否是 Git 仓库。
* 是否存在 package manager。
* 是否存在测试命令。
* 是否存在构建命令。
* 是否有 `.codex/config.toml`。
* 是否有 AGENTS.md。
* 是否存在 Spec Protocol 目录。
* 是否有未提交变更。
* 是否存在敏感文件风险。

### 6.2 Spec Protocol Engine

#### FR-010 创建 Feature Spec

系统通过 `requirement-intake-skill` 和 `pr-ears-requirement-decomposition-skill` 创建 Feature Spec。Feature Spec 必须包含：

* Feature 名称
* Feature 目标
* 用户角色
* 用户故事
* 优先级
* 验收场景
* 功能需求
* 非功能需求
* 成功指标
* 关键实体
* 假设
* 不做范围
* 风险点

#### FR-011 PR/EARS 需求拆解

系统支持将用户提供的 PR、RP、PRD 片段或 EARS 格式需求拆解为标准 Feature Spec。

输入支持：

* 自然语言产品需求。
* PR/RP/PRD 格式需求描述。
* EARS 格式需求句式。
* 混合格式需求文档。

在阶段 2 需求录入开始时，系统必须自动扫描当前项目的 Spec Sources，包括 PRD、EARS、requirements、HLD、design、已有 Feature Spec、tasks 和 README / 索引等文档，识别已有需求、设计、规划产物和缺口，并将扫描结果作为 EARS / Feature Spec 生成、澄清和质量检查的事实输入。阶段 2 允许扫描 HLD 和 Feature Spec 作为事实源，但不得在该阶段生成 HLD、拆分 Feature Spec 或启动规划流水线；这些操作属于阶段 3 的选中 Feature 受控操作。

EARS 标准句式：

```text
WHEN [condition/event]
THE SYSTEM SHALL [expected behavior]
```

示例：

```text
WHEN a user submits valid registration data
THE SYSTEM SHALL create a new user account

WHEN a user submits an email that already exists
THE SYSTEM SHALL display "Email already registered" error

WHEN a user submits invalid email format
THE SYSTEM SHALL display email validation error
```

拆解结果必须包含：

* feature candidate
* user story
* requirement id
* condition/event
* expected behavior
* acceptance criteria
* test scenario
* priority
* ambiguity flags
* source trace

每条 EARS 需求必须保留源文本追踪关系，并能映射到 Feature Spec、Acceptance Criteria 和后续测试用例。

#### FR-012 Spec 切片

系统必须支持按 feature、user story、requirement、acceptance criteria 和 related files 切分 Spec。Coding Agent 默认只能读取当前任务相关切片。

#### FR-013 Clarification Log

系统记录每个澄清问题：

* question
* recommended answer
* user answer
* affected spec section
* timestamp
* decision owner

#### FR-014 Requirement Checklist

系统为每个 Feature 生成需求质量 checklist，覆盖完整性、清晰度、一致性、可测量性、场景覆盖、边界条件、非功能属性、依赖、假设、歧义和冲突。

#### FR-015 Spec Versioning

Spec 每次变更必须生成版本：

```text
SPEC-1.0.0
SPEC-1.1.0
SPEC-1.1.1
```

版本变化规则：

* MAJOR：需求目标或核心边界变化。
* MINOR：新增用户故事、能力或约束。
* PATCH：澄清、措辞、验收标准细化。

### 6.3 Skill Center

#### FR-020 项目本地 Skill 发现

系统从项目本地 `.agents/skills/*/SKILL.md` 动态发现 Skill。Skill 目录名是稳定 slug，`SKILL.md` frontmatter 中的 `name` 和 `description` 用于展示。

SpecDrive 不再把 Skill 注册到 SQLite，也不维护 Skill 启用状态、版本回滚或项目覆盖表。

#### FR-021 CLI Skill 文件事实源

MVP 通过项目本地 Skill 文件提供可复用 workflow。当前运行期设计 Skill 包括：

* `project-constitution-skill`
* `requirement-intake-skill`
* `pr-ears-requirement-decomposition-skill`
* `ambiguity-clarification-skill`
* `requirements-checklist-skill`
* `technical-context-skill`
* `research-decision-skill`
* `architecture-plan-skill`
* `data-model-skill`
* `contract-design-skill`
* `quickstart-validation-skill`
* `task-slicing-skill`
* `spec-consistency-analysis-skill`
* `repo-probe-skill`
* `codex-coding-skill`
* `test-execution-skill`
* `failure-recovery-skill`
* `review-report-skill`
* `pr-generation-skill`
* `spec-evolution-skill`
* `workflow-hook-skill`

#### FR-022 CLI Skill 执行契约

Skill 输入输出约束由 Codex CLI 和 `SKILL.md` 自身说明负责。SpecDrive 不再执行 SQL registry schema 校验；任务是否完成、失败、阻塞或需要审批由 Status Checker、Evidence Pack 和 Review Center 判断。

#### FR-023 Skill 文件治理

Skill 变更通过文件评审、git history 和项目文档治理。若需要团队级分发，应优先复用 CLI/plugin/skill 安装机制，而不是恢复 SQL 注册表。

### 6.4 Subagent Runtime

#### FR-030 Subagent 类型

| Subagent            | 责任          |
| ------------------- | ----------- |
| Spec Agent          | 生成/修订需求     |
| Clarification Agent | 识别歧义并提出问题   |
| Repo Probe Agent    | 只读探索仓库      |
| Architecture Agent  | 生成技术方案      |
| Task Agent          | 拆任务图        |
| Coding Agent        | 执行编码        |
| Test Agent          | 运行测试并分析失败   |
| Review Agent        | 分析 diff 和风险 |
| Recovery Agent      | 修复失败        |
| State Agent         | 更新看板状态      |

#### FR-031 CLI 原生 Subagent 委托记录

Subagent 上下文传递由 Codex CLI 原生处理。SpecDrive 记录 `runs`、`subagent_events`、`raw_execution_logs`、`status_check_results` 和 `evidence_packs`，用于跨 session 恢复、审计和 Console 展示。

#### FR-032 Subagent 并行策略

系统支持：

* 只读 Subagent 并行。
* 不同文件的 Coding Agent 可并行。
* 同一文件写任务串行。
* 同一分支写任务默认串行。
* 高风险任务单 Agent 执行。
* 任意写入型并行必须使用独立 Git worktree 隔离修改；不得在同一工作区内并行写入。
* 每个 worktree 必须绑定独立分支、任务/Feature 标识和合并目标，并在状态检测和交付前完成冲突检测。

#### FR-033 Subagent 结果判定

Subagent 自报结果不能直接推动任务 Done。Status Checker、Evidence Pack、Review Center 和 Feature Aggregator 共同判断下一步动作和看板状态。**看板状态变更后触发 Project Memory 状态快照同步。**

### 6.5 Project Memory

#### FR-044 Project Memory 初始化

项目创建时系统初始化 Project Memory 文件 `.autobuild/memory/project.md`，内容包含项目名称、目标、默认分支、当前 Spec 版本、初始任务状态快照和空的运行记录。

#### FR-045 Project Memory 注入

每次启动 Codex CLI 会话前，系统将 Project Memory 文件内容作为首段系统提示注入，格式为：

```text
[PROJECT MEMORY]
<project.md 内容>
[/PROJECT MEMORY]
```

CLI 据此恢复：当前任务目标、**当前任务及相关任务的看板状态**、**上次 Run 的结果与状态**、已完成事项、已知阻塞、禁止操作和待审批事项，无需重新探索仓库。

#### FR-046 Project Memory 更新

每次 Run 结束后，系统根据 Evidence Pack 和 Status Checker 结果自动更新 Project Memory：

* 将已完成任务移入完成列表
* **更新任务看板状态快照**（同步内部任务状态机的最新状态，并供 Dashboard 呈现）
* **更新当前 Run 状态**（run_id、agent_type、结果、耗时）
* 追加新决策和架构变更
* 更新当前阻塞状态
* 追加失败模式指纹
* 压缩超过预算的旧条目

更新操作必须幂等，支持重放。

#### FR-047 Project Memory 大小控制

* 默认预算：≤ 8000 tokens
* 超出时优先压缩：旧 Evidence Pack 摘要 → 历史决策 → 已完成任务列表
* 当前任务、**当前任务状态快照**、当前阻塞、禁止操作永不压缩
* 系统记录每次压缩操作到审计日志

#### FR-048 Project Memory 版本

Project Memory 每次变更生成版本记录（时间戳 + run_id），支持查看历史版本和回滚。

### 6.6 Feature Spec 流水线与选择

#### FR-054 Feature 状态机

Feature Spec 必须经历如下状态流转，系统自动驱动：

```text
draft        → ready        （通过需求质量检查后）
ready        → planning     （Feature 选择器自动选中后触发）
planning     → tasked       （技术计划 + 任务图生成完成）
tasked       → implementing （Feature Scheduler 排期首个任务）
implementing → done         （所有任务 Done，验收通过）
done         → delivered    （PR 合并，交付报告生成）

planning     → review_needed（计划流水线失败或需求仍不清楚）
implementing → review_needed（任务需要人工审批、澄清或风险确认）
implementing → blocked      （存在阻塞且没有可继续任务）
implementing → failed       （恢复次数超过阈值或不可自动修复）
blocked      → ready        （阻塞解除后重新进入候选池）
review_needed → ready       （人工处理完成后重新进入候选池）
failed       → review_needed（生成失败摘要后等待人工处理）
```

`planning` 阶段不要人工触发，由 Feature 选择器驱动。

`review_needed` 是状态机上的聚合状态，进入该状态时必须同时记录细分原因：

* `approval_needed`：需要权限、安全、合规、预算或高风险操作审批。
* `clarification_needed`：需求、验收标准、技术边界或用户意图仍不清楚。
* `risk_review_needed`：diff 过大、影响范围异常、测试证据不足或架构风险需要人工复核。

Dashboard、Project Memory 和 Evidence Pack 必须展示 `review_needed_reason`，便于责任人快速判断下一步动作。

#### FR-055 Feature Spec 自动选择

系统内置 Feature 选择器，在以下时机自动从所有 `ready` 状态的 Feature Spec 中选一个进入 `planning`：

* 当前没有 `implementing` 中的 Feature
* 当前 `implementing` 中的 Feature 所有任务全部 Done 或 Delivered
* 当前 `implementing` 中的 Feature 进入 Blocked 且没有可继续任务

选择优先级顺序：

1. 优先级最高（P1 > P2 > P3）
2. 所有前置依赖 Feature 已完成
3. 验收标准明确、着手风险最低
4. 处于最长时间的 `ready` 状态的优先（防止饥饿）

Project Scheduler 每次触发时必须从 Feature Spec Pool 动态读取当前 `ready` Feature、优先级、依赖状态和人工覆盖结果并重新评估候选集；不得依赖 Project Memory 中固化的静态候选队列作为真实调度来源。

选择结果写入 Project Memory，下一次 CLI 会话即可从选中的 Feature 直接进入 `planning` 流水线。Project Memory 只保存最近选择结果、候选摘要和选择原因，用于恢复和审计；真实候选集以 Feature Spec Pool 当前状态为准。

#### FR-056 Feature 计划流水线自动驱动

Feature 进入 `planning` 后，系统依次自动调用如下 Skill，每次 Skill 完成后推进至下一阶段，无需人工介入：

```text
technical-context-skill
  ↓
research-decision-skill
  ↓
architecture-plan-skill
  ↓
data-model-skill + contract-design-skill（可并行）
  ↓
task-slicing-skill → 生成任务图
  ↓
Feature 状态 → tasked
```

任一阶段失败时进入 `Review Needed`，待人工处理后继续。

#### FR-057 Feature 状态聚合与完成判定

系统必须在每次任务状态变化后聚合该 Feature 下所有任务状态，并自动判断 Feature 后续路径：

```text
所有任务 Done + Feature 验收通过
  → Feature 状态 → done
  → 生成 PR / Delivery Report / Spec Evolution
  → done 或 delivered 后触发 Feature 选择器继续选择下一个 ready Feature

存在 Review Needed 任务
  → Feature 保持 implementing
  → 暂停受影响任务
  → 等待人工审批、澄清或风险确认
  → 处理完成后相关任务回到 Ready 或 Scheduled

存在 Blocked 任务且没有可继续任务
  → Feature 状态 → blocked
  → 记录阻塞原因到 Project Memory
  → 触发 Feature 选择器选择其他可执行 Feature

存在 Failed 任务且恢复次数超过阈值
  → Feature 状态 → failed 或 review_needed
  → 生成恢复摘要和人工处理建议
  → 触发 Feature 选择器选择其他可执行 Feature
```

Feature `done` 判定不得只依赖任务卡片状态；必须同时满足 Feature 级 Acceptance Criteria、Spec Alignment Check 和必要测试通过。

#### FR-058 多 Feature 并行策略

* 默认项目级单 Feature 串行执行（防止工作区冲突）
* 项目级 Feature 并行必须由显式开关控制，默认关闭
* 开关开启后，可允许多个互不影响文件和依赖的 Feature 并行 `implementing`
* 任意项目级并行写入必须为每个 Feature 创建独立 Git worktree 和隔离分支
* Feature 间有依赖关系时，依赖未完成的 Feature 不得进入 `implementing`
* 多 Feature 并行完成后必须通过 Status Checker、Workspace 冲突检测和 Delivery Gate 汇总 diff、合并 Evidence，并按目标分支顺序合并

### 6.7 任务图与看板

#### FR-050 任务图生成

任务必须包含：

* task_id
* title
* description
* source_requirement
* user_story
* acceptance_criteria
* allowed_files
* dependencies
* parallelizable
* risk_level
* required_skill
* required_subagent
* estimated_effort
* status

#### FR-051 看板列

默认看板列：

```text
Backlog
Ready
Scheduled
Running
Checking
Review Needed
Blocked
Failed
Done
Delivered
```

#### FR-052 状态自动流转

```text
Backlog → Ready
Ready → Scheduled
Scheduled → Running
Running → Checking
Checking → Done
Checking → Review Needed
Checking → Blocked
Checking → Failed
Done → Delivered
```

#### FR-053 任务卡片

任务卡片展示标题、Feature、User Story、当前状态、依赖任务、计划执行时间、最近 Runner、最近 Evidence Pack、测试状态、diff 摘要、风险等级和审批状态。

### 6.8 Scheduler

#### FR-060 定时执行

系统支持立即执行、指定时间执行、每日执行、每小时巡检、夜间自动执行、工作日执行、依赖完成后执行、CI 失败后执行、审批通过后执行。

#### FR-061 调度层级

系统调度分为两层：

```text
Project Scheduler
  → 在项目级别从 Feature Spec Pool 中逐个选择 ready Feature
  → 默认一次只推进一个 Feature
  → 项目级并行开关开启后，可同时推进多个互不冲突的 Feature

Feature Scheduler
  → 在单个 Feature Spec 内部调度任务图
  → 根据任务依赖、风险、文件范围和 Runner 可用性推进 Backlog / Ready / Scheduled / Running
  → Feature 内任务并行必须满足依赖和文件隔离条件
```

Project Scheduler 负责 Feature 选择、Feature 级并行控制、Feature 生命周期推进和跨 Feature 资源分配。Feature Scheduler 负责 Feature 内任务排序、任务并行、Runner 分配和任务状态推进。

#### FR-062 调度策略

**项目级调度**：Project Scheduler 触发选择器根据优先级、依赖完成情况、验收风险和就绪状态选定下一个 Feature；每次调度都从 Feature Spec Pool 动态计算候选集，识别最新优先级、阻塞解除、人工覆盖和 Spec 变更；项目级并行开关关闭时逐个 Feature 串行推进，开启时按 FR-058 选择多个可并行 Feature。

**Feature 内调度**：Feature Scheduler 在单个 Feature Spec 的任务图内，根据优先级、依赖状态、风险等级、并行能力、Runner 可用性、Git worktree 状态、成本预算、允许执行窗口和审批要求排序。

#### FR-063 Worktree 并行隔离

项目级并行和 Feature 内写入型任务并行都必须使用 Git worktree：

* 项目级并行：每个并行 Feature 使用独立 worktree。
* Feature 内并行：每个并行写任务或任务组使用独立 worktree。
* 只读任务可共享只读工作区，但不得写入文件。
* 同一文件、同一目录迁移、数据库 schema、锁文件、公共配置等高冲突范围默认串行，不得仅依赖 worktree 并行。
* 涉及数据库、缓存、消息队列、搜索索引、外部 API、文件上传目录等共享运行时资源的并行任务，必须使用 mock、命名空间隔离、临时容器、独立 schema/database 或一次性测试实例；无法隔离时必须串行执行。
* 集成测试和端到端测试不得默认共享同一可变本地数据库或缓存实例；测试环境标识、连接串、容器名和清理策略必须写入 workspace schema 和 Evidence Pack。
* worktree 创建、分支名、base commit、目标分支、关联 Feature/Task、Runner 和清理状态必须写入 Project Memory 和审计日志。
* 合并前必须执行冲突检测、Spec Alignment Check 和必要测试；冲突或高风险 diff 进入 Review Needed。

#### FR-064 长时间恢复

系统重启后必须恢复：

* 未完成 Run
* Running 任务
* Scheduled 任务
* Runner 心跳
* Git worktree 状态
* Codex session 信息
* 最近 Evidence Pack
* Project Memory（注入下一次 CLI 会话）

### 6.9 Codex Runner

#### FR-070 Codex 执行

系统通过 Codex Runner 调用：

```bash
codex exec --cd <workspace> --json --output-schema evidence.schema.json "<prompt>"
```

#### FR-071 Codex 安全策略

Codex Runner 必须支持 sandbox mode、approval policy、model、profile、output schema、JSON event stream、workspace root 和 session resume。

#### FR-072 默认安全配置

| 任务风险  | sandbox         | approval   | 说明      |
| ----- | --------------- | ---------- | ------- |
| 只读分析  | read-only       | never      | 不修改文件   |
| 低风险编码 | workspace-write | on-request | 可自动改工作区 |
| 中风险编码 | workspace-write | on-request | 关键命令需审批 |
| 高风险编码 | read-only       | untrusted  | 只生成建议   |
| 危险任务  | 禁止              | 必须人工       | 不自动执行   |

### 6.10 状态检测

#### FR-080 检测项

每次 Run 后自动检测：

* Git diff
* 构建结果
* 单元测试
* 集成测试
* 类型检查
* lint
* 安全扫描
* 敏感信息扫描
* Spec alignment
* 任务完成度
* 风险文件修改
* 未授权文件修改

#### FR-081 状态判断

```text
无代码变更 + 无法解释 → Blocked
有代码变更 + 测试通过 + 验收通过 → Done
有代码变更 + 测试失败 + 可修复 → Ready 或 Scheduled
有高风险 diff → Review Needed
缺依赖/缺权限 → Blocked
连续失败超过阈值 → Failed
需求不清楚 → Review Needed
```

#### FR-082 Spec Alignment Check

系统检查 diff、task、user story、requirement、acceptance criteria、测试覆盖和 forbidden files 之间的一致性。

### 6.11 自动恢复

#### FR-090 Failure Recovery Skill

失败后系统生成恢复任务。

```json
{
  "failure_type": "test_failed",
  "failed_command": "pnpm test",
  "summary": "auth form validation failed",
  "related_files": [],
  "previous_attempts": [],
  "forbidden_retries": [],
  "max_retry": 3
}
```

#### FR-091 恢复策略

系统支持自动修复、回滚当前任务修改、拆分任务、降级为只读分析、请求人工审批、更新 Spec 和更新任务依赖。

#### FR-092 防止重复失败

系统记录上次失败原因、上次修复方案、禁止重复策略、失败次数和失败模式指纹。对同一失败模式最多自动重试 3 次，重试等待时间依次为 2 分钟、4 分钟和 8 分钟；达到最大重试次数后停止自动重试并进入人工处理路径。

失败模式指纹至少由 task_id、失败阶段、失败命令或检查项、规范化错误摘要和相关文件集合生成。禁止重复策略必须记录已导致同一指纹重复失败的修复方案、命令和文件范围，并阻止再次自动执行相同尝试。

### 6.12 审批中心

#### FR-100 审批触发

以下情况进入 Review Needed：

* 修改认证、权限、支付、数据迁移。
* diff 超过阈值。
* 修改 forbidden files。
* 多次失败。
* 测试未通过但 Agent 建议继续。
* 需求存在高影响歧义。
* 需要提升 Codex 权限。
* 需要变更 constitution。
* 需要变更架构方案。

#### FR-101 审批页面

审批页面展示任务目标、关联 Spec、Runner policy、diff 摘要、测试结果、风险说明、推荐动作和可选操作。

可选操作包括：

* 批准继续
* 拒绝
* 要求修改
* 回滚
* 拆分任务
* 更新 Spec
* 标记完成

### 6.13 PR 与交付

#### FR-110 自动生成 PR

PR 内容包括 Feature 摘要、完成任务、关联 requirements、测试结果、风险说明、人工审批记录、回滚方案和未完成事项。

#### FR-111 交付报告

交付报告包括本轮完成内容、变更文件、验收结果、测试摘要、失败和恢复记录、风险项、下一步建议和 Spec 演进建议。

#### FR-112 Spec Evolution

实现过程中发现需求不准确、验收标准不可测、代码库现实与计划冲突、审批意见改变范围、测试暴露缺失边界条件或运行指标暴露新约束时，系统建议更新 Spec。

---

## 7. 核心数据模型

### Project

```json
{
  "id": "PRJ-001",
  "name": "SpecDrive Demo",
  "repo_url": "",
  "default_branch": "main",
  "status": "active",
  "trust_level": "trusted",
  "created_at": "",
  "settings": {}
}
```

### ProjectSelectionContext

```json
{
  "current_project_id": "PRJ-001",
  "available_project_ids": ["PRJ-001", "PRJ-002"],
  "last_switched_at": "",
  "selection_source": "user|system_default|resume"
}
```

### Feature

```json
{
  "id": "FEAT-001",
  "project_id": "PRJ-001",
  "title": "",
  "priority": "P1|P2|P3",
  "status": "draft|ready|planning|tasked|implementing|review_needed|blocked|failed|done|delivered",
  "review_needed_reason": "approval_needed|clarification_needed|risk_review_needed|null",
  "dependencies": [],
  "spec_version": "1.0.0",
  "selected_at": "",
  "planning_started_at": "",
  "implementing_started_at": ""
}
```

### Requirement

```json
{
  "id": "FR-001",
  "feature_id": "FEAT-001",
  "type": "functional|non_functional|constraint",
  "text": "",
  "acceptance_criteria": [],
  "priority": "P1"
}
```

### Task

```json
{
  "id": "T-001",
  "feature_id": "FEAT-001",
  "user_story_id": "US-001",
  "title": "",
  "status": "backlog|ready|scheduled|running|checking|review_needed|blocked|failed|done|delivered",
  "review_needed_reason": "approval_needed|clarification_needed|risk_review_needed|null",
  "dependencies": [],
  "parallelizable": true,
  "allowed_files": [],
  "risk_level": "low",
  "required_skill": "codex-coding-skill"
}
```

### Run

```json
{
  "id": "RUN-001",
  "task_id": "T-001",
  "agent_type": "coding-agent",
  "skill": "codex-coding-skill",
  "status": "running|success|failed|blocked",
  "started_at": "",
  "ended_at": "",
  "codex_session_id": "",
  "evidence_pack_id": ""
}
```

### ProjectMemory

```json
{
  "version": "MEM-20260427-042",
  "project_id": "PRJ-001",
  "updated_at": "",
  "updated_by_run": "RUN-001",
  "current_feature": "FEAT-001",
  "current_feature_status": "implementing",
  "last_feature_selection": {
    "selected_feature_id": "FEAT-001",
    "selected_at": "",
    "reason": "P1, dependencies done, lowest acceptance risk"
  },
  "ready_feature_snapshot": [
    { "feature_id": "FEAT-002", "priority": "P1", "status": "ready", "snapshot_at": "" },
    { "feature_id": "FEAT-003", "priority": "P2", "status": "ready", "snapshot_at": "" }
  ],
  "current_task": "T-021",
  "current_run": {
    "run_id": "RUN-001",
    "agent_type": "coding-agent",
    "status": "running|success|failed|blocked",
    "started_at": "",
    "ended_at": ""
  },
  "task_state_snapshot": [
    { "task_id": "T-019", "title": "", "status": "done" },
    { "task_id": "T-020", "title": "", "status": "done" },
    { "task_id": "T-021", "title": "", "status": "running" },
    { "task_id": "T-022", "title": "", "status": "blocked", "blocker": "" },
    { "task_id": "T-023", "title": "", "status": "ready" }
  ],
  "active_blockers": [],
  "pending_approvals": [],
  "recent_decisions": [],
  "failure_fingerprints": [],
  "forbidden_retries": [],
  "completed_tasks_summary": "",
  "spec_version": "1.2.0",
  "token_budget_used": 3200
}
```

### EvidencePack

```json
{
  "id": "EV-001",
  "run_id": "RUN-001",
  "summary": "",
  "changed_files": [],
  "commands": [],
  "test_result": {},
  "risk": "low",
  "recommendation": ""
}
```

---

## 8. 页面需求

### 8.1 Dashboard

展示项目健康度、当前活跃 Feature、看板任务数量、正在运行的 Subagent、今日自动执行次数、失败任务、待审批任务、成本消耗、最近 PR 和风险提醒。

Product Console 必须提供项目创建入口、项目列表和当前项目切换控件。切换项目后，所有页面、受控命令和反馈提示必须绑定到当前项目，避免跨项目读取或操作状态。

### 8.2 Spec Workspace

支持创建 Feature，查看 Spec、澄清记录、需求质量 checklist、技术计划、数据模型、契约、任务图和 Spec 版本 diff。

Spec Workspace 必须将 PRD 操作流程拆为两个可见阶段：

* 阶段 1 项目初始化：展示创建或导入项目、连接 Git 仓库、初始化 `.autobuild/` / Spec Protocol、导入或创建项目宪章、初始化 Project Memory 的状态、阻塞原因和事实来源。
* 阶段 2 需求录入：展示扫描或上传 PRD、识别 PR/RP/PRD/EARS、生成 EARS / Feature Spec、完成关键澄清、执行需求质量检查、推入 Feature Spec Pool 的状态、阻塞原因和事实来源。

Spec Workspace 的 PRD 操作流程不得把阶段 3 的 HLD 生成、Feature Spec 拆分、规划流水线入口混入阶段 2。阶段 3 操作可以作为选中 Feature 的受控操作展示，但必须与 PRD 需求录入流程视觉分离。没有 ready 项目时，Spec Workspace 仍必须展示阶段 1 阻塞状态和下一步动作；没有 Feature Spec 时，仍必须展示阶段 1 / 阶段 2 流程，让用户可以从 PRD 录入开始。

### 8.3 Skill Center

支持查看项目本地 `.agents/skills/*/SKILL.md` 发现到的 Skill 列表、详情和文件路径。

### 8.4 Subagent Console

支持查看 CLI delegation 相关的 run、Subagent event、Evidence Pack、Status Check、token 使用和运行状态。终止、重试等动作通过 Runner/Review/Recovery 控制面处理。

### 8.5 Dashboard Board

支持看板拖拽、批量排期、批量运行、查看依赖、查看 diff、查看测试结果、查看审批状态和失败恢复历史。

### 8.6 Runner Console

支持查看 Runner 在线状态、Codex 版本、当前 sandbox、当前 approval policy、当前 queue、最近日志和心跳状态，并支持暂停/恢复 Runner。

### 8.7 Review Center

支持待审批列表、风险筛选、diff 查看、Evidence 查看、批准、拒绝、要求修改、写入项目规则和写入 Spec Evolution。

### 8.8 语言切换

Product Console 必须支持界面语言切换，并默认使用中文。用户切换语言后，导航、页面标题、操作按钮、状态标签、空态、错误态、反馈提示和确认信息必须使用所选语言展示；系统状态数据、Evidence、diff、日志、文件路径、命令输出和用户输入内容不得被错误翻译。

---

## 9. 非功能需求

### 9.1 安全

* 默认不允许 danger-full-access。
* 默认不允许 bypass approvals。
* 高风险文件保护。
* `.env`、密钥、支付、认证配置需特殊保护。
* 写入边界通过任务图、Workspace Isolation、Runner policy 和 CLI 自身沙箱策略共同约束。
* 所有命令记录审计日志。
* 所有审批可追踪。
* 所有自动修改可回滚。

### 9.2 稳定性

* 调度器崩溃后可恢复。
* Runner 掉线后任务不丢失。
* Run 幂等。
* Evidence Pack 持久化。
* 同一文件写操作串行。
* 失败任务可重放。

### 9.3 可观测性

* 每个 Run 有唯一 ID。
* 每个状态变化有时间线。
* 每个 Subagent 有输入输出记录。
* 每个任务有完成证据。
* 支持日志搜索。
* 支持成本统计。
* 支持成功率统计。

### 9.4 性能

* 看板 1000 任务以内加载 < 2 秒。
* 任务状态刷新 < 5 秒。
* Runner 心跳 10-30 秒。
* Evidence Pack 写入 < 3 秒。
* 支持至少 10 个并发只读 Subagent。
* MVP 写任务默认单仓库单分支串行。

MVP 阶段记录看板加载、状态刷新和 Evidence Pack 写入耗时作为性能优化基线；上述性能阈值不作为阻塞验收门槛。

---

## 10. 成功指标

| 指标                   | MVP 目标 |
| -------------------- | ------ |
| Feature Spec 自动生成成功率 | >= 90% |
| PR/EARS 需求拆解准确率       | >= 85% |
| 澄清问题有效率              | >= 80% |
| 任务图可执行率              | >= 85% |
| 低风险任务自动完成率           | >= 60% |
| 自动状态判断准确率            | >= 85% |
| 失败任务可恢复率             | >= 50% |
| PR 交付报告生成率           | 100%   |
| 任务可追踪覆盖率             | 100%   |

---

## 11. MVP 版本规划

### M1：Spec Protocol + CLI Skill Discovery

* 项目创建
* 项目列表与项目切换
* Git 仓库连接
* Spec Protocol 数据结构
* Requirement Intake Skill
* PR/EARS Requirement Decomposition Skill
* Clarification Skill
* Checklist Skill
* Constitution Skill

### M2：Plan + Task Graph + Feature 选择器

* Technical Context Skill
* Architecture Plan Skill
* Research Decision Skill
* Task Slicing Skill
* 任务依赖图
* 看板基础版
* Feature 状态机
* Feature Spec 自动选择器
* Feature 计划流水线自动驱动

### M3：CLI Subagent Observation + Project Memory

* CLI Subagent event 记录
* Evidence Pack
* Status Check 结果判定
* 只读 Subagent 并行
* Project Memory 初始化与注入
* Project Memory 自动更新（Run 结束后）
* Project Memory 大小控制与压缩

### M4：Codex Runner

* Codex exec 集成
* JSON event stream
* output schema
* sandbox/approval 配置
* Git diff 采集
* 测试命令执行

### M5：状态检测与恢复

* Build/test/lint/type check
* Spec alignment check
* Failure Recovery Skill
* 自动重试
* Blocked/Failed 判断

### M6：审批与交付

* Review Center
* PR 生成
* Delivery Report
* Spec Evolution

---

## 12. 关键风险与对策

| 风险                | 对策                                             |
| ----------------- | ---------------------------------------------- |
| CLI 长时间运行后丢失项目上下文 | 使用 Project Memory 在每次会话前注入持久记忆，确保 CLI 恢复目标和状态 |
| Project Memory 过期或失真 | 每次 Run 后强制更新，压缩时保留当前任务和阻塞，支持版本回滚            |
| Project Memory 中候选队列滞后 | Feature 选择每次从 Feature Spec Pool 动态计算，Memory 仅保存最近选择结果和候选快照 |
| Feature 选择器选错优先级 | FR-055 优先级规则明确，支持人工覆盖选择结果，写入审计日志 |
| Subagent 并行修改冲突   | 只读任务优先并行，所有写入型并行必须使用独立 worktree，合并前执行冲突检测和 Spec Alignment Check |
| 并行任务污染数据库或缓存 | 共享运行时资源必须 mock、命名空间隔离、临时容器化或串行执行 |
| Skill 太多导致触发混乱    | Skill 必须有清晰 description、phase、trigger、schema   |
| Spec 过重导致上下文爆炸    | 使用 Spec 切片和 Evidence Pack，上下文管理由 Codex CLI 自带能力承担 |
| Agent 偏离需求        | 使用 Spec Alignment Check 和 Acceptance Map         |
| 自动修复反复失败          | 使用失败指纹、禁止重复策略和最大重试次数                         |
| Codex 权限过高        | 默认 workspace-write / on-request，高危模式禁用         |
| 用户不知道系统在做什么       | 使用看板、Run Timeline、Evidence 和 Delivery Report 展示 |

---

## 13. 最终结论

SpecDrive AutoBuild V2.0 的核心不是单个 Codex Agent，而是：

```text
以 Spec Protocol 管理目标和验收，
以 Skill System 固化工程方法，
以 Subagent Runtime 隔离上下文，
以 Project Memory 为 CLI 提供跨会话持久记忆，
以 Codex Runner 执行代码变更，
以内部任务状态机管理长时间自主交付，
并通过 Dashboard 呈现进度和状态。
```

最终产品原则：

> Spec 负责不跑偏，Skill 负责会做事，Subagent 负责不撑爆，Memory 负责不失忆，Runner 负责真执行，看板负责可管理。
