# Agent Guidelines

This repository is a spec-driven autonomous coding system. Treat the spec artifacts as the source of truth and keep implementation, documentation, evidence, and delivery notes traceable to them.

## Project Context

- Product name: SpecDrive AutoBuild.
- Primary docs entry: `docs/agentic-spec/README.md`.
- Default product language: English, with localized docs in `docs/agentic-spec/en/`, `docs/agentic-spec/zh-CN/`, and `docs/agentic-spec/ja/`.
- Active planning source for the current MVP is primarily in `docs/agentic-spec/zh-CN/PRD.md`, `docs/agentic-spec/zh-CN/requirements.md`, `docs/agentic-spec/zh-CN/hld.md`, `docs/agentic-spec/zh-CN/design.md`, and `docs/agentic-spec/features/README.md`.
- Feature Specs live under `docs/agentic-spec/features/<feature-id>/` and normally contain `requirements.md`, `design.md`, and `tasks.md`.
- Project-local skills live under `.agents/skills/`. Do not use project-local skills by default; use them only when the user explicitly names a skill, explicitly asks for the project workflow, or the task cannot be handled safely without the governed skill workflow.
- UI product direction: VSCode IDE Webview is the primary current UI. Product Console is historical legacy and should be treated as a compatibility/reference surface unless the user explicitly scopes work to it. When choosing UI behavior, docs, tests, or examples, prefer the IDE Webview model; future UI work should move toward sharing one UI layer with the IDE instead of taking Product Console as the main source of truth.

## Operating Rules

- Read the relevant PRD, requirements, HLD/design, Feature Spec, and task file before changing code or specs.
- Preserve unrelated user changes. Inspect `git status --short` before editing and stage only the intended files when committing.
- Keep changes scoped to the requested requirement, Feature Spec, or task. Do not rewrite broad docs or refactor unrelated code unless the user explicitly asks.
- When an implementation worktree is active, all writes to Feature Specs (including `tasks.md` and `spec-state.json`), code, tests, and documentation MUST target the implementation workspace. Do not leak these updates into the owner workspace.
- When a repository fact conflicts with a spec, update the spec through the spec-evolution path instead of silently coding around it.
- If implementation intent, acceptance criteria, or file scope is unclear, stop for clarification before making risky changes.
- For Chinese docs, preserve Chinese structure, numbering, and terminology unless the user asks for a language or tone change.
- For any requirement addition, requirement change, coverage gap, clarification, deprecation, or traceability fix, treat `.agents/skills/10.change.classify/SKILL.md` as the Spec protocol. Triage through that skill-owned protocol before editing, update the mainline spec lane first, and do not create project-level scratch requirement files under `docs/agentic-spec/features/` or target-project `change-management.md` / `change-disposition-checklist.md` documents.
- For broad delivery work that spans requirements, planning, implementation, verification, review, or release, use `.agents/skills/using-agent-skills/SKILL.md` to route the task through Define, Plan, Build, Verify, Review, and Ship responsibilities. The 00-14 skill numbers are an internal compatibility layer; do not let them hide missing lifecycle handoffs, behavior obligations, or quality losses.

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
- The code path is clearly simpler, safer, more testable, or more reliable than a Skill-based workflow for the same capability.
- Examples: task board state machine, failure recovery history, audit log, status-checker evidence packaging.

**Default rule:** Prefer Skills first when the CLI already provides the needed mechanism, especially for prompt-driven workflows and specialist process guidance. Code may take priority when it is the better engineering choice for persistence, structural enforcement, machine-queryable output, testability, reliability, or implementation simplicity. Prefer removing hardcoded process logic in favor of Skill files discovered from `.agents/skills/`, while keeping code-first solutions acceptable when they produce a better system.

## Skill Routing

- For ordinary questions, exploratory reading, simple edits, small docs updates, simple commands, and direct bug fixes, use the normal Codex workflow instead of project-local skills unless the user explicitly specifies a skill.
- If the user explicitly names a project-local skill, follow that skill from `.agents/skills/<skill-name>/SKILL.md`.
- Use `using-agent-skills` when a task needs lifecycle-wide workflow, specialist agent responsibilities, or Delivery Fidelity Ledger routing before choosing lower-level skills.
- Use `00.intake.collect-context` for read-only repository exploration.
- Use `generate-user-stories` when PRD, PR/RP, product prose, or natural-language requirements must become user stories.
- Use `02.requirements.validate-testability` before consuming requirements for planning.
- Use `07.execution.prepare-context`, `06.planning.estimate-risk`, `03.hld.review-architecture`, `03.hld.define-data-flow`, `03.hld.define-adapter-model`, `06.planning.prepare-execution-plan`, `05.feature.decompose`, and `09.review.spec-consistency` for the planning pipeline (in that order). `06.planning.prepare-execution-plan` checks environment startability and command availability—it is not a spec document producer. `09.review.spec-consistency` is the final planning gate (after `05.feature.decompose`) **and** may be re-run as a pre-implementation gate after `tasks.md` is complete but before `07.execution.dispatch-adapter` begins, to catch contradictions introduced during task slicing.
- Use `07.execution.dispatch-adapter` for bounded implementation tasks with an approved Feature Spec, design constraints, allowed scope, and verification commands. Before starting implementation, verify that the project constitution (`memory/constitution.md` or equivalent) constraints are respected; flag violations in the task notes rather than silently proceeding.
- **UI/App Feature scheduling pre-check (Harness Gate):** Before routing any `IDE-Webview` or `App` Feature to `implement-feature` or `07.execution.dispatch-adapter`, confirm that the Feature's `spec-state.json` has `deliveryHarnessRef.harnessStatus == "ready"`. If `harnessStatus` is `"pending"`, `"gap"`, or `"blocked"`, route to `stitch-design-coverage` first. The scheduler will also enforce this rule in code and return `blocked` status for non-ready UI Features. Library, Foundation, Service, and Other Feature types are exempt.
- Use `stitch-design-coverage` to generate WYSIWYG Stitch screens from `DHI-###` rows and advance `deliveryHarnessRef.harnessStatus` to `"ready"`. This is required before any `IDE-Webview` or `App` Feature may proceed to `implement-feature`.
- Use `08.test.run-tests` for targeted, regression, browser, build, or acceptance verification; tests must prove behavior obligations, not only entry text, API-seeded state, or command success.

- Use `09.review.code-diff` for code/spec review findings and delivery-risk reports. When reviewing implementation, check for spec drift—behavior that diverges from `REQ-*` requirements—and report it as a finding alongside code quality issues.
- Use `09.review.test-coverage` and `09.review.evidence-completeness` when delivery confidence depends on test semantics, artifact evidence, Delivery Fidelity, or independent review.
- Use `10.change.update-mainline-spec` when an **existing** requirement ID must be changed, corrected, deprecated, or superseded. Use `10.change.create-request` when a brand-new requirement with a new stable ID must be added. When uncertain which applies, check: if a target ID already exists, use `10.change.update-mainline-spec`; if no target ID exists yet, use `10.change.create-request`.
- Use `10.change.classify` as the governed entry point when the request is an add-or-change requirement flow or when routing between requirement intake and spec evolution is uncertain.
- Use `14.release.prepare-pr` only after implementation, tests, and review are complete.

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
- For UI changes, prefer VSCode IDE Webview evidence as the primary product signal. For Product Console changes, verify with browser evidence when practical and check both desktop and mobile layouts, but do not let Product Console behavior override the IDE Webview direction unless explicitly requested.
- Report commands run, failures, skipped checks, and residual risks in the final response.

## Delivery Rules

- Use narrow Conventional Commit messages when committing.
- Keep commit-time verification proportional to the staged diff; do not escalate to `npm test` or other full-suite commands by default.
- Do not include unrelated modified files in commits or PRs.
- Include traceability in delivery summaries: affected requirements, Feature Spec, verification evidence, and known follow-ups.
