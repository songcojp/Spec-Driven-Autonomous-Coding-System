---
name: task-slicing-skill
description: "Slice a planned Feature Spec into executable tasks. Use after technical context, architecture, data model, contract, and quickstart validation are complete."
---

# Task Slicing Skill

This is the design-slug entry point for implementation task decomposition. Prefer the existing `split-feature-spec` workflow when creating or updating full Feature Spec folders.

## Workflow

1. Read requirements, design, architecture plan, data model plan, contract plan, quickstart validation, and existing `tasks.md`.
2. Create tasks that are independently reviewable, ordered by dependency, and tied to requirement IDs.
3. Assign expected files, allowed scope, required skill, subagent type, verification command, and done criteria.
4. Keep UI-bearing work explicit: route/page/component, states, controls, and browser verification.
5. Mark unsafe, unclear, or blocked tasks with review routing instead of hiding risk.

## Output

- Task graph or updated `tasks.md`.
- Dependencies and parallelism constraints.
- Verification plan.
- Requirement and acceptance mapping.

## Failure Routing

- Use `clarification_needed` for unsliceable scope or missing acceptance.
- Use `risk_review_needed` for tasks requiring broad refactors or risky shared changes.
