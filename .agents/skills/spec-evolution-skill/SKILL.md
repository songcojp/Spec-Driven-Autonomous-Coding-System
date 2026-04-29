---
name: spec-evolution-skill
description: "Manage requirement changes and spec evolution caused by user decisions, implementation, tests, review, delivery evidence, or repository reality. Use when PRD, EARS requirements, HLD, Feature Specs, tasks, milestones, or acceptance criteria must be changed, revised, replaced, deprecated, clarified, or reconciled."
---

# Spec Evolution Skill

Before editing, follow the governance checklist in `docs/zh-CN/change-management.md` when it exists. This skill is the design-named entry point for evidence-driven requirement and spec changes.

## Workflow

1. Identify the changed requirement and its current source of truth. If no path is given, inspect `docs/zh-CN/PRD.md`, `docs/zh-CN/requirements.md`, `docs/zh-CN/hld.md`, `docs/zh-CN/design.md`, and `docs/features/README.md`.
2. Identify the evidence source: implementation result, test failure, review finding, delivery report, approval decision, repository fact, or user instruction.
3. Classify the change:
   - `MAJOR`: product goal, core boundary, architecture direction, delivery model, or compatibility contract changes.
   - `MINOR`: new behavior, capability, user story, constraint, or materially expanded acceptance.
   - `PATCH`: wording, clarification, traceability, acceptance detail, or non-behavioral correction.
4. Determine whether this is Spec Evolution:
   - Implementation found the requirement inaccurate.
   - Acceptance criteria are not testable.
   - Repository reality conflicts with the plan.
   - Approval changed scope.
   - Tests exposed a missing edge case.
   - Runtime metrics exposed a new constraint.
5. For Spec Evolution, record the evidence source in the changed doc. Include impact scope and affected IDs.
6. Update documents in order:
   - PRD for product scope, source intent, non-goals, milestones, risks, page surfaces, or data model changes.
   - `requirements.md` for EARS statements, acceptance checks, priorities, traceability matrix, MVP mapping, and open questions.
   - `hld.md` or `design.md` when system boundaries, data domains, interfaces, state machines, technology stack, or risks change.
   - Feature Specs when the change affects executable feature scope, dependencies, tasks, or acceptance.
7. Preserve existing IDs when the requirement is semantically the same. Mark deprecated or superseded requirements explicitly when replacement is necessary; do not silently reuse an old ID for a different behavior.
8. If a change affects an active or completed Feature Spec, update the feature status or notes so execution does not continue from stale assumptions.
9. Re-run consistency checks across PRD, requirements, design/HLD, feature index, affected feature folders, and open questions.

## Output

- Change classification.
- Documents updated.
- Traceability and affected features.
- Review routing and residual risk.

## Output Rules

- Make localized edits instead of rewriting whole specs unless the change truly invalidates the structure.
- Preserve the source language unless the user asks otherwise.
- Keep change rationale short and evidence-backed.
- Do not directly modify implementation code unless the user explicitly asks to implement the changed requirement.
- Keep feature worktrees and unrelated docs out of scope unless they are part of the affected traceability chain.

## Failure Routing

- Use `approval_needed` for scope-changing product decisions.
- Use `risk_review_needed` for architecture or completed-feature impact.
- Use `clarification_needed` when evidence conflicts with product intent.
