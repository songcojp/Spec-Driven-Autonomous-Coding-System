# Feature Spec Index: SpecDrive AutoBuild

本文依据 `docs/zh-CN/PRD.md`、`docs/zh-CN/requirements.md`、`docs/zh-CN/hld.md` 和 `docs/zh-CN/design.md` 拆分 MVP Feature Spec。拆分原则为垂直可验收、需求可追踪、实现边界清晰，并优先沿 HLD 第 15 节建议的子系统边界落地。

| Feature ID | Feature | Folder | Status | Primary Requirements | Suggested Milestone | Dependencies |
|---|---|---|---|---|---|---|
| FEAT-000 | System Bootstrap | `feat-000-system-bootstrap` | done | REQ-011、REQ-058、NFR-004 | M0 | None |
| FEAT-001 | Project and Repository Foundation | `feat-001-project-repository-foundation` | pending | REQ-001 至 REQ-003 | M1 | FEAT-000 |
| FEAT-002 | Spec Protocol Foundation | `feat-002-spec-protocol-foundation` | done | REQ-004 至 REQ-009 | M1 | FEAT-000 |
| FEAT-003 | Skill Center and Schema Governance | `feat-003-skill-center-schema-governance` | pending | REQ-010 至 REQ-013 | M1 | FEAT-000 |
| FEAT-004 | Orchestration and State Machine | `feat-004-orchestration-state-machine` | pending | REQ-024 至 REQ-034 | M2 | FEAT-001、FEAT-002、FEAT-003、FEAT-014 |
| FEAT-005 | Subagent Runtime and Context Broker | `feat-005-subagent-runtime-context-broker` | pending | REQ-014 至 REQ-018、REQ-055 | M3 | FEAT-004、FEAT-007 |
| FEAT-006 | Project Memory and Recovery Projection | `feat-006-project-memory-recovery-projection` | pending | REQ-019 至 REQ-023、REQ-036 | M3 | FEAT-004 |
| FEAT-007 | Workspace Isolation | `feat-007-workspace-isolation` | pending | REQ-017、REQ-032、REQ-035 | M3/M4 | FEAT-004 |
| FEAT-008 | Codex Runner | `feat-008-codex-runner` | pending | REQ-037 至 REQ-039、REQ-056 | M4 | FEAT-005、FEAT-007 |
| FEAT-009 | Status Checker and Evidence | `feat-009-status-checker-evidence` | pending | REQ-040 至 REQ-042、REQ-051 | M5 | FEAT-004、FEAT-008 |
| FEAT-010 | Failure Recovery | `feat-010-failure-recovery` | pending | REQ-043 至 REQ-045 | M5 | FEAT-008、FEAT-009 |
| FEAT-011 | Review Center | `feat-011-review-center` | pending | REQ-046、REQ-047、REQ-057 | M6 | FEAT-004、FEAT-009 |
| FEAT-012 | Delivery and Spec Evolution | `feat-012-delivery-spec-evolution` | pending | REQ-048 至 REQ-050 | M6 | FEAT-009、FEAT-011 |
| FEAT-013 | Product Console | `feat-013-product-console` | pending | REQ-052 至 REQ-056 | M2-M6 | FEAT-001、FEAT-004、FEAT-005、FEAT-008 |
| FEAT-014 | Persistence and Auditability | `feat-014-persistence-auditability` | pending | REQ-058、NFR-003 至 NFR-012 | Cross-cutting | FEAT-000 |

## Dependency Order

1. FEAT-000 bootstraps the control-plane runtime, artifact root and schema foundation.
2. FEAT-001, FEAT-002, FEAT-003 and FEAT-014 establish the project, spec, skill and persistence foundations.
3. FEAT-004 turns ready specs into schedulable task graphs and state transitions.
4. FEAT-005, FEAT-006 and FEAT-007 provide bounded execution context, memory projection and workspace isolation.
5. FEAT-008 enables Codex execution.
6. FEAT-009 and FEAT-010 close the check and recovery loop.
7. FEAT-011 and FEAT-012 provide approval and delivery closure.
8. FEAT-013 exposes the operational surfaces over the control-plane state.
