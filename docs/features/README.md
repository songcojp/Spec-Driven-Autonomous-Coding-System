# Feature Spec Index: SpecDrive AutoBuild

本文依据 `docs/zh-CN/PRD.md`、`docs/zh-CN/requirements.md`、`docs/zh-CN/hld.md` 和 `docs/zh-CN/design.md` 拆分 MVP Feature Spec。拆分原则为垂直可验收、需求可追踪、实现边界清晰，并优先沿 HLD 第 15 节建议的子系统边界落地。

| Feature ID | Feature | Folder | Status | Primary Requirements | Suggested Milestone | Dependencies |
|---|---|---|---|---|---|---|
| FEAT-000 | System Bootstrap | `feat-000-system-bootstrap` | done | REQ-011、REQ-058、NFR-004 | M0 | None |
| FEAT-001 | Project and Repository Foundation | `feat-001-project-repository-foundation` | in-progress | REQ-001 至 REQ-003、REQ-059、REQ-063 | M1 | FEAT-000 |
| FEAT-002 | Spec Protocol Foundation | `feat-002-spec-protocol-foundation` | done | REQ-004 至 REQ-009 | M1 | FEAT-000 |
| FEAT-003 | CLI Skill Directory Discovery | `feat-003-skill-center-schema-governance` | done | REQ-010 至 REQ-013 | M1 | FEAT-000 |
| FEAT-004 | Orchestration and State Machine | `feat-004-orchestration-state-machine` | done | REQ-024 至 REQ-034、REQ-060 | M2 | FEAT-001、FEAT-002、FEAT-014 |
| FEAT-005 | CLI Subagent Audit Integration | `feat-005-subagent-runtime-context-broker` | done | REQ-014 至 REQ-018、REQ-055 | M3 | FEAT-004、FEAT-007 |
| FEAT-006 | Project Memory and Recovery Projection | `feat-006-project-memory-recovery-projection` | done | REQ-019 至 REQ-023、REQ-036 | M3 | FEAT-004 |
| FEAT-007 | Workspace Isolation | `feat-007-workspace-isolation` | done | REQ-017、REQ-032、REQ-035 | M3/M4 | FEAT-004 |
| FEAT-008 | Codex Runner | `feat-008-codex-runner` | done | REQ-037 至 REQ-039、REQ-056 | M4 | FEAT-007 |
| FEAT-009 | Status Checker and Evidence | `feat-009-status-checker-evidence` | done | REQ-040 至 REQ-042、REQ-051 | M5 | FEAT-004、FEAT-008 |
| FEAT-010 | Failure Recovery | `feat-010-failure-recovery` | in-progress | REQ-043 至 REQ-045 | M5 | FEAT-008、FEAT-009 |
| FEAT-011 | Review Center | `feat-011-review-center` | done | REQ-046、REQ-047、REQ-057 | M6 | FEAT-004、FEAT-009 |
| FEAT-012 | Delivery and Spec Evolution | `feat-012-delivery-spec-evolution` | done | REQ-048 至 REQ-050 | M6 | FEAT-009、FEAT-011 |
| FEAT-013 | Product Console | `feat-013-product-console` | done | REQ-052 至 REQ-056、REQ-061 至 REQ-063 | M2-M7 | FEAT-001、FEAT-004、FEAT-008 |
| FEAT-014 | Persistence and Auditability | `feat-014-persistence-auditability` | done | REQ-058、NFR-003 至 NFR-012 | Cross-cutting | FEAT-000 |

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
    │   └── FEAT-008 Codex Runner
    │       ├── FEAT-009 Status Checker and Evidence
    │       │   (also requires FEAT-004)
    │       │   ├── FEAT-010 Failure Recovery
    │       │   │   (also requires FEAT-008)
    │       │   └── FEAT-011 Review Center
    │       │       (also requires FEAT-004)
    │       │       └── FEAT-012 Delivery and Spec Evolution
    │       │           (also requires FEAT-009)
    │       └── FEAT-013 Product Console
    │           (also requires FEAT-001, FEAT-004)
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

## Delivery Order

1. FEAT-000 bootstraps the control-plane runtime, artifact root and schema foundation.
2. FEAT-001, FEAT-002, FEAT-003 and FEAT-014 establish the project, spec, CLI skill discovery and persistence foundations.
3. FEAT-004 turns ready specs into schedulable task graphs and state transitions.
4. FEAT-005, FEAT-006 and FEAT-007 provide CLI delegation observation, memory projection and workspace isolation.
5. FEAT-008 enables Codex execution.
6. FEAT-009 and FEAT-010 close the check and recovery loop.
7. FEAT-011 and FEAT-012 provide approval and delivery closure.
8. FEAT-013 exposes the operational surfaces over the control-plane state.

## Spec Evolution Notes

| Item | Feature | Decision | Follow-up |
|---|---|---|---|
| ADD-001 | FEAT-001 | 项目宪章创建、导入和生命周期管理作为 FEAT-001 patch 处理，不拆分独立 Feature。 | 执行 `feat-001-project-repository-foundation/tasks.md` 中的 `TASK-009` 至 `TASK-011`。 |
| CHG-001 | FEAT-001 | Project `trust_level` 属于项目基础数据模型 patch，不拆分新 Feature。 | 执行 `feat-001-project-repository-foundation/tasks.md` 中的 `TASK-012`。 |
| ADD-002 | FEAT-004 | 调度触发模式作为 FEAT-004 patch 处理，不拆分独立 Feature。MVP 已实现触发记录、手动入口和时间类入口；CI 失败、审批通过、依赖完成先记录为受控事件触发请求，不直接绕过调度边界。 | 已执行 `feat-004-orchestration-state-machine/tasks.md` 中的 `TASK-010` 至 `TASK-012`。 |
| CHG-003 | FEAT-004 | `quickstart-validation` 与 `spec-consistency-analysis` 作为后续 Orchestration patch 处理。 | 后续执行计划流水线强制阶段任务。 |
| CHG-002 / CHG-004 | FEAT-007 | 并行写入策略和测试资源隔离属于 Workspace Isolation 安全边界 patch。 | 执行 `feat-007-workspace-isolation/tasks.md` 中的 `TASK-009` 至 `TASK-010`。 |
| ADD-003 / CHG-005 | FEAT-013 | Dashboard Board 操作和入口作为 Product Console patch 处理，所有写操作走受控命令。 | 已执行 `feat-013-product-console/tasks.md` 中的 `TASK-010` 至 `TASK-011`。 |
| ADD-004 | FEAT-013 | Product Console 增加界面多语言切换，首次打开默认中文；Evidence、diff、日志、路径、命令输出和用户输入保持原文。 | 已执行 `feat-013-product-console/tasks.md` 中的 `TASK-017` 至 `TASK-019`。 |
| ADD-005 | FEAT-001 / FEAT-013 | 支持导入现有项目、在统一 `workspace/` 目录下创建新项目，并在 Product Console 中切换当前项目上下文；所有查询、命令、Memory 投影和调度入口按 `project_id` 隔离。 | Product Console UI 已执行 `TASK-020` 至 `TASK-022`；FEAT-001 仍需执行 `TASK-013` 至 `TASK-016` 补项目目录/上下文持久化与初始化目录规则。 |
| CHG-009 | FEAT-013 | 当前 Product Console 实现只覆盖 Control Plane API 和 ViewModel，不能替代 PRD 第 8 节要求的用户可操作 UI。 | 已补真实前端应用、页面路由、shadcn/ui 组件体系和浏览器级验收。 |
| CHG-007 | FEAT-010 | 失败重试上限、2/4/8 分钟退避和失败指纹已由现有实现与测试覆盖。 | 无需重新执行 Feature Spec。 |
| CHG-006 / CHG-008 | Mainline Docs | Issue Tracker 非目标和性能阈值基线记录是文档约束，不形成实现任务。 | 无需执行 Feature Spec。 |
