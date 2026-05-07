# SkillOutputContractV1

Project-local skills may stream `SkillOutputContractV1` JSON objects while invoked by the Scheduler, CLI Adapter, RPC Adapter, or Execution Workbench. The final result must be the last valid `SkillOutputContractV1` object in the stream.

The common contract is optimized for the Execution Workbench display:

- `contractVersion`: always `"skill-contract/v1"`.
- `executionId`: echo the invocation `executionId`.
- `skillSlug`: echo the invocation `skillSlug`.
- `requestedAction`: echo the invocation `requestedAction`.
- `status`: one of `"queued"`, `"running"`, `"waiting_input"`, `"approval_needed"`, `"review_needed"`, `"blocked"`, `"failed"`, `"cancelled"`, or `"completed"`.
- `summary`: concise human-readable execution summary. This is shown in Current Execution and Result Projection, so it must state the outcome, not only the process.
- `nextAction`: the recommended next scheduler/operator action as a string, or `null` when no follow-up is needed.
- `producedArtifacts`: every created, updated, unchanged, missing, or skipped expected artifact. Each item must include `path`, `kind`, `status`, `checksum` (`string` or `null`), and `summary` (`string` or `null`).
- `traceability`: include only Feature-level traceability with `featureId`. Do not include `requirementIds`, `taskId`, `changeIds`, or task/package-level tracking in the common Skill output contract.
- `result`: skill-specific machine-readable execution result. Use `{}` only when the skill has no specialized result fields.

Do not add extra top-level fields. Put command output, verification details, decisions, blockers, coverage, and execution results in `summary`, `producedArtifacts[].summary`, `nextAction`, or `result`.

Use `status = "queued"` before execution starts, `status = "running"` while reading, analyzing, writing, or verifying, `status = "waiting_input"` when user information is required, and `status = "approval_needed"` when command, permission, or risk approval is required. Final status must be `completed`, `review_needed`, `blocked`, `failed`, or `cancelled`. Use `status = "completed"` when the skill produced a valid decision or artifact, even if the decision is "none" or "no change". Use `status = "blocked"` for missing inputs or unresolved required decisions, `status = "review_needed"` only when a real human or risk review gate must resolve the next step, and include the review reason in `summary` or `result.reviewNeededReason`. Use `status = "failed"` for execution errors that prevented a valid skill result.

Do not return shorthand JSON such as `{"summary": "...", "status": "...", "evidence": [...]}`. Any progress or final response must be the complete contract object below, with invocation-owned execution fields echoed exactly. Progress objects must not use `review_needed` as a placeholder for work in progress.

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
    "featureId": null
  },
  "result": {}
}
```
