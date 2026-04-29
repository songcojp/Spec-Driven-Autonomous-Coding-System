---
name: ambiguity-clarification-skill
description: "Identify and route requirement, acceptance, technical-boundary, or user-intent ambiguity. Use when planning or implementation cannot proceed safely without clarification."
---

# Ambiguity Clarification Skill

Use this skill to make uncertainty explicit instead of guessing through it.

## Workflow

1. Read the active PRD, requirements, feature spec, design, tasks, and latest evidence.
2. Identify ambiguity type: product intent, acceptance criteria, data boundary, API contract, UI behavior, security, migration, or delivery ownership.
3. Separate blocking questions from non-blocking assumptions.
4. Propose the smallest clarifying question set that can unblock the next stage.
5. Record temporary assumptions only when the workflow allows AI-chosen decisions; otherwise stop and wait for the user.

## Output

- Ambiguity summary.
- Blocking questions.
- Non-blocking assumptions.
- Recommended `review_needed_reason`.

## Failure Routing

- Use `clarification_needed` for blocking ambiguity.
- Use `risk_review_needed` when multiple valid choices have materially different architecture or delivery impact.
