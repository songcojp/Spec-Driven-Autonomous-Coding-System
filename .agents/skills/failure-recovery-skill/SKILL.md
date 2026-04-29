---
name: failure-recovery-skill
description: "Plan and execute bounded recovery for failed SpecDrive tasks. Use when a task failure, failed command, status check failure, or Codex Runner error produces a recovery task and retry policy."
---

# Failure Recovery Skill

Use this skill for recoverable failures only. Respect retry limits, failure fingerprints, and forbidden retry items.

## Workflow

1. Read the recovery task input: failure type, failed command, summary, related files, fingerprint, historical attempts, forbidden retry items, and max retries.
2. Classify the likely root cause from evidence before editing.
3. Choose a recovery action: retry, auto-fix, alternate command, narrow rollback, spec clarification, or manual review.
4. Do not repeat a forbidden strategy for the same fingerprint.
5. If auto-fixing, keep edits inside the proposed file scope and run the verification command.
6. Record the outcome, evidence, and whether retry budget remains.

## Output

- Recovery classification and action.
- Files changed or command retried.
- Verification evidence.
- Updated failure fingerprint notes.

## Failure Routing

- Use `review_needed` when retry budget is exhausted.
- Use `clarification_needed` for spec mismatch or unclear expected behavior.
- Use `risk_review_needed` for recovery that requires broad or unsafe changes.
