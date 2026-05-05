---
name: codex-coding-skill
description: "Implement bounded coding tasks through Codex. Use when a scheduled task has requirements, design constraints, allowed file scope, verification commands, and enough context to modify code safely."
---

# Codex Coding Skill

Use this skill for implementation tasks after planning and scheduling. The skill owns
the delivery lane from an isolated implementation worktree through PR merge and
branch cleanup.

## Workflow

1. Read the task, related Feature Spec, restrictive requirements, design constraints, allowed file scope, and project constitution constraints.
2. Inspect the current repository state and create an isolated implementation worktree on a feature branch before editing.
3. Run requirements review against the Feature Spec and source requirements. Confirm that each implementation task maps to approved `REQ-*`, `NFR-*`, `EDGE-*`, or task traceability. Stop with `clarification_needed` when material requirement intent is unclear.
4. Run design review against the Feature Spec design, HLD/design constraints, data/contract boundaries, and allowed file scope. Stop with `risk_review_needed` when the implementation would exceed approved design or scope.
5. If requirements or design review exposes a question that can be safely resolved by automatic decision, record it in a dedicated clarification and decision section in the corresponding document before implementation. Use the affected document closest to the decision:
   - Requirement ambiguity: add or update `## Clarifications and Decisions` / `## 澄清与决策记录` in the relevant `requirements.md`.
   - Design ambiguity: add or update `## Clarifications and Decisions` / `## 澄清与决策记录` in the relevant `design.md` or HLD document.
   - Task execution ambiguity: add or update a dedicated clarification and decision section in the relevant `tasks.md` or delivery notes.
   Record the chosen option, rationale, rejected alternatives, traceability IDs, and residual risk. If the decision needs user approval, do not auto-decide; return `clarification_needed`.
6. Create an implementation plan before editing. The plan must name the intended file scope, code path, test plan, review focus, and traceability IDs. Stop with `risk_review_needed` if the plan exceeds approved scope.
7. Inspect current files before editing and preserve unrelated user changes.
8. Implement the smallest change that satisfies the task and local patterns.
9. Run code review before test execution. Review the scoped diff for correctness, spec drift, architecture violations, missed edge cases, security risks, and test gaps.
10. Fix required code review findings before running the test flow. If a finding requires requirement or design changes, route through clarification, risk review, or spec evolution before continuing.
11. Add or update focused tests when behavior, contracts, state, or user-visible UI changes.
12. Run targeted verification and capture command results.
13. Commit the scoped changes on the feature branch with a narrow Conventional Commit message.
14. Create a pull request with traceability, changed files, verification results, deviations, and residual risks.
15. Merge the pull request after required checks/reviews pass.
16. Delete the remote feature branch after merge.
17. Delete the local worktree branch and remove the implementation worktree after confirming no uncommitted changes remain.
18. Report any deviations, blockers, cleanup failures, or required spec evolution.

## Review Gates

- Requirements review must happen before implementation and must verify the task has approved acceptance criteria and stable traceability.
- Design review must happen before implementation and must verify the planned code path respects architecture, persistence, contract, UI, and file-scope constraints.
- Implementation planning must happen after requirements/design review and before editing. The plan is binding for scope control unless later review or implementation evidence requires a recorded change.
- Code review must happen after implementation and before test execution. Required findings must be fixed before tests are treated as acceptance evidence.
- Both review gates are blocking. Do not continue into implementation when either gate requires user clarification, risk review, or spec evolution.
- Automatic clarification or design decisions are allowed only when the approved sources provide enough context to choose safely and the result is recorded in the corresponding document's dedicated clarification and decision section.

## Git Delivery

- Work in an isolated worktree for each implementation task or feature branch.
- Preserve unrelated changes in the source checkout and in the implementation worktree.
- Commit only the scoped implementation, tests, and required spec or decision-record updates.
- Create and merge the PR as part of the skill delivery lane when the environment has the required repository permissions and checks pass.
- After merge, clean up both the remote feature branch and local worktree branch. If cleanup cannot complete safely, report the exact blocker and leave the branch or worktree intact.

## Output

- Code changes within scope.
- Implementation plan summary.
- Code review findings and fixes.
- Test or verification summary.
- Residual risks and follow-up notes.
- Pull request, merge, branch cleanup, and worktree cleanup summary.
- Return a `SkillOutputContractV1` JSON object with `contractVersion`, `executionId`, `skillSlug`, `requestedAction`, `status`, `summary`, `producedArtifacts`, and `traceability`; echo invocation-owned traceability fields and manage any `changeIds` from the source documents.
- Put verification command results in `summary`, `producedArtifacts[].summary`, or `result` fields; do not add extra top-level output fields.

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- `summary` must state what was implemented and the verification outcome.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `changedFiles`: array of code, test, config, or docs files changed.
- `verification`: array of commands with `command`, `cwd`, `status`, `exitCode`, and concise `summary`.
- `implementedTasks`: array of completed Feature Spec task IDs or task names.
- `reviewGates`: array of requirements and design review outcomes with `gate`, `status`, `summary`, and related traceability IDs.
- `implementationPlan`: object with `summary`, `fileScope`, `testPlan`, `reviewFocus`, `traceabilityIds`, and `scopeStatus`.
- `codeReview`: object with `status`, `findings`, `fixesApplied`, and `residualReviewRisks`.
- `recordedDecisions`: array of automatic clarification or design decisions recorded in source documents with `document`, `section`, `decision`, `rationale`, `rejectedAlternatives`, and `residualRisk`.
- `gitDelivery`: object with `worktreePath`, `branch`, `commit`, `pullRequest`, `mergeStatus`, `remoteBranchDeleted`, `localBranchDeleted`, and `worktreeRemoved`.
- `residualRisks`: array of remaining risks or follow-ups.
- `blockedReason`: string or `null`.

## Failure Routing

- Use `clarification_needed` when implementation intent is unclear.
- Use `risk_review_needed` when the required change exceeds the approved scope.
- Use `failure-recovery-skill` input when verification fails and recovery is allowed.
- Use `blocked` when worktree creation, PR creation, merge, remote branch deletion, local branch deletion, or worktree removal cannot complete safely.
