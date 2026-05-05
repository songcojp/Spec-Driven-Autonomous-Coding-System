---
name: task-slicing-skill
description: "Split product scope into implementation-ready Feature Specs and slice planned Feature Specs into executable tasks. Use when Codex is asked to decompose PRD, EARS requirements, and HLD into feature folders, dependencies, acceptance scope, or task graphs after planning context, architecture, data model, contract, and quickstart validation are available."
---

# Task Slicing Skill

This is the design-named entry point for Feature Spec decomposition and task graph generation.

## Workflow

1. Read the PRD, EARS requirements, project-level HLD, feature requirements, feature design, architecture plan, data model plan, contract plan, quickstart validation, and existing `tasks.md` if available.
2. Preserve source language unless the user asks otherwise.
3. **Organize by user story first**: read the `US-*` index from the requirements output (produced by `pr-ears-requirement-decomposition-skill`). If no `US-*` index exists, derive user stories from the PRD before grouping tasks. Each user story must be:
   - Tagged with its priority (`P1`, `P2`, `P3`).
   - Independently testable: implementing only this story must produce a verifiable, standalone behavior.
   - Mapped to its `REQ-*` requirements.
4. Group requirements by user value, workflow boundary, data ownership, implementation dependency, and risk.
5. Split vertically whenever possible: each feature should deliver a testable product behavior, not only a technical layer.
6. Keep shared platform or foundation work as its own feature only when multiple downstream features genuinely depend on it.
7. Assign stable feature IDs such as `FEAT-001`, `FEAT-002`, ... and map each to source `REQ-*`, `NFR-*`, `US-*`, and HLD sections.
8. Classify user-facing surfaces before drafting tasks. Any feature sourced from PRD/HLD words such as UI, page, Dashboard, Console, Workspace, Center, browser, frontend, interaction, or navigation is a UI-bearing feature.
9. For each feature, define scope, non-scope, dependencies, acceptance, risks, and implementation tasks.
10. **Structure tasks by user story phase**: organize tasks into phases that mirror the user story priority order—Phase 1: shared setup (no story yet), Phase 2: P1 story tasks, Phase 3: P2 story tasks, Phase 4: P3 story tasks, Phase N: polish and cross-cutting. Each story phase must have an independent test checkpoint.
11. Create tasks that are independently reviewable, ordered by dependency, and tied to requirement IDs.
12. Assign expected files, allowed scope, required skill, subagent type, verification command, and done criteria.
13. Write output to the requested location. If unspecified, create or update `docs/features/<feature-id>/requirements.md`, `design.md`, and `tasks.md`.
14. Always create or update the feature index table at `docs/features/README.md`. The index table MUST strictly use the following format: `| Feature ID | Status | Name | Milestone | Dependencies |`. A tree-structured dependency graph (树状依赖关系图) MUST be included to visualize the feature dependencies. This file is required by the downstream coding, testing, review, and PR generation skills.
15. Always create or update the machine-readable Feature Spec Pool queue plan at `docs/features/feature-pool-queue.json`. Code consumes this artifact to push Feature Specs into the Pool; do not rely on code parsing dependency prose from `README.md`.

## Feature Slicing Rules

- Prefer features that can be reviewed, tested, and delivered independently.
- Avoid slices that require editing every layer before any behavior can be validated.
- Keep one feature small enough for one focused implementation pass unless the PRD requires a larger milestone.
- Put risky unknowns early when they affect architecture, data model, security, or external integrations.
- Preserve traceability from feature to requirement to user story to design to task.
- Mark blocked or ambiguous features with open questions instead of hiding uncertainty.
- UI-bearing feature tasks must include visible pages or routes, data-bound components, loading/empty/error states, user action controls, and browser-level verification such as Playwright or equivalent runtime checks.
- API, ViewModel, schema, or unit-test tasks may support a UI-bearing feature, but they must not be the only completion tasks unless the feature explicitly says it is backend-only.
- Each P1 story phase must be completable and demoed without any P2/P3 tasks being done. An implementation that stops after P1 must still be a valid, usable baseline.

## Output

- Task graph or updated `tasks.md`, organized by user story phase (P1 → P2 → P3).
- Feature Spec Pool queue plan at `docs/features/feature-pool-queue.json` with `features[]` entries containing `id`, `priority`, and `dependencies`.
- User story to task mapping with independent-test checkpoint per story.
- Dependencies and parallelism constraints.
- Verification plan.
- Requirement, user story, and acceptance mapping.
- Return a `SkillOutputContractV1` JSON object with `contractVersion`, `executionId`, `skillSlug`, `requestedAction`, `status`, `summary`, `producedArtifacts`, and `traceability`; echo invocation-owned traceability fields and manage any `changeIds` from the source documents.

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- The final assistant message must be only that JSON object. Do not return shorthand output with only `summary`, `status`, and `evidence`.
- Echo `contractVersion`, `executionId`, `skillSlug`, `requestedAction`, `traceability.featureId`, `traceability.taskId`, and `traceability.requirementIds` exactly from the invocation contract. Add `traceability.changeIds` from source documents, or `[]` when none apply.
- Every `producedArtifacts[]` entry must include `path`, `kind`, `status`, `checksum`, and `summary`; use `null` for `checksum` or `summary` when unavailable.
- `summary` must state the generated or updated Feature Specs, queue plan, dependencies, and verification plan readiness.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `features`: array of Feature IDs with name, status, milestone, dependencies, and primary requirements.
- `queuePlan`: `docs/features/feature-pool-queue.json` summary, including runnable order and blocked entries.
- `dependencyGraph`: dependency relationships and missing dependencies.
- `userStoryMapping`: mapping from `US-*` to Feature/task checkpoints.
- `verificationPlan`: commands or acceptance checks per feature/story phase.
- `openQuestions`: unsliced or blocked scope questions.

## Minimal Valid Final JSON Shape

```json
{
  "contractVersion": "skill-contract/v1",
  "executionId": "<echo invocation.executionId>",
  "skillSlug": "task-slicing-skill",
  "requestedAction": "<echo invocation.requestedAction>",
  "status": "completed",
  "summary": "Generated or updated Feature Specs, docs/features/README.md, docs/features/feature-pool-queue.json, dependency graph, and verification plan.",
  "nextAction": null,
  "producedArtifacts": [
    {
      "path": "docs/features/README.md",
      "kind": "markdown",
      "status": "updated",
      "checksum": null,
      "summary": "Feature index table and dependency graph updated."
    },
    {
      "path": "docs/features/feature-pool-queue.json",
      "kind": "json",
      "status": "updated",
      "checksum": null,
      "summary": "Feature Spec Pool queue plan updated."
    }
  ],
  "traceability": {
    "featureId": null,
    "taskId": null,
    "requirementIds": [],
    "changeIds": []
  },
  "result": {
    "features": [
      {
        "id": "FEAT-001",
        "name": "<feature name>",
        "status": "planned",
        "milestone": "<milestone>",
        "dependencies": [],
        "primaryRequirements": []
      }
    ],
    "queuePlan": {
      "path": "docs/features/feature-pool-queue.json",
      "runnableOrder": [],
      "blockedEntries": [],
      "summary": "Feature Spec Pool queue plan is ready."
    },
    "dependencyGraph": {
      "relationships": [
        {
          "from": "FEAT-001",
          "to": "FEAT-002",
          "type": "depends_on"
        }
      ],
      "missingDependencies": []
    },
    "userStoryMapping": [
      {
        "userStoryId": "US-001",
        "featureId": "FEAT-001",
        "taskCheckpoints": []
      }
    ],
    "verificationPlan": [
      {
        "scope": "FEAT-001",
        "checks": []
      }
    ],
    "openQuestions": []
  }
}
```

## Failure Routing

- Use `clarification_needed` for unsliceable scope or missing acceptance.
- Use `risk_review_needed` for tasks requiring broad refactors or risky shared changes.
