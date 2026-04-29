---
name: quickstart-validation-skill
description: "Validate that a planned feature can be started and tested before task slicing. Use in the planning pipeline before task-slicing-skill to prove commands, environment, entry points, and blockers."
---

# Quickstart Validation Skill

Use this skill as the pre-task-slicing feasibility gate.

## Workflow

1. Read the feature requirements, architecture plan, data model plan, contract plan, and repository commands.
2. Verify the expected runtime, package manager, test command, build command, and target files are available.
3. Identify the smallest command or inspection that proves the implementation path is startable and testable.
4. Record blockers explicitly instead of producing tasks that cannot run.
5. Do not modify source files unless the caller explicitly asks for a setup fix.

## Output

- Startability decision.
- Commands checked and expected working directory.
- Testability decision.
- Blockers and required remediation.

## Failure Routing

- Use `review_needed` with `clarification_needed` when the implementation path cannot be located.
- Use `blocked` when tooling or environment is missing.
