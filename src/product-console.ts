import { randomUUID } from "node:crypto";
import { recordAuditEvent, recordMetricSample } from "./persistence.ts";
import { runSqlite } from "./sqlite.ts";
import {
  createScheduleTrigger,
  persistSelectionDecision,
  persistScheduleTrigger,
  selectNextFeature,
  type BoardColumn,
  type FeatureCandidate,
  type FeatureLifecycleStatus,
  type RiskLevel,
  type ScheduleTriggerMode,
} from "./orchestration.ts";
import type { RunnerApprovalPolicy, RunnerQueueStatus, RunnerSandboxMode } from "./codex-runner.ts";
import { listReviewCenterItems, recordApprovalDecision, type RecordApprovalInput, type ReviewDecision, type ReviewTrigger } from "./review-center.ts";

export type ConsoleCommandAction =
  | "create_feature"
  | "terminate_subagent"
  | "retry_subagent"
  | "pause_runner"
  | "resume_runner"
  | "approve_review"
  | "reject_review"
  | "request_review_changes"
  | "rollback_review"
  | "split_review_task"
  | "update_spec"
  | "mark_review_complete"
  | "schedule_run"
  | "write_project_rule"
  | "write_spec_evolution";

export type ConsoleCommandStatus = "accepted";

export type ConsoleCommandInput = {
  action: ConsoleCommandAction;
  entityType: "project" | "feature" | "task" | "run" | "runner" | "review_item" | "rule" | "spec";
  entityId: string;
  requestedBy: string;
  reason: string;
  payload?: Record<string, unknown>;
  now?: Date;
};

export type ConsoleCommandReceipt = {
  id: string;
  action: ConsoleCommandAction;
  status: ConsoleCommandStatus;
  entityType: ConsoleCommandInput["entityType"];
  entityId: string;
  auditEventId: string;
  acceptedAt: string;
  approvalRecordId?: string;
  scheduleTriggerId?: string;
  selectionDecisionId?: string;
};

export type DashboardQueryOptions = {
  projectId?: string;
  now?: Date;
  refresh?: boolean;
};

export type DashboardQueryModel = {
  projectHealth: {
    totalProjects: number;
    ready: number;
    blocked: number;
    failed: number;
  };
  activeFeatures: Array<{ id: string; title: string; status: string; priority: number }>;
  boardCounts: Record<BoardColumn | "unknown", number>;
  runningSubagents: number;
  todayAutomaticExecutions: number;
  failedTasks: Array<{ id: string; title: string; status: string; featureId?: string }>;
  pendingApprovals: number;
  cost: {
    totalUsd: number;
    tokensUsed: number;
  };
  runner: {
    heartbeats: number;
    online: number;
    successRate: number;
    failureRate: number;
  };
  recentPullRequests: Array<{ id: string; title: string; url?: string; createdAt?: string }>;
  risks: Array<{ level: RiskLevel | "unknown"; message: string; source: string }>;
  performance: {
    loadMs: number;
    refreshMs?: number;
  };
  factSources: string[];
};

const pendingReviewStatuses = new Set(["pending", "review_needed", "changes_requested", "rejected"]);

export type SpecWorkspaceViewModel = {
  features: Array<{
    id: string;
    title: string;
    folder?: string;
    status: string;
    primaryRequirements: string[];
  }>;
  selectedFeature?: {
    id: string;
    title: string;
    requirements: Array<{ id: string; body: string; acceptanceCriteria?: string; priority?: string }>;
    taskGraph?: unknown;
    clarificationRecords: unknown[];
    qualityChecklist: Array<{ item: string; passed: boolean }>;
    technicalPlan?: unknown;
    dataModels: unknown[];
    contracts: unknown[];
    versionDiffs: unknown[];
  };
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
};

export type SkillCenterViewModel = {
  skills: Array<{
    slug: string;
    name: string;
    version: string;
    enabled: boolean;
    phase: string;
    riskLevel: string;
    schema: {
      input: unknown;
      output: unknown;
    };
    recentRuns: Array<{ id: string; status: string; createdAt: string }>;
    successRate: number;
  }>;
};

export type SubagentConsoleViewModel = {
  runs: Array<{
    id: string;
    featureId?: string;
    taskId?: string;
    status: string;
    runContract?: unknown;
    contextSlice?: unknown;
    evidence: Array<{ id: string; summary: string; path?: string }>;
    tokenUsage?: unknown;
  }>;
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
};

export type RunnerConsoleViewModel = {
  runners: Array<{
    runnerId: string;
    online: boolean;
    codexVersion?: string;
    sandboxMode: RunnerSandboxMode;
    approvalPolicy: RunnerApprovalPolicy;
    queue: Array<{ runId: string; status: RunnerQueueStatus }>;
    recentLogs: Array<{ runId: string; stdout: string; stderr: string; createdAt: string }>;
    lastHeartbeatAt?: string;
    heartbeatStale: boolean;
  }>;
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
};

export type ReviewCenterViewModel = {
  items: Array<{
    id: string;
    featureId?: string;
    taskId?: string;
    status: string;
    severity: string;
    body: string;
    evidence: Array<{ id: string; summary: string; path?: string }>;
    goal?: string;
    specRef?: string;
    runContract?: unknown;
    reviewNeededReason: string;
    triggerReasons: ReviewTrigger[];
    recommendedActions: ReviewDecision[];
    approvals: Array<{ id: string; decision: ReviewDecision; actor: string; reason: string; decidedAt: string }>;
    diff?: unknown;
    testResults?: unknown;
    riskExplanation?: string;
    createdAt: string;
  }>;
  riskFilters: string[];
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
};

const BOARD_COLUMNS = new Set([
  "backlog",
  "ready",
  "scheduled",
  "running",
  "checking",
  "review_needed",
  "blocked",
  "failed",
  "done",
  "delivered",
]);

export function buildDashboardQuery(dbPath: string, options: DashboardQueryOptions = {}): DashboardQueryModel {
  const started = process.hrtime.bigint();
  const now = options.now ?? new Date();
  const todayPrefix = now.toISOString().slice(0, 10);
  const projectFilter = options.projectId ? "WHERE project_id = ?" : "";
  const projectParams = options.projectId ? [options.projectId] : [];
  const projectIdFilter = options.projectId ? "WHERE id = ?" : "";
  const featureProjectFilter = options.projectId ? "WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?)" : "";
  const runProjectFilter = options.projectId ? "WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)" : "";
  const reviewProjectFilter = options.projectId
    ? `WHERE (
        project_id = ?
        OR feature_id IN (SELECT id FROM features WHERE project_id = ?)
        OR task_id IN (SELECT id FROM tasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?))
        OR task_id IN (SELECT id FROM task_graph_tasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?))
        OR run_id IN (SELECT id FROM runs WHERE project_id = ?)
      )`
    : "";
  const reviewParams = options.projectId ? [options.projectId, options.projectId, options.projectId, options.projectId, options.projectId] : [];
  const metricProjectFilter = options.projectId ? "WHERE labels_json LIKE ?" : "";
  const metricParams = options.projectId ? [`%"projectId":"${escapeLike(options.projectId)}"%`] : [];
  const result = runSqlite(dbPath, [], [
    { name: "projects", sql: `SELECT status FROM projects ${projectIdFilter}`, params: projectParams },
    {
      name: "features",
      sql: `SELECT id, title, status, COALESCE(priority, 0) AS priority FROM features ${projectFilter} ORDER BY priority DESC, created_at DESC`,
      params: projectParams,
    },
    {
      name: "tasks",
      sql: `SELECT id, feature_id, title, status FROM tasks ${featureProjectFilter}`,
      params: projectParams,
    },
    {
      name: "graphTasks",
      sql: `SELECT id, feature_id, title, status FROM task_graph_tasks ${featureProjectFilter}`,
      params: projectParams,
    },
    {
      name: "runs",
      sql: `SELECT id, task_id, feature_id, status, started_at, metadata_json FROM runs ${projectFilter} ORDER BY COALESCE(started_at, '') DESC`,
      params: projectParams,
    },
    {
      name: "heartbeats",
      sql: `SELECT runner_id, status, queue_status, beat_at FROM runner_heartbeats ${runProjectFilter} ORDER BY beat_at DESC`,
      params: projectParams,
    },
    {
      name: "metrics",
      sql: `SELECT metric_name, metric_value, unit, labels_json FROM metric_samples ${metricProjectFilter} ORDER BY sampled_at, rowid`,
      params: metricParams,
    },
    {
      name: "reviews",
      sql: `SELECT id, severity, status, body, feature_id FROM review_items ${reviewProjectFilter} ORDER BY created_at DESC`,
      params: reviewParams,
    },
    {
      name: "evidence",
      sql: `SELECT id, summary, metadata_json, created_at FROM evidence_packs ${featureProjectFilter} ORDER BY created_at DESC LIMIT 10`,
      params: projectParams,
    },
    {
      name: "pullRequests",
      sql: `SELECT id, summary, metadata_json, created_at FROM evidence_packs ${featureProjectFilter ? `${featureProjectFilter} AND` : "WHERE"} metadata_json LIKE '%"pullRequest"%' ORDER BY created_at DESC LIMIT 5`,
      params: projectParams,
    },
  ]);

  const projects = result.queries.projects;
  const tasks = result.queries.graphTasks.length > 0 ? result.queries.graphTasks : result.queries.tasks;
  const runs = result.queries.runs;
  const metrics = result.queries.metrics;
  const reviews = result.queries.reviews;
  const heartbeats = result.queries.heartbeats;
  const loadMs = elapsedMs(started);

  recordMetricSample(dbPath, {
    name: options.refresh ? "status_refresh_ms" : "dashboard_load_ms",
    value: loadMs,
    unit: "ms",
    labels: { projectId: options.projectId ?? "all", surface: "product_console" },
  });

  return {
    projectHealth: {
      totalProjects: projects.length,
      ready: countBy(projects, "status", "ready"),
      blocked: countBy(projects, "status", "blocked"),
      failed: countBy(projects, "status", "failed"),
    },
    activeFeatures: result.queries.features
      .filter((row) => !["done", "delivered"].includes(String(row.status)))
      .slice(0, 10)
      .map((row) => ({ id: String(row.id), title: String(row.title), status: String(row.status), priority: Number(row.priority) })),
    boardCounts: buildBoardCounts(tasks),
    runningSubagents: countBy(runs, "status", "running"),
    todayAutomaticExecutions: runs.filter((row) => String(row.started_at ?? "").startsWith(todayPrefix) && parseJsonObject(row.metadata_json).automatic === true).length,
    failedTasks: tasks
      .filter((row) => String(row.status) === "failed")
      .map((row) => ({ id: String(row.id), title: String(row.title), status: String(row.status), featureId: optionalString(row.feature_id) })),
    pendingApprovals: reviews.filter((row) => pendingReviewStatuses.has(String(row.status))).length,
    cost: {
      totalUsd: sumMetrics(metrics, "cost_usd"),
      tokensUsed: sumMetrics(metrics, "tokens_used"),
    },
    runner: {
      heartbeats: heartbeats.length,
      online: latestRunnerStatuses(heartbeats).filter((row) => String(row.status) === "online").length,
      successRate: latestMetric(metrics, "success_rate"),
      failureRate: latestMetric(metrics, "failure_rate"),
    },
    recentPullRequests: extractRecentPullRequests(result.queries.pullRequests),
    risks: extractRisks(reviews, runs),
    performance: options.refresh ? { loadMs: latestMetric(metrics, "dashboard_load_ms"), refreshMs: loadMs } : { loadMs },
    factSources: [
      "projects",
      "features",
      "tasks",
      "runs",
      "runner_heartbeats",
      "metric_samples",
      "review_items",
      "evidence_packs",
    ],
  };
}

export function buildSpecWorkspaceView(dbPath: string, featureId?: string, projectId?: string): SpecWorkspaceViewModel {
  const featureFilter = projectId ? "WHERE project_id = ?" : "";
  const featureParams = projectId ? [projectId] : [];
  const result = runSqlite(dbPath, [], [
    { name: "features", sql: `SELECT * FROM features ${featureFilter} ORDER BY created_at DESC`, params: featureParams },
    {
      name: "requirements",
      sql: "SELECT * FROM requirements WHERE feature_id = ? ORDER BY created_at, id",
      params: [featureId ?? ""],
    },
    {
      name: "taskGraphs",
      sql: "SELECT graph_json FROM task_graphs WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1",
      params: [featureId ?? ""],
    },
    {
      name: "planning",
      sql: "SELECT stages_json FROM planning_pipeline_runs WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1",
      params: [featureId ?? ""],
    },
    {
      name: "featureEvidence",
      sql: "SELECT id, kind, summary, path, metadata_json FROM evidence_packs WHERE feature_id = ? ORDER BY created_at DESC",
      params: [featureId ?? ""],
    },
    {
      name: "deliveryReports",
      sql: "SELECT id, path, summary, created_at FROM delivery_reports WHERE feature_id = ? ORDER BY created_at DESC",
      params: [featureId ?? ""],
    },
  ]);
  const features = result.queries.features.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    folder: optionalString(row.folder),
    status: String(row.status),
    primaryRequirements: parseJsonArray(row.primary_requirements_json),
  }));
  const feature = featureId ? features.find((entry) => entry.id === featureId) : undefined;
  const planningStages = parseJsonArray(result.queries.planning[0]?.stages_json).filter(isRecord);
  const evidence = result.queries.featureEvidence.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    summary: String(row.summary ?? ""),
    path: optionalString(row.path),
    metadata: parseJson(row.metadata_json),
  }));

  return {
    features,
    selectedFeature: feature
      ? {
          ...feature,
          requirements: result.queries.requirements.map((row) => ({
            id: String(row.id),
            body: String(row.body),
            acceptanceCriteria: optionalString(row.acceptance_criteria),
            priority: optionalString(row.priority),
          })),
          taskGraph: parseJson(result.queries.taskGraphs[0]?.graph_json),
          clarificationRecords: evidence.filter((entry) => entry.kind === "clarification"),
          qualityChecklist: [
            { item: "requirements_present", passed: result.queries.requirements.length > 0 },
            { item: "task_graph_present", passed: result.queries.taskGraphs.length > 0 },
            { item: "technical_plan_present", passed: result.queries.planning.length > 0 },
          ],
          technicalPlan: planningStages,
          dataModels: [
            ...planningStages.filter((stage) => stage.slug === "data-model-skill").map((stage) => stage.output),
            ...evidence.filter((entry) => entry.kind === "data_model"),
          ].filter(Boolean),
          contracts: [
            ...planningStages.filter((stage) => stage.slug === "contract-design-skill").map((stage) => stage.output),
            ...evidence.filter((entry) => entry.kind === "contract"),
          ].filter(Boolean),
          versionDiffs: [
            ...evidence.filter((entry) => entry.kind === "spec_evolution"),
            ...result.queries.deliveryReports.map((row) => ({
              id: String(row.id),
              path: String(row.path),
              summary: String(row.summary ?? ""),
              createdAt: String(row.created_at),
            })),
          ],
        }
      : undefined,
    commands: [
      { action: "create_feature", entityType: "project" },
      { action: "schedule_run", entityType: "project" },
      { action: "schedule_run", entityType: "feature" },
    ],
  };
}

export function buildSkillCenterView(dbPath: string, projectId?: string): SkillCenterViewModel {
  const projectFilter = projectId ? "WHERE project_id IS NULL OR project_id = ?" : "";
  const projectParams = projectId ? [projectId] : [];
  const runProjectFilter = projectId ? "WHERE sr.run_id IS NULL OR sr.run_id IN (SELECT id FROM runs WHERE project_id = ?)" : "";
  const result = runSqlite(dbPath, [], [
    { name: "skills", sql: `SELECT * FROM skills ${projectFilter} ORDER BY phase, slug`, params: projectParams },
    {
      name: "runs",
      sql: `SELECT sr.id, sr.skill_slug, sr.status, sr.created_at FROM skill_runs sr ${runProjectFilter} ORDER BY sr.created_at DESC`,
      params: projectParams,
    },
  ]);
  return {
    skills: result.queries.skills.map((row) => {
      const recentRuns = result.queries.runs.filter((run) => run.skill_slug === row.slug).slice(0, 5);
      return {
        slug: String(row.slug),
        name: String(row.name),
        version: String(row.current_version),
        enabled: Number(row.enabled) === 1,
        phase: String(row.phase),
        riskLevel: String(row.risk_level),
        schema: {
          input: parseJson(row.input_schema_json),
          output: parseJson(row.output_schema_json),
        },
        recentRuns: recentRuns.map((run) => ({ id: String(run.id), status: String(run.status), createdAt: String(run.created_at) })),
        successRate: ratio(recentRuns.filter((run) => String(run.status) === "completed").length, recentRuns.length),
      };
    }),
  };
}

export function buildSubagentConsoleView(dbPath: string, projectId?: string): SubagentConsoleViewModel {
  const runFilter = projectId ? "WHERE project_id = ?" : "";
  const runParams = projectId ? [projectId] : [];
  const result = runSqlite(dbPath, [], [
    { name: "runs", sql: `SELECT * FROM runs ${runFilter} ORDER BY COALESCE(started_at, '') DESC, rowid DESC LIMIT 25`, params: runParams },
    { name: "contracts", sql: "SELECT run_id, contract_json FROM agent_run_contracts ORDER BY created_at DESC" },
    { name: "contexts", sql: "SELECT run_id, refs_json, token_estimate FROM context_slice_refs ORDER BY created_at DESC" },
    { name: "events", sql: "SELECT run_id, token_usage_json FROM subagent_events ORDER BY created_at DESC" },
    { name: "evidence", sql: "SELECT id, run_id, summary, path FROM evidence_packs ORDER BY created_at DESC" },
  ]);

  return {
    runs: result.queries.runs.map((row) => {
      const runId = String(row.id);
      const context = result.queries.contexts.find((entry) => entry.run_id === row.id);
      const event = result.queries.events.find((entry) => entry.run_id === row.id);
      return {
        id: runId,
        featureId: optionalString(row.feature_id),
        taskId: optionalString(row.task_id),
        status: String(row.status),
        runContract: parseJson(result.queries.contracts.find((entry) => entry.run_id === row.id)?.contract_json),
        contextSlice: context ? { refs: parseJsonArray(context.refs_json), tokenEstimate: Number(context.token_estimate) } : undefined,
        evidence: result.queries.evidence
          .filter((entry) => entry.run_id === row.id)
          .map((entry) => ({ id: String(entry.id), summary: String(entry.summary ?? ""), path: optionalString(entry.path) })),
        tokenUsage: parseJson(event?.token_usage_json),
      };
    }),
    commands: [
      { action: "terminate_subagent", entityType: "run" },
      { action: "retry_subagent", entityType: "run" },
    ],
  };
}

export function buildRunnerConsoleView(dbPath: string, now: Date = new Date(), projectId?: string): RunnerConsoleViewModel {
  const runProjectFilter = projectId ? "WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)" : "";
  const runProjectParams = projectId ? [projectId] : [];
  const result = runSqlite(dbPath, [], [
    { name: "policies", sql: `SELECT * FROM runner_policies ${runProjectFilter} ORDER BY created_at DESC`, params: runProjectParams },
    { name: "heartbeats", sql: `SELECT * FROM runner_heartbeats ${runProjectFilter} ORDER BY beat_at DESC`, params: runProjectParams },
    { name: "logs", sql: `SELECT * FROM raw_execution_logs ${runProjectFilter} ORDER BY created_at DESC LIMIT 25`, params: runProjectParams },
  ]);
  const latestHeartbeats = latestRunnerStatuses(result.queries.heartbeats);

  return {
    runners: latestHeartbeats.map((heartbeat) => {
      const policy = result.queries.policies.find((row) => row.run_id === heartbeat.run_id);
      const lastHeartbeatAt = String(heartbeat.beat_at);
      const heartbeatIntervalSeconds = Number(policy?.heartbeat_interval_seconds ?? 20);
      const heartbeatStale = now.getTime() - new Date(lastHeartbeatAt).getTime() > heartbeatIntervalSeconds * 2 * 1000;
      return {
        runnerId: String(heartbeat.runner_id),
        online: String(heartbeat.status) === "online" && !heartbeatStale,
        codexVersion: optionalString(policy?.model),
        sandboxMode: String(policy?.sandbox_mode ?? "workspace-write") as RunnerSandboxMode,
        approvalPolicy: String(policy?.approval_policy ?? "on-request") as RunnerApprovalPolicy,
        queue: latestRunQueueStatuses(result.queries.heartbeats.filter((row) => row.runner_id === heartbeat.runner_id))
          .map((row) => ({ runId: String(row.run_id), status: String(row.queue_status) as RunnerQueueStatus })),
        recentLogs: result.queries.logs
          .filter((row) => row.run_id === heartbeat.run_id)
          .slice(0, 5)
          .map((row) => ({ runId: String(row.run_id), stdout: String(row.stdout ?? ""), stderr: String(row.stderr ?? ""), createdAt: String(row.created_at) })),
        lastHeartbeatAt,
        heartbeatStale,
      };
    }),
    commands: [
      { action: "pause_runner", entityType: "runner" },
      { action: "resume_runner", entityType: "runner" },
    ],
  };
}

export function buildReviewCenterView(dbPath: string, projectId?: string): ReviewCenterViewModel {
  const items = listReviewCenterItems(dbPath, { projectId });

  return {
    items: items.map((item) => ({
      id: item.id,
      featureId: item.featureId,
      taskId: item.taskId,
      status: item.status,
      severity: item.severity,
      body: item.body.message,
      evidence: item.evidence.map((entry) => ({ id: entry.id, summary: entry.summary, path: entry.path })),
      goal: item.body.goal,
      specRef: item.body.specRef,
      runContract: item.body.runContract,
      reviewNeededReason: item.reviewNeededReason,
      triggerReasons: item.triggerReasons,
      recommendedActions: item.recommendedActions,
      approvals: item.approvals.map((approval) => ({
        id: approval.id,
        decision: approval.decision,
        actor: approval.actor,
        reason: approval.reason,
        decidedAt: approval.decidedAt,
      })),
      diff: item.body.diff,
      testResults: item.body.testResults,
      riskExplanation: item.body.riskExplanation,
      createdAt: item.createdAt,
    })),
    riskFilters: [...new Set(items.map((item) => item.severity))].sort(),
    commands: [
      { action: "approve_review", entityType: "review_item" },
      { action: "reject_review", entityType: "review_item" },
      { action: "request_review_changes", entityType: "review_item" },
      { action: "rollback_review", entityType: "review_item" },
      { action: "split_review_task", entityType: "review_item" },
      { action: "update_spec", entityType: "review_item" },
      { action: "mark_review_complete", entityType: "review_item" },
      { action: "write_project_rule", entityType: "rule" },
      { action: "write_spec_evolution", entityType: "spec" },
    ],
  };
}

export function submitConsoleCommand(dbPath: string, input: ConsoleCommandInput): ConsoleCommandReceipt {
  const action = requireCommandString(input, "action") as ConsoleCommandAction;
  const entityType = requireCommandString(input, "entityType") as ConsoleCommandInput["entityType"];
  const entityId = requireCommandString(input, "entityId");
  const requestedBy = requireCommandString(input, "requestedBy");
  const reason = requireCommandString(input, "reason");

  const acceptedAt = normalizeCommandTime(input.now).toISOString();
  const id = randomUUID();
  const approvalRecord = executeReviewCommand(dbPath, input, acceptedAt);
  const scheduleResult = executeScheduleCommand(dbPath, input, acceptedAt);
  const writeArtifactId = executeConsoleWriteCommand(dbPath, input, acceptedAt);
  const auditEventId = recordAuditEvent(dbPath, {
    entityType,
    entityId,
    eventType: `console_command_${action}`,
    source: "product_console",
    reason,
    payload: {
      commandId: id,
      requestedBy,
      acceptedAt,
      writeArtifactId,
      scheduleTriggerId: scheduleResult?.triggerId,
      selectionDecisionId: scheduleResult?.selectionDecisionId,
      payload: input.payload ?? {},
    },
  });

  return {
    id,
    action,
    status: "accepted",
    entityType,
    entityId,
    auditEventId,
    acceptedAt,
    approvalRecordId: approvalRecord?.id,
    scheduleTriggerId: scheduleResult?.triggerId,
    selectionDecisionId: scheduleResult?.selectionDecisionId,
  };
}

function executeScheduleCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
): { triggerId: string; selectionDecisionId?: string } | undefined {
  if (input.action !== "schedule_run") {
    return undefined;
  }
  if (input.entityType !== "project" && input.entityType !== "feature" && input.entityType !== "task") {
    throw new Error("schedule_run supports only project, feature, or task entities.");
  }
  const payload = isRecord(input.payload) ? input.payload : {};
  const mode = requirePayloadString(payload, "mode") as ScheduleTriggerMode;
  const requestedFor = optionalString(payload.requestedFor);
  if (mode === "scheduled_at" && !requestedFor) {
    throw new Error("schedule_run with mode scheduled_at requires payload.requestedFor.");
  }
  const trigger = persistScheduleTrigger(
    dbPath,
    createScheduleTrigger({
      projectId: optionalString(payload.projectId) ?? (input.entityType === "project" ? input.entityId : undefined),
      featureId: optionalString(payload.featureId) ?? (input.entityType === "feature" ? input.entityId : undefined),
      mode,
      requestedFor: requestedFor ?? acceptedAt,
      source: "product_console",
      target: { type: input.entityType, id: input.entityId },
      boundaryEvidence: optionalStringArray(payload.boundaryEvidence),
      now: new Date(acceptedAt),
    }),
  );
  if (trigger.result !== "accepted") {
    return { triggerId: trigger.id };
  }

  const { candidates, completedFeatureIds } = loadScheduleCandidates(dbPath, input, trigger.projectId);
  const decision = persistSelectionDecision(
    dbPath,
    selectNextFeature(candidates, completedFeatureIds, `schedule_trigger:${trigger.id}`, new Date(acceptedAt)),
    trigger.projectId,
  );
  return { triggerId: trigger.id, selectionDecisionId: decision.id };
}

function loadScheduleCandidates(
  dbPath: string,
  input: ConsoleCommandInput,
  projectId?: string,
): { candidates: FeatureCandidate[]; completedFeatureIds: string[] } {
  const projectClause = projectId ? "project_id = ?" : "1 = 1";
  const projectParams = projectId ? [projectId] : [];
  const featureClause = input.entityType === "feature" ? " AND id = ?" : "";
  const featureParams = input.entityType === "feature" ? [input.entityId] : [];
  const result = runSqlite(dbPath, [], [
    {
      name: "features",
      sql: `SELECT id, title, status, COALESCE(priority, 0) AS priority,
          COALESCE(dependencies_json, '[]') AS dependencies_json,
          COALESCE(primary_requirements_json, '[]') AS primary_requirements_json,
          created_at
        FROM features
        WHERE ${projectClause}${featureClause}
        ORDER BY priority DESC, created_at`,
      params: [...projectParams, ...featureParams],
    },
  ]);

  const rows = result.queries.features;
  return {
    candidates: rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: normalizeFeatureStatus(row.status),
      priority: Number(row.priority ?? 0),
      dependencies: parseJsonArray(row.dependencies_json).map(String),
      requirementIds: parseJsonArray(row.primary_requirements_json).map(String),
      acceptanceRisk: "low",
      readySince: optionalString(row.created_at) ?? new Date(0).toISOString(),
    })),
    completedFeatureIds: rows
      .filter((row) => String(row.status) === "done" || String(row.status) === "delivered")
      .map((row) => String(row.id)),
  };
}

function executeConsoleWriteCommand(dbPath: string, input: ConsoleCommandInput, acceptedAt: string): string | undefined {
  if (input.action !== "write_project_rule" && input.action !== "write_spec_evolution") {
    return undefined;
  }
  const id = randomUUID();
  const payload = isRecord(input.payload) ? input.payload : {};
  const projectId = optionalString(payload.projectId);
  const featureId = input.action === "write_spec_evolution"
    ? optionalString(payload.featureId) ?? (input.entityType === "feature" ? input.entityId : undefined)
    : undefined;
  const kind = input.action === "write_project_rule" ? "project_rule" : "spec_evolution";
  const path = optionalString(payload.path)
    ?? (input.action === "write_project_rule"
      ? `.autobuild/rules/${input.entityId}.json`
      : `.autobuild/spec-evolution/${input.entityId}.json`);
  const summary = optionalString(payload.summary) ?? optionalString(payload.body) ?? input.reason;
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO evidence_packs (id, run_id, task_id, feature_id, path, kind, summary, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        optionalString(payload.runId) ?? null,
        optionalString(payload.taskId) ?? null,
        featureId ?? null,
        path,
        kind,
        summary,
        JSON.stringify({
          commandAction: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          projectId,
          requestedBy: input.requestedBy,
          reason: input.reason,
          payload,
        }),
        acceptedAt,
      ],
    },
  ]);
  return id;
}

function executeReviewCommand(dbPath: string, input: ConsoleCommandInput, acceptedAt: string): ReturnType<typeof recordApprovalDecision> | undefined {
  if (input.entityType !== "review_item") {
    return undefined;
  }
  const item = listReviewCenterItems(dbPath).find((entry) => entry.id === input.entityId);
  const decisionInput = reviewDecisionInputForCommand(input, item);
  if (!decisionInput) {
    return undefined;
  }
  return recordApprovalDecision(dbPath, {
    reviewItemId: input.entityId,
    decision: decisionInput.decision,
    actor: input.requestedBy,
    reason: input.reason,
    targetStatus: decisionInput.targetStatus,
    evidence: optionalString(input.payload?.evidence),
    now: new Date(acceptedAt),
    metadata: input.payload,
  });
}

function reviewDecisionInputForCommand(input: ConsoleCommandInput, item?: ReturnType<typeof listReviewCenterItems>[number]): Pick<RecordApprovalInput, "decision" | "targetStatus"> | undefined {
  const payloadTargetStatus = optionalString(input.payload?.targetStatus) as RecordApprovalInput["targetStatus"] | undefined;
  switch (input.action) {
    case "approve_review":
      return { decision: "approve_continue", targetStatus: payloadTargetStatus ?? defaultApproveStatus(item) };
    case "mark_review_complete":
      return { decision: "mark_complete", targetStatus: payloadTargetStatus ?? defaultCompleteStatus(item) };
    case "reject_review":
      return { decision: "reject", targetStatus: payloadTargetStatus };
    case "request_review_changes":
      return { decision: "request_changes", targetStatus: payloadTargetStatus ?? defaultChangesRequestedStatus(item) };
    case "rollback_review":
      return { decision: "rollback", targetStatus: payloadTargetStatus ?? "failed" };
    case "split_review_task":
      return { decision: "split_task", targetStatus: payloadTargetStatus ?? "blocked" };
    case "update_spec":
      return { decision: "update_spec", targetStatus: payloadTargetStatus ?? defaultChangesRequestedStatus(item) };
    default:
      return undefined;
  }
}

function defaultApproveStatus(item: ReturnType<typeof listReviewCenterItems>[number] | undefined): RecordApprovalInput["targetStatus"] | undefined {
  if (item?.taskId) {
    const pausedStatus = item.body.pausedTaskStatus;
    return pausedStatus && ["backlog", "ready", "scheduled", "running", "checking"].includes(pausedStatus)
      ? pausedStatus
      : pausedStatus === "failed" || pausedStatus === "blocked" || pausedStatus === "done" || pausedStatus === "delivered"
        ? undefined
        : "ready";
  }
  if (item?.featureId) {
    const pausedStatus = item.body.pausedFeatureStatus;
    return pausedStatus && !["draft", "review_needed", "failed", "blocked", "done", "delivered"].includes(pausedStatus)
      ? pausedStatus
      : pausedStatus === "failed" || pausedStatus === "blocked" || pausedStatus === "done" || pausedStatus === "delivered"
        ? undefined
        : "ready";
  }
  return "ready";
}

function defaultCompleteStatus(item: ReturnType<typeof listReviewCenterItems>[number] | undefined): RecordApprovalInput["targetStatus"] | undefined {
  const pausedStatus = item?.taskId ? item.body.pausedTaskStatus : item?.featureId ? item.body.pausedFeatureStatus : undefined;
  if (pausedStatus === "done" || pausedStatus === "delivered") {
    return pausedStatus;
  }
  return undefined;
}

function defaultChangesRequestedStatus(item: ReturnType<typeof listReviewCenterItems>[number] | undefined): RecordApprovalInput["targetStatus"] | undefined {
  if (item?.taskId) {
    const pausedStatus = item.body.pausedTaskStatus;
    return pausedStatus && ["backlog", "ready", "scheduled", "running", "checking"].includes(pausedStatus)
      ? pausedStatus
      : pausedStatus === "failed" || pausedStatus === "blocked" || pausedStatus === "done" || pausedStatus === "delivered"
        ? undefined
        : "ready";
  }
  if (item?.featureId) {
    const pausedStatus = item.body.pausedFeatureStatus;
    return pausedStatus && !["draft", "review_needed", "ready", "failed", "blocked", "done", "delivered"].includes(pausedStatus)
      ? pausedStatus
      : pausedStatus === "failed" || pausedStatus === "blocked" || pausedStatus === "done" || pausedStatus === "delivered"
        ? undefined
        : "planning";
  }
  return "ready";
}

function buildBoardCounts(rows: Record<string, unknown>[]): DashboardQueryModel["boardCounts"] {
  const counts = Object.fromEntries([...BOARD_COLUMNS, "unknown"].map((column) => [column, 0])) as DashboardQueryModel["boardCounts"];
  for (const row of rows) {
    const status = String(row.status);
    const key = BOARD_COLUMNS.has(status) ? status : "unknown";
    counts[key as BoardColumn | "unknown"] += 1;
  }
  return counts;
}

function countBy(rows: Record<string, unknown>[], column: string, value: string): number {
  return rows.filter((row) => String(row[column]) === value).length;
}

function sumMetrics(rows: Record<string, unknown>[], name: string): number {
  return rows.filter((row) => row.metric_name === name).reduce((sum, row) => sum + Number(row.metric_value), 0);
}

function latestMetric(rows: Record<string, unknown>[], name: string): number {
  const row = [...rows].reverse().find((entry) => entry.metric_name === name);
  return row ? Number(row.metric_value) : 0;
}

function latestRunnerStatuses(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const latest: Record<string, unknown>[] = [];
  for (const row of rows) {
    const runnerId = String(row.runner_id);
    if (!seen.has(runnerId)) {
      seen.add(runnerId);
      latest.push(row);
    }
  }
  return latest;
}

function latestRunQueueStatuses(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const latest: Record<string, unknown>[] = [];
  for (const row of rows) {
    const runId = String(row.run_id);
    if (!seen.has(runId)) {
      seen.add(runId);
      latest.push(row);
    }
  }
  return latest.slice(0, 10);
}

function extractRecentPullRequests(evidenceRows: Record<string, unknown>[]): DashboardQueryModel["recentPullRequests"] {
  return evidenceRows
    .map((row) => parseJsonObject(row.metadata_json).pullRequest as Record<string, unknown> | undefined)
    .filter((pullRequest): pullRequest is Record<string, unknown> => Boolean(pullRequest))
    .map((pullRequest) => ({
      id: String(pullRequest.id ?? pullRequest.number ?? ""),
      title: String(pullRequest.title ?? ""),
      url: optionalString(pullRequest.url),
      createdAt: optionalString(pullRequest.createdAt),
    }))
    .filter((pullRequest) => pullRequest.id || pullRequest.title)
    .slice(0, 5);
}

function extractRisks(reviewRows: Record<string, unknown>[], runRows: Record<string, unknown>[]): DashboardQueryModel["risks"] {
  const reviewRisks = reviewRows
    .filter((row) => ["high", "critical"].includes(String(row.severity)))
    .map((row) => {
      const body = parseJsonObject(row.body);
      return {
        level: String(row.severity) as RiskLevel | "unknown",
        message: typeof body.message === "string" ? body.message : String(row.body),
        source: String(row.id),
      };
    });
  const failedRuns = runRows
    .filter((row) => String(row.status) === "failed")
    .map((row) => ({ level: "medium" as const, message: `Run ${String(row.id)} failed.`, source: String(row.id) }));
  return [...reviewRisks, ...failedRuns].slice(0, 10);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function elapsedMs(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonArray(value: unknown): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : String(value);
}

function requirePayloadString(payload: Record<string, unknown>, key: string): string {
  const value = optionalString(payload[key]);
  if (!value) {
    throw new Error(`Missing payload.${key}`);
  }
  return value;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function normalizeFeatureStatus(value: unknown): FeatureLifecycleStatus {
  const status = String(value);
  return [
    "draft",
    "ready",
    "planning",
    "tasked",
    "implementing",
    "done",
    "delivered",
    "review_needed",
    "blocked",
    "failed",
  ].includes(status)
    ? status as FeatureLifecycleStatus
    : "draft";
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireCommandString(input: Record<string, unknown>, key: keyof ConsoleCommandInput): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Console command requires ${String(key)}.`);
  }
  return value.trim();
}

function normalizeCommandTime(value: ConsoleCommandInput["now"]): Date {
  if (value === undefined) {
    return new Date();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Console command requires a valid now timestamp.");
  }
  return date;
}
