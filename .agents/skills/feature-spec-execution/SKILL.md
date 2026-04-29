---
name: feature-spec-execution
description: "Execute a feature spec end-to-end in full or simplified mode: select feature, create an isolated worktree, review requirements/design constraints before implementation, pause for user clarification when needed, implement, run targeted tests, perform mode-specific code review and fixes, commit, create a PR, clean temporary review artifacts, and remove the local worktree. Full mode runs Codex review plus final regression and full-suite gates; simplified mode uses a code-review agent, does not call Codex review, and skips full-suite testing. Use when asked to implement, execute, or deliver a feature from the feature spec index. Prefer bounded pre-implementation review, implementation, testing, and code-review subagents when available. Main agent and every subagent must plan before executing."
---

# Feature Spec Execution

This skill runs one feature spec through its delivery lifecycle on the owner thread, delegating bounded review, implementation, testing, and code-review work to dedicated subagents to prevent context bloat. Review artifacts are temporary execution evidence: keep them only while analyzing the current pass, summarize the final decision in committed feature artifacts, then delete the temporary artifacts before cleanup.

## Prerequisites

- Git repository with at least one remote (`origin`).
- `gh` CLI authenticated, or `GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_PAT` available in the environment.
- Feature spec folder exists under `docs/features/` with `requirements.md`, `design.md`, and `tasks.md`.
- Feature index table exists at `docs/features/README.md`.
- Base branch is clean and synced with its remote before creating the feature branch; if it is ahead or behind, resolve that first.
- Node/npm execution environment is available inside the owner checkout and feature worktree. If `npm` is missing but `~/.nvm/nvm.sh` exists, load nvm and use the repository `.nvmrc` before running verification or subagent commands.

## Execution Modes

Select the execution mode before Stage 1 and record it in the `STAGE PLAN`.

```bash
SPEC_EXECUTION_MODE="${SPEC_EXECUTION_MODE:-full}"
```

| Mode | Use when | Code review | Final tests |
|---|---|---|---|
| `full` | Default path for mainline-ready feature delivery, shared architecture, data migrations, security/privacy changes, public API changes, or any work with broad blast radius. | Run `codex exec review` to temporary logs, then owner analysis and bounded fixes. | Run final regression and one final full-suite test before commit. |
| `simplified` | User explicitly requests simplified mode, or the feature is narrow, low risk, and already covered by targeted tests. | Use a `code-review-subagent` directly against the diff and spec inputs. Do not call `codex exec review`. | Run the targeted Stage 7 command after review fixes. Do not run a full-suite test. |

- If the user says "简化模式", "simple mode", or equivalent, set `SPEC_EXECUTION_MODE=simplified`.
- If the user does not specify a mode, use `full`.
- Upgrade from `simplified` to `full` when implementation reveals cross-feature impact, schema migrations, security/privacy risk, public API compatibility risk, large refactors, or unclear test coverage. Record the reason before switching.
- Do not downgrade from `full` to `simplified` after Stage 8 starts unless the user explicitly approves the change.

## Lifecycle Stages

```
SELECT FEATURE
    ↓
CREATE WORKTREE  (git worktree + feature branch)
    ↓
ALIGN BASE       (fetch + rebase branch on latest origin/main or origin/<base-branch>)
    ↓
VERIFY EXEC ENV  (node/npm available in the feature worktree)
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
CODE REVIEW LOOP (mode-specific: Codex review logs in full mode; code-review agent in simplified mode)
    ↓
FINAL TEST GATE  (full: regression + full-suite; simplified: targeted regression only)
    ↓
UPDATE STATUS → done
    ↓
GIT COMMIT       (feature branch only; follow git-commit-conventions skill)
    ↓
CREATE PR        (GitHub PR via gh CLI or REST API)
    ↓
CLEANUP          (delete temporary review artifacts + remove local worktree)
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

## Stage 3.5 — Verify Execution Environment

Run this inside `${WORKTREE_PATH}` before updating status, dispatching subagents, or running any `node`, `npm`, `npx`, `codex`, or test command:

```bash
cd "${WORKTREE_PATH}"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  if [ -f .nvmrc ]; then
    nvm use --silent
  elif [ -f package.json ]; then
    nvm use --silent 24
  fi
fi

command -v node
node -v
command -v npm
npm -v
```

- If `npm` is still unavailable after this bootstrap, stop the lifecycle and report the missing tool before implementation. Do not let an implementer or test subagent discover the failure later.
- Include the same bootstrap snippet, or the resulting `PATH`, `node`, and `npm` locations, in implementer/test subagent dispatch prompts when the feature requires JavaScript tooling.
- Prefer the repository `.nvmrc` over the ambient shell default. On machines where the system `node` shadows nvm-managed Node, the explicit `nvm use` step must run before verification.

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
3. **Verify**: Run the feature-scoped verification command inside the worktree and capture output. Do not substitute a full repository suite unless the owner explicitly selected it as the final gate.
4. **Handoff**: Return a compact summary: tasks completed, files changed, verification result, risks, and any doc-sync needs.

---

## Stage 7 — Test (test-subagent or owner fallback)

**Owner thread responsibilities:**

1. Derive a bounded test plan before dispatching any test work:
   - Prefer an explicit `Verification Command` in `tasks.md` or `design.md`.
   - If no command is specified, infer a targeted command from changed production files and nearby tests, then record it in the stage note. Example for Node's built-in test runner: `node --test tests/recovery.test.ts tests/codex-runner.test.ts`.
   - Use targeted regression commands in Stage 7; reserve `npm test` or the repository full-suite command for the mandatory `full` mode final gate in Stage 8.
   - Do not add Jest-only flags such as `--runInBand` unless the repository actually uses Jest. For Node's built-in `node --test`, pass file paths directly.
   - Wrap long-running commands with a timeout, defaulting to `timeout 180s <command>` for targeted tests and `timeout 600s <command>` for `full` mode final full-suite gates unless the repository documents a different limit.
2. If subagents are available, compose a compact test dispatch prompt containing:
   - Absolute worktree path.
   - Acceptance criteria from `requirements.md`.
   - Implementer handoff summary (from Stage 6).
   - Explicit test scope: targeted unit tests and targeted integration tests for the feature.
   - Exact command(s) to run, including timeout wrappers.
   - Instruction that the test subagent must not expand to full-suite testing in Stage 7; full-suite execution is reserved for the Stage 8 final gate only when `SPEC_EXECUTION_MODE=full`.
   - Instruction: **plan first, then test** (see Subagent Plan-Then-Execute Contract below).
3. Dispatch `test-subagent` with the prompt, then wait for the test handoff summary.
4. If subagents are unavailable, run the same plan-then-test contract in the owner thread inside `${WORKTREE_PATH}`.
5. Validate: all acceptance criteria are covered by targeted tests and the targeted commands pass.
6. If tests fail, do not start broad exploratory testing. Re-dispatch the implementer with the exact failing command and output, fix locally under the same contract, or log the failure and decide on scope adjustment.
7. If a command times out, classify it as a test-command or performance blocker with the command, timeout value, and last output. Do not rerun the same command with a longer timeout unless the owner explicitly decides it is the right gate.

**Test-subagent responsibilities** (see Subagent Plan-Then-Execute Contract):

1. **Plan**: Produce a written test plan listing which acceptance criteria map to which test cases, test file locations, and the run command. Output the plan as a `PLAN:` block before writing or running any test.
2. **Execute**: Write or update only in-scope test files; run the owner-specified targeted command(s). Do not run the full suite during Stage 7.
3. **Report**: Return a compact summary: acceptance criteria covered, tests added/modified, exact commands run, timeout values, pass/fail counts, coverage notes, and risks.

---

## Stage 8 — Mode-Specific Code Review, Fix Loop, and Final Test Gate

This stage is mandatory after implementation and targeted tests. Treat review output as a raw signal, not as the gate decision itself: collect mode-specific review output, then have the owner analyze it against the feature spec, Stage 5 restrictive requirements, implementation diff, and test evidence. Do not automatically fix every review comment. The owner fixes only findings classified as actionable, in-scope, and high/medium risk. Every fix batch must also be temporarily logged so the lifecycle can diagnose whether fixes are introducing new defects during the current run.

- In `full` mode, run Codex review, write every pass output to temporary log files, then run final regression followed by one full-suite test gate before Stage 9 and before any commit.
- In `simplified` mode, do not call `codex exec review`. Dispatch a `code-review-subagent` against the same inputs, analyze its handoff, fix approved issues, then rerun the targeted Stage 7 command as the final regression gate. Do not run a full-suite test.

**Owner thread responsibilities:**

1. Gather review inputs:
   - `git diff --stat` and `git diff` inside `${WORKTREE_PATH}`.
   - `requirements.md`, `design.md`, `tasks.md`, the `PRE-IMPLEMENTATION REVIEW:` note, implementer handoff, and test handoff.
   - The verification commands already run and their latest results.
2. Define feature-scoped review, analysis, and final-gate variables:

```bash
SPEC_EXECUTION_MODE="${SPEC_EXECUTION_MODE:-full}"
CODE_REVIEW_PASS="${CODE_REVIEW_PASS:-1}"
REVIEW_ARTIFACT_DIR=".codex/tmp/feature-review/${FEATURE_ID}"
CODEX_REVIEW_LOG="${REVIEW_ARTIFACT_DIR}/codex-review-${FEATURE_ID}-pass-${CODE_REVIEW_PASS}.log.md"
AGENT_REVIEW_LOG="${REVIEW_ARTIFACT_DIR}/agent-review-${FEATURE_ID}-pass-${CODE_REVIEW_PASS}.md"
REVIEW_ANALYSIS_OUTPUT="${REVIEW_ARTIFACT_DIR}/review-analysis-${FEATURE_ID}-pass-${CODE_REVIEW_PASS}.md"
FIX_LOG="${REVIEW_ARTIFACT_DIR}/fix-pass-${FEATURE_ID}-${CODE_REVIEW_PASS}.md"
REVIEW_LOOP_ANALYSIS="${REVIEW_ARTIFACT_DIR}/review-loop-analysis-${FEATURE_ID}.md"
REVIEW_FIX_CHECKPOINT_INTERVAL="${REVIEW_FIX_CHECKPOINT_INTERVAL:-3}"
CODEX_REVIEW_MODEL="${CODEX_REVIEW_MODEL:-gpt-5.4}"
FINAL_REGRESSION_COMMAND="${FINAL_REGRESSION_COMMAND:-<targeted Stage 7 command>}"
FINAL_FULL_TEST_COMMAND="${FINAL_FULL_TEST_COMMAND:-npm test}"
```

3. Create `"${REVIEW_ARTIFACT_DIR}"`, then run the mode-specific review. The directory is temporary and must be deleted in Stage 12 after final summaries are recorded.

**Full mode review command:**

Run Codex review from inside `${WORKTREE_PATH}` and write the raw result to `"${CODEX_REVIEW_LOG}"`. This lifecycle should keep the review scope command CLI-compatible; do not append a positional prompt when the installed CLI rejects prompts combined with review-scope flags.

```bash
cd "${WORKTREE_PATH}"
mkdir -p "${REVIEW_ARTIFACT_DIR}"

# Preferred after Stage 4 status/doc edits and implementation changes are still uncommitted.
timeout 1800s codex exec review --model "${CODEX_REVIEW_MODEL}" --uncommitted --output-last-message "${CODEX_REVIEW_LOG}"

# Alternative when reviewing a branch diff against its base.
timeout 1800s codex exec review --model "${CODEX_REVIEW_MODEL}" --base "${BASE_BRANCH}" --output-last-message "${CODEX_REVIEW_LOG}"
```

If Codex review times out or fails, write the command, exit status, and last output to `"${CODEX_REVIEW_LOG}"`, then run owner-thread review against the same inputs. Do not let a failed or slow Codex review block the lifecycle indefinitely.

**Simplified mode review dispatch:**

Dispatch a `code-review-subagent` with a compact prompt containing:

- Absolute worktree path.
- `git diff --stat` and either the full `git diff` or a path-limited diff list when the diff is too large.
- Full content of `requirements.md`, `design.md`, and `tasks.md` (inline, not by path reference alone).
- The `PRE-IMPLEMENTATION REVIEW:` note from Stage 5.
- Implementer and test handoff summaries.
- Exact targeted command(s) already run in Stage 7.
- Instruction: **plan first, then review**.
- Instruction: report findings first, ordered by severity, and include file/line references when available.
- Instruction: do not modify files unless the owner later delegates a specific fix.

Write the code-review-subagent handoff to `"${AGENT_REVIEW_LOG}"`. If subagents are unavailable, the owner thread performs the same review and writes the result to `"${AGENT_REVIEW_LOG}"`. Simplified mode must not run `codex exec review`.

4. Analyze the mode-specific review output before fixing anything:
   - In `full` mode, analyze `"${CODEX_REVIEW_LOG}"`.
   - In `simplified` mode, analyze `"${AGENT_REVIEW_LOG}"`.

   The owner must produce `"${REVIEW_ANALYSIS_OUTPUT}"` containing:
   - `Decision`: `fix-required`, `no-fix-required`, `needs-clarification`, or `blocked`.
   - `Fix-now`: only high/medium severity actionable correctness, requirement, security/privacy, or missing-test findings that are in scope.
   - `No-action`: false positives, low-risk suggestions, style preferences, speculative risks, duplicate findings, already-tested behavior, or scope-expansion ideas, each with a reason.
   - `Needs clarification`: findings that require product, architecture, or scope decisions.
   - `Spec boundary judgment`: for every `Fix-now` candidate, cite the exact requirement, design section, task, acceptance criterion, or Stage 5 restrictive requirement that makes it in scope. If no citation exists, classify the finding as `No-action` or `Needs clarification`; do not fix it automatically.
   - `Compatibility judgment`: whether any proposed fix introduces legacy/compatibility behavior, with evidence that the legacy behavior is from a released, merged, externally depended-on, or explicitly migration-scoped version. If no such evidence exists, classify compatibility-style fixes as scope expansion or design drift, not `Fix-now`.
   - `Review quality judgment`: whether the review output was useful, noisy, stale, or contradicted by tests/spec evidence.
5. Automatically fix only `Fix-now` findings from `"${REVIEW_ANALYSIS_OUTPUT}"`. A `Fix-now` entry is invalid unless it has a concrete spec-boundary citation. Do not fix `No-action` findings merely because review mentioned them, and do not extend requirements/design/tasks during implementation just to make a review finding fit.
6. After each fix batch, create `"${FIX_LOG}"` before the next review pass. The fix log must include:
   - Source review pass and analysis file path.
   - Findings selected for repair, with severity and reason.
   - Files changed by the fix batch.
   - Intended behavioral change and requirement/design trace.
   - Spec-boundary citation proving the fix stays inside current feature scope.
   - Compatibility/legacy rationale: `none`, or concrete evidence that compatibility is required by an existing released/merged behavior, external dependency, persisted data migration, or explicit feature requirement.
   - Risks introduced by the fix.
   - Whether the fix may create follow-on work.
   - Commands intentionally not run yet because regression waits until the review-analysis loop is clean.
   A feature that has not reached a formal completed, merged, or externally consumed version must not create "legacy" compatibility branches for its own intermediate implementation states. In that case, fix toward the current requirements/design source of truth instead of preserving the transient behavior.
7. Do not run regression tests between review-analysis passes. After each fix batch, increment `CODE_REVIEW_PASS`, run the same mode-specific review again to a new temporary artifact, analyze the new output, and classify findings again.
8. Continue the review-output -> owner-analysis -> fix loop until `"${REVIEW_ANALYSIS_OUTPUT}"` says `Decision: no-fix-required`, or until the lifecycle stops for clarification/blocker.
9. If `CODE_REVIEW_PASS` reaches `"${REVIEW_FIX_CHECKPOINT_INTERVAL}"` and the loop is still not clean, pause for a mandatory owner checkpoint and create `"${REVIEW_LOOP_ANALYSIS}"`. Repeat this checkpoint after each additional `"${REVIEW_FIX_CHECKPOINT_INTERVAL}"` review passes if the loop is still not clean. The default interval is 3 passes; it is a diagnostic checkpoint, not a hard repair ceiling. The loop analysis must answer:
   - How many review passes and fix batches ran.
   - Which findings repeated across passes.
   - Which findings disappeared after fixes.
   - Which new findings appeared after a fix batch.
   - Whether fixes are introducing new defects, expanding scope, or changing architecture.
   - Which fixes lacked a clear spec-boundary citation and should have been blocked before implementation.
   - Whether compatibility/legacy fixes were introduced without evidence of a formal completed version, external dependency, persisted-data migration need, or explicit requirement.
   - Whether remaining findings are real high/medium issues, low-value review noise, spec ambiguity, test gaps, or design mismatch.
   - Whether the implementation should continue with a narrower fix, roll back a fix batch, revise requirements/design/tasks, ask the user for clarification, or stop as blocked.
   - A pass-by-pass table referencing every mode-specific review artifact, owner analysis file, and fix log.
   After writing this analysis, the owner must make and record a `Checkpoint decision` before any more repair:
   - `continue-controlled`: allowed only when every remaining finding is real, high/medium risk, in scope, has a concrete spec-boundary citation, has no product/architecture ambiguity, and the next fix batch is narrower than the prior batch.
   - `needs-user-clarification`: use when remaining work changes product intent, architecture, feature scope, compatibility expectations, or rollback strategy; ask the user and wait.
   - `rollback-or-stop`: use when fixes are introducing new defects, repeatedly failing to address the same finding, or expanding scope.
   A `continue-controlled` decision may start the next review/fix pass without treating the checkpoint as a user-blocking failure. Before continuing, write the decision, selected findings, file scope, and risk controls into `"${REVIEW_LOOP_ANALYSIS}"` or the next `"${FIX_LOG}"`.
10. Stop the loop when:
   - Owner analysis confirms no unresolved high/medium actionable issue remains.
   - `needs-clarification` appears; ask the user and wait before continuing.
   - The same actionable finding persists after an attempted fix and cannot be resolved without changing product intent, architecture, or scope; report it as a blocker and do not commit.
   - In `full` mode, Codex review repeatedly times out or produces unusable/noisy output; record that judgment and fall back to owner-thread review for the gate.
11. After the review-analysis loop is clean, run the mode-specific mandatory final gates:
   - `full`: run final regression, `timeout 180s ${FINAL_REGRESSION_COMMAND}` unless the repository documents a different timeout; then run final full-suite test, `timeout 600s ${FINAL_FULL_TEST_COMMAND}` unless the repository documents a different full-suite command or timeout.
   - `simplified`: run final targeted regression, `timeout 180s ${FINAL_REGRESSION_COMMAND}` unless the repository documents a different timeout. Do not run `${FINAL_FULL_TEST_COMMAND}`.
12. If a final gate fails, fix the failure, rerun the mode-specific review to a new artifact, rerun owner analysis until clean, then repeat the mode-specific final gate sequence.
13. Record a compact `CODE REVIEW AND FINAL TEST GATE:` note:
   - Execution mode.
   - Findings fixed.
   - Findings intentionally left unresolved, with reason.
   - Review pass count and compact summary of each pass. Do not commit raw review artifacts.
   - Owner analysis decision for each pass. Do not commit raw owner-analysis logs.
   - Fix batch summary for each fix. Do not commit raw fix logs.
   - Review loop analysis summary if the loop reached `"${REVIEW_FIX_CHECKPOINT_INTERVAL}"` or a later checkpoint, or was stopped as blocked.
   - Review quality judgment for each pass.
   - Confirmation that no regression tests were run between review/fix passes.
   - Final regression command and result.
   - In `full` mode, final full-suite command and result.
   - In `simplified` mode, explicit confirmation that full-suite testing was skipped by mode.

**Code-review-subagent responsibilities** (see Subagent Plan-Then-Execute Contract):

Use a code-review subagent for simplified-mode review, and optionally use a review-analysis subagent in full mode to help classify Codex review logs when the owner needs a second opinion. The owner remains responsible for the final classification and fix/no-fix decision.

1. **Plan**: Produce a written review plan listing files/diffs to inspect, requirement/design constraints to verify, and tests to consider. Output the plan as a `PLAN:` block before reviewing.
2. **Review**: Report findings first, ordered by severity, with file and line references when available.
3. **Fix when delegated**: If the owner explicitly delegates fixes, apply only the requested fixes, then rerun relevant verification.
4. **Handoff**: Return findings, fixes applied, verification result, residual risks, and any clarification needs.

---

## Stage 9 — Update Feature Status → `done`

Do not update status to `done` until Stage 8 has recorded a clean review loop and the mode-specific final gate has passed: final regression plus one full-suite test in `full` mode, or targeted final regression only in `simplified` mode.

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
- Also stage and commit the `docs/features/README.md` status update and any spec clarification edits. Do not stage raw review artifacts, owner-analysis logs, fix logs, or temporary loop-analysis files from `"${REVIEW_ARTIFACT_DIR}"`.

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

## Stage 12 — Clean Temporary Artifacts and Remove Local Worktree

After the commit and PR are created, delete temporary review artifacts and remove the local worktree. Cleanup is part of normal successful execution.

Run and report:

```bash
git -C "${WORKTREE_PATH}" status --short --branch
rm -rf "${WORKTREE_PATH}/${REVIEW_ARTIFACT_DIR}"
git -C "${OWNER_REPO_PATH}" worktree remove "${WORKTREE_PATH}"
git -C "${OWNER_REPO_PATH}" worktree list
```

- Before removal, `git -C "${WORKTREE_PATH}" status --short --branch` must be clean except for ignored/generated files that are safe to delete. If the worktree is dirty after commit, stop and report the remaining files instead of removing it.
- Confirm `"${WORKTREE_PATH}/${REVIEW_ARTIFACT_DIR}"` was removed before removing the worktree.
- Record the removed `WORKTREE_PATH`, `FEATURE_BRANCH`, and PR URL in the final session output.
- Do not delete the remote branch; it remains for the open PR.
- Do not delete the local feature branch unless the repository workflow explicitly requires it after PR creation; removing the worktree is sufficient.

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
| `done` | Implementation, targeted tests, owner review analysis summary, mode-specific final gate, PR creation, temporary artifact cleanup, and local worktree removal complete |
| `merged` | PR merged to main |
| `blocked` | Cannot proceed; reason recorded in feature spec folder |

---

## Error and Abort Handling

- If Stage 2 (worktree creation) fails, do not update status or continue. Diagnose and report.
- If Stage 5 (pre-implementation review) finds blocking ambiguity, ask the user for clarification and do not implement until the user replies.
- If Stage 6 (implement) fails, update status to `blocked` in the feature branch only when committing a useful partial artifact is appropriate; otherwise leave the branch unpushed and report the blocker.
- If Stage 7 (test) fails, do not advance to Stage 8. Re-dispatch the implementer with failure details, or log the failure and mark `blocked`.
- Stage 10 must not start unless Stage 8 has a clean review loop and the mode-specific final gate result recorded after the last fix.
- If Stage 11 (PR creation) fails, leave the commits in the worktree, report the error, and provide the manual push/PR command. Do not remove the worktree until PR creation succeeds or the user explicitly requests cleanup.
- On successful Stage 11 completion, Stage 12 must remove temporary review artifacts and the local worktree.

---

## Output Discipline

- Prefer decision-oriented summaries over process narration.
- Report only what is needed to confirm each stage completed: stage name, key result, verification output, and next action.
- Do not repeat the full content of files already read; reference file names and line numbers instead.
