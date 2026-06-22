---
name: design-ui-spec
description: "Design UI system specifications and high-fidelity prototypes. Use for UI system design from PRD/requirements/HLD, complete page and interaction-flow coverage, design tokens, page/state/interaction matrices, WYSIWYG static HTML prototypes, and UI-to-feature mapping validation."
---

# UI System Design

## Workflow

1. Confirm the requested outcome, source artifacts, workspace root, and allowed scope.
2. Read referenced files from disk and pass paths, IDs, and section anchors instead of pasted document bodies.
3. Apply this skill's workflow only to its declared responsibility; route adjacent lifecycle work to another project skill.
4. Derive the UI system from PRD intent, user stories, HLD architecture/data/state constraints, existing UI Spec, Feature Specs, and implementation reality when present.
5. Produce or review the requested artifacts with traceability to PRD, requirements, HLD, Feature Spec, execution records, tests, or evidence as applicable.
6. Return the runtime-supplied structured output shape exactly. Echo `executionId`, `skillName`, `requestedAction`, produced artifacts, next action, and Feature-level traceability when the adapter provides them.

## Guidance

Produce UI system design, not a decorative page list. Describe real user workflows, page states, interactions, accessibility, evidence needs, design tokens, component semantics, and prototype artifacts. Prefer source-backed UI behavior over visual invention.

When generating or updating the UI system:

- Treat `docs/agentic-spec/ui/ui-spec.md` as the compatibility path for the project-level UI System Design artifact unless the invocation supplies another path.
- Treat UI Spec as a required mainline design artifact, not a concept-image folder or a page list. If the path is missing, create it; if it exists but lacks concrete workflow matrices, repair it before downstream Feature split.
- Cover every page, app view, IDE panel, desktop/mobile view, terminal UI, modal, drawer, panel, table/detail pair, settings surface, approval/review surface, empty/loading/error/permission state, and important responsive breakpoint implied by PRD, requirements, HLD, page/surface inventory, and Feature Specs.
- Include an interaction matrix for each workflow: entry point, actors, controls/fields, user action, validation, save/cancel behavior, state feedback, persisted/reload/revisit assertion, error path, requirement IDs, and browser/evidence expectation.
- Include UI system foundations: information architecture, navigation model, layout grid/density, typography, color tokens, semantic status tokens, spacing, component rules, accessibility rules, motion rules, data-binding rules, and verification obligations.
- Include a state matrix for each primary surface: empty, loading, ready, dirty, saving, running, blocked, failed, completed, permission/read-only, and the fact source that drives each state.
- Include data-binding contracts for every editable or action-driving field: query/file/db/event read source, command/state-transition write target, schema constraints, failure feedback, and reload/revisit assertion.
- Include a UI ready gate that downstream Feature Specs must reference. A UI/App Feature is not ready if it only has a page name, route, screenshot, concept image, static layout, happy path, API test, or entry/text assertion.
- Do not assume a specific UI host such as web app, IDE panel, desktop app, mobile app, terminal UI, or console. Use the primary and compatibility surfaces declared by the project PRD/HLD/UI Spec.
- For operational SaaS, IDE, dashboard, review, settings, or scheduler surfaces, favor dense, readable, work-focused UI over marketing layout patterns.
- If external UI/UX design-intelligence skills are available, they may inform style, palette, typography, accessibility, and stack-specific heuristics. Keep the project PRD/requirements/HLD as the authority; do not let external style recommendations override product workflows, state facts, controlled-command boundaries, or declared UI-surface direction.
- If required product or architecture facts are missing, return `clarification_needed` or `review_needed` with the exact missing workflow/state/data decisions instead of inventing UI behavior.

## Product Delivery Contract

When this skill produces or updates UI System Design for a product that has at least one user-facing UI surface, it must also ensure a **product delivery contract** exists under `docs/agentic-spec/ui/coverage/` before returning `completed`. This contract is the downstream input for design tools (Stitch MCP) and acceptance automation.

Minimum required contract files:

- `docs/agentic-spec/ui/coverage/README.md` — scope, actors, surfaces, evidence status
- `docs/agentic-spec/ui/coverage/product-workflows.md` — `F-###` workflow capabilities with actor, precondition, main/alternate/failure flows, terminal results
- `docs/agentic-spec/ui/coverage/ui-interaction-tree.md` — `SURF/PAGE/REG/CMP/CTRL/STATE/NAV` node tree with requirement IDs and design target references
- `docs/agentic-spec/ui/coverage/design-consumption.md` — `DHI-###` rows, one per page/critical state/operation result, each containing: target tool (`stitch`), versioned title (`V1 DHI-### <Page Name>`), viewport, layout hierarchy, representative data, interaction states, design-system constraints, and a tool-ready prompt
- `docs/agentic-spec/ui/coverage/acceptance-automation.md` — `TM-###` rows, one per user operation or state transition, each containing: precondition, user action, expected UI result, expected system result, locator/selector, assertion oracle, and evidence path
- `docs/agentic-spec/ui/coverage/traceability-ledger.md` — cross-document closure matrix linking `F/PAGE/CTRL/STATE/DHI/TM` codes with downstream readiness status

Rules:

- The contract must use the coding system from `prepare-product-delivery-contract`: `F-###`, `PAGE-###`, `CMP-###`, `CTRL-###`, `STATE-###`, `DHI-###`, `TM-###` etc.
- Every workflow must have at least one `DHI-###` row (design target) and at least one `TM-###` row (acceptance test row).
- Workflows that lack `DHI-###` or `TM-###` rows must be marked `blocked` in the traceability ledger with an explicit reason.
- If the `prepare-product-delivery-contract` skill is available, route this step to that skill. If not, produce equivalent structured documents following the same contract.
- Non-UI products (CLI-only, backend-only, data-pipeline) may skip coverage contract generation; declare `non-ui: true` in the UI Spec metadata and explain why.
- If a coverage contract already exists, refresh only the sections affected by the current UI Spec update; do not reset or overwrite unrelated coverage rows.

When generating optional concept images:

- Do not generate concept images when high-fidelity static HTML is the requested/default prototype output and no concrete image artifact is expected.
- Only generate or repair concept images when the invocation explicitly lists concrete `docs/agentic-spec/ui/concepts/<page-id>.png` artifacts, supplies image inputs to transform, or requests legacy concept-image compatibility.
- When image artifacts are explicitly expected, derive the page/surface list from the PRD, requirements, HLD primary page/surface inventory, existing UI System Design, and Feature Specs when present.
- Produce one distinct raster image for every concrete expected `docs/agentic-spec/ui/concepts/<page-id>.png` artifact; do not collapse multiple pages into one overview image.
- Use stable page IDs that match the artifact paths supplied by the invocation.
- If an expected concept image already exists and does not need repair, keep it unchanged and list it as `unchanged`; do not regenerate or overwrite the same path just to refresh the run.
- If replacing an existing concept image is necessary, record the path and replacement reason in `result.details` or `result.items`.
- The image artifact `summary` should describe the page/surface represented, not the generation mechanism.

When generating high-fidelity static HTML:

- Produce a browsable prototype index at `docs/agentic-spec/ui/prototype/index.html` for project-level work, or `<feature-spec>/prototype/index.html` for feature-scoped work, unless the invocation supplies different expected artifacts.
- Produce one concrete page HTML artifact for every expected `docs/agentic-spec/ui/prototype/<page-id>.html` artifact; feature-scoped output uses `<feature-spec>/prototype/<page-id>.html`.
- Make the HTML WYSIWYG enough for design review: realistic layout, tokens, component states, representative data, visible validation/error/empty/loading states, responsive behavior, keyboard focus styling, and stateful interactions implemented with local static JavaScript where needed.
- Keep prototypes backend-free and static. They may simulate interactions locally but must not call Control Plane APIs, mutate real workspace state, or claim to be production UI.
- Preserve factual text such as paths, logs, evidence snippets, command names, requirement IDs, and status values exactly when they come from source artifacts.
- Run or document practical visual checks for the generated HTML when possible, including desktop and mobile viewport review, nonblank rendering, interaction reachability, and no incoherent overlap.
- Do not treat prototype generation as complete until every page listed in the UI Spec workflow inventory has either a concrete page artifact or an explicit `review_needed` gap explaining why it cannot be produced from current source artifacts.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.
- Read `/home/john/Projects/skills/skills/prepare-product-delivery-contract/SKILL.md` when generating the product delivery contract coverage package, to follow its coding system, document architecture, and completeness gate.
- Read `/home/john/Projects/skills/skills/stitch-design-coverage/SKILL.md` when generating or verifying Stitch MCP design screens from `DHI-###` rows in the coverage package.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions as `clarification_needed`, `review_needed`, `risk_review_needed`, or `blocked` instead of inventing facts.
