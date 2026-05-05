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

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- `summary` must state the data ownership and migration/compatibility outcome.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `entities`: array of entity/table/model changes and ownership.
- `fields`: array of field-level changes with compatibility notes.
- `migrations`: array of required migrations, rollback notes, and data-loss risks.
- `lifecycleRules`: array of validation, state transition, concurrency, or retention rules.
- `verification`: array of required data, migration, or query checks.

## Failure Routing

- Use `risk_review_needed` for destructive migration, compatibility risk, or data-loss potential.
- Use `clarification_needed` for unclear ownership or lifecycle semantics.
