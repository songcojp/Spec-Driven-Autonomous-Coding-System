---
name: test-execution-skill
description: "Run and analyze tests for SpecDrive tasks or features. Use when targeted, regression, browser, build, or acceptance verification is required before status or delivery decisions."
---

# Test Execution Skill

Use this skill to produce trustworthy verification evidence.

## Workflow

1. Read the task or feature acceptance criteria and the repository's test/build commands.
2. Select the narrowest command that proves the changed behavior; broaden only when risk requires it.
3. Run tests from the correct worktree and runtime environment.
4. Classify failures as product mismatch, implementation bug, environment issue, flaky test, missing fixture, or spec gap.
5. Attach command, exit status, and concise output summary to evidence.

## Output

- Commands run and results.
- Failure classification.
- Evidence suitable for Status Checker.
- Recommended next action.

## Failure Routing

- Use `failure-recovery-skill` for recoverable implementation or test failures.
- Use `blocked` for missing environment or unavailable external dependency.
- Use `risk_review_needed` when evidence is insufficient for a high-risk change.
