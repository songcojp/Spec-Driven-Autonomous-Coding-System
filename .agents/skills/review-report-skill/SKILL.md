---
name: review-report-skill
description: "Produce review findings and delivery-risk reports for SpecDrive changes. Use when diff, test evidence, architecture risk, approval items, or Review Center records need concise actionable findings."
---

# Review Report Skill

Use this skill for code, spec, or delivery review summaries.

## Workflow

1. Read the diff, feature requirements, design, tasks, test evidence, and review item context.
2. Prioritize real bugs, behavioral regressions, missing tests, security/privacy risks, and spec drift.
3. Anchor findings to file paths, requirement IDs, or evidence IDs.
4. Separate blocking findings from suggestions.
5. Recommend the next state: approve, request fixes, clarify, risk review, rollback, or spec evolution.

## Output

- Findings ordered by severity.
- Evidence and source references.
- Required fixes or approval decision.
- Residual risk summary.

## Failure Routing

- Use `risk_review_needed` for high-risk unresolved findings.
- Use `clarification_needed` for spec ambiguity found during review.
