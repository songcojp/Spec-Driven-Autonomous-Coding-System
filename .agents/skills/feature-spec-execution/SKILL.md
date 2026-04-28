---
name: feature-spec-execution
description: "Execute a feature spec end-to-end: select feature, create an isolated worktree, review requirements/design constraints before implementation, pause for user clarification when needed, implement, test, run Codex CLI code review with automatic fixes, commit, create a PR, and clean up. Use when asked to implement, execute, or deliver a feature from the feature spec index. Prefer bounded pre-implementation review, implement, and test subagents when available; run code review through Codex CLI (`codex exec review`) before falling back to owner-thread review. Main agent and every subagent must plan before executing."
---

# Feature Spec Execution

This skill runs one feature spec through its complete delivery lifecycle on the owner thread, delegating bounded review, implementation, and testing work to dedicated subagents to prevent context bloat.

## Prerequisites

- Git repository with at least one remote (`origin`).
- `gh` CLI authenticated, or `GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_PAT` available in the environment.
- Feature spec folder exists under `docs/features/` with `requirements.md`, `design.md`, and `tasks.md`.
- Feature index table exists at `docs/features/README.md`.
- Base branch is clean and synced with its remote before creating the feature branch; if it is ahead or behind, resolve that first.

## Lifecycle Stages

```
SELECT FEATURE
    ↓
CREATE WORKTREE  (git worktree + feature branch)
    ↓
ALIGN BASE       (fetch + rebase branch on latest origin/main or origin/<base-branch>)
    ↓
UPDATE STATUS → in-progress  (inside feature branch)
    ↓
PRE-IMPLEMENTATION REVIEW
    requirements/design constraint review; pause for clarification if needed
    ↓
IMPLEMENT        (implementer-subagent: plan → implement)
    ↓
TEST             (test-subagent: plan → test)
    ↓
CODE REVIEW      (Codex CLI review → owner auto-fix → rerun verification)
    ↓
UPDATE STATUS → done
    ↓
GIT COMMIT       (feature branch only; follow git-commit-conventions skill)
    ↓
CREATE PR        (GitHub PR via gh CLI or REST API)
    ↓
DELETE WORKTREE  (git worktree remove + delete local feature branch)
```

---

## Stage 1 — Select Feature

1. Read `docs/features/README.md` to load the feature index table.
2. If the user explicitly named a feature ID or folder, use that feature.
3. Otherwise list features whose status column is `pending` or absent (not-started), sorted by milestone and dependency order.
4. Present the candidate list and ask the user to confirm selection before proceeding.
5. Record the chosen feature:
   - `FEATURE_ID`: e.g. `FEAT-001`
   - `FEATURE_FOLDER`: e.g. `feat-001-project-repository-foundation`
   - `FEATURE_BRANCH`: `feat/<FEATURE_FOLDER>` (e.g. `feat/feat-001-project-repository-foundation`)
   - `OWNER_REPO_PATH`: output of `git rev-parse --show-toplevel` in the original checkout
   - `WORKTREE_PATH`: sibling directory `../<repo-name>.worktrees/<FEATURE_FOLDER>/`

---

## Stage 2 — Create Worktree

```bash
# From the repository root
OWNER_REPO_PATH=$(git rev-parse --show-toplevel)
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKTREE_PATH="../${REPO_NAME}.worktrees/${FEATURE_FOLDER}"
BASE_BRANCH="${BASE_BRANCH:-main}"

git fetch origin
git worktree add -b "${FEATURE_BRANCH}" "${WORKTREE_PATH}" "origin/${BASE_BRANCH}"
```

- If `FEATURE_BRANCH` already exists locally, use `git worktree add "${WORKTREE_PATH}" "${FEATURE_BRANCH}"` instead.
- Use the current repository default branch if it is not `main`; record it as `BASE_BRANCH`.
- Before creating the worktree, check `git status --short --branch`; if the base branch is ahead or behind its remote, sync it before continuing.
- Confirm the worktree is listed in `git worktree list` before continuing.

---

## Stage 3 — Align Base

```bash
cd "${WORKTREE_PATH}"
git fetch origin
git rebase "origin/${BASE_BRANCH}"
```

- If rebase conflicts arise, resolve them before continuing.
- After rebase, verify `git log --oneline -3` to confirm the feature branch is aligned.

---

## Stage 4 — Update Feature Status → `in-progress`

Update the feature's row in `docs/features/README.md` inside `${WORKTREE_PATH}`:

- Add a `Status` column to the table if it does not exist.
- Set the selected feature's status cell to `in-progress`.
- Do not commit this on the main checkout. It belongs to the feature branch and will be committed in Stage 10 with the implementation.
- If execution aborts later, change this status to `blocked` in the feature branch when there is a PR-worthy artifact; otherwise leave the branch unpushed and report the failure.

---

## Stage 5 — Pre-Implementation Requirements and Design Review

This stage is mandatory. Do not implement until it passes or the user has answered required clarifications.

**Owner thread responsibilities:**

1. Read `docs/features/${FEATURE_FOLDER}/requirements.md`, `design.md`, and `tasks.md` fully.
2. Review the feature spec for restrictive requirements and design constraints:
   - Non-negotiable business rules, acceptance criteria, compatibility promises, security/privacy boundaries, performance limits, migration/data constraints, API contracts, UI/UX constraints, and prohibited behavior.
   - Design-to-requirement traceability: every required behavior has a design path and every implementation task maps to a requirement or explicit design decision.
   - Task readiness: `tasks.md` is actionable, ordered, and includes verification expectations.
   - Implementation boundary: expected files/modules are identifiable enough to avoid broad, speculative edits.
3. Produce a compact `PRE-IMPLEMENTATION REVIEW:` note containing:
   - `Pass`: `yes` or `no`.
   - `Restrictive requirements`: concise list of constraints that must govern implementation.
   - `Design constraints`: concise list of architectural/interface/data/UI constraints that must be preserved.
   - `Clarifications required`: questions that block safe implementation, or `none`.
   - `Spec fixes required`: concrete doc edits needed before implementation, or `none`.
4. If any clarification is required, stop the lifecycle, ask the user the blocking questions, and wait for the user's reply before implementation. Do not guess through unclear requirements.
5. After the user replies, update `requirements.md`, `design.md`, or `tasks.md` inside `${WORKTREE_PATH}` when the clarification changes the feature spec. Then rerun this stage before advancing.
6. If only non-blocking spec fixes are needed, apply them before implementation and include them in the feature branch commit.

Use a review subagent when available if the feature is complex or touches shared architecture. The review subagent must follow the Subagent Plan-Then-Execute Contract and must not modify files unless explicitly asked to apply spec-only fixes.

---

## Stage 6 — Implement (implementer-subagent or owner fallback)

**Owner thread responsibilities:**

1. Read `docs/features/${FEATURE_FOLDER}/requirements.md`, `design.md`, and `tasks.md` fully.
2. If subagents are available, compose a compact implementer dispatch prompt containing:
   - Absolute worktree path.
   - Full content of `requirements.md`, `design.md`, and `tasks.md` (inline, not by path reference alone).
   - The `PRE-IMPLEMENTATION REVIEW:` note from Stage 5, especially restrictive requirements and design constraints.
   - Explicit list of files the implementer is allowed to create or modify.
   - Expected verification command (from `tasks.md` or `design.md`).
   - Instruction: **plan first, then implement** (see Subagent Plan-Then-Execute Contract below).
3. Dispatch `implementer-subagent` with the prompt, then wait for the handoff summary.
4. If subagents are unavailable, run the same plan-then-execute contract in the owner thread inside `${WORKTREE_PATH}`.
5. Validate the handoff or owner-thread result: check that all tasks in `tasks.md` are ticked, the verification command passed, and no unexpected files were modified.
6. If blockers appear, update `tasks.md` with notes and decide whether to retry, adjust scope, or abort.

**Implementer-subagent responsibilities** (see Subagent Plan-Then-Execute Contract):

1. **Plan**: Produce a written implementation plan listing which files to create/modify, the order of changes, and the expected verification outcome. Output the plan as a `PLAN:` block before touching any file.
2. **Execute**: Implement each task in `tasks.md` sequentially, ticking checkboxes as each is completed.
3. **Verify**: Run the verification command inside the worktree and capture output.
4. **Handoff**: Return a compact summary: tasks completed, files changed, verification result, risks, and any doc-sync needs.

---

## Stage 7 — Test (test-subagent or owner fallback)

**Owner thread responsibilities:**

1. If subagents are available, compose a compact test dispatch prompt containing:
   - Absolute worktree path.
   - Acceptance criteria from `requirements.md`.
   - Implementer handoff summary (from Stage 6).
   - Explicit test scope: unit tests, integration tests, or both.
   - Instruction: **plan first, then test** (see Subagent Plan-Then-Execute Contract below).
2. Dispatch `test-subagent` with the prompt, then wait for the test handoff summary.
3. If subagents are unavailable, run the same plan-then-test contract in the owner thread inside `${WORKTREE_PATH}`.
4. Validate: all acceptance criteria are covered, tests pass, no regressions.
5. If tests fail, either re-dispatch `implementer-subagent` with the failure details, fix locally under the same contract, or log the failure and decide on scope adjustment.

**Test-subagent responsibilities** (see Subagent Plan-Then-Execute Contract):

1. **Plan**: Produce a written test plan listing which acceptance criteria map to which test cases, test file locations, and the run command. Output the plan as a `PLAN:` block before writing or running any test.
2. **Execute**: Write or update test files; run the full test suite.
3. **Report**: Return a compact summary: acceptance criteria covered, tests added/modified, pass/fail counts, coverage notes, and risks.

---

## Stage 8 — Codex CLI Code Review and Automatic Fixes

This stage is mandatory after implementation and tests. Treat it as an independent Codex CLI code-review pass focused on bugs, regressions, requirement drift, incomplete tests, and unsafe scope expansion. Prefer `codex exec review` because it runs Codex's dedicated local reviewer against the selected diff and does not modify the working tree.

**Owner thread responsibilities:**

1. Gather review inputs:
   - `git diff --stat` and `git diff` inside `${WORKTREE_PATH}`.
   - `requirements.md`, `design.md`, `tasks.md`, the `PRE-IMPLEMENTATION REVIEW:` note, implementer handoff, and test handoff.
   - The verification commands already run and their latest results.
2. Define a feature-scoped review output path before invoking Codex review:

```bash
CODEX_REVIEW_OUTPUT=".codex-code-review-${FEATURE_ID}.md"
```

3. Run Codex CLI review from inside `${WORKTREE_PATH}`:

```bash
cd "${WORKTREE_PATH}"

# Preferred after Stage 4 status/doc edits and implementation changes are still uncommitted.
codex exec review --uncommitted --output-last-message "${CODEX_REVIEW_OUTPUT}" \
  "Review this feature implementation against docs/features/${FEATURE_FOLDER}/requirements.md, design.md, tasks.md, and the Stage 5 restrictive requirements. Report only actionable bugs, regressions, requirement drift, incomplete tests, unsafe scope expansion, or security/privacy risks. Order findings by severity with file and line references when available."

# Alternative when reviewing a branch diff against its base.
codex exec review --base "${BASE_BRANCH}" --output-last-message "${CODEX_REVIEW_OUTPUT}" \
  "Review this feature branch against ${BASE_BRANCH}. Focus on actionable correctness, regression, requirement, testing, and safety findings."
```

4. If `codex exec review` is unavailable, use interactive Codex `/review` when practical, then copy the completed review summary into `"${CODEX_REVIEW_OUTPUT}"`. If neither Codex review path is available, run the same review in the owner thread and state that the dedicated Codex review path was unavailable.
5. Read `"${CODEX_REVIEW_OUTPUT}"` and classify every finding as:
   - `fix-now`: actionable, in scope, and does not change product intent.
   - `needs-clarification`: requires product clarification, scope expansion, or architecture change.
   - `no-action`: false positive, duplicate, already covered, or intentionally deferred with reason.
6. Automatically fix `fix-now` findings.
7. After every fix, rerun the relevant tests or verification commands. If a fix changes production code, rerun at least the targeted test command and any broader suite identified in `tasks.md`.
8. Repeat Codex review/fix/test until there are no unresolved high or medium severity actionable findings, or until all remaining findings are classified with reasons.
9. If a finding requires product clarification or scope expansion, stop, ask the user, and wait for the reply before continuing.
10. Record a compact `CODE REVIEW:` note:
   - Findings fixed.
   - Findings intentionally left unresolved, with reason.
   - Codex review output file path.
   - Codex review command used.
   - Verification rerun results.

**Code-review-subagent responsibilities** (see Subagent Plan-Then-Execute Contract):

Use a code-review subagent only when the Codex CLI review command is unavailable or when the owner explicitly needs an additional review pass after Codex review.

1. **Plan**: Produce a written review plan listing files/diffs to inspect, requirement/design constraints to verify, and tests to consider. Output the plan as a `PLAN:` block before reviewing.
2. **Review**: Report findings first, ordered by severity, with file and line references when available.
3. **Fix when delegated**: If the owner explicitly delegates fixes, apply only the requested fixes, then rerun relevant verification.
4. **Handoff**: Return findings, fixes applied, verification result, residual risks, and any clarification needs.

---

## Stage 9 — Update Feature Status → `done`

1. Work inside the feature worktree:

```bash
cd "${WORKTREE_PATH}"
```

2. Update `docs/features/README.md`:
   - Set the selected feature's status cell to `done`.
3. Stage this file as part of the feature commit in Stage 10.

---

## Stage 10 — Git Commit

Follow the `git-commit-conventions` skill. From inside `${WORKTREE_PATH}`:

```bash
git add -A
git commit -m "feat(${FEATURE_FOLDER}): implement ${FEATURE_ID} <short title>

<one-paragraph body summarising what was implemented and tested>

Refs: ${FEATURE_ID}"
```

- Keep the subject at or under 72 characters.
- Include the pre-implementation review, implementer handoff, test handoff, and code-review summaries in the body only if they are short; otherwise reference `tasks.md`.
- Also stage and commit the `docs/features/README.md` status update and any spec clarification edits in this commit.

---

## Stage 11 — Create PR

Resolve GitHub credentials in this order:
1. Global file `~/.github/token`
2. Project-local file `.github/token`
3. Shell environment variables: `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_PAT`

Use `gh` CLI when available:

```bash
cd "${WORKTREE_PATH}"
git push -u origin "${FEATURE_BRANCH}"

gh pr create \
  --title "feat: implement ${FEATURE_ID} <short title>" \
  --body "$(cat <<'EOF'
## Summary
<implementer handoff summary>

## Test Results
<test subagent summary>

## Code Review
<code-review summary>

## Feature Spec
Spec folder: `docs/features/${FEATURE_FOLDER}/`

Refs: ${FEATURE_ID}
EOF
)" \
  --base "${BASE_BRANCH}" \
  --head "${FEATURE_BRANCH}"
```

When `gh` is unavailable, fall back to the GitHub REST API:

```bash
curl -s -X POST \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls" \
  -d "{
    \"title\": \"feat: implement ${FEATURE_ID} <short title>\",
    \"head\": \"${FEATURE_BRANCH}\",
    \"base\": \"${BASE_BRANCH}\",
    \"body\": \"<summary>\"
  }"
```

Record the PR URL in the session output.

---

## Stage 12 — Delete Local Worktree

```bash
git -C "${OWNER_REPO_PATH}" worktree remove "${WORKTREE_PATH}" --force
git -C "${OWNER_REPO_PATH}" branch -d "${FEATURE_BRANCH}"
```

- Use `--force` on `git worktree remove` only if the worktree is confirmed clean and all commits were pushed to remote.
- Verify `git worktree list` no longer shows the removed path.
- Do NOT delete the remote branch; it remains for the open PR.

---

## Subagent Plan-Then-Execute Contract

Every subagent dispatched by this skill (review, implementer, test, code-review, or any future stage agent) **must** follow this two-phase protocol before producing any file output:

### Phase 1 — Plan

Output a `PLAN:` block that includes:

```
PLAN:
1. Goal: <one sentence describing what this subagent must achieve>
2. Inputs: <files and data given>
3. Steps:
   a. <step 1>
   b. <step 2>
   ...
4. Files to create/modify: <explicit list>
5. Verification: <command and expected output>
6. Done criteria: <observable state that signals completion>
```

Do not modify any file until the plan is written and internally validated.

### Phase 2 — Execute

- Follow the plan step by step.
- If a step reveals new information that invalidates the plan, write a `PLAN UPDATE:` block before deviating.
- Complete all steps and run verification.
- Return a compact handoff summary.

---

## Owner Thread Plan-Then-Execute Contract

The owner (main agent running this skill) must also plan before executing each stage:

1. Before starting, write a `STAGE PLAN:` listing all 12 stages with estimated blockers and decision points.
2. Before each stage, confirm prerequisites from the previous stage are met.
3. After each stage, record a one-line completion note before advancing.

---

## Status Vocabulary

Use these exact values in the `Status` column of `docs/features/README.md`:

| Value | Meaning |
|---|---|
| `pending` | Not yet started; waiting in backlog |
| `in-progress` | Owner thread has started this feature lifecycle |
| `done` | Implementation, tests, and code review complete; PR will include this status update |
| `merged` | PR merged to main |
| `blocked` | Cannot proceed; reason recorded in feature spec folder |

---

## Error and Abort Handling

- If Stage 2 (worktree creation) fails, do not update status or continue. Diagnose and report.
- If Stage 5 (pre-implementation review) finds blocking ambiguity, ask the user for clarification and do not implement until the user replies.
- If Stage 6 (implement) fails, update status to `blocked` in the feature branch only when committing a useful partial artifact is appropriate; otherwise leave the branch unpushed and report the blocker.
- If Stage 7 (test) fails, do not advance to Stage 8. Re-dispatch the implementer with failure details, or log the failure and mark `blocked`.
- If Stage 8 (code review) finds actionable defects, fix them and rerun verification before advancing. If the fix requires product clarification or scope expansion, ask the user and wait.
- If Stage 11 (PR creation) fails, leave the commits in the worktree, report the error, and provide the manual push command.
- Never force-delete the worktree if uncommitted changes exist.

---

## Output Discipline

- Prefer decision-oriented summaries over process narration.
- Report only what is needed to confirm each stage completed: stage name, key result, verification output, and next action.
- Do not repeat the full content of files already read; reference file names and line numbers instead.
