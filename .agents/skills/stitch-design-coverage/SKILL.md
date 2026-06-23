---
name: stitch-design-coverage
description: Use when creating, revising, or verifying Stitch MCP UI designs from product coverage, design-consumption targets, flows, states, operation results, navigation, and versioned screens for web, mobile, desktop, admin, or plugin surfaces.
---

# Stitch Design Coverage

## Overview

Use Stitch MCP to produce real UI design screens, not prose-only design documents. The goal is complete Stitch coverage: every user flow, page, state, component, operation result, and navigation path must have a designed screen or state component that can guide UI implementation and test acceptance.

When a `prepare-product-delivery-contract` coverage package exists, this skill is its downstream design executor. Treat `coverage/design-consumption.md` `DHI-###` rows as the primary Stitch design targets, then use the UI tree, workflows, acceptance rows, and traceability ledger to verify that the resulting screens are WYSIWYG-ready.

## Required Inputs

Gather whatever exists before calling Stitch.

If a coverage package exists, read these files first and preserve their IDs:

- `coverage/design-consumption.md`: source of `DHI-###` design targets, versioned titles, prompts, viewports, assets, acceptance hooks, and current status.
- `coverage/ui-interaction-tree.md`: source of `SURF`, `PAGE`, `REG`, `CMP`, `CTRL`, `STATE`, and `NAV` relationships.
- `coverage/product-workflows.md`: source of workflow intent, actors, preconditions, alternates, failures, and terminal results.
- `coverage/acceptance-automation.md`: source of `OP`, `RES`, `VIS`, and `TM` acceptance hooks.
- `coverage/traceability-ledger.md`: source of downstream readiness and missing inputs.

Also gather:

- Product requirements, function map, UI tree, operation matrix, user flows, screenshots, sketches, or existing Stitch project/screen IDs.
- Version target, such as `V1`, `V1.1`, or `V2`.
- Design target IDs, UI IDs, or operation IDs. Prefer `DHI-###` from the design-consumption package. If no stable design target exists, assign one before generating screens and report that it must be added to the coverage package.
- Product surface: web, mobile, desktop, admin console, plugin panel, etc.
- Target viewport or device family.
- Design system constraints: density, visual tone, component conventions, brand tokens, platform conventions.
- Scope boundary: what is in-scope and what is explicitly excluded from this coverage pass.

If source coverage is weak, create a short screen/state inventory first. Do not start Stitch generation from a vague feature list. If a `DHI-###` row is missing a viewport, layout hierarchy, required states, content examples, design-system constraint, or acceptance hook, mark that row `blocked` or `gap` until the missing field is supplied or reasonably derived from the other coverage files.


## Naming Rule

Every Stitch page/screen title must begin with a version and one stable design target ID:

```text
<version> <DHI-ID> <Page or State Name>
```

Examples:

```text
V1 DHI-001 Login
V1 DHI-014 Task Detail - Empty State
V2 DHI-031 Checkout Payment Error
```

If the project already uses another stable screen ID, such as `UI-001`, keep it as an alias in the prompt and report, but do not drop the `DHI-###` mapping when the source package uses `DHI-###`.

Use one design target ID per screen or state component. For pages that contain multiple important states, create separate state screens unless Stitch can clearly show the states as named components on one board.

## Version Strategy

1. List or inspect existing Stitch screens for the target project.
2. If an existing screen with the same version and design target ID can be safely revised, use Stitch editing on that existing screen.
3. If Stitch cannot safely modify that screen, or editing would create an ambiguous duplicate, create a new versioned screen title.
4. Never silently overwrite meaning. When a new version is created, keep the version prefix clear and report superseded screen IDs/titles.
5. If MCP cannot delete obsolete screens, provide a manual cleanup list instead of attempting unsafe delete-like edits.

## Stitch MCP Workflow

Use available Stitch MCP tools directly. See `references/stitch-design-coverage-contract.md` Section "Tool Map" for the full intent-to-tool mapping. Key tools:

| Intent | Tool |
| --- | --- |
| Find project | `list_projects` |
| Inspect project, instances, design system | `get_project` |
| Build screen inventory | `list_screens` |
| Verify one screen | `get_screen` |
| Create new page/state/result screen | `generate_screen_from_text` |
| Revise a known screen | `edit_screens` |
| Explore visual alternatives | `generate_variants` |
| Find design system | `list_design_systems` |
| Apply design system across screens | `apply_design_system` |

1. Identify project and current screen inventory.
2. Identify the design system with `list_design_systems` or `get_project`; pass it into generation when available.
3. Build a coverage plan from source flows:
   - page screens
   - state screens
   - reusable component boards
   - operation result screens
   - navigation/transition screens
4. Generate or edit screens in small coherent batches.
5. Use concrete prompts that include:
   - exact title using the naming rule
   - target surface and viewport
   - `DHI-###` design target and related `PAGE`, `STATE`, `NAV`, `OP`, `RES`, `VIS`, and `TM` IDs
   - visible user goal
   - layout hierarchy
   - representative labels, data, copy, assets, and redactions from the design-consumption row
   - components and states to show
   - navigation entry/exit
   - empty/loading/error/success/retry variants
   - visual and accessibility acceptance hooks
   - visual constraints from the design system
6. Verify generated screens with `get_screen`, not just tool success messages.
7. Iterate until required design target IDs, UI IDs, operation results, states, and acceptance hooks are present.
8. Produce a coverage backfill table that can update `coverage/design-consumption.md` `Output / Design Source` and `coverage/traceability-ledger.md` readiness.

## MCP Call Rules

- Use project IDs and screen IDs without `projects/` or `screens/` prefixes except where a tool explicitly requires a full resource name such as `projects/{project}/screens/{screen}`.
- Do not retry long-running generation/edit calls just because they timeout. Poll with `get_screen` every 30 seconds for up to 10 attempts when the tool instructions say the operation may still finish.
- Prefer `generate_screen_from_text` for new page/state screens. Use `edit_screens` only when the target screen IDs are known and the edit scope is unambiguous.
- Treat `list_screens` as inventory, not proof of completion; if it lags or omits a recent screen, verify with `get_screen`.
- Do not use `edit_screens` as a deletion or delete-marker workaround. If deletion is not available, report a manual cleanup list.
- When applying a design system, use screen instance IDs from `get_project`, not source screen IDs.

Read `references/stitch-design-coverage-contract.md` for the checklist and prompt shape.

## Completeness Gate

Do not call Stitch design complete until all are true:

- Every page in the UI tree has a Stitch screen.
- Every operation that changes UI or session state has a designed result state.
- Every critical state exists: initial, loading, empty, validation error, permission denied, backend error, success, retry/recovery, disabled, selected/focused where applicable.
- Every navigation path has visible source and destination design coverage.
- Every reusable component with meaningful behavior has normal, edge, and failure states.
- Every `ready-for-design` Stitch `DHI-###` row in `coverage/design-consumption.md` has a created, edited, or verified Stitch screen, unless explicitly reported as blocked.
- Every screen title follows `<version> <DHI-ID> <Page or State Name>` when `DHI-###` exists.
- The design system has been identified and applied (or the gap is explicitly reported).
- Verification retrieved the actual Stitch screens and confirmed the expected design target IDs, titles, visible UI content, states, operation results, and acceptance hooks — not just tool success messages.
- The completion report includes the exact Stitch screen IDs/titles to write into `Output / Design Source`, plus any `traceability-ledger.md` readiness updates such as `designed`, `verified`, `wysiwyg-complete`, `partial`, or `blocked`.

If anything is missing, report it as a gap list and continue generating or editing screens where possible.

## Common Failures

| Failure | Correction |
| --- | --- |
| Stitch output is a document/spec page instead of real UI | Regenerate with screen-level prompt, viewport, layout hierarchy, and concrete components. |
| Feature is mentioned but no screen exists | Create a page or state screen with a versioned `DHI-###` design target. |
| Coverage package uses `DHI-###` but Stitch plan uses only UI IDs | Rebuild the inventory from `coverage/design-consumption.md` and preserve `DHI-###` as the primary key. |
| Happy path only | Add error, empty, loading, permission, retry, and success result screens. |
| Duplicate ambiguous versions | Rename/report superseded screens and use explicit version prefixes. |
| Tool says success but screen is incomplete | Retrieve the screen and verify design target IDs, states, operation results, acceptance hooks, and visible content. |

## SpecDrive Harness Integration

When running in a SpecDrive project (a `spec-state.json` exists for the Feature), this skill is the **only authority** that may advance `deliveryHarnessRef.harnessStatus` to `"ready"`. After the Completeness Gate passes, patch the Feature's `spec-state.json`:

```json
"deliveryHarnessRef": {
  "path": "docs/agentic-spec/ui/coverage/delivery-harness.md",
  "workflowRefs": ["<F-### from product-workflows.md>"],
  "dhiRefs": ["<all DHI-### IDs processed>"],
  "tmRefs": ["<all TM-### IDs from acceptance-automation.md>"],
  "stitchScreenIds": ["<screen_id_1>", "<screen_id_2>"],
  "harnessStatus": "<status>"
}
```

**Status resolution:**

| Condition | `harnessStatus` |
|---|---|
| Completeness Gate passed; all DHI rows have verified Stitch screens | `"ready"` |
| Some DHI rows verified, some reported as `blocked` or `gap` | `"gap"` |
| Stitch MCP unavailable (auth/connection error) | `"blocked"` |
| No DHI rows found or all rows unprocessable | `"blocked"` |

**Never write `harnessStatus: "ready"` when `stitchScreenIds` is empty or when Completeness Gate has unresolved gaps.**

When `harnessStatus` is set to `"ready"`, the SpecDrive scheduler will allow the Feature to proceed to `implement-feature`. If `harnessStatus` remains `"pending"`, `"gap"`, or `"blocked"`, the scheduler will return `blocked` status and prevent execution.

Also produce or update `docs/agentic-spec/ui/coverage/stitch-coverage-report.md`:

- Table of `DHI-###` → Stitch screen ID + title + verification status
- Summary: total DHI rows, successful, blocked, skipped
- `harnessStatus` value and effective date
- Link to traceability ledger for downstream scheduling reference

## References

- Read `references/harness-contract.md` for the Observe-Plan-Act loop, Sensor priority, HITL gates, and execution trace schema governing all SpecDrive skills.
- Read `references/stitch-design-coverage-contract.md` for the full checklist and prompt shape.
- Read `references/specdrive-output.md` when invoked by an adapter requiring structured execution output.
