---
name: contract-design-skill
description: "Design feature-level contracts. Use when planning requires API, CLI, event, file, UI view-model, skill input, verification package, or integration contracts."
---

# Contract Design Skill

Use this skill to define the interfaces a feature exposes or consumes.

## Workflow

1. Read feature requirements, design, HLD integration strategy, technical context, and existing interface patterns.
2. Identify contract type: HTTP API, CLI command, file format, event, view model, skill input, verification package, or internal function boundary.
3. Define required fields, validation, status codes or outcomes, error cases, compatibility promises, and examples.
4. Map contracts to consumers and tests.
5. Flag breaking changes before task slicing.

## Output

- Contract summary and payload shape.
- Validation and error behavior.
- Backward-compatibility notes.
- Required contract tests.

## Failure Routing

- Use `risk_review_needed` for public, cross-feature, or backward-incompatible contract changes.
- Use `clarification_needed` for ambiguous consumer behavior.
