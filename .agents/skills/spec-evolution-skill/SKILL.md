---
name: spec-evolution-skill
description: "Manage spec evolution caused by implementation, tests, review, delivery evidence, or user decisions. Use when PRD, requirements, HLD, Feature Specs, tasks, or acceptance criteria must be updated after new evidence."
---

# Spec Evolution Skill

This is the design-slug entry point for evidence-driven requirement changes. Prefer the existing `change-requirement` workflow for detailed propagation.

## Workflow

1. Identify the evidence source: implementation result, test failure, review finding, delivery report, approval decision, or user instruction.
2. Decide whether the spec needs a patch, minor expansion, deprecation, split, or rollback.
3. Update PRD, requirements, HLD/design, and affected Feature Specs in traceable order.
4. Preserve stable IDs where meaning is unchanged; mark superseded items explicitly.
5. Update feature status, tasks, or follow-up notes when existing execution artifacts are stale.

## Output

- Change classification.
- Documents updated.
- Traceability and affected features.
- Review routing and residual risk.

## Failure Routing

- Use `approval_needed` for scope-changing product decisions.
- Use `risk_review_needed` for architecture or completed-feature impact.
- Use `clarification_needed` when evidence conflicts with product intent.
