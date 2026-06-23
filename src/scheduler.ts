import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join, normalize } from "node:path";
import { Queue, Worker, type Job, type WorkerOptions } from "bullmq";
import IORedis from "ioredis";
import { runSqlite } from "./sqlite.ts";
import { recordAuditEvent } from "./persistence.ts";
import { calculateTokenCost } from "./adapter-pricing.ts";
import {
  type RiskLevel,
} from "./orchestration.ts";
import {
  buildExecutionInvocationPrompt,
  CLAUDE_CLI_ADAPTER_CONFIG,
  DEFAULT_CLI_ADAPTER_CONFIG,
  DEFAULT_OUTPUT_SCHEMA,
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
  type SkillOutputContract,
} from "./cli-adapter.ts";
import type { ExecutionAdapterInvocationV1 } from "./execution-adapter-contracts.ts";
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
import { createReviewItem, listReviewCenterItems, type ReviewTrigger } from "./review-center.ts";

export const EXECUTION_ADAPTER_QUEUE = "specdrive:execution-adapter";
export const BULLMQ_EXECUTION_ADAPTER_QUEUE = "specdrive-execution-adapter";
export const CLI_RUNNER_QUEUE = EXECUTION_ADAPTER_QUEUE;
export const BULLMQ_CLI_RUNNER_QUEUE = BULLMQ_EXECUTION_ADAPTER_QUEUE;
export const CLI_WORKER_LOCK_DURATION_MS = 60 * 60 * 1000;

export type SchedulerJobType = "cli.run" | "rpc.run" | "codex.rpc.run" | "codex.app_server.run" | "native.run";
export type SchedulerJobStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "approval_needed"
  | "review_needed"
  | "blocked"
  | "failed"
  | "cancelled"
  | "paused"
  | "skipped"
  | "completed";

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
  skillName?: string;
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
  requeueExistingJob?(input: {
    schedulerJobId: string;
    bullmqJobId: string;
    jobType: Exclude<SchedulerJobType, "native.run">;
    payload: ExecutorRunJobPayload;
  }): SchedulerEnqueueResult;
  health?: () => SchedulerHealth;
  close?: () => Promise<void>;
};

export type SchedulerWorkers = {
  close: () => Promise<void>;
};

export type LocalScheduler = SchedulerClient & SchedulerWorkers & {
  drain: () => Promise<void>;
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
    requeueExistingJob(input) {
      const queueName = EXECUTION_ADAPTER_QUEUE;
      updateSchedulerJobRecord(dbPath, input.bullmqJobId, "queued");
      void requeueBullMqJob(cliQueue, input)
        .catch((error) => markSchedulerJobFailed(dbPath, input.bullmqJobId, error));
      return { schedulerJobId: input.schedulerJobId, bullmqJobId: input.bullmqJobId, queueName, jobType: input.jobType };
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
    requeueExistingJob(input) {
      updateSchedulerJobRecord(dbPath, input.bullmqJobId, "blocked", reason);
      return {
        schedulerJobId: input.schedulerJobId,
        bullmqJobId: input.bullmqJobId,
        queueName: EXECUTION_ADAPTER_QUEUE,
        jobType: input.jobType,
      };
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
    requeueExistingJob(input) {
      updateSchedulerJobRecord(dbPath, input.bullmqJobId, "queued");
      const result = {
        schedulerJobId: input.schedulerJobId,
        bullmqJobId: input.bullmqJobId,
        queueName: EXECUTION_ADAPTER_QUEUE,
        jobType: input.jobType,
      };
      if (!jobs.some((job) => job.bullmqJobId === input.bullmqJobId)) {
        jobs.push(result);
      }
      return result;
    },
    health() {
      return { status: "ready" };
    },
  };
}

export function createLocalScheduler(
  dbPath: string,
  options: {
    runner?: CliCommandRunner;
    appServerTransport?: CodexAppServerTransport;
  } = {},
): LocalScheduler {
  let closed = false;
  let chain = Promise.resolve();

  const schedule = (input: {
    schedulerJobId: string;
    bullmqJobId: string;
    jobType: Exclude<SchedulerJobType, "native.run">;
    payload: ExecutorRunJobPayload;
  }) => {
    if (closed) return;
    chain = chain
      .then(() => dispatchLocalSchedulerJob(dbPath, input, options.runner, options.appServerTransport))
      .catch(() => undefined);
  };

  const enqueue = (
    jobType: Exclude<SchedulerJobType, "native.run">,
    payload: ExecutorRunJobPayload,
  ): SchedulerEnqueueResult => {
    const result = createQueuedJobRecord(dbPath, {
      queueName: EXECUTION_ADAPTER_QUEUE,
      jobType,
      payload,
    });
    schedule({
      schedulerJobId: result.schedulerJobId,
      bullmqJobId: result.bullmqJobId,
      jobType,
      payload,
    });
    return result;
  };

  queueMicrotask(() => {
    for (const job of listRecoverableSchedulerJobs(dbPath)) {
      schedule({
        schedulerJobId: job.schedulerJobId,
        bullmqJobId: job.bullmqJobId,
        jobType: job.jobType,
        payload: job.payload as ExecutorRunJobPayload,
      });
    }
  });

  return {
    enqueueCliRun(payload) {
      return enqueue("cli.run", payload);
    },
    enqueueRpcRun(payload) {
      return enqueue("rpc.run", payload);
    },
    enqueueAppServerRun(payload) {
      return enqueue("rpc.run", payload);
    },
    requeueExistingJob(input) {
      updateSchedulerJobRecord(dbPath, input.bullmqJobId, "queued");
      schedule(input);
      return {
        schedulerJobId: input.schedulerJobId,
        bullmqJobId: input.bullmqJobId,
        queueName: EXECUTION_ADAPTER_QUEUE,
        jobType: input.jobType,
      };
    },
    health() {
      return { status: "ready" };
    },
    async drain() {
      await chain;
    },
    async close() {
      closed = true;
      await chain;
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

export async function requeueBullMqJob(
  queue: Pick<Queue, "add" | "getJob">,
  input: {
    schedulerJobId: string;
    bullmqJobId: string;
    jobType: Exclude<SchedulerJobType, "native.run">;
    payload: ExecutorRunJobPayload;
  },
): Promise<void> {
  const existing = await queue.getJob(input.bullmqJobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove();
    } else {
      return;
    }
  }
  await queue.add(input.jobType, { ...input.payload, schedulerJobId: input.schedulerJobId }, { jobId: input.bullmqJobId, attempts: 1 });
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
    await requeueBullMqJob(queue, {
      schedulerJobId: job.schedulerJobId,
      bullmqJobId: job.bullmqJobId,
      jobType: job.jobType,
      payload: job.payload as ExecutorRunJobPayload,
    });
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
  const skillName = optionalString(context.skillName);
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
          JSON.stringify(executionRecordContext({ context, executionPreference, skillName, skillPhase })),
          "blocked",
          new Date().toISOString(),
          reason,
          JSON.stringify({
            scheduler: "bullmq",
            jobType: "cli.run",
            executionPreference,
            skillName,
            skillPhase,
            blockedReason: reason,
          }),
        ],
      },
    ]);
    recordAuditEvent(dbPath, {
      entityType: featureId ? "feature" : "project",
      entityId: featureId ?? payload.projectId ?? payload.executionId,
      eventType: "cli_run_blocked",
      source: "cli_runner",
      reason,
      payload,
    });
    return { executionId: payload.executionId, status: "blocked" };
  }

  // UI Deliverability Harness Gate — pre-dispatch check.
  // For IDE-Webview and App features, block scheduling if deliveryHarnessRef.harnessStatus is not "ready".
  // Other operations (non-feature_execution) or non-UI features are not affected.
  if (
    loaded.featureId
    && (payload.operation === "feature_execution" || payload.context?.skillPhase === "feature_execution")
  ) {
    const specStateForHarness = readFileSpecState(loaded.workspaceRoot, loaded.featureId);
    const ft = specStateForHarness?.featureType;
    if ((ft === "IDE-Webview" || ft === "App") && specStateForHarness?.deliveryHarnessRef?.harnessStatus !== "ready") {
      const harnessReason = `UI/App Feature ${loaded.featureId} cannot be scheduled: deliveryHarnessRef.harnessStatus="${
        specStateForHarness?.deliveryHarnessRef?.harnessStatus ?? "missing"
      }". Run stitch-design-coverage to advance harnessStatus to "ready" before retrying.`;
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
            loaded.projectId ?? payload.projectId ?? null,
            JSON.stringify(executionRecordContext({ context, executionPreference, skillName, skillPhase })),
            "blocked",
            new Date().toISOString(),
            harnessReason,
            JSON.stringify({ scheduler: "bullmq", jobType: "cli.run", executionPreference, skillName, skillPhase, blockedReason: harnessReason, harnessGate: true }),
          ],
        },
      ]);
      recordAuditEvent(dbPath, {
        entityType: "feature",
        entityId: loaded.featureId,
        eventType: "cli_run_blocked",
        source: "harness_gate",
        reason: harnessReason,
        payload: { harnessStatus: specStateForHarness?.deliveryHarnessRef?.harnessStatus ?? "missing", featureType: ft },
      });
      return { executionId: payload.executionId, status: "blocked" };
    }
  }

  const now = new Date();
  const policy = resolveRunnerPolicy({
    runId: payload.executionId,
    risk: loaded.risk,
    workspaceRoot: loaded.workspaceRoot,
    model: loaded.adapter.defaults.model,
    reasoningEffort: loaded.adapter.defaults.reasoningEffort,
    profile: loaded.adapter.defaults.profile,
    requestedSandboxMode: isTrustedDirectWriteInvocation(loaded.executionInvocation, loaded.allowedFiles) ? "danger-full-access" : loaded.adapter.defaults.sandbox,
    requestedApprovalPolicy: loaded.adapter.defaults.approval,
    now,
  });
  const heartbeat = recordRunnerHeartbeat({
    runId: payload.executionId,
    runnerId: "bullmq-cli-runner",
    policy,
    queueStatus: "running",
    message: `Running ${loaded.featureId ?? payload.operation}`,
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
        "cli",
        payload.operation,
        loaded.projectId ?? payload.projectId ?? null,
        JSON.stringify(executionRecordContext({
          context,
          invocation: loaded.executionInvocation,
          workspaceRoot: loaded.workspaceRoot,
          executionPreference,
        })),
        "running",
        now.toISOString(),
        JSON.stringify({
          scheduler: "bullmq",
          jobType: "cli.run",
          executionPreference,
          workspaceRoot: loaded.workspaceRoot,
          skillName: loaded.executionInvocation.skillInstruction.skillName,
          skillPhase: loaded.executionInvocation.skillInstruction.requestedAction,
          adapterId: loaded.adapter.id,
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
    featureId: loaded.featureId,
    prompt: loaded.prompt,
    policy,
    files: loaded.allowedFiles,
    taskText: loaded.description,
    adapterConfig: loaded.adapter,
    executionInvocation: loaded.executionInvocation,
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

  const finalMetadata = executionRecordMetadata({
    scheduler: "bullmq",
    jobType: "cli.run",
    executionPreference,
    workspaceRoot: loaded.workspaceRoot,
    adapterId: loaded.adapter.id,
    skillName: loaded.executionInvocation.skillInstruction.skillName,
    skillPhase: loaded.executionInvocation.skillInstruction.requestedAction,
    contractValidation: result.adapterResult?.result.contractValidation,
    skillOutput: result.adapterResult?.result.skillOutput,
    rawLogRefs: result.adapterResult?.executionAdapterResult?.rawLogRefs ?? [],
    commandTermination: result.adapterResult?.result.commandTermination,
  });
  const completedAt = new Date().toISOString();
  runSqlite(dbPath, [
    {
      sql: "UPDATE execution_records SET status = ?, completed_at = ?, summary = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [result.status, completedAt, result.summary, JSON.stringify(finalMetadata), payload.executionId],
    },
  ]);
  recordTokenConsumptionForCompletedRun(dbPath, {
    runId: payload.executionId,
    schedulerJobId: optionalString((payload as unknown as Record<string, unknown>).schedulerJobId),
    projectId: loaded.projectId ?? payload.projectId,
    featureId: loaded.featureId ?? featureId,
    taskId: optionalString(context.taskId),
    operation: payload.operation,
    model: policy.model ?? loaded.adapter.defaults.model,
    adapterId: loaded.adapter.id,
    adapterKind: "cli",
    costRates: loaded.adapter.defaults.costRates ?? {},
    events: result.adapterResult?.result.events ?? [],
    sourcePath: result.adapterResult?.rawLog.files?.output ?? result.adapterResult?.result.logFiles?.output,
    completedAt,
  });
  updateRuntimeTaskStateForRun(dbPath, {
    featureId: loaded.featureId ?? featureId,
    taskId: optionalString(context.taskId),
    status: result.status,
  });
  ensureExecutionReviewItem(dbPath, {
    projectId: loaded.projectId ?? payload.projectId,
    featureId: loaded.featureId ?? featureId,
    executionId: payload.executionId,
    status: result.status,
    summary: result.summary,
    metadata: finalMetadata,
    now: new Date(),
  });
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

function ensureExecutionReviewItem(
  dbPath: string,
  input: {
    projectId?: string;
    featureId?: string;
    executionId: string;
    status: RunnerQueueStatus;
    summary: string;
    metadata?: Record<string, unknown>;
    now?: Date;
  },
): void {
  if (input.status !== "review_needed") return;
  const existing = listReviewCenterItems(dbPath).find((item) =>
    item.runId === input.executionId &&
    item.status !== "approved" &&
    item.status !== "closed"
  );
  const productUsability = executionReviewProductUsability(input.metadata);
  createReviewItem(dbPath, {
    id: existing?.id ?? `execution-review-${input.executionId}`,
    projectId: input.projectId,
    featureId: input.featureId,
    runId: input.executionId,
    message: input.summary,
    reviewNeededReason: executionReviewNeededReason(input.summary, input.metadata),
    triggerReasons: executionReviewTriggers(input.summary, input.metadata),
    recommendedActions: ["approve_continue", "request_changes", "reject"],
    body: {
      runContract: input.metadata?.executionInvocation,
      riskExplanation: input.summary,
      testResults: {
        contractValidation: input.metadata?.contractValidation,
        producedArtifacts: input.metadata?.producedArtifacts,
      },
      productUsability,
    },
    evidenceRefs: Array.isArray(input.metadata?.rawLogRefs) ? input.metadata.rawLogRefs.map(String) : [],
    now: input.now,
  });
}

function executionRecordContext(input: {
  context?: Record<string, unknown>;
  invocation?: ExecutionAdapterInvocationV1;
  workspaceRoot?: string;
  executionPreference?: ExecutionPreferenceV1;
  skillName?: string;
  skillPhase?: string;
}): Record<string, unknown> {
  const context = input.context ?? {};
  const invocation = input.invocation;
  return compactRecord({
    featureId: optionalString(invocation?.featureId) ?? optionalString(context.featureId),
    featureSpecPath: optionalString(context.featureSpecPath),
    taskId: optionalString(context.taskId),
    workspaceRoot: optionalString(input.workspaceRoot) ?? optionalString(invocation?.workspaceRoot) ?? optionalString(context.workspaceRoot),
    skillName: optionalString(invocation?.skillInstruction.skillName) ?? input.skillName ?? optionalString(context.skillName),
    skillPhase: optionalString(invocation?.skillInstruction.requestedAction) ?? input.skillPhase ?? optionalString(context.skillPhase),
    operation: optionalString(invocation?.operation) ?? optionalString(context.operation),
    executionPreference: input.executionPreference ?? parseJsonObject(context.executionPreference),
    previousExecutionId: optionalString(context.previousExecutionId),
    retryReason: optionalString(context.retryReason),
    retriedAt: optionalString(context.retriedAt),
  });
}

function executionRecordMetadata(input: {
  scheduler: string;
  jobType: string;
  executionPreference?: ExecutionPreferenceV1;
  workspaceRoot: string;
  adapterId?: string;
  skillName?: string;
  skillPhase?: string;
  skillOutput?: SkillOutputContract;
  contractValidation?: unknown;
  rawLogRefs?: string[];
  commandTermination?: unknown;
  provider?: string;
  threadId?: string;
  turnId?: string;
  sessionId?: string;
  transport?: string;
  model?: string;
  adapterConfig?: unknown;
  approvalState?: unknown;
  eventRefs?: unknown;
  error?: string;
}): Record<string, unknown> {
  return compactRecord({
    scheduler: input.scheduler,
    jobType: input.jobType,
    provider: input.provider,
    executionPreference: input.executionPreference,
    workspaceRoot: input.workspaceRoot,
    adapterId: input.adapterId,
    skillName: input.skillName,
    skillPhase: input.skillPhase,
    threadId: input.threadId,
    turnId: input.turnId,
    sessionId: input.sessionId,
    transport: input.transport,
    model: input.model,
    adapterConfig: input.adapterConfig,
    approvalState: input.approvalState,
    eventRefs: input.eventRefs,
    skillOutputStatus: input.skillOutput?.status,
    skillOutputSummary: input.skillOutput?.summary,
    traceability: input.skillOutput?.traceability,
    qualityEvidence: compactQualityEvidence(input.skillOutput?.result),
    contractValidation: input.contractValidation,
    producedArtifacts: input.skillOutput?.producedArtifacts ?? [],
    rawLogRefs: input.rawLogRefs ?? [],
    commandTermination: input.commandTermination,
    error: input.error,
  });
}

function compactQualityEvidence(result: unknown): Record<string, unknown> | undefined {
  const record = parseJsonObject(result);
  const evidence = compactRecord({
    requirementCoverage: record.requirementCoverage,
    acceptanceEvidence: record.acceptanceEvidence,
    journeyEvidence: record.journeyEvidence,
    runtimeEvidence: record.runtimeEvidence,
    deliveryFidelity: record.deliveryFidelity,
    gitDelivery: record.gitDelivery,
    productUsability: record.productUsability,
  });
  return Object.keys(evidence).length > 0 ? evidence : undefined;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function executionReviewNeededReason(
  summary: string,
  metadata?: Record<string, unknown>,
): "approval_needed" | "clarification_needed" | "risk_review_needed" {
  const text = `${summary}\n${JSON.stringify(metadata ?? {})}`.toLowerCase();
  if (
    hasProductUsabilityReviewRisk(summary, metadata) ||
    hasDeliveryFidelityReviewRisk(metadata) ||
    text.includes("journey closure gate") ||
    text.includes("delivery fidelity gate") ||
    text.includes("git delivery gate") ||
    text.includes("behavior-obligation gap") ||
    text.includes("behavior obligation gap") ||
    text.includes("delivery-fidelity loss") ||
    text.includes("delivery fidelity loss") ||
    text.includes("journey_not_closed") ||
    text.includes("acceptance_gap") ||
    text.includes("evidence_missing") ||
    text.includes("quality_evidence_gap") ||
    text.includes("test_semantics_gap") ||
    text.includes("journey_bypassed_by_fixture") ||
    text.includes("delivery_evidence_missing") ||
    text.includes("delivery_not_closed")
  ) {
    return "risk_review_needed";
  }
  if (/\b(clarif|ambigu|question|unknown|unclear)\b/.test(text)) return "clarification_needed";
  if (/\b(approve|approval|authorize|permission|commit|pull request|\bpr\b|agents\.md)\b/.test(text)) return "approval_needed";
  return "risk_review_needed";
}

function executionReviewTriggers(summary: string, metadata?: Record<string, unknown>): ReviewTrigger[] {
  const text = `${summary}\n${JSON.stringify(metadata ?? {})}`.toLowerCase();
  if (hasProductUsabilityReviewRisk(summary, metadata)) return ["product_usability_gap"];
  if (hasDeliveryFidelityReviewRisk(metadata)) return ["quality_evidence_gap"];
  if (/\bevidence_missing\b/.test(text) || text.includes("journey closure gate")) return ["evidence_missing"];
  if (text.includes("journey_not_closed")) return ["journey_not_closed"];
  if (text.includes("acceptance_gap")) return ["acceptance_gap"];
  if (
    text.includes("behavior-obligation gap") ||
    text.includes("behavior obligation gap") ||
    text.includes("delivery-fidelity loss") ||
    text.includes("delivery fidelity loss")
  ) {
    return ["quality_evidence_gap"];
  }
  if (text.includes("journey_bypassed_by_fixture")) return ["journey_bypassed_by_fixture"];
  if (text.includes("test_semantics_gap")) return ["test_semantics_gap"];
  if (text.includes("quality_evidence_gap") || text.includes("delivery fidelity gate")) return ["quality_evidence_gap"];
  if (text.includes("delivery_not_closed")) return ["delivery_not_closed"];
  if (text.includes("delivery_evidence_missing") || text.includes("git delivery gate")) return ["delivery_evidence_missing"];
  if (/\b(approve|approval|authorize|permission|commit|pull request|\bpr\b|agents\.md)\b/.test(text)) {
    return ["permission_escalation"];
  }
  if (/\b(clarif|ambigu|question|unknown|unclear)\b/.test(text)) {
    return ["high_impact_ambiguity"];
  }
  if (text.includes("constitution")) return ["constitution_change"];
  if (text.includes("architecture")) return ["architecture_change"];
  return ["failed_tests_continue"];
}

function hasProductUsabilityReviewRisk(summary: string, metadata?: Record<string, unknown>): boolean {
  const text = `${summary}\n${JSON.stringify(metadata ?? {})}`.toLowerCase();
  if (text.includes("product usability gate failed") || text.includes("product_usability_gap")) return true;
  const productUsability = asRecord(executionReviewProductUsability(metadata));
  if (!productUsability) return false;
  const gaps = [
    ...(Array.isArray(productUsability.gaps) ? productUsability.gaps : []),
    ...(Array.isArray(productUsability.protocolGaps) ? productUsability.protocolGaps : []),
  ];
  return gaps.some((gap) => {
    const item = asRecord(gap);
    const status = optionalString(item?.status)?.toLowerCase();
    const severity = optionalString(item?.severity)?.toLowerCase();
    return status !== "closed" && (severity === "p0" || severity === "p1" || severity === "critical" || severity === "high");
  });
}

function executionReviewProductUsability(metadata?: Record<string, unknown>): unknown {
  const direct = metadata?.productUsability;
  if (direct !== undefined) return direct;
  const qualityEvidence = asRecord(metadata?.qualityEvidence);
  if (qualityEvidence?.productUsability !== undefined) return qualityEvidence.productUsability;
  const skillOutput = asRecord(metadata?.skillOutputContract) ?? asRecord(metadata?.skillOutput);
  const result = asRecord(skillOutput?.result);
  return result?.productUsability;
}

function hasDeliveryFidelityReviewRisk(metadata?: Record<string, unknown>): boolean {
  const skillOutput = asRecord(metadata?.skillOutputContract);
  const result = asRecord(skillOutput?.result);
  const deliveryFidelity = asRecord(result?.deliveryFidelity);
  if (!deliveryFidelity) return false;
  const completionDecision = asRecord(deliveryFidelity.completionDecision);
  const completionStatus = optionalString(completionDecision?.status)?.toLowerCase();
  const unresolvedLosses = Array.isArray(completionDecision?.unresolvedLosses)
    ? completionDecision.unresolvedLosses
    : [];
  if (unresolvedLosses.length > 0) return true;
  if (completionStatus && completionStatus !== "passed" && completionStatus !== "completed") return true;
  const losses = Array.isArray(deliveryFidelity.losses) ? deliveryFidelity.losses : [];
  return losses.some((loss) => {
    const item = asRecord(loss);
    const status = optionalString(item?.status)?.toLowerCase();
    const severity = optionalString(item?.severity)?.toLowerCase();
    return status === "open" && (severity === "p0" || severity === "p1" || severity === "critical" || severity === "high");
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export async function runCodexAppServerRunJob(
  dbPath: string,
  payload: AppServerRunJobPayload,
  transport?: CodexAppServerTransport,
): Promise<{ executionId: string; status: RunnerQueueStatus }> {
  const context = payload.context ?? {};
  const executionPreference = executionPreferenceFromPayload(payload);
  const featureId = optionalString(context.featureId);
  const skillName = optionalString(context.skillName);
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
            skillName,
            skillPhase,
            blockedReason: reason,
          }),
        ],
      },
    ]);
    recordAuditEvent(dbPath, {
      entityType: featureId ? "feature" : "project",
      entityId: featureId ?? payload.projectId ?? payload.executionId,
      eventType: "codex_rpc_run_blocked",
      source: "rpc_adapter",
      reason,
      payload,
    });
    return { executionId: payload.executionId, status: "blocked" };
  }

  const now = new Date();
  const adapterDefaults = adapterConfig?.defaults ?? {};
  const policy = resolveRunnerPolicy({
    runId: payload.executionId,
    risk: loaded.risk,
    workspaceRoot: loaded.workspaceRoot,
    model: adapterDefaults.model ?? loaded.adapter.defaults.model,
    reasoningEffort: adapterDefaults.reasoningEffort ?? adapterDefaults.reasoning_effort ?? loaded.adapter.defaults.reasoningEffort,
    profile: adapterDefaults.profile ?? loaded.adapter.defaults.profile,
    requestedSandboxMode: isTrustedDirectWriteInvocation(loaded.executionInvocation, loaded.allowedFiles) ? "danger-full-access" : adapterDefaults.sandbox ?? loaded.adapter.defaults.sandbox,
    requestedApprovalPolicy: adapterDefaults.approval ?? loaded.adapter.defaults.approval,
    now,
  });
  const safety = evaluateRunnerSafety({
    policy,
    prompt: loaded.prompt,
    files: loaded.allowedFiles,
    taskText: loaded.description,
    executionInvocation: loaded.executionInvocation,
  });
  if (!safety.allowed) {
    const safetyMetadata = {
      scheduler: "bullmq",
      jobType: "rpc.run",
      provider: "codex-rpc",
      executionPreference,
      workspaceRoot: loaded.workspaceRoot,
      safety,
      skillName: loaded.executionInvocation.skillInstruction.skillName,
      skillPhase: loaded.executionInvocation.skillInstruction.requestedAction,
      executionInvocation: loaded.executionInvocation,
    };
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
          JSON.stringify(loaded.executionInvocation),
          "review_needed",
          now.toISOString(),
          safety.summary,
          JSON.stringify(safetyMetadata),
        ],
      },
    ]);
    ensureExecutionReviewItem(dbPath, {
      projectId: loaded.projectId ?? payload.projectId,
      featureId: loaded.featureId ?? featureId,
      executionId: payload.executionId,
      status: "review_needed",
      summary: safety.summary,
      metadata: safetyMetadata,
      now,
    });
    return { executionId: payload.executionId, status: "review_needed" };
  }
  const heartbeat = recordRunnerHeartbeat({
    runId: payload.executionId,
    runnerId: "bullmq-codex-rpc-adapter",
    policy,
    queueStatus: "running",
    message: `Running ${loaded.featureId ?? payload.operation}`,
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
        JSON.stringify(executionRecordContext({
          context,
          invocation: loaded.executionInvocation,
          workspaceRoot: loaded.workspaceRoot,
          executionPreference,
        })),
        "running",
        now.toISOString(),
        JSON.stringify(executionRecordMetadata({
          scheduler: "bullmq",
          jobType: "rpc.run",
          provider: "codex-rpc",
          executionPreference,
          workspaceRoot: loaded.workspaceRoot,
          adapterId: adapterConfig?.id,
          skillName: loaded.executionInvocation.skillInstruction.skillName,
          skillPhase: loaded.executionInvocation.skillInstruction.requestedAction,
          threadId: payload.threadId,
          transport: adapterConfig?.transport,
          model: policy.model,
          adapterConfig: {
            id: adapterConfig?.id,
            displayName: adapterConfig?.displayName,
            executable: adapterConfig?.executable,
            args: adapterConfig?.args,
            endpoint: adapterConfig?.endpoint,
          },
        })),
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
      executionInvocation: loaded.executionInvocation,
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
          JSON.stringify(executionRecordMetadata({
            scheduler: "bullmq",
            jobType: "rpc.run",
            provider: "codex-rpc",
            executionPreference,
            workspaceRoot: loaded.workspaceRoot,
            adapterId: adapterConfig?.id,
            skillName: loaded.executionInvocation.skillInstruction.skillName,
            skillPhase: loaded.executionInvocation.skillInstruction.requestedAction,
            threadId: payload.threadId,
            transport: adapterConfig?.transport,
            model: policy.model,
            adapterConfig: {
              id: adapterConfig?.id,
              displayName: adapterConfig?.displayName,
              executable: adapterConfig?.executable,
              args: adapterConfig?.args,
              endpoint: adapterConfig?.endpoint,
            },
            error: reason,
          })),
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
    : (finalStatus === "failed" || finalStatus === "review_needed") && adapterResult.result.contractValidation && !adapterResult.result.contractValidation.valid
    ? `Skill output contract validation failed: ${adapterResult.result.contractValidation.reasons.join("; ")}`
    : adapterResult.result.skillOutput?.summary ?? (adapterResult.rawLog.stderr || `Codex RPC ${finalStatus}.`);
  const finalMetadata = executionRecordMetadata({
    scheduler: "bullmq",
    jobType: "rpc.run",
    provider: "codex-rpc",
    executionPreference,
    workspaceRoot: loaded.workspaceRoot,
    adapterId: adapterConfig?.id,
    skillName: loaded.executionInvocation.skillInstruction.skillName,
    skillPhase: loaded.executionInvocation.skillInstruction.requestedAction,
    skillOutput: adapterResult.result.skillOutput,
    rawLogRefs: adapterResult.executionAdapterResult?.rawLogRefs ?? [],
    threadId: adapterResult.session.sessionId,
    turnId: eventTurnId(adapterResult.rawLog.events),
    transport: adapterConfig?.transport,
    model: policy.model,
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
  });
  runSqlite(dbPath, [
    {
      sql: "UPDATE execution_records SET status = ?, completed_at = ?, summary = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [
        finalStatus,
        new Date().toISOString(),
        finalSummary,
        JSON.stringify(finalMetadata),
        payload.executionId,
      ],
    },
  ]);
  updateRuntimeTaskStateForRun(dbPath, {
    featureId: loaded.featureId ?? featureId,
    taskId: optionalString(context.taskId),
    status: finalStatus,
  });
  ensureExecutionReviewItem(dbPath, {
    projectId: loaded.projectId ?? payload.projectId,
    featureId: loaded.featureId ?? featureId,
    executionId: payload.executionId,
    status: finalStatus,
    summary: finalSummary,
    metadata: finalMetadata,
  });
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
  const skillName = optionalString(context.skillName);
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
          JSON.stringify({ scheduler: "bullmq", jobType: "rpc.run", provider: "gemini-acp", executionPreference, skillName, skillPhase, blockedReason: reason }),
        ],
      },
    ]);
    recordAuditEvent(dbPath, {
      entityType: featureId ? "feature" : "project",
      entityId: featureId ?? payload.projectId ?? payload.executionId,
      eventType: "gemini_acp_run_blocked",
      source: "rpc_adapter",
      reason,
      payload,
    });
    return { executionId: payload.executionId, status: "blocked" };
  }

  const now = new Date();
  const adapterDefaults = adapterConfig?.defaults ?? {};
  const policy = resolveRunnerPolicy({
    runId: payload.executionId,
    risk: loaded.risk,
    workspaceRoot: loaded.workspaceRoot,
    model: adapterDefaults.model ?? loaded.adapter.defaults.model,
    reasoningEffort: adapterDefaults.reasoningEffort ?? adapterDefaults.reasoning_effort ?? loaded.adapter.defaults.reasoningEffort,
    profile: adapterDefaults.profile ?? loaded.adapter.defaults.profile,
    requestedSandboxMode: isTrustedDirectWriteInvocation(loaded.executionInvocation, loaded.allowedFiles) ? "danger-full-access" : adapterDefaults.sandbox ?? loaded.adapter.defaults.sandbox,
    requestedApprovalPolicy: adapterDefaults.approval ?? loaded.adapter.defaults.approval,
    now,
  });
  const safety = evaluateRunnerSafety({
    policy,
    prompt: loaded.prompt,
    files: loaded.allowedFiles,
    taskText: loaded.description,
    executionInvocation: loaded.executionInvocation,
  });
  if (!safety.allowed) {
    const safetyMetadata = {
      scheduler: "bullmq",
      jobType: "rpc.run",
      provider: "gemini-acp",
      executionPreference,
      workspaceRoot: loaded.workspaceRoot,
      safety,
      skillName: loaded.executionInvocation.skillInstruction.skillName,
      skillPhase: loaded.executionInvocation.skillInstruction.requestedAction,
      executionInvocation: loaded.executionInvocation,
    };
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
          JSON.stringify(loaded.executionInvocation),
          "review_needed",
          now.toISOString(),
          safety.summary,
          JSON.stringify(safetyMetadata),
        ],
      },
    ]);
    ensureExecutionReviewItem(dbPath, {
      projectId: loaded.projectId ?? payload.projectId,
      featureId: loaded.featureId ?? featureId,
      executionId: payload.executionId,
      status: "review_needed",
      summary: safety.summary,
      metadata: safetyMetadata,
      now,
    });
    return { executionId: payload.executionId, status: "review_needed" };
  }

  const heartbeat = recordRunnerHeartbeat({
    runId: payload.executionId,
    runnerId: "bullmq-gemini-acp-adapter",
    policy,
    queueStatus: "running",
    message: `Running ${loaded.featureId ?? payload.operation}`,
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
        JSON.stringify(executionRecordContext({
          context,
          invocation: loaded.executionInvocation,
          workspaceRoot: loaded.workspaceRoot,
          executionPreference,
        })),
        "running",
        now.toISOString(),
        JSON.stringify(executionRecordMetadata({
          scheduler: "bullmq",
          jobType: "rpc.run",
          provider: "gemini-acp",
          executionPreference,
          workspaceRoot: loaded.workspaceRoot,
          adapterId: adapterConfig?.id,
          skillName: loaded.executionInvocation.skillInstruction.skillName,
          skillPhase: loaded.executionInvocation.skillInstruction.requestedAction,
          sessionId: payload.threadId,
          transport: adapterConfig?.transport,
          model: policy.model,
          adapterConfig: adapterMetadata(adapterConfig),
        })),
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
      executionInvocation: loaded.executionInvocation,
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
          JSON.stringify(executionRecordMetadata({
            scheduler: "bullmq",
            jobType: "rpc.run",
            provider: "gemini-acp",
            executionPreference,
            workspaceRoot: loaded.workspaceRoot,
            adapterId: adapterConfig?.id,
            skillName: loaded.executionInvocation.skillInstruction.skillName,
            skillPhase: loaded.executionInvocation.skillInstruction.requestedAction,
            sessionId: payload.threadId,
            transport: adapterConfig?.transport,
            model: policy.model,
            adapterConfig: adapterMetadata(adapterConfig),
            error: reason,
          })),
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
    : (finalStatus === "failed" || finalStatus === "review_needed") && adapterResult.result.contractValidation && !adapterResult.result.contractValidation.valid
    ? `Skill output contract validation failed: ${adapterResult.result.contractValidation.reasons.join("; ")}`
    : adapterResult.result.skillOutput?.summary ?? (adapterResult.rawLog.stderr || `Gemini ACP ${finalStatus}.`);
  const finalMetadata = executionRecordMetadata({
    scheduler: "bullmq",
    jobType: "rpc.run",
    provider: "gemini-acp",
    executionPreference,
    workspaceRoot: loaded.workspaceRoot,
    adapterId: adapterConfig?.id,
    skillName: loaded.executionInvocation.skillInstruction.skillName,
    skillPhase: loaded.executionInvocation.skillInstruction.requestedAction,
    skillOutput: adapterResult.result.skillOutput,
    rawLogRefs: adapterResult.executionAdapterResult?.rawLogRefs ?? [],
    sessionId: adapterResult.session.sessionId,
    transport: adapterConfig?.transport,
    model: policy.model,
    contractValidation: adapterResult.result.contractValidation,
    approvalState: approvalStateFromEvents(adapterResult.rawLog.events),
    eventRefs: adapterResult.rawLog.events.map((event, index) => ({
      index,
      type: optionalString(event.type),
    })),
    adapterConfig: adapterMetadata(adapterConfig),
  });
  runSqlite(dbPath, [
    {
      sql: "UPDATE execution_records SET status = ?, completed_at = ?, summary = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [
        finalStatus,
        new Date().toISOString(),
        finalSummary,
        JSON.stringify(finalMetadata),
        payload.executionId,
      ],
    },
  ]);
  updateRuntimeTaskStateForRun(dbPath, {
    featureId: loaded.featureId ?? featureId,
    taskId: optionalString(context.taskId),
    status: finalStatus,
  });
  ensureExecutionReviewItem(dbPath, {
    projectId: loaded.projectId ?? payload.projectId,
    featureId: loaded.featureId ?? featureId,
    executionId: payload.executionId,
    status: finalStatus,
    summary: finalSummary,
    metadata: finalMetadata,
  });
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

function updateRuntimeTaskStateForRun(
  dbPath: string,
  input: { featureId?: string; taskId?: string; status: RunnerQueueStatus },
): void {
  if (!input.taskId) return;
  const taskStatus = runtimeTaskStatusForRunnerStatus(input.status);
  if (!taskStatus) return;
  const now = new Date().toISOString();
  const statements = [
    { sql: "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status <> 'delivered'", params: [taskStatus, now, input.taskId] },
    {
      sql: `UPDATE task_graph_tasks
        SET status = ?, updated_at = ?
        WHERE status <> 'delivered'
          AND (
            id = ?
            OR (
              feature_id = ?
              AND title = (SELECT title FROM tasks WHERE id = ?)
              AND (
                SELECT COUNT(*) FROM task_graph_tasks
                WHERE feature_id = ?
                  AND title = (SELECT title FROM tasks WHERE id = ?)
              ) = 1
            )
          )`,
      params: [taskStatus, now, input.taskId, input.featureId ?? "", input.taskId, input.featureId ?? "", input.taskId],
    },
  ];
  if (taskStatus === "done" && input.featureId) {
    statements.push({
      sql: `UPDATE features
        SET status = CASE
            WHEN (
              EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ?)
              AND NOT EXISTS (
                SELECT 1 FROM task_graph_tasks
                WHERE feature_id = ?
                  AND status NOT IN ('done', 'delivered')
              )
            ) OR (
              NOT EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ?)
              AND EXISTS (SELECT 1 FROM tasks WHERE feature_id = ?)
              AND NOT EXISTS (
                SELECT 1 FROM tasks
                WHERE feature_id = ?
                  AND status NOT IN ('done', 'delivered')
              )
            )
            THEN 'done'
            ELSE status
          END,
          updated_at = CASE
            WHEN (
              EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ?)
              AND NOT EXISTS (
                SELECT 1 FROM task_graph_tasks
                WHERE feature_id = ?
                  AND status NOT IN ('done', 'delivered')
              )
            ) OR (
              NOT EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ?)
              AND EXISTS (SELECT 1 FROM tasks WHERE feature_id = ?)
              AND NOT EXISTS (
                SELECT 1 FROM tasks
                WHERE feature_id = ?
                  AND status NOT IN ('done', 'delivered')
              )
            )
            THEN ?
            ELSE updated_at
          END
        WHERE id = ?`,
      params: [
        input.featureId,
        input.featureId,
        input.featureId,
        input.featureId,
        input.featureId,
        input.featureId,
        input.featureId,
        input.featureId,
        input.featureId,
        input.featureId,
        now,
        input.featureId,
      ],
    });
  }
  runSqlite(dbPath, statements);
}

function runtimeTaskStatusForRunnerStatus(status: RunnerQueueStatus): "done" | "review_needed" | "blocked" | "failed" | undefined {
  if (status === "completed") return "done";
  if (status === "review_needed" || status === "approval_needed") return "review_needed";
  if (status === "blocked") return "blocked";
  if (status === "failed") return "failed";
  return undefined;
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
  const featureSpecPath = optionalString(input.context.featureSpecPath)
    ?? optionalString(input.context.specStatePath)?.replace(/\/spec-state\.json$/, "");
  const effectiveSkillName = optionalString(input.context.skillName)
    ?? input.skillOutput?.skillName
    ?? (featureSpecPath && (input.context.skillPhase === "feature_execution" || input.context.operation === "feature_execution")
      ? "implement-feature"
      : undefined);
  if (!input.workspaceRoot || !input.featureId || effectiveSkillName !== "implement-feature") return;
  if (!featureSpecPath?.startsWith("docs/agentic-spec/features/")) return;

  const gitDelivery = (input.skillOutput?.result as any)?.gitDelivery;
  const implementationWorkspace = optionalString(gitDelivery?.implementationWorkspace);
  const ownerWorkspace = optionalString(gitDelivery?.ownerWorkspace);
  const worktreeCleanup = (gitDelivery?.worktreeCleanup as string | undefined)?.toLowerCase();
  const isCleanedUp = worktreeCleanup === "passed" || worktreeCleanup === "completed" || worktreeCleanup === "cleaned";
  const worktreeMode = featureWorktreeMode(input.context, input.skillOutput);
  const hasSeparateImplementationWorkspace = Boolean(
    implementationWorkspace && implementationWorkspace !== (ownerWorkspace ?? input.workspaceRoot),
  );
  const requiresSetupWorktree = worktreeMode === "serial-owner"
    ? hasSeparateImplementationWorkspace
    : true;

  const hasActiveImplementationWorkspace = Boolean(implementationWorkspace && !isCleanedUp && existsSync(implementationWorkspace));
  if (requiresSetupWorktree && (!hasActiveImplementationWorkspace || isCleanedUp)) {
    return;
  }

  // Route to implementation workspace if active; otherwise use owner workspace root for serial-owner fallback only.
  const targetWorkspace = hasActiveImplementationWorkspace
    ? implementationWorkspace
    : input.workspaceRoot;

  const featureFolder = featureSpecPath.slice("docs/agentic-spec/features/".length);
  try {
    const current = readFileSpecState(targetWorkspace, featureFolder, input.featureId);
    const outputPatch = input.skillOutput ? skillOutputToSpecStatePatch(input.skillOutput) : undefined;
    const useSkillOutputStatus = input.skillOutput?.status === input.status;
    const runnerStatus = runnerStatusToFileSpecStatus(input.status);
    const patch = useSkillOutputStatus && outputPatch
      ? outputPatch
      : {
          status: runnerStatus,
          executionStatus: runnerStatusToFileSpecExecutionStatus(input.status),
          blockedReasons: input.status === "blocked" || input.status === "failed" ? [input.summary] : [],
          nextAction: input.status === "running"
            ? "Runner is executing this Feature."
            : input.status === "approval_needed"
              ? "Resolve the pending approval request before autonomous execution can continue."
            : input.status === "completed"
              ? "Run status checks and prepare review."
              : "Review execution result and resume or skip.",
          lastResult: input.status === "running"
            ? outputPatch?.lastResult ?? current.lastResult
            : {
                status: runnerStatus,
                summary: input.summary,
                producedArtifacts: input.skillOutput?.producedArtifacts ?? current.lastResult?.producedArtifacts ?? [],
                completedAt: new Date().toISOString(),
              },
        };
    writeFileSpecState(targetWorkspace, featureFolder, mergeFileSpecState(current, {
      ...patch,
      executionStatus: runnerStatusToFileSpecExecutionStatus(input.status) ?? patch.executionStatus,
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

function featureWorktreeMode(context: ExecutorJobContext, skillOutput?: SkillOutputContract): string | undefined {
  return optionalString(parseJsonObject(context.specState).worktreeMode)
    ?? optionalString(parseJsonObject((skillOutput?.result as Record<string, unknown> | undefined)?.worktree).mode)
    ?? optionalString(parseJsonObject((skillOutput?.result as Record<string, unknown> | undefined)?.gitDelivery).worktreeMode);
}

function recordTokenConsumptionForCompletedRun(
  dbPath: string,
  input: {
    runId: string;
    schedulerJobId?: string;
    projectId?: string;
    featureId?: string;
    taskId?: string;
    operation?: string;
    model?: string;
    adapterId?: string;
    adapterKind: "cli" | "rpc";
    costRates: Record<string, unknown>;
    events: unknown[];
    sourcePath?: string;
    completedAt: string;
  },
): void {
  const usage = tokenUsageFromEvents(input.events);
  if (!usage || usage.totalTokens <= 0 || !input.sourcePath) return;
  const pricing = calculateTokenCost({
    usage,
    model: input.model,
    costRates: input.costRates as Parameters<typeof calculateTokenCost>[0]["costRates"],
    pricingSource: {
      adapterId: input.adapterId,
      adapterKind: input.adapterKind,
    },
  });
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO token_consumption_records (
          id, run_id, scheduler_job_id, project_id, feature_id, task_id, operation, model,
          input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
          cost_usd, currency, pricing_status, usage_json, pricing_json, source_path, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO NOTHING`,
      params: [
        randomUUID(),
        input.runId,
        input.schedulerJobId ?? null,
        input.projectId ?? null,
        input.featureId ?? null,
        input.taskId ?? null,
        input.operation ?? null,
        pricing.model ?? null,
        usage.inputTokens,
        usage.cachedInputTokens,
        usage.outputTokens,
        usage.reasoningOutputTokens,
        usage.totalTokens,
        pricing.costUsd,
        "USD",
        pricing.pricingStatus,
        JSON.stringify({
          input_tokens: usage.inputTokens,
          cached_input_tokens: usage.cachedInputTokens,
          output_tokens: usage.outputTokens,
          reasoning_output_tokens: usage.reasoningOutputTokens,
          total_tokens: usage.totalTokens,
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          reasoningOutputTokens: usage.reasoningOutputTokens,
          totalTokens: usage.totalTokens,
        }),
        JSON.stringify(pricing.pricingSnapshot),
        input.sourcePath,
        input.completedAt,
      ],
    },
  ]);
}

function tokenUsageFromEvents(events: unknown[]): {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
} | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = parseJsonObject(events[index]);
    const usage = normalizeTokenUsage(event.usage ?? event.stats ?? tokenUsageFromRecord(event));
    if (usage.totalTokens > 0) return usage;
  }
  return undefined;
}

function tokenUsageFromRecord(record: Record<string, unknown>): unknown {
  if (hasTokenUsageFields(record)) return record;
  return tokenUsageFromValue(record.result)
    ?? tokenUsageFromValue(record.output)
    ?? tokenUsageFromValue(record.item);
}

function tokenUsageFromValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const usage = tokenUsageFromValue(value[index]);
      if (usage) return usage;
    }
    return undefined;
  }
  const record = parseJsonObject(value);
  if (hasTokenUsageFields(record)) return record;
  return undefined;
}

function hasTokenUsageFields(record: Record<string, unknown>): boolean {
  return ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "outputTokens", "output_tokens", "completionTokens", "completion_tokens", "totalTokens", "total_tokens"]
    .some((key) => record[key] !== undefined);
}

function normalizeTokenUsage(value: unknown): {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
} {
  const record = parseJsonObject(value);
  const inputTokens = nonNegativeInteger(record.inputTokens ?? record.input_tokens ?? record.promptTokens ?? record.prompt_tokens);
  const cachedInputTokens = nonNegativeInteger(record.cachedInputTokens ?? record.cached_input_tokens ?? record.cacheReadInputTokens ?? record.cache_read_input_tokens);
  const outputTokens = nonNegativeInteger(record.outputTokens ?? record.output_tokens ?? record.completionTokens ?? record.completion_tokens);
  const reasoningOutputTokens = nonNegativeInteger(record.reasoningOutputTokens ?? record.reasoning_output_tokens);
  const explicitTotal = nonNegativeInteger(record.totalTokens ?? record.total_tokens);
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: explicitTotal > 0 ? explicitTotal : inputTokens + outputTokens + reasoningOutputTokens,
  };
}

function nonNegativeInteger(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.trunc(numberValue) : 0;
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

function runnerStatusToFileSpecExecutionStatus(status: RunnerQueueStatus) {
  if (status === "completed") return "completed";
  if (status === "approval_needed") return "approval_needed";
  if (status === "review_needed") return "review_needed";
  if (status === "blocked") return "blocked";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  if (status === "queued") return "queued";
  return undefined;
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
  const queuedStatusGuard = status === "queued" ? "AND status <> 'running'" : "";
  runSqlite(dbPath, [
    {
      sql: `UPDATE scheduler_job_records
        SET status = ?, error = ?, attempts = COALESCE(?, attempts), updated_at = CURRENT_TIMESTAMP
        WHERE bullmq_job_id = ? ${queuedStatusGuard}`,
      params: [status, error ? errorMessage(error) : null, attempts ?? null, bullmqJobId],
    },
  ]);
}

async function dispatchCliJob(dbPath: string, job: Job, runner?: CliCommandRunner, appServerTransport?: CodexAppServerTransport): Promise<void> {
  await dispatchSchedulerJob(dbPath, {
    bullmqJobId: String(job.id),
    schedulerJobId: optionalString((job.data as Record<string, unknown>).schedulerJobId),
    jobType: job.name as Exclude<SchedulerJobType, "native.run">,
    payload: job.data as ExecutorRunJobPayload,
    attemptsMade: job.attemptsMade,
  }, runner, appServerTransport);
}

async function dispatchLocalSchedulerJob(
  dbPath: string,
  input: {
    schedulerJobId: string;
    bullmqJobId: string;
    jobType: Exclude<SchedulerJobType, "native.run">;
    payload: ExecutorRunJobPayload;
  },
  runner?: CliCommandRunner,
  appServerTransport?: CodexAppServerTransport,
): Promise<void> {
  await dispatchSchedulerJob(dbPath, {
    ...input,
    attemptsMade: 0,
  }, runner, appServerTransport);
}

async function dispatchSchedulerJob(
  dbPath: string,
  input: {
    bullmqJobId: string;
    schedulerJobId?: string;
    jobType: Exclude<SchedulerJobType, "native.run">;
    payload: ExecutorRunJobPayload;
    attemptsMade: number;
  },
  runner?: CliCommandRunner,
  appServerTransport?: CodexAppServerTransport,
): Promise<void> {
  updateSchedulerJobRecord(dbPath, input.bullmqJobId, "running", undefined, input.attemptsMade);
  const payload = { ...input.payload, schedulerJobId: input.schedulerJobId };
  try {
    const result = input.jobType === "codex.rpc.run" || input.jobType === "codex.app_server.run"
      ? await runCodexAppServerRunJob(dbPath, payload as AppServerRunJobPayload, appServerTransport)
      : input.jobType === "rpc.run"
      ? await runRpcRunJob(dbPath, payload as AppServerRunJobPayload, appServerTransport)
      : await runCliRunJob(dbPath, payload as CliRunJobPayload, runner);
    updateSchedulerJobRecord(
      dbPath,
      input.bullmqJobId,
      schedulerJobStatusForRunnerResult(result.status),
      undefined,
      input.attemptsMade,
    );
  } catch (error) {
    updateSchedulerJobRecord(dbPath, input.bullmqJobId, "failed", error, input.attemptsMade);
    throw error;
  }
}

function schedulerJobStatusForRunnerResult(status: RunnerQueueStatus): SchedulerJobStatus {
  return status;
}

function appServerResultStatus(result: { session: { exitCode: number | null }; result: { skillOutput?: SkillOutputContract; contractValidation?: { valid: boolean }; events?: Array<Record<string, unknown>> } }): RunnerQueueStatus {
  if (hasApprovalRequest(result.result.events)) return "approval_needed";
  if (result.result.events?.some((event) => String(event.type ?? "") === "prompt/result" && String(event.stopReason ?? "") === "cancelled")) return "blocked";
  if (result.result.contractValidation && !result.result.contractValidation.valid) return "review_needed";
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
  featureId?: string;
  projectId?: string;
  title: string;
  description: string;
  risk: RiskLevel;
  allowedFiles: string[];
  workspaceRoot: string;
  adapter: CliAdapterConfig;
  prompt: string;
  executionInvocation: ExecutionAdapterInvocationV1;
} {
  const payloadContext = payload.context ?? {};
  const executionPreference = executionPreferenceFromPayload(payload);
  const featureIdFromContext = optionalString(payloadContext.featureId);
  const result = runSqlite(dbPath, [], [
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
  const featureRow = result.queries.feature[0];
  if (!featureRow && !payload.projectId) {
    throw new Error("Execution Adapter run requires a feature or project context.");
  }
  const projectId = payload.projectId ?? optionalString(featureRow?.project_id);
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
  const featureId = featureIdFromContext ?? optionalString(featureRow?.id);
  const title = optionalString(featureRow?.title) ?? `Project ${projectId}`;
  const description = title;
  const risk = normalizeRisk(payloadContext.risk);
  const allowedFiles = optionalStringArray(payloadContext.allowedFiles);
  const executionInvocation = buildExecutionInvocation({
    payload,
    projectId,
    workspaceRoot: workspace.workspaceRoot,
    featureId,
    requirementIds: parseJsonArray(featureRow?.primary_requirements_json).map(String),
    allowedFiles,
    risk,
    sandboxMode: adapter.defaults.sandbox,
    approvalPolicy: adapter.defaults.approval,
  });
  const context = [
    `Execution ${payload.executionId}${featureId ? ` for feature ${featureId}` : ""}: ${title}`,
    "",
    description,
  ].join("\n");
  return {
    featureId,
    projectId,
    title,
    description,
    risk,
    allowedFiles,
    workspaceRoot: workspace.workspaceRoot,
    adapter,
    prompt: buildExecutionInvocationPrompt(executionInvocation, context),
    executionInvocation,
  };
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
  if (id === CLAUDE_CLI_ADAPTER_CONFIG.id) return CLAUDE_CLI_ADAPTER_CONFIG;
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
    defaults: parseJsonObject(row.defaults_json),
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
    defaults: parseJsonObject(row.defaults_json),
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

function buildExecutionInvocation(input: {
  payload: CliRunJobPayload;
  projectId?: string;
  workspaceRoot: string;
  featureId?: string;
  requirementIds?: string[];
  allowedFiles: string[];
  risk: RiskLevel;
  sandboxMode?: string;
  approvalPolicy?: string;
}): ExecutionAdapterInvocationV1 {
  const context = input.payload.context ?? {};
  const skillName = optionalString(context.skillName) ?? (input.featureId ? "implement-feature" : "implement-feature");
  const requestedAction = input.payload.requestedAction ?? optionalString(context.skillPhase) ?? input.payload.operation;
  const contextSourcePaths = optionalStringArray(context.sourcePaths);
  const contextImagePaths = optionalStringArray(context.imagePaths);
  const contextExpectedArtifacts = normalizeArtifactContracts(context.expectedArtifacts);
  const featureSpecPath = defaultFeatureSpecPath(input.featureId, context, input.workspaceRoot);
  const featureExecution = skillName === "implement-feature"
    && (input.payload.operation === "feature_execution" || requestedAction === "feature_execution");
  const sourcePaths = contextSourcePaths.length
    ? contextSourcePaths
    : [
        "AGENTS.md",
        ".agents/skills",
        ...(featureSpecPath ? [
          `${featureSpecPath}/requirements.md`,
          `${featureSpecPath}/design.md`,
          `${featureSpecPath}/tasks.md`,
        ] : []),
      ];
  const expectedArtifacts = contextExpectedArtifacts.length
    ? contextExpectedArtifacts
    : featureExecution
        ? []
        : featureSpecPath
        ? normalizeArtifactContracts([`${featureSpecPath}/design.md`, `${featureSpecPath}/tasks.md`])
        : normalizeArtifactContracts([".autobuild/reports/spec-intake.json"]);
  return {
    contractVersion: "execution-adapter/v1",
    executionId: input.payload.executionId,
    jobId: optionalString((input.payload as unknown as Record<string, unknown>).schedulerJobId),
    projectId: input.projectId ?? "unknown-project",
    workspaceRoot: input.workspaceRoot,
    operation: input.payload.operation,
    featureId: input.featureId,
    specState: parseJsonObject(context.specState),
    traceability: {
      featureId: input.featureId,
      requirementIds: input.payload.traceability?.requirementIds ?? input.requirementIds ?? [],
    },
    constraints: {
      allowedFiles: input.allowedFiles,
      sandboxMode: normalizeSandboxMode(input.sandboxMode),
      approvalPolicy: normalizeApprovalPolicy(input.approvalPolicy),
      risk: input.risk,
    },
    outputSchema: DEFAULT_OUTPUT_SCHEMA,
    skillInstruction: {
      skillName,
      requestedAction,
      sourcePaths,
      imagePaths: contextImagePaths,
      expectedArtifacts,
      operatorInput: buildSkillOperatorInput(context),
    },
  };
}

function buildSkillOperatorInput(context: ExecutorJobContext): ExecutionAdapterInvocationV1["skillInstruction"]["operatorInput"] | undefined {
  const clarificationText = optionalString(context.clarificationText);
  const comment = optionalString(context.comment);
  const specChangeIntent = optionalString(context.specChangeIntent);
  const desiredOutcome = optionalString(context.desiredOutcome);
  const targetFeatureStatus = optionalString(context.targetFeatureStatus);
  const nextUserAction = optionalString(context.nextUserAction);
  if (!clarificationText && !comment && !specChangeIntent && !desiredOutcome && !targetFeatureStatus && !nextUserAction) {
    return undefined;
  }
  return {
    clarificationText,
    comment,
    specChangeIntent,
    desiredOutcome,
    targetFeatureStatus,
    nextUserAction,
  };
}

function defaultFeatureSpecPath(featureId: string | undefined, context: ExecutorJobContext, workspaceRoot: string): string | undefined {
  const contextPath = optionalString(context.featureSpecPath);
  if (contextPath) return contextPath.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!featureId) return undefined;
  const docsFolder = findFeatureSpecFolder(workspaceRoot, featureId);
  return `docs/agentic-spec/features/${docsFolder ?? featureId.toLowerCase()}`;
}

function findFeatureSpecFolder(workspaceRoot: string, featureId: string): string | undefined {
  try {
    return readdirSync(join(workspaceRoot, "docs", "agentic-spec", "features"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .find((folder) => featureIdFromFolder(folder).toUpperCase() === featureId.toUpperCase());
  } catch {
    return undefined;
  }
}

function featureIdFromFolder(folder: string): string {
  const match = folder.match(/^feat-(\d+)/i);
  return match ? `FEAT-${match[1]}` : folder.toUpperCase();
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
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".svg") || path.endsWith(".png")) return "image";
  return "artifact";
}

function normalizeSandboxMode(value: unknown): ExecutionAdapterInvocationV1["constraints"]["sandboxMode"] {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access" ? value : undefined;
}

function normalizeApprovalPolicy(value: unknown): ExecutionAdapterInvocationV1["constraints"]["approvalPolicy"] {
  return value === "untrusted" || value === "on-failure" || value === "on-request" || value === "never" || value === "bypass" ? value : undefined;
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
