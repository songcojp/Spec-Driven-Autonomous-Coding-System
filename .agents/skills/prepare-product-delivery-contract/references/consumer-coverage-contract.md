# Consumer Coverage Contract

Use this reference as a neutral template for any software product: mobile, web, desktop, command-line, backend, embedded, AI/agentic, or enterprise workflow systems.

This contract supports WYSIWYG input preparation for design and automated acceptance. Existing design sources such as Figma, Stitch, prototypes, screenshots, and visual baselines must remain traceable to UI nodes. Missing designs must become explicit design-consumption targets for dedicated design skills.

## 1. Document Directory Structure Template

The coverage model must be split into the following directory structure under the target project's `docs/` directory:

```text
docs/
└── coverage/
    ├── README.md                # Central Index, Actors & Boundary Definition
    ├── product-workflows.md     # Product Workflow Contract (F-###)
    ├── ui-interaction-tree.md   # UI/Interaction Tree (SURF/PAGE/REG/CMP/CTRL/STATE/NAV)
    ├── design-consumption.md    # Design Consumption Targets (DHI-###) for Stitch/Figma/product-design skills
    ├── acceptance-automation.md # Acceptance Automation Contract (OP/VIS/TM-###)
    └── traceability-ledger.md   # Cross-document closure, readiness, and gap ledger
```

## 2. Product Workflow Template


| Field | Description |
| --- | --- |
| Workflow ID | Stable function/workflow ID, such as `F-001`. |
| Domain / Area | Product area, module, bounded context, or workflow group. |
| Actor ID | `ACT-###` when roles need explicit tracking. |
| Actor | User role, system actor, integration, or scheduled process. |
| Capability | User-visible or system-visible function. |
| Trigger | What starts the workflow. |
| Preconditions | Required state, data, permissions, feature flags, connectivity, or external dependency. |
| Main Flow | Successful path from trigger to completed outcome. |
| Alternate / Failure Flows | Validation, cancellation, denial, conflict, retry, timeout, offline, partial success, rollback. |
| System Result | Data mutation, event, API call, file, message, job, audit log, notification, or no-op guarantee. |
| UI / Interface Entry IDs | Related `SURF`, `PAGE`, `REG`, `CMP`, `CTRL`, `NAV`, or explicit non-UI interface IDs. |
| Design Consumption IDs | Related Figma frame, Stitch screen, prototype link, screenshot, visual baseline, completed design-skill output, or explicit `DHI-###` target. |
| Operation IDs | Related `OP-###` rows that verify this function. |
| Result IDs | Related `RES-###` rows for expected UI/system outcomes. |
| Visual IDs | Related `VIS-###` rows for visual/layout/accessibility delivery requirements. |
| Test Matrix IDs | Related `TM-###` rows that prove the function is covered. |
| Status | `implemented`, `partial`, `designed`, `blocked`, `excluded`, or `unknown`. |
| Evidence | Source files, requirements, screenshots, tests, logs, tickets, or explicit missing evidence. |

## 3. Code Prefixes

| Prefix | Required for |
| --- | --- |
| `F-###` | Function, capability, or workflow. |
| `ACT-###` | Actor or role when roles need explicit tracking. |
| `SURF-###` | Product surface, channel, or interface. |
| `PAGE-###` | Page, screen, view, route, dialog, or command surface. |
| `REG-###` | Region, panel, section, drawer, modal body, or grouped area. |
| `CMP-###` | Reusable component, widget, card, table, list, form, or renderer. |
| `CTRL-###` | Actionable control, input, menu item, link, command, shortcut, or gesture. |
| `STATE-###` | UI or system state. |
| `NAV-###` | Navigation path or route transition. |
| `DHI-###` | Design-consumption target for a screen, state, component board, operation result, navigation transition, or prompt package. |
| `OP-###` | Operation to verify. |
| `RES-###` | UI result, system result, side effect, artifact, or no-op guarantee. |
| `VIS-###` | Visual delivery requirement: layout, content, responsive behavior, visual state, accessibility, or render evidence. |
| `TM-###` | Test matrix row that verifies one operation/state/result combination. |

Rules:

- Assign codes as soon as an item appears in the package.
- Keep codes stable across revisions.
- Do not reuse deleted codes for a different meaning.
- Store aliases if a project already has IDs, such as requirement IDs, route names, test IDs, or design-node IDs.

## 4. UI Interaction Tree Template

Represent UI from broadest surface to smallest operation. Each tree line must carry the same-level trace fields needed for design, implementation, and test automation.

```text
SURF-001 Surface
   [type=surface; design=DHI-001-or-existing-design-id; cmp=-; ctrl=-; state=STATE-001; op=-; uiResult=-; backendSessionResult=-; nav=-; visual=VIS-001; matrix=-]
└─ PAGE-001 Screen / Page / View
   [type=page; design=DHI-001-or-existing-design-id; cmp=-; ctrl=-; state=STATE-001; op=-; uiResult=RES-001; backendSessionResult=RES-002; nav=NAV-001; visual=VIS-001; matrix=TM-001]
   ├─ REG-001 Region / Panel / Section
   │  [type=region; design=DHI-001-or-existing-design-id; cmp=-; ctrl=-; state=STATE-002; op=-; uiResult=RES-003; backendSessionResult=-; nav=-; visual=VIS-002; matrix=TM-002]
   │  ├─ CMP-001 Component
   │  │  [type=component; design=DHI-002-or-existing-design-id; ctrl=-; state=STATE-003; op=-; uiResult=RES-004; backendSessionResult=RES-005; nav=-; visual=VIS-003; matrix=TM-003]
   │  │  ├─ CTRL-001 Control / Input / Link / Menu item
   │  │  │  [type=control; design=DHI-002-or-existing-design-id; cmp=CMP-001; state=STATE-004; op=OP-001; uiResult=RES-006; backendSessionResult=RES-007; nav=NAV-002; visual=VIS-004; matrix=TM-004]
   │  │  └─ STATE-005 Conditional / error / empty / loading state
   │  │     [type=state; design=DHI-003-or-existing-design-id; cmp=CMP-001; ctrl=CTRL-001; op=OP-002; uiResult=RES-008; backendSessionResult=RES-009; nav=-; visual=VIS-005; matrix=TM-005]
   │  └─ OP-003 Cross-component behavior
   │     [type=operation; design=DHI-004-or-existing-design-id; cmp=CMP-001; ctrl=CTRL-001; state=STATE-006; uiResult=RES-010; backendSessionResult=RES-011; nav=-; visual=VIS-006; matrix=TM-006]
   └─ NAV-003 Navigation / Exit path
      [type=navigation; design=DHI-005-or-existing-design-id; cmp=-; ctrl=-; state=STATE-007; op=OP-004; uiResult=RES-012; backendSessionResult=RES-013; visual=VIS-007; matrix=TM-007]
```

Use `-` for fields that are genuinely not applicable. Do not omit fields. If no design source exists for a user-visible node, use a stable `DHI-###` and create a design-consumption row for the dedicated design skill instead of silently accepting the absence. If a backend/session result is a guaranteed no-op, encode it as a `RES-###` row with a no-op assertion. If a node is non-visual, encode that as a `VIS-###` non-visual contract rather than omitting visual delivery.

Include these state classes when applicable:

| State class | Examples |
| --- | --- |
| Initial | first run, default selection, empty data, unauthenticated, feature disabled. |
| Input | focus, typing, format validation, required fields, file selection, drag/drop. |
| Loading | initial load, refresh, submit pending, background sync, streaming, queued job. |
| Success | saved, created, completed, connected, copied, exported, imported. |
| Empty | no records, no search results, no permissions, no eligible actions. |
| Error | validation error, network error, server error, permission denied, quota, timeout. |
| Recovery | retry, cancel, undo, rollback, reconnect, resume, edit and resubmit. |
| Conflict | stale data, duplicate, concurrent edit, optimistic update rollback. |
| Accessibility | focus order, keyboard path, label/role, screen-reader meaning, reduced motion. |

## 5. UI Delivery Template

| Field | Required question |
| --- | --- |
| Visual ID | What stable `VIS-###` identifies this visual delivery requirement? |
| Applies To | Which `PAGE`, `REG`, `CMP`, `CTRL`, `STATE`, `NAV`, or `OP` codes does it constrain? |
| Design Input / Target | Which Figma frame, Stitch screen, prototype, screenshot, visual baseline, completed design-skill output, or `DHI-###` target defines the intended appearance? |
| Visual Role | What is the visual purpose: primary action, status, warning, data display, navigation, confirmation, etc.? |
| Layout Contract | What must hold for size, spacing, alignment, wrapping, scrolling, sticky/fixed behavior, and overflow? |
| Content Contract | What short, long, empty, localized, dynamic, or malformed content cases must render cleanly? |
| Interaction States | Which hover, focus, pressed, disabled, pending, success, failure, selected, or expanded states must be visible? |
| Responsive / Surface Rules | Which viewport, orientation, density, or surface variations must be checked? |
| Accessibility Contract | What label, role, focus order, contrast, keyboard path, or screen-reader behavior is required? |
| Render Evidence | Screenshot, visual regression test, DOM snapshot, accessibility snapshot, trace, or manual artifact path. |

## 6. Design Consumption Template

Create this table in `docs/coverage/design-consumption.md`. It is the bridge from coverage mapping into Stitch/Figma/product-design execution.

| Field | Required question |
| --- | --- |
| Design Consumption ID | What stable `DHI-###` identifies this design target? |
| Target Tool / Action | Should a downstream skill create, edit, revise, variant, or verify a Stitch/Figma/product-design screen? |
| Versioned Title | What deterministic title should the design tool use, such as `V1 DHI-001 Login - Validation Error`? |
| Type | Is this a `page`, `state`, `component-board`, `operation-result`, `navigation`, `modal`, `dialog`, `empty-state`, or `error-state`? |
| Related Coverage IDs | Which `F`, `PAGE`, `REG`, `CMP`, `CTRL`, `STATE`, `NAV`, `OP`, `RES`, `VIS`, and `TM` IDs define the target? |
| Surface / Viewport | Which product surface, breakpoint, device family, orientation, and density must the design cover? |
| Flow Position | Is this entry, main path, detail, confirmation, result, error, retry, or exit? |
| Layout Hierarchy | Which regions, persistent navigation, component groups, primary/secondary actions, and scroll/sticky behavior must appear? |
| Required States | Which default, loading, empty, validation, permission, backend error, success, retry, disabled, selected, expanded, hover, and focus states must be represented? |
| Content / Data Examples | Which exact labels, representative records, empty text, long text, localized text, error copy, media, and redacted values should be visible? |
| Design System Constraints | Which component library, tokens, platform conventions, density, typography, icon rules, color behavior, or unknown design-system gaps apply? |
| Assets / Media | Which product images, icons, avatars, uploaded files, screenshots, or generated assets are required? |
| Navigation / Interaction | What entry/exit paths, gestures, modal behavior, tabs, drawers, confirmation, retry, undo, or keyboard interactions must be visible? |
| Acceptance Hooks | Which visual assertions, accessibility checks, screenshot baselines, acceptance rows, and evidence artifacts will accept the finished design? |
| Tool-Ready Prompt | What concise prompt can be passed to the design skill/tool without inventing product behavior? |
| Output / Design Source | Which resulting Stitch screen ID, Figma URL/node, screenshot baseline, or product-design output should be recorded after design is complete? |
| Status | `ready-for-design`, `designed`, `verified`, `blocked`, `superseded`, or project-local equivalent. |

For Stitch targets, make `Versioned Title` compatible with `<version> <DHI-ID> <Page or State Name>`. For Figma targets, include enough component, token, library, and section hierarchy detail for the Figma design skill to assemble the screen from design-system components.

## 7. Acceptance Automation Template

| Field | Required question |
| --- | --- |
| Matrix Row ID | What stable `TM-###` identifies this test matrix row? |
| Operation ID | What stable `OP-###` operation does this row verify? |
| Function ID | Which `F-###` capability does this verify? |
| Surface/Page IDs | Which `SURF-###` and `PAGE-###` expose it? |
| Region/Component/Control IDs | Which `REG`, `CMP`, and `CTRL` nodes are involved? |
| State IDs | Which `STATE-###` entries are preconditions or expected states? |
| Navigation IDs | Which `NAV-###` transition occurs, if any? |
| Result IDs | Which `RES-###` UI/system results must be asserted? |
| Visual IDs | Which `VIS-###` visual/layout/accessibility requirements must be asserted? |
| Design Consumption IDs | Which Figma, Stitch, prototype, screenshot, baseline, completed design-skill output, or `DHI-###` target defines the expected UI? |
| Actor | Who or what performs it? |
| Preconditions / Fixture | What data, auth, permissions, flags, clock, files, mocks, or external state are required? |
| State | Which UI/system state is under test? |
| Operation | What exact action is performed? |
| Locator Strategy | How automation finds the target: role, label, test id, selector, command, API route, or hook. |
| Expected UI Result | What visible, accessible, or interaction result must happen? |
| Expected System Result | What data, API, event, job, file, notification, audit, or no-op result must happen? |
| Visual Assertion | What rendered layout, state, text fitting, overflow, contrast, focus, or screenshot assertion proves UI delivery? |
| Automation Level | Unit, component, widget, browser, API, integration, E2E, device, contract, visual, accessibility, performance, security. |
| Assertion Oracle | Exact assertion that would fail when behavior is wrong. |
| Evidence | Test name, artifact path, log query, screenshot, trace, report, or TODO. |
| Status | `todo`, `pass`, `blocked`, `not-applicable`, or project-local equivalent. |

## 8. Traceability Ledger Template

Create this table in `docs/coverage/traceability-ledger.md`. It is the consumer-readiness gate across product, design, implementation, and QA.

| Field | Required question |
| --- | --- |
| Ledger Row ID | What stable row ID identifies this chain, such as `TL-001`? |
| Workflow IDs | Which `F-###` workflows are covered? |
| UI IDs | Which `SURF`, `PAGE`, `REG`, `CMP`, `CTRL`, `STATE`, and `NAV` IDs expose the workflow? |
| Design IDs | Which `DHI`, existing Figma/Stitch nodes, screenshots, or baselines cover the UI? |
| Acceptance IDs | Which `OP`, `RES`, `VIS`, and `TM` rows verify the workflow and UI? |
| Consumer Readiness | Is this `ready-for-design`, `ready-for-automation`, `wysiwyg-complete`, `partial`, `blocked`, or `excluded`? |
| Missing Input | What exact field, fixture, locator, prompt, asset, design source, state, or oracle is still missing? |
| Owner / Next Consumer | Which next worker or skill should consume this row: Stitch, Figma, product-design, implementation, QA automation, reviewer? |
| Evidence | What source file, design output, screenshot, trace, test, or review artifact proves the status? |

## 9. Code Coverage Checklist

Before the package is considered usable for downstream design and automated validation:

- Every page/screen/view/dialog/route has a `PAGE-###` code.
- Every reusable or meaningful component has a `CMP-###` code.
- Every actionable input/control/menu/link/shortcut/gesture has a `CTRL-###` code.
- Every visible, hidden, conditional, error, loading, empty, disabled, permission, success, conflict, or timeout state has a `STATE-###` code when it changes behavior or assertions.
- Every navigation path, redirect, tab switch, back path, deep link, modal open/close, and guarded route has a `NAV-###` code.
- Every design-consumption target needed by a downstream design skill has a `DHI-###` code.
- Every user/system/background/integration operation has an `OP-###` code.
- Every expected UI result and every expected system side effect has a `RES-###` code.
- Every visual/layout/accessibility delivery requirement has a `VIS-###` code or is explicitly marked non-visual.
- Every user-visible UI node has a Figma/Stitch/design source, accepted visual baseline, completed design-skill output, or explicit design-consumption target.
- Every `DHI-###` row has versioned title, target tool/action, viewport, related coverage IDs, layout/content/state requirements, design-system constraints, assets, acceptance hooks, and tool-ready prompt.
- Every test matrix row has a `TM-###` code.
- Every UI interaction tree line shows same-level trace fields for component/control, state, operation, UI result, backend/session result, navigation, visual delivery, design target, and test matrix row.
- Every acceptance automation row references the relevant codes instead of only prose labels.
- Every traceability ledger row names consumer readiness and the exact missing input when incomplete.

## 10. Coverage Closure Checklist

Use this checklist before claiming the package is complete:

- All actors have at least one workflow.
- All workflows have success, cancellation where relevant, and critical failure paths.
- All screens or interfaces have UI interaction tree nodes.
- All actionable controls have acceptance rows.
- All pages, components, states, operation results, backend/session results, navigation paths, and test matrix rows have stable codes.
- All user-visible pages, critical states, operation results, component boards, and navigation targets that require design coverage have `DHI-###` design-consumption rows.
- All user-visible workflows have visual delivery requirements and render evidence before they are marked implemented.
- All user-visible workflows can be compared against a design source, accepted visual baseline, or completed design-skill output before they are marked WYSIWYG-complete; otherwise they remain design-consumption-ready only.
- All display-only nodes are marked display-only or tied to a verification assertion.
- All mutating operations have system-result assertions.
- All async operations have pending, completion, failure, and retry or cancellation coverage.
- All permission boundaries have allowed and denied cases.
- All external integrations have success, unavailable, auth failure, and data mismatch cases where applicable.
- All destructive actions have confirmation and post-condition coverage.
- All import/export/upload/download flows verify both UI and produced/consumed artifact.
- All generated or dynamic UI has representative content, empty, malformed, and unknown-type coverage.
- All automation rows name locators or identify missing locator work.
- All UI delivery rows name viewport/surface assumptions and a visual/accessibility assertion.

## 11. Automation Backlog Derivation

After the acceptance automation contract is complete, derive test work in this order. Each step must be done before the next to avoid investing in high-level automation without foundational stability:

1. **Add stable locators and test hooks** — stable selectors make all other steps reliable.
2. **Create fixtures and seed data** — each precondition class needs deterministic data before any test can run repeatably.
3. **Automate pure logic and contract assertions** — these are fastest to write, fastest to run, and catch the most regressions per line of code.
4. **Automate component or screen behavior** — covers UI states and validation closest to where the behavior is rendered.
5. **Automate visual, accessibility, and responsive assertions** — covers every `VIS-###` requirement; run after behavior is stable.
6. **Automate E2E/device/browser paths** — critical cross-boundary workflows only; these are slowest and should not substitute for lower-level tests.
7. **Capture evidence** — screenshots, traces, logs, exported artifacts, or state snapshots that prove the assertion ran.
8. **Keep blocked rows visible** — do not remove or hide blocked rows until the blocker is resolved or the scope is explicitly changed.
