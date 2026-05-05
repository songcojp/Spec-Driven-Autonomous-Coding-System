---
name: requirements-checklist-skill
description: "Check requirements for quality, readiness, and traceability. Use before a Feature Spec moves from draft to ready or before planning consumes requirements."
---

# Requirements Checklist Skill

Use this skill as the readiness gate for requirements.

## Workflow

1. Confirm every requirement is atomic, observable, testable, and traceable to PRD or approved source references.
2. Check that acceptance criteria can become tests without interpretation.
3. Verify error, empty, duplicate, permission, timeout, recovery, and concurrency paths where relevant.
4. Confirm open questions are either resolved or explicitly block readiness.
5. Report requirement IDs that are missing design, task, or feature coverage.

## Output

- Pass/fail readiness decision.
- Requirement gaps by ID.
- Missing acceptance checks.
- Required clarification or risk-review routing.

## Failure Routing

- Use `clarification_needed` for untestable or conflicting requirements.
- Use `risk_review_needed` when readiness gaps affect architecture, data, security, or active implementation.
