---
name: create-system-desing
description: Generate a system design document from a PRD and optional EARS requirements. Use when Codex is asked to draft or update design.md, architecture, components, data models, interfaces, flows, error handling, security, testing strategy, risks, or requirement-to-design traceability from product requirements.
---

# Create System Desing

## Workflow

1. Read the PRD and, if available, the EARS requirements document. Prefer explicit user paths; otherwise look for nearby `PRD.md`, `requirements.md`, or feature spec folders.
2. Preserve the requested or source language.
3. Identify the design boundary: product-wide system, feature, subsystem, workflow, API, UI, data pipeline, agent flow, or integration.
4. Map each requirement ID to design sections before writing detailed design.
5. Inspect existing repo structure when implementation context is available. Reuse existing architecture, naming, storage, API, and test conventions.
6. Separate product behavior from implementation decisions. Make decisions only where the design needs them.
7. Record open questions, risks, and rejected alternatives when the source material is insufficient.
8. Write the output to the requested target. If unspecified, create or update `design.md` near the PRD or inside the feature spec folder.

## Design Structure

Use this structure unless the project already has a stronger local template:

```markdown
# Design: [Feature or System Name]

## 1. Overview

## 2. Requirement Mapping
| Requirement ID | Design Section | Coverage Notes |
|---|---|---|

## 3. Architecture

## 4. Components
### 4.1 [Component Name]
Responsibilities:

Inputs:

Outputs:

Dependencies:

## 5. Data Model

## 6. API / Interface Design

## 7. Sequence Flows

## 8. State Management

## 9. Error Handling and Recovery

## 10. Security and Privacy

## 11. Observability and Auditability

## 12. Testing Strategy

## 13. Rollout and Migration

## 14. Risks, Tradeoffs, and Open Questions
```

## Design Rules

- Cover every `REQ-*` and relevant `NFR-*`; mark partial or deferred coverage explicitly.
- Keep diagrams textual with Mermaid when helpful.
- Prefer vertical workflow clarity over abstract component lists.
- Include data ownership, lifecycle, validation, idempotency, and failure behavior when the feature mutates state.
- Include permission, audit, and privacy behavior for user data, automation, background tasks, or AI agent actions.
- Include test strategy at unit, integration, system, and acceptance levels only where relevant.
- Do not over-design infrastructure that is outside the current feature boundary.
