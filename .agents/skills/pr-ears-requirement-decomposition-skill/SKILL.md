---
name: pr-ears-requirement-decomposition-skill
description: "Decompose PRD or PR/RP product input into atomic EARS requirements. Use when product prose must become testable REQ, NFR, EDGE entries with traceability and acceptance checks."
---

# PR EARS Requirement Decomposition Skill

This is the design-slug entry point for PRD-to-EARS conversion. Prefer the existing `parse-prd-to-ears` workflow for the detailed output structure.

## Workflow

1. Locate the source PRD, product request, PR/RP, or feature brief.
2. Extract goals, non-goals, actors, user stories, constraints, risks, and open questions.
3. Convert observable behavior into EARS statements using `WHEN`, `WHILE`, `IF`, `WHERE`, or error-case forms.
4. Assign stable IDs and priorities without renumbering existing requirements.
5. Add acceptance checks and traceability back to the source sections.

## Output

- Atomic EARS requirements.
- Non-functional requirements and edge cases.
- Traceability matrix.
- Open questions for unresolved product intent.

## Failure Routing

- Use `clarification_needed` for ambiguous goals, conflicting sources, or untestable acceptance.
