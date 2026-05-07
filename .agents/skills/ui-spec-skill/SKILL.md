---
name: ui-spec-skill
description: "Generate a production-ready UI Spec, design-system guidance, UX flows, and major-page concept images from PRD, EARS requirements, and HLD. Use when the Spec Workspace generate_ui_spec action is triggered after HLD exists."
---

# UI Spec Skill

Use this skill to produce a structured, implementation-oriented UI Spec and major-page concept images from the product PRD, EARS requirements, HLD, and feature index.

## Generation Contract

The concept images are outputs, not required inputs. The required output format is PNG. Generate PNG concept images through the Codex CLI-specific image generation feature and write the resulting raster files directly to workspace artifacts that can be audited through artifact summaries.

Image generation is a Codex CLI-specific capability, separate from the text/reasoning model used to run this skill. The active CLI model, such as `gpt-5.5`, may draft the UI Spec and the image prompts, but it must not be treated as the producer of PNG artifacts. Codex CLI supports direct image generation through the built-in `$imagegen` skill, which uses `gpt-image-2`; use that image-generation path for concept PNGs. Do not assume Gemini CLI, generic CLI adapters, or other non-Codex providers can generate images through this feature. Do not satisfy concept-image output by emitting SVG, HTML/CSS, Mermaid, ASCII wireframes, base64 text, or Markdown-only descriptions. In an interactive Codex session, explicitly invoke `$imagegen` for the raster PNGs, then move/copy the selected generated image into the expected workspace path. In a scheduler/non-interactive run, require the Codex CLI adapter for concept PNG generation; if the active adapter is not Codex CLI or does not expose `$imagegen`, return `blocked` with a clear `nextAction` instead of fabricating image artifacts.

This skill is a UI specification generator, not a frontend implementation skill. When the task is later to implement or restyle the actual UI, use the repo's implementation workflow and, in interactive Codex sessions where available, follow the `build-web-apps:frontend-app-builder` skill for visual concept fidelity, browser verification, and implementation QA. Do not make the scheduler depend on that external skill; absorb its design-quality standards into the UI Spec artifacts.

## Inputs

| Field | Source | Description |
|-------|--------|-------------|
| `sourcePaths` | PRD path, EARS requirements path, HLD path, feature index | Text-based product and architecture context |
| `featureId` | payload | Target feature for the generated UI Spec |
| `workspaceRoot` | project config | Workspace root used to read sources and write generated artifacts |

## Workflow

1. Resolve source paths from the invocation first. If omitted, read the project PRD, EARS requirements, HLD, and feature index from the active documentation lane. For this repository, prefer language-local sources such as `docs/zh-CN/PRD.md`, `docs/zh-CN/requirements.md`, and `docs/zh-CN/hld.md` when those are the active MVP sources; do not fall back to non-existent root `docs/PRD.md` paths without checking.
2. Audit inputs before designing:
   - Identify target users, jobs-to-be-done, primary workflows, required states, and acceptance criteria.
   - Extract HLD surface inventory, technology stack, component-system constraints, data domains, runtime boundaries, and integration constraints.
   - Record unsupported, ambiguous, or conflicting page requests as blockers or review items instead of inventing screens.
3. Derive the page and surface inventory from requirements, PRD flows, HLD page/surface inventory, and feature ownership. Include pages, modal/dialog surfaces, empty/error/loading states, command surfaces, and mobile-critical variants only when they are requirement-backed.
4. For each major page, define the UX contract:
   - User goal and route or entry point.
   - Key tasks and interaction flow: user action -> state transition -> visual feedback.
   - Information architecture, hierarchy, navigation, and cross-page continuity.
   - Required states: default, loading, empty, validation error, permission denied, failure/retry, success, and selected/detail states as applicable.
   - View model fields, source system, refresh behavior, and stale-data handling.
5. Define a design direction and design system before generating concept PNGs:
   - Product tone and density. Operational tools should be quiet, dense, scannable, and work-focused; avoid marketing-style heroes, oversized decorative sections, generic card grids, and visual filler.
   - Layout system: app shell, navigation, bands, panels, tables, lists, canvas, drawers, sidebars, dialogs, or cards only where the workflow needs them.
   - Design tokens: colors, surface hierarchy, typography scale, spacing, radii, borders, shadows, icon style, focus rings, and motion rules.
   - Component families and variants: buttons, icon buttons, tabs, segmented controls, filters, forms, tables, status indicators, timelines, command bars, empty states, and dialogs.
   - Content rules: visible labels, CTA wording, empty-state copy, error copy, and no unexplained internal IDs unless required for operators.
6. Produce the UI Spec document covering:
   - **Design brief**: audience, jobs, product tone, constraints, and visual direction
   - **Page inventory**: all pages/views/surfaces with purpose, route, owning feature, states, and REQ/HLD traceability
   - **UX flows**: key user action -> state transition -> visual feedback flows
   - **Information architecture**: navigation, hierarchy, page-to-page continuity, and content priority
   - **View models**: data shapes, field lists, ownership, loading/error behavior, and refresh assumptions
   - **Design system**: tokens, component catalog, component states, icon rules, typography, spacing, density, and responsive rules
   - **Accessibility**: keyboard navigation, ARIA names/roles, focus management, color contrast, reduced motion, and screen-reader state announcements
   - **Implementation guidance**: framework/component constraints from HLD, forbidden shortcuts, reusable component boundaries, and browser-verification expectations
7. Generate one PNG concept image per major page under `docs/ui/concepts/<page-id>.png` using image generation, not text-only mockup generation. Each PNG must show layout structure, navigation, key panels, primary actions, realistic states, responsive intent, and the most important data regions. Keep PNGs legible, product-specific, and implementation-oriented; avoid decorative mockups that cannot guide code. If the run cannot access an image generation tool/model, stop with `blocked` and list the missing capability.
8. Write the UI Spec to `docs/features/<featureId>/ui-spec.md` when `featureId` is present, otherwise `docs/ui/ui-spec.md`.
9. Include traceability from each page, flow, component family, view model, and concept image to the requirement IDs or HLD sections that justify it.

## Design Quality Baseline

Borrow these standards from strong frontend/UI skills, but express them as specification requirements rather than implementation work:

- Define the complete requested surface, not just a first screen.
- Choose a clear visual point of view that fits the product domain and user workload.
- Build from a reusable design system: tokens, typography, layout primitives, component families, and state variants.
- Preserve implementation practicality: text and controls are code-native; generated PNGs are concept artifacts, not shipped UI.
- Prefer established component libraries and HLD-approved UI stacks over bespoke widgets.
- Specify desktop, mobile, and narrow-layout behavior with stable dimensions for fixed-format UI such as boards, tables, toolbars, sidebars, and dashboards.
- Avoid unreadable text, overlapping controls, generic placeholders, nested cards, one-note palettes, decorative blobs/orbs, and invented marketing copy.
- Treat accessibility, empty/error/loading states, and operator feedback as first-class UI, not polish afterthoughts.

## Optional Coordination

When this skill is invoked inside an interactive Codex session rather than the scheduler:

- If high-fidelity visual design or frontend implementation is explicitly requested, read and follow `build-web-apps:frontend-app-builder` after this UI Spec is generated.
- If the UI is only being specified for later implementation, keep outputs to Markdown plus PNG concept artifacts.
- If external UI/UX skills are consulted, use them only as design heuristics. Do not copy their runtime-specific orchestration, subagent requirements, or approval gates into this scheduler-facing skill.

## Output

- `docs/features/<featureId>/ui-spec.md` — structured UI Spec document
- `docs/ui/ui-spec.md` — project-level structured UI Spec document when no feature is selected
- `docs/ui/concepts/<page-id>.png` — raster PNG major-page concept images produced through image generation
- Summary listing generated pages, generated concept image paths, and REQ coverage
- Return a `SkillOutputContractV1` JSON object with `contractVersion`, `executionId`, `skillSlug`, `requestedAction`, `status`, `summary`, `nextAction`, `producedArtifacts`, Feature-level `traceability`, and `result`.

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- `summary` must list generated pages, generated concept image paths, and REQ coverage.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `uiSpecPath`: generated UI Spec path.
- `pages`: array of generated page/view IDs, routes, owning Feature, and requirement coverage.
- `conceptImages`: array of generated concept PNG image artifact paths.
- `designBrief`: audience, jobs-to-be-done, product tone, visual direction, and source constraints.
- `designSystem`: tokens, component families, typography, spacing, density, icon rules, and motion rules.
- `uxFlows`: key user action, state transition, and visual feedback sequences.
- `componentCatalog`: reusable component names, props, variants, and state contracts.
- `viewModels`: required page data shapes.
- `responsiveRules`: desktop, mobile, narrow layout, and fixed-format UI behavior.
- `accessibilityNotes`: keyboard, focus, ARIA, and responsive notes.

## Example Skill Invocation Contract

```json
{
  "contractVersion": "skill-contract/v1",
  "executionId": "EXEC-001",
  "projectId": "my-project",
  "workspaceRoot": "/workspace/my-project",
  "operation": "generate_ui_spec",
  "skillSlug": "ui-spec-skill",
  "sourcePaths": [
    "docs/zh-CN/PRD.md",
    "docs/zh-CN/requirements.md",
    "docs/zh-CN/hld.md",
    "docs/features/README.md"
  ],
  "expectedArtifacts": [
    { "path": "docs/ui/ui-spec.md", "kind": "markdown", "required": true },
    { "path": "docs/ui/concepts/<page-id>.png", "kind": "image", "required": true }
  ],
  "traceability": {
    "featureId": "feat-013-product-console"
  },
  "constraints": {
    "allowedFiles": [],
    "risk": "medium"
  },
  "requestedAction": "generate_ui_spec"
}
```

## Failure Routing

- Use `blocked` when PRD, requirements, and HLD do not identify enough page or workflow information to derive major pages; put the clarification request in `nextAction`.
- Use `review_needed` when a requested page, flow, or concept image has no corresponding requirement or HLD support.
- Use `blocked` when required source files cannot be resolved or read at the workspace root.
- Use `blocked` when required PNG concept images are requested but the active adapter is not Codex CLI or the current Codex CLI runtime does not expose `$imagegen`.
- Use `review_needed` when design direction, technology-stack constraints, accessibility requirements, or page inventory conflicts must be resolved before producing a trustworthy UI Spec.
