---
name: task-slicing-skill
description: "Split product scope into implementation-ready Feature Specs and slice planned Feature Specs into executable tasks. Use when Codex is asked to decompose PRD, EARS requirements, and HLD into feature folders, dependencies, acceptance scope, or task graphs after planning context, architecture, data model, contract, and quickstart validation are available."
---

# Task Slicing Skill

This is the design-named entry point for Feature Spec decomposition and task graph generation.

## Workflow

1. Read the PRD, EARS requirements, project-level HLD, feature requirements, feature design, architecture plan, data model plan, contract plan, quickstart validation, and existing `tasks.md` if available.
2. Preserve source language unless the user asks otherwise.
3. Group requirements by user value, workflow boundary, data ownership, implementation dependency, and risk.
4. Split vertically whenever possible: each feature should deliver a testable product behavior, not only a technical layer.
5. Keep shared platform or foundation work as its own feature only when multiple downstream features genuinely depend on it.
6. Assign stable feature IDs such as `FEAT-001`, `FEAT-002`, ... and map each to source `REQ-*`, `NFR-*`, and HLD sections.
7. Classify user-facing surfaces before drafting tasks. Any feature sourced from PRD/HLD words such as UI, page, Dashboard, Console, Workspace, Center, browser, frontend, interaction, or navigation is a UI-bearing feature.
8. For each feature, define scope, non-scope, dependencies, acceptance, risks, and implementation tasks.
9. Create tasks that are independently reviewable, ordered by dependency, and tied to requirement IDs.
10. Assign expected files, allowed scope, required skill, subagent type, verification command, and done criteria.
11. Write output to the requested location. If unspecified, create or update `docs/features/<feature-id>/requirements.md`, `design.md`, and `tasks.md`.
12. Always create or update the feature index table at `docs/features/README.md`. Each row must include at minimum: Feature ID, Name, Status (`pending`), Milestone, and Dependencies. This file is required by the downstream coding, testing, review, and PR generation skills.

## Feature Slicing Rules

- Prefer features that can be reviewed, tested, and delivered independently.
- Avoid slices that require editing every layer before any behavior can be validated.
- Keep one feature small enough for one focused implementation pass unless the PRD requires a larger milestone.
- Put risky unknowns early when they affect architecture, data model, security, or external integrations.
- Preserve traceability from feature to requirement to design to task.
- Mark blocked or ambiguous features with open questions instead of hiding uncertainty.
- UI-bearing feature tasks must include visible pages or routes, data-bound components, loading/empty/error states, user action controls, and browser-level verification such as Playwright or equivalent runtime checks.
- API, ViewModel, schema, or unit-test tasks may support a UI-bearing feature, but they must not be the only completion tasks unless the feature explicitly says it is backend-only.

## Output

- Task graph or updated `tasks.md`.
- Dependencies and parallelism constraints.
- Verification plan.
- Requirement and acceptance mapping.

## Failure Routing

- Use `clarification_needed` for unsliceable scope or missing acceptance.
- Use `risk_review_needed` for tasks requiring broad refactors or risky shared changes.
