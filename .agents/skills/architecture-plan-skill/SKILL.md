---
name: architecture-plan-skill
description: "Create a feature-level architecture plan from requirements, HLD, repository context, and research decisions. Use in the planning pipeline before data model, contract design, and task slicing."
---

# Architecture Plan Skill

Use this skill to turn feature requirements into an implementable technical plan.

## Workflow

1. Read feature requirements, feature design, project HLD, technical context, and research decisions.
2. Define feature components, ownership boundaries, integration points, state changes, error handling, and observability.
3. Preserve project-level architecture decisions; do not redefine the HLD.
4. Identify files or modules expected to change and which parts must remain untouched.
5. Note design gaps that block implementation or task slicing.

## Output

- Feature architecture plan.
- Component and module boundaries.
- State, error, recovery, and audit behavior.
- Implementation constraints and risks.

## Failure Routing

- Use `clarification_needed` for missing acceptance or unclear workflow.
- Use `risk_review_needed` for broad shared-module or architecture impact.
