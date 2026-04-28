# Requirements: SpecDrive AutoBuild

## 1. Background

SpecDrive AutoBuild is a spec-driven autonomous coding system for software teams. It coordinates structured product specs, reusable skills, context-isolated subagents, project memory, Codex Runner execution, dashboard state, review, recovery, and delivery reporting so AI can continuously deliver code in a controllable and auditable workflow.

## 2. Goals

- Generate structured Feature Specs from natural-language requirements.
- Select ready Feature Specs based on priority and readiness.
- Drive Feature Specs through planning, task graph generation, dashboard tracking, scheduling, implementation, validation, review, and delivery.
- Slice large work into context-isolated subagent runs with bounded scopes.
- Provide each subagent with only the minimum context required for the assigned task.
- Preserve project goals, decisions, board status, blockers, and recovery context across CLI sessions.
- Support long-running tasks, failure retries, breakpoint recovery, delivery auditing, and PR generation.

## 3. Non-Goals

- Build proprietary LLMs.
- Build a proprietary full IDE.
- Provide an enterprise-grade complex permission matrix in MVP.
- Automatically deploy to production.
- Automatically migrate complex microservice systems across multiple large repositories.
- Fully replace Jira, GitHub Issues, Linear, or equivalent issue trackers.

## 4. Actors

- User: submits natural-language requirements and reviews outcomes.
- Product Manager: provides product goals, priorities, and clarifications.
- Developer: connects repositories, reviews plans, and handles manual interventions.
- Spec Agent: creates and refines specs.
- Clarification Agent: identifies requirement gaps and asks clarification questions.
- Repo Probe Agent: collects repository context.
- Architecture Agent: proposes technical plans and risk rules.
- Task Agent: decomposes work into tasks.
- Coding Agent: performs code changes through Codex Runner.
- Test Agent: validates changes and evidence.
- Review Agent: evaluates high-risk or blocked work.
- Recovery Agent: handles failures and retry workflows.

## 5. User Stories

- As a user, I want to submit natural-language requirements so that the system can produce structured Feature Specs.
- As a product manager, I want requirements decomposed into acceptance criteria so that delivery can be evaluated objectively.
- As a developer, I want work split into bounded tasks so that autonomous coding remains reviewable and recoverable.
- As a developer, I want subagents to receive limited context so that parallel work avoids unnecessary context bloat.
- As a team lead, I want dashboards and audit logs so that I can understand progress, failures, and delivery evidence.
- As a reviewer, I want risky or failed changes routed to review so that unsafe work is not merged automatically.

## 6. Functional Requirements

### REQ-001: Create AutoBuild Project
Source: PRD Section 6.1 FR-001
Priority: Must

WHEN a user starts project initialization
THE SYSTEM SHALL create an AutoBuild project record with the minimum information required to track specs, repositories, runs, tasks, memory, and delivery state.

Acceptance:
- [ ] A new project can be created and later retrieved with its project identity and initial state.

### REQ-002: Connect Git Repository
Source: PRD Section 6.1 FR-002
Priority: Must

WHEN a user connects a Git repository to a project
THE SYSTEM SHALL store the repository connection as part of the project configuration.

Acceptance:
- [ ] A connected repository appears in the project configuration and can be used by later planning and runner workflows.

### REQ-003: Project Health Check
Source: PRD Section 6.1 FR-003
Priority: Must

WHEN a project health check is requested
THE SYSTEM SHALL report whether required project inputs and connected repositories are ready for autonomous execution.

Acceptance:
- [ ] The health check returns ready, blocked, or failed status with observable reasons.

### REQ-004: Create Feature Spec
Source: PRD Section 2.1 Goal 1; PRD Section 6.2 FR-010
Priority: Must

WHEN a user submits natural-language requirements
THE SYSTEM SHALL generate a structured Feature Spec from the submitted requirements.

Acceptance:
- [ ] A submitted product request produces a Feature Spec with goals, requirements, acceptance criteria, and traceable source references.

### REQ-005: Decompose PRD Into EARS Requirements
Source: PRD Section 6.2 FR-011
Priority: Must

WHEN a PRD or product brief is processed by the Spec Protocol Engine
THE SYSTEM SHALL decompose its behavior into atomic, testable EARS-format requirements.

Acceptance:
- [ ] Each generated requirement contains one observable behavior and can be mapped back to a source section.

### REQ-006: Slice Feature Spec
Source: PRD Section 6.2 FR-012
Priority: Must

WHEN a Feature Spec is too large for a single execution pass
THE SYSTEM SHALL slice it into smaller deliverable units with clear boundaries.

Acceptance:
- [ ] A large Feature Spec produces multiple slices with distinct scope and acceptance criteria.

### REQ-007: Maintain Clarification Log
Source: PRD Section 6.2 FR-013
Priority: Must

WHEN the system detects ambiguous, missing, or conflicting requirement information
THE SYSTEM SHALL record the issue in a clarification log.

Acceptance:
- [ ] Ambiguous input creates a clarification entry with the question, source context, and current status.

### REQ-008: Maintain Requirement Checklist
Source: PRD Section 6.2 FR-014
Priority: Must

WHEN requirements are generated or updated
THE SYSTEM SHALL maintain a checklist of requirement coverage and completion status.

Acceptance:
- [ ] Each requirement has a checklist status that can be inspected during planning and review.

### REQ-009: Version Specs
Source: PRD Section 6.2 FR-015
Priority: Must

WHEN a spec changes after creation
THE SYSTEM SHALL record a new spec version without losing prior version history.

Acceptance:
- [ ] A changed spec exposes its current version and at least one previous version reference.

### REQ-010: Register Skill
Source: PRD Section 6.3 FR-020
Priority: Must

WHEN a skill is added to the Skill Center
THE SYSTEM SHALL register the skill with its required metadata.

Acceptance:
- [ ] A registered skill includes name, description, trigger, input/output schema, and risk level.

### REQ-011: Provide Built-In MVP Skills
Source: PRD Section 6.3 FR-021
Priority: Must

WHEN an MVP project is initialized
THE SYSTEM SHALL make the MVP built-in skills available for planning, coding, testing, review, and recovery workflows.

Acceptance:
- [ ] Built-in skills can be discovered and selected by the system without manual registration.

### REQ-012: Validate Skill Schema
Source: PRD Section 6.3 FR-022
Priority: Must

WHEN a skill is invoked
THE SYSTEM SHALL validate the skill input and output against the skill schema.

Acceptance:
- [ ] Invalid skill input or output is rejected with an observable validation result.

### REQ-013: Manage Skill Versions
Source: PRD Section 6.3 FR-023
Priority: Should

WHEN a skill definition changes
THE SYSTEM SHALL preserve skill version information for later audit and compatibility checks.

Acceptance:
- [ ] Skill records expose version information and allow runs to reference the skill version used.

### REQ-014: Define Subagent Types
Source: PRD Section 4.3; PRD Section 6.4 FR-030
Priority: Must

WHEN the subagent runtime is available
THE SYSTEM SHALL provide distinct subagent types for spec, clarification, repository probing, architecture, task, coding, test, review, and recovery work.

Acceptance:
- [ ] The runtime can list the supported subagent types and their intended responsibilities.

### REQ-015: Create Agent Run Contract
Source: PRD Section 4.3; PRD Section 6.4 FR-031
Priority: Must

WHEN a subagent run is scheduled
THE SYSTEM SHALL create an Agent Run Contract that defines task goals, context slices, and read/write scopes.

Acceptance:
- [ ] Each scheduled subagent run has a contract before execution begins.

### REQ-016: Limit Subagent Context
Source: PRD Section 2.1 Goal 6; PRD Section 4.3
Priority: Must

WHEN a subagent run starts
THE SYSTEM SHALL provide only the context required by that run's Agent Run Contract.

Acceptance:
- [ ] The run input can be inspected and does not include unrelated project-wide context.

### REQ-017: Require Worktree Isolation For Parallel Writes
Source: PRD Section 6.4 FR-032; PRD Section 12
Priority: Must

WHEN multiple subagents perform write operations in parallel
THE SYSTEM SHALL require isolated Git worktrees for those write operations.

Acceptance:
- [ ] Parallel writing tasks cannot start unless each writing subagent has an assigned worktree.

### REQ-018: Merge Subagent Results
Source: PRD Section 6.4 FR-033
Priority: Must

WHEN subagent runs complete
THE SYSTEM SHALL merge their results into the feature or task state aggregator.

Acceptance:
- [ ] Completed run outputs update the related feature or task state with evidence references.

### REQ-019: Initialize Project Memory
Source: PRD Section 4.4; PRD Section 6.5 FR-044
Priority: Must

WHEN a project is initialized
THE SYSTEM SHALL create project memory at `.autobuild/memory/project.md`.

Acceptance:
- [ ] A new project has a project memory file at the specified path.

### REQ-020: Inject Project Memory
Source: PRD Section 2.1 Goal 10; PRD Section 4.4; PRD Section 6.5 FR-045
Priority: Must

WHEN a CLI session starts for a project
THE SYSTEM SHALL inject current goals, board status snapshot, and active blockers from project memory.

Acceptance:
- [ ] A CLI session receives the current memory summary before autonomous work begins.

### REQ-021: Update Project Memory
Source: PRD Section 4.4; PRD Section 6.5 FR-046
Priority: Must

WHEN goals, decisions, board status, or blockers change
THE SYSTEM SHALL update project memory to reflect the change.

Acceptance:
- [ ] A completed update is visible in the project memory content.

### REQ-022: Enforce Memory Size Limit
Source: PRD Section 6.5 FR-047
Priority: Must

WHEN project memory exceeds 8000 tokens
THE SYSTEM SHALL reduce or summarize memory so the injected memory stays within the size limit.

Acceptance:
- [ ] Memory injection does not exceed the configured 8000-token limit.

### REQ-023: Version Project Memory
Source: PRD Section 6.5 FR-048
Priority: Should

WHEN project memory is updated
THE SYSTEM SHALL preserve enough version information to audit memory changes.

Acceptance:
- [ ] Memory updates can be traced to a prior memory state or change record.

### REQ-024: Generate Task Graph
Source: PRD Section 6.7 FR-050
Priority: Must

WHEN planning is performed for a Feature Spec
THE SYSTEM SHALL generate a task graph from the Feature Spec.

Acceptance:
- [ ] The generated task graph contains tasks, dependencies, and acceptance references.

### REQ-025: Maintain Board Columns
Source: PRD Section 6.7 FR-051
Priority: Must

WHEN tasks are created
THE SYSTEM SHALL place each task into a board column representing its current state.

Acceptance:
- [ ] Every task card appears in exactly one board state column.

### REQ-026: Automate Task State Transitions
Source: PRD Section 6.7 FR-052
Priority: Must

WHEN task evidence changes
THE SYSTEM SHALL transition the task state according to the dashboard state machine rules.

Acceptance:
- [ ] Valid task evidence can move a task between pending, running, review, blocked, failed, and done states.

### REQ-027: Display Task Cards
Source: PRD Section 6.7 FR-053
Priority: Must

WHEN a task exists on the board
THE SYSTEM SHALL display a task card with its status, scope, owner or assigned agent, and evidence state.

Acceptance:
- [ ] A task card shows enough information for a reviewer to understand current progress.

### REQ-028: Maintain Feature State Machine
Source: PRD Section 6.6 FR-054
Priority: Must

WHEN a feature advances through delivery
THE SYSTEM SHALL track feature state from draft to ready, planning, tasked, implementing, and done.

Acceptance:
- [ ] A feature exposes one current lifecycle state and valid state transition history.

### REQ-029: Select Next Feature
Source: PRD Section 2.1 Goal 2; PRD Section 6.6 FR-055
Priority: Must

WHEN the system is ready to choose new work
THE SYSTEM SHALL select the next pending Feature Spec using priority and readiness.

Acceptance:
- [ ] The selected feature can be explained by its priority and readiness signals.

### REQ-030: Run Automated Planning Pipeline
Source: PRD Section 2.1 Goals 3-4; PRD Section 6.6 FR-056
Priority: Must

WHEN a Feature Spec enters planning
THE SYSTEM SHALL generate a technical plan, task graph, acceptance criteria, and risk rules.

Acceptance:
- [ ] A planned feature has generated planning artifacts before implementation begins.

### REQ-031: Aggregate Feature Status
Source: PRD Section 6.6 FR-057
Priority: Must

WHEN task states change within a feature
THE SYSTEM SHALL aggregate task states into an overall feature status.

Acceptance:
- [ ] The feature status changes when its task completion, failure, review, or blocked state changes.

### REQ-032: Support Multi-Feature Parallel Strategy
Source: PRD Section 6.6 FR-058
Priority: Should

WHEN multiple features are eligible for parallel execution
THE SYSTEM SHALL apply a parallel strategy that respects readiness, risk, and workspace isolation constraints.

Acceptance:
- [ ] Parallel features are scheduled only when their dependencies and workspace constraints permit it.

### REQ-033: Run Project Scheduler
Source: PRD Section 6.8 FR-060
Priority: Must

WHEN the project has pending work
THE SYSTEM SHALL schedule feature-level work across the project.

Acceptance:
- [ ] The project scheduler produces a current work decision or a blocked reason.

### REQ-034: Run Feature Scheduler
Source: PRD Section 6.8 FR-061
Priority: Must

WHEN a feature has a task graph
THE SYSTEM SHALL schedule executable tasks from the feature task graph.

Acceptance:
- [ ] The feature scheduler selects tasks whose dependencies are satisfied.

### REQ-035: Assign Worktree Isolation
Source: PRD Section 6.8 FR-062
Priority: Must

WHEN a scheduled task requires repository writes
THE SYSTEM SHALL assign an isolated workspace before execution.

Acceptance:
- [ ] A write task has an assigned workspace before the coding run starts.

### REQ-036: Support Long-Running Recovery
Source: PRD Section 2.1 Goal 11; PRD Section 6.8 FR-064
Priority: Must

WHEN a long-running workflow is interrupted
THE SYSTEM SHALL recover the workflow from persisted state.

Acceptance:
- [ ] An interrupted workflow can resume with known feature, task, run, and blocker state.

### REQ-037: Execute Codex CLI Runs
Source: PRD Section 6.9 FR-070
Priority: Must

WHEN a coding task is ready for execution
THE SYSTEM SHALL execute the task through Codex CLI using `codex exec`.

Acceptance:
- [ ] A coding task creates a Codex Runner run record with command status and output evidence.

### REQ-038: Apply Sandbox Mode
Source: PRD Section 6.9 FR-071; PRD Section 9
Priority: Must

WHEN Codex Runner executes code modifications
THE SYSTEM SHALL apply sandbox mode according to project security policy.

Acceptance:
- [ ] Runner execution records show the sandbox mode applied to the run.

### REQ-039: Enforce Runner Security Policies
Source: PRD Section 6.9 FR-072; PRD Section 9
Priority: Must

WHEN a runner action violates security policy
THE SYSTEM SHALL block the action and record the policy violation.

Acceptance:
- [ ] A prohibited runner action produces a blocked state with an auditable reason.

### REQ-040: Validate Task Completion
Source: PRD Section 2.1 Goal 8; PRD Section 6.10 FR-080
Priority: Must

WHEN a task run finishes
THE SYSTEM SHALL automatically validate whether the task is done, failed, blocked, or needs review.

Acceptance:
- [ ] Each finished run receives one state judgment with supporting evidence.

### REQ-041: Check Spec Alignment
Source: PRD Section 6.10 FR-081
Priority: Must

WHEN implementation evidence is evaluated
THE SYSTEM SHALL check whether the implementation aligns with the relevant spec and acceptance criteria.

Acceptance:
- [ ] Spec alignment results identify satisfied and unsatisfied requirement references.

### REQ-042: Produce State Judgment
Source: PRD Section 6.10 FR-082
Priority: Must

WHEN validation completes
THE SYSTEM SHALL produce a state judgment for the related task and feature.

Acceptance:
- [ ] State judgment output includes the resulting state, evidence references, and reason.

### REQ-043: Invoke Failure Recovery Skill
Source: PRD Section 6.11 FR-090
Priority: Must

WHEN a task fails
THE SYSTEM SHALL invoke a failure recovery workflow or skill.

Acceptance:
- [ ] A failed task creates a recovery attempt or a manual-review state.

### REQ-044: Retry Failed Tasks
Source: PRD Section 6.11 FR-091
Priority: Should

WHEN a recoverable task failure occurs
THE SYSTEM SHALL retry the task within configured retry limits.

Acceptance:
- [ ] Recoverable failures trigger retries until success, limit exhaustion, or manual review.

### REQ-045: Prevent Repeated Failure Loops
Source: PRD Section 6.11 FR-092; PRD Section 12
Priority: Must

WHEN repeated failures reach the configured limit
THE SYSTEM SHALL stop automatic retries and route the task to review or blocked state.

Acceptance:
- [ ] A task does not continue retrying indefinitely after repeated failure.

### REQ-046: Trigger Review For Risk
Source: PRD Section 6.12 FR-100
Priority: Must

WHEN a run is high risk, creates a large diff, or exhausts failed retries
THE SYSTEM SHALL route the work to the Review Center.

Acceptance:
- [ ] Review Center receives review items for high-risk runs, large diffs, and failed retry exhaustion.

### REQ-047: Support Review Actions
Source: PRD Section 6.12 FR-101
Priority: Must

WHEN a review item is opened
THE SYSTEM SHALL support rollback, approval, and spec update decisions.

Acceptance:
- [ ] A reviewer can choose rollback, approval, or spec update and the selected decision is recorded.

### REQ-048: Create Pull Request
Source: PRD Section 6.13 FR-110; PRD Section 10
Priority: Must

WHEN a feature is ready for delivery
THE SYSTEM SHALL create a pull request for the implemented changes.

Acceptance:
- [ ] Delivered work has a pull request reference linked to the feature and evidence.

### REQ-049: Generate Delivery Report
Source: PRD Section 6.13 FR-111
Priority: Must

WHEN delivery completes
THE SYSTEM SHALL generate a delivery report.

Acceptance:
- [ ] The delivery report includes delivered scope, requirement coverage, validation evidence, known risks, and PR references.

### REQ-050: Evolve Specs From Delivery Constraints
Source: PRD Section 6.13 FR-112
Priority: Should

WHEN real-world constraints are discovered during implementation
THE SYSTEM SHALL propose spec evolution updates.

Acceptance:
- [ ] A discovered implementation constraint creates a spec update proposal or clarification entry.

### REQ-051: Capture Evidence Pack
Source: PRD Section 4.5
Priority: Must

WHEN a subagent run completes
THE SYSTEM SHALL produce an Evidence Pack for state judgment, approvals, and reports.

Acceptance:
- [ ] Each completed subagent run has evidence that can be referenced by validation and delivery reports.

### REQ-052: Display Dashboard Status
Source: PRD Section 2.1 Goal 9; PRD Section 8
Priority: Must

WHEN users open the Dashboard
THE SYSTEM SHALL display real-time task status and delivery progress.

Acceptance:
- [ ] Dashboard users can see current project, feature, task, run, and delivery states.

### REQ-053: Provide Spec Workspace
Source: PRD Section 8
Priority: Must

WHEN users open the Spec Workspace
THE SYSTEM SHALL display and manage product specs, feature specs, requirements, acceptance criteria, and clarification logs.

Acceptance:
- [ ] Spec Workspace users can inspect current spec artifacts and their status.

### REQ-054: Provide Skill Center
Source: PRD Section 8
Priority: Should

WHEN users open the Skill Center
THE SYSTEM SHALL display registered skills, built-in skills, schemas, versions, triggers, and risk levels.

Acceptance:
- [ ] Skill Center users can inspect skill metadata and availability.

### REQ-055: Provide Subagent Console
Source: PRD Section 8
Priority: Should

WHEN users open the Subagent Console
THE SYSTEM SHALL display subagent runs, contracts, context scope, status, and evidence.

Acceptance:
- [ ] Subagent Console users can inspect each run's contract, state, and evidence references.

### REQ-056: Provide Runner Console
Source: PRD Section 8
Priority: Should

WHEN users open the Runner Console
THE SYSTEM SHALL display Codex Runner executions, sandbox mode, command status, and validation output.

Acceptance:
- [ ] Runner Console users can inspect runner command history and associated evidence.

### REQ-057: Provide Review Center
Source: PRD Section 8
Priority: Must

WHEN users open the Review Center
THE SYSTEM SHALL display review-needed work and available review decisions.

Acceptance:
- [ ] Review Center users can find blocked, high-risk, or failed-retry items requiring human action.

## 7. Non-Functional Requirements

### NFR-001: Sandbox-First Security
Source: PRD Section 9
Priority: Must

WHEN the system executes autonomous code changes
THE SYSTEM SHALL prefer sandboxed execution and prevent security bypasses.

Acceptance:
- [ ] Autonomous code execution records include sandbox status and policy checks.

### NFR-002: Rollback Capability
Source: PRD Section 9
Priority: Must

WHEN an approved rollback is requested
THE SYSTEM SHALL restore the affected work to a prior safe state.

Acceptance:
- [ ] Rollback actions produce auditable evidence of the restored state.

### NFR-003: Idempotent Runs
Source: PRD Section 9
Priority: Must

WHEN a run is repeated with the same inputs and unchanged repository state
THE SYSTEM SHALL avoid duplicate or conflicting side effects.

Acceptance:
- [ ] Repeated runs do not create duplicate task, evidence, or delivery records.

### NFR-004: Crash Recovery
Source: PRD Section 9
Priority: Must

WHEN the process crashes during execution
THE SYSTEM SHALL recover persisted workflow state after restart.

Acceptance:
- [ ] After restart, the system can identify active work, completed work, and unresolved blockers.

### NFR-005: Audit Timeline
Source: PRD Section 9
Priority: Must

WHEN project work progresses
THE SYSTEM SHALL maintain a timeline of important decisions, run states, review actions, and delivery events.

Acceptance:
- [ ] A project audit timeline can be inspected for a completed feature.

### NFR-006: Cost And Success Tracking
Source: PRD Section 9
Priority: Should

WHEN autonomous work runs
THE SYSTEM SHALL track cost and success metrics.

Acceptance:
- [ ] The system reports cost and success information for completed runs or features.

### NFR-007: Dashboard Performance
Source: PRD Section 9
Priority: Must

WHEN users load the board
THE SYSTEM SHALL display the board in less than 2 seconds under MVP target conditions.

Acceptance:
- [ ] Board load time is measured and remains below 2 seconds in the target test environment.

### NFR-008: Evidence Write Performance
Source: PRD Section 9
Priority: Must

WHEN an Evidence Pack is written
THE SYSTEM SHALL complete the write in less than 3 seconds under MVP target conditions.

Acceptance:
- [ ] Evidence write time is measured and remains below 3 seconds in the target test environment.

### NFR-009: Parallel Subagent Support
Source: PRD Section 9
Priority: Must

WHEN independent tasks are ready for parallel work
THE SYSTEM SHALL support parallel subagent execution.

Acceptance:
- [ ] The system can run multiple independent subagent tasks concurrently while preserving task boundaries.

### NFR-010: Spec Generation Success Target
Source: PRD Section 10
Priority: Should

WHEN evaluating MVP success
THE SYSTEM SHALL measure Spec Generation and Requirement Decomposition success against an 85% target.

Acceptance:
- [ ] Success metric reports include the measured Spec Generation and Decomposition percentage.

### NFR-011: Autonomous Completion Target
Source: PRD Section 10
Priority: Should

WHEN evaluating MVP success
THE SYSTEM SHALL measure autonomous low-risk task completion against a 60% target.

Acceptance:
- [ ] Success metric reports include the measured autonomous low-risk completion percentage.

### NFR-012: PR Traceability Target
Source: PRD Section 10
Priority: Must

WHEN evaluating MVP success
THE SYSTEM SHALL measure PR generation and traceability against a 100% target.

Acceptance:
- [ ] Success metric reports include whether delivered work has PR and traceability coverage.

## 8. Edge Cases and Error Handling

### EDGE-001: Missing Repository
Source: PRD Section 6.1; PRD Section 6.8

WHEN a project has no connected repository and a write task is scheduled
THE SYSTEM SHALL block execution and report that repository connection is required.

### EDGE-002: Ambiguous Requirement
Source: PRD Section 6.2 FR-013

WHEN a requirement cannot be converted into a testable behavior
THE SYSTEM SHALL add a clarification entry instead of inventing product intent.

### EDGE-003: Duplicate Feature Spec
Source: PRD Section 6.2; PRD Section 6.6

WHEN an incoming request duplicates an existing Feature Spec
THE SYSTEM SHALL link or flag the duplicate before creating redundant work.

### EDGE-004: Parallel Write Conflict
Source: PRD Section 6.4 FR-032; PRD Section 12

WHEN two write tasks target conflicting repository scopes
THE SYSTEM SHALL prevent parallel execution or route the conflict to scheduling review.

### EDGE-005: Memory Staleness
Source: PRD Section 12

WHEN project memory conflicts with current project state
THE SYSTEM SHALL refresh or flag the stale memory before injecting it into a run.

### EDGE-006: Context Bloat
Source: PRD Section 12

WHEN requested run context exceeds the allowed context budget
THE SYSTEM SHALL reduce context to the minimum required scope or block the run for review.

### EDGE-007: Prompt Drift
Source: PRD Section 12

WHEN generated execution behavior deviates from the active spec
THE SYSTEM SHALL fail the Spec Alignment Check and route the item to review or recovery.

### EDGE-008: Repeated Failure Loop
Source: PRD Section 6.11 FR-092; PRD Section 12

WHEN a task repeatedly fails with the same failure signature
THE SYSTEM SHALL stop retrying and require review or alternate recovery.

### EDGE-009: Evidence Write Failure
Source: PRD Section 4.5; PRD Section 9

WHEN an Evidence Pack cannot be written
THE SYSTEM SHALL mark the run as blocked or failed and preserve available diagnostic output.

### EDGE-010: Review Decision Missing
Source: PRD Section 6.12

WHEN an item requires review and no review decision is available
THE SYSTEM SHALL keep the item in Review Needed state.

## 9. Traceability Matrix

| Source | Requirement IDs | Notes |
|---|---|---|
| PRD Section 1 Product Definition | REQ-004, REQ-005, REQ-030, REQ-037, REQ-052 | Product positioning and system components |
| PRD Section 2.1 Core Goals | REQ-004, REQ-016, REQ-029, REQ-030, REQ-036, REQ-040, REQ-052 | Goal-to-behavior conversion |
| PRD Section 2.2 Non-Goals | Section 3 | MVP exclusions |
| PRD Section 3 Core Architecture | REQ-018, REQ-031, REQ-040, REQ-043, REQ-048 | Workflow and state aggregation |
| PRD Section 4.1 Spec Protocol | REQ-004, REQ-005, REQ-007, REQ-008, REQ-009, REQ-053 | Spec as source of truth |
| PRD Section 4.2 Skill System | REQ-010, REQ-011, REQ-012, REQ-013, REQ-054 | Skill metadata and validation |
| PRD Section 4.3 Subagent Runtime | REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-055 | Context-isolated execution |
| PRD Section 4.4 Project Memory | REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 | Persistent CLI memory |
| PRD Section 4.5 Evidence Pack | REQ-018, REQ-051, REQ-049 | Evidence for judgment and delivery |
| PRD Section 5 User Workflow | REQ-029, REQ-030, REQ-033, REQ-034, REQ-040, REQ-046 | Autonomous execution loop |
| PRD Section 6.1 Project Management | REQ-001, REQ-002, REQ-003 | Project setup and health |
| PRD Section 6.2 Spec Protocol Engine | REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009 | Spec creation and management |
| PRD Section 6.3 Skill Center | REQ-010, REQ-011, REQ-012, REQ-013 | Skill lifecycle |
| PRD Section 6.4 Subagent Runtime | REQ-014, REQ-015, REQ-017, REQ-018 | Agent contract and parallelism |
| PRD Section 6.5 Project Memory | REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 | Memory initialization through versioning |
| PRD Section 6.6 Feature Pipeline & Selection | REQ-028, REQ-029, REQ-030, REQ-031, REQ-032 | Feature lifecycle |
| PRD Section 6.7 Task Graph & Board | REQ-024, REQ-025, REQ-026, REQ-027 | Task graph and board behavior |
| PRD Section 6.8 Scheduler | REQ-033, REQ-034, REQ-035, REQ-036 | Scheduling and recovery |
| PRD Section 6.9 Codex Runner | REQ-037, REQ-038, REQ-039 | Runner execution and policies |
| PRD Section 6.10 Status Check | REQ-040, REQ-041, REQ-042 | Validation and judgment |
| PRD Section 6.11 Auto Recovery | REQ-043, REQ-044, REQ-045 | Failure recovery |
| PRD Section 6.12 Review Center | REQ-046, REQ-047, REQ-057 | Review triggers and decisions |
| PRD Section 6.13 PR & Delivery | REQ-048, REQ-049, REQ-050 | Delivery lifecycle |
| PRD Section 7 Core Data Models | REQ-001, REQ-004, REQ-024, REQ-051 | Data model coverage is named but not detailed |
| PRD Section 8 Page Requirements | REQ-052, REQ-053, REQ-054, REQ-055, REQ-056, REQ-057 | UI surface requirements |
| PRD Section 9 Non-Functional Requirements | NFR-001, NFR-002, NFR-003, NFR-004, NFR-005, NFR-006, NFR-007, NFR-008, NFR-009 | Security, stability, observability, performance |
| PRD Section 10 Success Metrics | NFR-010, NFR-011, NFR-012 | MVP success targets |
| PRD Section 11 MVP Version Planning | Section 10 | Release sequencing reference |
| PRD Section 12 Risks & Mitigations | EDGE-004, EDGE-005, EDGE-006, EDGE-007, EDGE-008 | Risk-driven edge cases |

## 10. MVP Release Mapping

| Milestone | Requirement IDs |
|---|---|
| M1: Spec Protocol + Skill Basics | REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012, REQ-013 |
| M2: Plan + Task Graph + Feature Selector | REQ-024, REQ-025, REQ-026, REQ-027, REQ-028, REQ-029, REQ-030, REQ-031 |
| M3: Subagent Runtime + Project Memory | REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-023 |
| M4: Codex Runner | REQ-035, REQ-037, REQ-038, REQ-039 |
| M5: Status Check & Recovery | REQ-040, REQ-041, REQ-042, REQ-043, REQ-044, REQ-045 |
| M6: Review & Delivery | REQ-046, REQ-047, REQ-048, REQ-049, REQ-050, REQ-057 |

## 11. Open Questions

- What exact fields are required for Project, Feature, Requirement, Task, Run, ProjectMemory, and EvidencePack schemas?
- What are the exact MVP built-in skills and their required schemas?
- What priority and readiness scoring rules should the Feature Selector use?
- What retry limit and failure-signature rules define repeated failure loops?
- What threshold defines a large diff for Review Center routing?
- What risk levels and risk rules trigger manual review?
- What target environment defines the board loading and evidence write performance benchmarks?
- What permissions are required for repository connection and PR creation in MVP?
- What source of truth should be used when project memory conflicts with repository state or dashboard state?
- Which issue tracker integrations, if any, are required for MVP despite not replacing Jira, GitHub Issues, or Linear?
