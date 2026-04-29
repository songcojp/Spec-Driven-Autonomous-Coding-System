---
name: quickstart-validation-skill
description: "Validate that a planned feature can be started and tested before task slicing—checking commands, environment, entry points, constitution compliance, and blockers. This skill is a pre-task-slicing startability gate, not a document producer. Use in the planning pipeline before task-slicing-skill."
---

# Quickstart Validation Skill

Use this skill as the pre-task-slicing feasibility gate. Its purpose is to confirm the implementation path is **startable**, **testable**, and **constitution-compliant** before task slicing commits to a task graph. It does not produce a spec artifact—it produces a go/no-go decision with evidence.

## Workflow

1. Read the feature requirements, architecture plan, data model plan, contract plan, and repository commands.
2. Verify the expected runtime, package manager, test command, build command, and target files are available.
3. Identify the smallest command or inspection that proves the implementation path is startable and testable.
4. **Check constitution compliance**: read `memory/constitution.md` (or equivalent project constitution) and confirm the planned architecture does not violate its gates (e.g., project count limit, framework-direct usage, test-first ordering, integration-first testing). Record any violations with the relevant article and a proposed resolution.
5. Record blockers explicitly instead of producing tasks that cannot run.
6. Do not modify source files unless the caller explicitly asks for a setup fix.

## Output

- Startability decision (go / blocked).
- Commands checked and expected working directory.
- Testability decision.
- Constitution compliance: pass or list of violations with article reference.
- Blockers and required remediation.

## Failure Routing

- Use `review_needed` with `clarification_needed` when the implementation path cannot be located.
- Use `blocked` when tooling or environment is missing.
- Use `risk_review_needed` when a constitution violation cannot be resolved without a scope or architecture decision.
