import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, relative } from "node:path";
import { Queue, Worker, type Job, type WorkerOptions } from "bullmq";
import IORedis from "ioredis";
import { runSqlite } from "./sqlite.ts";
import { recordAuditEvent } from "./persistence.ts";
import {
  persistStateTransition,
  transitionTask,
  type BoardColumn,
  type RiskLevel,
} from "./orchestration.ts";
import {
  buildSkillInvocationPrompt,
  DEFAULT_CLI_ADAPTER_CONFIG,
  GEMINI_CLI_ADAPTER_CONFIG,
  evaluateRunnerSafety,
  isTrustedDirectWriteInvocation,
  normalizeCliAdapterConfig,
  persistCliRunnerArtifacts,
  processRunnerQueueItem,
  recordRunnerHeartbeat,
  resolveRunnerPolicy,
  validateWorkspaceRoot,
  type CliAdapterConfig,
  type CliCommandRunner,
  type RunnerQueueStatus,
  type SkillArtifactContract,
  type SkillInvocationContract,
  type SkillOutputContract,
} from "./cli-adapter.ts";
import {
  createCodexAppServerTransportFromConfig,
  DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG,
  runCodexAppServerSession,
  type CodexAppServerAdapterConfig,
  type CodexAppServerTransport,
} from "./codex-rpc-adapter.ts";
import {
  createGeminiAcpTransportFromConfig,
  DEFAULT_GEMINI_ACP_ADAPTER_CONFIG,
  runGeminiAcpSession,
  type GeminiAcpAdapterConfig,
  type GeminiAcpTransport,
} from "./gemini-rpc-adapter.ts";
import {
  mergeFileSpecState,
  readFileSpecState,
  skillOutputToSpecStatePatch,
  writeFileSpecState,
} from "./spec-protocol.ts";

export const EXECUTION_ADAPTER_QUEUE = "specdrive:execution-adapter";
export const BULLMQ_EXECUTION_ADAPTER_QUEUE = "specdrive-execution-adapter";
export const CLI_RUNNER_QUEUE = EXECUTION_ADAPTER_QUEUE;
export const BULLMQ_CLI_RUNNER_QUEUE = BULLMQ_EXECUTION_ADAPTER_QUEUE;
export const CLI_WORKER_LOCK_DURATION_MS = 60 * 60 * 1000;
const MAX_CONTEXT_FILE_BYTES = 120_000;
const MAX_CONTEXT_BUNDLE_BYTES = 360_000;

export type SchedulerJobType = "cli.run" | "rpc.run" | "codex.rpc.run" | "codex.app_server.run" | "native.run";
export type SchedulerJobStatus = "queued" | "running" | "completed" | "approval_needed" | "blocked" | "failed";

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

export type ExecutorJobContext = {
  featureId?: string;
  featureSpecPath?: string;
  taskId?: string;
  sourcePaths?: string[];
  imagePaths?: string[];
  expectedArtifacts?: string[];
  workspaceRoot?: string;
  skillSlug?: string;
  skillPhase?: string;
  [key: string]: unknown;
};

export type ExecutionRunMode = "cli" | "rpc";

export type ExecutionPreferenceV1 = {
  runMode: ExecutionRunMode;
  adapterId: string;
  source: "job" | "project" | "default";
};

export type ExecutorRunJobPayload = {
  operation: string;
  projectId?: string;
  executionId: string;
  context?: ExecutorJobContext;
  requestedAction?: string;
  executionPreference?: ExecutionPreferenceV1;
  traceability?: {
    requirementIds?: string[];
  };
};

export type CliRunJobPayload = ExecutorRunJobPayload;
export type AppServerRunJobPayload = ExecutorRunJobPayload & { threadId?: string };
export type NativeRunJobPayload = ExecutorRunJobPayload & { nativeHandler?: string };

export type SchedulerClient = {
  enqueueCliRun(payload: CliRunJobPayload): SchedulerEnqueueResult;
  enqueueRpcRun?(payload: AppServerRunJobPayload): SchedulerEnqueueResult;
  enqueueAppServerRun?(payload: AppServerRunJobPayload): SchedulerEnqueueResult;
  enqueueNativeRun?(payload: NativeRunJobPayload): SchedulerEnqueueResult;
  health?: () => SchedulerHealth;
  close?: () => Promise<void>;
};

export type SchedulerWorkers = {
  close: () => Promise<void>;
};

export type RecoverableSchedulerJob = {
  schedulerJobId: string;
  bullmqJobId: string;
  jobType: Exclude<SchedulerJobType, "native.run">;
  payload: Record<string, unknown>;
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
  const cliQueue = new Queue(bullMqExecutionAdapterQueueName(dbPath), { connection });

  return {
    enqueueCliRun(payload) {
      const result = createQueuedJobRecord(dbPath, {
        queueName: CLI_RUNNER_QUEUE,
        jobType: "cli.run",
        payload,
      });
      void cliQueue.add("cli.run", { ...payload, schedulerJobId: result.schedulerJobId }, { jobId: result.bullmqJobId, attempts: 1 })
        .catch((error) => markSchedulerJobFailed(dbPath, result.bullmqJobId, error));
      return result;
    },
    enqueueRpcRun(payload) {
      const result = createQueuedJobRecord(dbPath, {
        queueName: EXECUTION_ADAPTER_QUEUE,
        jobType: "rpc.run",
        payload,
      });
      void cliQueue.add("rpc.run", { ...payload, schedulerJobId: result.schedulerJobId }, { jobId: result.bullmqJobId, attempts: 1 })
        .catch((error) => markSchedulerJobFailed(dbPath, result.bullmqJobId, error));
      return result;
    },
    enqueueAppServerRun(payload) {
      return this.enqueueRpcRun?.(payload) ?? createQueuedJobRecord(dbPath, {
        queueName: EXECUTION_ADAPTER_QUEUE,
        jobType: "rpc.run",
        payload,
      });
    },
    health() {
      return connection.status === "ready"
        ? { status: "ready", redisUrl }
        : { status: "blocked", redisUrl, reason: lastError ?? `Redis connection is ${connection.status}.` };
    },
    async close() {
      await Promise.all([cliQueue.close(), connection.quit().catch(() => undefined)]);
    },
  };
}

export function createUnavailableScheduler(dbPath: string, reason: string): SchedulerClient {
  const enqueue = (jobType: SchedulerJobType, queueName: string, payload: unknown): SchedulerEnqueueResult => {
    const result = createQueuedJobRecord(dbPath, { queueName, jobType, payload });
    updateSchedulerJobRecord(dbPath, result.bullmqJobId, "blocked", reason);
    return result;
  };
  return {
    enqueueCliRun(payload) {
      return enqueue("cli.run", CLI_RUNNER_QUEUE, payload);
    },
    enqueueRpcRun(payload) {
      return enqueue("rpc.run", EXECUTION_ADAPTER_QUEUE, payload);
    },
    enqueueAppServerRun(payload) {
      return enqueue("rpc.run", EXECUTION_ADAPTER_QUEUE, payload);
    },
    health() {
      return { status: "blocked", reason };
    },
  };
}

export function createMemoryScheduler(dbPath: string): SchedulerClient & { jobs: SchedulerEnqueueResult[] } {
  const jobs: SchedulerEnqueueResult[] = [];
  const enqueue = (jobType: SchedulerJobType, queueName: string, payload: unknown): SchedulerEnqueueResult => {
    const result = createQueuedJobRecord(dbPath, { queueName, jobType, payload });
    jobs.push(result);
    return result;
  };
  return {
    jobs,
    enqueueCliRun(payload) {
      return enqueue("cli.run", CLI_RUNNER_QUEUE, payload);
    },
    enqueueRpcRun(payload) {
      return enqueue("rpc.run", EXECUTION_ADAPTER_QUEUE, payload);
    },
    enqueueAppServerRun(payload) {
      return enqueue("rpc.run", EXECUTION_ADAPTER_QUEUE, payload);
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
  runner?: CliCommandRunner;
  appServerTransport?: CodexAppServerTransport;
}): Promise<SchedulerWorkers> {
  const connection = new IORedis(input.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  connection.on("error", () => undefined);
  const scheduler = input.scheduler ?? createBullMqScheduler(input.dbPath, input.redisUrl);
  const cliWorkerOptions = workerOptions(connection, CLI_WORKER_LOCK_DURATION_MS);
  const queueName = bullMqExecutionAdapterQueueName(input.dbPath);
  const cliQueue = new Queue(queueName, { connection });
  const cliWorker = new Worker(
    queueName,
    async (job) => dispatchCliJob(input.dbPath, job, input.runner, input.appServerTransport),
    cliWorkerOptions,
  );
  await requeueRecoverableSchedulerJobs(input.dbPath, cliQueue);
  return {
    async close() {
      await Promise.all([
        cliQueue.close(),
        cliWorker.close(),
        scheduler.close?.() ?? Promise.resolve(),
        connection.quit().catch(() => undefined),
      ]);
    },
  };
}

export function bullMqExecutionAdapterQueueName(dbPath: string): string {
  const digest = createHash("sha256").update(normalize(dbPath)).digest("hex").slice(0, 12);
  return `${BULLMQ_EXECUTION_ADAPTER_QUEUE}-${digest}`;
}

export function listRecoverableSchedulerJobs(dbPath: string): RecoverableSchedulerJob[] {
  const transientErrors = [
    "Scheduler worker mode is off.",
    "Scheduler is not connected to Redis.",
  ];
  const result = runSqlite(dbPath, [], [
    {
      name: "jobs",
      sql: `SELECT sj.id, sj.bullmq_job_id, sj.job_type, sj.payload_json
        FROM scheduler_job_records sj
        LEFT JOIN execution_records er ON er.scheduler_job_id = sj.id
        WHERE sj.job_type IN ('cli.run', 'rpc.run', 'codex.rpc.run', 'codex.app_server.run')
          AND (
            sj.status = 'queued'
            OR (
              sj.status = 'blocked'
              AND sj.error IN (${transientErrors.map(() => "?").join(", ")})
              AND er.status = 'queued'
            )
          )
        ORDER BY sj.updated_at ASC`,
      params: transientErrors,
    },
  ]);
  return result.queries.jobs.flatMap((row) => {
    const schedulerJobId = optionalString(row.id);
    const bullmqJobId = optionalString(row.bullmq_job_id);
    const jobType = optionalString(row.job_type);
    const payload = parseJsonObject(row.payload_json);
    if (!schedulerJobId || !bullmqJobId || !isRecoverableJobType(jobType) || Object.keys(payload).length === 0) {
      return [];
    }
    return [{ schedulerJobId, bullmqJobId, jobType, payload }];
  });
}

async function requeueRecoverableSchedulerJobs(dbPath: string, queue: Queue): Promise<void> {
  for (const job of listRecoverableSchedulerJobs(dbPath)) {
    const existing = await queue.getJob(job.bullmqJobId);
    if (existing) continue;
    await queue.add(job.jobType, { ...job.payload, schedulerJobId: job.schedulerJobId }, { jobId: job.bullmqJobId, attempts: 1 });
    updateSchedulerJobRecord(dbPath, job.bullmqJobId, "queued");
  }
}

function isRecoverableJobType(value?: string): value is RecoverableSchedulerJob["jobType"] {
  return value === "cli.run" || value === "rpc.run" || value === "codex.rpc.run" || value === "codex.app_server.run";
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

export async function runCliRunJob(dbPath: string, payload: CliRunJobPayload, runner?: CliCommandRunner): Promise<{ executionId: string; status: RunnerQueueStatus }> {
  const context = payload.context ?? {};
  const executionPreference = executionPreferenceFromPayload(payload);
  const featureId = optionalString(context.featureId);
  const taskId = optionalString(context.taskId);
  const skillSlug = optionalString(context.skillSlug);
  const skillPhase = optionalString(context.skillPhase) ?? payload.operation;
  let loaded: ReturnType<typeof loadRunnerTaskContext>;
  try {
    loaded = loadRunnerTaskContext(dbPath, payload);
  } catch (error) {
    const reason = errorMessage(error);
    runSqlite(dbPath, [
      {
        sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, completed_at, summary, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at, summary = excluded.summary, metadata_json = excluded.metadata_json, updated_at = CURRENT_TIMESTAMP`,
        params: [
          payload.executionId,
          optionalString((payload as unknown as Record<string, unknown>).schedulerJobId) ?? null,
          "cli",
          payload.operation,
          payload.projectId ?? null,
          JSON.stringify(context),
          "blocked",
          new Date().toISOString(),
          reason,
          JSON.stringify({
            scheduler: "bullmq",
            jobType: "cli.run",
            executionPreference,
            skillSlug,
            skillPhase,
            blockedReason: reason,
          }),
        ],
      },
    ]);
    recordAuditEvent(dbPath, {
      entityType: taskId ? "task" : featureId ? "feature" : "project",
      entityId: taskId ?? featureId ?? payload.projectId ?? payload.executionId,
      eventType: "cli_run_blocked",
      source: "cli_runner",
      reason,
      payload,
    });
    return { executionId: payload.executionId, status: "blocked" };
  }
  const now = new Date();
  const policy = resolveRunnerPolicy({
    runId: payload.executionId,
    risk: loaded.risk,
    workspaceRoot: loaded.workspaceRoot,
    model: loaded.adapter.defaults.model,
    reasoningEffort: loaded.adapter.defaults.reasoningEffort,
    profile: loaded.adapter.defaults.profile,
    requestedSandboxMode: isTrustedDirectWriteInvocation(loaded.skillInvocation, loaded.allowedFiles) ? "danger-full-access" : loaded.adapter.defaults.sandbox,
    requestedApprovalPolicy: loaded.adapter.defaults.approval,
    now,
  });
  const heartbeat = recordRunnerHeartbeat({
    runId: payload.executionId,
    runnerId: "bullmq-cli-runner",
    policy,
    queueStatus: "running",
    message: `Running ${taskId ?? payload.operation}`,
    now,
  });
  persistCliRunnerArtifacts(dbPath, { policy, heartbeat });
  if (taskId && loaded.taskStatus) {
    transitionTaskIfAllowed(dbPath, taskId, loaded.taskStatus, "running", "cli.run job started", "cli.run");
  }
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, started_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = COALESCE(execution_records.started_at, excluded.started_at), metadata_json = excluded.metadata_json, updated_at = CURRENT_TIMESTAMP`,
      params: [
        payload.executionId,
        optionalString((payload as unknown as Record<string, unknown>).schedulerJobId) ?? null,
        "cli",
        payload.operation,
        loaded.projectId ?? payload.projectId ?? null,
        JSON.stringify(loaded.skillInvocation ?? { ...context, featureId: loaded.featureId ?? featureId, taskId }),
        "running",
        now.toISOString(),
        JSON.stringify({
          scheduler: "bullmq",
          jobType: "cli.run",
          executionPreference,
          workspaceRoot: loaded.workspaceRoot,
          skillSlug: loaded.skillInvocation?.skillSlug,
          skillPhase: loaded.skillInvocation?.requestedAction,
          skillInvocationContract: loaded.skillInvocation,
        }),
      ],
    },
  ]);
  updateFeatureSpecFileState({
    workspaceRoot: loaded.workspaceRoot,
    featureId: loaded.featureId ?? featureId,
    context,
    status: "running",
    summary: "Runner started feature execution.",
    source: "cli.run",
    schedulerJobId: optionalString((payload as unknown as Record<string, unknown>).schedulerJobId),
    executionId: payload.executionId,
  });

  const result = await processRunnerQueueItem({
    runId: payload.executionId,
    taskId,
    featureId: loaded.featureId,
    prompt: loaded.prompt,
    policy,
    files: loaded.allowedFiles,
    taskText: loaded.description,
    adapterConfig: loaded.adapter,
    skillInvocation: loaded.skillInvocation,
  }, runner);

  if (result.adapterResult) {
    persistCliRunnerArtifacts(dbPath, {
      policy,
      session: result.adapterResult.session,
      rawLog: result.adapterResult.rawLog,
      heartbeat: recordRunnerHeartbeat({
        runId: payload.executionId,
        runnerId: "bullmq-cli-runner",
        policy,
        queueStatus: result.status,
        message: result.summary,
      }),
    });
      }

  const taskStatus = taskStatusFromRunnerStatus(result.status);
  if (taskId) {
    transitionTaskIfAllowed(dbPath, taskId, "running", taskStatus, result.summary, "cli.run");
  }
  const finalMetadata = {
    scheduler: "bullmq",
    jobType: "cli.run",
    executionPreference,
    workspaceRoot: loaded.workspaceRoot,
    adapterId: loaded.adapter.id,
    skillSlug: loaded.skillInvocation?.skillSlug,
    skillPhase: loaded.skillInvocation?.requestedAction,
    skillInvocationContract: loaded.skillInvocation,
    skillOutputContract: result.adapterResult?.result.skillOutput,
    contractValidation: result.adapterResult?.result.contractValidation,
    producedArtifacts: result.adapterResult?.result.skillOutput?.producedArtifacts ?? [],
  };
  runSqlite(dbPath, [
    {
      sql: "UPDATE execution_records SET status = ?, completed_at = ?, summary = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [result.status, new Date().toISOString(), result.summary, JSON.stringify(finalMetadata), payload.executionId],
    },
  ]);
  updateFeatureSpecFileState({
    workspaceRoot: loaded.workspaceRoot,
    featureId: loaded.featureId ?? featureId,
    context,
    status: result.status,
    summary: result.summary,
    source: "cli.run",
    schedulerJobId: optionalString((payload as unknown as Record<string, unknown>).schedulerJobId),
    executionId: payload.executionId,
    skillOutput: result.adapterResult?.result.skillOutput,
  });
  return { executionId: payload.executionId, status: result.status };
}

export async function runCodexAppServerRunJob(
  dbPath: string,
  payload: AppServerRunJobPayload,
  transport?: CodexAppServerTransport,
): Promise<{ executionId: string; status: RunnerQueueStatus }> {
  const context = payload.context ?? {};
  const executionPreference = executionPreferenceFromPayload(payload);
  const featureId = optionalString(context.featureId);
  const taskId = optionalString(context.taskId);
  const skillSlug = optionalString(context.skillSlug);
  const skillPhase = optionalString(context.skillPhase) ?? payload.operation;
  let loaded: ReturnType<typeof loadRunnerTaskContext>;
  let adapterConfig: CodexAppServerAdapterConfig | undefined;
  try {
    loaded = loadRunnerTaskContext(dbPath, payload);
    adapterConfig = loadAppServerAdapterConfig(dbPath, executionPreference?.adapterId);
  } catch (error) {
    const reason = errorMessage(error);
    runSqlite(dbPath, [
      {
        sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, completed_at, summary, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at, summary = excluded.summary, metadata_json = excluded.metadata_json, updated_at = CURRENT_TIMESTAMP`,
        params: [
          payload.executionId,
          optionalString((payload as unknown as Record<string, unknown>).schedulerJobId) ?? null,
          "codex.rpc",
          payload.operation,
          payload.projectId ?? null,
          JSON.stringify(context),
          "blocked",
          new Date().toISOString(),
          reason,
          JSON.stringify({
            scheduler: "bullmq",
            jobType: "rpc.run",
            provider: "codex-rpc",
            executionPreference,
            skillSlug,
            skillPhase,
            blockedReason: reason,
          }),
        ],
      },
    ]);
    recordAuditEvent(dbPath, {
      entityType: taskId ? "task" : featureId ? "feature" : "project",
      entityId: taskId ?? featureId ?? payload.projectId ?? payload.executionId,
      eventType: "codex_rpc_run_blocked",
      source: "rpc_adapter",
      reason,
      payload,
    });
    return { executionId: payload.executionId, status: "blocked" };
  }

  const now = new Date();
  const policy = resolveRunnerPolicy({
    runId: payload.executionId,
    risk: loaded.risk,
    workspaceRoot: loaded.workspaceRoot,
    model: loaded.adapter.defaults.model,
    reasoningEffort: loaded.adapter.defaults.reasoningEffort,
    profile: loaded.adapter.defaults.profile,
    requestedSandboxMode: isTrustedDirectWriteInvocation(loaded.skillInvocation, loaded.allowedFiles) ? "danger-full-access" : loaded.adapter.defaults.sandbox,
    requestedApprovalPolicy: loaded.adapter.defaults.approval,
    now,
  });
  const safety = evaluateRunnerSafety({
    policy,
    prompt: loaded.prompt,
    files: loaded.allowedFiles,
    taskText: loaded.description,
    skillInvocation: loaded.skillInvocation,
  });
  if (!safety.allowed) {
    runSqlite(dbPath, [
      {
        sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, completed_at, summary, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at, summary = excluded.summary, metadata_json = excluded.metadata_json, updated_at = CURRENT_TIMESTAMP`,
        params: [
          payload.executionId,
          optionalString((payload as unknown as Record<string, unknown>).schedulerJobId) ?? null,
          "codex.rpc",
          payload.operation,
          loaded.projectId ?? payload.projectId ?? null,
          JSON.stringify(loaded.skillInvocation ?? context),
          "review_needed",
          now.toISOString(),
          safety.summary,
          JSON.stringify({
            scheduler: "bullmq",
            jobType: "rpc.run",
            provider: "codex-rpc",
            executionPreference,
            workspaceRoot: loaded.workspaceRoot,
            safety,
            skillSlug: loaded.skillInvocation?.skillSlug,
            skillPhase: loaded.skillInvocation?.requestedAction,
          }),
        ],
      },
    ]);
    return { executionId: payload.executionId, status: "review_needed" };
  }
  const heartbeat = recordRunnerHeartbeat({
    runId: payload.executionId,
    runnerId: "bullmq-codex-rpc-adapter",
    policy,
    queueStatus: "running",
    message: `Running ${taskId ?? payload.operation}`,
    now,
  });
  persistCliRunnerArtifacts(dbPath, { policy, heartbeat });
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, started_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = COALESCE(execution_records.started_at, excluded.started_at), metadata_json = excluded.metadata_json, updated_at = CURRENT_TIMESTAMP`,
      params: [
        payload.executionId,
        optionalString((payload as unknown as Record<string, unknown>).schedulerJobId) ?? null,
        "codex.rpc",
        payload.operation,
        loaded.projectId ?? payload.projectId ?? null,
        JSON.stringify(loaded.skillInvocation ?? { ...context, featureId: loaded.featureId ?? featureId, taskId }),
        "running",
        now.toISOString(),
        JSON.stringify({
          scheduler: "bullmq",
          jobType: "rpc.run",
          provider: "codex-rpc",
          executionPreference,
          workspaceRoot: loaded.workspaceRoot,
          skillSlug: loaded.skillInvocation?.skillSlug,
          skillPhase: loaded.skillInvocation?.requestedAction,
          skillInvocationContract: loaded.skillInvocation,
          threadId: payload.threadId,
          transport: adapterConfig?.transport,
          model: policy.model,
          cwd: loaded.workspaceRoot,
          outputSchema: policy.outputSchema,
          adapterConfig: {
            id: adapterConfig?.id,
            displayName: adapterConfig?.displayName,
            executable: adapterConfig?.executable,
            args: adapterConfig?.args,
            endpoint: adapterConfig?.endpoint,
          },
        }),
      ],
    },
  ]);
  updateFeatureSpecFileState({
    workspaceRoot: loaded.workspaceRoot,
    featureId: loaded.featureId ?? featureId,
    context,
    status: "running",
    summary: "Codex RPC started feature execution.",
    source: "rpc.run",
    schedulerJobId: optionalString((payload as unknown as Record<string, unknown>).schedulerJobId),
    executionId: payload.executionId,
  });

  const activeTransport = transport ?? createCodexAppServerTransportFromConfig(adapterConfig ?? DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG, loaded.workspaceRoot);
  let adapterResult: Awaited<ReturnType<typeof runCodexAppServerSession>>;
  try {
    adapterResult = await runCodexAppServerSession({
      runId: payload.executionId,
      workspaceRoot: loaded.workspaceRoot,
      prompt: loaded.prompt,
      policy,
      transport: activeTransport,
      skillInvocation: loaded.skillInvocation,
      threadId: payload.threadId,
      startedAt: now.toISOString(),
    });
  } catch (error) {
    await activeTransport.close?.();
    const reason = errorMessage(error);
    const completedAt = new Date().toISOString();
    persistCliRunnerArtifacts(dbPath, {
      policy,
      heartbeat: recordRunnerHeartbeat({
        runId: payload.executionId,
        runnerId: "bullmq-codex-rpc-adapter",
        policy,
        queueStatus: "failed",
        message: reason,
      }),
    });
    runSqlite(dbPath, [
      {
        sql: "UPDATE execution_records SET status = ?, completed_at = ?, summary = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params: [
          "failed",
          completedAt,
          reason,
          JSON.stringify({
            scheduler: "bullmq",
            jobType: "rpc.run",
            executionPreference,
            workspaceRoot: loaded.workspaceRoot,
            skillSlug: loaded.skillInvocation?.skillSlug,
            skillPhase: loaded.skillInvocation?.requestedAction,
            skillInvocationContract: loaded.skillInvocation,
            threadId: payload.threadId,
            transport: adapterConfig?.transport,
            model: policy.model,
            cwd: loaded.workspaceRoot,
            outputSchema: policy.outputSchema,
            adapterConfig: {
              id: adapterConfig?.id,
              displayName: adapterConfig?.displayName,
              executable: adapterConfig?.executable,
              args: adapterConfig?.args,
              endpoint: adapterConfig?.endpoint,
            },
            error: reason,
          }),
          payload.executionId,
        ],
      },
    ]);
    updateFeatureSpecFileState({
      workspaceRoot: loaded.workspaceRoot,
      featureId: loaded.featureId ?? featureId,
      context,
      status: "failed",
      summary: reason,
      source: "rpc.run",
      schedulerJobId: optionalString((payload as unknown as Record<string, unknown>).schedulerJobId),
      executionId: payload.executionId,
    });
    return { executionId: payload.executionId, status: "failed" };
  } finally {
    if (!transport) await activeTransport.close?.();
  }
  persistCliRunnerArtifacts(dbPath, {
    policy,
    session: adapterResult.session,
    rawLog: adapterResult.rawLog,
    heartbeat: recordRunnerHeartbeat({
      runId: payload.executionId,
      runnerId: "bullmq-codex-rpc-adapter",
      policy,
      queueStatus: appServerResultStatus(adapterResult),
      message: adapterResult.result.skillOutput?.summary ?? adapterResult.rawLog.stderr,
    }),
  });
    const finalStatus = appServerResultStatus(adapterResult);
  const finalSummary = finalStatus === "approval_needed"
    ? "Codex RPC is waiting for approval; autonomous execution is paused for this Feature."
    : finalStatus === "failed" && adapterResult.result.contractValidation && !adapterResult.result.contractValidation.valid
    ? `Skill output contract validation failed: ${adapterResult.result.contractValidation.reasons.join("; ")}`
    : adapterResult.result.skillOutput?.summary ?? (adapterResult.rawLog.stderr || `Codex RPC ${finalStatus}.`);
  runSqlite(dbPath, [
    {
      sql: "UPDATE execution_records SET status = ?, completed_at = ?, summary = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [
        finalStatus,
        new Date().toISOString(),
        finalSummary,
        JSON.stringify({
          scheduler: "bullmq",
          jobType: "rpc.run",
          executionPreference,
          workspaceRoot: loaded.workspaceRoot,
          skillSlug: loaded.skillInvocation?.skillSlug,
          skillPhase: loaded.skillInvocation?.requestedAction,
          skillInvocationContract: loaded.skillInvocation,
          skillOutputContract: adapterResult.result.skillOutput,
          producedArtifacts: adapterResult.result.skillOutput?.producedArtifacts ?? [],
          threadId: adapterResult.session.sessionId,
          turnId: eventTurnId(adapterResult.rawLog.events),
          transport: adapterConfig?.transport,
          model: policy.model,
          cwd: loaded.workspaceRoot,
          outputSchema: policy.outputSchema,
          contractValidation: adapterResult.result.contractValidation,
          approvalState: approvalStateFromEvents(adapterResult.rawLog.events),
          eventRefs: adapterResult.rawLog.events.map((event, index) => ({
            index,
            type: optionalString(event.type),
            threadId: optionalString(event.threadId) ?? optionalString(event.thread_id),
            turnId: optionalString(event.turnId) ?? optionalString(event.turn_id),
          })),
          adapterConfig: {
            id: adapterConfig?.id,
            displayName: adapterConfig?.displayName,
            executable: adapterConfig?.executable,
            args: adapterConfig?.args,
            endpoint: adapterConfig?.endpoint,
          },
        }),
        payload.executionId,
      ],
    },
  ]);
  updateFeatureSpecFileState({
    workspaceRoot: loaded.workspaceRoot,
    featureId: loaded.featureId ?? featureId,
    context,
    status: finalStatus,
    summary: finalSummary,
    source: "rpc.run",
    schedulerJobId: optionalString((payload as unknown as Record<string, unknown>).schedulerJobId),
    executionId: payload.executionId,
    skillOutput: adapterResult.result.skillOutput,
  });
  return { executionId: payload.executionId, status: finalStatus };
}

export async function runGeminiAcpRunJob(
  dbPath: string,
  payload: AppServerRunJobPayload,
  transport?: GeminiAcpTransport,
): Promise<{ executionId: string; status: RunnerQueueStatus }> {
  const context = payload.context ?? {};
  const executionPreference = executionPreferenceFromPayload(payload);
  const featureId = optionalString(context.featureId);
  const taskId = optionalString(context.taskId);
  const skillSlug = optionalString(context.skillSlug);
  const skillPhase = optionalString(context.skillPhase) ?? payload.operation;
  let loaded: ReturnType<typeof loadRunnerTaskContext>;
  let adapterConfig: GeminiAcpAdapterConfig | undefined;
  try {
    loaded = loadRunnerTaskContext(dbPath, payload);
    adapterConfig = loadGeminiAcpAdapterConfig(dbPath, executionPreference?.adapterId);
  } catch (error) {
    const reason = errorMessage(error);
    runSqlite(dbPath, [
      {
        sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, completed_at, summary, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at, summary = excluded.summary, metadata_json = excluded.metadata_json, updated_at = CURRENT_TIMESTAMP`,
        params: [
          payload.executionId,
          optionalString((payload as unknown as Record<string, unknown>).schedulerJobId) ?? null,
          "gemini.acp",
          payload.operation,
          payload.projectId ?? null,
          JSON.stringify(context),
          "blocked",
          new Date().toISOString(),
          reason,
          JSON.stringify({ scheduler: "bullmq", jobType: "rpc.run", provider: "gemini-acp", executionPreference, skillSlug, skillPhase, blockedReason: reason }),
        ],
      },
    ]);
    recordAuditEvent(dbPath, {
      entityType: taskId ? "task" : featureId ? "feature" : "project",
      entityId: taskId ?? featureId ?? payload.projectId ?? payload.executionId,
      eventType: "gemini_acp_run_blocked",
      source: "rpc_adapter",
      reason,
      payload,
    });
    return { executionId: payload.executionId, status: "blocked" };
  }

  const now = new Date();
  const policy = resolveRunnerPolicy({
    runId: payload.executionId,
    risk: loaded.risk,
    workspaceRoot: loaded.workspaceRoot,
    model: loaded.adapter.defaults.model,
    reasoningEffort: loaded.adapter.defaults.reasoningEffort,
    profile: loaded.adapter.defaults.profile,
    requestedSandboxMode: isTrustedDirectWriteInvocation(loaded.skillInvocation, loaded.allowedFiles) ? "danger-full-access" : loaded.adapter.defaults.sandbox,
    requestedApprovalPolicy: loaded.adapter.defaults.approval,
    now,
  });
  const safety = evaluateRunnerSafety({
    policy,
    prompt: loaded.prompt,
    files: loaded.allowedFiles,
    taskText: loaded.description,
    skillInvocation: loaded.skillInvocation,
  });
  if (!safety.allowed) {
    runSqlite(dbPath, [
      {
        sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, completed_at, summary, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at, summary = excluded.summary, metadata_json = excluded.metadata_json, updated_at = CURRENT_TIMESTAMP`,
        params: [
          payload.executionId,
          optionalString((payload as unknown as Record<string, unknown>).schedulerJobId) ?? null,
          "gemini.acp",
          payload.operation,
          loaded.projectId ?? payload.projectId ?? null,
          JSON.stringify(loaded.skillInvocation ?? context),
          "review_needed",
          now.toISOString(),
          safety.summary,
          JSON.stringify({ scheduler: "bullmq", jobType: "rpc.run", provider: "gemini-acp", executionPreference, workspaceRoot: loaded.workspaceRoot, safety, skillSlug: loaded.skillInvocation?.skillSlug, skillPhase: loaded.skillInvocation?.requestedAction }),
        ],
      },
    ]);
    return { executionId: payload.executionId, status: "review_needed" };
  }

  const heartbeat = recordRunnerHeartbeat({
    runId: payload.executionId,
    runnerId: "bullmq-gemini-acp-adapter",
    policy,
    queueStatus: "running",
    message: `Running ${taskId ?? payload.operation}`,
    now,
  });
  persistCliRunnerArtifacts(dbPath, { policy, heartbeat });
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, started_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = COALESCE(execution_records.started_at, excluded.started_at), metadata_json = excluded.metadata_json, updated_at = CURRENT_TIMESTAMP`,
      params: [
        payload.executionId,
        optionalString((payload as unknown as Record<string, unknown>).schedulerJobId) ?? null,
        "gemini.acp",
        payload.operation,
        loaded.projectId ?? payload.projectId ?? null,
        JSON.stringify(loaded.skillInvocation ?? { ...context, featureId: loaded.featureId ?? featureId, taskId }),
        "running",
        now.toISOString(),
        JSON.stringify({
          scheduler: "bullmq",
          jobType: "rpc.run",
          provider: "gemini-acp",
          executionPreference,
          workspaceRoot: loaded.workspaceRoot,
          skillSlug: loaded.skillInvocation?.skillSlug,
          skillPhase: loaded.skillInvocation?.requestedAction,
          skillInvocationContract: loaded.skillInvocation,
          sessionId: payload.threadId,
          transport: adapterConfig?.transport,
          model: policy.model,
          cwd: loaded.workspaceRoot,
          outputSchema: policy.outputSchema,
          adapterConfig: adapterMetadata(adapterConfig),
        }),
      ],
    },
  ]);
  updateFeatureSpecFileState({
    workspaceRoot: loaded.workspaceRoot,
    featureId: loaded.featureId ?? featureId,
    context,
    status: "running",
    summary: "Gemini ACP started feature execution.",
    source: "rpc.run",
    schedulerJobId: optionalString((payload as unknown as Record<string, unknown>).schedulerJobId),
    executionId: payload.executionId,
  });

  const activeTransport = transport ?? createGeminiAcpTransportFromConfig(adapterConfig ?? DEFAULT_GEMINI_ACP_ADAPTER_CONFIG, loaded.workspaceRoot);
  let adapterResult: Awaited<ReturnType<typeof runGeminiAcpSession>>;
  try {
    adapterResult = await runGeminiAcpSession({
      runId: payload.executionId,
      workspaceRoot: loaded.workspaceRoot,
      prompt: loaded.prompt,
      policy,
      transport: activeTransport,
      commandArgs: (adapterConfig ?? DEFAULT_GEMINI_ACP_ADAPTER_CONFIG).args,
      skillInvocation: loaded.skillInvocation,
      sessionId: payload.threadId,
      startedAt: now.toISOString(),
    });
  } catch (error) {
    await activeTransport.close?.();
    const reason = errorMessage(error);
    const completedAt = new Date().toISOString();
    persistCliRunnerArtifacts(dbPath, {
      policy,
      heartbeat: recordRunnerHeartbeat({
        runId: payload.executionId,
        runnerId: "bullmq-gemini-acp-adapter",
        policy,
        queueStatus: "failed",
        message: reason,
      }),
    });
    runSqlite(dbPath, [
      {
        sql: "UPDATE execution_records SET status = ?, completed_at = ?, summary = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        params: [
          "failed",
          completedAt,
          reason,
          JSON.stringify({
            scheduler: "bullmq",
            jobType: "rpc.run",
            provider: "gemini-acp",
            executionPreference,
            workspaceRoot: loaded.workspaceRoot,
            skillSlug: loaded.skillInvocation?.skillSlug,
            skillPhase: loaded.skillInvocation?.requestedAction,
            skillInvocationContract: loaded.skillInvocation,
            sessionId: payload.threadId,
            transport: adapterConfig?.transport,
            model: policy.model,
            cwd: loaded.workspaceRoot,
            outputSchema: policy.outputSchema,
            adapterConfig: adapterMetadata(adapterConfig),
            error: reason,
          }),
          payload.executionId,
        ],
      },
    ]);
    updateFeatureSpecFileState({
      workspaceRoot: loaded.workspaceRoot,
      featureId: loaded.featureId ?? featureId,
      context,
      status: "failed",
      summary: reason,
      source: "rpc.run",
      schedulerJobId: optionalString((payload as unknown as Record<string, unknown>).schedulerJobId),
      executionId: payload.executionId,
    });
    return { executionId: payload.executionId, status: "failed" };
  } finally {
    if (!transport) await activeTransport.close?.();
  }

  persistCliRunnerArtifacts(dbPath, {
    policy,
    session: adapterResult.session,
    rawLog: adapterResult.rawLog,
    heartbeat: recordRunnerHeartbeat({
      runId: payload.executionId,
      runnerId: "bullmq-gemini-acp-adapter",
      policy,
      queueStatus: appServerResultStatus(adapterResult),
      message: adapterResult.result.skillOutput?.summary ?? adapterResult.rawLog.stderr,
    }),
  });
  const finalStatus = appServerResultStatus(adapterResult);
  const finalSummary = finalStatus === "approval_needed"
    ? "Gemini ACP is waiting for permission; autonomous execution is paused for this Feature."
    : finalStatus === "failed" && adapterResult.result.contractValidation && !adapterResult.result.contractValidation.valid
    ? `Skill output contract validation failed: ${adapterResult.result.contractValidation.reasons.join("; ")}`
    : adapterResult.result.skillOutput?.summary ?? (adapterResult.rawLog.stderr || `Gemini ACP ${finalStatus}.`);
  runSqlite(dbPath, [
    {
      sql: "UPDATE execution_records SET status = ?, completed_at = ?, summary = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [
        finalStatus,
        new Date().toISOString(),
        finalSummary,
        JSON.stringify({
          scheduler: "bullmq",
          jobType: "rpc.run",
          provider: "gemini-acp",
          executionPreference,
          workspaceRoot: loaded.workspaceRoot,
          skillSlug: loaded.skillInvocation?.skillSlug,
          skillPhase: loaded.skillInvocation?.requestedAction,
          skillInvocationContract: loaded.skillInvocation,
          skillOutputContract: adapterResult.result.skillOutput,
          producedArtifacts: adapterResult.result.skillOutput?.producedArtifacts ?? [],
          sessionId: adapterResult.session.sessionId,
          transport: adapterConfig?.transport,
          model: policy.model,
          cwd: loaded.workspaceRoot,
          outputSchema: policy.outputSchema,
          contractValidation: adapterResult.result.contractValidation,
          approvalState: approvalStateFromEvents(adapterResult.rawLog.events),
          eventRefs: adapterResult.rawLog.events.map((event, index) => ({
            index,
            type: optionalString(event.type),
          })),
          adapterConfig: adapterMetadata(adapterConfig),
        }),
        payload.executionId,
      ],
    },
  ]);
  updateFeatureSpecFileState({
    workspaceRoot: loaded.workspaceRoot,
    featureId: loaded.featureId ?? featureId,
    context,
    status: finalStatus,
    summary: finalSummary,
    source: "rpc.run",
    schedulerJobId: optionalString((payload as unknown as Record<string, unknown>).schedulerJobId),
    executionId: payload.executionId,
    skillOutput: adapterResult.result.skillOutput,
  });
  return { executionId: payload.executionId, status: finalStatus };
}

export async function runRpcRunJob(
  dbPath: string,
  payload: AppServerRunJobPayload,
  appServerTransport?: CodexAppServerTransport,
  geminiAcpTransport?: GeminiAcpTransport,
): Promise<{ executionId: string; status: RunnerQueueStatus }> {
  const preference = executionPreferenceFromPayload(payload);
  const provider = loadActiveRpcProvider(dbPath, preference?.runMode === "rpc" ? preference.adapterId : undefined);
  if (provider === "gemini-acp") {
    return runGeminiAcpRunJob(dbPath, payload, geminiAcpTransport);
  }
  return runCodexAppServerRunJob(dbPath, payload, appServerTransport);
}

function updateFeatureSpecFileState(input: {
  workspaceRoot?: string;
  featureId?: string;
  context: ExecutorJobContext;
  status: RunnerQueueStatus;
  summary: string;
  source: string;
  schedulerJobId?: string;
  executionId: string;
  skillOutput?: SkillOutputContract;
}): void {
  if (!input.workspaceRoot || !input.featureId || input.context.skillSlug !== "codex-coding-skill") return;
  const featureSpecPath = optionalString(input.context.featureSpecPath);
  if (!featureSpecPath?.startsWith("docs/features/")) return;
  const featureFolder = featureSpecPath.slice("docs/features/".length);
  try {
    const current = readFileSpecState(input.workspaceRoot, featureFolder, input.featureId);
    const patch = input.skillOutput
      ? skillOutputToSpecStatePatch(input.skillOutput)
      : {
          status: runnerStatusToFileSpecStatus(input.status),
          blockedReasons: input.status === "blocked" || input.status === "failed" ? [input.summary] : [],
          nextAction: input.status === "running"
            ? "Runner is executing this Feature."
            : input.status === "approval_needed"
              ? "Resolve the pending approval request before autonomous execution can continue."
            : input.status === "completed"
              ? "Run status checks and prepare review."
              : "Review execution result and resume or skip.",
        };
    writeFileSpecState(input.workspaceRoot, featureFolder, mergeFileSpecState(current, {
      ...patch,
      currentJob: {
        schedulerJobId: input.schedulerJobId,
        executionId: input.executionId,
        operation: optionalString(input.context.skillPhase) ?? optionalString(input.context.operation) ?? "feature_execution",
        startedAt: input.status === "running" ? new Date().toISOString() : current.currentJob?.startedAt,
        completedAt: input.status !== "running" ? new Date().toISOString() : current.currentJob?.completedAt,
      },
    }, {
      source: input.source,
      summary: input.summary,
      schedulerJobId: input.schedulerJobId,
      executionId: input.executionId,
    }));
  } catch {
    // Spec state is operator-facing context; execution_records remain the runtime fact if this projection fails.
  }
}

function runnerStatusToFileSpecStatus(status: RunnerQueueStatus) {
  if (status === "completed") return "completed";
  if (status === "approval_needed") return "approval_needed";
  if (status === "review_needed") return "review_needed";
  if (status === "blocked") return "blocked";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "queued";
}

export function createQueuedJobRecord(dbPath: string, input: {
  queueName: string;
  jobType: SchedulerJobType;
  payload: unknown;
}): SchedulerEnqueueResult {
  const schedulerJobId = randomUUID();
  const bullmqJobId = randomUUID();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (
        id, bullmq_job_id, queue_name, job_type, status,
        payload_json, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      params: [
        schedulerJobId,
        bullmqJobId,
        input.queueName,
        input.jobType,
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

async function dispatchCliJob(dbPath: string, job: Job, runner?: CliCommandRunner, appServerTransport?: CodexAppServerTransport): Promise<void> {
  updateSchedulerJobRecord(dbPath, String(job.id), "running", undefined, job.attemptsMade);
  try {
    const result = job.name === "codex.rpc.run" || job.name === "codex.app_server.run"
      ? await runCodexAppServerRunJob(dbPath, job.data as AppServerRunJobPayload, appServerTransport)
      : job.name === "rpc.run"
      ? await runRpcRunJob(dbPath, job.data as AppServerRunJobPayload, appServerTransport)
      : await runCliRunJob(dbPath, job.data as CliRunJobPayload, runner);
    updateSchedulerJobRecord(dbPath, String(job.id), result.status === "blocked" || result.status === "approval_needed" ? result.status : "completed", undefined, job.attemptsMade);
  } catch (error) {
    updateSchedulerJobRecord(dbPath, String(job.id), "failed", error, job.attemptsMade);
    throw error;
  }
}

function appServerResultStatus(result: { session: { exitCode: number | null }; result: { skillOutput?: SkillOutputContract; events?: Array<Record<string, unknown>> } }): RunnerQueueStatus {
  if (hasApprovalRequest(result.result.events)) return "approval_needed";
  if (result.result.events?.some((event) => String(event.type ?? "") === "prompt/result" && String(event.stopReason ?? "") === "cancelled")) return "blocked";
  if ((result.session.exitCode ?? 0) !== 0) return "failed";
  const status = result.result.skillOutput?.status;
  if (status === "review_needed" || status === "blocked" || status === "failed" || status === "completed") {
    return status;
  }
  return "completed";
}

function hasApprovalRequest(events?: Array<Record<string, unknown>>): boolean {
  return (events ?? []).some((event) => {
    const type = optionalString(event.type) ?? optionalString(event.method) ?? "";
    return type === "approval/request" || type.endsWith("/approval/request") || type === "requestPermission";
  });
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
  const payloadContext = payload.context ?? {};
  const executionPreference = executionPreferenceFromPayload(payload);
  const featureIdFromContext = optionalString(payloadContext.featureId);
  const taskIdFromContext = optionalString(payloadContext.taskId);
  const result = runSqlite(dbPath, [], [
    {
      name: "graphTask",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, '' AS description, t.status, t.risk, t.allowed_files_json
        FROM task_graph_tasks t LEFT JOIN features f ON f.id = t.feature_id
        WHERE t.id = ? LIMIT 1`,
      params: [taskIdFromContext ?? ""],
    },
    {
      name: "task",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, COALESCE(t.description, '') AS description, t.status,
          'medium' AS risk, COALESCE(t.allowed_files_json, '[]') AS allowed_files_json
        FROM tasks t LEFT JOIN features f ON f.id = t.feature_id
        WHERE t.id = ? LIMIT 1`,
      params: [taskIdFromContext ?? ""],
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
      params: [payload.projectId ?? "", featureIdFromContext ?? ""],
    },
    {
      name: "feature",
      sql: `SELECT id, project_id, title, status, COALESCE(primary_requirements_json, '[]') AS primary_requirements_json
        FROM features WHERE id = ? LIMIT 1`,
      params: [featureIdFromContext ?? ""],
    },
    {
      name: "adapter",
      sql: executionPreference?.runMode === "cli" && executionPreference.adapterId
        ? "SELECT * FROM cli_adapter_configs WHERE id = ? LIMIT 1"
        : "SELECT * FROM cli_adapter_configs WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1",
      params: executionPreference?.runMode === "cli" && executionPreference.adapterId ? [executionPreference.adapterId] : [],
    },
    { name: "adapterCount", sql: "SELECT COUNT(*) AS count FROM cli_adapter_configs" },
  ]);
  const row = result.queries.graphTask[0] ?? result.queries.task[0];
  const featureRow = result.queries.feature[0];
  if (!row && !featureRow && taskIdFromContext) {
    throw new Error(`Task not found: ${taskIdFromContext}`);
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
  const selectedBuiltin = executionPreference?.runMode === "cli" ? builtinCliAdapter(executionPreference.adapterId) : undefined;
  if (executionPreference?.runMode === "cli" && !adapterRow && !selectedBuiltin) {
    throw new Error(`CLI adapter not found: ${executionPreference.adapterId}`);
  }
  if (!adapterRow && !selectedBuiltin && adapterCount > 0) {
    throw new Error("No active CLI adapter configured. Activate an adapter in System Settings before starting new runs.");
  }
  const adapter = adapterRow ? adapterFromRow(adapterRow) : selectedBuiltin ?? adapterFromRow(adapterRow);
  if (adapter.status === "disabled" || adapter.status === "invalid") {
    throw new Error(`CLI adapter is not available: ${adapter.id}`);
  }
  const featureId = featureIdFromContext ?? optionalString(row?.feature_id) ?? optionalString(featureRow?.id);
  const title = optionalString(row?.title) ?? optionalString(featureRow?.title) ?? `Project ${projectId}`;
  const description = optionalString(row?.description) ?? title;
  const risk = normalizeRisk(row?.risk);
  const allowedFiles = parseJsonArray(row?.allowed_files_json).map(String);
  const skillInvocation = buildCliSkillInvocation({
    payload,
    projectId,
    workspaceRoot: workspace.workspaceRoot,
    featureId,
    taskId: taskIdFromContext,
    requirementIds: parseJsonArray(featureRow?.primary_requirements_json).map(String),
    allowedFiles,
    risk,
    sandboxMode: adapter.defaults.sandbox,
    approvalPolicy: adapter.defaults.approval,
  });
  const context = [
    `Execution ${payload.executionId}${taskIdFromContext ? ` for task ${taskIdFromContext}` : ""}${featureId ? ` in feature ${featureId}` : ""}: ${title}`,
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
    risk,
    allowedFiles,
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
    "The scheduler pre-read these workspace-local files before invoking the CLI. If shell commands fail in the child runner, use this bundle as governing workspace context and still produce the expected artifacts.",
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
  if (status === "approval_needed") return "review_needed";
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

function builtinCliAdapter(id?: string): CliAdapterConfig | undefined {
  if (id === DEFAULT_CLI_ADAPTER_CONFIG.id) return DEFAULT_CLI_ADAPTER_CONFIG;
  if (id === GEMINI_CLI_ADAPTER_CONFIG.id) return GEMINI_CLI_ADAPTER_CONFIG;
  return undefined;
}

function executionPreferenceFromPayload(payload: ExecutorRunJobPayload): ExecutionPreferenceV1 | undefined {
  const candidate = payload.executionPreference
    ?? (typeof payload.context?.executionPreference === "object" && payload.context.executionPreference !== null
      ? payload.context.executionPreference as ExecutionPreferenceV1
      : undefined);
  if (!candidate) return undefined;
  return {
    runMode: candidate.runMode === "rpc" ? "rpc" : "cli",
    adapterId: optionalString(candidate.adapterId) ?? "",
    source: candidate.source === "project" || candidate.source === "default" ? candidate.source : "job",
  };
}

function loadAppServerAdapterConfig(dbPath: string, adapterId?: string): CodexAppServerAdapterConfig {
  const result = runSqlite(dbPath, [], [
    {
      name: "adapter",
      sql: adapterId
        ? "SELECT * FROM rpc_adapter_configs WHERE id = ? AND provider = 'codex-rpc' LIMIT 1"
        : "SELECT * FROM rpc_adapter_configs WHERE provider = 'codex-rpc' AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
      params: adapterId ? [adapterId] : [],
    },
    { name: "adapterCount", sql: "SELECT COUNT(*) AS count FROM rpc_adapter_configs WHERE provider = 'codex-rpc'" },
    {
      name: "legacyAdapter",
      sql: adapterId
        ? "SELECT * FROM codex_app_server_adapter_configs WHERE id = ? LIMIT 1"
        : "SELECT * FROM codex_app_server_adapter_configs WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1",
      params: adapterId ? [adapterId] : [],
    },
    { name: "legacyAdapterCount", sql: "SELECT COUNT(*) AS count FROM codex_app_server_adapter_configs" },
  ]);
  const row = result.queries.adapter[0] ?? result.queries.legacyAdapter[0];
  const adapterCount = Number(result.queries.adapterCount[0]?.count ?? 0);
  const legacyAdapterCount = Number(result.queries.legacyAdapterCount[0]?.count ?? 0);
  if (adapterId && !row && adapterId !== DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG.id) {
    throw new Error(`Codex RPC adapter not found: ${adapterId}`);
  }
  if (!row && (adapterCount > 0 || legacyAdapterCount > 0)) {
    throw new Error("No active Codex RPC adapter configured. Activate an adapter in System Settings before starting Codex RPC runs.");
  }
  if (!row) return DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG;
  if (String(row.status) === "disabled" || String(row.status) === "invalid") {
    throw new Error(`Codex RPC adapter is not available: ${String(row.id)}`);
  }
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    executable: String(row.executable),
    args: parseJsonArray(row.args_json).map(String),
    transport: normalizeAppServerTransport(row.transport),
    endpoint: optionalString(row.endpoint),
    requestTimeoutMs: Number(row.request_timeout_ms ?? DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG.requestTimeoutMs),
    status: String(row.status) === "disabled" ? "disabled" : "active",
    updatedAt: optionalString(row.updated_at),
  };
}

function loadActiveRpcProvider(dbPath: string, adapterId?: string): "codex-rpc" | "gemini-acp" {
  const result = runSqlite(dbPath, [], [
    {
      name: "adapter",
      sql: adapterId
        ? "SELECT provider FROM rpc_adapter_configs WHERE id = ? LIMIT 1"
        : "SELECT provider FROM rpc_adapter_configs WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1",
      params: adapterId ? [adapterId] : [],
    },
    { name: "adapterCount", sql: "SELECT COUNT(*) AS count FROM rpc_adapter_configs" },
  ]);
  const row = result.queries.adapter[0];
  const adapterCount = Number(result.queries.adapterCount[0]?.count ?? 0);
  if (adapterId && !row) {
    if (adapterId === DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG.id) return "codex-rpc";
    if (adapterId === DEFAULT_GEMINI_ACP_ADAPTER_CONFIG.id) return "gemini-acp";
    throw new Error(`RPC adapter not found: ${adapterId}`);
  }
  if (!row && adapterCount > 0) {
    throw new Error("No active RPC adapter configured. Activate an RPC adapter in System Settings before starting RPC runs.");
  }
  const provider = optionalString(row?.provider);
  return provider === "gemini-acp" ? "gemini-acp" : "codex-rpc";
}

function loadGeminiAcpAdapterConfig(dbPath: string, adapterId?: string): GeminiAcpAdapterConfig {
  const result = runSqlite(dbPath, [], [
    {
      name: "adapter",
      sql: adapterId
        ? "SELECT * FROM rpc_adapter_configs WHERE id = ? AND provider = 'gemini-acp' LIMIT 1"
        : "SELECT * FROM rpc_adapter_configs WHERE provider = 'gemini-acp' AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
      params: adapterId ? [adapterId] : [],
    },
    { name: "adapterCount", sql: "SELECT COUNT(*) AS count FROM rpc_adapter_configs WHERE provider = 'gemini-acp'" },
  ]);
  const row = result.queries.adapter[0];
  const adapterCount = Number(result.queries.adapterCount[0]?.count ?? 0);
  if (adapterId && !row && adapterId !== DEFAULT_GEMINI_ACP_ADAPTER_CONFIG.id) {
    throw new Error(`Gemini ACP adapter not found: ${adapterId}`);
  }
  if (!row && adapterCount > 0) {
    throw new Error("No active Gemini ACP adapter configured. Activate an adapter in System Settings before starting Gemini ACP runs.");
  }
  if (!row) return DEFAULT_GEMINI_ACP_ADAPTER_CONFIG;
  if (String(row.status) === "disabled" || String(row.status) === "invalid") {
    throw new Error(`Gemini ACP adapter is not available: ${String(row.id)}`);
  }
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    provider: "gemini-acp",
    executable: String(row.executable),
    args: parseJsonArray(row.args_json).map(String),
    transport: normalizeAppServerTransport(row.transport),
    endpoint: optionalString(row.endpoint),
    requestTimeoutMs: Number(row.request_timeout_ms ?? DEFAULT_GEMINI_ACP_ADAPTER_CONFIG.requestTimeoutMs),
    status: String(row.status) === "disabled" ? "disabled" : "active",
    updatedAt: optionalString(row.updated_at),
  };
}

function adapterMetadata(adapterConfig: CodexAppServerAdapterConfig | GeminiAcpAdapterConfig | undefined): Record<string, unknown> {
  return {
    id: adapterConfig?.id,
    displayName: adapterConfig?.displayName,
    executable: adapterConfig?.executable,
    args: adapterConfig?.args,
    endpoint: adapterConfig?.endpoint,
  };
}

function normalizeAppServerTransport(value: unknown): CodexAppServerAdapterConfig["transport"] {
  if (value === "unix" || value === "http" || value === "jsonrpc" || value === "websocket") return value;
  return "stdio";
}

function resolveWorkspaceRoot(row?: Record<string, unknown>): string | undefined {
  return optionalString(row?.repository_local_path) ?? optionalString(row?.target_repo_path);
}

function eventTurnId(events: Array<Record<string, unknown>>): string | undefined {
  for (const event of events) {
    const turnId = optionalString(event.turnId)
      ?? optionalString(event.turn_id)
      ?? (String(event.type ?? "") === "turn/started" ? optionalString(event.id) : undefined)
      ?? (typeof event.turn === "object" && event.turn !== null ? optionalString((event.turn as Record<string, unknown>).id) : undefined);
    if (turnId) return turnId;
  }
  return undefined;
}

function approvalStateFromEvents(events: Array<Record<string, unknown>>): "none" | "pending" {
  return events.some((event) => {
    const type = String(event.type ?? "");
    return type === "approval/request"
      || type.endsWith("/approval/request")
      || type === "item/commandExecution/requestApproval"
      || type === "item/fileChange/requestApproval"
      || type === "item/permissions/requestApproval"
      || type === "requestPermission";
  }) ? "pending" : "none";
}

function buildCliSkillInvocation(input: {
  payload: CliRunJobPayload;
  projectId?: string;
  workspaceRoot: string;
  featureId?: string;
  taskId?: string;
  requirementIds?: string[];
  allowedFiles: string[];
  risk: RiskLevel;
  sandboxMode?: string;
  approvalPolicy?: string;
}): SkillInvocationContract {
  const context = input.payload.context ?? {};
  const skillSlug = optionalString(context.skillSlug) ?? (input.taskId ? "codex-coding-skill" : "technical-context-skill");
  const requestedAction = input.payload.requestedAction ?? optionalString(context.skillPhase) ?? input.payload.operation;
  const contextSourcePaths = optionalStringArray(context.sourcePaths);
  const contextImagePaths = optionalStringArray(context.imagePaths);
  const contextExpectedArtifacts = normalizeArtifactContracts(context.expectedArtifacts);
  const sourcePaths = contextSourcePaths.length
    ? contextSourcePaths
    : [
        "AGENTS.md",
        ".agents/skills",
        ...(input.featureId ? [
          `docs/features/${input.featureId}/requirements.md`,
          `docs/features/${input.featureId}/design.md`,
          `docs/features/${input.featureId}/tasks.md`,
        ] : []),
      ];
  const expectedArtifacts = contextExpectedArtifacts.length
    ? contextExpectedArtifacts
    : input.taskId
      ? normalizeArtifactContracts([".autobuild/runs/cli-adapter.json"])
      : input.featureId
        ? normalizeArtifactContracts([`docs/features/${input.featureId}/design.md`, `docs/features/${input.featureId}/tasks.md`])
        : normalizeArtifactContracts([".autobuild/reports/spec-intake.json"]);
  return {
    contractVersion: "skill-contract/v1",
    executionId: input.payload.executionId,
    projectId: input.projectId ?? "unknown-project",
    workspaceRoot: input.workspaceRoot,
    operation: input.payload.operation,
    skillSlug,
    sourcePaths,
    imagePaths: contextImagePaths,
    expectedArtifacts,
    specState: parseJsonObject(context.specState),
    operatorInput: buildSkillOperatorInput(context),
    traceability: {
      featureId: input.featureId,
      taskId: input.taskId,
      requirementIds: input.payload.traceability?.requirementIds ?? input.requirementIds ?? [],
    },
    constraints: {
      allowedFiles: input.allowedFiles,
      sandboxMode: normalizeSandboxMode(input.sandboxMode),
      approvalPolicy: normalizeApprovalPolicy(input.approvalPolicy),
      risk: input.risk,
    },
    requestedAction,
  };
}

function buildSkillOperatorInput(context: ExecutorJobContext): SkillInvocationContract["operatorInput"] | undefined {
  const clarificationText = optionalString(context.clarificationText);
  const comment = optionalString(context.comment);
  const specChangeIntent = optionalString(context.specChangeIntent);
  if (!clarificationText && !comment && !specChangeIntent) {
    return undefined;
  }
  return {
    clarificationText,
    comment,
    specChangeIntent,
  };
}

function normalizeArtifactContracts(value: unknown): SkillArtifactContract[] {
  const entries = Array.isArray(value) ? value : [];
  return entries.flatMap((entry) => {
    if (typeof entry === "string") {
      return [{ path: entry, kind: artifactKind(entry), required: true }];
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const path = optionalString(record.path);
    if (!path) return [];
    return [{
      path,
      kind: optionalString(record.kind) ?? artifactKind(path),
      required: typeof record.required === "boolean" ? record.required : true,
    }];
  });
}

function artifactKind(path: string): string {
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".svg") || path.endsWith(".png")) return "image";
  return "artifact";
}

function normalizeSandboxMode(value: unknown): SkillInvocationContract["constraints"]["sandboxMode"] {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access" ? value : undefined;
}

function normalizeApprovalPolicy(value: unknown): SkillInvocationContract["constraints"]["approvalPolicy"] {
  return value === "untrusted" || value === "on-failure" || value === "on-request" || value === "never" || value === "bypass" ? value : undefined;
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

function optionalStringArray(value: unknown): string[] {
  return parseJsonArray(value).map((entry) => String(entry)).filter(Boolean);
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
