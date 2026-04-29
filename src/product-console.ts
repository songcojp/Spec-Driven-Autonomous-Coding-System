import { randomUUID } from "node:crypto";
import { recordAuditEvent, recordMetricSample } from "./persistence.ts";
import { runSqlite } from "./sqlite.ts";
import {
  createScheduleTrigger,
  persistSelectionDecision,
  persistScheduleTrigger,
  selectNextFeature,
  transitionTask,
  type BoardColumn,
  type FeatureCandidate,
  type FeatureLifecycleStatus,
  type RiskLevel,
  type ScheduleTriggerMode,
} from "./orchestration.ts";
import {
  DEFAULT_CLI_ADAPTER_CONFIG,
  dryRunCliAdapterConfig,
  normalizeCliAdapterConfig,
  validateCliAdapterConfig,
  type CliAdapterConfig,
  type CliAdapterValidationResult,
  type RunnerApprovalPolicy,
  type RunnerQueueStatus,
  type RunnerSandboxMode,
} from "./codex-runner.ts";
import { assertApprovalPresentForTerminalStatus, listReviewCenterItems, recordApprovalDecision, type RecordApprovalInput, type ReviewDecision, type ReviewTrigger } from "./review-center.ts";

export type ConsoleCommandAction =
  | "create_feature"
  | "connect_git_repository"
  | "initialize_spec_protocol"
  | "import_or_create_constitution"
  | "initialize_project_memory"
  | "scan_prd_source"
  | "upload_prd_source"
  | "generate_ears"
  | "generate_hld"
  | "split_feature_specs"
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
  | "validate_cli_adapter_config"
  | "save_cli_adapter_config"
  | "activate_cli_adapter_config"
  | "disable_cli_adapter_config"
  | "write_project_rule"
  | "write_spec_evolution"
  | "move_board_task"
  | "schedule_board_tasks"
  | "run_board_tasks";

const CONSOLE_COMMAND_ACTIONS = new Set<ConsoleCommandAction>([
  "create_feature",
  "connect_git_repository",
  "initialize_spec_protocol",
  "import_or_create_constitution",
  "initialize_project_memory",
  "scan_prd_source",
  "upload_prd_source",
  "generate_ears",
  "generate_hld",
  "split_feature_specs",
  "pause_runner",
  "resume_runner",
  "approve_review",
  "reject_review",
  "request_review_changes",
  "rollback_review",
  "split_review_task",
  "update_spec",
  "mark_review_complete",
  "schedule_run",
  "validate_cli_adapter_config",
  "save_cli_adapter_config",
  "activate_cli_adapter_config",
  "disable_cli_adapter_config",
  "write_project_rule",
  "write_spec_evolution",
  "move_board_task",
  "schedule_board_tasks",
  "run_board_tasks",
]);

export type ConsoleCommandStatus = "accepted" | "blocked";

export type ConsoleCommandInput = {
  action: ConsoleCommandAction;
  entityType: "project" | "feature" | "task" | "run" | "runner" | "review_item" | "rule" | "spec" | "cli_adapter" | "settings";
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
  blockedReasons?: string[];
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
  activeRuns: number;
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

export type ProjectOverviewModel = {
  summary: {
    totalProjects: number;
    healthyProjects: number;
    blockedProjects: number;
    failedTasks: number;
    pendingReviews: number;
    onlineRunners: number;
    totalCostUsd: number;
  };
  projects: Array<{
    id: string;
    name: string;
    health: "ready" | "blocked" | "failed";
    repository: string;
    projectDirectory: string;
    defaultBranch: string;
    activeFeature?: { id: string; title: string; status: string };
    taskCounts: Record<BoardColumn | "unknown", number>;
    failedTasks: number;
    pendingReviews: number;
    activeRuns: number;
    runnerSuccessRate: number;
    costUsd: number;
    latestRisk?: { level: RiskLevel | "unknown"; message: string; source: string };
    lastActivityAt: string;
  }>;
  signals: Array<{ id: string; title: string; tone: "amber" | "red" | "blue"; message: string; updatedAt?: string }>;
  factSources: string[];
};

export type DashboardBoardViewModel = {
  tasks: Array<{
    id: string;
    featureId?: string;
    title: string;
    status: BoardColumn | "unknown";
    risk: RiskLevel | "unknown";
    dependencies: Array<{ id: string; status: BoardColumn | "unknown"; satisfied: boolean }>;
    diff?: unknown;
    testResults?: unknown;
    approvalStatus: "approved" | "pending" | "not_required";
    recoveryHistory: Array<{ from?: string; to?: string; reason: string; evidence?: string; occurredAt: string }>;
    blockedReasons: string[];
  }>;
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
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
  prdWorkflow: {
    targetRepoPath?: string;
    sourcePath: string;
    resolvedSourcePath?: string;
    sourceName?: string;
    sourceVersion?: string;
    scanMode?: string;
    lastScanAt?: string;
    runtime?: string;
    blockedReasons: string[];
    phases: Array<{
      key: "project_initialization" | "requirement_intake" | "feature_planning";
      status: "pending" | "accepted" | "blocked" | "completed";
      updatedAt?: string;
      blockedReasons: string[];
      facts: Array<{ label: string; value: string }>;
      stages: Array<{
        key: string;
        action?: ConsoleCommandAction;
        status: "pending" | "accepted" | "blocked" | "completed";
        updatedAt?: string;
        auditEventId?: string;
        evidencePath?: string;
        blockedReason?: string;
      }>;
    }>;
    stages: Array<{
      key: string;
      action: ConsoleCommandAction;
      status: "pending" | "accepted" | "blocked" | "completed";
      updatedAt?: string;
      auditEventId?: string;
      evidencePath?: string;
    }>;
  };
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

export type RunnerConsoleViewModel = {
  summary: {
    onlineRunners: number;
    runningTasks: number;
    readyTasks: number;
    blockedTasks: number;
    successRate: number;
    failureRate: number;
  };
  lanes: {
    ready: RunnerScheduleTaskViewModel[];
    scheduled: RunnerScheduleTaskViewModel[];
    running: RunnerScheduleTaskViewModel[];
    blocked: RunnerScheduleTaskViewModel[];
  };
  recentTriggers: Array<{
    id: string;
    action: string;
    target: string;
    result: string;
    createdAt: string;
  }>;
  factSources: string[];
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
  adapterSummary: CliAdapterSummary;
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
};

export type CliAdapterSummary = {
  id: string;
  displayName: string;
  status: string;
  schemaVersion: number;
  executable: string;
  lastDryRunStatus?: string;
  lastDryRunAt?: string;
  lastDryRunErrors: string[];
  settingsPath: string;
};

export type SystemSettingsViewModel = {
  cliAdapter: {
    active: CliAdapterConfig;
    draft?: CliAdapterConfig;
    validation: CliAdapterValidationResult;
    lastDryRun?: {
      status: string;
      errors: string[];
      command?: string;
      args?: string[];
      at?: string;
    };
  };
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
  factSources: string[];
};

export type RunnerScheduleTaskViewModel = {
  id: string;
  featureId?: string;
  featureTitle?: string;
  title: string;
  status: BoardColumn | "unknown";
  risk: RiskLevel | "unknown";
  dependencies: Array<{ id: string; status: BoardColumn | "unknown"; satisfied: boolean }>;
  approvalStatus: "approved" | "pending" | "not_required";
  runnerId?: string;
  runId?: string;
  action: "schedule" | "run" | "review" | "observe";
  blockedReasons: string[];
  recentLog?: string;
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

export function buildProjectOverview(dbPath: string): ProjectOverviewModel {
  const result = runSqlite(dbPath, [], [
    {
      name: "projects",
      sql: `SELECT p.id, p.name, p.status, p.target_repo_path, p.default_branch, p.updated_at,
          rc.remote_url, rc.local_path
        FROM projects p
        LEFT JOIN repository_connections rc ON rc.project_id = p.id
          AND rc.connected_at = (
            SELECT MAX(connected_at) FROM repository_connections latest WHERE latest.project_id = p.id
          )
        ORDER BY COALESCE(p.updated_at, p.created_at, '') DESC, p.name`,
    },
    {
      name: "features",
      sql: `SELECT id, project_id, title, status, COALESCE(priority, 0) AS priority, COALESCE(updated_at, created_at) AS activity_at
        FROM features
        ORDER BY priority DESC, COALESCE(updated_at, created_at, '') DESC`,
    },
    {
      name: "graphTasks",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, t.status, t.risk, COALESCE(t.updated_at, t.created_at) AS activity_at
        FROM task_graph_tasks t
        LEFT JOIN features f ON f.id = t.feature_id`,
    },
    {
      name: "tasks",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, t.status, 'unknown' AS risk, t.created_at AS activity_at
        FROM tasks t
        LEFT JOIN features f ON f.id = t.feature_id`,
    },
    {
      name: "runs",
      sql: `SELECT r.id, r.task_id, r.feature_id, COALESCE(r.project_id, f.project_id) AS project_id, r.status, r.started_at
        FROM runs r
        LEFT JOIN features f ON f.id = r.feature_id
        ORDER BY COALESCE(r.started_at, '') DESC`,
    },
    {
      name: "heartbeats",
      sql: `SELECT hb.runner_id, hb.status, hb.beat_at, COALESCE(r.project_id, f.project_id) AS project_id
        FROM runner_heartbeats hb
        LEFT JOIN runs r ON r.id = hb.run_id
        LEFT JOIN features f ON f.id = r.feature_id
        ORDER BY hb.beat_at DESC`,
    },
    {
      name: "reviews",
      sql: `SELECT ri.id, ri.status, ri.severity, ri.body, ri.created_at,
          COALESCE(ri.project_id, f.project_id, tf.project_id, gtf.project_id, r.project_id) AS project_id
        FROM review_items ri
        LEFT JOIN features f ON f.id = ri.feature_id
        LEFT JOIN tasks t ON t.id = ri.task_id
        LEFT JOIN features tf ON tf.id = t.feature_id
        LEFT JOIN task_graph_tasks gt ON gt.id = ri.task_id
        LEFT JOIN features gtf ON gtf.id = gt.feature_id
        LEFT JOIN runs r ON r.id = ri.run_id
        ORDER BY ri.created_at DESC`,
    },
    { name: "metrics", sql: "SELECT metric_name, metric_value, labels_json FROM metric_samples ORDER BY sampled_at, rowid" },
  ]);

  const projectRows = result.queries.projects;
  const graphTasksByProject = groupByProject(result.queries.graphTasks);
  const fallbackTasksByProject = groupByProject(result.queries.tasks);
  const featuresByProject = groupByProject(result.queries.features);
  const runsByProject = groupByProject(result.queries.runs);
  const reviewsByProject = groupByProject(result.queries.reviews);
  const metricsByProject = groupMetricsByProject(result.queries.metrics);
  const latestHeartbeats = latestRunnerStatuses(result.queries.heartbeats);
  const heartbeatsByProject = groupByProject(latestHeartbeats);

  const projects = projectRows.map((project) => {
    const projectId = String(project.id);
    const featureRows = featuresByProject.get(projectId) ?? [];
    const taskRows = graphTasksByProject.get(projectId)?.length
      ? graphTasksByProject.get(projectId) ?? []
      : fallbackTasksByProject.get(projectId) ?? [];
    const reviewRows = reviewsByProject.get(projectId) ?? [];
    const runRows = runsByProject.get(projectId) ?? [];
    const metricRows = metricsByProject.get(projectId) ?? [];
    const riskRows = overviewRisks(reviewRows, runRows);
    const activeFeature = featureRows.find((row) => !["done", "delivered"].includes(String(row.status)));
    const health = normalizeProjectHealth(project.status);
    return {
      id: projectId,
      name: String(project.name),
      health,
      repository: optionalString(project.remote_url) ?? optionalString(project.target_repo_path) ?? "",
      projectDirectory: optionalString(project.local_path) ?? optionalString(project.target_repo_path) ?? "",
      defaultBranch: String(project.default_branch ?? "main"),
      activeFeature: activeFeature
        ? { id: String(activeFeature.id), title: String(activeFeature.title), status: String(activeFeature.status) }
        : undefined,
      taskCounts: buildBoardCounts(taskRows),
      failedTasks: countBy(taskRows, "status", "failed"),
      pendingReviews: reviewRows.filter((row) => pendingReviewStatuses.has(String(row.status))).length,
      activeRuns: countBy(runRows, "status", "running"),
      runnerSuccessRate: latestMetric(metricRows, "success_rate"),
      costUsd: sumMetrics(metricRows, "cost_usd"),
      latestRisk: riskRows[0],
      lastActivityAt: latestActivityAt([
        project.updated_at,
        ...featureRows.map((row) => row.activity_at),
        ...taskRows.map((row) => row.activity_at),
        ...runRows.map((row) => row.started_at),
        ...reviewRows.map((row) => row.created_at),
      ]),
    };
  });

  const pendingReviews = projects.reduce((sum, project) => sum + project.pendingReviews, 0);
  const failedTasks = projects.reduce((sum, project) => sum + project.failedTasks, 0);
  const onlineRunners = latestHeartbeats.filter((row) => String(row.status) === "online").length;
  return {
    summary: {
      totalProjects: projects.length,
      healthyProjects: projects.filter((project) => project.health === "ready").length,
      blockedProjects: projects.filter((project) => project.health === "blocked").length,
      failedTasks,
      pendingReviews,
      onlineRunners,
      totalCostUsd: projects.reduce((sum, project) => sum + project.costUsd, 0),
    },
    projects,
    signals: [
      {
        id: "pending-reviews",
        title: "pending_reviews",
        tone: "amber",
        message: `${pendingReviews} unresolved review item${pendingReviews === 1 ? "" : "s"} across ${projects.filter((project) => project.pendingReviews > 0).length} project${projects.filter((project) => project.pendingReviews > 0).length === 1 ? "" : "s"}.`,
      },
      {
        id: "blocked-tasks",
        title: "blocked_tasks",
        tone: failedTasks > 0 ? "red" : "amber",
        message: `${projects.reduce((sum, project) => sum + (project.taskCounts.blocked ?? 0), 0)} blocked and ${failedTasks} failed task${failedTasks === 1 ? "" : "s"} across active projects.`,
      },
      {
        id: "runner-health",
        title: "runner_health",
        tone: "blue",
        message: `${onlineRunners}/${latestHeartbeats.length} runner${latestHeartbeats.length === 1 ? "" : "s"} online.`,
      },
    ],
    factSources: ["projects", "features", "task_graph_tasks", "tasks", "runs", "runner_heartbeats", "review_items", "metric_samples"],
  };
}

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
    activeRuns: countBy(runs, "status", "running"),
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

export function buildDashboardBoardView(dbPath: string, projectId?: string): DashboardBoardViewModel {
  const graphProjectFilter = projectId ? "WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?)" : "";
  const taskProjectFilter = projectId ? "WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?)" : "";
  const params = projectId ? [projectId] : [];
  const result = runSqlite(dbPath, [], [
    {
      name: "graphTasks",
      sql: `SELECT id, feature_id, title, status, dependencies_json, risk FROM task_graph_tasks ${graphProjectFilter} ORDER BY feature_id, created_at, id`,
      params,
    },
    {
      name: "tasks",
      sql: `SELECT id, feature_id, title, status, depends_on_json AS dependencies_json, 'unknown' AS risk FROM tasks ${taskProjectFilter} ORDER BY feature_id, created_at, id`,
      params,
    },
    {
      name: "evidence",
      sql: `SELECT id, task_id, feature_id, kind, summary, path, metadata_json, created_at FROM evidence_packs ORDER BY created_at DESC`,
    },
    {
      name: "reviews",
      sql: `SELECT id, task_id, feature_id, status, severity, body, created_at FROM review_items ORDER BY created_at DESC`,
    },
    {
      name: "approvals",
      sql: `SELECT ar.*, ri.task_id, ri.feature_id FROM approval_records ar JOIN review_items ri ON ri.id = ar.review_item_id ORDER BY COALESCE(ar.decided_at, ar.created_at) DESC`,
    },
    {
      name: "transitions",
      sql: `SELECT entity_id, from_status, to_status, reason, evidence, occurred_at FROM state_transitions WHERE entity_type = 'task' ORDER BY occurred_at DESC`,
    },
    {
      name: "recoveryAttempts",
      sql: `SELECT task_id, action, strategy, command, status, summary, evidence_pack_json, attempted_at FROM recovery_attempts ORDER BY attempted_at DESC`,
    },
    {
      name: "forbiddenRetries",
      sql: `SELECT task_id, failed_strategy, failed_command, reason, evidence_pack_id, created_at FROM forbidden_retry_records ORDER BY created_at DESC`,
    },
  ]);
  const rows = result.queries.graphTasks.length > 0 ? result.queries.graphTasks : result.queries.tasks;
  const taskById = new Map(rows.map((row) => [String(row.id), row]));

  return {
    tasks: rows.map((row) => {
      const taskId = String(row.id);
      const dependencies = parseJsonArray(row.dependencies_json).map((dependency) => {
        const id = String(dependency);
        const dependencyStatus = normalizeBoardStatus(taskById.get(id)?.status);
        return {
          id,
          status: dependencyStatus,
          satisfied: dependencyStatus === "done" || dependencyStatus === "delivered",
        };
      });
      const evidence = result.queries.evidence.filter((entry) => entry.task_id === row.id || (!entry.task_id && entry.feature_id === row.feature_id));
      const reviews = result.queries.reviews.filter((entry) => entry.task_id === row.id || (!entry.task_id && entry.feature_id === row.feature_id));
      const approvals = result.queries.approvals.filter((entry) => entry.task_id === row.id || (!entry.task_id && entry.feature_id === row.feature_id));
      const latestReviewBody = parseJsonObject(reviews[0]?.body);
      const latestEvidenceMetadata = evidence.map((entry) => parseJsonObject(entry.metadata_json)).find((entry) => Object.keys(entry).length > 0) ?? {};
      return {
        id: taskId,
        featureId: optionalString(row.feature_id),
        title: String(row.title),
        status: normalizeBoardStatus(row.status),
        risk: normalizeRisk(row.risk),
        dependencies,
        diff: latestReviewBody.diff ?? latestEvidenceMetadata.diff,
        testResults: latestReviewBody.testResults ?? latestEvidenceMetadata.testResults,
        approvalStatus: approvalStatusForTask(row, reviews, approvals),
        recoveryHistory: recoveryHistoryForTask(taskId, result.queries.transitions, result.queries.recoveryAttempts, result.queries.forbiddenRetries),
        blockedReasons: boardBlockedReasons(row, taskById, reviews, approvals),
      };
    }),
    commands: [
      { action: "move_board_task", entityType: "task" },
      { action: "schedule_board_tasks", entityType: "feature" },
      { action: "run_board_tasks", entityType: "feature" },
    ],
    factSources: [
      "task_graph_tasks",
      "tasks",
      "review_items",
      "approval_records",
      "evidence_packs",
      "state_transitions",
    ],
  };
}

export function buildSpecWorkspaceView(dbPath: string, featureId?: string, projectId?: string): SpecWorkspaceViewModel {
  const featureFilter = projectId ? "WHERE project_id = ?" : "";
  const featureParams = projectId ? [projectId] : [];
  const result = runSqlite(dbPath, [], [
    {
      name: "projects",
      sql: `SELECT * FROM projects ${projectId ? "WHERE id = ?" : ""} ORDER BY created_at DESC LIMIT 1`,
      params: projectId ? [projectId] : [],
    },
    {
      name: "repositoryConnections",
      sql: `SELECT * FROM repository_connections ${projectId ? "WHERE project_id = ?" : ""} ORDER BY connected_at DESC LIMIT 1`,
      params: projectId ? [projectId] : [],
    },
    {
      name: "constitutions",
      sql: `SELECT * FROM project_constitutions ${projectId ? "WHERE project_id = ? AND status = 'active'" : "WHERE status = 'active'"} ORDER BY version DESC LIMIT 1`,
      params: projectId ? [projectId] : [],
    },
    {
      name: "memoryVersions",
      sql: "SELECT * FROM memory_version_records WHERE content LIKE ? ORDER BY created_at DESC LIMIT 1",
      params: projectId ? [`%${escapeLike(projectId)}%`] : ["%"],
    },
    {
      name: "healthChecks",
      sql: `SELECT * FROM project_health_checks ${projectId ? "WHERE project_id = ?" : ""} ORDER BY checked_at DESC LIMIT 1`,
      params: projectId ? [projectId] : [],
    },
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
      name: "featureEvidence",
      sql: "SELECT id, kind, summary, path, metadata_json FROM evidence_packs WHERE feature_id = ? ORDER BY created_at DESC",
      params: [featureId ?? ""],
    },
    {
      name: "deliveryReports",
      sql: "SELECT id, path, summary, created_at FROM delivery_reports WHERE feature_id = ? ORDER BY created_at DESC",
      params: [featureId ?? ""],
    },
    {
      name: "workflowAudit",
      sql: `SELECT id, entity_type, entity_id, event_type, reason, payload_json, created_at
        FROM audit_timeline_events
        WHERE event_type IN (
          'console_command_scan_prd_source',
          'console_command_upload_prd_source',
          'console_command_generate_ears',
          'console_command_generate_hld',
          'console_command_split_feature_specs',
          'console_command_schedule_run'
        )
        AND (
          (entity_type = 'project' AND entity_id = ?)
          OR (entity_type = 'feature' AND entity_id = ?)
          OR (entity_type = 'spec' AND entity_id = ?)
        )
        ORDER BY created_at DESC, rowid DESC
        LIMIT 30`,
      params: [projectId ?? "", featureId ?? "", featureId ?? ""],
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
  const evidence = result.queries.featureEvidence.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    summary: String(row.summary ?? ""),
    path: optionalString(row.path),
    metadata: parseJson(row.metadata_json),
  }));

  return {
    features,
    prdWorkflow: buildPrdWorkflow({
      auditRows: result.queries.workflowAudit,
      project: result.queries.projects[0],
      repositoryConnection: result.queries.repositoryConnections[0],
      constitution: result.queries.constitutions[0],
      memoryVersion: result.queries.memoryVersions[0],
      healthCheck: result.queries.healthChecks[0],
      features,
      selectedFeatureId: feature?.id,
      selectedFeatureStatus: feature?.status,
      selectedRequirementCount: result.queries.requirements.length,
    }),
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
            { item: "status_ready_for_scheduling", passed: Boolean(feature.status) && result.queries.taskGraphs.length > 0 },
          ],
          dataModels: evidence.filter((entry) => entry.kind === "data_model"),
          contracts: evidence.filter((entry) => entry.kind === "contract"),
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
      { action: "scan_prd_source", entityType: "project" },
      { action: "upload_prd_source", entityType: "project" },
      { action: "generate_ears", entityType: "project" },
      { action: "schedule_run", entityType: "project" },
      { action: "schedule_run", entityType: "feature" },
    ],
  };
}

function buildPrdWorkflow(input: {
  auditRows: Record<string, unknown>[];
  project?: Record<string, unknown>;
  repositoryConnection?: Record<string, unknown>;
  constitution?: Record<string, unknown>;
  memoryVersion?: Record<string, unknown>;
  healthCheck?: Record<string, unknown>;
  features: SpecWorkspaceViewModel["features"];
  selectedFeatureId?: string;
  selectedFeatureStatus?: string;
  selectedRequirementCount: number;
}): SpecWorkspaceViewModel["prdWorkflow"] {
  const stages: SpecWorkspaceViewModel["prdWorkflow"]["stages"] = [
    { key: "scan_prd", action: "scan_prd_source", status: "pending" },
    { key: "upload_prd", action: "upload_prd_source", status: "pending" },
    { key: "generate_ears", action: "generate_ears", status: "pending" },
  ];
  const latestByAction = new Map<ConsoleCommandAction, Record<string, unknown>>();
  for (const row of input.auditRows) {
    const action = String(row.event_type).replace(/^console_command_/, "") as ConsoleCommandAction;
    if (!latestByAction.has(action)) {
      latestByAction.set(action, row);
    }
  }

  const decoratedStages = stages.map((stage) => {
    const row = latestByAction.get(stage.action);
    if (!row) {
      return stage;
    }
    const payload = parseJsonObject(row.payload_json);
    const boardValidation = parseJsonObject(payload.boardValidation);
    const blockedReasons = arrayValue(boardValidation.blockedReasons).map(String);
    const commandPayload = parseJsonObject(payload.payload);
    return {
      ...stage,
      status: blockedReasons.length > 0 ? "blocked" as const : "accepted" as const,
      updatedAt: optionalString(row.created_at),
      auditEventId: optionalString(row.id),
      evidencePath: optionalString(commandPayload.evidencePath),
    };
  });

  const sourcePayload = [...latestByAction.values()]
    .map((row) => parseJsonObject(parseJsonObject(row.payload_json).payload))
    .find((payload) => optionalString(payload.sourcePath) || optionalString(payload.fileName)) ?? {};
  const allBlockedReasons = [...latestByAction.values()]
    .flatMap((row) => arrayValue(parseJsonObject(parseJsonObject(row.payload_json).boardValidation).blockedReasons).map(String));
  const project = input.project;
  const repositoryConnection = input.repositoryConnection;
  const constitution = input.constitution;
  const memoryVersion = input.memoryVersion;
  const healthCheck = input.healthCheck;
  const projectStatus = optionalString(project?.status);
  const projectPath = optionalString(repositoryConnection?.local_path) ?? optionalString(project?.target_repo_path);
  const healthReasons = parseJsonArray(healthCheck?.reasons_json).map(String);
  const isSpecProtocolMissing = healthReasons.includes("spec_protocol_directory_missing");
  const projectBlockedReasons = [
    ...healthReasons,
    ...(!project ? ["Create or import a project before Spec intake."] : []),
    ...(project && !repositoryConnection ? ["Connect a Git repository before Spec intake."] : []),
  ];
  const projectStageStatus = (done: boolean, blockedReason?: string): "pending" | "accepted" | "blocked" | "completed" => {
    if (done) {
      return "completed";
    }
    return blockedReason ? "blocked" : "pending";
  };
  const latestProjectUpdatedAt = optionalString(healthCheck?.checked_at)
    ?? optionalString(memoryVersion?.created_at)
    ?? optionalString(constitution?.created_at)
    ?? optionalString(repositoryConnection?.connected_at)
    ?? optionalString(project?.updated_at);
  const projectStages = [
    {
      key: "create_or_import_project",
      status: projectStageStatus(Boolean(project), "Create or import a project before Spec intake."),
      updatedAt: optionalString(project?.created_at),
      blockedReason: project ? undefined : "Create or import a project before Spec intake.",
    },
    {
      key: "connect_git_repository",
      action: "connect_git_repository",
      status: projectStageStatus(Boolean(repositoryConnection), project ? "Connect a Git repository before Spec intake." : undefined),
      updatedAt: optionalString(repositoryConnection?.connected_at),
      blockedReason: project && !repositoryConnection ? "Connect a Git repository before Spec intake." : undefined,
    },
    {
      key: "initialize_spec_protocol",
      action: "initialize_spec_protocol",
      status: projectStageStatus(Boolean(projectPath) && !isSpecProtocolMissing, project ? "Initialize .autobuild / Spec Protocol before Spec intake." : undefined),
      updatedAt: optionalString(healthCheck?.checked_at),
      blockedReason: project && (!projectPath || isSpecProtocolMissing) ? "Initialize .autobuild / Spec Protocol before Spec intake." : undefined,
    },
    {
      key: "import_or_create_constitution",
      action: "import_or_create_constitution",
      status: projectStageStatus(Boolean(constitution), undefined),
      updatedAt: optionalString(constitution?.created_at),
    },
    {
      key: "initialize_project_memory",
      action: "initialize_project_memory",
      status: projectStageStatus(Boolean(memoryVersion), undefined),
      updatedAt: optionalString(memoryVersion?.created_at),
    },
  ] satisfies SpecWorkspaceViewModel["prdWorkflow"]["phases"][number]["stages"];
  const stageStatusByKey = new Map(decoratedStages.map((stage) => [stage.key, stage.status]));
  const requirementIntakeStages = [
    ...decoratedStages,
    {
      key: "recognize_requirement_format",
      status: stageStatusByKey.get("scan_prd") === "completed" || stageStatusByKey.get("scan_prd") === "accepted" ? "completed" as const : "pending" as const,
      updatedAt: decoratedStages.find((stage) => stage.key === "scan_prd")?.updatedAt,
    },
    {
      key: "complete_clarifications",
      status: input.features.length > 0 ? "completed" as const : "pending" as const,
    },
    {
      key: "run_requirement_quality_check",
      status: input.selectedRequirementCount > 0 ? "completed" as const : "pending" as const,
    },
    {
      key: "feature_spec_pool",
      status: input.features.some((feature) => feature.status === "ready") ? "completed" as const : input.features.length > 0 ? "accepted" as const : "pending" as const,
    },
  ] satisfies SpecWorkspaceViewModel["prdWorkflow"]["phases"][number]["stages"];
  const projectPhaseStatus = projectStages.some((stage) => stage.status === "blocked")
    ? "blocked"
    : projectStages.every((stage) => stage.status === "completed")
      ? "completed"
      : "accepted";
  const intakeBlockedReasons = projectPhaseStatus === "blocked" ? ["Complete Stage 1 before requirement intake."] : [...new Set(allBlockedReasons)];
  const intakePhaseStatus = intakeBlockedReasons.length > 0
    ? "blocked"
    : requirementIntakeStages.some((stage) => stage.status === "accepted" || stage.status === "completed")
      ? "accepted"
      : "pending";
  const planningActionStages = [
    {
      key: "generate_hld",
      action: "generate_hld",
      status: latestByAction.has("generate_hld") ? "accepted" as const : "pending" as const,
      updatedAt: optionalString(latestByAction.get("generate_hld")?.created_at),
    },
    {
      key: "split_feature_specs",
      action: "split_feature_specs",
      status: latestByAction.has("split_feature_specs") ? "accepted" as const : "pending" as const,
      updatedAt: optionalString(latestByAction.get("split_feature_specs")?.created_at),
    },
    {
      key: "status_check",
      action: "schedule_run",
      status: "pending" as const,
    },
  ] satisfies SpecWorkspaceViewModel["prdWorkflow"]["phases"][number]["stages"];
  const planningBlockedReasons = intakePhaseStatus === "blocked"
    ? ["Complete Stage 2 before planning execution."]
    : [];
  const planningPhaseStatus = planningBlockedReasons.length > 0
    ? "blocked"
    : planningActionStages.some((stage) => stage.status === "accepted" || stage.status === "completed")
      ? "accepted"
      : "pending";

  return {
    targetRepoPath: optionalString(sourcePayload.targetRepoPath),
    sourcePath: optionalString(sourcePayload.sourcePath) ?? "docs/zh-CN/PRD.md",
    resolvedSourcePath: optionalString(sourcePayload.resolvedSourcePath),
    sourceName: optionalString(sourcePayload.fileName),
    sourceVersion: optionalString(sourcePayload.sourceVersion) ?? "v1.3.0",
    scanMode: optionalString(sourcePayload.scanMode) ?? "smart",
    lastScanAt: decoratedStages.find((stage) => stage.updatedAt)?.updatedAt,
    runtime: optionalString(sourcePayload.runtime) ?? "10m 24s",
    blockedReasons: [...new Set([...projectBlockedReasons, ...allBlockedReasons])],
    phases: [
      {
        key: "project_initialization",
        status: projectPhaseStatus,
        updatedAt: latestProjectUpdatedAt,
        blockedReasons: [...new Set(projectBlockedReasons)],
        facts: [
          { label: "Project", value: optionalString(project?.name) ?? "Not created" },
          { label: "Repository", value: projectPath ?? "Not connected" },
          { label: "Health", value: projectStatus ?? "unknown" },
        ],
        stages: projectStages,
      },
      {
        key: "requirement_intake",
        status: intakePhaseStatus,
        updatedAt: decoratedStages.find((stage) => stage.updatedAt)?.updatedAt,
        blockedReasons: intakeBlockedReasons,
        facts: [
          { label: "PRD", value: optionalString(sourcePayload.resolvedSourcePath) ?? optionalString(sourcePayload.sourcePath) ?? "docs/zh-CN/PRD.md" },
          { label: "Features", value: String(input.features.length) },
          { label: "Requirements", value: String(input.selectedRequirementCount) },
        ],
        stages: requirementIntakeStages,
      },
      {
        key: "feature_planning",
        status: planningPhaseStatus,
        updatedAt: planningActionStages.find((stage) => stage.updatedAt)?.updatedAt,
        blockedReasons: planningBlockedReasons,
        facts: [
          { label: "Feature", value: input.selectedFeatureId ?? "Not selected" },
          { label: "Status", value: input.selectedFeatureStatus ?? "unknown" },
          { label: "Command", value: "schedule_run" },
        ],
        stages: planningActionStages,
      },
    ],
    stages: decoratedStages,
  };
}

export function buildRunnerConsoleView(dbPath: string, now: Date = new Date(), projectId?: string): RunnerConsoleViewModel {
  const runProjectFilter = projectId ? "WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)" : "";
  const runProjectParams = projectId ? [projectId] : [];
  const featureProjectFilter = projectId ? "WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?)" : "";
  const taskProjectFilter = projectId ? "WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?)" : "";
  const projectParams = projectId ? [projectId] : [];
  const metricProjectFilter = projectId ? "WHERE labels_json LIKE ?" : "";
  const metricParams = projectId ? [`%"projectId":"${escapeLike(projectId)}"%`] : [];
  const triggerProjectFilter = projectId ? "WHERE project_id = ?" : "";
  const triggerParams = projectId ? [projectId] : [];
  const reviewProjectFilter = projectId
    ? `WHERE (
        project_id = ?
        OR feature_id IN (SELECT id FROM features WHERE project_id = ?)
        OR task_id IN (SELECT id FROM tasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?))
        OR task_id IN (SELECT id FROM task_graph_tasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?))
        OR run_id IN (SELECT id FROM runs WHERE project_id = ?)
      )`
    : "";
  const reviewParams = projectId ? [projectId, projectId, projectId, projectId, projectId] : [];
  const result = runSqlite(dbPath, [], [
    { name: "policies", sql: `SELECT * FROM runner_policies ${runProjectFilter} ORDER BY created_at DESC`, params: runProjectParams },
    { name: "heartbeats", sql: `SELECT * FROM runner_heartbeats ${runProjectFilter} ORDER BY beat_at DESC`, params: runProjectParams },
    { name: "logs", sql: `SELECT * FROM raw_execution_logs ${runProjectFilter} ORDER BY created_at DESC LIMIT 25`, params: runProjectParams },
    {
      name: "graphTasks",
      sql: `SELECT t.id, t.feature_id, f.title AS feature_title, t.title, t.status, t.dependencies_json, t.risk
        FROM task_graph_tasks t
        LEFT JOIN features f ON f.id = t.feature_id
        ${featureProjectFilter ? `WHERE t.feature_id IN (SELECT id FROM features WHERE project_id = ?)` : ""}
        ORDER BY t.updated_at DESC, t.created_at DESC, t.id`,
      params: projectParams,
    },
    {
      name: "tasks",
      sql: `SELECT t.id, t.feature_id, f.title AS feature_title, t.title, t.status, COALESCE(t.depends_on_json, '[]') AS dependencies_json, 'unknown' AS risk
        FROM tasks t
        LEFT JOIN features f ON f.id = t.feature_id
        ${taskProjectFilter ? `WHERE t.feature_id IN (SELECT id FROM features WHERE project_id = ?)` : ""}
        ORDER BY t.created_at DESC, t.id`,
      params: projectParams,
    },
    {
      name: "runs",
      sql: `SELECT id, task_id, feature_id, status, started_at FROM runs ${projectId ? "WHERE project_id = ?" : ""} ORDER BY COALESCE(started_at, '') DESC, id`,
      params: projectParams,
    },
    { name: "reviews", sql: `SELECT id, task_id, feature_id, status, severity FROM review_items ${reviewProjectFilter} ORDER BY created_at DESC`, params: reviewParams },
    {
      name: "approvals",
      sql: `SELECT ar.*, ri.task_id, ri.feature_id FROM approval_records ar JOIN review_items ri ON ri.id = ar.review_item_id ORDER BY COALESCE(ar.decided_at, ar.created_at) DESC`,
    },
    { name: "metrics", sql: `SELECT metric_name, metric_value, labels_json FROM metric_samples ${metricProjectFilter} ORDER BY sampled_at, rowid`, params: metricParams },
    {
      name: "triggers",
      sql: `SELECT id, mode, target_type, target_id, result, created_at FROM schedule_triggers ${triggerProjectFilter} ORDER BY created_at DESC, rowid DESC LIMIT 8`,
      params: triggerParams,
    },
    {
      name: "audit",
      sql: "SELECT id, entity_type, entity_id, event_type, payload_json, created_at FROM audit_timeline_events ORDER BY created_at DESC, rowid DESC LIMIT 20",
    },
    { name: "adapters", sql: "SELECT * FROM cli_adapter_configs ORDER BY updated_at DESC" },
  ]);
  const latestHeartbeats = latestRunnerStatuses(result.queries.heartbeats);
  const taskRows = result.queries.graphTasks.length > 0 ? result.queries.graphTasks : result.queries.tasks;
  const taskById = new Map(taskRows.map((row) => [String(row.id), row]));
  const latestRunsByTask = latestRunsForTasks(result.queries.runs);
  const latestHeartbeatsByRun = latestHeartbeatByRun(result.queries.heartbeats);
  const laneTasks = buildRunnerScheduleLanes({
    taskRows,
    taskById,
    runsByTask: latestRunsByTask,
    heartbeatsByRun: latestHeartbeatsByRun,
    logs: result.queries.logs,
    reviews: result.queries.reviews,
    approvals: result.queries.approvals,
  });
  const runners = latestHeartbeats.map((heartbeat) => {
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
  });
  const activeAdapter = adapterFromRows(result.queries.adapters, "active");
  const adapterSummary = buildCliAdapterSummary(activeAdapter, result.queries.adapters);

  return {
    summary: {
      onlineRunners: runners.filter((runner) => runner.online).length,
      runningTasks: laneTasks.running.length,
      readyTasks: laneTasks.ready.length,
      blockedTasks: laneTasks.blocked.length,
      successRate: latestMetric(result.queries.metrics, "success_rate"),
      failureRate: latestMetric(result.queries.metrics, "failure_rate"),
    },
    lanes: laneTasks,
    recentTriggers: [
      ...result.queries.triggers.map((row) => ({
        id: String(row.id),
        action: String(row.mode),
        target: `${String(row.target_type)}:${String(row.target_id ?? "")}`,
        result: String(row.result),
        createdAt: String(row.created_at),
      })),
      ...filterRunnerAuditEvents(result.queries.audit, taskRows, projectId).map((row) => ({
        id: String(row.id),
        action: String(row.event_type).replace(/^console_command_/, ""),
        target: `${String(row.entity_type)}:${String(row.entity_id)}`,
        result: optionalString(parseJsonObject(row.payload_json).status) ?? "recorded",
        createdAt: String(row.created_at),
      })),
    ].slice(0, 8),
    factSources: [
      "task_graph_tasks",
      "tasks",
      "runs",
      "runner_heartbeats",
      "runner_policies",
      "raw_execution_logs",
      "review_items",
      "approval_records",
      "audit_timeline_events",
      "metric_samples",
    ],
    runners,
    adapterSummary,
    commands: [
      { action: "pause_runner", entityType: "runner" },
      { action: "resume_runner", entityType: "runner" },
      { action: "schedule_run", entityType: "feature" },
      { action: "schedule_board_tasks", entityType: "feature" },
      { action: "run_board_tasks", entityType: "feature" },
    ],
  };
}

export function buildSystemSettingsView(dbPath: string): SystemSettingsViewModel {
  const result = runSqlite(dbPath, [], [
    { name: "adapters", sql: "SELECT * FROM cli_adapter_configs ORDER BY updated_at DESC" },
  ]);
  const active = adapterFromRows(result.queries.adapters, "active") ?? DEFAULT_CLI_ADAPTER_CONFIG;
  const draft = adapterFromRows(result.queries.adapters, "draft", false);
  const dryRun = latestAdapterDryRun(result.queries.adapters, draft?.id ?? active.id);
  return {
    cliAdapter: {
      active,
      draft,
      validation: validateCliAdapterConfig(draft ?? active),
      lastDryRun: dryRun,
    },
    commands: [
      { action: "validate_cli_adapter_config", entityType: "cli_adapter" },
      { action: "save_cli_adapter_config", entityType: "cli_adapter" },
      { action: "activate_cli_adapter_config", entityType: "cli_adapter" },
      { action: "disable_cli_adapter_config", entityType: "cli_adapter" },
    ],
    factSources: ["cli_adapter_configs", "audit_timeline_events"],
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
  if (!CONSOLE_COMMAND_ACTIONS.has(action)) {
    throw new Error(`Console command action is not supported: ${action}`);
  }
  const entityType = requireCommandString(input, "entityType") as ConsoleCommandInput["entityType"];
  const entityId = requireCommandString(input, "entityId");
  const requestedBy = requireCommandString(input, "requestedBy");
  const reason = requireCommandString(input, "reason");

  const acceptedAt = normalizeCommandTime(input.now).toISOString();
  const id = randomUUID();
  const boardValidation = validateBoardCommand(dbPath, input);
  const settingsValidation = executeCliAdapterCommand(dbPath, input, acceptedAt);
  const approvalRecord = executeReviewCommand(dbPath, input, acceptedAt);
  const scheduleResult = executeScheduleCommand(dbPath, input, acceptedAt);
  const writeArtifactId = executeConsoleWriteCommand(dbPath, input, acceptedAt);
  const blockedReasons = [...boardValidation.blockedReasons, ...(settingsValidation?.blockedReasons ?? [])];
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
      boardValidation,
      settingsValidation,
      payload: input.payload ?? {},
    },
  });

  return {
    id,
    action,
    status: blockedReasons.length > 0 ? "blocked" : "accepted",
    entityType,
    entityId,
    auditEventId,
    acceptedAt,
    approvalRecordId: approvalRecord?.id,
    scheduleTriggerId: scheduleResult?.triggerId,
    selectionDecisionId: scheduleResult?.selectionDecisionId,
    blockedReasons: blockedReasons.length > 0 ? blockedReasons : undefined,
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

function validateBoardCommand(dbPath: string, input: ConsoleCommandInput): { blockedReasons: string[] } {
  if (!["move_board_task", "schedule_board_tasks", "run_board_tasks"].includes(input.action)) {
    return { blockedReasons: [] };
  }
  const taskIds = boardCommandTaskIds(input);
  if (taskIds.length === 0) {
    return { blockedReasons: ["No board tasks selected."] };
  }
  if (taskScopedTaskIdsMismatch(input)) {
    return { blockedReasons: [`Task-scoped board command payload must match entity ${input.entityId}.`] };
  }
  const targetStatus = boardCommandTargetStatus(input);
  if (!targetStatus) {
    return { blockedReasons: ["Board command requires a valid targetStatus."] };
  }
  const result = runSqlite(dbPath, [], [
    {
      name: "graphTasks",
      sql: `SELECT id, feature_id, title, status, dependencies_json, risk FROM task_graph_tasks
        WHERE feature_id IN (SELECT feature_id FROM task_graph_tasks WHERE id IN (${placeholders(taskIds.length)}))
          OR id IN (${placeholders(taskIds.length)})`,
      params: [...taskIds, ...taskIds],
    },
    {
      name: "tasks",
      sql: `SELECT id, feature_id, title, status, depends_on_json AS dependencies_json, 'unknown' AS risk FROM tasks
        WHERE feature_id IN (SELECT feature_id FROM tasks WHERE id IN (${placeholders(taskIds.length)}))
          OR id IN (${placeholders(taskIds.length)})`,
      params: [...taskIds, ...taskIds],
    },
    { name: "reviews", sql: `SELECT id, task_id, feature_id, status, severity FROM review_items WHERE task_id IN (${placeholders(taskIds.length)})`, params: taskIds },
    {
      name: "approvals",
      sql: `SELECT ar.*, ri.task_id, ri.feature_id FROM approval_records ar JOIN review_items ri ON ri.id = ar.review_item_id
        WHERE ri.task_id IN (${placeholders(taskIds.length)})
          OR (
            ri.task_id IS NULL
            AND ri.feature_id IN (
              SELECT feature_id FROM task_graph_tasks WHERE id IN (${placeholders(taskIds.length)})
              UNION
              SELECT feature_id FROM tasks WHERE id IN (${placeholders(taskIds.length)})
            )
          )`,
      params: [...taskIds, ...taskIds, ...taskIds],
    },
    {
      name: "featureReviews",
      sql: `SELECT id, feature_id, status, severity FROM review_items
        WHERE task_id IS NULL
          AND feature_id IN (
            SELECT feature_id FROM task_graph_tasks WHERE id IN (${placeholders(taskIds.length)})
            UNION
            SELECT feature_id FROM tasks WHERE id IN (${placeholders(taskIds.length)})
          )`,
      params: [...taskIds, ...taskIds],
    },
  ]);
  const rows = result.queries.graphTasks.length > 0 ? result.queries.graphTasks : result.queries.tasks;
  const taskById = new Map(rows.map((row) => [String(row.id), row]));
  const blockedReasons: string[] = [];

  for (const taskId of taskIds) {
    const task = taskById.get(taskId);
    if (!task) {
      blockedReasons.push(`Task ${taskId} was not found.`);
      continue;
    }
    if (input.entityType === "feature" && task.feature_id !== input.entityId) {
      blockedReasons.push(`Task ${taskId} does not belong to feature ${input.entityId}.`);
      continue;
    }
    const from = normalizeBoardStatus(task.status);
    if (from === "unknown") {
      blockedReasons.push(`Task ${taskId} has unknown board status.`);
      continue;
    }
    try {
      transitionTask(taskId, from, targetStatus, {
        reason: input.reason,
        evidence: "product_console_board_command",
        triggeredBy: "product_console",
        occurredAt: normalizeCommandTime(input.now).toISOString(),
      });
    } catch (error) {
      blockedReasons.push(error instanceof Error ? error.message : String(error));
    }
    try {
      assertApprovalPresentForTerminalStatus(dbPath, { taskId, targetStatus });
    } catch (error) {
      blockedReasons.push(error instanceof Error ? error.message : String(error));
    }
    blockedReasons.push(...boardBlockedReasons(
      task,
      taskById,
      [...result.queries.reviews, ...result.queries.featureReviews],
      result.queries.approvals,
      targetStatus,
    ));
  }

  return { blockedReasons: [...new Set(blockedReasons)] };
}

function executeCliAdapterCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
): { blockedReasons: string[]; dryRun?: CliAdapterValidationResult } | undefined {
  if (!["validate_cli_adapter_config", "save_cli_adapter_config", "activate_cli_adapter_config", "disable_cli_adapter_config"].includes(input.action)) {
    return undefined;
  }
  const payload = isRecord(input.payload) ? input.payload : {};
  const adapterPayload = isRecord(payload.config) ? payload.config : {};
  const adapterId = optionalString(payload.adapterId) ?? optionalString(adapterPayload.id) ?? input.entityId;
  const current = adapterId ? adapterFromRows(readCliAdapterRows(dbPath), undefined, false, adapterId) : undefined;
  const config = normalizeCliAdapterConfig({ ...(current ?? DEFAULT_CLI_ADAPTER_CONFIG), ...adapterPayload, id: adapterId || DEFAULT_CLI_ADAPTER_CONFIG.id });
  const dryRun = dryRunCliAdapterConfig({ config });
  const blockedReasons = dryRun.valid ? [] : dryRun.errors;

  if (input.action === "validate_cli_adapter_config") {
    persistCliAdapterConfig(dbPath, { ...config, status: dryRun.valid ? config.status : "invalid", updatedAt: acceptedAt }, dryRun, false);
    return { blockedReasons, dryRun };
  }

  if (input.action === "save_cli_adapter_config") {
    persistCliAdapterConfig(dbPath, { ...config, status: dryRun.valid ? "draft" : "invalid", updatedAt: acceptedAt }, dryRun, false);
    return { blockedReasons, dryRun };
  }

  if (input.action === "activate_cli_adapter_config") {
    if (blockedReasons.length > 0) {
      persistCliAdapterConfig(dbPath, { ...config, status: "invalid", updatedAt: acceptedAt }, dryRun, false);
      return { blockedReasons, dryRun };
    }
    runSqlite(dbPath, [
      { sql: "UPDATE cli_adapter_configs SET status = 'disabled', updated_at = ? WHERE status = 'active' AND id <> ?", params: [acceptedAt, config.id] },
    ]);
    persistCliAdapterConfig(dbPath, { ...config, status: "active", updatedAt: acceptedAt }, dryRun, true);
    return { blockedReasons: [], dryRun };
  }

  if (input.action === "disable_cli_adapter_config") {
    const target = current ?? config;
    if (target.status === "active") {
      return { blockedReasons: ["Active CLI Adapter cannot be disabled until another adapter is active."] };
    }
    persistCliAdapterConfig(dbPath, { ...target, status: "disabled", updatedAt: acceptedAt }, undefined, false);
    return { blockedReasons: [] };
  }

  return undefined;
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

function groupByProject(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const projectId = optionalString(row.project_id);
    if (!projectId) {
      continue;
    }
    groups.set(projectId, [...groups.get(projectId) ?? [], row]);
  }
  return groups;
}

function groupMetricsByProject(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const projectId = optionalString(parseJsonObject(row.labels_json).projectId);
    if (!projectId) {
      continue;
    }
    groups.set(projectId, [...groups.get(projectId) ?? [], row]);
  }
  return groups;
}

function normalizeProjectHealth(value: unknown): ProjectOverviewModel["projects"][number]["health"] {
  const status = String(value);
  if (status === "ready" || status === "failed") {
    return status;
  }
  return "blocked";
}

function latestActivityAt(values: unknown[]): string {
  return values
    .map((value) => optionalString(value))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? "";
}

function overviewRisks(reviewRows: Record<string, unknown>[], runRows: Record<string, unknown>[]): ProjectOverviewModel["projects"][number]["latestRisk"][] {
  const reviewRisks = reviewRows
    .filter((row) => pendingReviewStatuses.has(String(row.status)))
    .map((row) => {
      const body = parseJsonObject(row.body);
      return {
        level: normalizeRisk(row.severity),
        message: typeof body.message === "string" ? body.message : String(row.body),
        source: String(row.id),
      };
    });
  const failedRuns = runRows
    .filter((row) => String(row.status) === "failed")
    .map((row) => ({ level: "medium" as const, message: `Run ${String(row.id)} failed.`, source: String(row.id) }));
  return [...reviewRisks, ...failedRuns].filter((risk) => Boolean(risk.message));
}

function boardBlockedReasons(
  task: Record<string, unknown>,
  taskById: Map<string, Record<string, unknown>>,
  reviewRows: Record<string, unknown>[],
  approvalRows: Record<string, unknown>[],
  targetStatus?: BoardColumn,
): string[] {
  const taskId = String(task.id);
  const reasons: string[] = [];
  const dependencyStatuses = parseJsonArray(task.dependencies_json).map((dependency) => {
    const dependencyId = String(dependency);
    const dependencyStatus = normalizeBoardStatus(taskById.get(dependencyId)?.status);
    return { dependencyId, dependencyStatus };
  });
  const unsatisfied = dependencyStatuses.filter((entry) => entry.dependencyStatus !== "done" && entry.dependencyStatus !== "delivered");
  if (targetStatus && dependencyGateApplies(targetStatus) && unsatisfied.length > 0) {
    reasons.push(`Dependencies are not done: ${unsatisfied.map((entry) => entry.dependencyId).join(", ")}.`);
  }
  const scopedReviews = reviewRows.filter((entry) => entry.task_id === task.id || (!entry.task_id && entry.feature_id === task.feature_id));
  const scopedApprovals = approvalRows.filter((entry) => entry.task_id === task.id || (!entry.task_id && entry.feature_id === task.feature_id));
  if (scopedReviews.some((entry) => pendingReviewStatuses.has(String(entry.status)))) {
    reasons.push(`Task ${taskId} has unresolved review approvals.`);
  }
  if (normalizeRisk(task.risk) === "high" && !hasPositiveApproval(scopedApprovals)) {
    reasons.push(`Task ${taskId} is high risk and requires approval.`);
  }
  return [...new Set(reasons)];
}

function recoveryHistoryForTask(
  taskId: string,
  transitionRows: Record<string, unknown>[],
  attemptRows: Record<string, unknown>[],
  forbiddenRows: Record<string, unknown>[],
): DashboardBoardViewModel["tasks"][number]["recoveryHistory"] {
  const transitions = transitionRows
    .filter((entry) => entry.entity_id === taskId)
    .map((entry) => ({
      from: optionalString(entry.from_status),
      to: optionalString(entry.to_status),
      reason: String(entry.reason ?? ""),
      evidence: optionalString(entry.evidence),
      occurredAt: String(entry.occurred_at),
    }));
  const attempts = attemptRows
    .filter((entry) => entry.task_id === taskId)
    .map((entry) => {
      const evidencePack = parseJsonObject(entry.evidence_pack_json);
      return {
        from: optionalString(entry.action),
        to: optionalString(entry.status),
        reason: `${String(entry.strategy)}: ${String(entry.summary)}`,
        evidence: optionalString(evidencePack.id) ?? optionalString(entry.command),
        occurredAt: String(entry.attempted_at),
      };
    });
  const forbidden = forbiddenRows
    .filter((entry) => entry.task_id === taskId)
    .map((entry) => ({
      from: optionalString(entry.failed_strategy),
      to: "forbidden_retry",
      reason: String(entry.reason),
      evidence: optionalString(entry.evidence_pack_id) ?? optionalString(entry.failed_command),
      occurredAt: String(entry.created_at),
    }));
  return [...attempts, ...forbidden, ...transitions].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function approvalStatusForTask(
  task: Record<string, unknown>,
  reviewRows: Record<string, unknown>[],
  approvalRows: Record<string, unknown>[],
): DashboardBoardViewModel["tasks"][number]["approvalStatus"] {
  if (reviewRows.some((entry) => pendingReviewStatuses.has(String(entry.status)))) {
    return "pending";
  }
  if (normalizeRisk(task.risk) === "high" && !hasPositiveApproval(approvalRows)) {
    return "pending";
  }
  return hasPositiveApproval(approvalRows) ? "approved" : "not_required";
}

function hasPositiveApproval(approvalRows: Record<string, unknown>[]): boolean {
  return approvalRows.some((entry) => ["approve_continue", "mark_complete"].includes(String(entry.decision)) && String(entry.status) === "recorded");
}

function boardCommandTaskIds(input: ConsoleCommandInput): string[] {
  const payload = isRecord(input.payload) ? input.payload : {};
  if (input.entityType === "task") {
    return [input.entityId];
  }
  const fromPayload = arrayValue(payload.taskIds).map(String);
  if (fromPayload.length > 0) {
    return fromPayload;
  }
  return input.entityType === "task" ? [input.entityId] : [];
}

function taskScopedTaskIdsMismatch(input: ConsoleCommandInput): boolean {
  if (input.entityType !== "task") {
    return false;
  }
  const payload = isRecord(input.payload) ? input.payload : {};
  const taskIds = arrayValue(payload.taskIds).map(String);
  return taskIds.length > 0 && taskIds.some((taskId) => taskId !== input.entityId);
}

function boardCommandTargetStatus(input: ConsoleCommandInput): BoardColumn | undefined {
  const payload = isRecord(input.payload) ? input.payload : {};
  const requested = input.action === "schedule_board_tasks"
    ? "scheduled"
    : input.action === "run_board_tasks"
      ? "running"
      : optionalString(payload.targetStatus);
  return normalizeBoardStatus(requested) === "unknown" ? undefined : normalizeBoardStatus(requested) as BoardColumn;
}

function normalizeBoardStatus(value: unknown): BoardColumn | "unknown" {
  const status = String(value ?? "");
  return BOARD_COLUMNS.has(status) ? status as BoardColumn : "unknown";
}

function normalizeRisk(value: unknown): RiskLevel | "unknown" {
  const risk = String(value ?? "");
  return risk === "low" || risk === "medium" || risk === "high" ? risk : "unknown";
}

function dependencyGateApplies(targetStatus: BoardColumn): boolean {
  return !["backlog", "blocked", "failed"].includes(targetStatus);
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
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

function latestRunsForTasks(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const taskId = optionalString(row.task_id);
    if (!taskId) {
      continue;
    }
    const existing = latest.get(taskId);
    if (!existing || runnerRunPriority(row) > runnerRunPriority(existing)) {
      latest.set(taskId, row);
    }
  }
  return latest;
}

function runnerRunPriority(row: Record<string, unknown>): number {
  const status = String(row.status);
  if (status === "running") {
    return 4;
  }
  if (status === "queued" || status === "scheduled") {
    return 3;
  }
  if (status === "failed" || status === "blocked") {
    return 2;
  }
  return 1;
}

function latestHeartbeatByRun(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const runId = optionalString(row.run_id);
    if (runId && !latest.has(runId)) {
      latest.set(runId, row);
    }
  }
  return latest;
}

function buildRunnerScheduleLanes(input: {
  taskRows: Record<string, unknown>[];
  taskById: Map<string, Record<string, unknown>>;
  runsByTask: Map<string, Record<string, unknown>>;
  heartbeatsByRun: Map<string, Record<string, unknown>>;
  logs: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
}): RunnerConsoleViewModel["lanes"] {
  const lanes: RunnerConsoleViewModel["lanes"] = { ready: [], scheduled: [], running: [], blocked: [] };
  for (const row of input.taskRows) {
    const taskId = String(row.id);
    const status = normalizeBoardStatus(row.status);
    const targetStatus = status === "ready" ? "scheduled" : status === "scheduled" ? "running" : undefined;
    const reviews = input.reviews.filter((entry) => entry.task_id === row.id || (!entry.task_id && entry.feature_id === row.feature_id));
    const approvals = input.approvals.filter((entry) => entry.task_id === row.id || (!entry.task_id && entry.feature_id === row.feature_id));
    const blockedReasons = boardBlockedReasons(row, input.taskById, input.reviews, input.approvals, targetStatus);
    const run = input.runsByTask.get(taskId);
    const heartbeat = run ? input.heartbeatsByRun.get(String(run.id)) : undefined;
    const log = run ? input.logs.find((entry) => entry.run_id === run.id) : undefined;
    const task = {
      id: taskId,
      featureId: optionalString(row.feature_id),
      featureTitle: optionalString(row.feature_title),
      title: String(row.title),
      status,
      risk: normalizeRisk(row.risk),
      dependencies: parseJsonArray(row.dependencies_json).map((dependency) => {
        const id = String(dependency);
        const dependencyStatus = normalizeBoardStatus(input.taskById.get(id)?.status);
        return {
          id,
          status: dependencyStatus,
          satisfied: dependencyStatus === "done" || dependencyStatus === "delivered",
        };
      }),
      approvalStatus: approvalStatusForTask(row, reviews, approvals),
      runnerId: optionalString(heartbeat?.runner_id),
      runId: optionalString(run?.id),
      action: runnerTaskAction(status, blockedReasons),
      blockedReasons,
      recentLog: optionalString(log?.stderr) ?? optionalString(log?.stdout),
    } satisfies RunnerScheduleTaskViewModel;

    if (["blocked", "failed", "review_needed"].includes(String(status)) || blockedReasons.length > 0) {
      lanes.blocked.push(task);
    } else if (status === "running" || status === "checking") {
      lanes.running.push(task);
    } else if (status === "scheduled") {
      lanes.scheduled.push(task);
    } else if (status === "ready" || status === "backlog") {
      lanes.ready.push(task);
    }
  }
  return {
    ready: lanes.ready.slice(0, 8),
    scheduled: lanes.scheduled.slice(0, 8),
    running: lanes.running.slice(0, 8),
    blocked: lanes.blocked.slice(0, 8),
  };
}

function runnerTaskAction(status: BoardColumn | "unknown", blockedReasons: string[]): RunnerScheduleTaskViewModel["action"] {
  if (blockedReasons.length > 0 || status === "review_needed" || status === "blocked" || status === "failed") {
    return "review";
  }
  if (status === "ready" || status === "backlog") {
    return "schedule";
  }
  if (status === "scheduled") {
    return "run";
  }
  return "observe";
}

function filterRunnerAuditEvents(
  rows: Record<string, unknown>[],
  taskRows: Record<string, unknown>[],
  projectId?: string,
): Record<string, unknown>[] {
  const featureIds = new Set(taskRows.map((row) => optionalString(row.feature_id)).filter((value): value is string => Boolean(value)));
  const taskIds = new Set(taskRows.map((row) => String(row.id)));
  return rows.filter((row) => {
    const eventType = String(row.event_type);
    if (!eventType.startsWith("console_command_")) {
      return false;
    }
    const entityType = String(row.entity_type);
    const entityId = String(row.entity_id);
    const payload = parseJsonObject(row.payload_json);
    return (
      entityType === "runner"
      || (entityType === "task" && taskIds.has(entityId))
      || (entityType === "feature" && featureIds.has(entityId))
      || (projectId !== undefined && optionalString(payload.projectId) === projectId)
    );
  });
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

function readCliAdapterRows(dbPath: string): Record<string, unknown>[] {
  return runSqlite(dbPath, [], [
    { name: "adapters", sql: "SELECT * FROM cli_adapter_configs ORDER BY updated_at DESC" },
  ]).queries.adapters;
}

function adapterFromRows(
  rows: Record<string, unknown>[],
  status: string | undefined = "active",
  fallbackToDefault = true,
  id?: string,
): CliAdapterConfig | undefined {
  const row = rows.find((entry) => {
    const statusMatches = status ? String(entry.status) === status : true;
    const idMatches = id ? String(entry.id) === id : true;
    return statusMatches && idMatches;
  });
  if (!row) {
    if (fallbackToDefault) return DEFAULT_CLI_ADAPTER_CONFIG;
    return undefined;
  }
  return cliAdapterFromRow(row);
}

function cliAdapterFromRow(row: Record<string, unknown>): CliAdapterConfig {
  return normalizeCliAdapterConfig({
    id: row.id,
    displayName: row.display_name,
    schemaVersion: row.schema_version,
    executable: row.executable,
    argumentTemplate: parseJsonArray(row.argument_template_json),
    resumeArgumentTemplate: parseJsonArray(row.resume_argument_template_json),
    configSchema: parseJsonObject(row.config_schema_json),
    formSchema: parseJsonObject(row.form_schema_json),
    defaults: parseJsonObject(row.defaults_json),
    environmentAllowlist: parseJsonArray(row.environment_allowlist_json),
    outputMapping: parseJsonObject(row.output_mapping_json),
    status: row.status,
    updatedAt: row.updated_at,
  });
}

function persistCliAdapterConfig(
  dbPath: string,
  config: CliAdapterConfig,
  dryRun?: CliAdapterValidationResult,
  active = false,
): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO cli_adapter_configs (
          id, display_name, schema_version, executable, argument_template_json, resume_argument_template_json,
          config_schema_json, form_schema_json, defaults_json, environment_allowlist_json, output_mapping_json,
          status, last_dry_run_status, last_dry_run_errors_json, last_dry_run_command_json, last_dry_run_at, activated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          schema_version = excluded.schema_version,
          executable = excluded.executable,
          argument_template_json = excluded.argument_template_json,
          resume_argument_template_json = excluded.resume_argument_template_json,
          config_schema_json = excluded.config_schema_json,
          form_schema_json = excluded.form_schema_json,
          defaults_json = excluded.defaults_json,
          environment_allowlist_json = excluded.environment_allowlist_json,
          output_mapping_json = excluded.output_mapping_json,
          status = excluded.status,
          last_dry_run_status = COALESCE(excluded.last_dry_run_status, cli_adapter_configs.last_dry_run_status),
          last_dry_run_errors_json = excluded.last_dry_run_errors_json,
          last_dry_run_command_json = COALESCE(excluded.last_dry_run_command_json, cli_adapter_configs.last_dry_run_command_json),
          last_dry_run_at = COALESCE(excluded.last_dry_run_at, cli_adapter_configs.last_dry_run_at),
          activated_at = COALESCE(excluded.activated_at, cli_adapter_configs.activated_at),
          updated_at = excluded.updated_at`,
      params: [
        config.id,
        config.displayName,
        config.schemaVersion,
        config.executable,
        JSON.stringify(config.argumentTemplate),
        JSON.stringify(config.resumeArgumentTemplate ?? []),
        JSON.stringify(config.configSchema),
        JSON.stringify(config.formSchema),
        JSON.stringify(config.defaults),
        JSON.stringify(config.environmentAllowlist),
        JSON.stringify(config.outputMapping),
        config.status,
        dryRun ? (dryRun.valid ? "passed" : "failed") : null,
        JSON.stringify(dryRun?.errors ?? []),
        dryRun?.command ? JSON.stringify({ command: dryRun.command, args: dryRun.args ?? [] }) : null,
        dryRun ? config.updatedAt : null,
        active ? config.updatedAt : null,
        config.updatedAt,
      ],
    },
  ]);
}

function buildCliAdapterSummary(active: CliAdapterConfig | undefined, rows: Record<string, unknown>[]): CliAdapterSummary {
  const adapter = active ?? DEFAULT_CLI_ADAPTER_CONFIG;
  const row = rows.find((entry) => String(entry.id) === adapter.id) ?? {};
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    status: adapter.status,
    schemaVersion: adapter.schemaVersion,
    executable: adapter.executable,
    lastDryRunStatus: optionalString(row.last_dry_run_status),
    lastDryRunAt: optionalString(row.last_dry_run_at),
    lastDryRunErrors: parseJsonArray(row.last_dry_run_errors_json).map(String),
    settingsPath: "/settings/cli",
  };
}

function latestAdapterDryRun(rows: Record<string, unknown>[], adapterId: string): SystemSettingsViewModel["cliAdapter"]["lastDryRun"] {
  const row = rows.find((entry) => String(entry.id) === adapterId);
  if (!row) return undefined;
  const command = parseJsonObject(row.last_dry_run_command_json);
  const status = optionalString(row.last_dry_run_status);
  if (!status) return undefined;
  return {
    status,
    errors: parseJsonArray(row.last_dry_run_errors_json).map(String),
    command: optionalString(command.command),
    args: parseJsonArray(command.args).map(String),
    at: optionalString(row.last_dry_run_at),
  };
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
  if (Array.isArray(value)) {
    return value;
  }
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : parseJsonArray(value);
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
