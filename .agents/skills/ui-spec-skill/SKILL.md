---
name: ui-spec-skill
description: "Generate a structured UI Spec and major-page UI concept images from PRD, EARS requirements, and HLD. Use when the Spec Workspace generate_ui_spec action is triggered after HLD exists."
---

# UI Spec Skill

Use this skill to produce a structured UI Spec document and major-page concept images from the product PRD, EARS requirements, HLD, and feature index.

## Generation Contract

The concept images are outputs, not required inputs. Generate text-based SVG concept images so the CLI runner can write them directly to workspace artifacts and audit them through artifact summaries.

## Inputs

| Field | Source | Description |
|-------|--------|-------------|
| `sourcePaths` | PRD path, EARS requirements path, HLD path, feature index | Text-based product and architecture context |
| `featureId` | payload | Target feature for the generated UI Spec |
| `workspaceRoot` | project config | Workspace root used to read sources and write generated artifacts |

## Workflow

1. Read the project PRD (`docs/PRD.md`), EARS requirements (`docs/requirements.md`), HLD (`docs/hld.md`), and feature index (`docs/features/README.md`) to understand product scope, primary pages, requirements, and architecture boundaries. Use localized sources such as `docs/en/*`, `docs/zh-CN/*`, or `docs/ja/*` only when the project explicitly declares multilingual documentation or the invocation provides localized source paths.
2. Derive the major page inventory from PRD user flows, requirements, HLD page list, and feature ownership. Do not invent pages that have no requirement or HLD support.
3. Produce the UI Spec document covering:
   - **Page inventory**: list of all pages/views with purpose, route, and owning feature
   - **Component catalog**: reusable components with props and state contract
   - **Interaction flows**: user action → state transition → visual feedback per key flow
   - **View models**: data shape and field list each page requires from the API
   - **Responsive behavior**: desktop vs mobile layout differences
   - **Accessibility notes**: keyboard navigation, ARIA labels, focus management
4. Generate one SVG concept image per major page under `docs/ui/concepts/<page-id>.svg`. Each SVG should show layout structure, navigation, key panels, primary actions, and the most important states. Keep the SVG legible and implementation-oriented rather than decorative.
5. Write the UI Spec to `docs/features/<featureId>/ui-spec.md` when `featureId` is present, otherwise `docs/ui/ui-spec.md`.
6. Include traceability from each page and concept image to the requirement IDs or HLD sections that justify it.

## Output

- `docs/features/<featureId>/ui-spec.md` — structured UI Spec document
- `docs/ui/ui-spec.md` — project-level structured UI Spec document when no feature is selected
- `docs/ui/concepts/<page-id>.svg` — generated major-page concept images
- Summary listing generated pages, generated concept image paths, and REQ coverage
- Return a `SkillOutputContractV1` JSON object with `contractVersion`, `executionId`, `skillSlug`, `requestedAction`, `status`, `summary`, `producedArtifacts`, and `traceability`; echo invocation-owned traceability fields and manage any `changeIds` from the source documents.

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- `summary` must list generated pages, generated concept image paths, and REQ coverage.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `uiSpecPath`: generated UI Spec path.
- `pages`: array of generated page/view IDs, routes, owning Feature, and requirement coverage.
- `conceptImages`: array of generated concept SVG/image artifact paths.
- `componentCatalog`: reusable component names and state contracts.
- `viewModels`: required page data shapes.
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
    "docs/PRD.md",
    "docs/requirements.md",
    "docs/hld.md",
    "docs/features/README.md"
  ],
  "expectedArtifacts": [
    { "path": "docs/ui/ui-spec.md", "kind": "markdown", "required": true },
    { "path": "docs/ui/concepts/<page-id>.svg", "kind": "image", "required": true }
  ],
  "traceability": {
    "featureId": "feat-013-product-console",
    "requirementIds": ["REQ-052", "REQ-053", "REQ-054"],
    "changeIds": ["CHG-001"]
  },
  "constraints": {
    "allowedFiles": [],
    "risk": "medium"
  },
  "requestedAction": "generate_ui_spec"
}
```

## Failure Routing

- Use `clarification_needed` when PRD, requirements, and HLD do not identify enough page or workflow information to derive major pages.
- Use `risk_review_needed` when a requested page, flow, or concept image has no corresponding requirement or HLD support.
- Use `blocked` when required source files cannot be resolved or read at the workspace root.
