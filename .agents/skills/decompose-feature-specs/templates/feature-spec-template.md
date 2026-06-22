# Feature Spec Output Template

Use this template as a contract, not as an example. Generated Feature Specs must keep the file names and task block structure exactly parseable.

## Directory Contract

Create or update one directory per Feature:

```text
docs/agentic-spec/features/feat-<nnn>-<kebab-title>/
  requirements.md
  design.md
  tasks.md
  spec-state.json
```

Also update:

```text
docs/agentic-spec/features/README.md
docs/agentic-spec/features/feature-pool-queue.json
```

Rules:

- The folder name must start with lowercase `feat-<nnn>-`.
- Do not generate alternate file names such as `requirement.md`, `task.md`, `taskes.md`, `plan.md`, `implementation.md`, `feature.md`, or nested task files.
- `requirements.md`, `design.md`, and `tasks.md` are mandatory before a Feature can be marked `ready`.
- `tasks.md` must contain at least one parser-compatible task heading matching `### TASK-<nnn>: <title>` or `### T-<feature-nnn>-<task-nn>: <title>`.
- `tasks.md` must declare a Feature-level `Worktree Mode` and every write-capable task must either inherit it or override it explicitly.
- `docs/agentic-spec/features/README.md` must use a parser-compatible index table whose first column is `Feature ID`; do not put `Order`, `#`, or any other column before `Feature ID`.
- The index table `Folder` column must contain only the folder basename, such as `feat-001-example`, not `docs/agentic-spec/features/feat-001-example`.

## Worktree Mode Values

- `feature-worktree`: default for implementation Features; `implement-feature` owns one Feature worktree, branch, PR, merge, and cleanup lifecycle.
- `worker-worktree`: Feature-internal parallel write task or task group; worker branches merge back to the Feature branch before the Feature PR is delivered.
- `serial-owner`: high-conflict writes run serially in the Feature owner worktree; use for lockfiles, migrations, shared configuration, broad refactors, or other merge-sensitive areas.
- `shared-readonly`: read-only planning, review, analysis, or verification that must not write files.
- `manual-gated`: Git lifecycle or write execution requires explicit human approval before worktree creation, merge, cleanup, or other side effects.

## docs/agentic-spec/features/README.md

```markdown
# Feature Spec Index

| Feature ID | Feature | Folder | Status | Primary Requirements | Suggested Milestone | Dependencies | Notes |
|---|---|---|---|---|---|---|---|
| FEAT-<NNN> | <Title> | `feat-<nnn>-<kebab-title>` | draft | REQ-<NNN> | M1 | none | <Short routing note> |
```

Rules:

- Keep `Feature ID` as the first column so IDE and scheduler parsers can identify entries.
- Keep `Folder` as a basename that exists directly under `docs/agentic-spec/features/`.
- Keep status values aligned with `spec-state.json`.

## requirements.md

```markdown
# Feature Spec: FEAT-<NNN> <Title>

## Metadata

- Feature ID: FEAT-<NNN>
- Folder: docs/agentic-spec/features/feat-<nnn>-<kebab-title>
- Status: draft | review_needed | ready
- Priority: Must | Should | Could
- Source Requirements:
  - REQ-<NNN>
- Dependencies:
  - FEAT-<NNN> | none

## Goal

<One vertical, testable user/business outcome.>

## Scope

### In Scope

- <Concrete behavior included in this Feature.>

### Out of Scope

- <Concrete behavior deferred elsewhere.>

## Requirements

| ID | Source | Statement | Acceptance | Evidence |
|---|---|---|---|---|
| FEAT-<NNN>-REQ-001 | REQ-<NNN> | When <condition>, the system shall <observable behavior>. | <Pass/fail criterion> | <test/evidence artifact> |

## Traceability

| Source Requirement | Feature Requirement | Design Section | Task | Verification |
|---|---|---|---|---|
| REQ-<NNN> | FEAT-<NNN>-REQ-001 | design.md#<section-anchor> | TASK-001 | <command or evidence> |

## UI Traceability

Required when this Feature creates, changes, or verifies UI behavior. Use `N/A - non-UI Feature` only when no user-facing UI, UI host, prototype, view model, settings surface, browser/runtime flow, or interaction evidence is affected.

| UI Surface / Workflow | UI Spec Reference | Feature Requirement | Required Interaction Evidence |
|---|---|---|---|
| <surface/workflow id> | docs/agentic-spec/ui/ui-spec.md#<anchor> | FEAT-<NNN>-REQ-001 | <browser action, state change, reload/revisit, negative path> |

## UI Coverage Contract

Required for UI / App / IDE-Webview Features. Use `N/A - non-UI Feature` with a brief explanation for non-UI Features.

| Field | Value |
|---|---|
| Coverage Path | `docs/agentic-spec/ui/coverage/` |
| DHI References | DHI-<###>, DHI-<###> (from `coverage/design-consumption.md`) |
| TM References | TM-<###>, TM-<###> (from `coverage/acceptance-automation.md`) |
| Design Status | `ready-for-design` \| `designed` \| `wysiwyg-complete` \| `blocked` |
| Stitch Screen IDs | (filled by `stitch-design-coverage` after Stitch generation) |

Rules:

- Feature cannot be marked `ready` unless at least one `DHI-###` and one `TM-###` reference exist.
- `Design Status` must reach `designed` before feature execution begins.
- `Stitch Screen IDs` are filled by `stitch-design-coverage` and must be present before `verify-behavior` runs for this Feature.
```

## design.md

```markdown
# Design: FEAT-<NNN> <Title>

## Metadata

- Feature ID: FEAT-<NNN>
- Status: draft | review_needed | ready
- Related Requirements:
  - FEAT-<NNN>-REQ-001

## Design Summary

<Implementation approach scoped to this Feature.>

## Data and State

- Fact source: <file/db/table/api>
- State transitions: <from -> to>

## Interfaces

- Input: <contract/path/command>
- Output: <contract/path/artifact>

## UI Interaction Contract

Use this section when the Feature affects any UI. If the Feature is non-UI, write `N/A - non-UI Feature` and explain why.

| Workflow | Entry | Actor | Controls / Fields | User Action | Validation | Save / Cancel | State Feedback | Persisted / Revisit Assertion | Error Path | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| <workflow id> | <command/view/button> | <user role> | <field/control list> | <observable action> | <validation rule> | <save/cancel behavior> | <loading/success/failure feedback> | <reload/reopen assertion> | <negative path> | <browser/runtime evidence> |

Rules:

- UI/App Features must reference `docs/agentic-spec/ui/ui-spec.md` or a feature-scoped UI Spec/prototype.
- Page names, routes, headings, screenshots, concept images, API tests, or entry/text assertions are not enough for UI readiness.
- The interaction contract must include real user action, state change, persistence or reload/revisit behavior, and at least one negative or blocked path.

## Implementation Plan

- <Concrete module/path change.>

## Risks and Controls

- Risk: <risk>
- Control: <control>

## Verification Design

- <Test/evidence strategy mapped to requirements.>
- For UI/App Features, include browser-visible evidence for user action, state change, reload/revisit assertion, negative path, and screenshot/trace/log references.
```

## tasks.md

```markdown
# Tasks: FEAT-<NNN> <Title>

## Metadata

- Feature ID: FEAT-<NNN>
- Status: draft | ready | in-progress | done
- Priority: Must | Should | Could
- Depends On:
  - FEAT-<NNN> | none
- Adapter: codex-cli | cli | rpc | mcp | sandbox | manual
- Worktree Mode: feature-worktree | worker-worktree | serial-owner | shared-readonly | manual-gated
- Approval Required: true | false

## Tasks

### TASK-001: <Imperative task title>
Status: todo
Worktree Mode: inherit | feature-worktree | worker-worktree | serial-owner | shared-readonly | manual-gated
Description: <One concrete implementation or spec task.>
Requirements:
- FEAT-<NNN>-REQ-001
Spec Refs:
- docs/agentic-spec/features/feat-<nnn>-<kebab-title>/requirements.md#<anchor>
- docs/agentic-spec/features/feat-<nnn>-<kebab-title>/design.md#<anchor>
Allowed Paths:
- <path/glob>
Forbidden Paths:
- <path/glob> | none
Verification: <command or evidence>
Acceptance:
- [ ] <Observable completion criterion>

### TASK-002: <Imperative task title>
Status: todo
Worktree Mode: inherit | feature-worktree | worker-worktree | serial-owner | shared-readonly | manual-gated
Description: <One concrete implementation or verification task.>
Requirements:
- FEAT-<NNN>-REQ-001
Spec Refs:
- docs/agentic-spec/features/feat-<nnn>-<kebab-title>/requirements.md#<anchor>
- docs/agentic-spec/features/feat-<nnn>-<kebab-title>/design.md#<anchor>
Allowed Paths:
- <path/glob>
Forbidden Paths:
- <path/glob> | none
Verification: <command or evidence>
Acceptance:
- [ ] <Observable completion criterion>

## Journey Checkpoints

- [ ] Primary user journey has a requirement row, design path, task block, and evidence plan.
- [ ] Failure or edge path has a requirement row, design path, task block, and evidence plan.
- [ ] Every `TASK-*` has Requirements, Spec Refs, Allowed Paths, Worktree Mode, Verification, and Acceptance fields.
- [ ] Write-capable tasks use `feature-worktree`, `worker-worktree`, `serial-owner`, or `manual-gated`; read-only tasks use `shared-readonly`.
- [ ] **UI/App Features only**: UI Coverage Contract section in `requirements.md` lists at least one `DHI-###` and one `TM-###` reference.
- [ ] **UI/App Features only**: A `TASK-###: Verify UI Deliverability Gate` task block exists and checks `DHI-###` design status and `TM-###` oracle completeness before allowing Feature execution.
- [ ] **UI/App Features only**: `spec-state.json` includes a non-null `uiDesignRef` object with `coveragePath`, `dhiRefs`, and `tmRefs` populated.
```

## spec-state.json

```json
{
  "featureId": "FEAT-<NNN>",
  "status": "ready",
  "worktreeMode": "feature-worktree",
  "executionStatus": null,
  "blockedReasons": [],
  "nextAction": "Schedule feature execution.",
  "updatedAt": "<ISO-8601>",
  "uiDesignRef": {
    "coveragePath": "docs/agentic-spec/ui/coverage",
    "dhiRefs": ["DHI-<###>"],
    "tmRefs": ["TM-<###>"],
    "designStatus": "ready-for-design",
    "stitchScreenIds": []
  },
  "history": [
    {
      "at": "<ISO-8601>",
      "status": "ready",
      "summary": "Feature Spec created from fixed template.",
      "source": "decompose-feature-specs"
    }
  ]
}
```

Rules:

- For non-UI Features, set `"uiDesignRef": null` and add `"uiDesignRefExemption": "<reason>"` at the top level.
- `designStatus` transitions: `ready-for-design` → `designed` (set by `stitch-design-coverage`) → `wysiwyg-complete` (set after visual verification).
- `stitchScreenIds` is filled by `stitch-design-coverage` and must be non-empty before `verify-behavior` is allowed to run for UI-type Features.
