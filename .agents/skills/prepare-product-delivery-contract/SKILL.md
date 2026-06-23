---
name: prepare-product-delivery-contract
description: Use when asked to create or update a coded 功能地图, UI/interaction tree, Stitch/Figma/product-design consumption package, WYSIWYG design handoff, automated acceptance matrix, test oracle map, workflow coverage map, or end-to-end validation map for any software product.
---

# Prepare Product Delivery Contract

## Overview

Create a downstream-consumable product contract that links business workflows, UI structure, user operations, system state changes, design-tool inputs, and automated verification. The output must be directly useful to the next worker: design tools should be able to render screens from it, and test automation should be able to implement assertions from it.

This skill prepares WYSIWYG design and acceptance inputs; it does not create final UI designs. Use it to define what a dedicated design skill or design tool workflow, such as Stitch, Figma, or product-design skills, must render and what acceptance tests must later prove. Treat design requirements, UI states, rendered screenshots, visual assertions, and acceptance rows as one connected contract rather than separate handoff artifacts.

## Required Inputs

Gather whatever exists before building coverage:

- Product requirements, design specs, tickets, user stories, or acceptance criteria.
- Existing Figma, Stitch, screenshots, prototypes, design frames, component variants, tokens, or other visual source artifacts, when available.
- Target design tool, version target, viewport/device family, design system, component library, brand/platform constraints, and asset sources when known.
- Existing routes, screens, components, commands, APIs, jobs, permissions, or schemas.
- Existing tests, screenshots, fixtures, mocks, seed data, telemetry, or audit logs.
- Actor/role list: who or what initiates workflows.
- Product surface: web, mobile, desktop, CLI, backend service, AI agent, embedded system, etc.
- Version or scope boundary: what is in-scope and what is explicitly excluded.
- Any existing coded IDs from design, requirement, or test systems to alias.

If source evidence is weak, produce a short workflow and screen inventory first. Do not build a full consumer package from a vague feature list.

## Output Model

Always create the consumer-oriented package below under the target project's `docs/coverage/` directory. Do not create the package at the repository root or in an ad hoc working directory unless the user explicitly requests a different documented path.

| File | Consumer | Must answer |
| --- | --- | --- |
| `docs/coverage/README.md` | Everyone | What scope, actors, surfaces, versions, evidence, and downstream status does this package cover? |
| `docs/coverage/product-workflows.md` | Product, design, QA | What can the product do, for whom, from which trigger/precondition to which terminal result? |
| `docs/coverage/ui-interaction-tree.md` | Design, implementation, QA | Which surfaces, pages, regions, components, controls, states, navigation paths, and interactions expose each workflow? |
| `docs/coverage/design-consumption.md` | Stitch, Figma, product-design skills | What exact screens, states, components, prompts, viewports, assets, data examples, and design-system constraints should design tools consume? |
| `docs/coverage/acceptance-automation.md` | QA automation, implementation | Which operations, fixtures, locators, assertions, visual baselines, accessibility checks, and evidence prove acceptance? |
| `docs/coverage/traceability-ledger.md` | Reviewers and release owners | Are all workflow, UI, design, and test IDs linked without gaps or drift? |

Do not treat these as independent documents. Every workflow should trace to UI nodes or an explicit non-UI interface. Every user-visible UI node should trace to a design-consumption row or existing design source. Every actionable UI node should trace to one or more acceptance rows. Every acceptance row should have an automation-ready oracle. The traceability ledger should expose any missing link as a gap.

When Figma, Stitch, or another UI design source exists, every user-visible `PAGE`, `REG`, `CMP`, `CTRL`, and behavior-changing `STATE` should include the related design artifact ID, frame URL, node ID, or screen version. When design does not exist yet, write a design-consumption target instead of inventing a design reference. The package should make design gaps and visual drift visible before implementation or acceptance begins.

## Design Tool Boundary

Use this skill to prepare structured inputs for dedicated design skills and tools, not to execute design production. The handoff must say what needs to be designed, for which workflow/state, with which layout/content/accessibility constraints, and how the finished design will be accepted.

Do not use this skill to generate, draw, or update Figma/Stitch screens directly. After this package is ready, route actual design work to the relevant design skill, such as `stitch-design-coverage`, `figma-generate-design`, or product-design skills.

## Document Architecture and Splitting Strategy

To prevent a single document from becoming too large and unmanageable, the coverage model must always be split into multiple documents within the target project's `docs/coverage/` directory:

### 1. Standard Document Structure

Create a `docs/coverage/` directory containing the following files:

- `docs/coverage/README.md`: Central Index, boundary definition, actor/role list, and product scope.
- `docs/coverage/product-workflows.md`: Product workflow contract containing capabilities (`F-###`), actors, preconditions, main/alternate/failure flows, and terminal results.
- `docs/coverage/ui-interaction-tree.md`: Complete UI and interaction tree containing `SURF`, `PAGE`, `REG`, `CMP`, `CTRL`, `STATE`, and `NAV` definitions.
- `docs/coverage/design-consumption.md`: Design-tool consumption package containing design targets (`DHI-###`), screen/state inventory, tool-ready prompts, viewports, design-system constraints, assets, and acceptance hooks for Stitch/Figma/product-design skills.
- `docs/coverage/acceptance-automation.md`: Acceptance automation contract containing operations (`OP-###`), visual delivery requirements (`VIS-###`), test rows (`TM-###`), locators, fixtures, assertions, and evidence.
- `docs/coverage/traceability-ledger.md`: Cross-document closure matrix showing links, gaps, ownership, and downstream status.

### 2. Traceability Across Split Files

The linkage between elements across these files must remain strict and traceably complete:
- **Code Uniqueness**: Codes (`F-###`, `PAGE-###`, `CTRL-###`, `TM-###`, etc.) must remain globally unique across the entire project. Never duplicate codes.
- **Cross-File Linking**: Use standard Markdown relative links to reference related IDs in other files.
  - Example in `ui-interaction-tree.md`: `├─ CTRL-001 [F-001](product-workflows.md#F-001) [DHI-001](design-consumption.md#DHI-001) [TM-001](acceptance-automation.md#TM-001)`
- **Traceability Completeness**: Every UI control must trace to its workflow in `product-workflows.md`, design target in `design-consumption.md` when user-visible, and acceptance row in `acceptance-automation.md`; every acceptance row must map back to a workflow.
- **Consumer Readiness**: `design-consumption.md` must be sufficient for a design skill to act without inventing product behavior. `acceptance-automation.md` must be sufficient for an automation engineer or agent to implement tests without guessing the oracle.



## Coding System

Assign stable codes before writing detailed coverage. Never leave a page, component, state, operation, operation result, navigation transition, backend/session result, or test matrix row without a code.

| Prefix      | Use for                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `F-###`     | Function, capability, or workflow.                                                                                  |
| `ACT-###`   | Actor or role when roles need explicit tracking.                                                                    |
| `SURF-###`  | Product surface, channel, or interface.                                                                             |
| `PAGE-###`  | Page, screen, view, route, dialog, or command surface.                                                              |
| `REG-###`   | Region, panel, section, drawer, modal body, or grouped area.                                                        |
| `CMP-###`   | Reusable component, widget, card, table, list, form, or renderer.                                                   |
| `CTRL-###`  | Actionable control, input, menu item, link, command, shortcut, or gesture.                                          |
| `STATE-###` | UI or system state: empty, loading, validation, error, disabled, permission, conflict, success.                     |
| `NAV-###`   | Navigation path, route transition, tab change, deep link, back/exit path, or redirect.                              |
| `DHI-###`   | Design-consumption target: screen, state, component board, operation result, navigation transition, or prompt package. |
| `OP-###`    | User, system, background, or integration operation to verify.                                                       |
| `RES-###`   | Operation result, UI result, system result, side effect, event, artifact, or no-op guarantee.                       |
| `VIS-###`   | Visual delivery requirement: layout, content, responsive behavior, visual state, accessibility, or render evidence. |
| `TM-###`    | Test matrix row that verifies one operation/state/result combination.                                               |

Use project-local prefixes only if they already exist and are consistent. Codes must be stable, unique within their prefix, and never reused for a different meaning. When an item is removed, keep the old code in history or mark it `excluded`; do not silently recycle it.

## UI Deliverability Gate

Do not mark a function as UI-deliverable only because the behavior exists. A UI node is deliverable only when its visual and interaction contract can be implemented and verified.

For every `PAGE`, `REG`, `CMP`, `CTRL`, and behavior-changing `STATE`, define:

- visual role and hierarchy: what the user must see first, scan next, and act on
- layout constraints: viewport, density, spacing, wrapping, scroll behavior, fixed/sticky regions, overflow handling
- content states: empty, short, long, localized, missing, malformed, loading, and error content
- interaction feedback: hover/focus/pressed/disabled/pending/success/failure where applicable
- accessibility contract: label, role, focus order, keyboard path, contrast, reduced-motion or screen-reader expectations
- design input or target: Figma frame, Stitch screen, prototype link, screenshot, design-node ID, accepted baseline, or explicit design-consumption target for a dedicated design skill
- render evidence: screenshot, visual test, component snapshot, DOM/accessibility snapshot, or manual visual artifact path

If a function is present but no UI delivery contract exists, mark it `partial`, not `implemented`.

If the implemented UI cannot be compared against a design source, accepted visual baseline, or completed design-skill output, mark the relevant `VIS-###` or `TM-###` row as `partial` or `blocked`; do not treat it as WYSIWYG-complete.

## Design Handoff Gate

For every user-visible page, critical state, reusable behavioral component, operation result, and navigation transition, create or link a `DHI-###` row. The row must be concrete enough for Stitch/Figma/product-design skills to generate an actual UI screen, not a document/spec page.

Each `DHI-###` row must include:

- target tool and action: Stitch/Figma/product-design, create/edit/revise/variant, and existing project/file/screen IDs when known
- versioned title: deterministic screen/state title such as `V1 DHI-001 Checkout Payment Error`
- surface and viewport: web/mobile/desktop/admin, breakpoint or device family, density, orientation, and responsive expectations
- related coverage IDs: `F`, `PAGE`, `REG`, `CMP`, `CTRL`, `STATE`, `NAV`, `OP`, `RES`, `VIS`, and `TM`
- layout and component hierarchy: regions, primary actions, secondary actions, data displays, dialogs/drawers, and persistent navigation
- content and data examples: realistic labels, empty/long/localized/error text, representative records, media/assets, and privacy redactions
- interaction and state requirements: default, hover, focus, pressed, disabled, loading, empty, validation, permission, error, success, retry, selected, expanded, and navigation entry/exit
- design-system constraints: known library/components/tokens, platform conventions, brand constraints, spacing/density, typography, icon/media rules, and unknown design-system gaps
- acceptance hooks: visual assertions, accessibility expectations, screenshot/baseline needs, and acceptance rows that will verify the finished design
- tool-ready prompt: concise prompt text that a design skill can pass into Stitch/Figma generation or use as the source description

## Method

1. Define the product boundary:
   - user roles or actors
   - supported platforms or surfaces
   - in-scope workflows
   - out-of-scope workflows
   - external systems and data ownership
2. Initialize Document Structure:
   - Initialize the file structure under the target project's `docs/coverage/` directory according to the **Document Architecture and Splitting Strategy**.
3. Inventory source evidence without assuming a fixed project layout:
   - product requirements, design notes, tickets, diagrams, screenshots, prototypes
   - existing Figma frames, Stitch screens, component variants, design tokens, exported images, and design-node IDs
   - navigation, routes, screens, components, commands, APIs, jobs, permissions, schemas
   - existing tests, logs, screenshots, fixtures, mocks, seed data, telemetry, acceptance criteria
4. Build the workflow graph:
   - trigger
   - preconditions
   - main path
   - alternate paths
   - failure/recovery paths
   - terminal states
   - data or side effects
5. Build the UI interaction tree from the user's point of view:
   - `SURF` -> `PAGE` -> `REG` -> `CMP` -> `CTRL` -> `OP`
   - write each tree line with same-level metadata: node code, node type, label, related component/control, design input or handoff target, state, operation, expected UI result, backend/session result, navigation, visual delivery requirement, and test matrix row
   - add `STATE`, `NAV`, `RES`, `VIS`, and `TM` codes where they occur
   - include hidden or conditional states when they affect behavior
   - include empty, loading, error, disabled, permission, validation, retry, conflict, timeout, and success states
6. Build the design consumption package:
   - create one `DHI-###` row for each page, critical state, operation result, component board, and navigation target that needs design coverage
   - include target tool, versioned title, viewport, design-system constraints, content/data examples, interaction states, related coverage IDs, and tool-ready prompt
   - mark rows as `ready-for-design`, `designed`, `blocked`, `superseded`, or project-local equivalents
   - when Stitch is a likely target, make each title compatible with `<version> <DHI-ID> <Page or State Name>`
   - when Figma is a likely target, include component/tokens/library expectations and whether the screen should be built from existing design system components
7. Build the acceptance automation contract:
   - one row per meaningful user or system operation
   - assign a `TM-###` code to each row
   - reference the related `F`, `PAGE`/`CMP`/`CTRL`, `STATE`, `NAV`, `DHI`, `OP`, `RES`, `VIS`, and `TM` codes
   - include precondition, action, expected UI result, expected system result, visual assertion, selector/locator strategy, automation level, assertion oracle, fixture/data need, evidence, and status
8. Build the traceability ledger:
   - one row per workflow/UI/design/acceptance chain
   - include links across `F`, `PAGE`, `CTRL`, `STATE`, `NAV`, `DHI`, `OP`, `RES`, `VIS`, and `TM`
   - mark each chain `ready-for-design`, `ready-for-automation`, `wysiwyg-complete`, `blocked`, `partial`, or `excluded`
   - name the exact missing consumer input when a chain is not ready
9. Check coverage closure:
   - every workflow has at least one acceptance row for success and critical failures
   - every control has a row or is marked display-only
   - every page, component, state, design-consumption target, operation result, backend/session result, navigation path, and test matrix row has a code
   - every UI node has a visual delivery requirement or is explicitly non-visual
   - every user-visible UI node has a design source, visual baseline, or explicit design-consumption target
   - every design-consumption target names enough viewport, layout, state, content, design-system, asset, and acceptance detail for a design skill to act without inventing product behavior
   - every acceptance target names enough fixture, locator, action, expected UI/system result, visual/accessibility oracle, and evidence path for automation to act without inventing behavior
   - every mutating action has a data/state assertion
   - every async action has pending, success, failure, and retry coverage where applicable
   - every permission/security boundary has allowed and denied coverage


## Status Model

Use the project's existing status terms if they are already defined. Otherwise use:

| Status        | Meaning                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `implemented` | Behavior exists and can be verified in the current product.                                         |
| `partial`     | Entry point exists, but at least one workflow, state, side effect, or verification path is missing. |
| `designed`    | Intended behavior exists only in requirements/design/prototype.                                     |
| `blocked`     | Verification or implementation cannot proceed until a named dependency is resolved.                 |
| `excluded`    | Explicitly outside the current scope and should not be designed or tested as current behavior.      |
| `unknown`     | Evidence is insufficient; verify before making claims.                                              |

Design and acceptance rows may additionally use `ready-for-design`, `ready-for-automation`, `designed`, `verified`, `wysiwyg-complete`, and `superseded` when tracking downstream work.

## Automation Requirements

Write acceptance rows so a test can be implemented mechanically:

- Use stable locators when available; otherwise identify the label, role, position within component, or data attribute that should be added.
- Separate UI assertions from system assertions.
- Name required fixtures, seed data, accounts, permissions, mock responses, clocks, files, devices, or external services.
- For asynchronous behavior, include wait condition and timeout/failure oracle.
- For destructive or external actions, include confirmation, rollback, sandbox, or no-op verification.
- Do not mark an operation covered unless the assertion can fail for the right reason.

## Reference Contract

Read `references/consumer-coverage-contract.md` when creating a new package, refreshing a large package, or converting the package into design and automated test backlogs.

## Completeness Gate

Do not claim the package is complete until all of the following are true:

- Every actor has at least one workflow.
- Every workflow has a success path, cancellation path where relevant, and at least one critical failure path.
- Every page, screen, view, dialog, route, or command surface has a `PAGE-###` code.
- Every reusable component with behavior has a `CMP-###` code.
- Every actionable control, input, menu item, link, shortcut, or gesture has a `CTRL-###` code.
- Every state that changes behavior or assertions has a `STATE-###` code.
- Every navigation path, redirect, tab switch, modal open/close, deep link, back path, and guarded route has a `NAV-###` code.
- Every design target needed by Stitch/Figma/product-design skills has a `DHI-###` code.
- Every operation to verify has an `OP-###` code.
- Every expected UI result and every system side effect has a `RES-###` code.
- Every visual/layout/accessibility delivery requirement has a `VIS-###` code or is explicitly marked non-visual.
- Every user-visible `VIS-###` row names a Figma/Stitch/design source, accepted visual baseline, screenshot, completed design-skill output, or explicit design-consumption target.
- Every `DHI-###` row has target tool/action, versioned title, viewport, related coverage IDs, layout/content/state requirements, design-system constraints, assets, and acceptance hooks.
- Every test matrix row has a `TM-###` code.
- Every mutating operation has a system-result assertion.
- Every async operation has pending, success, failure, and retry/cancellation coverage.
- Every permission boundary has allowed and denied cases.
- Every user-visible workflow marked `implemented` has render evidence; otherwise mark it `partial`.

If anything is missing, report it as a gap list and continue filling coverage before declaring done.

## Common Failures

| Failure                                     | Fix                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature list without flows                  | Add trigger, actor, preconditions, transitions, and terminal states.                                                                           |
| UI interaction tree without operations      | Add one acceptance row for every actionable control and state transition.                                                                       |
| Acceptance contract without automation oracles | Add locators, fixtures, assertions, and evidence fields.                                                                                    |
| Functions exist but UI is not deliverable   | Add `VIS` requirements, visual assertions, layout constraints, and render evidence before marking implemented.                                 |
| Mapping skill starts doing design work      | Stop at design-ready inputs and route actual Figma/Stitch/design generation to the dedicated design skill.                                      |
| Design tool receives vague prose            | Add `DHI-###` rows with versioned titles, viewport, component hierarchy, concrete states, sample content, design-system constraints, and tool-ready prompts. |
| Design and tests drift apart                | Add Figma/Stitch node IDs, design-skill output IDs, or screen URLs to UI nodes, connect them to `VIS-###` rows, and require screenshot or visual assertions in `TM-###`. |
| Happy-path-only coverage                    | Add validation, permission, empty, error, retry, conflict, timeout, and recovery rows.                                                         |
| System effects not verified                 | Add data, API, storage, event, notification, audit, or state assertions.                                                                       |
| Out-of-scope items mixed into current scope | Move them to `excluded` with reason and version/scope boundary.                                                                                |
