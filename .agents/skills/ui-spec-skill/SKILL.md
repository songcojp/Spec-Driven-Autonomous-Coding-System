---
name: ui-spec-skill
description: "Generate a structured UI Spec from a concept image and HLD using Codex image model support (codex exec -i <image>). Use when the Spec Workspace generate_ui_spec action is triggered and a concept image path is available."
---

# UI Spec Skill

Use this skill to produce a structured UI Spec document from a visual concept image and the existing HLD / feature list.

## Image Model Usage

Codex CLI supports attaching local image files directly to the initial prompt via the `-i` flag:

```bash
codex exec \
  -a on-request \
  --sandbox workspace-write \
  --model gpt-5-codex \
  --output-schema /tmp/evidence.schema.json \
  -i docs/ui/spec-workspace-prd-flow-concept.png \
  "Analyze the attached concept image and generate a structured UI Spec for this product..."
```

The runner resolves the concept image path from the `imagePaths` field of the `SkillInvocationContract` and injects `-i <path>` flags into the `codex exec` argument list before the prompt.

## Inputs

| Field | Source | Description |
|-------|--------|-------------|
| `imagePaths` | phase facts `Concept` value, resolved relative to workspace root | Concept image(s) to pass to the model via `-i` |
| `sourcePaths` | HLD path, PRD path, feature index | Text-based context files read as workspace sources |
| `featureId` | payload | Target feature for the generated UI Spec |
| `workspaceRoot` | project config | Workspace root used to resolve image paths |

## Workflow

1. Read the project HLD (`docs/zh-CN/hld.md`), PRD (`docs/zh-CN/PRD.md`), and feature index (`docs/features/README.md`) to understand product scope and active features.
2. For each attached concept image, analyze the visual layout: identify pages/views, navigation structure, key components, data displayed, and user actions.
3. Cross-reference the visual layout with HLD sections and active Feature Specs to ensure every page maps to a known requirement.
4. Produce the UI Spec document covering:
   - **Page inventory**: list of all pages/views with purpose, route, and owning feature
   - **Component catalog**: reusable components with props and state contract
   - **Interaction flows**: user action → state transition → visual feedback per key flow
   - **View models**: data shape and field list each page requires from the API
   - **Responsive behavior**: desktop vs mobile layout differences
   - **Accessibility notes**: keyboard navigation, ARIA labels, focus management
5. Write the output to `docs/features/<featureId>/ui-spec.md` (or `docs/ui/ui-spec.md` if no featureId).
6. Include traceability to the requirements that each page satisfies.

## Output

- `docs/features/<featureId>/ui-spec.md` — structured UI Spec document
- Evidence summary listing analyzed images, pages identified, and REQ coverage

## Example Skill Invocation Contract

```json
{
  "projectId": "my-project",
  "workspaceRoot": "/workspace/my-project",
  "skillSlug": "ui-spec-skill",
  "imagePaths": ["docs/ui/spec-workspace-prd-flow-concept.png"],
  "sourcePaths": [
    "docs/zh-CN/PRD.md",
    "docs/zh-CN/hld.md",
    "docs/features/README.md"
  ],
  "expectedArtifacts": ["docs/features/feat-013-product-console/ui-spec.md"],
  "traceability": {
    "featureId": "feat-013-product-console",
    "requirementIds": ["REQ-052", "REQ-053", "REQ-054"],
    "changeIds": ["CHG-016"]
  },
  "requestedAction": "generate_ui_spec"
}
```

## Failure Routing

- Use `clarification_needed` when no concept image is available and the HLD alone is insufficient to infer page structure.
- Use `risk_review_needed` when the concept image shows pages or flows that have no corresponding requirement.
- Use `blocked` when the image path cannot be resolved or the file does not exist at the workspace root.
