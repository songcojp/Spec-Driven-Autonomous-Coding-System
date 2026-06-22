---
name: refine-product-intent
description: "Create or refine product intent artifacts. Use for PRD generation, PRD refinement, goal and non-goal extraction, user journey mapping, acceptance definition, and PRD completeness review."
---

# Product Intent Refinement

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

Preserve product language and source intent. Extract actors, goals, non-goals, journeys, acceptance signals, and open questions without inventing implementation detail.

Apply Pattern-First quality rules from `docs/agentic-spec/zh-CN/skill-refact.md`: use mature system-skill behavior as reference patterns only, not as runtime dependencies. Compress low-risk clarification into explicit default assumptions, record medium-risk uncertainty as Open Questions, and record high-risk uncertainty as Blocking Open Questions with `blocked` or `review_needed` status.

When creating or refining product intent, ensure the artifact names goals, non-goals, actors, user journeys, acceptance boundaries, source refs, default assumptions, Open Questions, Blocking Open Questions, and whether the output is ready for `generate-user-stories`. Record product decisions and unresolved ambiguity in `DecisionLog`-ready language, and preserve enough source context for downstream `UsabilityEvidence`. Do not invent product positioning, business rules, security policy, data deletion behavior, or Feature scope to keep the flow moving.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions with `blocked` or `review_needed` status; record clarification-needed or risk-review-needed as the reason, nextAction, or result detail instead of inventing facts.
