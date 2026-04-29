---
name: research-decision-skill
description: "Research and record bounded technical decisions for Feature Spec planning. Use when a feature needs options analysis, dependency choice, implementation approach selection, or explicit rejected alternatives."
---

# Research Decision Skill

Use this skill after technical context collection and before architecture planning.

## Workflow

1. Start from project HLD decisions and existing repository conventions.
2. Identify the decision that must be made for the current feature only.
3. Compare viable options against requirements, risk, effort, compatibility, security, testability, and delivery constraints.
4. Choose the conservative option that best matches the project unless evidence supports a different path.
5. Record rationale, rejected alternatives, and residual risks.

## Output

- Decision statement.
- Chosen option and rationale.
- Rejected alternatives.
- Impacted requirements, files, and tests.

## Failure Routing

- Use `risk_review_needed` when a decision changes shared architecture, major dependencies, or public contracts.
- Use `clarification_needed` when product intent determines the decision.
