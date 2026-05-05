# Agent Guidelines

This repository is a spec-driven autonomous coding system. Treat the spec artifacts as the source of truth and keep implementation, documentation, evidence, and delivery notes traceable to them.

## Project Context

- Product name: SpecDrive AutoBuild.
- Primary docs entry: `docs/README.md`.
- Default product language: English, with localized docs in `docs/en/`, `docs/zh-CN/`, and `docs/ja/`.
- Active planning source for the current MVP is primarily in `docs/zh-CN/PRD.md`, `docs/zh-CN/requirements.md`, `docs/zh-CN/hld.md`, `docs/zh-CN/design.md`, and `docs/features/README.md`.
- Feature Specs live under `docs/features/<feature-id>/` and normally contain `requirements.md`, `design.md`, and `tasks.md`.
- Project-local skills live under `.agents/skills/`. Do not use project-local skills by default; use them only when the user explicitly names a skill, explicitly asks for the project workflow, or the task cannot be handled safely without the governed skill workflow.

## Operating Rules

- Read the relevant PRD, requirements, HLD/design, Feature Spec, and task file before changing code or specs.
- Preserve unrelated user changes. Inspect `git status --short` before editing and stage only the intended files when committing.
- Keep changes scoped to the requested requirement, Feature Spec, or task. Do not rewrite broad docs or refactor unrelated code unless the user explicitly asks.
- When a repository fact conflicts with a spec, update the spec through the spec-evolution path instead of silently coding around it.
- If implementation intent, acceptance criteria, or file scope is unclear, stop for clarification before making risky changes.
- For Chinese docs, preserve Chinese structure, numbering, and terminology unless the user asks for a language or tone change.

## Skill-vs-Code Decision

When a new requirement or capability is proposed, evaluate **before writing any code**:

**Implement as a Skill (SKILL.md) when:**
- The capability can be expressed as a prompt-driven workflow (reasoning, planning, review, decomposition, analysis).
- The CLI runtime already provides the underlying mechanism (file discovery, subagent delegation, session context).
- The behavior would otherwise be hardcoded logic that a prompt + structured file conventions can replace.
- Examples: skill routing, context collection, requirement decomposition, review checklists, task slicing.

**Implement as Code when:**
- The capability requires durable state that must survive across sessions (SQLite persistence, audit trail, state machine transitions).
- The behavior enforces structural invariants the CLI cannot guarantee (status transitions, deduplication, retry limits).
- The output must be machine-readable and queried programmatically (evidence records, status checks, delivery artifacts).
- Examples: task board state machine, failure recovery history, audit log, status-checker evidence packaging.

**Default rule:** If the CLI already provides the mechanism, write a Skill. Only write code when persistence, structural enforcement, or machine-queryable output is strictly necessary. Prefer removing hardcoded logic in favor of Skill files discovered from `.agents/skills/`.

## Skill Routing

- For ordinary questions, exploratory reading, simple edits, small docs updates, simple commands, and direct bug fixes, use the normal Codex workflow instead of project-local skills unless the user explicitly specifies a skill.
- If the user explicitly names a project-local skill, follow that skill from `.agents/skills/<skill-name>/SKILL.md`.
- Use `repo-probe-skill` for read-only repository exploration.
- Use `pr-ears-requirement-decomposition-skill` when PRD, PR/RP, product prose, or natural-language requirements must become EARS requirements.
- Use `requirements-checklist-skill` before consuming requirements for planning.
- Use `technical-context-skill`, `research-decision-skill`, `architecture-plan-skill`, `data-model-skill`, `contract-design-skill`, `quickstart-validation-skill`, `task-slicing-skill`, and `spec-consistency-analysis-skill` for the planning pipeline (in that order). `quickstart-validation-skill` checks environment startability and command availability—it is not a spec document producer. `spec-consistency-analysis-skill` is the final planning gate (after `task-slicing-skill`) **and** may be re-run as a pre-implementation gate after `tasks.md` is complete but before `feat-implement-skill` begins, to catch contradictions introduced during task slicing.
- Use `feat-implement-skill` for bounded implementation tasks with an approved Feature Spec, design constraints, allowed scope, and verification commands. Before starting implementation, verify that the project constitution (`memory/constitution.md` or equivalent) constraints are respected; flag violations in the task notes rather than silently proceeding.
- Use `test-execution-skill` for targeted, regression, browser, build, or acceptance verification.
- Use `review-report-skill` for code/spec review findings and delivery-risk reports. When reviewing implementation, check for spec drift—behavior that diverges from `REQ-*` requirements—and report it as a finding alongside code quality issues.
- Use `spec-evolution-skill` when an **existing** requirement ID must be changed, corrected, deprecated, or superseded. Use `requirement-intake-skill` when a brand-new requirement with a new stable ID must be added. When uncertain which applies, check: if a target ID already exists, use `spec-evolution-skill`; if no target ID exists yet, use `requirement-intake-skill`.
- Use `pr-generation-skill` only after implementation, tests, and review are complete.

## Development Commands

- Install dependencies with the package manager already used by the workspace.
- Run the full Node test suite with `npm test`.
- Run the bootstrap path with `npm run bootstrap`.
- Start the local runtime with `npm run dev`.
- Start Product Console development with `npm run console:dev`.
- Build Product Console with `npm run console:build`.
- Run Product Console browser tests with `npm run console:test`.

## Verification Expectations

- For code changes, run the smallest meaningful targeted test first, then broader tests when the change affects shared behavior, state, persistence, contracts, or UI.
- Do not run the full test suite only because a commit was requested. Use scoped checks such as `git diff --check`, `git diff --cached --check`, targeted tests, or affected build commands for commit-time validation unless the user explicitly requests full tests, the Feature Spec acceptance criteria require them, or the change's blast radius justifies them.
- For docs-only changes, run at least `git diff --check` and inspect the affected links or referenced paths.
- For Product Console UI changes, verify with browser evidence when practical and check both desktop and mobile layouts.
- Report commands run, failures, skipped checks, and residual risks in the final response.

## Delivery Rules

- Do not commit unless the user asks for a commit or delivery action.
- Use narrow Conventional Commit messages when committing.
- Keep commit-time verification proportional to the staged diff; do not escalate to `npm test` or other full-suite commands by default.
- Do not include unrelated modified files in commits or PRs.
- Include traceability in delivery summaries: affected requirements, Feature Spec, verification evidence, and known follow-ups.
