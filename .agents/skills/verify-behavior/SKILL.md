---
name: verify-behavior
description: "Verify implemented behavior. Use for test planning, unit/integration/browser/acceptance test generation, targeted or regression test execution, failure analysis, and mapping tests to acceptance obligations."
---

# Behavior Verification

## Workflow

1. Confirm the requested outcome, source artifacts, workspace root, and allowed scope.
2. Read referenced files from disk and pass paths, IDs, and section anchors instead of pasted document bodies.
3. Apply this skill's workflow only to its declared responsibility; route adjacent lifecycle work to another project skill.
4. Produce or review the requested artifacts with traceability to PRD, requirements, HLD, Feature Spec, execution records, tests, or evidence as applicable.
5. Return the runtime-supplied structured output shape exactly. Echo `executionId`, `skillName`, `requestedAction`, produced artifacts, next action, and Feature-level traceability when the adapter provides them.

## Product Usability Autonomy Wrapper

Apply FEAT-024 Product Usability Autonomy when this skill affects P0/P1 user stories, lifecycle handoffs, execution readiness, verification, review, or completion decisions.

Required wrapper fields:

- Source refs: list the PRD, requirements, HLD, UI Spec, Feature Spec, tasks, code, tests, or ReviewItems consumed.
- Lifecycle stage: name Define, Plan, Build, Verify, Review, or Ship.
- Decision policy: record safe automatic decisions as `DecisionLog`; record medium-risk ambiguity as Open Questions; record high-risk ambiguity as Blocking Open Questions.
- Protocol gaps: classify missing source, story, journey, interaction, state/data, test, runtime, review, and ship evidence as `ProtocolGap`.
- Usability evidence: preserve or produce `UsabilityEvidence` for P0/P1 stories affected by the skill.
- Handoff readiness: state whether downstream work may continue and which `LifecycleHandoff` obligations are preserved.
- Anti-rationalization: do not mark work ready or completed only because text, fixtures, API seeds, self-review, or command success exists.

## Guidance

Choose tests that prove behavior obligations, not just command success. For P0/P1 stories, verify user journey, runtime behavior, state/data persistence or revisit expectations, and negative paths when they are part of the requirement. Record commands, evidence, gaps, and recovery recommendations as `UsabilityEvidence` or `ProtocolGap`.

## UI / App Feature Verification

For any Feature whose `spec-state.json` has a non-null `uiDesignRef`, apply the following rules before writing or running tests:

**Pre-flight checks:**

1. Read `spec-state.json` for the Feature. If `uiDesignRef.designStatus` is `ready-for-design` or `stitchScreenIds` is empty, do not run UI acceptance tests yet. Return `blocked` with reason `ui_design_not_ready` and route to `stitch-design-coverage` to generate Stitch screens first.
2. Read the `TM-###` rows referenced in `uiDesignRef.tmRefs` from `docs/agentic-spec/ui/coverage/acceptance-automation.md`. Use the oracle, locator, precondition, and expected result fields from those rows as the authoritative test specification.

**Three-part verification requirement:**

Every UI/App Feature test must satisfy all three conditions to count as verified:

1. **Browser-visible action** — the test must perform a real observable user interaction (click, input, submit, navigate, drag/drop) through the browser or IDE Webview; read-only page snapshots, `page.title()`, or `page.url()` assertions alone do not satisfy this condition.
2. **State change assertion** — the test must assert that a UI or system state visibly changed as a result of the action (element appears/disappears, status label changes, progress indicator resolves, data record mutates, command result appears); `page.textContent()` of a pre-existing string alone does not satisfy this condition.
3. **Persistence or revisit assertion** — the test must assert that the expected state survives a page reload, navigation away and back, session restore, or project switch where the requirement says it should; or the test must explicitly document why persistence is not required for this operation.

**Assertion quality rules:**

- Use stable locators (role, label, aria, data-testid) over positional or class selectors.
- Do not use a `TM-###` row as verified unless the test can fail for the right reason (negative oracle check).
- For async operations, include an explicit wait condition and a failure timeout assertion.
- For destructive actions, include confirmation dialog handling and rollback or undo assertion where applicable.
- Record shallow assertions (`text-only`, `url-only`, `fixture-only`) as `test_semantics_gap` in `UsabilityEvidence` and do not count them as evidence for UI Feature completion.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions as `clarification_needed`, `review_needed`, `risk_review_needed`, or `blocked` instead of inventing facts.
