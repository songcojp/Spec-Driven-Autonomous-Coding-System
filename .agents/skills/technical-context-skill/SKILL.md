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

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- `summary` must state the implementation surfaces, reusable conventions, commands, and unknowns.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `repositorySummary`: concise source-backed repository context.
- `implementationSurfaces`: candidate files, modules, APIs, UI surfaces, or schemas.
- `commands`: relevant install, dev, build, test, browser, or migration commands.
- `constraints`: technical constraints from HLD, Feature Spec, and repo facts.
- `followUpProbes`: required additional read-only probes.
- `risks`: risks and unknowns for downstream planning.

## Failure Routing

- Use `review_needed` with `clarification_needed` when required source artifacts or implementation boundaries are missing.
