---
name: package-evidence
description: "Package audit and evidence artifacts. Use for evidence collection, delivery/audit logs, requirement/feature/change matrices, and evidence pack generation."
---

# Evidence Packaging

## Workflow

1. Confirm the requested outcome, source artifacts, workspace root, and allowed scope.
2. Read referenced files from disk and pass paths, IDs, and section anchors instead of pasted document bodies.
3. Apply this skill's workflow only to its declared responsibility; route adjacent lifecycle work to another project skill.
4. Produce or review the requested artifacts with traceability to PRD, requirements, HLD, Feature Spec, execution records, tests, or evidence as applicable.
5. Return the runtime-supplied structured output shape exactly. Echo `executionId`, `skillName`, `requestedAction`, produced artifacts, next action, and Feature-level traceability when the adapter provides them.

## Guidance

Collect machine-readable and human-readable evidence references without becoming the source of runtime state. Keep audit artifacts traceable to specs, runs, and commits.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions as `clarification_needed`, `review_needed`, `risk_review_needed`, or `blocked` instead of inventing facts.
