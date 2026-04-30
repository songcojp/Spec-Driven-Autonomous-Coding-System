import { randomUUID } from "node:crypto";
import { Queue, Worker, type JobsOptions, type Job } from "bullmq";
import IORedis from "ioredis";
import { runSqlite } from "./sqlite.ts";
import { recordAuditEvent } from "./persistence.ts";
import {
  persistSelectionDecision,
  persistStateTransition,
  selectNextFeature,
  transitionFeature,
  transitionTask,
  type BoardColumn,
  type FeatureCandidate,
  type FeatureLifecycleStatus,
  type RiskLevel,
  type ScheduleTriggerMode,
} from "./orchestration.ts";
import {
  buildEvidencePackInput,
  DEFAULT_CLI_ADAPTER_CONFIG,
  normalizeCliAdapterConfig,
  persistCodexRunnerArtifacts,
  processRunnerQueueItem,
  recordRunnerHeartbeat,
  resolveRunnerPolicy,
  type CliAdapterConfig,
  type CodexCommandRunner,
  type RunnerQueueStatus,
} from "./codex-runner.ts";

export const FEATURE_SCHEDULER_QUEUE = "specdrive:feature-scheduler";
export const CLI_RUNNER_QUEUE = "specdrive:cli-runner";
export const PLANNING_BRIDGE_NOT_IMPLEMENTED = "Planning skill execution bridge is not implemented";

export type SchedulerJobType = "feature.select" | "feature.plan" | "cli.run";
export type SchedulerJobStatus = "queued" | "running" | "completed" | "blocked" | "failed";

export type SchedulerEnqueueResult = {
  schedulerJobId: string;
  bullmqJobId: string;
  queueName: string;
  jobType: SchedulerJobType;
};

export type SchedulerHealth = {
  status: "ready" | "blocked";
  redisUrl?: string;
  reason?: string;
};

export type FeatureSelectJobPayload = {
  triggerId: string;
  projectId?: string;
  featureId?: string;
  target: { type: "project" | "feature" | "task"; id?: string };
  mode: ScheduleTriggerMode;
  requestedFor: string;
  createdAt: string;
};

export type FeaturePlanJobPayload = {
  triggerId?: string;
  projectId?: string;
  featureId: string;
  selectionDecisionId?: string;
};

export type CliRunJobPayload = {
  projectId?: string;
  featureId?: string;
  taskId: string;
  runId: string;
};

export type SchedulerClient = {
  enqueueFeatureSelect(payload: FeatureSelectJobPayload): SchedulerEnqueueResult;
  enqueueFeaturePlan(payload: FeaturePlanJobPayload): SchedulerEnqueueResult;
  enqueueCliRun(payload: CliRunJobPayload): SchedulerEnqueueResult;
  health?: () => SchedulerHealth;
  close?: () => Promise<void>;
};

export type SchedulerWorkers = {
  close: () => Promise<void>;
};

export function createBullMqScheduler(dbPath: string, redisUrl: string): SchedulerClient {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  let lastError: string | undefined;
  connection.on("error", (error) => {
    lastError = error.message;
  });
  connection.on("ready", () => {
    lastError = undefined;
  });
  const featureQueue = new Queue(FEATURE_SCHEDULER_QUEUE, { connection });
  const cliQueue = new Queue(CLI_RUNNER_QUEUE, { connection });

  return {
    enqueueFeatureSelect(payload) {
      const result = createQueuedJobRecord(dbPath, {
        queueName: FEATURE_SCHEDULER_QUEUE,
        jobType: "feature.select",
        targetType: payload.target.type,
        targetId: payload.target.id,
        payload,
      });
      void featureQueue.add("feature.select", { ...payload, schedulerJobId: result.schedulerJobId }, featureSelectJobOptions(payload, result.bullmqJobId))
        .catch((error) => markSchedulerJobFailed(dbPath, result.bullmqJobId, error));
      return result;
    },
    enqueueFeaturePlan(payload) {
      const result = createQueuedJobRecord(dbPath, {
        queueName: FEATURE_SCHEDULER_QUEUE,
        jobType: "feature.plan",
        targetType: "feature",
        targetId: payload.featureId,
        payload,
      });
      void featureQueue.add("feature.plan", { ...payload, schedulerJobId: result.schedulerJobId }, { jobId: result.bullmqJobId, attempts: 1 })
        .catch((error) => markSchedulerJobFailed(dbPath, result.bullmqJobId, error));
      return result;
    },
    enqueueCliRun(payload) {
      const result = createQueuedJobRecord(dbPath, {
        queueName: CLI_RUNNER_QUEUE,
        jobType: "cli.run",
        targetType: "task",
        targetId: payload.taskId,
        payload,
      });
      void cliQueue.add("cli.run", { ...payload, schedulerJobId: result.schedulerJobId }, { jobId: result.bullmqJobId, attempts: 1 })
        .catch((error) => markSchedulerJobFailed(dbPath, result.bullmqJobId, error));
      return result;
    },
    health() {
      return connection.status === "ready"
        ? { status: "ready", redisUrl }
        : { status: "blocked", redisUrl, reason: lastError ?? `Redis connection is ${connection.status}.` };
    },
    async close() {
      await Promise.all([featureQueue.close(), cliQueue.close(), connection.quit().catch(() => undefined)]);
    },
  };
}

export function createUnavailableScheduler(dbPath: string, reason: string): SchedulerClient {
  const enqueue = (jobType: SchedulerJobType, queueName: string, targetType: string, targetId: string | undefined, payload: unknown): SchedulerEnqueueResult => {
    const result = createQueuedJobRecord(dbPath, { queueName, jobType, targetType, targetId, payload });
    updateSchedulerJobRecord(dbPath, result.bullmqJobId, "blocked", reason);
    return result;
  };
  return {
    enqueueFeatureSelect(payload) {
      return enqueue("feature.select", FEATURE_SCHEDULER_QUEUE, payload.target.type, payload.target.id, payload);
    },
    enqueueFeaturePlan(payload) {
      return enqueue("feature.plan", FEATURE_SCHEDULER_QUEUE, "feature", payload.featureId, payload);
    },
    enqueueCliRun(payload) {
      return enqueue("cli.run", CLI_RUNNER_QUEUE, "task", payload.taskId, payload);
    },
    health() {
      return { status: "blocked", reason };
    },
  };
}

export function createMemoryScheduler(dbPath: string): SchedulerClient & { jobs: SchedulerEnqueueResult[] } {
  const jobs: SchedulerEnqueueResult[] = [];
  const enqueue = (jobType: SchedulerJobType, queueName: string, targetType: string, targetId: string | undefined, payload: unknown): SchedulerEnqueueResult => {
    const result = createQueuedJobRecord(dbPath, { queueName, jobType, targetType, targetId, payload });
    jobs.push(result);
    return result;
  };
  return {
    jobs,
    enqueueFeatureSelect(payload) {
      return enqueue("feature.select", FEATURE_SCHEDULER_QUEUE, payload.target.type, payload.target.id, payload);
    },
    enqueueFeaturePlan(payload) {
      return enqueue("feature.plan", FEATURE_SCHEDULER_QUEUE, "feature", payload.featureId, payload);
    },
    enqueueCliRun(payload) {
      return enqueue("cli.run", CLI_RUNNER_QUEUE, "task", payload.taskId, payload);
    },
    health() {
      return { status: "ready" };
    },
  };
}

export async function createSchedulerWorkers(input: {
  dbPath: string;
  redisUrl: string;
  scheduler?: SchedulerClient;
  runner?: CodexCommandRunner;
}): Promise<SchedulerWorkers> {
  const connection = new IORedis(input.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  connection.on("error", () => undefined);
  const scheduler = input.scheduler ?? createBullMqScheduler(input.dbPath, input.redisUrl);
  const featureWorker = new Worker(
    FEATURE_SCHEDULER_QUEUE,
    async (job) => dispatchFeatureJob(input.dbPath, scheduler, job),
    { connection },
  );
  const cliWorker = new Worker(
    CLI_RUNNER_QUEUE,
    async (job) => dispatchCliJob(input.dbPath, job, input.runner),
    { connection },
  );
  return {
    async close() {
      await Promise.all([
        featureWorker.close(),
        cliWorker.close(),
        scheduler.close?.() ?? Promise.resolve(),
        connection.quit().catch(() => undefined),
      ]);
    },
  };
}

export function runFeatureSelectJob(dbPath: string, scheduler: Pick<SchedulerClient, "enqueueFeaturePlan">, payload: FeatureSelectJobPayload): { decisionId: string; selectedFeatureId?: string } {
  const now = new Date();
  const candidates = loadLiveScheduleCandidates(dbPath, payload.projectId, payload.featureId);
  const completedFeatureIds = candidates
    .filter((candidate) => candidate.status === "done" || candidate.status === "delivered")
    .map((candidate) => candidate.id);
  const decision = persistSelectionDecision(
    dbPath,
    selectNextFeature(candidates, completedFeatureIds, `schedule_trigger:${payload.triggerId}`, now),
    payload.projectId,
  );
  if (!decision.selectedFeatureId) {
    return { decisionId: decision.id };
  }

  const current = candidates.find((candidate) => candidate.id === decision.selectedFeatureId);
  if (current?.status === "ready") {
    persistStateTransition(dbPath, transitionFeature(decision.selectedFeatureId, "ready", "planning", {
      reason: decision.reason,
      evidence: `feature_selection_decision:${decision.id}`,
      triggeredBy: "feature_scheduler",
      occurredAt: now.toISOString(),
    }));
    runSqlite(dbPath, [
      { sql: "UPDATE features SET status = ? WHERE id = ?", params: ["planning", decision.selectedFeatureId] },
    ]);
  }

  scheduler.enqueueFeaturePlan({
    triggerId: payload.triggerId,
    projectId: payload.projectId,
    featureId: decision.selectedFeatureId,
    selectionDecisionId: decision.id,
  });
  return { decisionId: decision.id, selectedFeatureId: decision.selectedFeatureId };
}

export function runFeaturePlanJob(dbPath: string, payload: FeaturePlanJobPayload): void {
  const now = new Date().toISOString();
  const row = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT id, status FROM features WHERE id = ? LIMIT 1", params: [payload.featureId] },
  ]).queries.feature[0];
  if (!row) {
    throw new Error(`Feature not found: ${payload.featureId}`);
  }
  const from = normalizeFeatureStatus(row.status);
  if (from !== "blocked") {
    persistStateTransition(dbPath, transitionFeature(payload.featureId, from, "blocked", {
      reason: PLANNING_BRIDGE_NOT_IMPLEMENTED,
      evidence: "feature.plan",
      triggeredBy: "feature_scheduler",
      occurredAt: now,
    }));
  }
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = ? WHERE id = ?", params: ["blocked", payload.featureId] },
  ]);
  recordAuditEvent(dbPath, {
    entityType: "feature",
    entityId: payload.featureId,
    eventType: "scheduler_job_blocked",
    source: "feature_scheduler",
    reason: PLANNING_BRIDGE_NOT_IMPLEMENTED,
    payload,
  });
}

export async function runCliRunJob(dbPath: string, payload: CliRunJobPayload, runner?: CodexCommandRunner): Promise<{ runId: string; status: RunnerQueueStatus }> {
  const loaded = loadRunnerTaskContext(dbPath, payload);
  const now = new Date();
  const policy = resolveRunnerPolicy({
    runId: payload.runId,
    risk: loaded.risk,
    workspaceRoot: loaded.workspaceRoot,
    model: loaded.adapter.defaults.model,
    profile: loaded.adapter.defaults.profile,
    requestedSandboxMode: loaded.adapter.defaults.sandbox,
    requestedApprovalPolicy: loaded.adapter.defaults.approval,
    now,
  });
  const heartbeat = recordRunnerHeartbeat({
    runId: payload.runId,
    runnerId: "bullmq-cli-runner",
    policy,
    queueStatus: "running",
    message: `Running ${payload.taskId}`,
    now,
  });
  persistCodexRunnerArtifacts(dbPath, { policy, heartbeat });
  transitionTaskIfAllowed(dbPath, payload.taskId, loaded.taskStatus, "running", "cli.run job started", "cli.run");
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO runs (id, task_id, feature_id, project_id, status, started_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = COALESCE(runs.started_at, excluded.started_at), metadata_json = excluded.metadata_json`,
      params: [payload.runId, payload.taskId, loaded.featureId, loaded.projectId ?? null, "running", now.toISOString(), JSON.stringify({ scheduler: "bullmq", jobType: "cli.run" })],
    },
  ]);

  const result = await processRunnerQueueItem({
    runId: payload.runId,
    taskId: payload.taskId,
    featureId: loaded.featureId,
    prompt: loaded.prompt,
    policy,
    files: loaded.allowedFiles,
    taskText: loaded.description,
    adapterConfig: loaded.adapter,
  }, runner);

  if (result.adapterResult) {
    persistCodexRunnerArtifacts(dbPath, {
      policy,
      session: result.adapterResult.session,
      rawLog: result.adapterResult.rawLog,
      heartbeat: recordRunnerHeartbeat({
        runId: payload.runId,
        runnerId: "bullmq-cli-runner",
        policy,
        queueStatus: result.status,
        message: result.evidence,
      }),
    });
    const evidence = buildEvidencePackInput(result.adapterResult.evidence);
    runSqlite(dbPath, [
      {
        sql: `INSERT INTO evidence_packs (id, run_id, task_id, feature_id, path, kind, summary, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        params: [
          randomUUID(),
          evidence.runId,
          evidence.taskId ?? null,
          evidence.featureId ?? null,
          `.autobuild/evidence/${evidence.runId}.json`,
          evidence.kind,
          evidence.summary,
          JSON.stringify(evidence.metadata),
        ],
      },
    ]);
  }

  const taskStatus = taskStatusFromRunnerStatus(result.status);
  transitionTaskIfAllowed(dbPath, payload.taskId, "running", taskStatus, result.evidence, "cli.run");
  runSqlite(dbPath, [
    { sql: "UPDATE runs SET status = ?, completed_at = ?, summary = ? WHERE id = ?", params: [result.status, new Date().toISOString(), result.evidence, payload.runId] },
  ]);
  return { runId: payload.runId, status: result.status };
}

export function createQueuedJobRecord(dbPath: string, input: {
  queueName: string;
  jobType: SchedulerJobType;
  targetType: string;
  targetId?: string;
  payload: unknown;
}): SchedulerEnqueueResult {
  const schedulerJobId = randomUUID();
  const bullmqJobId = randomUUID();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (
        id, bullmq_job_id, queue_name, job_type, target_type, target_id, status,
        payload_json, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [
        schedulerJobId,
        bullmqJobId,
        input.queueName,
        input.jobType,
        input.targetType,
        input.targetId ?? null,
        "queued",
        JSON.stringify(input.payload),
        0,
      ],
    },
  ]);
  return { schedulerJobId, bullmqJobId, queueName: input.queueName, jobType: input.jobType };
}

export function updateSchedulerJobRecord(dbPath: string, bullmqJobId: string | undefined, status: SchedulerJobStatus, error?: unknown, attempts?: number): void {
  if (!bullmqJobId) return;
  runSqlite(dbPath, [
    {
      sql: `UPDATE scheduler_job_records
        SET status = ?, error = ?, attempts = COALESCE(?, attempts), updated_at = CURRENT_TIMESTAMP
        WHERE bullmq_job_id = ?`,
      params: [status, error ? errorMessage(error) : null, attempts ?? null, bullmqJobId],
    },
  ]);
}

async function dispatchFeatureJob(dbPath: string, scheduler: SchedulerClient, job: Job): Promise<void> {
  updateSchedulerJobRecord(dbPath, String(job.id), "running", undefined, job.attemptsMade);
  try {
    if (job.name === "feature.select") {
      runFeatureSelectJob(dbPath, scheduler, job.data as FeatureSelectJobPayload);
    } else if (job.name === "feature.plan") {
      runFeaturePlanJob(dbPath, job.data as FeaturePlanJobPayload);
      updateSchedulerJobRecord(dbPath, String(job.id), "blocked", PLANNING_BRIDGE_NOT_IMPLEMENTED, job.attemptsMade);
      return;
    } else {
      throw new Error(`Unsupported feature scheduler job: ${job.name}`);
    }
    updateSchedulerJobRecord(dbPath, String(job.id), "completed", undefined, job.attemptsMade);
  } catch (error) {
    updateSchedulerJobRecord(dbPath, String(job.id), "failed", error, job.attemptsMade);
    throw error;
  }
}

async function dispatchCliJob(dbPath: string, job: Job, runner?: CodexCommandRunner): Promise<void> {
  updateSchedulerJobRecord(dbPath, String(job.id), "running", undefined, job.attemptsMade);
  try {
    await runCliRunJob(dbPath, job.data as CliRunJobPayload, runner);
    updateSchedulerJobRecord(dbPath, String(job.id), "completed", undefined, job.attemptsMade);
  } catch (error) {
    updateSchedulerJobRecord(dbPath, String(job.id), "failed", error, job.attemptsMade);
    throw error;
  }
}

function featureSelectJobOptions(payload: FeatureSelectJobPayload, jobId: string): JobsOptions {
  const options: JobsOptions = { jobId, attempts: 1 };
  if (payload.mode === "scheduled_at") {
    options.delay = Math.max(0, new Date(payload.requestedFor).getTime() - Date.now());
  } else if (payload.mode === "hourly") {
    options.repeat = { pattern: "0 * * * *" };
  } else if (payload.mode === "daily") {
    options.repeat = { pattern: "0 9 * * *" };
  } else if (payload.mode === "nightly") {
    options.repeat = { pattern: "0 2 * * *" };
  } else if (payload.mode === "weekdays") {
    options.repeat = { pattern: "0 9 * * 1-5" };
  }
  return options;
}

function loadLiveScheduleCandidates(dbPath: string, projectId?: string, featureId?: string): FeatureCandidate[] {
  const clauses = ["1 = 1"];
  const params: unknown[] = [];
  if (projectId) {
    clauses.push("project_id = ?");
    params.push(projectId);
  }
  if (featureId) {
    clauses.push("id = ?");
    params.push(featureId);
  }
  const rows = runSqlite(dbPath, [], [
    {
      name: "features",
      sql: `SELECT id, title, status, COALESCE(priority, 0) AS priority,
          COALESCE(dependencies_json, '[]') AS dependencies_json,
          COALESCE(primary_requirements_json, '[]') AS primary_requirements_json,
          created_at
        FROM features
        WHERE ${clauses.join(" AND ")}
        ORDER BY priority DESC, created_at`,
      params,
    },
  ]).queries.features;
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    status: normalizeFeatureStatus(row.status),
    priority: Number(row.priority ?? 0),
    dependencies: parseJsonArray(row.dependencies_json).map(String),
    requirementIds: parseJsonArray(row.primary_requirements_json).map(String),
    acceptanceRisk: "low",
    readySince: optionalString(row.created_at) ?? new Date(0).toISOString(),
  }));
}

function loadRunnerTaskContext(dbPath: string, payload: CliRunJobPayload): {
  taskStatus: BoardColumn;
  featureId?: string;
  projectId?: string;
  title: string;
  description: string;
  risk: RiskLevel;
  allowedFiles: string[];
  workspaceRoot: string;
  adapter: CliAdapterConfig;
  prompt: string;
} {
  const result = runSqlite(dbPath, [], [
    {
      name: "graphTask",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, '' AS description, t.status, t.risk, t.allowed_files_json
        FROM task_graph_tasks t LEFT JOIN features f ON f.id = t.feature_id
        WHERE t.id = ? LIMIT 1`,
      params: [payload.taskId],
    },
    {
      name: "task",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, COALESCE(t.description, '') AS description, t.status,
          'medium' AS risk, COALESCE(t.allowed_files_json, '[]') AS allowed_files_json
        FROM tasks t LEFT JOIN features f ON f.id = t.feature_id
        WHERE t.id = ? LIMIT 1`,
      params: [payload.taskId],
    },
    {
      name: "project",
      sql: "SELECT id, target_repo_path FROM projects WHERE id = ? OR id = (SELECT project_id FROM features WHERE id = ?) LIMIT 1",
      params: [payload.projectId ?? "", payload.featureId ?? ""],
    },
    { name: "adapter", sql: "SELECT * FROM cli_adapter_configs WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1" },
  ]);
  const row = result.queries.graphTask[0] ?? result.queries.task[0];
  if (!row) {
    throw new Error(`Task not found: ${payload.taskId}`);
  }
  const projectId = payload.projectId ?? optionalString(row.project_id);
  const projectRow = result.queries.project.find((entry) => !projectId || entry.id === projectId) ?? result.queries.project[0];
  const workspaceRoot = optionalString(projectRow?.target_repo_path) ?? process.cwd();
  const adapter = adapterFromRow(result.queries.adapter[0]);
  const featureId = payload.featureId ?? optionalString(row.feature_id);
  const title = String(row.title);
  const description = optionalString(row.description) ?? title;
  return {
    taskStatus: normalizeBoardStatus(row.status),
    featureId,
    projectId,
    title,
    description,
    risk: normalizeRisk(row.risk),
    allowedFiles: parseJsonArray(row.allowed_files_json).map(String),
    workspaceRoot,
    adapter,
    prompt: `Execute SpecDrive task ${payload.taskId}${featureId ? ` for ${featureId}` : ""}: ${title}\n\n${description}`,
  };
}

function transitionTaskIfAllowed(dbPath: string, taskId: string, from: BoardColumn, to: BoardColumn, reason: string, evidence: string): void {
  if (from === to) return;
  try {
    persistStateTransition(dbPath, transitionTask(taskId, from, to, {
      reason,
      evidence,
      triggeredBy: "cli_runner",
    }));
  } catch {
    return;
  }
  runSqlite(dbPath, [
    { sql: "UPDATE task_graph_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params: [to, taskId] },
    { sql: "UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params: [to, taskId] },
  ]);
}

function taskStatusFromRunnerStatus(status: RunnerQueueStatus): BoardColumn {
  if (status === "completed") return "checking";
  if (status === "review_needed") return "review_needed";
  if (status === "blocked") return "blocked";
  if (status === "failed") return "failed";
  return "running";
}

function adapterFromRow(row?: Record<string, unknown>): CliAdapterConfig {
  if (!row) {
    return DEFAULT_CLI_ADAPTER_CONFIG;
  }
  return normalizeCliAdapterConfig({
    id: String(row.id),
    displayName: String(row.display_name),
    schemaVersion: Number(row.schema_version),
    executable: String(row.executable),
    argumentTemplate: parseJsonArray(row.argument_template_json).map(String),
    resumeArgumentTemplate: parseJsonArray(row.resume_argument_template_json).map(String),
    configSchema: parseJsonObject(row.config_schema_json),
    formSchema: parseJsonObject(row.form_schema_json),
    defaults: parseJsonObject(row.defaults_json),
    environmentAllowlist: parseJsonArray(row.environment_allowlist_json).map(String),
    outputMapping: parseJsonObject(row.output_mapping_json),
    status: String(row.status),
    updatedAt: String(row.updated_at),
  });
}

function normalizeFeatureStatus(value: unknown): FeatureLifecycleStatus {
  const status = String(value);
  return ["draft", "ready", "planning", "tasked", "implementing", "done", "delivered", "review_needed", "blocked", "failed"].includes(status)
    ? status as FeatureLifecycleStatus
    : "draft";
}

function normalizeBoardStatus(value: unknown): BoardColumn {
  const status = String(value);
  return ["backlog", "ready", "scheduled", "running", "checking", "review_needed", "blocked", "failed", "done", "delivered"].includes(status)
    ? status as BoardColumn
    : "backlog";
}

function normalizeRisk(value: unknown): RiskLevel {
  const risk = String(value);
  return risk === "low" || risk === "medium" || risk === "high" ? risk : "medium";
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || value.trim() === "") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function markSchedulerJobFailed(dbPath: string, bullmqJobId: string, error: unknown): void {
  updateSchedulerJobRecord(dbPath, bullmqJobId, "failed", error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
