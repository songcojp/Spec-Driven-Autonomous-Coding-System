---
name: generate-user-stories
description: "Use when PRDs, product briefs, PR/RP text, or natural-language requirements must become detailed user stories, testable requirement rows, acceptance criteria, traceability, and open questions."
---

# User Story Generation

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

Generate stable, detailed user stories and derived atomic requirements. Preserve source traceability, surface ambiguity, and keep Feature Spec splitting out of this skill.

When generating or updating requirements:

- Treat `docs/agentic-spec/requirements/user-stories-standard.md` as the generic user story content-generation contract unless the invocation supplies another project-approved standard path.
- Apply Pattern-First quality rules from `docs/agentic-spec/zh-CN/skill-refact.md`: mature system skills are reference patterns only, not runtime dependencies. Convert low-risk ambiguity into explicit default assumptions, write medium-risk ambiguity as Open Questions with safe defaults, and write high-risk ambiguity as Blocking Open Questions that prevent downstream validation or decomposition.
- Preserve or add an `自动决策与默认假设` / `Default Assumptions` section and Open Questions / Blocking Open Questions sections when the target artifact format allows them. Each question must include source refs, default assumption when safe, blocking status, and the required human decision.
- Preserve story, journey, checkpoint, and evidence handoff details so downstream Feature Specs can create `UsabilityEvidence` without reinterpreting the original source.
- Produce or repair requirements content, not a Feature Spec, design document, task plan, backlog, or implementation checklist.
- Generate detailed `US-*` stories before or alongside `REQ-*` rows. Each Must story needs actor, context, goal, reason/value, trigger, main scenario, alternate/negative scenarios, done signal, source refs, and priority.
- Use stable `US-*`, `REQ-*`, `NFR-*`, `EDGE-*`, and `CQ-*` IDs. Do not renumber existing published IDs to improve ordering.
- Split shallow stories such as "manage settings", "configure provider", "publish app", or "improve UI" into concrete user goals and scenarios before deriving requirements.
- Convert each detailed story into atomic requirement rows. Each row must have one trigger or invariant, one observable system response, source refs, story mapping or explicit system-invariant reason, acceptance, evidence, priority, and status.
- Derive separate rows for main behavior, state/persistence, permission, validation/error, edge/boundary, and measurable non-functional behavior when those obligations can fail independently.
- Split coarse verbs such as "support", "provide", "handle", "manage", "optimize", "improve", "integrate", "allow", or "ensure" into observable behavior rows before marking the output ready.
- Represent edge, boundary, permission, empty, conflict, invalid input, and negative-path behavior as `EDGE-*` rows unless the source explicitly marks them out of scope.
- Use `CQ-*` rows for missing decisions instead of inventing actors, thresholds, state facts, UI hosts, persistence behavior, security rules, or runtime topology.
- Keep HLD, UI Spec, Feature Spec decomposition, task slicing, and execution planning out of this skill. The correct next action after a requirements-ready output is validation or downstream design, not implementation.
- Return `review_needed` or `blocked` status when Must-scope stories are too shallow or rows cannot be made atomic, testable, or traceable from the available source artifacts; record clarification-needed as the reason, nextAction, or result detail.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions with `blocked` or `review_needed` status; record clarification-needed or risk-review-needed as the reason, nextAction, or result detail instead of inventing facts.
