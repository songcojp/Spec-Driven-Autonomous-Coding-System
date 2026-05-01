---
name: create-project-hld
description: "Create or regenerate the project-level HLD from PRD, EARS requirements, repository context, and existing HLD notes. Use when the Spec Workspace generate_hld action is triggered."
---

# Create Project HLD Skill

Use this skill to create or regenerate the project-level High Level Design. This is not a feature design skill and must not write `docs/features/<feature-id>/design.md`.

## Inputs

Read the available project-level sources:

1. `docs/zh-CN/PRD.md`
2. `docs/zh-CN/requirements.md`
3. `docs/zh-CN/hld.md` when it already exists
4. `docs/features/README.md` when feature boundaries already exist
5. Repository facts needed to confirm technology stack and runtime boundaries

## Workflow

1. Identify the product scope, MVP boundaries, and current requirement set.
2. Confirm the technology stack from repository evidence. If a decision cannot be made from sources, mark it as `TBD` with the exact missing decision.
3. Preserve project-level architecture boundaries: subsystems, data domains, integration strategy, workflows, security, observability, deployment, testing strategy, and feature decomposition guidance.
4. Keep feature-specific implementation details out of the project HLD. Route feature API fields, component internals, and task-level details to feature specs instead.
5. Reconcile stale `design.md` content only when it is consistent with PRD, requirements, and the current HLD direction.
6. Write the output to `docs/zh-CN/hld.md` unless the invocation explicitly provides another HLD path.

## Output

- `docs/zh-CN/hld.md` project-level HLD.
- Evidence summary listing input files, technology-stack decisions, requirement coverage, and unresolved architecture questions.

## Failure Routing

- Use `clarification_needed` when PRD/requirements are missing or conflict on core product boundaries.
- Use `risk_review_needed` when regenerating the HLD would invalidate existing Feature Spec boundaries.
- Use `blocked` when the workspace path or required source files cannot be read.
