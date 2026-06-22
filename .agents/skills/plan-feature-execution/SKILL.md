---
name: plan-feature-execution
description: "Plan executable Feature work. Use for task DAG reasoning, dependency resolution, risk estimation, adapter selection, execution readiness checks, and selecting the next runnable Feature from the pool."
---

# Feature Execution Planning

## Workflow

1. Confirm the requested outcome, source artifacts, workspace root, and allowed scope.
2. Read referenced files from disk and pass paths, IDs, and section anchors instead of pasted document bodies.
3. Apply this skill's workflow only to its declared responsibility; route adjacent lifecycle work to another project skill.
4. Produce or review the requested artifacts with traceability to PRD, requirements, HLD, Feature Spec, execution records, tests, or evidence as applicable.
5. Return the runtime-supplied structured output shape exactly. Echo `executionId`, `skillName`, `requestedAction`, produced artifacts, next action, and Feature-level traceability when the adapter provides them.

## Guidance

Select or prepare only work that satisfies queue, dependency, readiness, constitution, and workspace constraints. Return blocked reasons instead of forcing execution.

## Harness: Observe → Plan → Act Loop

This skill operates as the **Planner** component in the Agent Harness architecture. A plan is only valid if it begins with an Observe phase that reads current Sensor feedback.

### ① Observe Phase (read Sensor feedback first)

Before selecting or scheduling any Feature:

1. Read the current state from `spec-state.json` for candidate Features: `executionStatus`, `blockedReasons`, `uiDesignRef.designStatus`, and `history[]`.
2. Read the most recent checkpoint at `.autobuild/runs/<lastExecutionId>/checkpoint.json` if present. Treat `checkpoint.currentStage`, `checkpoint.failedTasks`, and `checkpoint.sensorResults` as live Sensor feedback that must influence the plan.
3. Read `docs/agentic-spec/ui/coverage/traceability-ledger.md` for any Feature with a non-null `uiDesignRef`. Features with `coverage_contract_gap` or `evidence_gap` may not be scheduled for execution until those gaps are resolved.
4. Read computational Sensor results if available (lint output, test results, type check output). Prioritize computational Sensor evidence over inferential Sensor summaries; do not trust text summaries alone.

If Observe reveals unresolved blocked states, `stitchScreenIds` gaps, or failed computational Sensors, update the Feature's `spec-state.json` `blockedReasons` before returning a plan.

### ② Plan Phase (task DAG + executor assignment)

Produce a plan that includes:

- **Feature selection**: one or more runnable Features from the pool, in dependency order.
- **Task slice assignment**: map each `TASK-*` to an executor role (`codex-cli`, `mcp`, `sandbox`, `manual`) with rationale. Record assignments in `result.executionPlan[].taskAssignments[]`.
- **Harness type declaration**: classify each Feature's primary work as `Maintainability` (code quality, refactoring), `Architecture` (module boundaries, contracts, adapters), or `Behaviour` (user-facing features, UI, interactions). This classification drives the Sensor sequence in ④.
- **Sensor sequence**: for each Feature, list the computational Sensors that must pass before inferential Sensors (AI review) may run: `lint → type-check → unit-tests → integration-tests → acceptance-tests → ai-review`.
- **HITL gate declaration**: identify tasks requiring `manual-gated` approval before execution (Git merge, destructive migrations, production deployments, coverage contract generation).

### ③ Act Phase (dispatch record)

After dispatching execution:

- Record a `dispatch` entry in `result.executionTrace[]` with fields: `taskId`, `executorRole`, `dispatchedAt`, `sourceFiles`, and `expectedSensors`.
- Update the Feature `spec-state.json` to `in-progress` with `nextAction` pointing to the assigned executor.
- If a UI/App Feature has `uiDesignRef.designStatus = "ready-for-design"`, dispatch `stitch-design-coverage` first before dispatching `implement-feature`.

### ④ Harness Feedback Loop (when returning from execution)

When this skill re-runs after an execution attempt:

1. Read the `executionTrace[]` from the checkpoint to determine what actually ran.
2. Compare expected Sensors (from the plan) against actual Sensor results.
3. For any expected computational Sensor that did not run, mark the Feature `blocked` with reason `sensor_skipped` and do not allow `completed` status until the Sensor runs.
4. For any Sensor that failed, route to `recover-execution` with the failure classification before attempting to re-plan.
5. Do not re-plan a Feature that has failed the same Sensor three consecutive times without an explicit `manual-gated` approval to override.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions as `clarification_needed`, `review_needed`, `risk_review_needed`, or `blocked` instead of inventing facts.
