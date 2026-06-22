---
name: validate-requirements
description: "Validate requirements for quality and readiness. Use before planning or execution to check atomicity, observability, testability, stable IDs, conflicts, acceptance coverage, and traceability."
---

# Requirement Validation

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

Review requirements against source intent and downstream planning needs. Classify gaps as repairable, clarification-needed, risk-review-needed, or blocking.

When validating user stories:

- Use `docs/agentic-spec/requirements/user-stories-standard.md` or the invocation-supplied requirements standard as the content validation contract.
- Enforce Pattern-First quality rules from `docs/agentic-spec/zh-CN/skill-refact.md`: external mature skills are reference patterns only, and validation must not claim runtime delegation to system skills.
- Check that default assumptions, Open Questions, and Blocking Open Questions are present when the source contains ambiguity. Medium-risk Open Questions may continue only with a stated safe default and review visibility. Must-scope Blocking Open Questions require `blocked` or `review_needed` status, with clarification-needed or risk-review-needed recorded as the reason, next action, or result detail, and must not advance to HLD, UI Spec, Feature Spec, ready, planning, or execution.
- Enforce Product Usability readiness for P0/P1 stories: missing journey, checkpoint, runtime evidence path, or downstream handoff evidence is a `ProtocolGap` and must block readiness until repaired or explicitly reviewed.
- Check story depth first. Each Must `US-*` needs actor, context, goal, reason/value, trigger, main scenario, alternate/negative scenarios, done signal, source refs, and priority before downstream design can proceed.
- Classify shallow, feature-area, or slogan-like user stories as `story_gap`; examples include "manage settings", "configure provider", "publish app", or "improve UI" without concrete context, scenario, and done signal.
- Check every `REQ-*`, `NFR-*`, and `EDGE-*` row for stable ID, source refs, `US-*` mapping or explicit system-invariant reason, atomic statement, acceptance, evidence, priority, status, and downstream refs when known.
- Classify non-atomic rows as `atomicity_gap`; unobservable or ambiguous behavior as `behavior_gap`; missing acceptance/evidence as `evidence_gap`; missing source/story/downstream links as `traceability_gap`; missing decisions as `clarification_gap`; conflicting source facts as `conflict_gap`.
- Reject syntactically structured rows that still hide broad behavior behind verbs such as "support", "provide", "handle", "manage", "optimize", "improve", "integrate", "allow", or "ensure" without an observable system response.
- Ensure edge, boundary, permission, empty, conflict, invalid input, and negative-path behavior is represented as `EDGE-*` rows or explicitly out of scope with source rationale.
- Ensure UI-facing requirements name browser/runtime evidence needs when user action, state change, persistence, reload/revisit, or negative path is part of the behavior.
- Requirements with any open Must-scope `story_gap`, `atomicity_gap`, `behavior_gap`, `evidence_gap`, `traceability_gap`, `clarification_gap`, or `conflict_gap` must remain `review_needed` and must not advance to HLD, UI Spec, Feature Spec, task planning, ready, or execution.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions with `blocked` or `review_needed` status; record clarification-needed or risk-review-needed as the reason, nextAction, or result detail instead of inventing facts.
