---
name: requirement-intake-skill
description: "Intake new product requirements for SpecDrive. Use when a natural-language request, user story, capability, constraint, review finding, or implementation-discovered requirement must become governed PRD, EARS, design, and Feature Spec updates."
---

# Requirement Intake Skill

This is the design-slug entry point for adding requirements. Prefer the existing `add-requirement` workflow for detailed document propagation.

## Workflow

1. Classify the source: user request, PRD change, review finding, test result, delivery report, or implementation evidence.
2. Determine whether the intake is a new requirement, a change to an existing requirement, or a clarification.
3. Create or update stable IDs: `REQ-*`, `NFR-*`, `EDGE-*`, or change IDs when needed.
4. Propagate scope through PRD, `requirements.md`, HLD/design, and affected Feature Specs.
5. Preserve traceability from source to requirement to feature acceptance.

## Output

- Intake classification.
- Requirement IDs and affected documents.
- Acceptance criteria or open questions.
- Downstream sync notes.

## Failure Routing

- Use `clarification_needed` when intent or acceptance cannot be made testable.
- Use `risk_review_needed` when the intake changes architecture, security, data ownership, or active feature scope.
