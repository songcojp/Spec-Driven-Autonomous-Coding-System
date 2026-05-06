import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  createCodexAppServerTransportFromConfig,
  DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG,
  interruptCodexAppServerTurn,
  type CodexAppServerAdapterConfig,
} from "./codex-rpc-adapter.ts";
import { ensureTokenConsumptionRecords, submitConsoleCommand, type ConsoleCommandInput, type ConsoleCommandReceipt } from "./product-console.ts";
import type { ExecutorRunJobPayload, SchedulerClient, SchedulerJobType } from "./scheduler.ts";
import { runSqlite } from "./sqlite.ts";
import {
  mergeFileSpecState,
  readFileSpecState,
  writeFileSpecState,
  type FileSpecExecutionStatus,
  type FileSpecLifecycleStatus,
} from "./spec-protocol.ts";

export type SpecDriveIdeDocument = {
  kind:
    | "prd"
    | "requirements"
    | "hld"
    | "ui-spec"
    | "feature-index"
    | "feature-requirements"
    | "feature-design"
    | "feature-tasks"
    | "spec-state"
    | "queue";
  label: string;
  path: string;
  exists: boolean;
};

export type SpecDriveIdeFeatureNode = {
  id: string;
  folder: string;
  title: string;
  status: string;
  priority?: string;
  dependencies: string[];
  blockedReasons: string[];
  nextAction?: string;
  documents: SpecDriveIdeDocument[];
  latestExecutionId?: string;
  latestExecutionStatus?: string;
  tokenConsumption?: SpecDriveIdeTokenConsumption;
  indexStatus: "indexed" | "missing_from_index" | "missing_folder";
  tasks: SpecDriveIdeTaskProjection[];
  taskParseBlockedReasons: string[];
};

export type SpecDriveIdeTaskProjection = {
  id: string;
  title: string;
  status: string;
  description?: string;
  verification?: string;
  line?: number;
};

export type SpecDriveIdeQueueItem = {
  schedulerJobId?: string;
  executionId?: string;
  status: string;
  operation?: string;
  jobType?: string;
  featureId?: string;
  taskId?: string;
  adapter?: string;
  runMode?: "cli" | "rpc";
  adapterId?: string;
  preferenceSource?: string;
  threadId?: string;
  turnId?: string;
  updatedAt?: string;
  summary?: string;
};

export type SpecDriveIdeExecutionDetail = SpecDriveIdeQueueItem & {
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  rawLogs: Array<{ stdout: string; stderr: string; events: unknown[]; createdAt?: string }>;
  rawLogRefs: string[];
  tokenConsumption?: SpecDriveIdeTokenConsumption;
  producedArtifacts: unknown[];
  executionResults: Array<{ id: string; kind: string; path?: string; summary?: string; metadata: Record<string, unknown>; createdAt?: string }>;
  diffSummary?: unknown;
  skillOutputContract?: unknown;
  contractValidation?: unknown;
  outputSchema?: unknown;
  approvalRequests: unknown[];
};

export type SpecDriveIdeTokenConsumption = {
  runId: string;
  schedulerJobId?: string;
  projectId?: string;
  featureId?: string;
  taskId?: string;
  operation?: string;
  model?: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUsd: number;
  currency: string;
  pricingStatus: string;
  usage: Record<string, unknown>;
  pricing: Record<string, unknown>;
  sourcePath: string;
  recordedAt: string;
};

export type BuildSpecDriveIdeExecutionDetailOptions = {
  logsAfter?: string;
  logLimit?: number;
};

export type SpecDriveIdeDiagnostic = {
  path: string;
  severity: "error" | "warning" | "info";
  message: string;
  source: "workspace" | "spec-state" | "execution";
  featureId?: string;
  executionId?: string;
};

export type SpecDriveIdeInitializationStep = {
  key:
    | "create_or_import_project"
    | "workspace_root_resolved"
    | "connect_git_repository"
    | "initialize_spec_protocol"
    | "copy_skill_runtime"
    | "import_or_create_constitution"
    | "initialize_project_memory"
    | "check_project_health"
    | "current_project_context";
  label: string;
  status: "Ready" | "Blocked" | "Draft" | "Active";
  updatedAt?: string;
  blockedReason?: string;
};

export type SpecDriveIdeAutomationState = {
  status: "idle" | "running" | "paused";
  updatedAt?: string;
  source: "project" | "audit";
};

export type SpecDriveIdeView = {
  recognized: boolean;
  workspaceRoot?: string;
  specRoot?: string;
  language?: string;
  project?: {
    id: string;
    name: string;
    targetRepoPath?: string;
  };
  activeAdapter?: {
    id: string;
    displayName: string;
    status: string;
  };
  executionPreferenceOptions?: {
    active: { runMode: "cli" | "rpc"; adapterId?: string; source?: string };
    cliAdapters: Array<{ id: string; displayName: string; status: string }>;
    rpcAdapters: Array<{ id: string; displayName: string; status: string; provider?: string }>;
  };
  automation: SpecDriveIdeAutomationState;
  projectInitialization: {
    ready: boolean;
    blocked: boolean;
    steps: SpecDriveIdeInitializationStep[];
  };
  documents: SpecDriveIdeDocument[];
  features: SpecDriveIdeFeatureNode[];
  queue: {
    groups: Record<string, SpecDriveIdeQueueItem[]>;
  };
  diagnostics: SpecDriveIdeDiagnostic[];
  missing: string[];
  factSources: string[];
  productConsole: {
    defaultUrl: string;
    links: {
      workspace: string;
      queue: string;
    };
  };
};

export type SpecChangeRequestIntent =
  | "clarification"
  | "requirement_intake"
  | "requirement_change_or_intake"
  | "spec_evolution"
  | "generate_ears"
  | "update_design"
  | "split_feature";

export type SpecChangeRequestV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceRoot: string;
  source: {
    file: string;
    range: {
      startLine: number;
      endLine: number;
      startCharacter?: number;
      endCharacter?: number;
    };
    textHash: string;
  };
  intent: SpecChangeRequestIntent;
  comment: string;
  targetRequirementId?: string;
  traceability?: string[];
};

export type IdeSpecChangeReceipt =
  | (ConsoleCommandReceipt & {
    ideCommandType: "spec_change_request";
    routedIntent: SpecChangeRequestIntent;
    specChangeRequestId: string;
    currentTextHash?: string;
  })
  | {
    id: string;
    action: "submit_spec_change_request";
    status: "blocked";
    entityType: "spec";
    entityId: string;
    acceptedAt: string;
    ideCommandType: "spec_change_request";
    routedIntent: SpecChangeRequestIntent;
    specChangeRequestId: string;
    error: "stale_source" | "invalid_source" | "project_not_found" | "workspace_mismatch";
    blockedReasons: string[];
    expectedTextHash?: string;
    currentTextHash?: string;
  };

export type IdeQueueAction =
  | "enqueue"
  | "run_now"
  | "pause"
  | "resume"
  | "retry"
  | "cancel"
  | "skip"
  | "reprioritize"
  | "refresh"
  | "approve";

export type IdeApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type IdeQueueCommandV1 = {
  schemaVersion: 1;
  ideCommandType: "queue_action";
  projectId?: string;
  workspaceRoot?: string;
  queueAction: IdeQueueAction;
  entityType: "project" | "feature" | "task" | "run" | "job";
  entityId: string;
  requestedBy?: string;
  reason: string;
  payload?: Record<string, unknown>;
  approvalDecision?: IdeApprovalDecision;
};

export type IdeQueueCommandReceipt = {
  id: string;
  action: IdeQueueAction;
  status: "accepted" | "blocked";
  entityType: IdeQueueCommandV1["entityType"];
  entityId: string;
  acceptedAt: string;
  ideCommandType: "queue_action";
  schedulerJobId?: string;
  schedulerJobIds?: string[];
  executionId?: string;
  previousExecutionId?: string;
  interruptResult?: Record<string, unknown>;
  blockedReasons?: string[];
  detail?: SpecDriveIdeExecutionDetail;
};

type BuildSpecDriveIdeViewOptions = {
  workspaceRoot?: string;
  projectId?: string;
};

type SubmitIdeQueueCommandOptions = {
  scheduler?: SchedulerClient;
  now?: Date;
  interruptTurn?: (input: { threadId: string; turnId: string; executionId: string; workspaceRoot?: string }) => Promise<Record<string, unknown>>;
};

type ProjectRow = {
  id?: unknown;
  name?: unknown;
  target_repo_path?: unknown;
  automation_enabled?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type FeatureQueueEntry = {
  id: string;
  priority?: string;
  dependencies?: string[];
};

type FeatureQueuePlan = {
  features?: FeatureQueueEntry[];
};

type FeatureIndexEntry = {
  id: string;
  title?: string;
  folder?: string;
  status?: string;
  primaryRequirements?: string[];
  milestone?: string;
  dependencies?: string[];
};

export function buildSpecDriveIdeView(dbPath: string, options: BuildSpecDriveIdeViewOptions = {}): SpecDriveIdeView {
  const project = resolveProject(dbPath, options);
  const workspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : optionalString(project?.target_repo_path);
  const projectId = options.projectId ?? optionalString(project?.id);
  if (projectId) ensureTokenConsumptionRecords(dbPath, projectId);
  const specRoot = workspaceRoot ? detectSpecRoot(workspaceRoot) : undefined;
  const language = specRoot?.startsWith("docs/") ? specRoot.slice("docs/".length) : undefined;
  const documents = workspaceRoot ? buildTopLevelDocuments(workspaceRoot, specRoot) : [];
  const features = workspaceRoot ? buildFeatureNodes(dbPath, workspaceRoot, projectId) : [];
  const queue = buildQueueGroups(dbPath, projectId);
  const activeAdapter = readActiveAdapter(dbPath);
  const executionPreferenceOptions = readExecutionPreferenceOptions(dbPath, projectId);
  const automation = buildAutomationState(dbPath, project, projectId);
  const projectInitialization = buildProjectInitialization(dbPath, { project, projectId, workspaceRoot });
  const missing = [
    ...documents.filter((document) => !document.exists).map((document) => document.path),
    ...(workspaceRoot && !existsSync(join(workspaceRoot, "docs/features")) ? ["docs/features"] : []),
  ];
  const diagnostics = buildDiagnostics(documents, features, queue.groups, workspaceRoot);

  return {
    recognized: Boolean(workspaceRoot && specRoot && existsSync(join(workspaceRoot, "docs/features"))),
    workspaceRoot,
    specRoot,
    language,
    project: project?.id ? {
      id: String(project.id),
      name: String(project.name ?? project.id),
      targetRepoPath: optionalString(project.target_repo_path),
    } : undefined,
    activeAdapter,
    executionPreferenceOptions,
    automation,
    projectInitialization,
    documents,
    features,
    queue,
    diagnostics,
    missing,
    factSources: [
      "workspace_files",
      "docs/features/feature-pool-queue.json",
      "docs/features/*/spec-state.json",
      "scheduler_job_records",
      "execution_records",
      "cli_adapter_configs",
      "rpc_adapter_configs",
      "project_execution_preferences",
    ],
    productConsole: {
      defaultUrl: "http://127.0.0.1:5173",
      links: {
        workspace: "/#spec",
        queue: "/#runner",
      },
    },
  };
}

export function isSpecChangeRequestV1(value: unknown): value is SpecChangeRequestV1 {
  if (!isRecord(value)) return false;
  const source = isRecord(value.source) ? value.source : {};
  const range = isRecord(source.range) ? source.range : {};
  return value.schemaVersion === 1
    && typeof value.projectId === "string"
    && typeof value.workspaceRoot === "string"
    && typeof source.file === "string"
    && typeof source.textHash === "string"
    && typeof range.startLine === "number"
    && typeof range.endLine === "number"
    && isSpecChangeRequestIntent(value.intent)
    && typeof value.comment === "string";
}

export function isIdeQueueCommandV1(value: unknown): value is IdeQueueCommandV1 {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 1
    && value.ideCommandType === "queue_action"
    && isIdeQueueAction(value.queueAction)
    && typeof value.entityType === "string"
    && ["project", "feature", "task", "run", "job"].includes(value.entityType)
    && typeof value.entityId === "string"
    && typeof value.reason === "string";
}

export function buildSpecDriveIdeExecutionDetail(
  dbPath: string,
  executionId: string,
  options: BuildSpecDriveIdeExecutionDetailOptions = {},
): SpecDriveIdeExecutionDetail | undefined {
  const logLimit = Math.max(1, Math.min(100, Math.trunc(options.logLimit ?? 10)));
  const logFilter = options.logsAfter
    ? { sql: "AND created_at > ?", params: [options.logsAfter] }
    : { sql: "", params: [] };
  const result = runSqlite(dbPath, [], [
    {
      name: "execution",
      sql: `SELECT
          er.id,
          er.scheduler_job_id,
          er.executor_type,
          er.operation,
          er.project_id,
          er.context_json,
          er.status,
          er.summary,
          er.metadata_json,
          er.updated_at,
          sj.job_type,
          sj.status AS job_status
        FROM execution_records er
        LEFT JOIN scheduler_job_records sj ON sj.id = er.scheduler_job_id
        WHERE er.id = ?
        LIMIT 1`,
      params: [executionId],
    },
    {
      name: "logs",
      sql: `SELECT stdout, stderr, events_json, created_at
        FROM raw_execution_logs
        WHERE run_id = ? ${logFilter.sql}
        ORDER BY created_at ASC
        LIMIT ?`,
      params: [executionId, ...logFilter.params, logLimit],
    },
    {
      name: "executionResults",
      sql: "SELECT id, 'status_check' AS kind, '' AS path, summary, execution_result_json AS metadata_json, created_at FROM status_check_results WHERE run_id = ? ORDER BY created_at DESC LIMIT 20",
      params: [executionId],
    },
    {
      name: "tokenConsumption",
      sql: `SELECT
          run_id,
          scheduler_job_id,
          project_id,
          feature_id,
          task_id,
          operation,
          model,
          input_tokens,
          cached_input_tokens,
          output_tokens,
          reasoning_output_tokens,
          total_tokens,
          cost_usd,
          currency,
          pricing_status,
          usage_json,
          pricing_json,
          source_path,
          recorded_at
        FROM token_consumption_records
        WHERE run_id = ?
        LIMIT 1`,
      params: [executionId],
    },
  ]);
  const row = result.queries.execution[0];
  if (!row) return undefined;
  const context = parseJsonObject(optionalString(row.context_json));
  const metadata = parseJsonObject(optionalString(row.metadata_json));
  const rawLogs = result.queries.logs.map((log) => ({
    stdout: String(log.stdout ?? ""),
    stderr: String(log.stderr ?? ""),
    events: parseJsonArray(log.events_json),
    createdAt: optionalString(log.created_at),
  }));
  const executionResults = result.queries.executionResults.map((entry) => ({
    id: String(entry.id),
    kind: String(entry.kind),
    path: optionalString(entry.path),
    summary: optionalString(entry.summary),
    metadata: parseJsonObject(optionalString(entry.metadata_json)),
    createdAt: optionalString(entry.created_at),
  }));
  const metadataArtifacts = arrayValue(metadata.producedArtifacts);
  const resultArtifacts = executionResults.flatMap((entry) => arrayValue(entry.metadata.producedArtifacts));
  const eventRefs = arrayValue(metadata.eventRefs);
  const rawLogRefs = arrayValue(metadata.rawLogRefs).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  const resultDiff = executionResults.map((entry) => entry.metadata.diff ?? entry.metadata.diffSummary).find((entry) => entry !== undefined);
  const approvalRequests = rawLogs
    .flatMap((log) => log.events)
    .filter((event) => isApprovalRequestEvent(event));
  const tokenConsumption = tokenConsumptionFromRow(result.queries.tokenConsumption[0]);
  return {
    schedulerJobId: optionalString(row.scheduler_job_id),
    executionId: String(row.id),
    status: optionalString(row.status) ?? optionalString(row.job_status) ?? "unknown",
    operation: optionalString(row.operation),
    jobType: optionalString(row.job_type) ?? optionalString(metadata.jobType),
    featureId: optionalString(context.featureId),
    taskId: optionalString(context.taskId),
    adapter: optionalString(metadata.skillSlug) ?? optionalString(metadata.adapterId),
    threadId: optionalString(metadata.threadId),
    turnId: optionalString(metadata.turnId),
    updatedAt: optionalString(row.updated_at),
    summary: optionalString(row.summary),
    context,
    metadata,
    rawLogs,
    rawLogRefs,
    tokenConsumption,
    producedArtifacts: metadataArtifacts.length > 0 ? metadataArtifacts : resultArtifacts,
    executionResults,
    diffSummary: metadata.diffSummary ?? metadata.diff ?? resultDiff,
    skillOutputContract: metadata.skillOutputContract,
    contractValidation: metadata.contractValidation,
    outputSchema: metadata.outputSchema,
    approvalRequests: approvalRequests.length > 0 ? approvalRequests : eventRefs.filter(isApprovalRequestEvent),
  };
}

function tokenConsumptionFromRow(row: Record<string, unknown> | undefined): SpecDriveIdeTokenConsumption | undefined {
  if (!row) return undefined;
  const runId = optionalString(row.run_id);
  if (!runId) return undefined;
  return {
    runId,
    schedulerJobId: optionalString(row.scheduler_job_id),
    projectId: optionalString(row.project_id),
    featureId: optionalString(row.feature_id),
    taskId: optionalString(row.task_id),
    operation: optionalString(row.operation),
    model: optionalString(row.model),
    inputTokens: numberOrZero(row.input_tokens),
    cachedInputTokens: numberOrZero(row.cached_input_tokens),
    outputTokens: numberOrZero(row.output_tokens),
    reasoningOutputTokens: numberOrZero(row.reasoning_output_tokens),
    totalTokens: numberOrZero(row.total_tokens),
    costUsd: nonNegativeNumberOrZero(row.cost_usd),
    currency: optionalString(row.currency) ?? "USD",
    pricingStatus: optionalString(row.pricing_status) ?? "unknown",
    usage: parseJsonObject(optionalString(row.usage_json)),
    pricing: parseJsonObject(optionalString(row.pricing_json)),
    sourcePath: optionalString(row.source_path) ?? "",
    recordedAt: optionalString(row.recorded_at) ?? "",
  };
}

export async function submitIdeQueueCommand(
  dbPath: string,
  command: IdeQueueCommandV1,
  options: SubmitIdeQueueCommandOptions = {},
): Promise<IdeQueueCommandReceipt> {
  const acceptedAt = (options.now ?? new Date()).toISOString();
  const id = randomUUID();
  const blockedReasons: string[] = [];
  const base = (): IdeQueueCommandReceipt => ({
    id,
    action: command.queueAction,
    status: blockedReasons.length > 0 ? "blocked" : "accepted",
    entityType: command.entityType,
    entityId: command.entityId,
    acceptedAt,
    ideCommandType: "queue_action",
    blockedReasons: blockedReasons.length > 0 ? blockedReasons : undefined,
  });

  if (command.queueAction === "refresh") {
    return { ...base(), detail: command.entityType === "run" ? buildSpecDriveIdeExecutionDetail(dbPath, command.entityId) : undefined };
  }

  if (command.queueAction === "enqueue" || command.queueAction === "run_now") {
    const target = findExecutionForQueueCommand(dbPath, command);
    if (!target) {
      blockedReasons.push(`Execution or job not found for ${command.queueAction}: ${command.entityId}`);
      return base();
    }
    if (command.queueAction === "run_now") {
      const receipt = requeueExistingQueueTarget(dbPath, target, command, acceptedAt, options.scheduler);
      if (receipt.blockedReasons.length > 0) {
        blockedReasons.push(...receipt.blockedReasons);
        return base();
      }
      return {
        ...base(),
        schedulerJobId: receipt.schedulerJobId,
        executionId: receipt.executionId,
      };
    }
    const receipt = submitConsoleCommand(dbPath, queueScheduleCommand(command, acceptedAt, target), { scheduler: options.scheduler });
    return {
      ...base(),
      status: receipt.status,
      schedulerJobId: receipt.schedulerJobId,
      executionId: receipt.executionId,
      blockedReasons: receipt.blockedReasons,
    };
  }

  if (command.queueAction === "retry") {
    const previous = findExecutionForQueueCommand(dbPath, command);
    if (!previous) {
      blockedReasons.push(`Execution not found for retry: ${command.entityId}`);
      return base();
    }
    if (!previous.executionId) {
      blockedReasons.push(`Execution record is required for retry: ${command.entityId}`);
      return base();
    }
    const payload = retryPayload(previous, command, acceptedAt);
    const scheduler = options.scheduler;
    const isRpcRetry = previous.jobType === "rpc.run"
      || previous.jobType === "codex.rpc.run"
      || previous.jobType === "codex.app_server.run"
      || previous.executorType === "rpc"
      || previous.executorType === "codex.rpc"
      || previous.executorType === "codex.app_server";
    const job = isRpcRetry && (scheduler?.enqueueRpcRun || scheduler?.enqueueAppServerRun)
      ? (scheduler.enqueueRpcRun ?? scheduler.enqueueAppServerRun)?.(payload)
      : scheduler?.enqueueCliRun(payload);
    if (!job) {
      blockedReasons.push("Scheduler is required to retry an execution.");
      return base();
    }
    persistQueuedExecution(dbPath, {
      executionId: payload.executionId,
      schedulerJobId: job.schedulerJobId,
      executorType: previous.executorType,
      operation: previous.operation,
      projectId: previous.projectId,
      context: payload.context ?? {},
      metadata: {
        ...previous.metadata,
        previousExecutionId: previous.executionId,
        retryReason: command.reason,
        retriedAt: acceptedAt,
      },
      acceptedAt,
    });
    return {
      ...base(),
      schedulerJobId: job.schedulerJobId,
      executionId: payload.executionId,
      previousExecutionId: previous.executionId,
    };
  }

  if (command.queueAction === "cancel") {
    const target = findExecutionForQueueCommand(dbPath, command);
    if (!target) {
      blockedReasons.push(`Execution or job not found for cancel: ${command.entityId}`);
      return base();
    }
    let interruptResult: Record<string, unknown> | undefined;
    if (target.status === "running") {
      if (!target.executionId) {
        blockedReasons.push("Running cancel requires an Execution Record.");
        return base();
      }
      const threadId = optionalString(target.metadata.threadId);
      const turnId = optionalString(target.metadata.turnId);
      if (!threadId || !turnId) {
        blockedReasons.push("Running cancel requires threadId and turnId in Execution Record metadata.");
        return base();
      }
      interruptResult = await interruptRunningTurn(dbPath, {
        executionId: target.executionId,
        threadId,
        turnId,
        workspaceRoot: optionalString(target.metadata.workspaceRoot) ?? optionalString(target.context.workspaceRoot),
      }, options.interruptTurn);
    }
    updateQueueTarget(dbPath, target, "cancelled", acceptedAt, {
      cancelReason: command.reason,
      cancelledBy: command.requestedBy ?? "vscode-extension",
      interruptResult,
    }, command.workspaceRoot);
    return { ...base(), schedulerJobId: target.schedulerJobId, executionId: target.executionId, interruptResult };
  }

  if (command.queueAction === "skip") {
    const target = findExecutionForQueueCommand(dbPath, command);
    if (!target) {
      blockedReasons.push(`Execution or job not found for skip: ${command.entityId}`);
      return base();
    }
    updateQueueTarget(dbPath, target, "skipped", acceptedAt, { skipReason: command.reason }, command.workspaceRoot);
    return { ...base(), schedulerJobId: target.schedulerJobId, executionId: target.executionId };
  }

  if (command.queueAction === "pause" || command.queueAction === "resume" || command.queueAction === "reprioritize" || command.queueAction === "approve") {
    const target = findExecutionForQueueCommand(dbPath, command);
    if (!target) {
      blockedReasons.push(`Execution or job not found for ${command.queueAction}: ${command.entityId}`);
      return base();
    }
    if (command.queueAction === "pause") {
      updateQueueTarget(dbPath, target, "paused", acceptedAt, { pausedReason: command.reason }, command.workspaceRoot);
    } else if (command.queueAction === "resume") {
      updateQueueTarget(dbPath, target, "queued", acceptedAt, { resumedReason: command.reason, blockedReason: undefined }, command.workspaceRoot);
    } else if (command.queueAction === "reprioritize") {
      updateQueuePriority(dbPath, target, command.payload, acceptedAt);
    } else {
      if (!isIdeApprovalDecision(command.approvalDecision)) {
        blockedReasons.push("Approval command requires approvalDecision accept, acceptForSession, decline, or cancel.");
        return base();
      }
      updateQueueTarget(dbPath, target, command.approvalDecision === "cancel" ? "cancelled" : "approval_answered", acceptedAt, {
        approvalState: "answered",
        approvalDecision: command.approvalDecision,
        approvalReason: command.reason,
      }, command.workspaceRoot);
    }
    return { ...base(), schedulerJobId: target.schedulerJobId, executionId: target.executionId };
  }

  blockedReasons.push(`Unsupported IDE queue action: ${command.queueAction}`);
  return base();
}

export function submitIdeSpecChangeRequest(
  dbPath: string,
  request: SpecChangeRequestV1,
  options: { scheduler?: SchedulerClient; now?: Date } = {},
): IdeSpecChangeReceipt {
  const now = options.now ?? new Date();
  const acceptedAt = now.toISOString();
  const specChangeRequestId = randomUUID();
  const routedIntent = routeSpecChangeIntent(request);
  const project = resolveProject(dbPath, { projectId: request.projectId });
  if (!project?.id) {
    return blockedSpecChangeReceipt(request, {
      acceptedAt,
      specChangeRequestId,
      routedIntent,
      error: "project_not_found",
      blockedReasons: [`Project not found: ${request.projectId}`],
    });
  }
  const workspaceRoot = resolve(request.workspaceRoot);
  const projectWorkspace = optionalString(project.target_repo_path);
  if (projectWorkspace && resolve(projectWorkspace) !== workspaceRoot) {
    return blockedSpecChangeReceipt(request, {
      acceptedAt,
      specChangeRequestId,
      routedIntent,
      error: "workspace_mismatch",
      blockedReasons: [`SpecChangeRequest workspace does not match project workspace: ${request.workspaceRoot}`],
    });
  }
  const sourceValidation = readSourceSelection(workspaceRoot, request);
  if (!sourceValidation.ok) {
    return blockedSpecChangeReceipt(request, {
      acceptedAt,
      specChangeRequestId,
      routedIntent,
      error: "invalid_source",
      blockedReasons: [sourceValidation.reason],
    });
  }
  if (sourceValidation.textHash !== request.source.textHash) {
    return blockedSpecChangeReceipt(request, {
      acceptedAt,
      specChangeRequestId,
      routedIntent,
      error: "stale_source",
      blockedReasons: ["stale_source: source text changed; refresh the document and confirm the request again."],
      expectedTextHash: request.source.textHash,
      currentTextHash: sourceValidation.textHash,
    });
  }
  const command = commandForSpecChangeRequest(request, routedIntent, sourceValidation.text, acceptedAt);
  const receipt = submitConsoleCommand(dbPath, command, { scheduler: options.scheduler });
  return {
    ...receipt,
    ideCommandType: "spec_change_request",
    routedIntent,
    specChangeRequestId,
    currentTextHash: sourceValidation.textHash,
  };
}

export function hashSpecSourceText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function resolveProject(dbPath: string, options: BuildSpecDriveIdeViewOptions): ProjectRow | undefined {
  if (options.projectId) {
    const result = runSqlite(dbPath, [], [
      { name: "project", sql: "SELECT id, name, target_repo_path, automation_enabled FROM projects WHERE id = ? LIMIT 1", params: [options.projectId] },
    ]);
    return result.queries.project[0] as ProjectRow | undefined;
  }
  if (options.workspaceRoot) {
    const workspaceRoot = resolve(options.workspaceRoot);
    const result = runSqlite(dbPath, [], [
      { name: "project", sql: "SELECT id, name, target_repo_path, automation_enabled FROM projects WHERE target_repo_path = ? LIMIT 1", params: [workspaceRoot] },
      {
        name: "repositoryProject",
        sql: `SELECT p.id, p.name, COALESCE(p.target_repo_path, r.local_path) AS target_repo_path, p.automation_enabled
          FROM repository_connections r
          JOIN projects p ON p.id = r.project_id
          WHERE r.local_path = ?
          ORDER BY r.connected_at DESC
          LIMIT 1`,
        params: [workspaceRoot],
      },
    ]);
    return (result.queries.project[0] ?? result.queries.repositoryProject[0]) as ProjectRow | undefined;
  }
  const result = runSqlite(dbPath, [], [
    {
      name: "selected",
      sql: `SELECT p.id, p.name, p.target_repo_path, p.automation_enabled
        FROM project_selection_context s
        JOIN projects p ON p.id = s.project_id
        LIMIT 1`,
    },
    { name: "first", sql: "SELECT id, name, target_repo_path, automation_enabled FROM projects ORDER BY rowid LIMIT 1" },
  ]);
  return (result.queries.selected[0] ?? result.queries.first[0]) as ProjectRow | undefined;
}

function buildAutomationState(dbPath: string, project: ProjectRow | undefined, projectId?: string): SpecDriveIdeAutomationState {
  const enabled = Number(project?.automation_enabled ?? 0) === 1;
  const auditRows = runSqlite(dbPath, [], [
    {
      name: "latest",
      sql: `SELECT event_type, payload_json, created_at
        FROM audit_timeline_events
        WHERE event_type IN ('console_command_start_auto_run', 'console_command_pause_runner', 'console_command_resume_runner')
          AND (
            entity_type = 'runner'
            OR (? IS NOT NULL AND entity_id = ?)
          )
        ORDER BY created_at DESC, rowid DESC
        LIMIT 20`,
      params: [projectId ?? null, projectId ?? null],
    },
  ]).queries.latest;
  const audit = auditRows.find(isAcceptedAutomationAudit);
  const eventType = optionalString(audit?.event_type);
  if (enabled) {
    return {
      status: "running",
      updatedAt: optionalString(audit?.created_at),
      source: eventType ? "audit" : "project",
    };
  }
  if (eventType === "console_command_pause_runner") {
    return { status: "paused", updatedAt: optionalString(audit?.created_at), source: "audit" };
  }
  return {
    status: "idle",
    source: "project",
  };
}

function isAcceptedAutomationAudit(row: Record<string, unknown>): boolean {
  const eventType = optionalString(row.event_type);
  if (eventType !== "console_command_start_auto_run") return true;
  const payload = parseJsonObject(optionalString(row.payload_json));
  const autoRun = isRecord(payload.autoRun) ? payload.autoRun : {};
  const blockedReasons = Array.isArray(autoRun.blockedReasons) ? autoRun.blockedReasons : [];
  return blockedReasons.length === 0;
}

function commandForSpecChangeRequest(
  request: SpecChangeRequestV1,
  routedIntent: SpecChangeRequestIntent,
  selectedText: string,
  acceptedAt: string,
): ConsoleCommandInput {
  const commonPayload = {
    projectId: request.projectId,
    workspaceRoot: request.workspaceRoot,
    source: request.source,
    sourcePath: request.source.file,
    selectedText,
    comment: request.comment,
    targetRequirementId: request.targetRequirementId,
    requirementIds: request.targetRequirementId ? [request.targetRequirementId] : [],
    traceability: request.traceability ?? [],
    specChangeRequest: request,
    acceptedAt,
  };
  if (routedIntent === "requirement_intake") {
    return {
      action: "intake_requirement",
      entityType: "project",
      entityId: request.projectId,
      requestedBy: "vscode-extension",
      reason: request.comment,
      payload: {
        ...commonPayload,
        requirementText: request.comment,
        sourcePaths: [request.source.file],
        skillPhase: "requirement_intake",
      },
      now: new Date(acceptedAt),
    };
  }
  if (routedIntent === "generate_ears") {
    return {
      action: "generate_ears",
      entityType: "project",
      entityId: request.projectId,
      requestedBy: "vscode-extension",
      reason: request.comment,
      payload: {
        ...commonPayload,
        sourcePaths: [request.source.file],
      },
      now: new Date(acceptedAt),
    };
  }
  if (routedIntent === "split_feature") {
    return {
      action: "split_feature_specs",
      entityType: "project",
      entityId: request.projectId,
      requestedBy: "vscode-extension",
      reason: request.comment,
      payload: {
        ...commonPayload,
        sourcePaths: [request.source.file],
      },
      now: new Date(acceptedAt),
    };
  }
  if (routedIntent === "clarification") {
    const featureId = request.traceability?.find((item) => /^FEAT-\d+/i.test(item));
    return {
      action: "resolve_clarification",
      entityType: "project",
      entityId: request.projectId,
      requestedBy: "vscode-extension",
      reason: request.comment,
      payload: {
        ...commonPayload,
        featureId,
        sourcePaths: [request.source.file],
        clarificationText: request.comment,
        skillPhase: "resolve_clarification",
      },
      now: new Date(acceptedAt),
    };
  }
  const featureId = request.traceability?.find((item) => /^FEAT-\d+/i.test(item));
  return {
    action: "write_spec_evolution",
    entityType: "spec",
    entityId: request.targetRequirementId ?? request.source.file.replace(/[^A-Za-z0-9_.-]+/g, "-"),
    requestedBy: "vscode-extension",
    reason: request.comment,
    payload: {
      ...commonPayload,
      featureId,
      changeType: routedIntent,
      summary: request.comment,
    },
    now: new Date(acceptedAt),
  };
}

function routeSpecChangeIntent(request: SpecChangeRequestV1): SpecChangeRequestIntent {
  if (request.intent === "requirement_change_or_intake") {
    return request.targetRequirementId ? "spec_evolution" : "requirement_intake";
  }
  if (request.targetRequirementId && request.intent === "requirement_intake") {
    return "spec_evolution";
  }
  return request.intent;
}

function blockedSpecChangeReceipt(
  request: SpecChangeRequestV1,
  input: {
    acceptedAt: string;
    specChangeRequestId: string;
    routedIntent: SpecChangeRequestIntent;
    error: IdeSpecChangeReceipt extends infer T ? T extends { error: infer E } ? E : never : never;
    blockedReasons: string[];
    expectedTextHash?: string;
    currentTextHash?: string;
  },
): IdeSpecChangeReceipt {
  return {
    id: randomUUID(),
    action: "submit_spec_change_request",
    status: "blocked",
    entityType: "spec",
    entityId: request.targetRequirementId ?? request.source.file,
    acceptedAt: input.acceptedAt,
    ideCommandType: "spec_change_request",
    routedIntent: input.routedIntent,
    specChangeRequestId: input.specChangeRequestId,
    error: input.error,
    blockedReasons: input.blockedReasons,
    expectedTextHash: input.expectedTextHash,
    currentTextHash: input.currentTextHash,
  };
}

function readSourceSelection(
  workspaceRoot: string,
  request: SpecChangeRequestV1,
): { ok: true; text: string; textHash: string } | { ok: false; reason: string } {
  const sourcePath = request.source.file.replaceAll("\\", "/");
  if (!sourcePath || sourcePath.startsWith("../") || sourcePath.includes("/../") || isAbsolute(sourcePath)) {
    return { ok: false, reason: `SpecChangeRequest source must stay inside workspace: ${request.source.file}` };
  }
  const fullPath = join(workspaceRoot, sourcePath);
  if (!existsSync(fullPath)) {
    return { ok: false, reason: `SpecChangeRequest source file does not exist: ${request.source.file}` };
  }
  const relativePath = relative(workspaceRoot, fullPath).replaceAll("\\", "/");
  if (relativePath.startsWith("../") || isAbsolute(relativePath)) {
    return { ok: false, reason: `SpecChangeRequest source must stay inside workspace: ${request.source.file}` };
  }
  const content = readFileSync(fullPath, "utf8");
  const lines = content.split(/\r?\n/);
  const startLine = Math.trunc(request.source.range.startLine);
  const endLine = Math.trunc(request.source.range.endLine);
  if (startLine < 0 || endLine < startLine || startLine >= lines.length) {
    return { ok: false, reason: `SpecChangeRequest source range is invalid: ${startLine}-${endLine}` };
  }
  const selected = lines.slice(startLine, Math.min(endLine, lines.length - 1) + 1);
  if (selected.length === 1) {
    const startCharacter = numberOrZero(request.source.range.startCharacter);
    const endCharacter = typeof request.source.range.endCharacter === "number"
      ? Math.max(startCharacter, Math.trunc(request.source.range.endCharacter))
      : selected[0].length;
    selected[0] = selected[0].slice(startCharacter, endCharacter);
  } else {
    if (typeof request.source.range.startCharacter === "number") {
      selected[0] = selected[0].slice(Math.trunc(request.source.range.startCharacter));
    }
    if (typeof request.source.range.endCharacter === "number") {
      selected[selected.length - 1] = selected[selected.length - 1].slice(0, Math.trunc(request.source.range.endCharacter));
    }
  }
  const text = selected.join("\n");
  return { ok: true, text, textHash: hashSpecSourceText(text) };
}

function isSpecChangeRequestIntent(value: unknown): value is SpecChangeRequestIntent {
  return value === "clarification"
    || value === "requirement_intake"
    || value === "requirement_change_or_intake"
    || value === "spec_evolution"
    || value === "generate_ears"
    || value === "update_design"
    || value === "split_feature";
}

function isIdeQueueAction(value: unknown): value is IdeQueueAction {
  return value === "enqueue"
    || value === "run_now"
    || value === "pause"
    || value === "resume"
    || value === "retry"
    || value === "cancel"
    || value === "skip"
    || value === "reprioritize"
    || value === "refresh"
    || value === "approve";
}

function isIdeApprovalDecision(value: unknown): value is IdeApprovalDecision {
  return value === "accept" || value === "acceptForSession" || value === "decline" || value === "cancel";
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" ? Math.max(0, Math.trunc(value)) : 0;
}

function nonNegativeNumberOrZero(value: unknown): number {
  const numberValue = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number(value)
      : NaN;
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, (match) => `\\${match}`);
}

function detectSpecRoot(workspaceRoot: string): string | undefined {
  if (hasRootSpec(workspaceRoot)) return "docs";
  if (!hasMultilingualSpecSupport(workspaceRoot)) return undefined;
  for (const language of preferredSpecLanguages(workspaceRoot)) {
    const root = join(workspaceRoot, "docs", language);
    if (existsSync(join(root, "PRD.md")) || existsSync(join(root, "requirements.md")) || existsSync(join(root, "hld.md"))) {
      return `docs/${language}`;
    }
  }
  return undefined;
}

function hasMultilingualSpecSupport(workspaceRoot: string): boolean {
  const docsReadme = join(workspaceRoot, "docs", "README.md");
  if (existsSync(docsReadme)) {
    const content = readFileSafe(docsReadme).toLowerCase();
    if (content.includes("default language") || content.includes("languages:") || content.includes("multilingual")) {
      return true;
    }
  }
  return ["en", "zh-CN", "ja"].filter((language) => {
    const root = join(workspaceRoot, "docs", language);
    return existsSync(join(root, "PRD.md")) || existsSync(join(root, "requirements.md")) || existsSync(join(root, "hld.md"));
  }).length > 1;
}

function preferredSpecLanguages(workspaceRoot: string): string[] {
  const docsReadme = join(workspaceRoot, "docs", "README.md");
  if (existsSync(docsReadme)) {
    const content = readFileSafe(docsReadme).toLowerCase();
    if (content.includes("default language: english")) return ["en", "zh-CN", "ja"];
    if (content.includes("default language: 中文") || content.includes("default language: chinese")) return ["zh-CN", "en", "ja"];
    if (content.includes("default language: japanese") || content.includes("default language: 日本")) return ["ja", "en", "zh-CN"];
  }
  return ["en", "zh-CN", "ja"];
}

function hasRootSpec(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, "docs", "PRD.md"))
    || existsSync(join(workspaceRoot, "docs", "requirements.md"))
    || existsSync(join(workspaceRoot, "docs", "hld.md"));
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function buildTopLevelDocuments(workspaceRoot: string, specRoot?: string): SpecDriveIdeDocument[] {
  const root = specRoot ?? "docs";
  const docs = [
    document("prd", "PRD", `${root}/PRD.md`, workspaceRoot),
    document("requirements", "EARS Requirements", `${root}/requirements.md`, workspaceRoot),
    document("hld", "HLD", `${root}/hld.md`, workspaceRoot),
    document("ui-spec", "UI Spec", "docs/ui/ui-spec.md", workspaceRoot),
    document("feature-index", "Feature Spec Index", "docs/features/README.md", workspaceRoot),
    document("queue", "Feature Pool Queue", "docs/features/feature-pool-queue.json", workspaceRoot),
  ] satisfies SpecDriveIdeDocument[];
  return docs;
}

function buildProjectInitialization(
  dbPath: string,
  input: { project?: ProjectRow; projectId?: string; workspaceRoot?: string },
): SpecDriveIdeView["projectInitialization"] {
  const workspaceRoot = input.workspaceRoot ? resolve(input.workspaceRoot) : undefined;
  const projectId = input.projectId;
  const existingWorkspace = Boolean(workspaceRoot && existsSync(workspaceRoot));
  const result = projectId ? runSqlite(dbPath, [], [
    {
      name: "repositoryConnections",
      sql: "SELECT * FROM repository_connections WHERE project_id = ? ORDER BY connected_at DESC LIMIT 1",
      params: [projectId],
    },
    {
      name: "constitutions",
      sql: "SELECT * FROM project_constitutions WHERE project_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1",
      params: [projectId],
    },
    {
      name: "memoryVersions",
      sql: "SELECT * FROM memory_version_records WHERE content LIKE ? ORDER BY created_at DESC LIMIT 1",
      params: [`%${escapeLike(projectId)}%`],
    },
    {
      name: "healthChecks",
      sql: "SELECT * FROM project_health_checks WHERE project_id = ? ORDER BY checked_at DESC LIMIT 1",
      params: [projectId],
    },
  ]) : { queries: { repositoryConnections: [], constitutions: [], memoryVersions: [], healthChecks: [] } };

  const repositoryConnection = result.queries.repositoryConnections[0];
  const constitution = result.queries.constitutions[0];
  const memoryVersion = result.queries.memoryVersions[0];
  const healthCheck = result.queries.healthChecks[0];
  const repositoryPath = optionalString(repositoryConnection?.local_path) ?? optionalString(input.project?.target_repo_path) ?? workspaceRoot;
  const hasGitRepository = Boolean(repositoryConnection || (repositoryPath && existsSync(join(repositoryPath, ".git"))));
  const hasSpecProtocol = Boolean(repositoryPath && existsSync(join(repositoryPath, ".autobuild")));
  const hasSkillRuntime = Boolean(repositoryPath && existsSync(join(repositoryPath, ".agents/skills")));
  const hasConstitution = Boolean(constitution);
  const hasProjectMemory = Boolean(memoryVersion || (repositoryPath && existsSync(join(repositoryPath, ".autobuild/memory/project.md"))));
  const healthStatus = optionalString(healthCheck?.status);
  const healthReady = healthStatus === "ready";
  const healthBlocked = healthStatus === "blocked" || healthStatus === "failed";
  const healthReasons = parseJsonArray(healthCheck?.reasons_json).map(String);
  const healthReason = healthReasons.length > 0 ? healthReasons.join(", ") : undefined;
  const steps: SpecDriveIdeInitializationStep[] = [
    {
      key: "create_or_import_project",
      label: "Project created or imported",
      status: input.project?.id ? "Ready" : existingWorkspace ? "Draft" : "Blocked",
      updatedAt: optionalString(input.project?.updated_at) ?? optionalString(input.project?.created_at),
      blockedReason: input.project?.id ? undefined : "Create or import this workspace as a SpecDrive project.",
    },
    {
      key: "workspace_root_resolved",
      label: "Workspace root resolved",
      status: existingWorkspace ? "Ready" : "Blocked",
      blockedReason: existingWorkspace ? undefined : "Open a readable workspace folder.",
    },
    {
      key: "connect_git_repository",
      label: "Git repository connected",
      status: hasGitRepository ? "Ready" : existingWorkspace ? "Draft" : "Blocked",
      updatedAt: optionalString(repositoryConnection?.connected_at),
      blockedReason: hasGitRepository ? undefined : "Connect or initialize a local Git repository for this project.",
    },
    {
      key: "initialize_spec_protocol",
      label: ".autobuild / Spec Protocol",
      status: hasSpecProtocol ? "Ready" : existingWorkspace ? "Draft" : "Blocked",
      blockedReason: hasSpecProtocol ? undefined : "Initialize .autobuild / Spec Protocol for this workspace.",
    },
    {
      key: "copy_skill_runtime",
      label: ".agents skill runtime initialized",
      status: hasSkillRuntime ? "Ready" : existingWorkspace ? "Draft" : "Blocked",
      blockedReason: hasSkillRuntime ? undefined : "Copy project-local .agents skills for governed SpecDrive workflows.",
    },
    {
      key: "import_or_create_constitution",
      label: "Project constitution",
      status: hasConstitution ? "Ready" : existingWorkspace ? "Draft" : "Blocked",
      updatedAt: optionalString(constitution?.created_at),
      blockedReason: hasConstitution ? undefined : "Import or create the project constitution.",
    },
    {
      key: "initialize_project_memory",
      label: "Project Memory",
      status: hasProjectMemory ? "Ready" : existingWorkspace ? "Draft" : "Blocked",
      updatedAt: optionalString(memoryVersion?.created_at),
      blockedReason: hasProjectMemory ? undefined : "Initialize Project Memory for this workspace.",
    },
    {
      key: "check_project_health",
      label: "Workspace health check",
      status: healthReady ? "Ready" : healthBlocked ? "Active" : existingWorkspace ? "Draft" : "Blocked",
      updatedAt: optionalString(healthCheck?.checked_at),
      blockedReason: healthReady ? undefined : healthReason ?? "Run the project health check.",
    },
    {
      key: "current_project_context",
      label: "Current project context",
      status: input.project?.id && existingWorkspace ? "Ready" : existingWorkspace ? "Draft" : "Blocked",
      blockedReason: input.project?.id && existingWorkspace ? undefined : "Register the current workspace before continuing.",
    },
  ];
  const blockingKeys = new Set<SpecDriveIdeInitializationStep["key"]>([
    "create_or_import_project",
    "workspace_root_resolved",
    "connect_git_repository",
    "initialize_spec_protocol",
    "copy_skill_runtime",
    "current_project_context",
  ]);
  const blocked = steps
    .filter((step) => blockingKeys.has(step.key))
    .some((step) => step.status === "Blocked");
  const ready = steps
    .filter((step) => blockingKeys.has(step.key))
    .every((step) => step.status === "Ready");
  return { ready, blocked, steps };
}

function buildFeatureNodes(dbPath: string, workspaceRoot: string, projectId?: string): SpecDriveIdeFeatureNode[] {
  const featureRoot = join(workspaceRoot, "docs/features");
  if (!existsSync(featureRoot)) return [];
  const queuePlan = readFeatureQueuePlan(workspaceRoot);
  const queueById = new Map((queuePlan.features ?? []).map((entry) => [entry.id, entry]));
  const indexEntries = readFeatureIndex(workspaceRoot);
  const indexById = new Map(indexEntries.map((entry) => [entry.id, entry]));
  const folders = new Set(readdirSync(featureRoot)
    .filter((entry) => statSync(join(featureRoot, entry)).isDirectory())
    .sort());
  const latestExecutions = readLatestExecutionsByFeature(dbPath, projectId);
  const indexedEntries = Array.from(indexById.values());

  return indexedEntries
    .map((indexEntry) => {
      const featureId = indexEntry.id;
      const folder = resolveFeatureFolder(featureId, indexEntry.folder, folders);
      const state = readJson(join(featureRoot, folder, "spec-state.json"));
      const queueEntry = queueById.get(featureId);
      const latestExecution = latestExecutions.get(featureId);
      const indexed = indexById.has(featureId);
      const folderExists = folders.has(folder);
      const baseBlockedReasons = stringArray(state.blockedReasons);
      const taskProjection = folderExists ? readFeatureTasks(workspaceRoot, folder) : {
        tasks: [],
        blockedReasons: [`Feature index references missing folder: docs/features/${folder}`],
      };
      const documents = [
        document("feature-requirements", "requirements.md", `docs/features/${folder}/requirements.md`, workspaceRoot),
        document("feature-design", "design.md", `docs/features/${folder}/design.md`, workspaceRoot),
        document("feature-tasks", "tasks.md", `docs/features/${folder}/tasks.md`, workspaceRoot),
        document("spec-state", "spec-state.json", `docs/features/${folder}/spec-state.json`, workspaceRoot),
      ];
      const syncBlockedReasons = [
        ...baseBlockedReasons,
        ...(indexed ? [] : [`Feature index is missing an entry for ${featureId} (${folder}).`]),
        ...(folderExists ? [] : [`Feature folder is missing for indexed Feature ${featureId}: docs/features/${folder}.`]),
        ...taskProjection.blockedReasons,
      ];
      const status = resolveFeatureNodeStatus(optionalString(state.status), indexEntry?.status, documents, taskProjection);
      const stateCurrentJob = isRecord(state.currentJob) ? state.currentJob : undefined;
      const executionClearedBySpecState = Object.prototype.hasOwnProperty.call(state, "currentJob") && state.currentJob === null;
      const stateExecutionId = optionalString(stateCurrentJob?.executionId);
      const completedFeature = isCompletedFeatureStatus(status);
      const latestExecutionForProjection = completedFeature
        ? latestExecution?.latestCompleted ?? latestExecution?.latest
        : executionClearedBySpecState && latestExecution?.latest?.status === "completed"
          ? undefined
          : latestExecution?.latest;
      const latestExecutionStatus = isCompletedFeatureStatus(status)
        ? "completed"
        : latestExecutionForProjection?.status;
      const latestExecutionId = completedFeature
        ? stateExecutionId ?? latestExecutionForProjection?.executionId
        : latestExecutionForProjection?.executionId;
      const tokenConsumption = latestExecutionForProjection?.tokenConsumption;
      return {
        id: featureId,
        folder,
        title: optionalString(state.title) ?? indexEntry?.title ?? titleFromFolder(folder),
        status,
        priority: optionalString(queueEntry?.priority),
        dependencies: stringArray(state.dependencies).length > 0
          ? stringArray(state.dependencies)
          : indexEntry?.dependencies?.length
            ? indexEntry.dependencies
            : stringArray(queueEntry?.dependencies),
        blockedReasons: syncBlockedReasons,
        nextAction: optionalString(state.nextAction),
        latestExecutionId,
        latestExecutionStatus,
        tokenConsumption,
        indexStatus: indexed ? folderExists ? "indexed" : "missing_folder" : "missing_from_index",
        tasks: taskProjection.tasks,
        taskParseBlockedReasons: taskProjection.blockedReasons,
        documents,
      };
    });
}

function isCompletedFeatureStatus(status: string): boolean {
  const normalized = status.toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
  return normalized === "done" || normalized === "completed" || normalized === "delivered";
}

function resolveFeatureNodeStatus(
  stateStatus: string | undefined,
  indexStatus: string | undefined,
  documents: SpecDriveIdeDocument[],
  taskProjection: { tasks: SpecDriveIdeTaskProjection[]; blockedReasons: string[] },
): string {
  if (stateStatus) return stateStatus;
  const docsStatus = featureNodeStatusFromDocuments(documents, taskProjection);
  if (!indexStatus) return docsStatus;
  const normalizedIndexStatus = indexStatus.toLowerCase();
  if (["draft", "planned"].includes(normalizedIndexStatus) && docsStatus !== "draft") return docsStatus;
  if (normalizedIndexStatus === "planning" && docsStatus === "ready") return docsStatus;
  return indexStatus;
}

function featureNodeStatusFromDocuments(
  documents: SpecDriveIdeDocument[],
  taskProjection: { tasks: SpecDriveIdeTaskProjection[]; blockedReasons: string[] },
): string {
  const exists = (kind: SpecDriveIdeDocument["kind"]) => documents.some((entry) => entry.kind === kind && entry.exists);
  if (exists("feature-requirements") && exists("feature-design") && exists("feature-tasks") && taskProjection.blockedReasons.length === 0) {
    return "ready";
  }
  if (exists("feature-requirements") && exists("feature-design")) return "planning";
  return "draft";
}

function readFeatureQueuePlan(workspaceRoot: string): FeatureQueuePlan {
  return readJson(join(workspaceRoot, "docs/features/feature-pool-queue.json")) as FeatureQueuePlan;
}

function readFeatureIndex(workspaceRoot: string): FeatureIndexEntry[] {
  const indexPath = join(workspaceRoot, "docs/features/README.md");
  if (!existsSync(indexPath)) return [];
  const content = readFileSync(indexPath, "utf8");
  const entries: FeatureIndexEntry[] = [];
  let header: string[] | undefined;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith("|") || line.includes("---")) continue;
    const columns = line.split("|").slice(1, -1).map((column) => column.trim());
    if (/Feature ID/i.test(line)) {
      header = columns.map((column) => column.toLowerCase());
      continue;
    }
    if (columns.length < 3) continue;
    const id = columns[0]?.match(/\bFEAT-\d+\b/i)?.[0]?.toUpperCase();
    if (!id) continue;
    const folderColumn = columnByHeader(columns, header, "folder");
    const statusColumn = columnByHeader(columns, header, "status") ?? columns[3];
    const titleColumn = columnByHeader(columns, header, "feature")
      ?? columnByHeader(columns, header, "name")
      ?? columns[1];
    const requirementsColumn = columnByHeader(columns, header, "primary requirements");
    const milestoneColumn = columnByHeader(columns, header, "suggested milestone")
      ?? columnByHeader(columns, header, "milestone");
    const dependenciesColumn = columnByHeader(columns, header, "dependencies");
    const folder = folderColumn?.match(/`([^`]+)`/)?.[1] ?? folderColumn;
    entries.push({
      id,
      title: titleColumn,
      folder: folder && folder !== "-" ? folder : undefined,
      status: statusColumn && statusColumn !== "-" ? statusColumn : undefined,
      primaryRequirements: splitChineseList(requirementsColumn),
      milestone: milestoneColumn && milestoneColumn !== "-" ? milestoneColumn : undefined,
      dependencies: splitChineseList(dependenciesColumn),
    });
  }
  return entries;
}

function columnByHeader(columns: string[], header: string[] | undefined, name: string): string | undefined {
  const index = header?.findIndex((column) => column === name);
  return index !== undefined && index >= 0 ? columns[index] : undefined;
}

function resolveFeatureFolder(featureId: string, indexedFolder: string | undefined, folders: Set<string>): string {
  if (indexedFolder) return indexedFolder;
  if (folders.has(featureId)) return featureId;
  const lowercaseId = featureId.toLowerCase();
  if (folders.has(lowercaseId)) return lowercaseId;
  const matchingFolder = Array.from(folders).find((folder) => folder.toLowerCase().startsWith(lowercaseId));
  return matchingFolder ?? lowercaseId;
}

function readFeatureTasks(workspaceRoot: string, folder: string): { tasks: SpecDriveIdeTaskProjection[]; blockedReasons: string[] } {
  const tasksPath = join(workspaceRoot, "docs/features", folder, "tasks.md");
  if (!existsSync(tasksPath)) return {
    tasks: [],
    blockedReasons: [`Feature tasks file is missing: docs/features/${folder}/tasks.md`],
  };
  const content = readFileSync(tasksPath, "utf8");
  const tasks = parseFeatureTasksMarkdown(content);
  return {
    tasks,
    blockedReasons: tasks.length > 0 ? [] : [`Feature tasks file has no parseable tasks: docs/features/${folder}/tasks.md`],
  };
}

export function parseFeatureTasksMarkdown(content: string): SpecDriveIdeTaskProjection[] {
  const lines = content.split(/\r?\n/);
  const tasks: SpecDriveIdeTaskProjection[] = [];
  let current: SpecDriveIdeTaskProjection | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = line.match(/^#{2,4}\s+(?:\[(?<checkbox>[ xX])\]\s*)?(?<id>T(?:ASK)?-[A-Z0-9-]+|TASK-\d+|T\d+)\s*:?\s*(?<title>.*)$/);
    const listMatch = line.match(/^\s*[-*]\s+(?:\[(?<checkbox>[ xX])\]\s*)?(?<id>T(?:ASK)?-[A-Z0-9-]+|TASK-\d+|T\d+)\s*:?\s*(?<title>.*)$/);
    const plainMatch = line.match(/^(?<id>TASK-[A-Z0-9-]+|TASK-\d+|T\d+)\s*:?\s*(?<title>.*)$/);
    const match = headingMatch ?? listMatch ?? plainMatch;
    if (match?.groups?.id) {
      current = {
        id: normalizeTaskId(match.groups.id),
        title: cleanTaskTitle(match.groups.title),
        status: statusFromTaskLine(line, match.groups.checkbox),
        line: index,
      };
      tasks.push(current);
      continue;
    }
    if (!current) continue;
    const status = line.match(/^\s*状态\s*[:：]\s*(.+)$/)?.[1] ?? line.match(/^\s*Status\s*[:：]\s*(.+)$/i)?.[1];
    if (status) {
      current.status = status.trim();
      continue;
    }
    const description = line.match(/^\s*描述\s*[:：]\s*(.+)$/)?.[1] ?? line.match(/^\s*Description\s*[:：]\s*(.+)$/i)?.[1];
    if (description) {
      current.description = description.trim();
      continue;
    }
    const verification = line.match(/^\s*验证\s*[:：]\s*(.+)$/)?.[1] ?? line.match(/^\s*Verification\s*[:：]\s*(.+)$/i)?.[1];
    if (verification) {
      current.verification = verification.trim();
    }
  }
  return tasks;
}

function readLatestExecutionsByFeature(
  dbPath: string,
  projectId?: string,
): Map<string, { latest?: FeatureExecutionProjection; latestCompleted?: FeatureExecutionProjection }> {
  const result = runSqlite(dbPath, [], [
    {
      name: "executions",
      sql: `SELECT
          er.id,
          er.status,
          er.context_json,
          tcr.run_id,
          tcr.scheduler_job_id,
          tcr.project_id,
          tcr.feature_id,
          tcr.task_id,
          tcr.operation,
          tcr.model,
          tcr.input_tokens,
          tcr.cached_input_tokens,
          tcr.output_tokens,
          tcr.reasoning_output_tokens,
          tcr.total_tokens,
          tcr.cost_usd,
          tcr.currency,
          tcr.pricing_status,
          tcr.usage_json,
          tcr.pricing_json,
          tcr.source_path,
          tcr.recorded_at
        FROM execution_records er
        LEFT JOIN token_consumption_records tcr ON tcr.run_id = er.id
        ${projectId ? "WHERE er.project_id = ?" : ""}
        ORDER BY unixepoch(replace(substr(COALESCE(er.updated_at, er.completed_at, er.started_at, er.created_at), 1, 19), 'T', ' ')) DESC, er.rowid DESC`,
      params: projectId ? [projectId] : [],
    },
  ]);
  const latest = new Map<string, { latest?: FeatureExecutionProjection; latestCompleted?: FeatureExecutionProjection }>();
  for (const row of result.queries.executions) {
    const context = parseJsonObject(optionalString(row.context_json));
    const featureId = optionalString(context.featureId);
    if (!featureId) continue;
    const existing = latest.get(featureId) ?? {};
    const execution = {
      executionId: String(row.id),
      status: String(row.status),
      tokenConsumption: tokenConsumptionFromRow(row),
    };
    if (!existing.latest) {
      existing.latest = execution;
    }
    if (!existing.latestCompleted && String(row.status) === "completed") {
      existing.latestCompleted = execution;
    }
    latest.set(featureId, existing);
  }
  return latest;
}

type FeatureExecutionProjection = {
  executionId: string;
  status: string;
  tokenConsumption?: SpecDriveIdeTokenConsumption;
};

type QueueExecutionRow = {
  executionId?: string;
  schedulerJobId?: string;
  jobType?: string;
  executorType: string;
  operation: string;
  projectId?: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  payload: Record<string, unknown>;
  status: string;
  bullmqJobId?: string;
};

function findExecutionForQueueCommand(dbPath: string, command: IdeQueueCommandV1): QueueExecutionRow | undefined {
  const result = command.entityType === "job"
    ? runSqlite(dbPath, [], [
      {
        name: "target",
        sql: `SELECT
            er.id AS execution_id,
            sj.id AS scheduler_job_id,
            sj.bullmq_job_id,
            er.executor_type,
            er.operation,
            er.project_id,
            er.context_json,
            er.metadata_json,
            er.status AS execution_status,
            sj.job_type,
            sj.payload_json,
            sj.status AS job_status
          FROM scheduler_job_records sj
          LEFT JOIN execution_records er ON er.scheduler_job_id = sj.id
          WHERE sj.id = ? OR sj.bullmq_job_id = ?
          ORDER BY COALESCE(er.updated_at, sj.updated_at) DESC
          LIMIT 1`,
        params: [command.entityId, command.entityId],
      },
    ])
    : runSqlite(dbPath, [], [
      {
        name: "target",
        sql: `SELECT
            er.id AS execution_id,
            er.scheduler_job_id,
            sj.bullmq_job_id,
            er.executor_type,
            er.operation,
            er.project_id,
            er.context_json,
            er.metadata_json,
            er.status AS execution_status,
            sj.job_type,
            sj.payload_json,
            sj.status AS job_status
          FROM execution_records er
          LEFT JOIN scheduler_job_records sj ON sj.id = er.scheduler_job_id
          WHERE er.id = ?
          ORDER BY er.updated_at DESC
          LIMIT 1`,
        params: [command.entityId],
      },
    ]);
  const row = result.queries.target[0];
  if (!row) return undefined;
  const payload = parseJsonObject(optionalString(row.payload_json));
  const payloadContext = isRecord(payload.context) ? payload.context : parseJsonObject(optionalString(payload.context));
  return {
    executionId: optionalString(row.execution_id),
    schedulerJobId: optionalString(row.scheduler_job_id),
    bullmqJobId: optionalString(row.bullmq_job_id),
    jobType: optionalString(row.job_type),
    executorType: optionalString(row.executor_type) ?? "cli",
    operation: optionalString(row.operation) ?? optionalString(payload.operation) ?? optionalString(payload.requestedAction) ?? "feature_execution",
    projectId: optionalString(row.project_id) ?? optionalString(payload.projectId) ?? optionalString(payloadContext.projectId),
    context: {
      ...payloadContext,
      ...parseJsonObject(optionalString(row.context_json)),
    },
    metadata: parseJsonObject(optionalString(row.metadata_json)),
    payload,
    status: optionalString(row.execution_status) ?? optionalString(row.job_status) ?? "unknown",
  };
}

function requeueExistingQueueTarget(
  dbPath: string,
  target: QueueExecutionRow,
  command: IdeQueueCommandV1,
  acceptedAt: string,
  scheduler?: SchedulerClient,
): { schedulerJobId?: string; executionId?: string; blockedReasons: string[] } {
  if (target.status === "running") {
    return { schedulerJobId: target.schedulerJobId, executionId: target.executionId, blockedReasons: [] };
  }
  if (!target.schedulerJobId || !target.bullmqJobId) {
    return { blockedReasons: [`Run Now requires an existing scheduler job: ${command.entityId}`] };
  }
  if (!isReplayableSchedulerJobType(target.jobType)) {
    return { blockedReasons: [`Run Now does not support scheduler job type: ${target.jobType ?? "unknown"}`] };
  }
  if (!scheduler?.requeueExistingJob) {
    return { blockedReasons: ["Scheduler is required to run an existing queued job now."] };
  }

  const commandPayload = parseJsonObject(command.payload);
  const payload = {
    ...target.payload,
    ...commandPayload,
  };
  const payloadContext = isRecord(payload.context) ? payload.context : parseJsonObject(optionalString(payload.context));
  const executionId = target.executionId ?? optionalString(payload.executionId) ?? randomUUID();
  const executionPreference = executionPreferenceFromQueueRow(target);
  const projectId = command.projectId
    ?? target.projectId
    ?? optionalString(payload.projectId)
    ?? optionalString(payloadContext.projectId);
  const context = {
    ...payloadContext,
    ...target.context,
    ...(command.workspaceRoot ? { workspaceRoot: command.workspaceRoot } : {}),
    ...(executionPreference ? { executionPreference } : {}),
    runNowReason: command.reason,
    runNowAt: acceptedAt,
  };
  const runPayload: ExecutorRunJobPayload = {
    ...payload,
    executionId,
    operation: optionalString(payload.operation) ?? target.operation,
    projectId,
    context,
    requestedAction: optionalString(payload.requestedAction) ?? optionalString(context.skillPhase) ?? target.operation,
    ...(executionPreference ? { executionPreference: executionPreference as ExecutorRunJobPayload["executionPreference"] } : {}),
  };
  runSqlite(dbPath, [
    {
      sql: "UPDATE scheduler_job_records SET status = 'queued', payload_json = ?, error = NULL, updated_at = ? WHERE id = ?",
      params: [JSON.stringify(runPayload), acceptedAt, target.schedulerJobId],
    },
  ]);
  if (!target.executionId) {
    persistQueuedExecution(dbPath, {
      executionId,
      schedulerJobId: target.schedulerJobId,
      executorType: executorTypeForSchedulerJob(target.jobType),
      operation: runPayload.operation,
      projectId,
      context,
      metadata: {
        ...target.metadata,
        runNowReason: command.reason,
        runNowAt: acceptedAt,
        scheduler: "bullmq",
        jobType: target.jobType,
      },
      acceptedAt,
      summary: "Run Now queued from VSCode IDE.",
    });
  } else {
    runSqlite(dbPath, [
      {
        sql: "UPDATE execution_records SET status = 'queued', metadata_json = ?, updated_at = ? WHERE id = ?",
        params: [
          JSON.stringify({ ...target.metadata, runNowReason: command.reason, runNowAt: acceptedAt }),
          acceptedAt,
          target.executionId,
        ],
      },
    ]);
  }
  scheduler.requeueExistingJob({
    schedulerJobId: target.schedulerJobId,
    bullmqJobId: target.bullmqJobId,
    jobType: target.jobType,
    payload: runPayload,
  });
  updateQueueTargetSpecState(dbPath, { ...target, executionId, payload: runPayload, context, status: "queued" }, "queued", acceptedAt, {
    runNowReason: command.reason,
  }, command.workspaceRoot);
  return { schedulerJobId: target.schedulerJobId, executionId, blockedReasons: [] };
}

function isReplayableSchedulerJobType(value?: string): value is Exclude<SchedulerJobType, "native.run"> {
  return value === "cli.run" || value === "rpc.run" || value === "codex.rpc.run" || value === "codex.app_server.run";
}

function executorTypeForSchedulerJob(jobType?: string): string {
  return jobType === "rpc.run" || jobType === "codex.rpc.run" || jobType === "codex.app_server.run" ? "rpc" : "cli";
}

function queueScheduleCommand(command: IdeQueueCommandV1, acceptedAt: string, target: QueueExecutionRow): ConsoleCommandInput {
  const payload = {
    ...target.payload,
    ...parseJsonObject(command.payload),
  };
  const payloadContext = isRecord(payload.context) ? payload.context : parseJsonObject(optionalString(payload.context));
  const projectId = command.projectId ?? target.projectId ?? optionalString(payload.projectId) ?? optionalString(payloadContext.projectId);
  const featureId = optionalString(target.context.featureId) ?? optionalString(payload.featureId) ?? optionalString(payloadContext.featureId);
  const taskId = optionalString(target.context.taskId) ?? optionalString(payload.taskId) ?? optionalString(payloadContext.taskId);
  const entityType = taskId ? "task" : featureId ? "feature" : "project";
  const entityId = taskId ?? featureId ?? projectId ?? command.entityId;
  return {
    action: "schedule_run",
    entityType,
    entityId,
    requestedBy: command.requestedBy ?? "vscode-extension",
    reason: command.reason,
    payload: {
      ...payload,
      projectId,
      featureId,
      taskId,
      mode: command.queueAction === "run_now" ? "manual" : optionalString(payload.mode) ?? "manual",
      requestedFor: command.queueAction === "run_now" ? acceptedAt : optionalString(payload.requestedFor),
      operation: optionalString(payload.operation) ?? target.operation,
      requestedAction: optionalString(payload.requestedAction) ?? target.operation,
      workspaceRoot: command.workspaceRoot ?? optionalString(payload.workspaceRoot),
      ideQueueAction: command.queueAction,
      sourceSchedulerJobId: target.schedulerJobId ?? command.entityId,
      sourceExecutionId: target.executionId,
    },
    now: new Date(acceptedAt),
  };
}

function executionPreferenceFromQueueRow(row: QueueExecutionRow): Record<string, unknown> | undefined {
  const candidates = [
    row.context.executionPreference,
    row.metadata.executionPreference,
    row.payload.executionPreference,
  ];
  for (const candidate of candidates) {
    if (isRecord(candidate)) return candidate;
  }
  if (row.jobType === "rpc.run" || row.executorType === "rpc" || row.executorType === "codex.rpc" || row.executorType === "gemini.acp") {
    const adapterId = optionalString(row.metadata.adapterId)
      ?? optionalString(isRecord(row.metadata.adapterConfig) ? row.metadata.adapterConfig.id : undefined);
    return adapterId ? { runMode: "rpc", adapterId, source: "job" } : undefined;
  }
  const adapterId = optionalString(row.metadata.adapterId);
  return adapterId ? { runMode: "cli", adapterId, source: "job" } : undefined;
}

function retryPayload(previous: QueueExecutionRow, command: IdeQueueCommandV1, acceptedAt: string) {
  if (!previous.executionId) {
    throw new Error("Retry requires an execution record.");
  }
  const context = {
    ...previous.context,
    executionPreference: executionPreferenceFromQueueRow(previous),
    previousExecutionId: previous.executionId,
    retryReason: command.reason,
    retriedAt: acceptedAt,
  };
  return {
    executionId: randomUUID(),
    operation: previous.operation,
    projectId: command.projectId ?? previous.projectId,
    context,
    executionPreference: executionPreferenceFromQueueRow(previous),
    requestedAction: optionalString(previous.payload.requestedAction) ?? optionalString(previous.context.skillPhase) ?? previous.operation,
  };
}

function persistQueuedExecution(dbPath: string, input: {
  executionId: string;
  schedulerJobId: string;
  executorType: string;
  operation: string;
  projectId?: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  acceptedAt: string;
  summary?: string;
}): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO execution_records (
          id, scheduler_job_id, executor_type, operation, project_id, context_json,
          status, started_at, summary, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.executionId,
        input.schedulerJobId,
        input.executorType,
        input.operation,
        input.projectId ?? null,
        JSON.stringify(input.context),
        "queued",
        null,
        input.summary ?? "Retry queued from VSCode IDE.",
        JSON.stringify(input.metadata),
        input.acceptedAt,
        input.acceptedAt,
      ],
    },
  ]);
}

function updateQueueTarget(
  dbPath: string,
  target: QueueExecutionRow,
  status: string,
  acceptedAt: string,
  metadataPatch: Record<string, unknown>,
  workspaceRoot?: string,
): void {
  const metadata = { ...target.metadata };
  for (const [key, value] of Object.entries(metadataPatch)) {
    if (value === undefined) delete metadata[key];
    else metadata[key] = value;
  }
  runSqlite(dbPath, [
    ...(target.schedulerJobId ? [{
      sql: "UPDATE scheduler_job_records SET status = ?, updated_at = ? WHERE id = ?",
      params: [status, acceptedAt, target.schedulerJobId],
    }] : []),
    ...(target.executionId ? [{
      sql: "UPDATE execution_records SET status = ?, completed_at = CASE WHEN ? IN ('cancelled', 'skipped') THEN ? ELSE completed_at END, metadata_json = ?, updated_at = ? WHERE id = ?",
      params: [status, status, acceptedAt, JSON.stringify(metadata), acceptedAt, target.executionId],
    }] : []),
  ]);
  updateQueueTargetSpecState(dbPath, target, status, acceptedAt, metadataPatch, workspaceRoot);
}

function updateQueueTargetSpecState(
  dbPath: string,
  target: QueueExecutionRow,
  status: string,
  acceptedAt: string,
  metadataPatch: Record<string, unknown>,
  workspaceRoot?: string,
): void {
  const fileStatus = queueStatusToFileSpecStatus(status);
  const executionStatus = queueStatusToFileSpecExecutionStatus(status);
  if (!fileStatus && !executionStatus) return;
  const root = workspaceRoot
    ?? optionalString(target.context.workspaceRoot)
    ?? optionalString(target.payload.workspaceRoot)
    ?? optionalString(target.metadata.workspaceRoot);
  const featureId = optionalString(target.context.featureId)
    ?? optionalString(target.payload.featureId)
    ?? optionalString(isRecord(target.payload.context) ? target.payload.context.featureId : undefined);
  if (!root || !featureId) return;
  const folder = featureFolderForQueueTarget(dbPath, root, featureId, target);
  if (!folder) return;
  try {
    const current = readFileSpecState(root, folder, featureId, new Date(acceptedAt));
    const summary = queueStatusSpecStateSummary(status, metadataPatch);
    writeFileSpecState(root, folder, mergeFileSpecState(current, {
      status: fileStatus ?? current.status,
      executionStatus,
      blockedReasons: fileStatus === "blocked" || fileStatus === "failed" ? [summary] : [],
      currentJob: {
        ...current.currentJob,
        schedulerJobId: target.schedulerJobId ?? current.currentJob?.schedulerJobId,
        executionId: target.executionId ?? current.currentJob?.executionId,
        operation: target.operation,
        queuedAt: current.currentJob?.queuedAt ?? optionalString(target.payload.requestedFor),
        startedAt: current.currentJob?.startedAt,
        completedAt: ["cancelled", "skipped", "completed", "failed"].includes(fileStatus) ? acceptedAt : current.currentJob?.completedAt,
      },
      lastResult: ["cancelled", "skipped", "completed", "failed"].includes(fileStatus)
        ? {
            status: fileStatus,
            summary,
            producedArtifacts: current.lastResult?.producedArtifacts ?? [],
            completedAt: acceptedAt,
          }
        : current.lastResult,
      nextAction: queueStatusSpecStateNextAction(fileStatus),
    }, {
      now: new Date(acceptedAt),
      source: "ide.queue_action",
      summary,
      schedulerJobId: target.schedulerJobId,
      executionId: target.executionId,
    }));
  } catch {
    // Queue records remain the runtime facts if the operator-facing file projection cannot be updated.
  }
}

function queueStatusToFileSpecStatus(status: string): FileSpecLifecycleStatus | undefined {
  if (status === "queued" || status === "running" || status === "paused" || status === "cancelled" || status === "skipped") return status;
  if (status === "approval_needed") return "approval_needed";
  if (status === "blocked" || status === "failed" || status === "completed") return status;
  return undefined;
}

function queueStatusToFileSpecExecutionStatus(status: string): FileSpecExecutionStatus | undefined {
  if (status === "queued"
    || status === "running"
    || status === "paused"
    || status === "approval_needed"
    || status === "blocked"
    || status === "cancelled"
    || status === "completed"
    || status === "failed"
    || status === "skipped") return status;
  return undefined;
}

function queueStatusSpecStateSummary(status: string, metadataPatch: Record<string, unknown>): string {
  const reason = optionalString(metadataPatch.cancelReason)
    ?? optionalString(metadataPatch.pausedReason)
    ?? optionalString(metadataPatch.resumedReason)
    ?? optionalString(metadataPatch.skipReason)
    ?? optionalString(metadataPatch.approvalReason);
  return reason ? `Queue ${status}: ${reason}` : `Queue status changed to ${status}.`;
}

function queueStatusSpecStateNextAction(status: FileSpecLifecycleStatus): string {
  if (status === "paused") return "Resume, cancel, or reprioritize this queued Feature from the Execution Workbench.";
  if (status === "cancelled") return "Retry, skip, or reschedule this Feature when ready.";
  if (status === "skipped") return "Review the skipped execution and select the next Feature.";
  if (status === "queued") return "Waiting for Runner to start this Feature.";
  if (status === "running") return "Runner is executing this Feature.";
  if (status === "approval_needed") return "Resolve the pending approval request before autonomous execution can continue.";
  return "Review execution result and choose the next queue action.";
}

function featureFolderForQueueTarget(dbPath: string, workspaceRoot: string, featureId: string, target: QueueExecutionRow): string | undefined {
  const specStatePath = optionalString(target.context.specStatePath) ?? optionalString(target.payload.specStatePath);
  if (specStatePath?.startsWith("docs/features/") && specStatePath.endsWith("/spec-state.json")) {
    return specStatePath.slice("docs/features/".length, -"/spec-state.json".length);
  }
  const featureSpecPath = optionalString(target.context.featureSpecPath) ?? optionalString(target.payload.featureSpecPath);
  if (featureSpecPath?.startsWith("docs/features/")) return featureSpecPath.slice("docs/features/".length);
  const rows = runSqlite(dbPath, [], [
    {
      name: "features",
      sql: "SELECT folder FROM features WHERE id = ? LIMIT 1",
      params: [featureId],
    },
  ]).queries.features;
  const dbFolder = optionalString(rows[0]?.folder);
  if (dbFolder) return dbFolder;
  const featureRoot = join(workspaceRoot, "docs/features");
  if (!existsSync(featureRoot)) return undefined;
  const folders = new Set(readdirSync(featureRoot).filter((entry) => statSync(join(featureRoot, entry)).isDirectory()).sort());
  const indexEntry = readFeatureIndex(workspaceRoot).find((entry) => entry.id === featureId);
  return resolveFeatureFolder(featureId, indexEntry?.folder, folders);
}

function updateQueuePriority(dbPath: string, target: QueueExecutionRow, payload: unknown, acceptedAt: string): void {
  const priority = Number(parseJsonObject(payload).priority ?? parseJsonObject(payload).rank ?? 0);
  const updatedPayload = { ...target.payload, priority, reprioritizedAt: acceptedAt };
  runSqlite(dbPath, [
    ...(target.schedulerJobId ? [{
      sql: "UPDATE scheduler_job_records SET payload_json = ?, updated_at = ? WHERE id = ?",
      params: [JSON.stringify(updatedPayload), acceptedAt, target.schedulerJobId],
    }] : []),
    ...(target.executionId ? [{
      sql: "UPDATE execution_records SET metadata_json = ?, updated_at = ? WHERE id = ?",
      params: [JSON.stringify({ ...target.metadata, priority, reprioritizedAt: acceptedAt }), acceptedAt, target.executionId],
    }] : []),
  ]);
}

async function interruptRunningTurn(
  dbPath: string,
  input: { executionId: string; threadId: string; turnId: string; workspaceRoot?: string },
  override?: SubmitIdeQueueCommandOptions["interruptTurn"],
): Promise<Record<string, unknown>> {
  if (override) return override(input);
  const config = loadAppServerAdapterConfig(dbPath);
  const transport = createCodexAppServerTransportFromConfig(config, input.workspaceRoot ?? process.cwd());
  try {
    return await interruptCodexAppServerTurn(transport, input.threadId, input.turnId);
  } finally {
    await transport.close?.();
  }
}

function loadAppServerAdapterConfig(dbPath: string): CodexAppServerAdapterConfig {
  const result = runSqlite(dbPath, [], [
    { name: "adapter", sql: "SELECT * FROM codex_app_server_adapter_configs WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1" },
    { name: "adapterCount", sql: "SELECT COUNT(*) AS count FROM codex_app_server_adapter_configs" },
  ]);
  const row = result.queries.adapter[0];
  const adapterCount = Number(result.queries.adapterCount[0]?.count ?? 0);
  if (!row && adapterCount > 0) {
    throw new Error("No active Codex RPC adapter configured. Activate an adapter before cancelling a running turn.");
  }
  if (!row) return DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG;
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    executable: String(row.executable),
    args: parseJsonArray(row.args_json).map(String),
    transport: String(row.transport) === "unix" || String(row.transport) === "websocket" ? String(row.transport) as "unix" | "websocket" : "stdio",
    endpoint: optionalString(row.endpoint),
    requestTimeoutMs: Number(row.request_timeout_ms ?? DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG.requestTimeoutMs),
    status: String(row.status) === "disabled" ? "disabled" : "active",
    updatedAt: optionalString(row.updated_at),
  };
}

function buildQueueGroups(dbPath: string, projectId?: string): { groups: Record<string, SpecDriveIdeQueueItem[]> } {
  const projectFilter = projectId
    ? `WHERE (
        er.project_id = ?
        OR (
          er.id IS NULL
          AND (
            json_extract(sj.payload_json, '$.projectId') = ?
            OR json_extract(sj.payload_json, '$.context.projectId') = ?
          )
        )
      )`
    : "";
  const result = runSqlite(dbPath, [], [
    {
      name: "queue",
      sql: `SELECT
          sj.id AS scheduler_job_id,
          sj.job_type,
          sj.status AS job_status,
          sj.updated_at AS job_updated_at,
          er.id AS execution_id,
          er.executor_type,
          er.operation,
          er.status AS execution_status,
          er.summary,
          er.context_json,
          er.metadata_json,
          sj.payload_json,
          er.updated_at AS execution_updated_at
        FROM scheduler_job_records sj
        LEFT JOIN execution_records er ON er.scheduler_job_id = sj.id
        ${projectFilter}
        ORDER BY COALESCE(er.updated_at, sj.updated_at) DESC
        LIMIT 100`,
      params: projectId ? [projectId, projectId, projectId] : [],
    },
  ]);
  const groups: Record<string, SpecDriveIdeQueueItem[]> = {};
  const supersededExecutionIds = new Set<string>();
  for (const row of result.queries.queue) {
    const context = parseJsonObject(optionalString(row.context_json));
    const metadata = parseJsonObject(optionalString(row.metadata_json));
    const payload = parseJsonObject(optionalString(row.payload_json));
    const payloadContext = isRecord(payload.context) ? payload.context : parseJsonObject(optionalString(payload.context));
    const previousExecutionId = optionalString(context.previousExecutionId)
      ?? optionalString(metadata.previousExecutionId)
      ?? optionalString(payloadContext.previousExecutionId);
    if (previousExecutionId) {
      supersededExecutionIds.add(previousExecutionId);
    }
  }
  for (const row of result.queries.queue) {
    const payload = parseJsonObject(optionalString(row.payload_json));
    const context = parseJsonObject(optionalString(row.context_json));
    const payloadContext = isRecord(payload.context) ? payload.context : parseJsonObject(optionalString(payload.context));
    const metadata = parseJsonObject(optionalString(row.metadata_json));
    const status = optionalString(row.execution_status) ?? optionalString(row.job_status) ?? "unknown";
    const executionId = optionalString(row.execution_id);
    if (!executionId && isCompletedScheduleOnlyStatus(status)) continue;
    if (executionId && supersededExecutionIds.has(executionId)) continue;
    const executionPreference = executionPreferenceFromQueueParts(context, metadata, payload, optionalString(row.job_type), optionalString(row.executor_type));
    const item: SpecDriveIdeQueueItem = {
      schedulerJobId: optionalString(row.scheduler_job_id),
      executionId,
      status,
      operation: optionalString(row.operation) ?? optionalString(payload.operation) ?? optionalString(payload.requestedAction),
      jobType: optionalString(row.job_type),
      featureId: optionalString(context.featureId) ?? optionalString(payloadContext.featureId),
      taskId: optionalString(context.taskId) ?? optionalString(payloadContext.taskId),
      adapter: optionalString(metadata.skillSlug)
        ?? optionalString(metadata.adapterId)
        ?? optionalString(executionPreference?.adapterId)
        ?? optionalString(payloadContext.skillSlug),
      runMode: executionPreference?.runMode,
      adapterId: executionPreference?.adapterId,
      preferenceSource: executionPreference?.source,
      threadId: optionalString(metadata.threadId),
      turnId: optionalString(metadata.turnId),
      updatedAt: optionalString(row.execution_updated_at) ?? optionalString(row.job_updated_at),
      summary: optionalString(row.summary),
    };
    groups[status] = [...(groups[status] ?? []), item];
  }
  return { groups };
}

function isCompletedScheduleOnlyStatus(status: string): boolean {
  return ["completed", "cancelled", "skipped"].includes(status);
}

function executionPreferenceFromQueueParts(
  context: Record<string, unknown>,
  metadata: Record<string, unknown>,
  payload: Record<string, unknown>,
  jobType?: string,
  executorType?: string,
): { runMode: "cli" | "rpc"; adapterId?: string; source?: string } | undefined {
  for (const candidate of [context.executionPreference, metadata.executionPreference, payload.executionPreference]) {
    if (isRecord(candidate)) {
      return {
        runMode: optionalString(candidate.runMode) === "rpc" ? "rpc" : "cli",
        adapterId: optionalString(candidate.adapterId),
        source: optionalString(candidate.source),
      };
    }
  }
  const adapterConfig = isRecord(metadata.adapterConfig) ? metadata.adapterConfig : {};
  const adapterId = optionalString(metadata.adapterId) ?? optionalString(adapterConfig.id);
  const runMode = jobType === "rpc.run"
    || executorType === "rpc"
    || executorType === "codex.rpc"
    || executorType === "gemini.acp"
    ? "rpc"
    : jobType === "cli.run" || executorType === "cli"
      ? "cli"
      : undefined;
  return runMode ? { runMode, adapterId, source: adapterId ? "record" : undefined } : undefined;
}

function buildDiagnostics(
  documents: SpecDriveIdeDocument[],
  features: SpecDriveIdeFeatureNode[],
  queueGroups: Record<string, SpecDriveIdeQueueItem[]>,
  workspaceRoot?: string,
): SpecDriveIdeDiagnostic[] {
  const diagnostics: SpecDriveIdeDiagnostic[] = [];
  const fallbackPath = documents.find((document) => document.kind === "feature-index" && document.exists)?.path
    ?? documents.find((document) => document.exists)?.path;
  for (const document of documents) {
    if (!document.exists && fallbackPath) {
      diagnostics.push({
        path: fallbackPath,
        severity: "warning",
        message: `SpecDrive source is missing: ${document.path}`,
        source: "workspace",
      });
    }
  }
  for (const feature of features) {
    const diagnosticPath = firstExistingFeatureDocument(feature)?.path ?? fallbackPath;
    if (!diagnosticPath) continue;
    const missingDocs = feature.documents.filter((document) => !document.exists).map((document) => document.path);
    if (missingDocs.length > 0) {
      diagnostics.push({
        path: diagnosticPath,
        severity: "warning",
        message: `Feature ${feature.id} is missing required Spec files: ${missingDocs.join(", ")}`,
        source: "workspace",
        featureId: feature.id,
      });
    }
    diagnostics.push(...buildFeatureContentDiagnostics(workspaceRoot, feature, diagnosticPath));
    if (feature.blockedReasons.length > 0 || feature.status === "blocked" || feature.status === "failed") {
      diagnostics.push({
        path: diagnosticPath,
        severity: feature.status === "failed" ? "error" : "warning",
        message: feature.blockedReasons.length > 0
          ? `Feature ${feature.id} is ${feature.status}: ${feature.blockedReasons.join("; ")}`
          : `Feature ${feature.id} is ${feature.status}.`,
        source: "spec-state",
        featureId: feature.id,
        executionId: feature.latestExecutionId,
      });
    }
  }
  for (const item of [...(queueGroups.failed ?? []), ...(queueGroups.blocked ?? [])]) {
    const feature = item.featureId ? features.find((entry) => entry.id === item.featureId) : undefined;
    if (feature?.latestExecutionId && item.executionId && feature.latestExecutionId !== item.executionId) continue;
    const path = firstExistingFeatureDocument(feature)?.path ?? fallbackPath;
    if (!path) continue;
    diagnostics.push({
      path,
      severity: item.status === "failed" ? "error" : "warning",
      message: item.summary ?? `Execution ${item.executionId ?? item.schedulerJobId ?? "unknown"} is ${item.status}.`,
      source: "execution",
      featureId: item.featureId,
      executionId: item.executionId,
    });
  }
  return workspaceRoot ? diagnostics : [];
}

function buildFeatureContentDiagnostics(
  workspaceRoot: string | undefined,
  feature: SpecDriveIdeFeatureNode,
  diagnosticPath: string,
): SpecDriveIdeDiagnostic[] {
  if (!workspaceRoot) return [];
  const requirements = feature.documents.find((document) => document.kind === "feature-requirements" && document.exists);
  if (!requirements) return [];
  const content = readFileSync(join(workspaceRoot, requirements.path), "utf8");
  const diagnostics: SpecDriveIdeDiagnostic[] = [];
  if (!/\b(REQ-[A-Z0-9-]+|REQ-\d+|NFR-\d+|EDGE-\d+)\b/.test(content)) {
    diagnostics.push({
      path: diagnosticPath,
      severity: "warning",
      message: `Feature ${feature.id} requirements do not reference a stable requirement id.`,
      source: "workspace",
      featureId: feature.id,
    });
  }
  if (!/(验收标准|Acceptance Criteria|acceptance criteria|Acceptance|验收)/i.test(content)) {
    diagnostics.push({
      path: diagnosticPath,
      severity: "warning",
      message: `Feature ${feature.id} requirements are missing acceptance criteria.`,
      source: "workspace",
      featureId: feature.id,
    });
  }
  return diagnostics;
}

function firstExistingFeatureDocument(feature?: SpecDriveIdeFeatureNode): SpecDriveIdeDocument | undefined {
  return feature?.documents.find((document) => document.exists && document.kind !== "spec-state")
    ?? feature?.documents.find((document) => document.exists);
}

function readActiveAdapter(dbPath: string): SpecDriveIdeView["activeAdapter"] {
  const result = runSqlite(dbPath, [], [
    { name: "adapter", sql: "SELECT id, display_name, status FROM cli_adapter_configs WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1" },
  ]);
  const row = result.queries.adapter[0];
  if (!row) return undefined;
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    status: String(row.status),
  };
}

function readExecutionPreferenceOptions(dbPath: string, projectId?: string): SpecDriveIdeView["executionPreferenceOptions"] {
  const result = runSqlite(dbPath, [], [
    { name: "cli", sql: "SELECT id, display_name, status FROM cli_adapter_configs ORDER BY updated_at DESC" },
    { name: "rpc", sql: "SELECT id, display_name, provider, status FROM rpc_adapter_configs ORDER BY updated_at DESC" },
    ...(projectId ? [{ name: "preference", sql: "SELECT run_mode, adapter_id FROM project_execution_preferences WHERE project_id = ? LIMIT 1", params: [projectId] }] : []),
  ]);
  const cliAdapters = uniqueAdapterOptions([
    { id: "codex-cli", display_name: "Codex CLI", status: "active" },
    { id: "gemini-cli", display_name: "Google Gemini CLI", status: "draft" },
    ...result.queries.cli,
  ]);
  const rpcAdapters = uniqueAdapterOptions([
    { id: "codex-rpc-default", display_name: "Built-in Codex RPC", provider: "codex-rpc", status: "active" },
    { id: "gemini-acp-default", display_name: "Built-in Gemini ACP", provider: "gemini-acp", status: "disabled" },
    ...result.queries.rpc,
  ]);
  const row = result.queries.preference?.[0];
  return {
    active: row
      ? { runMode: String(row.run_mode) === "rpc" ? "rpc" : "cli", adapterId: optionalString(row.adapter_id), source: "project" }
      : { runMode: "cli", adapterId: cliAdapters[0]?.id, source: "default" },
    cliAdapters,
    rpcAdapters,
  };
}

function uniqueAdapterOptions(rows: Record<string, unknown>[]): Array<{ id: string; displayName: string; status: string; provider?: string }> {
  const byId = new Map<string, { id: string; displayName: string; status: string; provider?: string }>();
  for (const row of rows) {
    const id = optionalString(row.id);
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      id,
      displayName: optionalString(row.display_name) ?? id,
      status: optionalString(row.status) ?? "active",
      provider: optionalString(row.provider),
    });
  }
  return [...byId.values()];
}

function document(kind: SpecDriveIdeDocument["kind"], label: string, path: string, workspaceRoot: string): SpecDriveIdeDocument {
  return {
    kind,
    label,
    path,
    exists: existsSync(join(workspaceRoot, path)),
  };
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseJsonObject(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isApprovalRequestEvent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const type = String(value.type ?? value.method ?? "");
  return type === "approval/request"
    || type.endsWith("/approval/request")
    || type === "item/commandExecution/requestApproval"
    || type === "item/fileChange/requestApproval"
    || type === "item/permissions/requestApproval";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function splitChineseList(value: string | undefined): string[] {
  if (!value || value === "-") return [];
  return value
    .replaceAll("`", "")
    .split(/[、,，]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeTaskId(value: string): string {
  return value.toUpperCase();
}

function cleanTaskTitle(value: string | undefined): string {
  return (value ?? "").replace(/^[-:：\s]+/, "").trim() || "Untitled task";
}

function statusFromTaskLine(line: string, checkbox?: string): string {
  const explicit = line.match(/\b状态\s*[:：]\s*([^\s,，;；]+)/)?.[1]
    ?? line.match(/\bStatus\s*[:：]\s*([^\s,，;；]+)/i)?.[1];
  if (explicit) return explicit.trim();
  if (checkbox) return checkbox.toLowerCase() === "x" ? "done" : "todo";
  return "unknown";
}

function titleFromFolder(folder: string): string {
  return basename(folder)
    .replace(/^feat-\d+-/i, "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
