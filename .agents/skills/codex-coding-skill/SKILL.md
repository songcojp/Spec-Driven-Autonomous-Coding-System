---
name: codex-coding-skill
description: "Implement bounded coding tasks through Codex. Use when a scheduled task has requirements, design constraints, allowed file scope, verification commands, and enough context to modify code safely."
---

# Codex Coding Skill

Use this skill for implementation tasks after planning and scheduling. The skill owns
the feature implementation lane from an isolated implementation worktree through
scoped commit and GitHub pull request handoff. Local repository mutations use `git`
where needed for worktree creation/removal, local branch inspection, staging, and
commit creation. GitHub-facing delivery operations use `gh`, including push setup
when available, PR creation, PR checks, PR merge, and remote branch cleanup.

The scheduler/runtime should start this skill with a sandbox that can access the
target repository Git metadata and external worktree paths, such as
`danger-full-access` in trusted local development. Treat invocation `workspaceRoot`
as the source checkout unless it is already verified as an isolated worktree.

## Workflow

1. Read the task, related Feature Spec, restrictive requirements, design constraints, allowed file scope, and project constitution constraints.
2. Inspect the current repository state and create or verify an isolated implementation worktree on a feature branch before editing. Verify an existing isolated worktree with `git worktree list --porcelain`; otherwise create one with `git worktree add -b <branch> <worktree-path> <base>` from the source checkout. Do not implement feature code directly in the source checkout.
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
13. Confirm the implementation worktree contains only scoped changes, then commit them on the feature branch with a narrow Conventional Commit message.
14. Use `gh` for GitHub delivery: authenticate or report the blocker, push/set upstream as needed, create a pull request with traceability, changed files, verification results, deviations, and residual risks, then record the PR URL.
15. Use `gh pr checks` or the configured equivalent to inspect required checks. If checks or required reviews are pending or failing, stop with `approval_needed`, `review_needed`, or `blocked` instead of claiming delivery is complete.
16. Use `gh pr merge` only after required checks/reviews pass and project policy allows merge.
17. Delete the remote feature branch through `gh` or the PR merge cleanup option when available. Delete the local worktree branch and remove the implementation worktree only after confirming no uncommitted changes remain.
18. Report any deviations, blockers, cleanup failures, missing worktree evidence, missing commit evidence, missing PR evidence, or required spec evolution.

## Review Gates

- Requirements review must happen before implementation and must verify the task has approved acceptance criteria and stable traceability.
- Design review must happen before implementation and must verify the planned code path respects architecture, persistence, contract, UI, and file-scope constraints.
- Implementation planning must happen after requirements/design review and before editing. The plan is binding for scope control unless later review or implementation evidence requires a recorded change.
- Code review must happen after implementation and before test execution. Required findings must be fixed before tests are treated as acceptance evidence.
- Both review gates are blocking. Do not continue into implementation when either gate requires user clarification, risk review, or spec evolution.
- Automatic clarification or design decisions are allowed only when the approved sources provide enough context to choose safely and the result is recorded in the corresponding document's dedicated clarification and decision section.

## Git Delivery

- Work in an isolated worktree for each implementation task or feature branch. A feature implementation that runs in the source checkout without an explicitly verified implementation worktree must not return `completed`.
- Preserve unrelated changes in the source checkout and in the implementation worktree.
- Commit only the scoped implementation, tests, and required spec or decision-record updates. Local staging and commit creation may use `git`; never include unrelated modified files.
- Use `gh` for GitHub-facing operations: checking authentication, creating PRs, reading PR status/checks, merging PRs, and remote branch cleanup. Do not hardcode GitHub API calls when `gh` can provide the operation.
- Create and merge the PR as part of the skill delivery lane when the environment has the required repository permissions and checks pass. If repository policy requires a separate delivery skill, stop after the scoped commit and return `approval_needed` with a `nextAction` to run `pr-generation-skill`.
- After merge, clean up both the remote feature branch and local worktree branch. If cleanup cannot complete safely, report the exact blocker and leave the branch or worktree intact.
- `completed` requires auditable `gitDelivery` evidence for the worktree path, branch, commit hash, PR URL or approved delivery exemption, merge status, and cleanup status. Missing worktree, commit, or PR evidence must produce `review_needed`, `approval_needed`, or `blocked`.

## Output

- Code changes within scope.
- Implementation plan summary.
- Code review findings and fixes.
- Test or verification summary.
- Residual risks and follow-up notes.
- Pull request, merge, branch cleanup, and worktree cleanup summary with `gh` command evidence for GitHub-facing actions.
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
- `gitDelivery`: object with `worktreePath`, `worktreeVerified`, `sourceCheckoutPath`, `branch`, `baseCommit`, `targetBranch`, `commit`, `commitCreated`, `pullRequest`, `pullRequestUrl`, `ghCommands`, `checksStatus`, `mergeStatus`, `remoteBranchDeleted`, `localBranchDeleted`, `worktreeRemoved`, and `deliveryExemption`.
- `residualRisks`: array of remaining risks or follow-ups.
- `blockedReason`: string or `null`.

## Failure Routing

- Use `clarification_needed` when implementation intent is unclear.
- Use `risk_review_needed` when the required change exceeds the approved scope.
- Use `failure-recovery-skill` input when verification fails and recovery is allowed.
- Use `review_needed` when implementation produced changes but the output lacks auditable worktree, commit, PR, or verification evidence.
- Use `approval_needed` when protected branch, missing review, pending checks, or delivery policy prevents merge or requires a separate `pr-generation-skill` handoff.
- Use `blocked` when worktree creation, `gh` authentication, PR creation, merge, remote branch deletion, local branch deletion, or worktree removal cannot complete safely.
