---
name: codex-coding-skill
description: "Implement bounded coding tasks through Codex. Use when a scheduled task has requirements, design constraints, allowed file scope, verification commands, and enough context to modify code safely."
---

# Codex Coding Skill

Use this skill for implementation tasks after planning and scheduling.

## Workflow

1. Read the task, related Feature Spec, restrictive requirements, design constraints, and allowed file scope.
2. Inspect current files before editing and preserve unrelated user changes.
3. Implement the smallest change that satisfies the task and local patterns.
4. Add or update focused tests when behavior, contracts, state, or user-visible UI changes.
5. Run targeted verification and capture command results.
6. Report any deviations, blockers, or required spec evolution.

## Output

- Code changes within scope.
- Test or verification summary.
- Residual risks and follow-up notes.
- Return a `SkillOutputContractV1` JSON object with `contractVersion`, `executionId`, `skillSlug`, `requestedAction`, `status`, `summary`, `producedArtifacts`, and `traceability` matching the invocation contract.
- Put verification command results in `summary`, `producedArtifacts[].summary`, or `result` fields; do not add extra top-level output fields.

## Failure Routing

- Use `clarification_needed` when implementation intent is unclear.
- Use `risk_review_needed` when the required change exceeds the approved scope.
- Use `failure-recovery-skill` input when verification fails and recovery is allowed.
