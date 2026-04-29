---
name: add-requirement
description: Add new product requirements into the SpecDrive documentation flow. Use when Codex is asked to add a new requirement, capability, user story, constraint, non-functional requirement, edge case, or PRD/requirements scope item, then propagate it through PRD, EARS requirements, design/HLD, and Feature Specs with traceability.
---

# Add Requirement

## Workflow

1. Locate the active source lane. If the user does not provide paths, prefer `docs/zh-CN/PRD.md`, `docs/zh-CN/requirements.md`, `docs/zh-CN/hld.md`, `docs/zh-CN/design.md`, and `docs/features/README.md` in this repo.
2. Classify the new requirement:
   - Functional behavior -> `REQ-*`.
   - Non-functional quality, security, reliability, observability, or performance -> `NFR-*`.
   - Error, boundary, recovery, ambiguity, or exceptional path -> `EDGE-*`.
3. Update the PRD first when the new requirement changes product scope, user value, milestones, risks, data model, page surface, or non-goals. Keep the PRD concise and conclusion-first.
4. Update the adjacent `requirements.md` next. Add a stable ID, source trace, priority, EARS statement, and testable acceptance checks.
5. Run a consistency pass:
   - Every new requirement must point back to a PRD section, source note, clarification, or explicit user instruction.
   - Every new behavior must be atomic and observable.
   - Do not invent product intent; add a pending question when the input is ambiguous.
6. If the new requirement affects architecture, technology stack, data ownership, workflows, interfaces, state machines, or security boundaries, update `hld.md` or `design.md`.
7. Update Feature Specs:
   - If it belongs to an existing feature, update that feature's `requirements.md`, `design.md`, and `tasks.md`.
   - If it is independently deliverable, create a new feature folder and update `docs/features/README.md`.
   - Keep dependencies, milestone, status, and source `REQ-*`/`NFR-*`/`EDGE-*` mapping aligned.
8. Re-check downstream references: traceability matrix, MVP mapping, feature index, HLD split/dependency mapping, and open questions.

## Versioning

- Use `MINOR` for a new user story, capability, constraint, or externally visible behavior.
- Use `PATCH` only when the addition is a clarification or acceptance detail that does not expand scope.
- Use `MAJOR` when the addition changes product goals, core boundaries, or delivery model.

## Output Rules

- Preserve the source language unless the user asks otherwise.
- Prefer in-place edits to the current formal docs over creating scratch files.
- Keep IDs stable; append new IDs instead of renumbering existing requirements unless the user explicitly asks for a rebase.
- Keep implementation details out of requirements unless the PRD states them as hard constraints.
- If only documentation changed, do not touch code or feature worktrees.

## Quality Bar

- PRD, requirements, design/HLD, and Feature Specs agree on scope.
- New acceptance checks can become tests without interpretation.
- The feature index remains executable by `feature-spec-execution`.
- Ambiguity is visible as a clarification question, not hidden in vague wording.
