# PRD：SpecDrive VSCode 插件

版本：V1.0
状态：正式草案
产品名称：SpecDrive IDE
适用项目：SpecDrive AutoBuild
创建日期：2026-05-02

---

## 1. 背景

当前 SpecDrive AutoBuild 已具备 Spec Protocol、Feature 队列、Scheduler、Execution Record、Runner 和文件化 Spec 状态能力，但现有 Product Console 的 UI 交互流程体验较重：文档查看、需求澄清、任务状态、执行日志和人工审批分散在 Web 控制台中，操作者需要频繁切换页面才能完成一次 Spec 到实现的闭环。VSCode 插件需要一个独立于 Product Console 的 Webview Web UI，围绕任务调度和自动执行提供更紧凑、更靠近开发现场的操作工作台。

实际使用场景中，PRD、EARS、HLD、Feature Spec、代码、测试和 Git 状态都位于开发者 IDE 工作区内。VSCode 已经提供文件树、编辑器、Markdown 预览、CodeLens、Hover、Comments、Diagnostics、Terminal、Output Channel、Webview、Status Bar 和 Git 集成，适合作为 SpecDrive 的主要交互入口。

本 PRD 定义新的 VSCode 插件方案：SpecDrive 不复用 Codex VS 插件私有 Chat UI，也不模拟其输入框；SpecDrive VSCode 插件直接对接 Codex 官方 `codex app-server` JSON-RPC 协议，作为 Codex Adapter 的一种实现。VSCode 插件也不复用当前 Product Console 的 Web UI 页面、布局或组件；它应提供独立 Webview Web UI，产品重心放在 Job 队列、调度控制、自动执行进度、审批/中断和执行结果观察。现有 Scheduler、Runner、Contract、Execution Record 和文件化 Spec 状态机制保持不变。执行后的审查、审计和证据管理不再由 SpecDrive 另建复杂流程；VSCode UI、Codex 会话记录、app-server 事件流和 Execution Record 已经足够支撑可追踪执行。

## 2. 产品定位

SpecDrive IDE 是 SpecDrive AutoBuild 的 IDE 原生交互层。它让用户在 VSCode 内直接查看、编辑、澄清、提交、调度和观察 Spec 驱动的自主编程任务。

一句话定位：

> 用 VSCode 原生能力管理 Spec 文档和任务交互，用 Codex RPC 执行 Skill 调用，用 SpecDrive 控制面维护调度和最小执行状态。

补充定位：

> 用独立 VSCode Webview Web UI 承载任务调度和自动执行工作台；Product Console 只作为系统设置、调试和全局总览入口，不作为插件 UI 的复用来源。

核心架构：

```text
VSCode SpecDrive Extension
  -> Spec Explorer / CodeLens / Hover / Comments / Diagnostics
  -> Execution Workbench Webview
  -> SpecDrive Control Plane API
  -> Scheduler / Execution Records
  -> Codex RPC Adapter
  -> codex app-server thread/start + turn/start
  -> SkillOutputContractV1
```

## 3. 目标

1. 在 VSCode 左侧提供 Spec Explorer，展示 PRD、EARS、HLD、Feature Spec、Feature 状态和 Task 状态。
2. 提供独立 VSCode Webview Execution Workbench，作为任务调度和自动执行的主界面。
3. 在编辑器中直接查看和编辑 Spec 文档，支持行级、段落级交互。
4. 在 PRD、EARS、HLD、requirements、design 和 tasks 文档中提供 Hover、CodeLens、Comments 和 Diagnostics。
5. 支持用户在文档行或段落上添加澄清、决策、变更请求和执行意图。
6. 支持用户提交澄清或变更后，由 Codex 通过指定 Skill 修改文档。
7. 支持从 VSCode 中触发 Feature 调度、Task 执行、失败重试、状态刷新和聊天记录查看。
8. 通过 Codex RPC Adapter 调用 Codex，而不是依赖 Codex VS 插件私有 UI。
9. 保留现有 SpecDrive Scheduler、Runner、Execution Record 和文件化 Spec 状态机制。
10. 将 Product Console 中高频、IDE 更适合承载的交互迁移到 VSCode，但 UI 实现必须是独立插件 Web UI，而不是复用 Product Console 页面。

## 4. 非目标

本版本不包含：

- 不替代 Codex VS 插件的完整聊天 UI。
- 不注入、模拟或自动操作 Codex VS 插件输入框。
- 不依赖 Codex VS 插件的私有 Webview 消息协议。
- 不复用当前 Product Console Web UI 的页面、路由、布局或组件实现。
- 不重写现有 Scheduler、Runner 和 Execution Record 持久化机制。
- 不新增独立 Review Center、Evidence Pack 或重型审计中心；执行后的审查和证据由 VSCode UI、Codex 聊天记录、app-server 事件流和 Execution Record 承担。
- 不自研大模型。
- 不自研完整 IDE。
- 不实现复杂团队权限矩阵。
- 不实现云端多用户协作。
- 不删除 Product Console；Product Console 保留为系统状态、设置和调试入口。

## 5. 角色

- 产品负责人：查看 PRD、EARS、HLD 和 Feature 拆分，提交澄清和需求变更。
- 开发者：在 VSCode 中查看 Feature Spec、执行任务、查看 diff、运行测试和查看 Codex 聊天记录。
- 审批人：处理高风险命令、文件修改、失败恢复和需求澄清。
- 系统调度器：读取文件化 Spec 状态和 Feature 队列，创建执行 Job。
- Codex RPC Adapter：将 SpecDrive Contract 转换为 Codex RPC thread/turn 调用，并收集事件流。
- SpecDrive Control Plane：维护项目、队列、执行记录、状态、配置和轻量活动记录。

## 6. 用户流程

### 6.1 项目打开

```text
用户打开 VSCode 工作区
  -> 插件识别 docs/PRD.md 或 docs/<language>/PRD.md，以及 requirements.md、hld.md、docs/features/
  -> 插件连接本地 SpecDrive Control Plane
  -> 插件读取 feature-pool-queue.json 和 spec-state.json
  -> 左侧 Spec Explorer 展示当前 Spec 树和执行状态
```

### 6.2 文档阅读与澄清

```text
用户打开 PRD / EARS / HLD / Feature Spec
  -> Hover 显示 requirement id、traceability、状态和关联 Feature
  -> CodeLens 显示 添加澄清 / 生成 EARS / 更新设计 / 拆分任务
  -> 用户在段落或行上添加 Comment
  -> 插件生成 ClarificationItem
  -> 用户点击提交
  -> Scheduler 创建 generate_ears / spec_evolution / requirement_intake Job
  -> Codex RPC 执行对应 Skill
  -> 输出写回文档与 spec-state.json
```

### 6.3 Feature 任务执行

```text
用户在 Spec Explorer 选择 Feature
  -> 展开 requirements.md / design.md / tasks.md / spec-state.json
  -> 用户点击执行 Feature 或执行某个 task
  -> 插件生成 SkillInvocationContractV1
  -> Control Plane 创建 scheduler_job_records 和 execution_records
  -> Runner 通过 Codex RPC Adapter 调用 turn/start
  -> 插件实时显示 turn/item 事件、diff、命令输出和审批请求
  -> SkillOutputContractV1 校验通过
  -> 结果投影回 spec-state.json 和 Execution Record
```

### 6.4 Spec Explorer 任务队列管理

```text
用户打开 Spec Explorer 的 Task Queue 节点
  -> 查看 queued / running / approval_needed / failed / blocked / completed 的任务队列
  -> 查看每个任务的 Feature、Task、operation、priority、adapter、thread、turn 和最近状态
  -> 对任务执行 enqueue / run now / pause / resume / retry / cancel / skip / reprioritize
  -> 插件调用 Control Plane 受控命令
  -> Scheduler 或 Runner 更新 scheduler_job_records、execution_records 和 spec-state.json
  -> Spec Explorer 实时刷新任务队列和对应 Feature 状态
```

### 6.4a Execution Workbench 自动执行工作台

```text
用户打开 SpecDrive Execution Workbench Webview
  -> 默认进入任务调度视图，而不是文档目录或 Dashboard 总览
  -> 查看 ready / blocked / queued / running / approval_needed / failed / completed 的 Job 流
  -> 选择 Feature、Task、executor、priority、并发策略和自动执行模式
  -> 点击 Start Auto Run / Pause Automation / Resume / Stop
  -> 插件通过 Control Plane command API 创建或更新 scheduler_job_records
  -> Runner 消费 Job 并持续写入 execution_records、raw logs 和 spec-state 投影
  -> Webview 按 Job 时间线展示当前步骤、下一步、阻塞原因、审批请求、diff 摘要和可执行动作
```

规则：

- Execution Workbench 是 VSCode 插件内独立 Webview Web UI，拥有独立前端入口、布局和组件；不得复用 Product Console 的页面代码、导航结构或组件实现。
- Execution Workbench 的第一屏必须围绕任务调度和自动执行：队列、当前运行、下一步、阻塞、审批和执行控制必须比 Spec 文档浏览更突出。
- Webview 只通过插件 extension host 与 Control Plane query/command API 通信；不得直接访问 SQLite、`scheduler_job_records`、`execution_records` 或 `spec-state.json`。
- 可以复用后端 Contract、TypeScript 类型、query/command API 和状态事实源；不得复用 Product Console 的 UI 状态模型作为插件 UI 的事实源。

### 6.5 审批与恢复

```text
Codex 请求运行命令或修改文件
  -> app-server 发出 approval request
  -> 插件在 VSCode 中显示命令、cwd、diff、风险说明
  -> 用户 accept / acceptForSession / decline / cancel
  -> Adapter 返回 JSON-RPC response
  -> Execution Record 记录审批结果
```

失败时：

```text
turn/completed = failed 或 SkillOutputContractV1.status = failed
  -> Control Plane 写入失败原因、thread id、turn id 和摘要
  -> spec-state.json 标记 failed / blocked
  -> 插件在 Spec Explorer 和 Diagnostics 中显示失败点
  -> 用户选择 retry / recovery / request clarification
```

## 7. 系统交互流程

本章描述完整系统交互流程。用户流程只描述人在 VSCode 中看到和触发的动作；系统交互流程必须描述插件、Control Plane、Scheduler、Runner、Codex RPC、文件化 Spec 状态和 Execution Record 之间的责任边界。

### 7.1 系统组件边界

```text
VSCode SpecDrive Extension
  -> 负责 UI：Spec Explorer、Hover、CodeLens、Comments、Diagnostics、状态面板、Execution Workbench Webview
  -> 负责把用户动作转换为受控命令
  -> 不直接调用 Codex turn/start
  -> 不直接修改 execution_records

SpecDrive Control Plane
  -> 负责受控命令入口、项目上下文、adapter 配置、查询 API
  -> 负责创建 command receipt、scheduler_job_records、execution_records
  -> 负责读取/写入文件化 Spec 状态

Scheduler
  -> 负责读取 feature-pool-queue.json 和 spec-state.json
  -> 负责选择、跳过、恢复、入队和调度 Job
  -> 不直接与 Codex RPC 通信

Runner
  -> 负责消费 scheduler_job_records
  -> 负责连接 Codex RPC
  -> 负责 thread/start、thread/resume、turn/start、approval response、turn/interrupt
  -> 负责将 app-server 事件投影为 Execution Record 和 raw logs

Codex RPC
  -> 负责 Codex runtime、thread、turn、skill input、tool execution、approval request 和事件流
  -> 不直接理解 SpecDrive Feature 队列

Workspace Files
  -> docs/PRD.md 或 docs/<language>/PRD.md
  -> docs/requirements.md 或 docs/<language>/requirements.md
  -> docs/hld.md 或 docs/<language>/hld.md
  -> docs/features/feature-pool-queue.json
  -> docs/features/<feature-id>/spec-state.json
  -> docs/features/<feature-id>/requirements.md / design.md / tasks.md
```

### 7.2 启动与工作区识别流程

```text
VSCode 启动插件
  -> 插件读取 workspace folders
  -> 插件扫描候选 Spec 根目录
      1. docs/<language>/PRD.md
      2. docs/PRD.md
      3. docs/features/README.md
      4. docs/features/feature-pool-queue.json
  -> 插件识别当前项目 workspaceRoot 和 specRoot
  -> 插件连接 SpecDrive Control Plane
  -> Control Plane 返回项目上下文、active adapter、队列摘要、最近 Execution Record
  -> 插件建立文件 watcher
  -> 插件渲染 Spec Explorer
  -> 插件注册 Hover / CodeLens / Comments / Diagnostics
```

规则：

- 多语言项目优先使用用户当前语言目录；未配置语言时优先 `docs/zh-CN/`、`docs/en/`、`docs/ja/` 中第一个完整目录。
- 单语言项目使用 `docs/` 根目录。
- Feature 状态始终从 `docs/features/feature-pool-queue.json` 和 `docs/features/<feature-id>/spec-state.json` 读取。
- 任务队列状态始终从 Control Plane 查询 `scheduler_job_records` 和 `execution_records`，并在 Spec Explorer 中按 Feature/Task 聚合显示。
- Execution Workbench 状态始终从 Control Plane 查询 `scheduler_job_records`、`execution_records`、raw log refs 和 Feature `spec-state.json`，并以 Job 时间线和自动执行控制为主视图。
- 插件只能缓存 UI 状态；文件和 Execution Record 才是可恢复事实。

### 7.3 受控命令通用流程

```text
用户点击 CodeLens / Tree Action / Command Palette
  -> 插件构造 UIAction
  -> 插件解析当前文件、range、选中文本、Feature、Task、workspaceRoot
  -> 插件调用 Control Plane command API
  -> Control Plane 校验 projectId、workspaceRoot、source path、adapter config、权限边界
  -> Control Plane 写 command receipt
  -> Control Plane 根据 action 创建或更新 scheduler_job_records / execution_records / spec-state.json
  -> Control Plane 返回 command receipt id 和可展示状态
  -> 插件刷新 Spec Explorer 和状态面板
```

规则：

- 所有有副作用动作必须经过 Control Plane command API。
- 插件不得直接写 `spec-state.json`、`execution_records` 或 `scheduler_job_records`。
- 查询类动作可以直接读取文件或调用 query API；一旦需要落盘、调度、取消、重试、审批或修改配置，必须走受控命令。

### 7.4 文档澄清与 Spec 变更流程

```text
用户在 PRD / requirements / hld / Feature Spec 中添加 Comment
  -> 插件保存本地 Comment 草稿
  -> 用户点击提交
  -> 插件生成 SpecChangeRequest
  -> Control Plane 校验 range 是否仍匹配原文 textHash
  -> Control Plane 根据 intent 选择 operation
      - clarification
      - requirement_intake
      - spec_evolution
      - generate_ears
      - update_design
      - split_feature
  -> Control Plane 创建 <executor>.run Job
  -> Runner 执行 Codex RPC turn
  -> Codex 根据 Skill 修改文档
  -> Runner 校验 SkillOutputContractV1
  -> Control Plane 更新 spec-state.json 和 Execution Record
  -> 插件将 Comment 标记为 resolved / superseded / failed
```

规则：

- 新需求没有目标 requirement id 时走 requirement intake。
- 已有 requirement id 的修改走 spec evolution。
- 文档写入由 Codex 执行并通过 Git diff 呈现；插件只负责展示和提交意图。
- 如果提交时原文已变化，Control Plane 返回 stale_source，插件要求用户重新确认。

### 7.5 Feature 队列调度流程

```text
用户点击执行 Feature / Scheduler 定时触发
  -> Control Plane 读取 docs/features/feature-pool-queue.json
  -> Scheduler 按 priority、dependencies、status 选择候选 Feature
  -> Scheduler 读取 docs/features/<feature-id>/spec-state.json
  -> Scheduler 检查 requirements.md / design.md / tasks.md 是否存在
  -> Scheduler 检查 blockedReasons 和 dependencies
  -> Scheduler 创建 codex.rpc.run Job
  -> Control Plane 创建 execution_records(status=queued)
  -> 插件显示 Feature = queued
```

规则：

- blocked、failed、approval_needed 的 Feature 必须显式 resume 后才可再次调度。
- 缺失三件套文件时不启动 Codex，直接写 blocked reason。
- Feature/Task 不作为 Job 顶层字段，只能进入 payload context。
- Scheduler 只负责选择和入队，不负责 app-server 通信。

### 7.6 Spec Explorer 任务队列管理流程

```text
插件加载 Task Queue 节点
  -> 插件调用 Control Plane queue query
  -> Control Plane 返回 scheduler_job_records、execution_records、spec-state 摘要
  -> 插件按状态分组显示：
      - queued
      - running
      - approval_needed
      - blocked
      - failed
      - completed
  -> 用户对任务执行队列动作
      - enqueue: 将 ready Feature/Task 加入队列
      - run now: 提升优先级并尽快调度
      - pause: 暂停尚未运行的 Job
      - resume: 恢复 paused/blocked Job 或 Feature
      - retry: 基于上一条 execution id 创建新 Job
      - cancel: 取消 queued/running Job；running 时调用 Runner cancel
      - skip: 跳过当前候选 Feature/Task
      - reprioritize: 调整队列优先级
  -> 插件调用对应 Control Plane command
  -> Control Plane 写 command receipt
  -> Scheduler 更新 scheduler_job_records 或 feature-pool-queue.json
  -> Runner 更新 running execution 或执行 turn/interrupt
  -> 插件刷新 Task Queue 节点和相关 Feature 节点
```

规则：

- Execution Workbench 是任务调度和自动执行的主要操作入口；Spec Explorer 保留轻量树状入口和文件定位；Product Console 只保留队列调试和全局总览。
- 队列动作必须走 Control Plane command API，不允许插件直接改 `feature-pool-queue.json` 或数据库。
- `cancel` 对 queued Job 只更新 Job 状态；对 running Job 必须通过 Runner 调用 `turn/interrupt`。
- `retry` 必须保留上一条 execution id、失败原因和新 execution id 的关系。
- `reprioritize` 只改变调度顺序，不修改 Feature 文档内容。
- Feature `spec-state.json.status` 表示 Feature 当前可见流程状态，`spec-state.json.executionStatus` 表示最近一次执行状态；pause、resume、cancel、skip、approval 和 retry 等队列动作必须同步更新 Execution Record、Scheduler Job、Feature `status` 和 `executionStatus`，避免把执行态变化丢失在队列视图或 Feature 视图任一侧。

### 7.7 Runner 与 Codex RPC 执行流程

```text
Runner 获取 codex.rpc.run Job
  -> Runner 将 execution_records 更新为 running
  -> Runner 解析 active adapter config
  -> Runner 连接已有 app-server 或启动 codex app-server
  -> Runner 发送 initialize request
  -> Runner 发送 initialized notification
  -> Runner 调用 thread/start 或 thread/resume
  -> Runner 调用 turn/start
      input:
        - text: SkillInvocationContractV1 序列化内容和用户意图
        - skill: skill name + SKILL.md path
      outputSchema:
        - SkillOutputContractV1 JSON Schema
  -> Codex RPC 流式返回 turn/item 事件
  -> Runner 持续写 raw logs 和 Execution Record progress
  -> Runner 等待 turn/completed
```

规则：

- Runner 是唯一允许调用 `turn/start` 的 SpecDrive 组件。
- VSCode 插件只能发起受控命令和订阅状态，不能绕过 Runner 与 app-server 交互。
- app-server 进程、thread id、turn id、transport、model、cwd 和 output schema 必须记录到 Execution Record。
- 如果 app-server 无法启动、未登录或协议不兼容，Execution Record 标记 failed，并给出可操作错误。

### 7.8 Approval 交互流程

```text
Codex RPC 发出 approval request
  -> Runner 暂停该 pending request
  -> Runner 写 execution_records.approvalState = pending
  -> Runner 将 approval payload 推给 Control Plane
  -> VSCode 插件订阅到 approval pending
  -> 插件显示命令、cwd、diff、reason、available decisions
  -> 用户选择 accept / acceptForSession / decline / cancel
  -> 插件调用 Control Plane approval command
  -> Control Plane 写 command receipt
  -> Runner 向 app-server 返回 approval response
  -> app-server 继续或终止当前 item
  -> Runner 记录 approval result
```

规则：

- approval pending 必须可恢复；插件重载后仍能重新显示待处理审批。
- 未响应审批不得自动通过。
- `acceptForSession` 只在当前 app-server thread/session 范围生效。
- 审批记录是轻量活动记录，不进入独立审计中心。

### 7.9 完成、输出校验与状态投影流程

```text
app-server 发送 turn/completed
  -> Runner 汇总最终 agent message、raw output、diff summary、command logs
  -> Runner 解析最终 assistant message
  -> Runner 用 outputSchema 校验 SkillOutputContractV1
  -> 校验通过：
      -> 写 execution_records(status=completed, threadId, turnId, summary)
      -> 写 docs/features/<feature-id>/spec-state.json.lastResult
      -> 写 spec-state.json.nextAction / history
      -> 保留 Codex 会话记录和 raw logs reference
      -> 插件刷新 Spec Explorer、Diagnostics、状态面板
  -> 校验失败：
      -> 写 execution_records(status=failed, error=output_schema_invalid)
      -> 保留 raw output
      -> 插件显示可重试状态
```

规则：

- 不额外生成 Evidence Pack。
- 聊天记录、app-server 事件流、raw logs 和 Execution Record 共同构成执行证据。
- `spec-state.json` 只保存 Feature 级机器状态，不保存完整聊天内容。

### 7.10 失败、重试与恢复流程

```text
Runner / app-server / SkillOutputContract 失败
  -> Runner 写 execution_records(status=failed, error)
  -> Control Plane 根据错误类型更新 spec-state.json
      - blocked: 环境、路径、缺少文件、依赖未满足
      - failed: Codex 执行失败、schema 校验失败、测试失败
      - approval_needed: 等待用户审批
  -> 插件在 Spec Explorer 和 Diagnostics 标记失败位置
  -> 用户选择 retry / resume / request clarification
  -> Control Plane 创建新的 command receipt 和 Job
  -> Runner 使用已有 threadId resume 或创建新 thread
```

规则：

- retry 必须引用上一条 execution id。
- resume blocked Feature 必须清除或更新 blocked reason。
- request clarification 必须落到 Comment 或 SpecChangeRequest。
- 不自动无限重试；重试策略由 Scheduler 配置控制。

### 7.11 状态刷新与双入口同步流程

```text
文件或运行状态变化
  -> 文件 watcher 捕获 docs/features 或 Spec 文档变化
  -> 插件刷新 Spec Explorer 和 Diagnostics
  -> Control Plane 查询接口返回最新 execution_records 和 queue summary
  -> Product Console 和 VSCode 插件读取同一事实源
  -> 任一入口触发的受控命令都会更新 command receipt
  -> 另一入口通过查询或订阅刷新状态
```

规则：

- Product Console 和 VSCode 插件是两个 UI 入口，不是两个状态系统。
- Product Console 继续承担系统设置、adapter 配置、队列调试和全局状态总览。
- VSCode 插件承担日常 Spec 阅读、澄清、任务队列管理、任务执行和运行观察。
- VSCode 插件内的 Execution Workbench 承担任务调度和自动执行主界面，必须作为独立 Webview Web UI 开发，不复用 Product Console Web UI。
- 冲突以 workspace 文件、Execution Record 和 command receipt 为准。

## 8. 功能需求

### REQ-VSC-001：识别 SpecDrive 工作区

WHEN 用户打开 VSCode 工作区
THE SYSTEM SHALL 识别当前目录是否包含 SpecDrive 文档结构和 `.autobuild` 运行状态。

验收：
- [ ] 支持多语言结构：`docs/<language>/PRD.md`、`docs/<language>/requirements.md`、`docs/<language>/hld.md`，例如 `docs/zh-CN/`、`docs/en/`、`docs/ja/`。
- [ ] 支持单语言结构：`docs/PRD.md`、`docs/requirements.md`、`docs/hld.md`。
- [ ] 能识别 `docs/features/README.md`、`docs/features/feature-pool-queue.json` 和各 Feature `spec-state.json`。
- [ ] 未识别到 SpecDrive 项目时，插件显示初始化或连接提示，不执行调度。

### REQ-VSC-002：提供 Spec Explorer

WHEN 工作区被识别为 SpecDrive 项目
THE SYSTEM SHALL 在 VSCode Activity Bar 或 Explorer 中展示 Spec Explorer。

验收：
- [ ] 左侧树显示 PRD、EARS Requirements、HLD、Feature Specs。
- [ ] Feature 节点显示 status、priority、dependencies、blocked reason 和最近执行结果。
- [ ] Feature 下显示 `requirements.md`、`design.md`、`tasks.md`、`spec-state.json` 和最近 Codex 会话。
- [ ] 点击节点打开对应文件或状态面板。

### REQ-VSC-003：在 Spec Explorer 中管理任务队列

WHEN 用户展开 Spec Explorer 的 Task Queue 节点
THE SYSTEM SHALL 展示并管理 Feature/Task 执行队列。

验收：
- [ ] Task Queue 节点显示 queued、running、approval_needed、blocked、failed、completed 分组。
- [ ] 每个任务显示 Feature、Task、operation、priority、adapter、scheduler job id、execution id、thread id、turn id 和最近状态。
- [ ] 用户可以在 Spec Explorer 中触发 enqueue、run now、pause、resume、retry、cancel、skip、reprioritize 和 refresh。
- [ ] queued Job 的 cancel 只更新 Job 状态；running Job 的 cancel 必须通过 Runner 调用 `turn/interrupt`。
- [ ] retry 必须引用上一条 execution id，并创建新的 Job 和 Execution Record。
- [ ] 缺失三件套文件的 Feature 显示 blocked，不允许直接执行。
- [ ] 队列管理动作必须走 Control Plane command API，不允许插件直接写数据库或队列文件。

### REQ-VSC-004：提供文档 Hover

WHEN 用户将鼠标悬停在 PRD、requirements、HLD 或 Feature Spec 的行/段落上
THE SYSTEM SHALL 显示该行关联的 requirement、Feature、traceability、状态和可用动作。

验收：
- [ ] 对包含 `REQ-*` 的行显示 requirement 元数据。
- [ ] 对 Feature 文档行显示 Feature id 和当前 spec-state。
- [ ] Hover 不修改文件，只显示读取结果。

### REQ-VSC-005：提供文档 CodeLens

WHEN 用户打开 Spec 文档
THE SYSTEM SHALL 在可操作行上提供 CodeLens。

验收：
- [ ] PRD 段落支持 `添加澄清`、`生成/更新 EARS`。
- [ ] EARS 需求支持 `更新设计`、`拆分 Feature`、`查看追踪`。
- [ ] Feature `tasks.md` 任务支持 `执行任务`、`标记阻塞`、`请求恢复`。
- [ ] CodeLens 动作必须转换为受控命令，不得直接修改运行状态。

### REQ-VSC-006：支持行级澄清 Comments

WHEN 用户在文档行或段落上添加澄清
THE SYSTEM SHALL 使用 VSCode Comments API 保存澄清草稿，并可提交到 SpecDrive。

验收：
- [ ] Comment 包含文件路径、range、原文片段、问题、建议答案、用户答案和状态。
- [ ] 提交后生成 `ClarificationItem` 并进入受控命令。
- [ ] Codex 修改文档后 Comment 标记为 resolved 或 superseded。

### REQ-VSC-007：支持 Diagnostics

WHEN 插件扫描 Spec 文档
THE SYSTEM SHALL 用 Diagnostics 标记缺失、冲突、未追踪和执行失败信息。

验收：
- [ ] 缺失 requirement id、缺失 acceptance criteria、缺失 tasks 三件套时显示 warning。
- [ ] blocked / failed Feature 对应文件或节点显示 problem marker。
- [ ] Diagnostics 必须来自文件扫描、spec-state 或 Control Plane 查询结果。

### REQ-VSC-008：提交 Spec 变更请求

WHEN 用户提交澄清、需求变更或设计更新
THE SYSTEM SHALL 生成 SpecChangeRequest，并通过 Control Plane 创建对应 Scheduler Job。

验收：
- [ ] 新需求使用 requirement-intake 路径。
- [ ] 现有 requirement 修改使用 spec-evolution 路径。
- [ ] 生成 EARS、HLD、UI Spec、Feature Split 均作为 `<executor>.run` Job 创建。
- [ ] 执行前写入 command receipt 和 execution record。

### REQ-VSC-009：触发 Feature 执行

WHEN 用户点击执行 Feature 或执行 Task
THE SYSTEM SHALL 生成 SkillInvocationContractV1 并交给现有 Scheduler / Runner。

验收：
- [ ] Contract 包含 `workspaceRoot`、`featureId`、`sourcePaths`、`expectedArtifacts`、`specState`、`traceability` 和 `requestedAction`。
- [ ] 执行 Job 的 executor 为 `codex.rpc.run` 或兼容的 adapter id。
- [ ] Feature/Task 不作为 Job 顶层字段，只出现在 payload context 中。

### REQ-VSC-010：Codex RPC Adapter

WHEN Scheduler 分派 `codex.rpc.run` Job
THE SYSTEM SHALL 通过 Codex RPC JSON-RPC 调用 Codex。

验收：
- [ ] Adapter 能启动或连接 `codex app-server`。
- [ ] Adapter 完成 initialize / initialized 握手。
- [ ] Adapter 支持 `thread/start`、`thread/resume`、`turn/start`、`turn/interrupt`。
- [ ] Adapter 在 `turn/start` 中传入 skill input item 和 text prompt。
- [ ] Adapter 支持 `outputSchema` 约束 `SkillOutputContractV1`。

### REQ-VSC-011：Runner 与 Codex RPC 交互

WHEN Runner 执行 `codex.rpc.run` Job
THE SYSTEM SHALL 由 Runner 负责 app-server 生命周期、JSON-RPC 会话、事件订阅和结果回写。

验收：
- [ ] Runner 从 Job payload 读取 `workspaceRoot`、`requestedAction`、`skillSlug`、`sourcePaths`、`specState` 和 `outputSchema`。
- [ ] Runner 先解析 active adapter config；若未配置外部 app-server endpoint，则按配置启动 `codex app-server --listen stdio://` 或本地 socket。
- [ ] Runner 完成 `initialize` request 和 `initialized` notification，并记录 app-server 版本、transport 和 client info。
- [ ] Runner 为新执行创建或恢复 thread：有 `threadId` 时调用 `thread/resume`，否则调用 `thread/start` 并保存返回的 `thread.id`。
- [ ] Runner 使用 `turn/start` 发送用户输入；输入必须包含 Contract 文本和 `skill` input item。
- [ ] Runner 订阅并消费 app-server server-initiated events 与 approval requests。
- [ ] Runner 将 `threadId`、`turnId`、最终状态、摘要、错误和输出 JSON 写回 Execution Record。
- [ ] Runner 不额外生成 Evidence Pack；完整证据以 Codex 会话记录、app-server 事件流和 raw logs 为准。

### REQ-VSC-012：收集 Codex 事件流

WHEN Codex turn 正在运行
THE SYSTEM SHALL 监听 app-server 事件并投影到 Execution Record。

验收：
- [ ] 支持 `turn/started`、`turn/completed`。
- [ ] 支持 `item/started`、`item/completed`。
- [ ] 支持 `item/agentMessage/delta`。
- [ ] 支持 `turn/diff/updated`。
- [ ] 支持 `item/commandExecution/outputDelta`。
- [ ] 事件被写入 raw logs 或等价运行日志。

### REQ-VSC-013：处理审批请求

WHEN app-server 发出命令、文件变更或权限审批请求
THE SYSTEM SHALL 在 VSCode UI 中显示审批卡片并返回用户决策。

验收：
- [ ] 命令审批显示 command、cwd、reason、risk 和可选决策。
- [ ] 文件变更审批显示文件路径和 diff 摘要。
- [ ] 用户决策写入 execution record 和 activity log。
- [ ] 未响应审批不得自动通过。

### REQ-VSC-014：实时状态面板

WHEN 用户打开某个 Execution Record
THE SYSTEM SHALL 在 VSCode Webview 或编辑器面板中显示运行详情。

验收：
- [ ] 显示 Job id、Execution id、Feature id、Task id、adapter、status、start/end time。
- [ ] 显示 agent message、plan、diff、命令输出、聊天记录入口和错误。
- [ ] 支持取消运行和打开相关文档。

### REQ-VSC-015：结果投影

WHEN Codex 输出 SkillOutputContractV1
THE SYSTEM SHALL 校验输出并投影回文件化 Spec 状态和运行事实。

验收：
- [ ] 成功输出更新 `spec-state.json.lastResult`、`nextAction` 和 `history`。
- [ ] 产物文件写入 workspace 相对路径，并记录 producedArtifacts。
- [ ] Execution Record 写入 thread id、turn id、status、summary、producedArtifacts 和 raw output reference。
- [ ] 校验失败时 Execution Record 标记 failed，并保留原始输出。

### REQ-VSC-016：保留 Product Console

WHEN VSCode 插件启用
THE SYSTEM SHALL 保留 Product Console 作为系统设置、队列调试和状态总览入口。

验收：
- [ ] VSCode 插件不要求删除 Product Console 页面。
- [ ] CLI Adapter 配置仍可在 Product Console 系统设置中管理。
- [ ] VSCode 插件可读取当前 active adapter 配置。

### REQ-VSC-017：提供独立 Execution Workbench Webview

WHEN 用户在 VSCode 中打开 SpecDrive 任务执行入口
THE SYSTEM SHALL 展示独立于 Product Console 的 Execution Workbench Webview，用于任务调度和自动执行控制。

验收：
- [ ] Webview 使用独立前端入口、布局、状态模型和组件，不复用 Product Console 的页面、路由、导航或组件实现。
- [ ] 第一屏默认展示 Job 队列、当前运行、下一步动作、阻塞原因、自动执行开关和审批待办。
- [ ] 用户可以从 Webview 发起 enqueue、run now、auto run、pause automation、resume automation、retry、cancel、skip 和 reprioritize。
- [ ] Webview 通过 extension host 调用 Control Plane query/command API，不直接访问 SQLite、Scheduler 内部队列或运行状态文件。
- [ ] Webview 可以复用 shared contract/type 定义，但不得把 Product Console ViewModel 当作插件 UI 的事实源。

## 9. 数据与 Contract

### 8.1 SpecChangeRequest

```json
{
  "schemaVersion": 1,
  "projectId": "project-1",
  "workspaceRoot": "/path/to/project",
  "source": {
    "file": "docs/PRD.md",
    "range": {
      "startLine": 42,
      "endLine": 48
    },
    "textHash": "sha256:..."
  },
  "intent": "clarification|requirement_intake|spec_evolution|generate_ears|update_design|split_feature",
  "comment": "这里的验收标准需要补充失败恢复。",
  "targetRequirementId": "REQ-040",
  "traceability": ["PRD-Section-6", "FEAT-008"]
}
```

### 8.2 Codex RPC Turn 输入

```json
{
  "method": "turn/start",
  "params": {
    "threadId": "thread-id",
    "cwd": "/path/to/project",
    "input": [
      {
        "type": "text",
        "text": "$spec-evolution-skill 根据以下 SkillInvocationContractV1 修改文档..."
      },
      {
        "type": "skill",
        "name": "spec-evolution-skill",
        "path": "/path/to/.agents/skills/spec-evolution-skill/SKILL.md"
      }
    ],
    "outputSchema": {}
  }
}
```

### 8.3 Execution 映射

| App Server Event | SpecDrive Projection |
|---|---|
| `thread/started` | 记录 thread id 和会话来源 |
| `turn/started` | Execution Record -> running |
| `item/agentMessage/delta` | raw logs / live output |
| `turn/diff/updated` | diff snapshot / chat-visible change summary |
| `item/commandExecution/outputDelta` | command log |
| approval request | approval pending |
| `turn/completed` completed | 解析 SkillOutputContractV1 |
| `turn/completed` failed | Execution Record -> failed |

### 8.4 Runner 与 app-server 时序

```text
Scheduler
  -> create scheduler_job_records
  -> create execution_records(status=queued, adapter=codex.rpc)
  -> Runner picks job
  -> Runner resolves adapter config
  -> Runner starts/connects codex app-server
  -> initialize / initialized
  -> thread/start or thread/resume
  -> turn/start(input=[text contract, skill item], outputSchema=SkillOutputContractV1)
  -> stream turn/item events
  -> handle approval requests
  -> turn/completed
  -> validate final output
  -> update spec-state.json and execution_records
```

Runner 是持久调度和 Codex RPC 之间的唯一执行边界。VSCode 插件可以发起命令和展示状态，但不得直接调用 `turn/start` 绕过 Runner；否则 Execution Record、重试、取消、状态投影和失败恢复会失去统一事实源。

## 10. 非功能需求

### NFR-VSC-001：可靠性

- 插件重载或 VSCode 关闭后，执行事实必须可从 Control Plane 和 Execution Record 恢复。
- App-server 连接中断时，Adapter 应记录失败并允许 retry/resume。

### NFR-VSC-002：安全

- 不允许插件绕过 Scheduler 直接写运行状态。
- 所有有副作用操作必须走受控命令和 command receipt。
- app-server 审批请求必须由用户明确处理。
- Workspace 路径必须限制在当前项目根目录或受信任 worktree。

### NFR-VSC-003：性能

- Spec Explorer 首次加载目标小于 2 秒。
- 文档 Hover 和 CodeLens 不应阻塞编辑器输入。
- 大型日志必须增量渲染，不一次性加载完整 raw log。

### NFR-VSC-004：兼容性

- 当前版本支持 VSCode。
- 不依赖 Codex VS 插件安装。
- Codex RPC 版本差异通过生成 schema 或 adapter capability 检测处理。

### NFR-VSC-005：可观测性

- Adapter 连接、thread、turn、approval、output parsing 和 projection 均应记录活动事件。
- 失败应显示可操作原因：app-server 未启动、未登录、schema 不兼容、approval timeout、output schema 校验失败。

## 11. 交付范围

首个交付版本必须包含：

1. VSCode 插件基础框架。
2. SpecDrive 工作区识别。
3. Spec Explorer。
4. Execution Workbench 独立 Webview。
5. Spec Explorer Task Queue 轻量入口。
6. PRD/EARS/HLD/Feature Spec 文件导航。
7. `spec-state.json`、`feature-pool-queue.json`、scheduler job 和 execution 状态显示。
8. 文档 CodeLens：添加澄清、执行 Feature、执行 Task。
9. Comments API 澄清提交。
10. Codex RPC Adapter。
11. Execution Record 状态面板。
12. app-server 事件流写入 raw logs / execution records。
13. SkillOutputContractV1 校验和结果投影。

后续版本可扩展：

- 完整 Diagnostics 规则集。
- 多语言 UI。
- 图形化任务依赖图。
- 云端协作。
- 与 Codex VS 插件 Chat UI 的深度联动。
- 复杂 diff review UI。

## 12. 成功指标

- 用户无需打开 Product Console，即可完成一次 Feature 执行。
- 用户无需打开 Product Console，即可在 VSCode 插件独立 Webview 中完成任务调度、自动执行暂停/恢复、审批处理和执行观察。
- 用户可以在 VSCode 中定位 PRD/EARS/HLD/Feature/task 与执行状态。
- 用户可以在 Spec Explorer 中管理任务队列，包括 enqueue、run now、pause、resume、retry、cancel、skip 和 reprioritize。
- 用户可以在文档段落上提交澄清，并由 Codex 修改对应文档。
- Codex RPC Adapter 可以完成至少一种 Skill 调用并写回 `spec-state.json`。
- Execution Record 能展示 thread、turn、事件、输出、结果和聊天记录入口。
- 插件重载后仍能恢复最近执行状态。

## 13. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Codex RPC 协议版本变化 | Adapter 失效 | 启动时读取 capability/schema，按版本适配；保留 CLI Runner fallback。 |
| VSCode 插件承载过多调度逻辑 | 状态漂移 | 插件只做 UI 和 Adapter，调度事实仍在 Control Plane。 |
| 用户以为复用了 Codex VS Chat UI | 体验预期偏差 | 产品文案明确 SpecDrive 使用 Codex runtime，不操作 Codex VS 私有 UI。 |
| 长日志导致 UI 卡顿 | 执行状态不可用 | 日志增量流式渲染，按 Execution Record 分页读取。 |
| 审批请求丢失 | 安全风险 | approval pending 写入 Execution Record，插件重连后恢复审批卡片。 |

## 14. 阶段计划

### Phase 1：IDE 只读入口

- 工作区识别。
- Spec Explorer。
- 文件导航。
- Feature 队列和 spec-state 展示。

### Phase 2：文档交互

- Hover。
- CodeLens。
- Comments API 澄清。
- SpecChangeRequest 生成。

### Phase 3：Codex RPC Adapter

- app-server 启动/连接。
- initialize / thread/start / turn/start。
- 事件流收集。
- outputSchema 校验。

### Phase 4：执行闭环

- Feature / Task 执行。
- Execution Record 面板。
- approval UI。
- Codex 会话记录和 spec-state 投影。

### Phase 5：体验增强

- Diagnostics。
- Diff 查看。
- 日志搜索。
- 状态过滤。
- Product Console 与 VSCode 插件双向跳转。

## 15. 决策结论

本方案采用“SpecDrive VSCode 插件 + Codex RPC Adapter”的第二种集成方式：

- 不复用 Codex VS 插件私有 Chat UI。
- 不模拟输入框。
- 不重写 Runner 和 Scheduler。
- 通过 Codex RPC 复用 Codex runtime、thread、turn、事件、审批和 Skill 输入能力。
- 通过 SpecDrive Control Plane 保持调度、执行状态和文件化 Spec 状态的真实来源。

该方案将交互体验放回 IDE，把自主编程的可靠性留在 SpecDrive 控制面，是当前阶段最稳妥、最容易落地的产品方向。
