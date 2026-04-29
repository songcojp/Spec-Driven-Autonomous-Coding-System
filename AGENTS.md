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

## Skill Routing

- For ordinary questions, exploratory reading, simple edits, small docs updates, simple commands, and direct bug fixes, use the normal Codex workflow instead of project-local skills unless the user explicitly specifies a skill.
- If the user explicitly names a project-local skill, follow that skill from `.agents/skills/<skill-name>/SKILL.md`.
- Use `repo-probe-skill` for read-only repository exploration.
- Use `pr-ears-requirement-decomposition-skill` when PRD, PR/RP, product prose, or natural-language requirements must become EARS requirements.
- Use `requirements-checklist-skill` before consuming requirements for planning.
- Use `technical-context-skill`, `research-decision-skill`, `architecture-plan-skill`, `data-model-skill`, `contract-design-skill`, `quickstart-validation-skill`, `task-slicing-skill`, and `spec-consistency-analysis-skill` for the planning pipeline.
- Use `codex-coding-skill` for bounded implementation tasks with an approved Feature Spec, design constraints, allowed scope, and verification commands.
- Use `test-execution-skill` for targeted, regression, browser, build, or acceptance verification.
- Use `review-report-skill` for code/spec review findings and delivery-risk reports.
- Use `spec-evolution-skill` or `requirement-intake-skill` for requirement additions, changes, review-driven corrections, and spec reconciliation.
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
- For docs-only changes, run at least `git diff --check` and inspect the affected links or referenced paths.
- For Product Console UI changes, verify with browser evidence when practical and check both desktop and mobile layouts.
- Report commands run, failures, skipped checks, and residual risks in the final response.

## Delivery Rules

- Do not commit unless the user asks for a commit or delivery action.
- Use narrow Conventional Commit messages when committing.
- Do not include unrelated modified files in commits or PRs.
- Include traceability in delivery summaries: affected requirements, Feature Spec, verification evidence, and known follow-ups.
