# SkillOutputContractV1

All project-local skills must return exactly one `SkillOutputContractV1` JSON object when invoked by the Scheduler, CLI Adapter, RPC Adapter, or Execution Workbench.

The common contract is optimized for the Execution Workbench display:

- `contractVersion`: always `"skill-contract/v1"`.
- `executionId`: echo the invocation `executionId`.
- `skillSlug`: echo the invocation `skillSlug`.
- `requestedAction`: echo the invocation `requestedAction`.
- `status`: one of `"completed"`, `"review_needed"`, `"blocked"`, or `"failed"`.
- `summary`: concise human-readable execution summary. This is shown in Current Execution and Result Projection, so it must state the outcome, not only the process.
- `nextAction`: the recommended next scheduler/operator action as a string, or `null` when no follow-up is needed.
- `producedArtifacts`: every created, updated, unchanged, missing, or skipped expected artifact. Each item must include `path`, `kind`, `status`, `checksum` (`string` or `null`), and `summary` (`string` or `null`).
- `traceability`: echo invocation traceability with `featureId`, `taskId`, `requirementIds`, and `changeIds`.
- `result`: skill-specific machine-readable execution result. Use `{}` only when the skill has no specialized result fields.

Do not add extra top-level fields. Put command output, verification details, decisions, blockers, coverage, and execution results in `summary`, `producedArtifacts[].summary`, `nextAction`, or `result`.

Use `status = "completed"` when the skill produced a valid decision or artifact, even if the decision is "none" or "no change". Use `status = "blocked"` for missing inputs or unresolved required decisions, `status = "review_needed"` when a human or risk review must resolve the next step, and `status = "failed"` for execution errors that prevented a valid skill result.
