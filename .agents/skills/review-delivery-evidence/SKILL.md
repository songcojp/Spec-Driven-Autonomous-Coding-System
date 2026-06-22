---
name: review-delivery-evidence
description: "Review delivery evidence and release readiness. Use for journey closure, test coverage semantics, evidence completeness, approval gates, human review routing, and release-readiness decisions."
---

# Delivery Evidence Review

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

Decide whether behavior, evidence, quality gates, approvals, and release readiness are sufficient. Review Product Usability Gate results, decision logs, protocol gaps, and usability evidence before accepting P0/P1 story closure. Do not let implementation evidence alone close delivery.

When reviewing Spec Artifact Granularity for requirements work:

- Treat `docs/agentic-spec/requirements/user-stories-standard.md` or the invocation-supplied requirements standard as the requirements content-generation contract.
- Fail with `review_needed` and `story_gap` when Must-scope `US-*` entries are broad feature-area statements instead of concrete stories with actor, context, goal, value, trigger, main scenario, alternate/negative scenarios, done signal, source refs, and priority.
- Fail with `review_needed` and `atomicity_gap` when a `REQ-*`, `NFR-*`, or `EDGE-*` row combines multiple actors, triggers, outcomes, happy/error paths, independent UI/API/persistence behavior, or unrelated NFR thresholds.
- Fail with `review_needed` and `behavior_gap` when a row looks syntactically structured but still hides behavior behind broad verbs such as "support", "provide", "handle", "manage", "optimize", "improve", "integrate", "allow", or "ensure" without an observable system response.
- Fail with `review_needed` and `traceability_gap` when rows lack source refs, `US-*` mapping or explicit system-invariant reason, acceptance mapping, evidence mapping, or downstream traceability.
- Fail with `review_needed` and `clarification_gap` when a Must-scope row needs actor, trigger, state, threshold, permission, data, UI, runtime, or evidence decisions that are not present in source artifacts.
- Require edge, boundary, permission, empty, conflict, invalid input, and negative paths as `EDGE-*` rows or explicit out-of-scope rationale.

When reviewing Spec Artifact Granularity for UI work:

- Treat `docs/agentic-spec/ui/ui-spec.md` or the invocation-supplied UI System Design path as the UI source of truth. Concept images, screenshots, page names, routes, visible headings, API tests, or single-surface-only references do not satisfy UI Spec readiness by themselves.
- Fail with `review_needed` and `interaction_gap` when a UI Spec lacks per-workflow interaction matrices covering entry point, actors, controls/fields, user action, validation, save/cancel behavior, state feedback, error path, requirement IDs, and browser/evidence expectations.
- Fail with `review_needed` and `state_data_gap` when a UI Spec lacks fact sources, data-binding rules, command/write targets, persistence behavior, reload/revisit assertions, or status-source mapping for primary surfaces.
- Fail with `review_needed` and `evidence_gap` when a UI/App Feature relies on fixture-only, route-only, entry/text-only, screenshot-only, happy-path-only, or API-only evidence instead of browser-visible action plus state change and persistence/revisit proof.
- Fail with `review_needed` and `interaction_gap` when a UI Feature assumes a product-specific host, compatibility surface, or legacy UI source without an explicit PRD/HLD/UI Spec requirement.
- Require the review output to name the missing UI workflow IDs or surfaces, the exact missing matrix columns, the impacted REQ/FEAT IDs when known, and the minimum refinement needed before HLD/UI Spec/Feature Spec can advance.
- Accept read-only UI only when the PRD, requirements, HLD, or UI Spec explicitly marks the surface or field as read-only and still defines the user-visible disabled/permission state and evidence path.

When reviewing UI Coverage Contract and design fidelity for UI/App Features:

- Read `spec-state.json` for the Feature. If `uiDesignRef` is null and the Feature type is UI/App/IDE-Webview, fail with `review_needed` and `coverage_contract_gap`.
- Check `uiDesignRef.dhiRefs` against `docs/agentic-spec/ui/coverage/design-consumption.md`: every referenced `DHI-###` row must exist and have a status of `designed` or `wysiwyg-complete`. Rows still at `ready-for-design` → fail with `evidence_gap` and name the missing design target.
- Check `uiDesignRef.tmRefs` against `docs/agentic-spec/ui/coverage/acceptance-automation.md`: every referenced `TM-###` row must have a concrete assertion oracle (non-empty `Assertion Oracle` and `Locator/Selector` columns). Rows with empty oracle fields → fail with `test_semantics_gap`.
- Check `uiDesignRef.stitchScreenIds`: if the array is empty and `designStatus` is not `ready-for-design`, fail with `evidence_gap` and reason `stitch_screens_not_generated`. Route to `stitch-design-coverage`.
- Check `docs/agentic-spec/ui/coverage/traceability-ledger.md` for the Feature's workflow chain. If the chain status is not `wysiwyg-complete` or `verified`, record it as `partial` rather than failing, and name the chain IDs needing advancement.
- Do not accept `designed` or `wysiwyg-complete` claims based only on text descriptions, screenshots of concept images, or static HTML prototypes. A Stitch screen ID in `stitchScreenIds` is the minimum design artifact for UI coverage.
- Record all UI coverage findings under `result.protocolGaps[]` with `type` set to `coverage_contract_gap`, `evidence_gap`, or `test_semantics_gap` as applicable.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions as `clarification_needed`, `review_needed`, `risk_review_needed`, or `blocked` instead of inventing facts.
