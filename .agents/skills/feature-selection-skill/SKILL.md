---
name: feature-selection-skill
description: "Select the next executable Feature Spec for autonomous execution by reasoning over Feature Pool Queue order, dependencies, spec-state, recent execution results, operator resume/skip hints, and blocked or approval states. Use when the scheduler needs a decision for select_next_feature before creating a feature_execution job."
---

# Feature Selection Skill

Use this skill when the scheduler must choose the next Feature Spec to run from the Feature Spec Pool.

## Workflow

1. Read the provided `feature-pool-queue.json` entries, Feature index snapshot, each Feature `spec-state.json`, recent Execution Records, and operator hints such as resume or skip.
2. Exclude Features that are missing `requirements.md`, `design.md`, or `tasks.md`.
3. Exclude Features whose dependencies are not completed.
4. Exclude `blocked`, `failed`, `review_needed`, or `approval_needed` Features unless the input explicitly resumes that Feature.
5. Exclude Features with active `queued`, `running`, or `approval_needed` `feature_execution` records for the same project.
6. Prefer the highest-priority runnable Feature, but use reasoning to account for stale states, explicit skips, completed dependencies, and recent terminal execution results.
7. Return a single decision. Do not create jobs, edit files, write state, or mark Features done.

## Output Contract

Return exactly one `SkillOutputContractV1` JSON object matching the invocation contract.

Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md`. `summary` must state the selected Feature, no-op decision, or blocking reason. `nextAction` must tell the scheduler whether to enqueue a Feature execution, wait, ask for resume, or route review.

## Specialized Result Contract

For `requestedAction = "select_next_feature"`, the `result` object must contain:

- `decision`: `"selected"`, `"none"`, or `"blocked"`.
- `featureId`: the selected `FEAT-*` id when `decision` is `"selected"`.
- `reason`: concise explanation for the decision.
- `blockedReasons`: array of blocking reasons.
- `dependencyFindings`: array summarizing dependency status.
- `resumeRequiredFeatures`: array of Feature ids that require explicit resume.
- `skippedFeatures`: array of Feature ids skipped by operator instruction.

Use `status = "completed"` when the selection decision is valid, even if `decision` is `"none"` or `"blocked"`. Use `status = "blocked"` only when the selection input is unreadable or contradictory.

## Safety Rules

- Never select a Feature outside the supplied Feature Pool Queue.
- Never select a Feature only because it appears in SQLite; Feature identity comes from the Feature index and Feature Spec directory.
- Never bypass approval pending, review needed, blocked, or failed states without an explicit resume hint.
- If multiple Features appear runnable, choose one and explain why it is better than the alternatives.
