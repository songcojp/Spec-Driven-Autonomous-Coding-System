---
name: data-model-skill
description: "Design or validate feature-level data model changes. Use when planning involves persistence, schema migration, state records, view models, events, verification summaries, audit, or data ownership."
---

# Data Model Skill

Use this skill in planning when a feature reads, writes, migrates, or presents durable data.

## Workflow

1. Read requirements, feature design, HLD data domains, and existing schema/model code.
2. Identify owned entities, fields, lifecycle states, invariants, indexes, migrations, and retention/audit needs.
3. Preserve compatibility with existing schema versioning and migration strategy.
4. Define validation, idempotency, concurrency, and rollback behavior.
5. Map each data change to requirements and tests.

## Output

- Entity and field changes.
- Migration and compatibility plan.
- Validation and lifecycle rules.
- Test and verification-summary requirements.

## Failure Routing

- Use `risk_review_needed` for destructive migration, compatibility risk, or data-loss potential.
- Use `clarification_needed` for unclear ownership or lifecycle semantics.
