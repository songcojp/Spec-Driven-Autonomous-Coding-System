---
name: change-requirement
description: Manage requirement changes and Spec Evolution in the SpecDrive documentation flow. Use when Codex is asked to change, revise, replace, deprecate, narrow, expand, clarify, or reconcile an existing PRD, EARS requirement, Feature Spec, acceptance criterion, milestone, or implementation-discovered requirement.
---

# Change Requirement

Before editing, follow the governance checklist in `docs/zh-CN/change-management.md` when it exists. Use this skill for the requirement-change steps, and keep the checklist as the cross-document closeout contract.

## Workflow

1. Identify the changed requirement and its current source of truth. If no path is given, inspect `docs/zh-CN/PRD.md`, `docs/zh-CN/requirements.md`, `docs/zh-CN/hld.md`, `docs/zh-CN/design.md`, and `docs/features/README.md`.
2. Classify the change:
   - `MAJOR`: product goal, core boundary, architecture direction, delivery model, or compatibility contract changes.
   - `MINOR`: new behavior, capability, user story, constraint, or materially expanded acceptance.
   - `PATCH`: wording, clarification, traceability, acceptance detail, or non-behavioral correction.
3. Determine whether this is Spec Evolution:
   - Implementation found the requirement inaccurate.
   - Acceptance criteria are not testable.
   - Repository reality conflicts with the plan.
   - Approval changed scope.
   - Tests exposed a missing edge case.
   - Runtime metrics exposed a new constraint.
4. For Spec Evolution, record the evidence source in the changed doc: delivery report, review finding, test result, approval decision, or user instruction. Include impact scope and affected IDs.
5. Update documents in order:
   - PRD for product scope, source intent, non-goals, milestones, risks, page surfaces, or data model changes.
   - `requirements.md` for EARS statements, acceptance checks, priorities, traceability matrix, MVP mapping, and open questions.
   - `hld.md` or `design.md` when system boundaries, data domains, interfaces, state machines, technology stack, or risks change.
   - Feature Specs when the change affects executable feature scope, dependencies, tasks, or acceptance.
6. Preserve existing IDs when the requirement is semantically the same. Mark deprecated or superseded requirements explicitly when replacement is necessary; do not silently reuse an old ID for a different behavior.
7. If a change affects an active or completed Feature Spec, update the feature status or notes so execution does not continue from stale assumptions.
8. Re-run consistency checks across PRD, requirements, design/HLD, feature index, affected feature folders, and open questions.

## Review Routing

- Route to `clarification_needed` when intent, acceptance, technical boundary, or user impact is unclear.
- Route to `risk_review_needed` when the change expands scope, affects architecture, changes dependencies, or invalidates existing implementation/testing evidence.
- Route to `approval_needed` when the change requires permissions, high-risk operations, constitution changes, or business approval.

## Output Rules

- Make localized edits instead of rewriting whole specs unless the change truly invalidates the structure.
- Preserve the source language unless the user asks otherwise.
- Keep change rationale short and evidence-backed.
- Do not directly modify implementation code unless the user explicitly asks to implement the changed requirement.
- Keep feature worktrees and unrelated docs out of scope unless they are part of the affected traceability chain.

## Quality Bar

- The changed requirement has a clear before/after meaning.
- Traceability points to the current PRD/source and affected Feature Specs.
- Acceptance checks remain testable.
- Stale downstream assumptions are updated or explicitly listed as follow-up work.
- Open questions block readiness instead of being smoothed over.
