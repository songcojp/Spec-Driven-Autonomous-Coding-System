---
name: create-project-hld
description: "Create or regenerate the project-level HLD from PRD, EARS requirements, repository context, and existing HLD notes. Use when the Spec Workspace generate_hld action is triggered."
---

# Create Project HLD Skill

Use this skill to create or regenerate the project-level High Level Design. This is not a feature design skill and must not write `docs/features/<feature-id>/design.md`.

## Inputs

Read the available project-level sources:

1. `docs/PRD.md`
2. `docs/requirements.md`
3. `docs/hld.md` when it already exists
4. `docs/features/README.md` when feature boundaries already exist
5. Repository facts needed to confirm technology stack and runtime boundaries

Use localized project-level sources such as `docs/en/*`, `docs/zh-CN/*`, or `docs/ja/*` only when the project explicitly declares multilingual documentation or the invocation provides localized source paths.

## Workflow

1. Identify the product scope, phase boundaries, and current requirement set.
2. Confirm the technology stack from repository facts. Repository facts and explicit PRD constraints take precedence. If the project has UI and no existing stack is determined from sources, default to the React-family stack that fits the primary application type; do not mark the frontend stack as `TBD` or defer it to implementation when this default can satisfy the product shape. If a non-UI or backend/runtime decision cannot be made from sources, mark it as `TBD` with the exact missing decision.
3. Preserve project-level architecture boundaries: subsystems, data domains, integration strategy, workflows, security, observability, deployment, testing strategy, and feature decomposition guidance.
4. Keep feature-specific implementation details out of the project HLD. Route feature API fields, component internals, and task-level details to feature specs instead.
5. Reconcile stale `design.md` content only when it is consistent with PRD, requirements, and the current HLD direction.
6. Write the output to `docs/hld.md` unless the invocation explicitly provides another HLD path or localized lane.
7. When creating a new HLD, initialize the document header with a document version such as `版本：V1.0`; do not invent or copy a `CHG-*` change identifier as the initial document identity. Use `CHG-*` only when the invocation explicitly includes a real spec-evolution change ID for an existing change.

## Required HLD Structure

**CRITICAL**: You MUST generate a complete project-level HLD using exactly the 17 sections listed below with their exact headings. DO NOT skip, merge, or omit any section. If a section is genuinely not applicable, you must keep the heading and explicitly explain why.

1. Header
   - Title, document version, status, source documents, and optional note about deprecated or superseded design documents.
   - New documents use `版本：V1.0`; regenerated documents preserve or intentionally bump the existing version.
2. Overview
   - Product purpose, operating model, phase boundaries, and the role of this HLD.
3. Goals and Non-Goals
   - Clear product/technical goals and explicit out-of-scope items.
4. Requirement Coverage
   - A traceability table mapping requirement IDs to HLD sections and coverage notes.
5. System Context
   - Users, external systems, runtime boundaries, trust boundaries, and major dependencies.
6. Technology Stack
   - First, determine the primary application type (e.g., Mobile, Web, CLI, Backend).
   - Let your judgment determine the most appropriate architecture pattern and technology stack tailored to that specific type, while using React-family frontend stacks as the default when no stronger repository or product facts override them.
   - Use this default React-family mapping:
     - Web application, admin console, or Product Console: `React + Next.js` or `Vite React`; prefer `Vite React` for state-dense local workbenches and prefer `Next.js` when SSR, file-based routing, content publishing, or SEO is a core requirement.
     - Mobile application: `React Native + Expo`.
     - Desktop application: `Tauri + React` or `Electron + React`; prefer Electron only when strong local system integration, Node runtime access, or existing Electron assets justify the heavier runtime.
     - Documentation or content site: `Next.js` or `Astro + React`.
     - Component library, embedded frontend, prototype, or lightweight tool surface: `Vite React`.
   - If the repository already has a different host framework, record that existing stack, explain why it overrides the React-family default, and describe the acceptance impact.
   - Define concrete stack decisions based on your architectural judgment.
   - Include the Project Initialization strategy (项目初始化设计), specifying scaffolding tools, base frameworks, directory structure, and environment setup commands.
   - Do not write "implementation layer decides" when repository facts or PRD constraints are enough to choose. If information is missing, write `TBD` with the missing decision.
7. Architecture Overview
   - Describe the major layers/components based on the chosen application type and how they interact.
   - Include a concise diagram when useful.
   - If the product has UI (app, web, console screens), include a primary page/surface inventory as upstream input for `ui-spec-skill`.
8. Capability and Subsystem Boundaries
   - Each major subsystem's responsibilities, owned facts, inputs/outputs, and non-responsibilities.
9. Data Domains and Ownership
   - Project-level entities, aggregate ownership, persisted artifacts, source of truth, and derived views.
10. Integration and Interface Strategy
   - API, CLI, events, files/artifacts, background jobs, external services, and adapter boundaries at a conceptual level.
11. Cross-Feature Workflows
   - End-to-end flows that cross subsystem boundaries, including state transitions and failure paths.
12. Security, Privacy, and Governance
   - Trust model, permissions, safe defaults, sensitive data handling, auditability, and policy enforcement.
13. Observability and Operability
   - Logs, metrics, status summaries, status checks, health checks, recovery, and operational diagnostics.
14. Deployment and Runtime Topology
   - Local/dev/runtime process layout, storage locations, queue/process ownership, environment dependencies, and release boundaries.
15. Testing and Quality Strategy
   - Unit, integration, browser/E2E, contract, migration, safety, and acceptance verification strategy.
16. Feature Spec Decomposition Guidance
   - Suggested feature groups, dependency tree, delivery order, and which requirements each feature owns.
17. Risks, Tradeoffs, and Open Questions
   - Architecture risks, accepted tradeoffs, unresolved decisions, and follow-up validation.

## Reusable Detail Patterns

Use these patterns when the source documents support them. They are reusable HLD content patterns, not domain-specific product requirements.

- Goals and non-goals should summarize the core user capabilities with requirement IDs, then explicitly state prohibited or deferred product behaviors.
- System Context should name client/runtime surfaces, external dependencies, device/platform capabilities, third-party services, filesystem/network boundaries, and data/privacy boundaries.
- Architecture Overview may use layered architecture when it fits the product, but each layer must be concrete:
  - Presentation/UI surfaces and major pages or entry points.
  - Application/use-case orchestration responsibilities.
  - Domain models and business rules.
  - Infrastructure adapters, persistence, scheduling, encryption/networking, logging, and external integrations.
- Capability and Subsystem Boundaries should describe each major module with:
  - Responsibilities or supported functions.
  - Key constraints, thresholds, validation rules, lifecycle states, retry behavior, or user-confirmation points.
  - Owned persisted records or emitted events when applicable.
- Data Domains and Ownership should include a concept-level entity list. For each important entity, list representative fields, rule/config versions, timestamps, status fields, references to artifacts, and ownership/source-of-truth notes.
- Integration and Interface Strategy should include the minimum interface/event inventory needed to explain product behavior. Use conceptual commands/events/API intentions unless the repository already defines concrete routes or contracts.
- Cross-Feature Workflows should include state lifecycles such as `draft -> confirmed -> queued -> completed` when the product has durable states, and should identify manual override or retry entry points.
- Security, Privacy, and Governance should capture local-first/default-local handling, minimized upload or sharing, configurable external providers, sensitive artifact treatment, and audit requirements when applicable.
- Observability and Operability should identify the measurements that prove the architecture works, such as processing latency, provider choice, retry counts, failure reasons, external-source freshness, status changes, and notification outcomes.
- Deployment and Runtime Topology should include release strategy, adapter/provider replacement boundaries, offline/online expectations, and current-versus-later rollout boundaries.
- Testing and Quality Strategy should tie key risks to verification: validation rules, state transitions, provider failures, retry behavior, privacy boundaries, performance baselines, and manual confirmation flows.
- Feature Spec Decomposition Guidance should propose implementation priority based on dependency order. Prefer a general order of foundation/setup, intake/input, validation/normalization, persistence/state, orchestration/integration, UI/notification, then advanced management or analysis surfaces; adapt this order to the product and repository facts.
- Risks, Tradeoffs, and Open Questions should pair each risk with a mitigation, such as configurable templates/rules, provider fallback, exponential backoff, cached last-known-good data, local-first privacy, or clock/source reconciliation.

## Quality Bar

- The HLD must contain a technical structure section with concrete technology choices or explicit `TBD` decisions. A generic four-layer description by itself is incomplete.
- The HLD must be traceable to requirements. If requirement IDs exist, include them in coverage, subsystem, workflow, and feature-decomposition sections.
- The HLD must separate project-level architecture from feature-level design. Do not define task-level implementation steps, function signatures, or detailed UI component internals.
- The HLD must identify source-of-truth data and derived data. Do not leave persistence, state ownership, or artifact ownership implicit.
- The HLD must include concept-level entity and interface/event inventories when the product has durable records, external integrations, or workflow transitions.
- The HLD must include a primary page/surface inventory when downstream UI Spec generation needs page or workflow-screen inputs.
- The HLD must include module-specific constraints and risk mitigations, not only module names.
- The HLD must describe runtime/deployment and test strategy, even for a local-first application.
- The HLD must preserve existing valid architecture decisions during regeneration and explicitly call out superseded or stale content instead of silently dropping it.
- Avoid weak placeholders such as "具体技术栈由实现层决定" when source documents or repository facts can support a decision.

## Output

- `docs/hld.md` project-level HLD, including the primary page/surface inventory when applicable. Use `docs/<language>/hld.md` only for explicitly multilingual projects or localized invocations.
- Return a `SkillOutputContractV1` JSON object with `contractVersion`, `executionId`, `skillSlug`, `requestedAction`, `status`, `summary`, `producedArtifacts`, and `traceability` matching the invocation contract.
- The `summary` field must briefly state whether the HLD was created, regenerated, blocked, or routed for review, and must name the primary HLD artifact path.
- The `summary` or `producedArtifacts[].summary` should mention input files, technology-stack decisions, required-structure coverage, requirement coverage, and unresolved architecture questions when relevant.

## Example Skill Invocation Contract

```json
{
  "contractVersion": "skill-contract/v1",
  "executionId": "EXEC-001",
  "projectId": "my-project",
  "workspaceRoot": "/workspace/my-project",
  "operation": "generate_hld",
  "skillSlug": "create-project-hld",
  "sourcePaths": [
    "docs/PRD.md",
    "docs/requirements.md",
    "docs/hld.md",
    "docs/features/README.md"
  ],
  "expectedArtifacts": [
    { "path": "docs/hld.md", "kind": "markdown", "required": true }
  ],
  "traceability": {
    "requirementIds": ["REQ-001"],
    "changeIds": []
  },
  "constraints": {
    "allowedFiles": [],
    "risk": "medium"
  },
  "requestedAction": "generate_hld"
}
```

## Failure Routing

- Use `clarification_needed` when PRD/requirements are missing or conflict on core product boundaries.
- Use `clarification_needed` when the technology stack, runtime topology, or source-of-truth data ownership cannot be determined well enough to produce a complete HLD.
- Use `risk_review_needed` when regenerating the HLD would invalidate existing Feature Spec boundaries.
- Use `blocked` when the workspace path or required source files cannot be read.
