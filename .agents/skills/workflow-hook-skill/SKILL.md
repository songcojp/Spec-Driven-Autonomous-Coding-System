---
name: workflow-hook-skill
description: "Execute a single deterministic lifecycle side effect when a SpecDrive state transition occurs (feature selected, planning completed, task scheduled, status changed, review routed, recovery started, PR created, delivery closed). Use when a transition needs exactly one auditable side effect—snapshot, status attachment, index update, or audit note—but no planning, coding, testing, or review work."
---

# Workflow Hook Skill

Use this skill to make a single lifecycle side effect explicit and auditable. Each invocation handles **one trigger event** and **one side effect**. Do not combine multiple unrelated hooks into a single call.

## Supported Trigger Events

| Trigger Event | Expected Side Effect |
|---|---|
| Feature selected for scheduling | Project Memory snapshot |
| Planning completed | Feature index status update to `planned` |
| Task scheduled | Audit timeline entry |
| Status changed (task/feature) | Status summary attachment to state record |
| Review routed | Review Center item creation |
| Recovery started | Audit timeline entry + failure fingerprint record |
| PR created | Delivery report note |
| Delivery closed | Final Project Memory snapshot + feature index update to `done` |

## Workflow

1. Identify the triggering event from the table above.
2. Determine the required side effect (only one per invocation).
3. Execute only the hook side effect; do not perform unrelated planning, coding, testing, or review work.
4. Ensure the hook is idempotent when repeated with the same trigger and same state.
5. Record the hook result and any failure summary.

## Output

- Trigger event name.
- Side effect executed and artifact or state updated.
- Idempotency key or duplicate-handling note.
- Failure route if the hook did not complete.

## Failure Routing

- Use `blocked` for missing storage, permissions, or unavailable dependency.
- Use `review_needed` when the hook would change state without enough supporting context.
