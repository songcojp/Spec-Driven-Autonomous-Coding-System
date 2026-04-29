---
name: technical-context-skill
description: "Collect technical context for a Feature Spec planning pipeline. Use when a feature enters planning and needs repository facts, existing modules, constraints, test commands, package tooling, and implementation boundaries."
---

# Technical Context Skill

Use this skill as the first planning-stage skill.

## Workflow

1. Read the feature requirements, design, tasks, project HLD, and feature index.
2. Inspect the repository for existing modules, package manager, runtime versions, test commands, build commands, config files, and relevant conventions.
3. Identify likely files, APIs, data models, UI surfaces, test fixtures, and migration points.
4. Capture constraints that must govern downstream architecture, data model, contract, and task slicing.
5. Avoid code changes; this stage is read-only planning context.

## Output

- Repository context summary.
- Existing patterns and commands.
- Candidate implementation surfaces.
- Risks, unknowns, and required follow-up probes.

## Failure Routing

- Use `review_needed` with `clarification_needed` when required source artifacts or implementation boundaries are missing.
