---
name: ambiguity-clarification-skill
description: "Identify, surface, and resolve requirement, acceptance, technical-boundary, or user-intent ambiguity through structured dialogue before planning or implementation proceeds. Use when any planning or implementation stage cannot proceed safely without answers—not just identification."
---

# Ambiguity Clarification Skill

Use this skill to resolve uncertainty through structured dialogue instead of guessing through it. The goal is **resolved answers**, not just surfaced questions.

## When to Use

- A planning stage (requirements, architecture, data model, contracts, task slicing) would require an AI guess on a product-intent or acceptance question.
- Implementation cannot begin safely without a user decision on a multi-path choice.
- A review finding exposed an ambiguous requirement that must be resolved before re-implementation.

Do **not** use this skill merely to document uncertainty that was already known—use it when a blocker must be actively resolved by interacting with the user or by reasoning from available evidence.

## Workflow

1. Read the active PRD, requirements, feature spec, design, tasks, and latest evidence.
2. Identify ambiguity type:
   - **Product intent**: goal, scope, user value, priority, non-goal boundary.
   - **Acceptance criteria**: untestable condition, missing Given/When/Then scenario, immeasurable success metric.
   - **Data boundary**: schema ownership, field nullability, migration path, multi-tenancy rule.
   - **API contract**: endpoint behavior, error shape, authentication scope, versioning contract.
   - **UI behavior**: interaction model, empty/error state, responsive breakpoint, accessibility requirement.
   - **Security or compliance**: auth method, data retention, PII handling, audit requirement.
   - **Delivery ownership**: who approves, who merges, what constitutes done for a milestone.
3. Separate blocking questions (implementation cannot start or would be wrong) from non-blocking assumptions (can proceed with a stated assumption, revisable later).
4. For **blocking questions**: draft the smallest question set (one question per ambiguity, ordered by dependency) that unblocks the next stage. Ask the user directly.
5. For **non-blocking assumptions**: state each assumption explicitly, record it in the relevant spec artifact as a `[ASSUMPTION: ...]` note, and flag it for later review.
6. After receiving answers, update the spec artifact (PRD, requirements.md, feature design, or tasks.md) with the resolved decision, removing the `[ASSUMPTION]` or `[NEEDS CLARIFICATION]` marker.
7. If an answer reveals a scope change, hand off to `requirement-intake-skill` or `spec-evolution-skill` as appropriate.

## Decision: Blocking vs. Non-Blocking

| Condition | Classification |
|-----------|---------------|
| Ambiguity would produce wrong behavior if guessed | Blocking |
| Multiple valid choices have materially different architecture or data models | Blocking |
| The uncertainty is about wording or phrasing only | Non-blocking assumption |
| The uncertainty affects a future phase, not the current one | Non-blocking assumption |
| A reasonable default exists and the risk of being wrong is low | Non-blocking assumption |

## Output

- Ambiguity type and location (requirement ID, file, section).
- Blocking questions (ask the user) with context needed to answer each.
- Non-blocking assumptions with `[ASSUMPTION: ...]` markers and rationale.
- Post-resolution: updated spec artifact with the resolved decision recorded.
- Recommended `review_needed_reason` if the answer requires routing elsewhere.

## Failure Routing

- Use `clarification_needed` for blocking ambiguity that requires a user decision.
- Use `risk_review_needed` when multiple valid answers have materially different architecture, security, or delivery impact and the user needs to make a risk-aware choice.
- Use `spec-evolution-skill` if the resolved answer changes an existing requirement.
- Use `requirement-intake-skill` if the resolved answer adds a new requirement.
