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
- `traceability`: echo invocation-owned traceability with `featureId` and `requirementIds`; manage `changeIds` inside the skill from the source documents and return the applicable IDs, or `[]` when none apply. Do not include `taskId` in the common Skill output contract; Feature-level executions often have no task target.
- `result`: skill-specific machine-readable execution result. Use `{}` only when the skill has no specialized result fields.

Do not add extra top-level fields. Put command output, verification details, decisions, blockers, coverage, and execution results in `summary`, `producedArtifacts[].summary`, `nextAction`, or `result`.

Use `status = "completed"` when the skill produced a valid decision or artifact, even if the decision is "none" or "no change". Use `status = "blocked"` for missing inputs or unresolved required decisions, `status = "review_needed"` when a human or risk review must resolve the next step, and `status = "failed"` for execution errors that prevented a valid skill result.

Do not return shorthand JSON such as `{"summary": "...", "status": "...", "evidence": [...]}`. The final response must be the complete contract object below, with invocation-owned fields echoed exactly:

```json
{
  "contractVersion": "skill-contract/v1",
  "executionId": "<echo invocation.executionId>",
  "skillSlug": "<echo invocation.skillSlug>",
  "requestedAction": "<echo invocation.requestedAction>",
  "status": "completed",
  "summary": "<concise outcome summary>",
  "nextAction": null,
  "producedArtifacts": [
    {
      "path": "<relative/path>",
      "kind": "markdown",
      "status": "updated",
      "checksum": null,
      "summary": "<artifact-specific summary>"
    }
  ],
  "traceability": {
    "featureId": null,
    "requirementIds": [],
    "changeIds": []
  },
  "result": {}
}
```
