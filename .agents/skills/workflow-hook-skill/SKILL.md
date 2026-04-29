---
name: workflow-hook-skill
description: "Handle SpecDrive workflow hooks around scheduling, status changes, memory snapshots, evidence capture, delivery, and recovery. Use when a lifecycle transition needs a deterministic side effect or audit note."
---

# Workflow Hook Skill

Use this skill to make lifecycle side effects explicit and auditable.

## Workflow

1. Identify the triggering event: feature selected, planning completed, task scheduled, status changed, review routed, recovery started, PR created, or delivery closed.
2. Determine required side effects: Project Memory snapshot, Evidence Pack attachment, Review Center item, audit timeline entry, feature index update, or delivery report note.
3. Execute only the hook side effect; do not perform unrelated planning, coding, testing, or review work.
4. Ensure the hook is idempotent when repeated.
5. Record the hook result and any failure evidence.

## Output

- Trigger and hook action.
- Artifact or state updated.
- Idempotency key or duplicate handling note.
- Failure route if the hook did not complete.

## Failure Routing

- Use `blocked` for missing storage, permissions, or unavailable dependency.
- Use `review_needed` when the hook would change state without enough evidence.
