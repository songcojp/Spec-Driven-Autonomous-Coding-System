import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, relative } from "node:path";
import { Queue, Worker, type JobsOptions, type Job, type WorkerOptions } from "bullmq";
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
  buildSkillInvocationPrompt,
  DEFAULT_CLI_ADAPTER_CONFIG,
  isTrustedDocsDirectWriteInvocation,
  normalizeCliAdapterConfig,
  persistCodexRunnerArtifacts,
  processRunnerQueueItem,
  recordRunnerHeartbeat,
  resolveRunnerPolicy,
  validateWorkspaceRoot,
  type CliAdapterConfig,
  type CodexCommandRunner,
  type RunnerQueueStatus,
  type SkillInvocationContract,
} from "./codex-runner.ts";

export const FEATURE_SCHEDULER_QUEUE = "specdrive:feature-scheduler";
export const CLI_RUNNER_QUEUE = "specdrive:cli-runner";
export const BULLMQ_FEATURE_SCHEDULER_QUEUE = "specdrive-feature-scheduler";
export const BULLMQ_CLI_RUNNER_QUEUE = "specdrive-cli-runner";
export const FEATURE_WORKER_LOCK_DURATION_MS = 5 * 60 * 1000;
export const CLI_WORKER_LOCK_DURATION_MS = 60 * 60 * 1000;
export const PLANNING_BRIDGE_NOT_IMPLEMENTED = "Planning skill execution bridge is not implemented";
export const PLANNING_BRIDGE_WORKSPACE_BLOCKED = "Planning skill execution bridge is blocked because the project workspace is unavailable";
const MAX_CONTEXT_FILE_BYTES = 120_000;
const MAX_CONTEXT_BUNDLE_BYTES = 360_000;

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
  taskId?: string;
  runId: string;
  skillSlug?: string;
  requestedAction?: string;
  sourcePaths?: string[];
  imagePaths?: string[];
  expectedArtifacts?: string[];
  traceability?: {
    requirementIds?: string[];
    changeIds?: string[];
  };
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
  const featureQueue = new Queue(BULLMQ_FEATURE_SCHEDULER_QUEUE, { connection });
  const cliQueue = new Queue(BULLMQ_CLI_RUNNER_QUEUE, { connection });

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
        targetType: payload.taskId ? "task" : payload.featureId ? "feature" : "project",
        targetId: payload.taskId ?? payload.featureId ?? payload.projectId,
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
      return enqueue("cli.run", CLI_RUNNER_QUEUE, payload.taskId ? "task" : payload.featureId ? "feature" : "project", payload.taskId ?? payload.featureId ?? payload.projectId, payload);
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
      return enqueue("cli.run", CLI_RUNNER_QUEUE, payload.taskId ? "task" : payload.featureId ? "feature" : "project", payload.taskId ?? payload.featureId ?? payload.projectId, payload);
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
  const featureWorkerOptions = workerOptions(connection, FEATURE_WORKER_LOCK_DURATION_MS);
  const cliWorkerOptions = workerOptions(connection, CLI_WORKER_LOCK_DURATION_MS);
  const featureWorker = new Worker(
    BULLMQ_FEATURE_SCHEDULER_QUEUE,
    async (job) => dispatchFeatureJob(input.dbPath, scheduler, job),
    featureWorkerOptions,
  );
  const cliWorker = new Worker(
    BULLMQ_CLI_RUNNER_QUEUE,
    async (job) => dispatchCliJob(input.dbPath, job, input.runner),
    cliWorkerOptions,
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

function workerOptions(connection: IORedis, lockDuration: number): WorkerOptions {
  return {
    connection,
    lockDuration,
    lockRenewTime: Math.floor(lockDuration / 2),
    stalledInterval: Math.min(60_000, Math.floor(lockDuration / 4)),
    maxStalledCount: 1,
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

export function runFeaturePlanJob(dbPath: string, payload: FeaturePlanJobPayload, scheduler?: Pick<SchedulerClient, "enqueueCliRun">): { runId?: string; blockedReason?: string } {
  const now = new Date().toISOString();
  const row = runSqlite(dbPath, [], [
    {
      name: "feature",
      sql: `SELECT f.id, f.status, f.project_id, f.primary_requirements_json, p.target_repo_path,
          rc.local_path AS repository_local_path
        FROM features f
        LEFT JOIN projects p ON p.id = f.project_id
        LEFT JOIN repository_connections rc ON rc.project_id = f.project_id
          AND rc.connected_at = (
            SELECT MAX(connected_at) FROM repository_connections latest WHERE latest.project_id = f.project_id
          )
        WHERE f.id = ? LIMIT 1`,
      params: [payload.featureId],
    },
  ]).queries.feature[0];
  if (!row) {
    throw new Error(`Feature not found: ${payload.featureId}`);
  }
  const projectId = payload.projectId ?? optionalString(row.project_id);
  const workspace = validateWorkspaceRoot(resolveWorkspaceRoot(row));
  if (scheduler && projectId && workspace.valid && workspace.workspaceRoot) {
    const runId = randomUUID();
    runSqlite(dbPath, [
      {
        sql: `INSERT INTO runs (id, task_id, feature_id, project_id, status, started_at, metadata_json)
          VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        params: [
          runId,
          payload.featureId,
          projectId,
          "queued",
          now,
          JSON.stringify({
            scheduler: "bullmq",
            jobType: "feature.plan",
            skillSlug: "technical-context-skill",
            workspaceRoot: workspace.workspaceRoot,
            skillPhase: "feature_planning",
          }),
        ],
      },
    ]);
    scheduler.enqueueCliRun({
      projectId,
      featureId: payload.featureId,
      runId,
      skillSlug: "technical-context-skill",
      requestedAction: "feature_planning",
      sourcePaths: [
        "docs/zh-CN/PRD.md",
        "docs/zh-CN/requirements.md",
        "docs/zh-CN/hld.md",
        `docs/features/${payload.featureId}/requirements.md`,
        `docs/features/${payload.featureId}/design.md`,
        `docs/features/${payload.featureId}/tasks.md`,
      ],
      expectedArtifacts: [
        `docs/features/${payload.featureId}/design.md`,
        `docs/features/${payload.featureId}/tasks.md`,
        ".autobuild/evidence/planning-run.json",
      ],
      traceability: {
        requirementIds: parseJsonArray(row.primary_requirements_json).map(String),
        changeIds: ["CHG-016"],
      },
    });
    recordAuditEvent(dbPath, {
      entityType: "feature",
      entityId: payload.featureId,
      eventType: "scheduler_job_dispatched",
      source: "feature_scheduler",
      reason: "Feature planning bridge dispatched a workspace-aware Codex skill run.",
      payload: { ...payload, runId, workspaceRoot: workspace.workspaceRoot, skillSlug: "technical-context-skill" },
    });
    return { runId };
  }

  const from = normalizeFeatureStatus(row.status);
  const blockedReason = workspace.blockedReasons.length > 0
    ? `${PLANNING_BRIDGE_WORKSPACE_BLOCKED}: ${workspace.blockedReasons.join("; ")}`
    : PLANNING_BRIDGE_NOT_IMPLEMENTED;
  if (from !== "blocked") {
    persistStateTransition(dbPath, transitionFeature(payload.featureId, from, "blocked", {
      reason: blockedReason,
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
    reason: blockedReason,
    payload,
  });
  return { blockedReason };
}

export async function runCliRunJob(dbPath: string, payload: CliRunJobPayload, runner?: CodexCommandRunner): Promise<{ runId: string; status: RunnerQueueStatus }> {
  let loaded: ReturnType<typeof loadRunnerTaskContext>;
  try {
    loaded = loadRunnerTaskContext(dbPath, payload);
  } catch (error) {
    const reason = errorMessage(error);
    runSqlite(dbPath, [
      {
        sql: `INSERT INTO runs (id, task_id, feature_id, project_id, status, completed_at, summary, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at, summary = excluded.summary, metadata_json = excluded.metadata_json`,
        params: [
          payload.runId,
          payload.taskId ?? null,
          payload.featureId ?? null,
          payload.projectId ?? null,
          "blocked",
          new Date().toISOString(),
          reason,
          JSON.stringify({
            scheduler: "bullmq",
            jobType: "cli.run",
            skillSlug: payload.skillSlug,
            skillPhase: payload.requestedAction,
            blockedReason: reason,
          }),
        ],
      },
    ]);
    recordAuditEvent(dbPath, {
      entityType: payload.taskId ? "task" : payload.featureId ? "feature" : "project",
      entityId: payload.taskId ?? payload.featureId ?? payload.projectId ?? payload.runId,
      eventType: "cli_run_blocked",
      source: "cli_runner",
      reason,
      payload,
    });
    return { runId: payload.runId, status: "blocked" };
  }
  const now = new Date();
  const policy = resolveRunnerPolicy({
    runId: payload.runId,
    risk: loaded.risk,
    workspaceRoot: loaded.workspaceRoot,
    model: loaded.adapter.defaults.model,
    reasoningEffort: loaded.adapter.defaults.reasoningEffort,
    profile: loaded.adapter.defaults.profile,
    requestedSandboxMode: isTrustedDocsDirectWriteInvocation(loaded.skillInvocation) ? "danger-full-access" : loaded.adapter.defaults.sandbox,
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
  if (payload.taskId && loaded.taskStatus) {
    transitionTaskIfAllowed(dbPath, payload.taskId, loaded.taskStatus, "running", "cli.run job started", "cli.run");
  }
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO runs (id, task_id, feature_id, project_id, status, started_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = COALESCE(runs.started_at, excluded.started_at), metadata_json = excluded.metadata_json`,
      params: [
        payload.runId,
        payload.taskId ?? null,
        loaded.featureId,
        loaded.projectId ?? null,
        "running",
        now.toISOString(),
        JSON.stringify({
          scheduler: "bullmq",
          jobType: "cli.run",
          workspaceRoot: loaded.workspaceRoot,
          skillSlug: loaded.skillInvocation?.skillSlug,
          skillPhase: loaded.skillInvocation?.requestedAction,
        }),
      ],
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
    skillInvocation: loaded.skillInvocation,
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
  if (payload.taskId) {
    transitionTaskIfAllowed(dbPath, payload.taskId, "running", taskStatus, result.evidence, "cli.run");
  }
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
      const result = runFeaturePlanJob(dbPath, job.data as FeaturePlanJobPayload, scheduler);
      if (result.blockedReason) {
        updateSchedulerJobRecord(dbPath, String(job.id), "blocked", result.blockedReason, job.attemptsMade);
        return;
      }
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
    const result = await runCliRunJob(dbPath, job.data as CliRunJobPayload, runner);
    updateSchedulerJobRecord(dbPath, String(job.id), result.status === "blocked" ? "blocked" : "completed", undefined, job.attemptsMade);
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
  taskStatus?: BoardColumn;
  featureId?: string;
  projectId?: string;
  title: string;
  description: string;
  risk: RiskLevel;
  allowedFiles: string[];
  workspaceRoot: string;
  adapter: CliAdapterConfig;
  prompt: string;
  skillInvocation?: SkillInvocationContract;
} {
  const result = runSqlite(dbPath, [], [
    {
      name: "graphTask",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, '' AS description, t.status, t.risk, t.allowed_files_json
        FROM task_graph_tasks t LEFT JOIN features f ON f.id = t.feature_id
        WHERE t.id = ? LIMIT 1`,
      params: [payload.taskId ?? ""],
    },
    {
      name: "task",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, COALESCE(t.description, '') AS description, t.status,
          'medium' AS risk, COALESCE(t.allowed_files_json, '[]') AS allowed_files_json
        FROM tasks t LEFT JOIN features f ON f.id = t.feature_id
        WHERE t.id = ? LIMIT 1`,
      params: [payload.taskId ?? ""],
    },
    {
      name: "project",
      sql: `SELECT p.id, p.target_repo_path, rc.local_path AS repository_local_path
        FROM projects p
        LEFT JOIN repository_connections rc ON rc.project_id = p.id
          AND rc.connected_at = (
            SELECT MAX(connected_at) FROM repository_connections latest WHERE latest.project_id = p.id
          )
        WHERE p.id = ? OR p.id = (SELECT project_id FROM features WHERE id = ?) LIMIT 1`,
      params: [payload.projectId ?? "", payload.featureId ?? ""],
    },
    {
      name: "feature",
      sql: `SELECT id, project_id, title, status, COALESCE(primary_requirements_json, '[]') AS primary_requirements_json
        FROM features WHERE id = ? LIMIT 1`,
      params: [payload.featureId ?? ""],
    },
    { name: "adapter", sql: "SELECT * FROM cli_adapter_configs WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1" },
    { name: "adapterCount", sql: "SELECT COUNT(*) AS count FROM cli_adapter_configs" },
  ]);
  const row = result.queries.graphTask[0] ?? result.queries.task[0];
  const featureRow = result.queries.feature[0];
  if (!row && !featureRow && payload.taskId) {
    throw new Error(`Task not found: ${payload.taskId}`);
  }
  if (!row && !featureRow && !payload.projectId) {
    throw new Error("CLI run requires a task, feature, or project context.");
  }
  const projectId = payload.projectId ?? optionalString(row?.project_id) ?? optionalString(featureRow?.project_id);
  const projectRow = result.queries.project.find((entry) => !projectId || entry.id === projectId) ?? result.queries.project[0];
  const workspace = validateWorkspaceRoot(resolveWorkspaceRoot(projectRow));
  if (!workspace.valid || !workspace.workspaceRoot) {
    throw new Error(workspace.blockedReasons.join("; "));
  }
  const adapterRow = result.queries.adapter[0];
  const adapterCount = Number(result.queries.adapterCount[0]?.count ?? 0);
  if (!adapterRow && adapterCount > 0) {
    throw new Error("No active CLI adapter configured. Activate an adapter in System Settings before starting new runs.");
  }
  const adapter = adapterFromRow(adapterRow);
  const featureId = payload.featureId ?? optionalString(row?.feature_id) ?? optionalString(featureRow?.id);
  const title = optionalString(row?.title) ?? optionalString(featureRow?.title) ?? `Project ${projectId}`;
  const description = optionalString(row?.description) ?? title;
  const skillInvocation = buildCliSkillInvocation({
    payload,
    projectId,
    workspaceRoot: workspace.workspaceRoot,
    featureId,
    taskId: payload.taskId,
    requirementIds: parseJsonArray(featureRow?.primary_requirements_json).map(String),
  });
  const context = [
    `Run ${payload.runId}${payload.taskId ? ` for task ${payload.taskId}` : ""}${featureId ? ` in feature ${featureId}` : ""}: ${title}`,
    "",
    description,
    "",
    buildWorkspaceContextBundle(workspace.workspaceRoot, skillInvocation),
  ].join("\n");
  return {
    taskStatus: row ? normalizeBoardStatus(row.status) : undefined,
    featureId,
    projectId,
    title,
    description,
    risk: normalizeRisk(row?.risk),
    allowedFiles: parseJsonArray(row?.allowed_files_json).map(String),
    workspaceRoot: workspace.workspaceRoot,
    adapter,
    prompt: buildSkillInvocationPrompt(skillInvocation, context),
    skillInvocation,
  };
}

function buildWorkspaceContextBundle(workspaceRoot: string, contract: SkillInvocationContract): string {
  const requestedPaths = uniqueStrings([
    "AGENTS.md",
    `.agents/skills/${contract.skillSlug}/SKILL.md`,
    ...contract.sourcePaths,
  ]);
  const sections: string[] = [
    "Workspace Context Bundle:",
    "The scheduler pre-read these workspace-local files before invoking the CLI. If shell commands fail in the child runner, use this bundle as the governing read evidence and still produce the expected artifacts.",
  ];
  let remainingBytes = MAX_CONTEXT_BUNDLE_BYTES;

  for (const requestedPath of requestedPaths) {
    if (remainingBytes <= 0) {
      sections.push("\n[context-truncated]\nThe context bundle byte limit was reached.");
      break;
    }
    const safePath = safeWorkspaceRelativePath(requestedPath);
    if (!safePath) {
      sections.push(`\n### ${requestedPath}\n[omitted: path is outside the workspace boundary]`);
      continue;
    }
    const absolutePath = join(workspaceRoot, safePath);
    const relativePath = relative(workspaceRoot, absolutePath);
    if (relativePath.startsWith("..") || relativePath === "" || relativePath.startsWith("/") || relativePath.includes("..\\")) {
      sections.push(`\n### ${requestedPath}\n[omitted: path is outside the workspace boundary]`);
      continue;
    }
    if (!existsSync(absolutePath)) {
      sections.push(`\n### ${safePath}\n[missing]`);
      continue;
    }
    const stat = statSync(absolutePath);
    if (!stat.isFile()) {
      sections.push(`\n### ${safePath}\n[omitted: not a file]`);
      continue;
    }
    const maxBytes = Math.min(MAX_CONTEXT_FILE_BYTES, remainingBytes);
    const content = readFileSync(absolutePath);
    const clipped = content.subarray(0, maxBytes);
    remainingBytes -= clipped.length;
    const suffix = content.length > clipped.length ? "\n[truncated]" : "";
    sections.push(`\n### ${safePath}\n\`\`\`markdown\n${clipped.toString("utf8")}${suffix}\n\`\`\``);
  }

  return sections.join("\n");
}

function safeWorkspaceRelativePath(input: string): string | undefined {
  if (!input || input.startsWith("/")) return undefined;
  const normalized = normalize(input).replaceAll("\\", "/");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
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

function resolveWorkspaceRoot(row?: Record<string, unknown>): string | undefined {
  return optionalString(row?.repository_local_path) ?? optionalString(row?.target_repo_path);
}

function buildCliSkillInvocation(input: {
  payload: CliRunJobPayload;
  projectId?: string;
  workspaceRoot: string;
  featureId?: string;
  taskId?: string;
  requirementIds?: string[];
}): SkillInvocationContract {
  const skillSlug = input.payload.skillSlug ?? (input.taskId ? "codex-coding-skill" : "technical-context-skill");
  const requestedAction = input.payload.requestedAction ?? (input.taskId ? "task_execution" : "feature_planning");
  const sourcePaths = input.payload.sourcePaths?.length
    ? input.payload.sourcePaths
    : [
        "AGENTS.md",
        ".agents/skills",
        ...(input.featureId ? [
          `docs/features/${input.featureId}/requirements.md`,
          `docs/features/${input.featureId}/design.md`,
          `docs/features/${input.featureId}/tasks.md`,
        ] : []),
      ];
  const expectedArtifacts = input.payload.expectedArtifacts?.length
    ? input.payload.expectedArtifacts
    : input.taskId
      ? [".autobuild/evidence/codex-runner.json"]
      : input.featureId
        ? [`docs/features/${input.featureId}/design.md`, `docs/features/${input.featureId}/tasks.md`]
        : [".autobuild/evidence/spec-intake.json"];
  return {
    projectId: input.projectId ?? "unknown-project",
    workspaceRoot: input.workspaceRoot,
    skillSlug,
    sourcePaths,
    imagePaths: input.payload.imagePaths,
    expectedArtifacts,
    traceability: {
      featureId: input.featureId,
      taskId: input.taskId,
      requirementIds: input.payload.traceability?.requirementIds ?? input.requirementIds ?? [],
      changeIds: input.payload.traceability?.changeIds ?? ["CHG-016"],
    },
    requestedAction,
  };
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
