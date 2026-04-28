---
name: create-project-hld
description: Generate or update a project-level High-Level Design (HLD) from a PRD, EARS requirements, product brief, or existing project architecture notes. Use when Codex is asked to draft HLD, determine the project technology stack, define high-level architecture, project-wide system design, subsystem boundaries, capability architecture, cross-feature flows, platform constraints, or requirement-to-HLD traceability. Do not produce Feature Spec LLD/design.md here; use $feature-spec-design for per-feature implementation design.
---

# Create Project HLD

## Overview

Produce project-level HLD that determines the project technology stack and explains the system architecture, major boundaries, data domains, integrations, quality attributes, and delivery constraints. Keep it high-level enough to guide Feature Spec splitting and feature design without becoming per-feature LLD.

## Workflow

1. Read the PRD, EARS requirements, product brief, and any existing architecture notes. Prefer explicit user paths; otherwise look for nearby `PRD.md`, `requirements.md`, `architecture.md`, or existing `HLD.md` / `design.md`.
2. Preserve the requested or source language.
3. Identify the project boundary, user-facing capabilities, major subsystems, external integrations, data domains, deployment context, and non-functional drivers.
4. Determine the project technology stack before finalizing architecture. Prefer explicit requirements and existing repo conventions; otherwise choose conservative, mainstream defaults and document rationale.
5. Map requirements to HLD sections at a coarse level. Mark partial, deferred, or feature-level coverage explicitly.
6. Inspect existing repo structure when available. Reuse established module names, technology choices, deployment topology, test conventions, and document locations.
7. Separate HLD decisions from Feature Spec LLD. Describe what subsystems exist and how they collaborate; leave detailed class/function/API payload design to feature `design.md` files.
8. Record open questions, risks, assumptions, and rejected alternatives when the source material is insufficient.
9. Write the output to the requested target. If unspecified, create or update `HLD.md` near the PRD or project-level requirements.

## HLD Structure

Use this structure unless the project already has a stronger local template:

```markdown
# HLD: [Project Name]

## 1. Overview

## 2. Goals and Non-Goals

## 3. Requirement Coverage
| Requirement ID | HLD Section | Coverage Notes |
|---|---|---|

## 4. System Context

## 5. Technology Stack
| Layer / Concern | Decision | Rationale | Constraints / Notes |
|---|---|---|---|
| Frontend | | | |
| Backend / Runtime | | | |
| Database / Storage | | | |
| Authentication / Authorization | | | |
| API / Integration | | | |
| Background Jobs / Agents | | | |
| Testing | | | |
| Deployment / Operations | | | |

## 6. Architecture Overview

## 7. Capability and Subsystem Boundaries
### 7.1 [Subsystem Name]
Responsibilities:

Owns:

Collaborates With:

## 8. Data Domains and Ownership

## 9. Integration and Interface Strategy

## 10. Cross-Feature Workflows

## 11. Security, Privacy, and Governance

## 12. Observability and Operability

## 13. Deployment and Runtime Topology

## 14. Testing and Quality Strategy

## 15. Feature Spec Decomposition Guidance

## 16. Risks, Tradeoffs, and Open Questions
```

## HLD Rules

- Keep HLD project-wide. Do not write per-feature LLD, task plans, function signatures, detailed endpoint schemas, database migrations, or implementation task lists.
- Cover every project-level `REQ-*` and relevant `NFR-*` at the architectural level. Point detailed coverage to future Feature Spec `design.md` when needed.
- Always include explicit technology stack decisions for core layers. If a choice cannot be made from available facts, mark it as `TBD` with the exact missing decision instead of leaving the section blank.
- Justify technology choices with project constraints such as team familiarity, runtime model, deployment target, data shape, integration needs, security, testing, and operability.
- When an existing repo already has a working stack, treat it as the default unless requirements clearly force a change. If changing it, document migration impact and rejected alternatives.
- Define subsystem responsibilities, ownership boundaries, and collaboration contracts without over-specifying internal implementation.
- Include architecture decisions that constrain many features: technology stack, runtime topology, identity, persistence, integration style, security posture, observability, and delivery governance.
- Prefer capability and workflow clarity over exhaustive component catalogs.
- Use Mermaid diagrams when they clarify system context, subsystem collaboration, deployment, or cross-feature flows.
- Capture assumptions and open questions instead of inventing product scope.
