---
name: recover-execution
description: "Recover failed or blocked SpecDrive execution. Use for failure classification, checkpoint validation, restore/resume decisions, retry budgeting, blocked-state marking, and focused recovery plans."
---

# Execution Recovery

## Workflow

1. Confirm the requested outcome, source artifacts, workspace root, and allowed scope.
2. Read referenced files from disk and pass paths, IDs, and section anchors instead of pasted document bodies.
3. Apply this skill's workflow only to its declared responsibility; route adjacent lifecycle work to another project skill.
4. Produce or review the requested artifacts with traceability to PRD, requirements, HLD, Feature Spec, execution records, tests, or evidence as applicable.
5. Return the runtime-supplied structured output shape exactly. Echo `executionId`, `skillName`, `requestedAction`, produced artifacts, next action, and Feature-level traceability when the adapter provides them.

## Guidance

Classify the failure, preserve evidence, choose the smallest safe recovery, and respect retry limits and approval boundaries.

## Harness: Reflection and Recovery Loop

This skill operates as the **Reflection** component in the Agent Harness architecture. Recovery is only valid if it begins with a structured self-critique of the failure.

### Reflection Step (mandatory before any recovery action)

Before deciding to retry, repair, or escalate, produce a `ReflectionRecord` with these fields:

- `failureType`: one of `context_gap` | `guardrail_block` | `execution_error` | `sensor_failure` | `spec_ambiguity`
- `failureCause`: concrete description of what went wrong (which file, which step, which assertion, which sensor)
- `guideUsed`: which SKILL.md or AGENTS.md sections governed the failed step
- `sensorRan`: which computational Sensors ran and their exit codes
- `sensorSkipped`: which Sensors did not run and why
- `inferentialJudgement`: if an inferential Sensor (AI review) declared a result, quote the key finding verbatim
- `selfCritique`: a one-paragraph critique: was the failure due to insufficient context (Guide missing facts), a violated guardrail (correct behavior), or a genuine implementation error?

**Failure Type Classification:**

| Type | Definition | Default Recovery |
|---|---|---|
| `context_gap` | The agent lacked sufficient source facts to complete the task correctly | Enrich context via `collect-project-context`, then retry once |
| `guardrail_block` | A harness rule or spec constraint correctly blocked an unsafe action | Do NOT retry; return `blocked` with the guardrail name; route to `manual-gated` |
| `execution_error` | Implementation or test code failed for a fixable reason (syntax, logic, missing file) | Attempt targeted repair up to retry budget |
| `sensor_failure` | A computational Sensor (lint, test, type-check) failed | Fix the failing code/spec; do not override Sensor; retry once per budget |
| `spec_ambiguity` | The Feature Spec lacks sufficient detail to implement or verify the task | Return `clarification_needed`; route to `decompose-feature-specs` or `manage-spec-change` |

### Recovery Rules

1. **Retry budget:** Maximum 3 retries per `taskId` per `executionId`. After 3 failures, set task status to `blocked` and require `manual-gated` override.
2. **Guardrail blocks are not recoverable:** If `failureType = guardrail_block`, do not retry. Return the ReflectionRecord as the primary output.
3. **Sensor failures must be fixed, not skipped:** Never mark a task `done` when a required computational Sensor is in a failed state. Record `sensorOverrideAttempt: true` as a protocol violation in the ReflectionRecord.
4. **Context enrichment is allowed once:** If `failureType = context_gap`, call `collect-project-context` to enrich, then resume. If the same context_gap recurs after enrichment, escalate to `spec_ambiguity`.
5. **Preserve all evidence:** Every retry must append to the `history[]` in `spec-state.json` with the ReflectionRecord summary, so the repair loop is auditable.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions as `clarification_needed`, `review_needed`, `risk_review_needed`, or `blocked` instead of inventing facts.
