---
name: parse-prd-to-ears
description: Convert a Product Requirements Document into clear, atomic, testable EARS-format requirements. Use when Codex is asked to parse a PRD, product brief, natural-language requirement, or scope document and produce or update requirements.md, EARS requirements, requirement IDs, acceptance criteria, edge cases, and requirement traceability.
---

# Parse PRD to EARS

## Workflow

1. Locate the source PRD or requirement artifact from the user request. If no path is given, prefer existing files such as `docs/PRD.md`, `docs/en/PRD.md`, or language-specific PRD files.
2. Preserve the source language unless the user asks for another language.
3. Extract product goals, non-goals, actors, user stories, functional requirements, non-functional requirements, risks, constraints, and unresolved questions.
4. Convert behavior into EARS requirements using stable IDs:
   - `REQ-001`, `REQ-002`, ... for functional requirements.
   - `NFR-001`, `NFR-002`, ... for non-functional requirements.
5. Keep each requirement atomic, observable, testable, and free of implementation choices unless the PRD states a hard constraint.
6. Add traceability back to PRD sections or source bullets when possible.
7. Surface gaps as open questions instead of inventing product intent.
8. Write the output to the requested file. If the user does not specify a target, create or update `requirements.md` near the PRD or inside the relevant feature spec folder.

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

## Output Shape

Use this structure unless the project already has a stronger local template:

```markdown
# Requirements: [Feature or Product Name]

## 1. Background

## 2. Goals

## 3. Non-Goals

## 4. Actors

## 5. User Stories

## 6. Functional Requirements

### REQ-001: [Title]
Source: [PRD section or bullet]
Priority: Must | Should | Could

WHEN [condition/event]
THE SYSTEM SHALL [observable behavior]

Acceptance:
- [ ] [testable check]

## 7. Non-Functional Requirements

## 8. Edge Cases and Error Handling

## 9. Traceability Matrix
| Source | Requirement IDs | Notes |
|---|---|---|

## 10. Open Questions
```

## Quality Bar

- Every requirement has exactly one primary behavior.
- Every requirement can become a test case without interpretation.
- Error, empty, permission, duplicate, timeout, and recovery paths are covered when relevant.
- Design, data model, framework, database, and algorithm choices stay out of requirements unless explicitly required by the PRD.
- Ambiguity is captured in `Open Questions` with the smallest useful question.
