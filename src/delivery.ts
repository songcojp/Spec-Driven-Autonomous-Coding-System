import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { recordAuditEvent, recordMetricSample } from "./persistence.ts";
import { transitionFeature, type StateTransition } from "./orchestration.ts";
import { runSqlite, type SqlStatement } from "./sqlite.ts";

export type DeliveryGateStatus = "ready" | "blocked" | "review_needed";
export type PullRequestStatus = "created" | "request_prepared" | "blocked";
export type DeliveryReportStatus = "created" | "blocked";
export type GhRunner = (command: string, args: string[], cwd: string) => GhRunnerResult;

export type GhRunnerResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type DeliveryEvidenceRef = {
  id: string;
  kind: string;
  path?: string;
  summary: string;
};

export type DeliveryTaskRef = {
  id: string;
  title: string;
  status: string;
};

export type DeliveryRequirementRef = {
  id: string;
  sourceId?: string;
  body?: string;
};

export type DeliveryApprovalRef = {
  id: string;
  reviewItemId: string;
  decision: string;
  reviewStatus?: string;
  actor?: string;
  reason?: string;
};

export type DeliveryReviewItemRef = {
  id: string;
  status: string;
  reviewNeededReason?: string;
};

export type DeliveryTestResult = {
  id?: string;
  command?: string;
  status: string;
  summary: string;
  evidenceRef?: string;
};

export type RollbackPlan = {
  worktreeId?: string;
  branch: string;
  baseCommit: string;
  rollbackCommand: string;
  summary: string;
};

export type SpecEvolutionInput = {
  reason: string;
  suggestion: string;
  sourceEvidenceRefs: string[];
  impactScope: string[];
};

export type DeliveryGateInput = {
  featureId: string;
  featureTitle: string;
  featureStatus: string;
  requirements: DeliveryRequirementRef[];
  tasks: DeliveryTaskRef[];
  evidence: DeliveryEvidenceRef[];
  approvals: DeliveryApprovalRef[];
  openReviewItems?: DeliveryReviewItemRef[];
  tests: DeliveryTestResult[];
  mergeReady: boolean;
  rollbackPlan?: RollbackPlan;
};

export type DeliveryGateResult = {
  status: DeliveryGateStatus;
  reasons: string[];
  missing: string[];
};

export type DeliveryPackageInput = {
  dbPath: string;
  artifactRoot: string;
  repositoryPath: string;
  featureId: string;
  featureTitle: string;
  baseBranch: string;
  headBranch: string;
  changedFiles: string[];
  risks?: string[];
  nextSteps?: string[];
  specEvolution?: SpecEvolutionInput[];
  mode?: "create-pr" | "prepare-request";
  now?: Date;
  ghRunner?: GhRunner;
};

export type PullRequestRecord = {
  id: string;
  featureId: string;
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
  url?: string;
  status: PullRequestStatus;
  requirements: string[];
  tasks: string[];
  evidenceRefs: string[];
  approvalRefs: string[];
  rollbackPlan: RollbackPlan;
  riskItems: string[];
  createdAt: string;
};

export type SpecEvolutionSuggestion = {
  id: string;
  featureId: string;
  sourceEvidenceRefs: string[];
  impactScope: string[];
  reason: string;
  suggestion: string;
  status: "proposed";
  createdAt: string;
};

export type DeliveryReport = {
  id: string;
  featureId: string;
  path: string;
  summary: string;
  body: string;
  status: DeliveryReportStatus;
  pullRequestRecordId?: string;
  changedFiles: string[];
  acceptanceResults: string[];
  testSummary: string[];
  recoveryRecords: string[];
  riskItems: string[];
  nextSteps: string[];
  specEvolutionSuggestionIds: string[];
  createdAt: string;
};

export type DeliveryPackage = {
  gate: DeliveryGateResult;
  pullRequest?: PullRequestRecord;
  report: DeliveryReport;
  specEvolutionSuggestions: SpecEvolutionSuggestion[];
  transition?: StateTransition;
};

export function evaluateDeliveryGate(input: DeliveryGateInput): DeliveryGateResult {
  const missing: string[] = [];
  const reasons: string[] = [];
  const testsPassed = input.tests.length > 0 && input.tests.every((test) => test.status === "passed");
  const tasksDone = input.tasks.length > 0 && input.tasks.every((task) => task.status === "done");
  const positiveApproval = (input.openReviewItems ?? []).length === 0 && hasCurrentPositiveApproval(input.approvals);

  if (input.featureStatus !== "done") missing.push("feature_done");
  if (input.requirements.length === 0) missing.push("requirements");
  if (input.tasks.length === 0) missing.push("tasks");
  if (!tasksDone) missing.push("all_tasks_done");
  if (input.evidence.length === 0) missing.push("evidence");
  if (!testsPassed) missing.push("passing_tests");
  if (!positiveApproval) missing.push("approval");
  if (!input.mergeReady) missing.push("merge_readiness");
  if (!input.rollbackPlan) missing.push("rollback_plan");

  if (missing.length === 0) {
    return {
      status: "ready",
      reasons: ["Feature has done status, traceable evidence, passing tests, approval, merge readiness, and rollback plan."],
      missing,
    };
  }

  if (missing.includes("approval") || missing.includes("merge_readiness")) {
    reasons.push("Delivery needs review because approval or merge readiness is incomplete.");
    return { status: "review_needed", reasons, missing };
  }

  reasons.push("Delivery is blocked because required delivery evidence is incomplete.");
  return { status: "blocked", reasons, missing };
}

export function createDeliveryPackage(input: DeliveryPackageInput): DeliveryPackage {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const context = readDeliveryContext(input.dbPath, input.featureId);
  const rollbackPlan = context.rollbackPlan ?? deriveRollbackPlan(input);
  const gate = evaluateDeliveryGate({
    featureId: input.featureId,
    featureTitle: input.featureTitle,
    featureStatus: context.featureStatus,
    requirements: context.requirements,
    tasks: context.tasks,
    evidence: context.evidence,
    approvals: context.approvals,
    openReviewItems: context.openReviewItems,
    tests: context.tests,
    mergeReady: context.mergeReady,
    rollbackPlan,
  });
  const suggestionInputs = buildSpecEvolutionInputs(input.specEvolution ?? [], context, gate);
  const suggestions = suggestionInputs.map((suggestion) => ({
    id: randomUUID(),
    featureId: input.featureId,
    sourceEvidenceRefs: suggestion.sourceEvidenceRefs,
    impactScope: suggestion.impactScope,
    reason: suggestion.reason,
    suggestion: suggestion.suggestion,
    status: "proposed" as const,
    createdAt,
  }));
  const riskItems = [...(input.risks ?? []), ...gate.reasons.filter(() => gate.status !== "ready")];
  const pullRequest = gate.status === "ready"
    ? createPullRequestRecord({
        input,
        context,
        rollbackPlan,
        riskItems,
        suggestions,
        createdAt,
      })
    : undefined;
  const deliverySucceeded = gate.status === "ready" && pullRequest?.status === "created";
  const report = createDeliveryReportRecord({
    input,
    context,
    gate,
    pullRequest,
    suggestions,
    rollbackPlan,
    riskItems,
    createdAt,
  });
  const transition = deliverySucceeded
    ? transitionFeature(input.featureId, "done", "delivered", {
        reason: "Delivery Manager created PR and delivery report.",
        evidence: report.path,
        triggeredBy: "delivery_manager",
        occurredAt: createdAt,
      })
    : pullRequest?.status === "blocked"
      ? transitionFeature(input.featureId, "done", "review_needed", {
          reason: "Delivery Manager could not create the PR; review delivery credentials or PR request.",
          evidence: report.path,
          triggeredBy: "delivery_manager",
          reviewNeededReason: "risk_review_needed",
          occurredAt: createdAt,
        })
    : undefined;

  writeDeliveryReport(input.artifactRoot, report.path, report.body);
  persistDeliveryPackage(input.dbPath, { gate, pullRequest, report, specEvolutionSuggestions: suggestions, transition });

  return { gate, pullRequest, report, specEvolutionSuggestions: suggestions, transition };
}

function createPullRequestRecord(input: {
  input: DeliveryPackageInput;
  context: DeliveryContext;
  rollbackPlan: RollbackPlan;
  riskItems: string[];
  suggestions: SpecEvolutionSuggestion[];
  createdAt: string;
}): PullRequestRecord {
  const title = `feat: deliver ${input.input.featureId} ${input.input.featureTitle}`;
  const body = buildPullRequestBody({
    featureId: input.input.featureId,
    featureTitle: input.input.featureTitle,
    requirements: input.context.requirements,
    tasks: input.context.tasks,
    evidence: input.context.evidence,
    approvals: input.context.approvals,
    tests: input.context.tests,
    changedFiles: input.input.changedFiles,
    rollbackPlan: input.rollbackPlan,
    risks: input.riskItems,
    nextSteps: input.input.nextSteps ?? [],
    specEvolutionSuggestions: input.suggestions,
  });
  const requested = input.input.mode === "prepare-request";
  const gh = requested ? undefined : runGhCreatePr(input.input, title, body);
  const status: PullRequestStatus = requested ? "request_prepared" : gh?.status === 0 ? "created" : "blocked";

  return {
    id: randomUUID(),
    featureId: input.input.featureId,
    title,
    body,
    baseBranch: input.input.baseBranch,
    headBranch: input.input.headBranch,
    url: extractPrUrl(gh?.stdout),
    status,
    requirements: input.context.requirements.map((requirement) => requirement.id),
    tasks: input.context.tasks.map((task) => task.id),
    evidenceRefs: input.context.evidence.map((evidence) => evidence.id),
    approvalRefs: input.context.approvals.map((approval) => approval.id),
    rollbackPlan: input.rollbackPlan,
    riskItems: input.riskItems,
    createdAt: input.createdAt,
  };
}

function buildPullRequestBody(input: {
  featureId: string;
  featureTitle: string;
  requirements: DeliveryRequirementRef[];
  tasks: DeliveryTaskRef[];
  evidence: DeliveryEvidenceRef[];
  approvals: DeliveryApprovalRef[];
  tests: DeliveryTestResult[];
  changedFiles: string[];
  rollbackPlan: RollbackPlan;
  risks: string[];
  nextSteps: string[];
  specEvolutionSuggestions: SpecEvolutionSuggestion[];
}): string {
  return [
    `## Summary`,
    `${input.featureId} ${input.featureTitle} is ready for delivery.`,
    "",
    `## Requirements`,
    ...input.requirements.map((requirement) => `- ${requirement.id}${requirement.sourceId ? ` (${requirement.sourceId})` : ""}`),
    "",
    `## Completed Tasks`,
    ...input.tasks.map((task) => `- ${task.id}: ${task.title} [${task.status}]`),
    "",
    `## Tests and Evidence`,
    ...input.tests.map((test) => `- ${test.command ?? test.id ?? "test"}: ${test.status} - ${test.summary}`),
    ...input.evidence.map((evidence) => `- Evidence ${evidence.id}: ${evidence.summary}${evidence.path ? ` (${evidence.path})` : ""}`),
    "",
    `## Approval`,
    ...input.approvals.map((approval) => `- ${approval.id}: ${approval.decision} by ${approval.actor ?? "unknown"}`),
    "",
    `## Rollback`,
    `- Branch: ${input.rollbackPlan.branch}`,
    `- Base commit: ${input.rollbackPlan.baseCommit}`,
    `- Command: \`${input.rollbackPlan.rollbackCommand}\``,
    "",
    `## Risks`,
    ...(input.risks.length ? input.risks.map((risk) => `- ${risk}`) : ["- none"]),
    "",
    `## Spec Evolution`,
    ...(input.specEvolutionSuggestions.length
      ? input.specEvolutionSuggestions.map((suggestion) => `- ${suggestion.reason}: ${suggestion.suggestion}`)
      : ["- none"]),
    "",
    `## Next Steps`,
    ...(input.nextSteps.length ? input.nextSteps.map((step) => `- ${step}`) : ["- Await PR review."]),
  ].join("\n");
}

function createDeliveryReportRecord(input: {
  input: DeliveryPackageInput;
  context: DeliveryContext;
  gate: DeliveryGateResult;
  pullRequest?: PullRequestRecord;
  suggestions: SpecEvolutionSuggestion[];
  rollbackPlan: RollbackPlan;
  riskItems: string[];
  createdAt: string;
}): DeliveryReport {
  const relativePath = buildDeliveryReportPath(input.input.artifactRoot, input.input.featureId);
  const acceptanceResults = [
    `Delivery gate: ${input.gate.status}`,
    ...input.gate.reasons,
    ...input.gate.missing.map((missing) => `Missing: ${missing}`),
  ];
  const testSummary = input.context.tests.map((test) => `${test.command ?? test.id ?? "test"}: ${test.status} - ${test.summary}`);
  const recoveryRecords = [`Rollback: ${input.rollbackPlan.summary}`];
  const body = [
    `# Delivery Report: ${input.input.featureId} ${input.input.featureTitle}`,
    "",
    `## Summary`,
    input.pullRequest
      ? `PR ${input.pullRequest.status}: ${input.pullRequest.url ?? input.pullRequest.title}`
      : `Delivery ${input.gate.status}: ${input.gate.reasons.join(" ")}`,
    "",
    `## Changed Files`,
    ...(input.input.changedFiles.length ? input.input.changedFiles.map((file) => `- ${file}`) : ["- none recorded"]),
    "",
    `## Acceptance Results`,
    ...acceptanceResults.map((result) => `- ${result}`),
    "",
    `## Tests`,
    ...(testSummary.length ? testSummary.map((result) => `- ${result}`) : ["- none recorded"]),
    "",
    `## Evidence`,
    ...input.context.evidence.map((evidence) => `- ${evidence.id}: ${evidence.summary}${evidence.path ? ` (${evidence.path})` : ""}`),
    "",
    `## Approval Records`,
    ...input.context.approvals.map((approval) => `- ${approval.id}: ${approval.decision} by ${approval.actor ?? "unknown"}`),
    "",
    `## Failure and Recovery`,
    ...recoveryRecords.map((record) => `- ${record}`),
    "",
    `## Risks`,
    ...(input.riskItems.length ? input.riskItems.map((risk) => `- ${risk}`) : ["- none"]),
    "",
    `## Next Steps`,
    ...((input.input.nextSteps ?? []).length ? (input.input.nextSteps ?? []).map((step) => `- ${step}`) : ["- Await PR review."]),
    "",
    `## Spec Evolution Suggestions`,
    ...(input.suggestions.length ? input.suggestions.map((suggestion) => `- ${suggestion.reason}: ${suggestion.suggestion}`) : ["- none"]),
  ].join("\n");

  return {
    id: randomUUID(),
    featureId: input.input.featureId,
    path: relativePath,
    summary: input.pullRequest?.status === "blocked"
      ? `${input.input.featureId} delivery blocked because PR creation failed.`
      : `${input.input.featureId} delivery ${input.gate.status}.`,
    body,
    status: input.gate.status === "ready" && input.pullRequest?.status === "created" ? "created" : "blocked",
    pullRequestRecordId: input.pullRequest?.id,
    changedFiles: input.input.changedFiles,
    acceptanceResults,
    testSummary,
    recoveryRecords,
    riskItems: input.riskItems,
    nextSteps: input.input.nextSteps ?? [],
    specEvolutionSuggestionIds: input.suggestions.map((suggestion) => suggestion.id),
    createdAt: input.createdAt,
  };
}

type DeliveryContext = {
  featureStatus: string;
  requirements: DeliveryRequirementRef[];
  tasks: DeliveryTaskRef[];
  evidence: DeliveryEvidenceRef[];
  approvals: DeliveryApprovalRef[];
  openReviewItems: DeliveryReviewItemRef[];
  tests: DeliveryTestResult[];
  mergeReady: boolean;
  rollbackPlan?: RollbackPlan;
};

function readDeliveryContext(dbPath: string, featureId: string): DeliveryContext {
  const result = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = ?", params: [featureId] },
    { name: "requirements", sql: "SELECT id, source_id, body FROM requirements WHERE feature_id = ? ORDER BY id", params: [featureId] },
    { name: "tasks", sql: "SELECT id, title, status FROM tasks WHERE feature_id = ? ORDER BY id", params: [featureId] },
    {
      name: "evidence",
      sql: "SELECT id, 'status_check' AS kind, '' AS path, summary FROM status_check_results WHERE feature_id = ? ORDER BY created_at, rowid",
      params: [featureId],
    },
    {
      name: "approvals",
      sql: `SELECT ar.id, ar.review_item_id, ar.decision, ar.actor, ar.reason, ri.status AS review_status
        FROM approval_records ar
        JOIN review_items ri ON ri.id = ar.review_item_id
        WHERE ri.feature_id = ?
        ORDER BY COALESCE(ar.decided_at, ar.created_at), ar.rowid`,
      params: [featureId],
    },
    {
      name: "open_review_items",
      sql: `SELECT id, status, review_needed_reason
        FROM review_items
        WHERE feature_id = ?
          AND status IN ('review_needed', 'changes_requested', 'rejected')
        ORDER BY created_at, rowid`,
      params: [featureId],
    },
    {
      name: "tests",
      sql: `SELECT id, status, summary, path AS result_path
        FROM status_check_results
        WHERE feature_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM status_check_results newer
            WHERE newer.feature_id = status_check_results.feature_id
              AND COALESCE(newer.task_id, newer.run_id, newer.id) = COALESCE(status_check_results.task_id, status_check_results.run_id, status_check_results.id)
              AND (
                newer.created_at > status_check_results.created_at
                OR (newer.created_at = status_check_results.created_at AND newer.rowid > status_check_results.rowid)
              )
          )
        ORDER BY created_at DESC, rowid DESC`,
      params: [featureId],
    },
    {
      name: "merge_readiness",
      sql: `SELECT mr.ready, mr.blocked_reasons_json
        FROM merge_readiness_results mr
        JOIN worktree_records wr ON wr.id = mr.worktree_id
        WHERE wr.feature_id = ?
        ORDER BY mr.created_at DESC, mr.rowid DESC
        LIMIT 1`,
      params: [featureId],
    },
    {
      name: "rollback",
      sql: `SELECT rb.worktree_id, rb.branch, rb.base_commit, rb.rollback_command, rb.diff_summary
        FROM rollback_boundaries rb
        WHERE rb.feature_id = ?
        ORDER BY rb.created_at DESC, rb.rowid DESC
        LIMIT 1`,
      params: [featureId],
    },
  ]);
  const rollback = result.queries.rollback[0];

  return {
    featureStatus: String(result.queries.feature[0]?.status ?? "missing"),
    requirements: result.queries.requirements.map((row) => ({
      id: String(row.id),
      sourceId: optionalString(row.source_id),
      body: optionalString(row.body),
    })),
    tasks: result.queries.tasks.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: String(row.status),
    })),
    evidence: result.queries.evidence.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      path: optionalString(row.path),
      summary: String(row.summary ?? ""),
    })),
    approvals: result.queries.approvals.map((row) => ({
      id: String(row.id),
      reviewItemId: String(row.review_item_id),
      decision: String(row.decision),
      reviewStatus: optionalString(row.review_status),
      actor: optionalString(row.actor),
      reason: optionalString(row.reason),
    })),
    openReviewItems: result.queries.open_review_items.map((row) => ({
      id: String(row.id),
      status: String(row.status),
      reviewNeededReason: optionalString(row.review_needed_reason),
    })),
    tests: result.queries.tests.map((row) => ({
      id: String(row.id),
      status: String(row.status) === "done" ? "passed" : String(row.status),
      summary: String(row.summary),
      evidenceRef: optionalString(row.result_path),
    })),
    mergeReady: Boolean(Number(result.queries.merge_readiness[0]?.ready ?? 0)),
    rollbackPlan: rollback
      ? {
          worktreeId: optionalString(rollback.worktree_id),
          branch: String(rollback.branch),
          baseCommit: String(rollback.base_commit),
          rollbackCommand: String(rollback.rollback_command),
          summary: String(rollback.diff_summary),
        }
      : undefined,
  };
}

function persistDeliveryPackage(dbPath: string, delivery: DeliveryPackage): void {
  const statements: SqlStatement[] = [];
  for (const suggestion of delivery.specEvolutionSuggestions) {
    statements.push({
      sql: `INSERT INTO spec_evolution_suggestions (
        id, feature_id, source_refs_json, impact_scope_json, reason, suggestion, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        suggestion.id,
        suggestion.featureId,
        JSON.stringify(suggestion.sourceEvidenceRefs),
        JSON.stringify(suggestion.impactScope),
        suggestion.reason,
        suggestion.suggestion,
        suggestion.status,
        suggestion.createdAt,
      ],
    });
  }
  if (delivery.pullRequest) {
    statements.push({
      sql: `INSERT INTO pull_request_records (
        id, feature_id, title, body, base_branch, head_branch, url, status, requirements_json,
        tasks_json, execution_refs_json, approval_refs_json, rollback_plan_json, risk_items_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        delivery.pullRequest.id,
        delivery.pullRequest.featureId,
        delivery.pullRequest.title,
        delivery.pullRequest.body,
        delivery.pullRequest.baseBranch,
        delivery.pullRequest.headBranch,
        delivery.pullRequest.url ?? null,
        delivery.pullRequest.status,
        JSON.stringify(delivery.pullRequest.requirements),
        JSON.stringify(delivery.pullRequest.tasks),
        JSON.stringify(delivery.pullRequest.evidenceRefs),
        JSON.stringify(delivery.pullRequest.approvalRefs),
        JSON.stringify(delivery.pullRequest.rollbackPlan),
        JSON.stringify(delivery.pullRequest.riskItems),
        delivery.pullRequest.createdAt,
        delivery.pullRequest.createdAt,
      ],
    });
  }
  statements.push({
    sql: `INSERT INTO delivery_reports (
      id, feature_id, path, summary, status, pull_request_record_id, body, changed_files_json,
      acceptance_results_json, test_summary_json, recovery_records_json, risk_items_json,
      next_steps_json, spec_evolution_suggestion_ids_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      delivery.report.id,
      delivery.report.featureId,
      delivery.report.path,
      delivery.report.summary,
      delivery.report.status,
      delivery.report.pullRequestRecordId ?? null,
      delivery.report.body,
      JSON.stringify(delivery.report.changedFiles),
      JSON.stringify(delivery.report.acceptanceResults),
      JSON.stringify(delivery.report.testSummary),
      JSON.stringify(delivery.report.recoveryRecords),
      JSON.stringify(delivery.report.riskItems),
      JSON.stringify(delivery.report.nextSteps),
      JSON.stringify(delivery.report.specEvolutionSuggestionIds),
      delivery.report.createdAt,
      delivery.report.createdAt,
    ],
  });
  if (delivery.transition) {
    statements.push({
      sql: `UPDATE features SET status = ?, updated_at = ? WHERE id = ?`,
      params: [delivery.transition.to, delivery.transition.occurredAt, delivery.transition.entityId],
    });
    statements.push({
      sql: `INSERT INTO state_transitions (
        id, entity_type, entity_id, from_status, to_status, reason, evidence, triggered_by,
        review_needed_reason, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        delivery.transition.id,
        delivery.transition.entityType,
        delivery.transition.entityId,
        delivery.transition.from,
        delivery.transition.to,
        delivery.transition.reason,
        delivery.transition.evidence,
        delivery.transition.triggeredBy,
        delivery.transition.reviewNeededReason ?? null,
        delivery.transition.occurredAt,
      ],
    });
  }
  runSqlite(dbPath, statements);
  recordAuditEvent(dbPath, {
    entityType: "feature",
    entityId: delivery.report.featureId,
    eventType: "delivery_report_created",
    source: "delivery_manager",
    reason: delivery.report.summary,
    payload: {
      reportId: delivery.report.id,
      pullRequestRecordId: delivery.pullRequest?.id,
      specEvolutionSuggestionIds: delivery.report.specEvolutionSuggestionIds,
    },
  });
  recordMetricSample(dbPath, {
    name: "pr_delivery_report_generation_rate",
    value: delivery.report.status === "created" ? 1 : 0,
    unit: "ratio",
    labels: { featureId: delivery.report.featureId, deliveryStatus: delivery.report.status },
  });
}

function runGhCreatePr(input: DeliveryPackageInput, title: string, body: string): GhRunnerResult {
  const runner = input.ghRunner ?? defaultGhRunner;
  return runner(
    "gh",
    ["pr", "create", "--title", title, "--body", body, "--base", input.baseBranch, "--head", input.headBranch],
    input.repositoryPath,
  );
}

function defaultGhRunner(command: string, args: string[], cwd: string): GhRunnerResult {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function buildSpecEvolutionInputs(
  explicit: SpecEvolutionInput[],
  context: DeliveryContext,
  gate: DeliveryGateResult,
): SpecEvolutionInput[] {
  const suggestions = [...explicit];
  if (gate.status !== "ready" && context.evidence.length > 0) {
    suggestions.push({
      reason: "Delivery gate exposed incomplete delivery constraints.",
      suggestion: `Clarify or satisfy delivery prerequisites: ${gate.missing.join(", ")}.`,
      sourceEvidenceRefs: context.evidence.map((evidence) => evidence.id),
      impactScope: ["delivery-gate", "acceptance"],
    });
  }
  return suggestions;
}

function hasCurrentPositiveApproval(approvals: DeliveryApprovalRef[]): boolean {
  const latestByReview = new Map<string, DeliveryApprovalRef>();
  for (const approval of approvals) {
    latestByReview.set(approval.reviewItemId, approval);
  }
  return [...latestByReview.values()].some(
    (approval) =>
      ["approve_continue", "mark_complete"].includes(approval.decision) &&
      (approval.reviewStatus === undefined || approval.reviewStatus === "approved"),
  );
}

function deriveRollbackPlan(input: DeliveryPackageInput): RollbackPlan {
  return {
    branch: input.headBranch,
    baseCommit: "unknown",
    rollbackCommand: "echo 'Rollback boundary missing; manual review required before reset.' && exit 1",
    summary: "Fallback rollback plan blocks destructive reset until a concrete rollback boundary is recorded.",
  };
}

function buildDeliveryReportPath(artifactRoot: string, featureId: string): string {
  return `${basename(artifactRoot)}/reports/${featureId.toLowerCase()}-delivery-report.md`;
}

function writeDeliveryReport(artifactRoot: string, relativePath: string, body: string): void {
  const artifactRootName = basename(artifactRoot);
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const artifactRelativePath = normalizedPath.startsWith(`${artifactRootName}/`)
    ? normalizedPath.slice(artifactRootName.length + 1)
    : normalizedPath;
  const absolutePath = join(artifactRoot, artifactRelativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  if (existsSync(absolutePath)) {
    writeFileSync(absolutePath, `${body}\n`, "utf8");
    return;
  }
  writeFileSync(absolutePath, `${body}\n`, { encoding: "utf8", mode: 0o600 });
}

function extractPrUrl(stdout?: string): string | undefined {
  const match = stdout?.match(/https?:\/\/\S+/);
  return match?.[0];
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value);
  return text.length ? text : undefined;
}
