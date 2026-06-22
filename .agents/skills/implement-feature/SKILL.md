---
name: implement-feature
description: "Implement bounded Feature Spec work. Use when a scheduled Feature has approved requirements, design constraints, Worktree Mode, allowed file scope, source paths, and verification commands, and Codex must modify code, tests, config, or docs through the governed worktree lifecycle."
---

# Feature Implementation

## Workflow

1. Confirm the requested outcome, source artifacts, workspace root, and allowed scope.
2. Read referenced files from disk and pass paths, IDs, and section anchors instead of pasted document bodies.
3. Apply this skill's workflow only to its declared responsibility; route adjacent lifecycle work to another project skill.
4. Produce or review the requested artifacts with traceability to PRD, requirements, HLD, Feature Spec, execution records, tests, or evidence as applicable.
5. Return the runtime-supplied structured output shape exactly. Echo `executionId`, `skillName`, `requestedAction`, produced artifacts, next action, and Feature-level traceability when the adapter provides them.

## Product Usability Autonomy Wrapper

Apply FEAT-024 Product Usability Autonomy when this skill affects P0/P1 user stories, lifecycle handoffs, execution readiness, verification, review, or completion decisions.

Required wrapper fields:

- Source refs: list the PRD, requirements, HLD, UI Spec, Feature Spec, tasks, code, tests, or ReviewItems consumed.
- Lifecycle stage: name Define, Plan, Build, Verify, Review, or Ship.
- Decision policy: record safe automatic decisions as `DecisionLog`; record medium-risk ambiguity as Open Questions; record high-risk ambiguity as Blocking Open Questions.
- Protocol gaps: classify missing source, story, journey, interaction, state/data, test, runtime, review, and ship evidence as `ProtocolGap`.
- Usability evidence: preserve or produce `UsabilityEvidence` for P0/P1 stories affected by the skill.
- Handoff readiness: state whether downstream work may continue and which `LifecycleHandoff` obligations are preserved.
- Anti-rationalization: do not mark work ready or completed only because text, fixtures, API seeds, self-review, or command success exists.

## Guidance

Read the Feature Spec, preserve unrelated changes, honor its declared `Worktree Mode`, implement the smallest complete behavior slice, collect protocol-backed completion evidence for affected P0/P1 stories, collect Delivery Fidelity and Git delivery evidence, and avoid self-approving completion.

When `Worktree Mode` is missing, return `review_needed` or `clarification_needed` for write-capable work instead of silently writing in the owner workspace. Use `shared-readonly` only for tasks that do not modify files. Use `serial-owner` for high-conflict writes, `feature-worktree` for the default one-Feature-one-PR lifecycle, `worker-worktree` for Feature-internal parallel write tasks that merge back to the Feature branch, and `manual-gated` when Git lifecycle side effects require explicit approval.

## Worktree Lifecycle

Use the project-local worktree skills as the Git lifecycle boundary:

1. Use `$setup-worktree` before any write-capable implementation, verification write, or Git delivery step.
2. Do not ask platform code, scheduler code, IDE code, or adapters to modify project files before `$setup-worktree` has returned an implementation workspace. Before setup, code may record database rows, queue events, logs, or read-only evidence only.
3. Perform implementation, task status edits, `spec-state.json` edits, tests that write artifacts, and docs/code changes inside the returned implementation workspace, not in the owner workspace, unless `Worktree Mode` explicitly allows `serial-owner`. Runtime state changes are allowed during execution, but file-backed Feature state for `feature-worktree` or `worker-worktree` must be written to the active worktree so Git captures it on the feature branch.
4. Use `$clean-worktree` after implementation, tests, and independent review evidence are ready.
5. After `$clean-worktree` reports branch/worktree cleanup as complete, do not ask platform code to patch project files or owner-workspace Feature Specs. Any final delivery facts after cleanup must be returned as structured `gitDelivery`, review, report, or database evidence.
6. If worktree setup, review, PR, merge, branch cleanup, or worktree cleanup cannot cleanly finish, return `review_needed`, `approval_needed`, or `blocked`; do not return `completed`.

## Long-Running Execution and Context Budget

Default to a delegated, checkpointed execution model for long-running or context-heavy Feature implementation. The owner thread owns lifecycle coordination, integration, final evidence, and Git delivery; CLI-native subagents own bounded implementation, verification, review, or repair slices when the runtime exposes them.

1. For write-capable worktree modes, call `$setup-worktree` before creating or updating any project file checkpoint. Use `.autobuild/runs/<executionId>/checkpoint.json` only inside the active implementation workspace, or use runtime database/log evidence when setup has not completed yet.
2. Keep the checkpoint compact and machine-readable: source refs, Feature Spec path, Worktree Mode, current stage, task slices, delegated roles, worker result refs, changed files, verification evidence, review evidence, `gitDelivery`, and next action.
3. Slice work from `tasks.md` into independent worker scopes when files, dependencies, and runtime state allow it. Use `worker-worktree` for parallel write slices; use `serial-owner` for high-conflict files, migrations, lockfiles, shared configuration, or broad refactors.
4. Dispatch real CLI-native subagents for eligible worker, verifier, reviewer, or repair slices. Give each subagent only paths, IDs, allowed files, verification commands, and the expected compact result. Do not paste full source documents into the prompt.
5. If the runtime cannot create a real subagent, run the slice in the owner thread, record `fallbackReason`, and still update the checkpoint. Do not claim subagent activation from a plan or JSON record alone.
6. After each slice, merge only compact results into the owner context and persist detailed evidence as files or command refs. Do not rely on chat history to remember task state.
7. After context compaction, resume by reading `AGENTS.md`, this skill, the Feature Spec files, and the checkpoint before continuing. Treat the checkpoint plus repository state as the execution memory.
8. The owner thread must reconcile worker outputs, run required verification after integration, route independent review/fix work, and call `$clean-worktree` only after implementation, tests, review, Delivery Fidelity, and Journey Closure evidence are ready.

## Live Task Status Writeback

During `feature_execution`, this skill owns the primary live task status writeback. The scheduler, IDE, or status-checker may patch terminal state as a fallback only when it can target the active implementation workspace after setup and before cleanup; they must not be the normal path for per-task progress.

- Before starting a task slice from `tasks.md`, update that task block in the active Feature Spec `tasks.md` to `Status: running`. Use the version in the `implementationWorkspace` if one is active; otherwise use the `ownerWorkspace`.
- When the task slice is complete and its required verification/evidence has passed, update that task block to `Status: done` in the same active workspace.
- If the task cannot continue, update it to the narrowest truthful status: `blocked`, `review_needed`, `approval_needed`, or `failed` in the active workspace.
- Ensure that any `spec-state.json` updates also target the active workspace to prevent spec drift between the feature branch and the owner workspace. **For completed Feature execution, ensure that `spec-state.json` is updated to `completed` within the `implementationWorkspace` BEFORE calling `$clean-worktree`.**
- Do not rely on scheduler, IDE, status-checker, or adapter code to create the normal `running`, `done`, `completed`, or `review_needed` file edits before setup or after cleanup. Those code paths are fallback projections only; when they run for worktree modes, they must write to the active `implementationWorkspace` and may intentionally skip filesystem writes when no active implementation workspace exists.
- For delegated worker slices, the owner thread writes the status when the worker starts and reconciles it after the worker result; workers may report suggested statuses but must not be the only source of truth.
- Update `.autobuild/runs/<executionId>/checkpoint.json` after each status change when an `executionId` exists, but do not use the checkpoint as a substitute for the visible `tasks.md` status.
- Preserve parser-compatible task headings and `Status:` lines. Do not place extra `TASK-*` tokens in checklist prose where the task parser could treat them as separate tasks.
- Keep task status and lifecycle edits scoped to the active Feature Spec in the correct workspace. Do not rewrite unrelated requirements, design, spec-state, or sibling Feature task files while reporting progress. Avoid "leaking" these updates into the `ownerWorkspace` when a `feature-worktree` or `worker-worktree` is active.

## Feature Execution Rules

- Treat the Feature Spec directory in `sourcePaths` as the implementation scope.
- Read `requirements.md`, `design.md`, and `tasks.md`, then implement the concrete tasks described there.
- Do not satisfy `feature_execution` by only creating a report JSON file or by only summarizing planned work.
- If the Feature Spec tasks cannot be implemented from the available source paths, return `blocked` with the missing decision or file scope.
- List the actual code, test, config, or documentation files created or updated in `producedArtifacts`.
- Completed `feature_execution` outputs must use `skill-contract/v2`.
- Put `requirementCoverage`, `acceptanceEvidence`, `journeyEvidence`, `deliveryFidelity`, and `gitDelivery` directly under `result`.
- For UI/app changes, provide `runtimeEvidence`; use `runtimeExemption` only for explicit foundation or stateless cases with evidence.
- Passing tests or a commit alone is not enough for `completed`; close Journey Checkpoint, Delivery Fidelity, and Git delivery, or return the appropriate non-completed status.

## Delivery Evidence

For completed Feature execution, `result.gitDelivery` must include:

- `ownerWorkspace`
- `implementationWorkspace`
- `worktree`
- `branch`
- `commitHash`
- `prUrl`
- `checks`
- `merge`
- `remoteBranchCleanup`
- `localBranchCleanup`
- `worktreeCleanup`
- `deliveryExemption`

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions as `clarification_needed`, `review_needed`, `risk_review_needed`, or `blocked` instead of inventing facts.
