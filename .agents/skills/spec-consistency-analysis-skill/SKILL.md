---
name: spec-consistency-analysis-skill
description: "Check planning outputs against the active Feature Spec. Use at the end of the planning pipeline to verify requirements, architecture plan, data model, contracts, and task slicing are mutually consistent."
---

# Spec Consistency Analysis Skill

Use this skill as the final planning gate before a feature moves to `tasked`.

## Workflow

1. Read the feature requirements, design, tasks, HLD references, and all planning-stage outputs.
2. Verify every requirement has a design path, task coverage, and acceptance verification plan.
3. Verify every task maps to an approved requirement, design decision, or explicit follow-up.
4. Check that data model, contracts, quickstart validation, and task slicing do not contradict each other.
5. List stale status, dependency, milestone, or feature-index entries that must be corrected.

## Output

- Consistency decision.
- Requirement-to-task coverage table.
- Contradictions or stale assumptions.
- Required fixes before implementation.

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- `summary` must state whether planning artifacts are consistent and what must be fixed before implementation.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `decision`: `"consistent"` or `"inconsistent"`.
- `coverage`: requirement-to-task coverage rows.
- `contradictions`: array of conflicts across requirements, design, data model, contracts, quickstart, or tasks.
- `staleAssumptions`: assumptions that no longer match current artifacts.
- `requiredFixes`: fixes required before implementation.

## Failure Routing

- Use `review_needed` when consistency fails.
- Use `clarification_needed` for unresolved requirements.
- Use `risk_review_needed` for architecture or cross-feature contradictions.
