---
name: split-feature-spec
description: Split PRD, EARS requirements, and project-level HLD into implementation-ready Feature Specs. Use when Codex is asked to decompose product scope into feature specs, feature folders, feature requirements/design/tasks files, priority slices, dependencies, acceptance scope, or staged delivery plans.
---

# Split Feature Spec

## Workflow

1. Read the PRD, EARS requirements, and project-level HLD if available. Prefer explicit paths from the user.
2. Preserve source language unless the user asks otherwise.
3. Group requirements by user value, workflow boundary, data ownership, implementation dependency, and risk.
4. Split vertically whenever possible: each feature should deliver a testable product behavior, not only a technical layer.
5. Keep shared platform or foundation work as its own feature only when multiple downstream features genuinely depend on it.
6. Assign stable feature IDs such as `FEAT-001`, `FEAT-002`, ... and map each to source `REQ-*`, `NFR-*`, and HLD sections.
7. Classify user-facing surfaces before drafting tasks. Any feature sourced from PRD/HLD words such as UI, page, Dashboard, Console, Workspace, Center, browser, frontend, interaction, or navigation is a UI-bearing feature.
8. For each feature, define scope, non-scope, dependencies, acceptance, risks, and implementation tasks.
9. Write output to the requested location. If unspecified, create or update `docs/features/<feature-id>/requirements.md`, `design.md`, and `tasks.md`.
10. Always create or update the feature index table at `docs/features/README.md`. Each row must include at minimum: Feature ID, Name, Status (`pending`), Milestone, and Dependencies. This file is required by the `feature-spec-execution` skill.

## Feature Slicing Rules

- Prefer features that can be reviewed, tested, and delivered independently.
- Avoid slices that require editing every layer before any behavior can be validated.
- Keep one feature small enough for one focused implementation pass unless the PRD requires a larger milestone.
- Put risky unknowns early when they affect architecture, data model, security, or external integrations.
- Preserve traceability from feature to requirement to design to task.
- Mark blocked or ambiguous features with open questions instead of hiding uncertainty.
- For UI-bearing features, the feature must deliver a user-accessible surface, not only a backend API, query model, command gateway, schema, CLI output, static explanation page, or test fixture.
- If a UI-bearing feature depends on backend foundations, keep backend contracts in scope but add explicit frontend app/page/component/routing tasks and browser-level acceptance.
- If the required frontend stack is absent or unclear, add a blocking open question or task to initialize/adopt the stack named by the HLD; do not silently complete the feature as API-only.

## Feature Spec Shape

Use this folder shape when creating files:

```text
docs/features/
  feat-001-short-name/
    requirements.md
    design.md
    tasks.md
```

Use this content shape for each feature:

```markdown
# Feature Spec: FEAT-001 [Name]

## Source Mapping
| Source | IDs / Sections |
|---|---|
| PRD | |
| Requirements | |
| HLD | |

## Scope

## Non-Scope

## User Value

## Requirements

## Design Summary

## Dependencies

## Tasks
- [ ] TASK-001: [implementation task]

## Acceptance Criteria
- [ ] [observable acceptance check]

## Risks and Open Questions
```

## Task Rules

- Write tasks as executable engineering steps with clear done criteria.
- Include verification tasks for requirement coverage and regression risk.
- Avoid vague tasks such as "improve system" or "handle errors" without concrete surfaces.
- Put documentation or migration tasks where they are required for delivery.
- UI-bearing feature tasks must include visible pages or routes, data-bound components, loading/empty/error states, user action controls, and browser-level verification such as Playwright or equivalent runtime checks.
- API, ViewModel, schema, or unit-test tasks may support a UI-bearing feature, but they must not be the only completion tasks unless the feature explicitly says it is backend-only.
