---
name: requirement-intake-skill
description: "Intake and add new product requirements into the SpecDrive documentation flow. Use when a natural-language request, user story, capability, constraint, non-functional requirement, edge case, review finding, or implementation-discovered scope item must become governed PRD, EARS, design, and Feature Spec updates with traceability."
---

# Requirement Intake Skill

Before editing, follow the governance checklist in `docs/zh-CN/change-management.md` when it exists. This skill is the design-named requirement intake entry point and owns new requirement propagation.

## When to Use This Skill vs. `spec-evolution-skill`

| Situation | Use This Skill | Use `spec-evolution-skill` |
|-----------|---------------|----------------------------|
| Requirement does **not yet exist** anywhere in the spec | ✅ | |
| Adding a brand-new user story, capability, or constraint | ✅ | |
| Review finding adds a missing edge case not covered by any `EDGE-*` | ✅ | |
| Implementation discovered behavior that was never specified | ✅ | |
| **Existing** `REQ-*`/`NFR-*`/`EDGE-*` is inaccurate, incomplete, or contradicted by source material | | ✅ |
| Acceptance criteria of an existing requirement must change | | ✅ |
| Existing requirement must be deprecated or superseded | | ✅ |
| Wording clarification on an existing requirement with no scope change | | ✅ |

**Rule of thumb**: If you can assign a brand-new stable ID without displacing an existing one, use this skill. If you are editing, replacing, or annotating an existing ID, use `spec-evolution-skill`.

## Workflow

1. Locate the active source lane. If the user does not provide paths, prefer `docs/zh-CN/PRD.md`, `docs/zh-CN/requirements.md`, `docs/zh-CN/hld.md`, `docs/zh-CN/design.md`, and `docs/features/README.md` in this repo.
2. Classify the source: user request, PRD change, review finding, test result, delivery report, or implementation result.
3. Determine whether the intake is a new requirement, a change to an existing requirement, or a clarification. Use `spec-evolution-skill` for changes to existing requirements.
4. Classify the new requirement:
   - Functional behavior -> `REQ-*`.
   - Non-functional quality, security, reliability, observability, or performance -> `NFR-*`.
   - Error, boundary, recovery, ambiguity, or exceptional path -> `EDGE-*`.
   - Project Initialization (项目初始化) -> `NFR-*` or foundational `REQ-*`, capturing scaffolding, frameworks, and environment setup.
5. Update the PRD first when the new requirement changes product scope, user value, milestones, risks, data model, page surface, or non-goals. Keep the PRD concise and conclusion-first.
6. Update the adjacent `requirements.md` next. Add a stable ID, source trace, priority, EARS statement, and testable acceptance checks.
7. Run a consistency pass:
   - Every new requirement must point back to a PRD section, source note, clarification, or explicit user instruction.
   - Every new behavior must be atomic and observable.
   - Do not invent product intent; add a pending question when the input is ambiguous.
8. If the new requirement affects architecture, technology stack, data ownership, workflows, interfaces, state machines, or security boundaries, update `hld.md` or `design.md`.
9. Update Feature Specs:
   - If it belongs to an existing feature, update that feature's `requirements.md`, `design.md`, and `tasks.md`.
   - If it is independently deliverable, create a new feature folder and update `docs/features/README.md`.
   - Always update `docs/features/README.md` when creating or changing Feature information, even when the intake did not run the Feature splitting flow. Add or update the Feature ID, Feature name, folder, status, primary requirements, suggested milestone, and dependencies so IDE refresh and downstream execution do not see orphan Feature folders.
   - Keep dependencies, milestone, status, and source `REQ-*`/`NFR-*`/`EDGE-*` mapping aligned between the Feature folder and the index.
10. Re-check downstream references: traceability matrix, phase mapping, feature index, HLD split/dependency mapping, and open questions.

## Versioning

- Use `MINOR` for a new user story, capability, constraint, or externally visible behavior.
- Use `PATCH` only when the addition is a clarification or acceptance detail that does not expand scope.
- Use `MAJOR` when the addition changes product goals, core boundaries, or delivery model.

## Output

- Intake classification.
- Requirement IDs and affected documents.
- Acceptance criteria or open questions.
- Downstream sync notes.

## Output Rules

- Preserve the source language unless the user asks otherwise.
- Prefer in-place edits to the current formal docs over creating scratch files.
- Keep IDs stable; append new IDs instead of renumbering existing requirements unless the user explicitly asks for a rebase.
- Keep implementation details out of requirements unless the PRD states them as hard constraints.
- If only documentation changed, do not touch code or feature worktrees.

## Failure Routing

- Use `clarification_needed` when intent or acceptance cannot be made testable.
- Use `risk_review_needed` when the intake changes architecture, security, data ownership, or active feature scope.
