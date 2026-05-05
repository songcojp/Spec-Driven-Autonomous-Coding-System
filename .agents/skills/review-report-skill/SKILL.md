---
name: review-report-skill
description: "Produce review findings and delivery-risk reports for SpecDrive changes. Use when diff, test results, architecture risk, approval items, or Review Center records need concise actionable findings. Includes spec drift detection: behavior that diverges from REQ-* requirements is reported as a finding."
---

# Review Report Skill

Use this skill for code, spec, or delivery review summaries.

## Workflow

1. Read the diff, feature requirements, design, tasks, test results, and review item context.
2. **Detect spec drift**: for each changed file in the diff, check whether the implemented behavior matches the acceptance criteria of the `REQ-*` or `US-*` requirements it was supposed to fulfill. Flag any divergence—over-implementation, under-implementation, or behavioral mismatch—as a spec drift finding.
3. Prioritize real bugs, behavioral regressions, missing tests, security/privacy risks, and spec drift.
4. Anchor findings to file paths, requirement IDs, or source references. Every finding must state: location, expected behavior (from spec), actual behavior (from diff), and severity.
5. Separate blocking findings from suggestions.
6. Recommend the next state: approve, request fixes, clarify, risk review, rollback, or spec evolution.

## Finding Severity Levels

| Severity | Description |
|---|---|
| **Blocking** | Wrong behavior, missing required feature, security risk, broken test, spec drift that changes user outcome |
| **Suggestion** | Style, minor readability, non-behavioral improvement, low-risk simplification |

## Output

- Spec drift findings (requirement ID → expected → actual → severity).
- Other findings ordered by severity (blocking first, then suggestions).
- Verification and source references.
- Required fixes or approval decision.
- Residual risk summary.

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- `summary` must state finding count by severity and whether the change can proceed.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `specDriftFindings`: array of requirement ID, expected behavior, actual behavior, and severity.
- `findings`: array of other review findings ordered by severity.
- `verificationReferences`: commands, files, lines, or evidence used.
- `requiredFixes`: blocking fixes or approval decisions.
- `residualRisks`: remaining risks after review.

## Failure Routing

- Use `risk_review_needed` for high-risk unresolved findings.
- Use `clarification_needed` for spec ambiguity found during review.
- Use `spec-evolution-skill` if a finding reveals that the spec itself is wrong (not the implementation).
