---
name: failure-recovery-skill
description: "Plan and execute bounded recovery for failed SpecDrive tasks. Use when a task failure, failed command, status check failure, or Codex Runner error produces a recovery task and retry policy."
---

# Failure Recovery Skill

Use this skill for recoverable failures only. Respect retry limits, failure fingerprints, and forbidden retry items.

## Workflow

1. Read the recovery task input: failure type, failed command, summary, related files, fingerprint, historical attempts, forbidden retry items, and max retries.
2. Classify the likely root cause from available context before editing.
3. Choose a recovery action: retry, auto-fix, alternate command, narrow rollback, spec clarification, or manual review.
4. Do not repeat a forbidden strategy for the same fingerprint.
5. If auto-fixing, keep edits inside the proposed file scope and run the verification command.
6. Record the outcome, verification summary, and whether retry budget remains.

## Output

- Recovery classification and action.
- Files changed or command retried.
- Verification summary.
- Updated failure fingerprint notes.

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- `summary` must state the failure classification, recovery action, and verification outcome.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `classification`: failure type and retryability.
- `actions`: array of recovery actions, file changes, or commands retried.
- `verification`: array of verification commands or inspections with outcomes.
- `failureFingerprint`: updated fingerprint or `null`.
- `retryBudgetRemaining`: boolean or number.
- `nextRecoveryAction`: recommended recovery or review action.

## Failure Routing

- Use `review_needed` when retry budget is exhausted.
- Use `clarification_needed` for spec mismatch or unclear expected behavior.
- Use `risk_review_needed` for recovery that requires broad or unsafe changes.
