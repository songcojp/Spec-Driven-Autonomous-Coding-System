---
name: repo-probe-skill
description: "Perform read-only repository exploration for SpecDrive planning, review, or recovery. Use when codebase facts, file ownership, commands, dependencies, or implementation patterns must be gathered without editing files."
---

# Repo Probe Skill

Use this skill for bounded read-only exploration.

## Workflow

1. Define the exact question, feature, module, or file set to probe.
2. Use fast local search such as `rg`, `rg --files`, `git status`, `git log`, and targeted file reads.
3. Identify relevant files, existing patterns, tests, commands, and constraints.
4. Avoid speculative implementation advice beyond the probe question.
5. Report confidence and any gaps that require deeper inspection.

## Output

- Source-backed repository facts.
- Relevant paths and commands.
- Existing conventions to reuse.
- Unknowns or risks.

## Failure Routing

- Use `clarification_needed` when the probe target is too broad or ambiguous.
