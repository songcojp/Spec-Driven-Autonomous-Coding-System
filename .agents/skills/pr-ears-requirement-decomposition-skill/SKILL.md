---
name: pr-ears-requirement-decomposition-skill
description: "Decompose PRD, PR/RP, product brief, or natural-language product input into atomic EARS requirements. Use when product prose must become testable REQ, NFR, EDGE entries, acceptance criteria, open questions, and traceability."
---

# PR EARS Requirement Decomposition Skill

This is the design-named PRD-to-EARS conversion entry point.

## Workflow

1. Locate the source PRD, product request, PR/RP, or feature brief. If no path is given, prefer existing files such as `docs/PRD.md`, `docs/en/PRD.md`, or language-specific PRD files.
2. Preserve the source language unless the user asks for another language.
3. Extract product goals, non-goals, actors, user stories, functional requirements, non-functional requirements, risks, constraints, and unresolved questions.
4. **Extract and prioritize user stories** before converting to EARS statements:
   - Identify each distinct user journey or independently deliverable capability from the PRD.
   - Assign a priority level: `P1` (MVP—must ship), `P2` (important—should ship), `P3` (nice to have).
   - Verify each user story is independently testable and delivers standalone value.
   - Record stories as `US-001`, `US-002`, ... with title, actor, goal, and priority.
5. Convert observable behavior into EARS statements using stable IDs:
   - `REQ-001`, `REQ-002`, ... for functional requirements.
   - `NFR-001`, `NFR-002`, ... for non-functional requirements.
   - `EDGE-001`, `EDGE-002`, ... for boundary, error, recovery, or exceptional paths.
   - Map each `REQ-*` back to the `US-*` it belongs to.
6. Keep each requirement atomic, observable, testable, and free of implementation choices unless the source states a hard constraint.
7. Add traceability back to PRD sections or source bullets when possible.
8. Surface gaps as open questions instead of inventing product intent.
9. Write the output to the requested file. If the user does not specify a target, create or update `requirements.md` near the PRD or inside the relevant feature spec folder.

## EARS Patterns

Use the simplest pattern that fits the behavior:

```markdown
WHEN [event or trigger]
THE SYSTEM SHALL [observable expected behavior]

WHILE [state or mode]
THE SYSTEM SHALL [observable expected behavior]

IF [optional feature or configuration is enabled]
THEN THE SYSTEM SHALL [observable expected behavior]

WHERE [context or actor scope applies]
THE SYSTEM SHALL [observable expected behavior]

WHEN [unwanted condition or error occurs]
THE SYSTEM SHALL [safe handling, error message, rollback, retry, or blocked action]
```

## Output

- User story index (`US-*`) with priority (P1/P2/P3) and independent-testability confirmation.
- Atomic EARS requirements mapped to their parent `US-*`.
- Non-functional requirements and edge cases.
- Traceability matrix (requirement → PRD section → user story).
- Open questions for unresolved product intent.

## Quality Bar

- Every requirement has exactly one primary behavior.
- Every requirement can become a test case without interpretation.
- Error, empty, permission, duplicate, timeout, and recovery paths are covered when relevant.
- Design, data model, framework, database, and algorithm choices stay out of requirements unless explicitly required by the source.
- Ambiguity is captured in `Open Questions` with the smallest useful question.

## Failure Routing

- Use `clarification_needed` for ambiguous goals, conflicting sources, or untestable acceptance.
