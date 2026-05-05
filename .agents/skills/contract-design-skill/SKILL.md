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

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- `summary` must state the contract type, compatibility impact, and whether downstream task slicing can proceed.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `contracts`: array of contract definitions with `type`, `name`, `consumer`, `producer`, and payload/status summary.
- `validationRules`: array of field, status, error, or compatibility rules.
- `examples`: array of compact request/response, file, event, or CLI examples when useful.
- `requiredTests`: array of contract tests to add or run.
- `breakingChanges`: array of backward-incompatible changes, empty when none.

## Failure Routing

- Use `risk_review_needed` for public, cross-feature, or backward-incompatible contract changes.
- Use `clarification_needed` for ambiguous consumer behavior.
