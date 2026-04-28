---
name: feature-spec-design
description: Generate or update a Feature Spec-level design.md from feature requirements, a feature PRD slice, or EARS requirements. Use when Codex is asked to write the design inside a feature spec folder, produce detailed feature implementation design, map feature requirements to components/data/interfaces/flows/tasks, or refine a feature design after requirements change. Do not use for project-level HLD; use the project HLD skill instead.
---

# Create Feature Spec Design

## Workflow

1. Read the feature requirements and, if available, the feature PRD slice, project HLD, and existing feature spec folder. Prefer explicit user paths; otherwise look for nearby `requirements.md`, `design.md`, `tasks.md`, or `docs/features/<feature>/`.
2. Preserve the requested or source language.
3. Confirm the boundary is one Feature Spec or one vertical feature slice. If the request is project-wide architecture or HLD, switch to the project HLD skill.
4. Map every feature requirement ID to design sections before writing detailed design.
5. Inspect existing repo structure when implementation context is available. Reuse the project HLD, architecture, naming, storage, API, test, and delivery conventions.
6. Make feature-level implementation decisions only inside the current feature boundary. Reference project-level decisions instead of redefining them.
7. Record open questions, risks, dependencies, and rejected alternatives when the source material is insufficient.
8. Write the output to the requested target. If unspecified, create or update `design.md` inside the feature spec folder.

## Design Structure

Use this structure unless the project already has a stronger local template:

```markdown
# Design: [Feature Name]

## 1. Overview

## 2. Feature Boundary

## 3. Requirement Mapping
| Requirement ID | Design Section | Coverage Notes |
|---|---|---|

## 4. Architecture Context

## 5. Components
### 5.1 [Component Name]
Responsibilities:

Inputs:

Outputs:

Dependencies:

## 6. Data Model

## 7. API / Interface Design

## 8. Sequence Flows

## 9. State Management

## 10. Error Handling and Recovery

## 11. Security and Privacy

## 12. Observability and Auditability

## 13. Testing Strategy

## 14. Rollout and Migration

## 15. Risks, Tradeoffs, and Open Questions
```

## Design Rules

- Cover every `REQ-*` and relevant `NFR-*`; mark partial or deferred coverage explicitly.
- Keep the design scoped to the current Feature Spec. Do not create or rewrite project-level HLD here.
- Treat project HLD, PRD, and shared architecture documents as upstream constraints.
- Keep diagrams textual with Mermaid when helpful.
- Prefer vertical workflow clarity over abstract component lists.
- Include data ownership, lifecycle, validation, idempotency, and failure behavior when the feature mutates state.
- Include permission, audit, and privacy behavior for user data, automation, background tasks, or AI agent actions.
- Include test strategy at unit, integration, system, and acceptance levels only where relevant.
- Do not over-design infrastructure, platform boundaries, or cross-feature architecture that is outside the current feature boundary.
