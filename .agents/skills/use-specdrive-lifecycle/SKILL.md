---
name: use-specdrive-lifecycle
description: "Route SpecDrive work across Define, Plan, Build, Verify, Review, and Ship. Use when a task spans product intent, requirements, architecture, implementation, verification, review, or release and needs lifecycle role assignment before execution."
---

# Lifecycle Routing

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

Classify the request by lifecycle span; preserve source intent, behavior obligations, evidence needs, and handoff risks. Route lifecycle-wide work through Product Usability Autonomy when scope crosses product usability, protocol convergence, IDE evidence, or P0/P1 completion decisions. Select the smallest set of project skills and reviewer roles needed to complete the work.

## Harness Classification and Routing

This skill acts as the **Harness Orchestrator**. Before routing to any specialist skill, classify the request into one or more Harness types and apply the corresponding routing rules.

### Harness Type Classification

| Harness Type | Classify when | Primary Skills |
|---|---|---|
| **Maintainability Harness** | Code quality, refactoring, naming, complexity, tech-debt, coverage gaps, doc health | `review-code-spec`, `validate-requirements`, `manage-spec-change` |
| **Architecture Fitness Harness** | Module boundaries, dependency direction, interface contracts, adapter model, HLD compliance, performance or security envelope | `design-architecture`, `review-code-spec`, `validate-requirements` |
| **Behaviour Harness** | User-facing features, UI surfaces, user journeys, acceptance criteria, regression, runtime evidence | `design-ui-spec`, `decompose-feature-specs`, `implement-feature`, `verify-behavior`, `review-delivery-evidence` |

When a request spans multiple Harness types, execute in order: Maintainability → Architecture → Behaviour. Do not start Behaviour Harness work if Architecture Fitness checks have unresolved violations.

### Guide vs Sensor Usage Rules

**Guides (Feed-forward):** AGENTS.md, SKILL.md files, Feature Spec design.md, UI Coverage Contract, templates. These are always active at the start of each skill invocation. Do not skip reading them to save tokens.

**Sensors — Computational (run first, deterministic):**
1. `git diff --check` or equivalent (no whitespace errors)
2. Lint (`npm run lint` or equivalent)
3. Type check (`tsc --noEmit` or equivalent)
4. Unit tests (targeted, not full suite unless blast radius requires it)
5. Integration tests (for shared behavior, state, or persistence changes)
6. Browser/acceptance tests (for UI/App Features with `TM-###` oracle)

**Sensors — Inferential (run after computational, probabilistic):**
- `review-code-spec` (AI code diff review)
- `review-delivery-evidence` (AI evidence completeness review)
- `package-evidence` (AI coverage matrix)

**Rule: No inferential Sensor may declare a Feature `completed` if any computational Sensor has not passed.** If computational Sensors cannot be run (environment constraint), record the reason in `sensorSkipReason` and route to `manual-gated` approval.

### HITL Gate Rules

The following transitions require explicit human approval (`manual-gated`) and must NOT be executed autonomously:

- Merging a Feature PR to the main branch
- Running destructive database migrations
- Triggering production deployments
- Overriding a three-time Sensor failure
- Marking a Feature `completed` when any `TM-###` oracle has an empty `stitchScreenIds`

When a HITL gate is reached, return `approval_needed` with the gate name, the specific condition, and the evidence supporting the approval request.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions as `clarification_needed`, `review_needed`, `risk_review_needed`, or `blocked` instead of inventing facts.
