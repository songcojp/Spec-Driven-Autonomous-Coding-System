# PRD: Spec-Driven Autonomous Coding System

Version: V2.0
Status: Official Draft
Product Name: SpecDrive AutoBuild
Product Direction: Spec + CLI Skill + CLI Subagent Driven Long-Running Autonomous Coding System

---

## 1. Product Definition

SpecDrive AutoBuild is a long-running autonomous coding system designed for software teams. The system uses structured Spec to manage product goals and acceptance criteria, project-local CLI Skills to solidify reusable engineering methods, CLI-native Subagents to handle delegation and context transfer, Project Memory to provide persistent memory across sessions, Codex Runner to execute code modifications, testing, and fixing, and an internal task state machine to manage task flow, approval, recovery, and delivery while the Dashboard presents that state.

Core Conclusion:

```text
Spec Protocol
+ CLI Skill Directory
+ CLI Subagent Delegation
+ Project Memory
+ Codex Runner
+ Internal Task State Machine
+ Dashboard View
```

One-line Positioning:

> Enable AI to continuously deliver code within a controllable, recoverable, and auditable engineering workflow.

---

## 2. Product Goals

### 2.1 Core Goals

1. Automatically generate structured Feature Spec after user inputs natural language requirements.
2. Automatically select the next pending Feature Spec based on priority and readiness.
3. Automatically drive the Feature Spec pipeline: Tech Plan → Task Graph → Dashboard → Scheduling.
4. Generate technical plans, task graphs, acceptance criteria, and risk rules based on Spec.
5. Slice large tasks into schedulable tasks that can be delegated through CLI-native Subagents.
6. Record durable run, evidence, status, review, and recovery state without re-implementing CLI context slicing.
7. Codex Runner executes code modifications, testing, fixes, and PR generation.
8. Status Checker automatically determines if tasks are done, failed, blocked, or need review.
9. Dashboard displays real-time task status and delivery progress maintained by the internal task state machine.
10. System injects Project Memory per CLI session to recover goals, decisions, and blocked states.
11. Support long-running tasks, failure retries, breakpoint recovery, and delivery auditing.

### 2.2 Non-Goals

MVP does not include:
* Proprietary LLMs.
* Proprietary full IDE.
* Enterprise complex permission matrix.
* Automatic production deployment.
* Complex microservices auto-migration across multiple large repos.
* Complete replacement of Jira, GitHub Issues, or Linear.

---

## 3. Core Architecture

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
CLI Subagent Delegation              │
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
        ├── Review Needed → approval / clarification / risk_review
        ├── Blocked → unblock workflow or alternate task
        └── Failed → recovery workflow or manual review
        ↓                           │
PR / Delivery Report / Spec Evolution│
        ↓                           │
Feature Selector ◀───────────────────┘
```

---

## 4. Core Concepts

### 4.1 Spec Protocol
Internal protocol for requirements, planning, acceptance, and execution evidence. Single source of truth. Includes Product Brief, Feature Spec, Clarification Log, Checklist, Tech Plan, Task Graph, Acceptance Criteria, Evidence, etc.

### 4.2 Skill System
Reusable engineering capabilities live in project-local `.agents/skills/*/SKILL.md` files. Codex CLI owns Skill discovery and invocation; SpecDrive only discovers Skill metadata for readiness checks and Console display.

### 4.3 Subagent Runtime
Subagent delegation is CLI-native. SpecDrive does not create Agent Run Contracts or context slices; it records run events, evidence, status checks, review decisions, recovery attempts, and audit history around CLI execution.

### 4.4 Project Memory
Persistent project-level memory for CLI long-running sessions, stored in `.autobuild/memory/project.md`. Injects current goals, board status snapshot, and active blockers to prevent repeated repo exploration.

### 4.5 Evidence Pack
Structured output for each Subagent Run, utilized for state judgment, approvals, and reports.

---

## 5. User Workflow
Phase 1: Project Initialization -> Phase 2: Requirement Intake -> Phase 3: Autonomous Execution Loop.
The system continuously routes through scheduling, planning, implementing, and delivery without forced human interaction unless Review Needed.

---

## 6. Functional Requirements

### 6.1 Project Management
* **FR-001**: Create AutoBuild Project.
* **FR-002**: Connect Git Repositories.
* **FR-003**: Project Health Check.

### 6.2 Spec Protocol Engine
* **FR-010**: Create Feature Spec.
* **FR-011**: PR/EARS Requirement Decomposition.
* **FR-012**: Spec Slicing.
* **FR-013**: Clarification Log.
* **FR-014**: Requirement Checklist.
* **FR-015**: Spec Versioning.

### 6.3 Skill Center
* **FR-020**: Project-local Skill discovery from `.agents/skills/*/SKILL.md`.
* **FR-021**: CLI Skill files are the source of truth for reusable workflow behavior.
* **FR-022**: Skill execution contracts are owned by Codex CLI and the Skill file, not a SQL registry.
* **FR-023**: Skill changes are governed through file review and git history.

### 6.4 Subagent Runtime
* **FR-030**: Subagent Types (Spec, Architecture, Coding, Test, etc).
* **FR-031**: CLI-native Subagent delegation and event observation.
* **FR-032**: Subagent Parallelism Strategy (Worktrees required for parallel writing).
* **FR-033**: Status Checker and Evidence determine durable task outcomes.

### 6.5 Project Memory
* **FR-044 - FR-048**: Memory initialization, injection, updates, size limits (8000 tokens), and versioning.

### 6.6 Feature Pipeline & Selection
* **FR-054**: Feature State Machine (draft -> ready -> planning -> tasked -> implementing -> done).
* **FR-055**: Feature Selector (Priority/Readiness based).
* **FR-056**: Automated Planning Pipeline.
* **FR-057**: Feature Status Aggregation & Completion Check.
* **FR-058**: Multi-Feature Parallel Strategy.

### 6.7 Task Graph & Board
* **FR-050**: Task Graph Generation.
* **FR-051 - FR-053**: Board columns, automated state transitions, and Task Cards.

### 6.8 Scheduler
* **FR-060 - FR-064**: Two-tiered scheduling (Project Scheduler & Feature Scheduler), worktree isolation, and long-running recovery.

### 6.9 Codex Runner
* **FR-070 - FR-072**: Codex CLI execution (`codex exec`), Sandbox mode, Security Policies.

### 6.10 Status Check
* **FR-080 - FR-082**: Automated validation, Spec Alignment Check, and State Judgments.

### 6.11 Auto Recovery
* **FR-090 - FR-092**: Failure Recovery Skill, retries, preventing repeated failure loops.

### 6.12 Review Center
* **FR-100 - FR-101**: Triggered on high risk, large diffs, or failed retries. Supports Rollback, Approval, Spec Update.

### 6.13 PR & Delivery
* **FR-110 - FR-112**: Auto PR creation, Delivery Reports, Spec Evolution based on real-world constraints.

---

## 7. Core Data Models
Includes schemas for Project, Feature, Requirement, Task, Run, ProjectMemory, EvidencePack, Runner records, StatusCheckResult, Review, Recovery, and Audit records. Skill Registry and custom Context Broker tables are not part of the product data model.

---

## 8. Page Requirements
UI requirements for Dashboard, Spec Workspace, Skill Center, Subagent Console, Board, Runner Console, and Review Center. Skill Center reads project-local Skill files; Subagent Console reads durable run, event, evidence, and status-check records.

---

## 9. Non-Functional Requirements
* **Security**: Sandbox-first, no bypasses, rollback capability.
* **Stability**: Idempotent runs, recovery from crashes.
* **Observability**: Timelines, audit logs, cost/success tracking.
* **Performance**: Board loading < 2s, Evidence write < 3s, parallel Subagents support.

---

## 10. Success Metrics
Targeting >85% for Spec Generation/Decomposition, >60% autonomous low-risk task completion, and 100% PR generation/traceability.

---

## 11. MVP Version Planning
* **M1**: Spec Protocol + CLI Skill Discovery
* **M2**: Plan + Task Graph + Feature Selector
* **M3**: CLI Subagent Observation + Project Memory
* **M4**: Codex Runner
* **M5**: Status Check & Recovery
* **M6**: Review & Delivery

---

## 12. Risks & Mitigations
Addressed context bloat, memory staleness, parallel worktree conflicts, prompt drift, and continuous failure loops.

---

## 13. Final Conclusion
SpecDrive AutoBuild V2.0 operates on the principle:
> Spec prevents drifting, Skill provides ability, Subagent prevents context bloat, Memory prevents amnesia, Runner executes, and Dashboard manages.
