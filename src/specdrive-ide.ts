import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  createCodexAppServerTransportFromConfig,
  DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG,
  interruptCodexAppServerTurn,
  type CodexAppServerAdapterConfig,
} from "./codex-app-server.ts";
import { submitConsoleCommand, type ConsoleCommandInput, type ConsoleCommandReceipt } from "./product-console.ts";
import type { SchedulerClient } from "./scheduler.ts";
import { runSqlite } from "./sqlite.ts";

export type SpecDriveIdeDocument = {
  kind: "prd" | "requirements" | "hld" | "feature-index" | "feature-requirements" | "feature-design" | "feature-tasks" | "spec-state" | "queue";
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
  threadId?: string;
  turnId?: string;
  updatedAt?: string;
  summary?: string;
};

export type SpecDriveIdeExecutionDetail = SpecDriveIdeQueueItem & {
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  rawLogs: Array<{ stdout: string; stderr: string; events: unknown[]; createdAt?: string }>;
  producedArtifacts: unknown[];
  executionResults: Array<{ id: string; kind: string; path?: string; summary?: string; metadata: Record<string, unknown>; createdAt?: string }>;
  diffSummary?: unknown;
  contractValidation?: unknown;
  outputSchema?: unknown;
  approvalRequests: unknown[];
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
};

type FeatureQueueEntry = {
  id: string;
  priority?: string;
  dependencies?: string[];
};

type FeatureQueuePlan = {
  features?: FeatureQueueEntry[];
};

export function buildSpecDriveIdeView(dbPath: string, options: BuildSpecDriveIdeViewOptions = {}): SpecDriveIdeView {
  const project = resolveProject(dbPath, options);
  const workspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : optionalString(project?.target_repo_path);
  const projectId = options.projectId ?? optionalString(project?.id);
  const language = workspaceRoot ? detectSpecLanguage(workspaceRoot) : undefined;
  const specRoot = workspaceRoot && language ? `docs/${language}` : workspaceRoot && hasRootSpec(workspaceRoot) ? "docs" : undefined;
  const documents = workspaceRoot ? buildTopLevelDocuments(workspaceRoot, specRoot) : [];
  const features = workspaceRoot ? buildFeatureNodes(dbPath, workspaceRoot, projectId) : [];
  const queue = buildQueueGroups(dbPath, projectId);
  const activeAdapter = readActiveAdapter(dbPath);
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
  const resultDiff = executionResults.map((entry) => entry.metadata.diff ?? entry.metadata.diffSummary).find((entry) => entry !== undefined);
  const approvalRequests = rawLogs
    .flatMap((log) => log.events)
    .filter((event) => isApprovalRequestEvent(event));
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
    producedArtifacts: metadataArtifacts.length > 0 ? metadataArtifacts : resultArtifacts,
    executionResults,
    diffSummary: metadata.diffSummary ?? metadata.diff ?? resultDiff,
    contractValidation: metadata.contractValidation,
    outputSchema: metadata.outputSchema,
    approvalRequests: approvalRequests.length > 0 ? approvalRequests : eventRefs.filter(isApprovalRequestEvent),
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
    const receipt = submitConsoleCommand(dbPath, queueScheduleCommand(command, acceptedAt), { scheduler: options.scheduler });
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
    const payload = retryPayload(previous, command, acceptedAt);
    const scheduler = options.scheduler;
    const job = previous.jobType === "codex.app_server.run" && scheduler?.enqueueAppServerRun
      ? scheduler.enqueueAppServerRun(payload)
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
    });
    return { ...base(), schedulerJobId: target.schedulerJobId, executionId: target.executionId, interruptResult };
  }

  if (command.queueAction === "skip") {
    const target = findExecutionForQueueCommand(dbPath, command);
    if (!target) {
      blockedReasons.push(`Execution or job not found for skip: ${command.entityId}`);
      return base();
    }
    updateQueueTarget(dbPath, target, "skipped", acceptedAt, { skipReason: command.reason });
    return { ...base(), schedulerJobId: target.schedulerJobId, executionId: target.executionId };
  }

  if (command.queueAction === "pause" || command.queueAction === "resume" || command.queueAction === "reprioritize" || command.queueAction === "approve") {
    const target = findExecutionForQueueCommand(dbPath, command);
    if (!target) {
      blockedReasons.push(`Execution or job not found for ${command.queueAction}: ${command.entityId}`);
      return base();
    }
    if (command.queueAction === "pause") {
      updateQueueTarget(dbPath, target, "paused", acceptedAt, { pausedReason: command.reason });
    } else if (command.queueAction === "resume") {
      updateQueueTarget(dbPath, target, "queued", acceptedAt, { resumedReason: command.reason, blockedReason: undefined });
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
      });
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
      { name: "project", sql: "SELECT id, name, target_repo_path FROM projects WHERE id = ? LIMIT 1", params: [options.projectId] },
    ]);
    return result.queries.project[0] as ProjectRow | undefined;
  }
  if (options.workspaceRoot) {
    const workspaceRoot = resolve(options.workspaceRoot);
    const result = runSqlite(dbPath, [], [
      { name: "project", sql: "SELECT id, name, target_repo_path FROM projects WHERE target_repo_path = ? LIMIT 1", params: [workspaceRoot] },
      {
        name: "repositoryProject",
        sql: `SELECT p.id, p.name, COALESCE(p.target_repo_path, r.local_path) AS target_repo_path
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
      sql: `SELECT p.id, p.name, p.target_repo_path
        FROM project_selection_context s
        JOIN projects p ON p.id = s.project_id
        LIMIT 1`,
    },
    { name: "first", sql: "SELECT id, name, target_repo_path FROM projects ORDER BY rowid LIMIT 1" },
  ]);
  return (result.queries.selected[0] ?? result.queries.first[0]) as ProjectRow | undefined;
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
  const featureId = request.traceability?.find((item) => /^FEAT-\d+/i.test(item));
  return {
    action: routedIntent === "clarification" ? "update_spec" : "write_spec_evolution",
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
  if (request.targetRequirementId && (request.intent === "requirement_intake" || request.intent === "clarification")) {
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

function detectSpecLanguage(workspaceRoot: string): string | undefined {
  for (const language of ["zh-CN", "en", "ja"]) {
    const root = join(workspaceRoot, "docs", language);
    if (existsSync(join(root, "PRD.md")) || existsSync(join(root, "requirements.md")) || existsSync(join(root, "hld.md"))) {
      return language;
    }
  }
  return undefined;
}

function hasRootSpec(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, "docs", "PRD.md"))
    || existsSync(join(workspaceRoot, "docs", "requirements.md"))
    || existsSync(join(workspaceRoot, "docs", "hld.md"));
}

function buildTopLevelDocuments(workspaceRoot: string, specRoot?: string): SpecDriveIdeDocument[] {
  const root = specRoot ?? "docs";
  const docs = [
    document("prd", "PRD", `${root}/PRD.md`, workspaceRoot),
    document("requirements", "EARS Requirements", `${root}/requirements.md`, workspaceRoot),
    document("hld", "HLD", `${root}/hld.md`, workspaceRoot),
    document("feature-index", "Feature Spec Index", "docs/features/README.md", workspaceRoot),
    document("queue", "Feature Pool Queue", "docs/features/feature-pool-queue.json", workspaceRoot),
  ] satisfies SpecDriveIdeDocument[];
  return docs;
}

function buildFeatureNodes(dbPath: string, workspaceRoot: string, projectId?: string): SpecDriveIdeFeatureNode[] {
  const featureRoot = join(workspaceRoot, "docs/features");
  if (!existsSync(featureRoot)) return [];
  const queuePlan = readFeatureQueuePlan(workspaceRoot);
  const queueById = new Map((queuePlan.features ?? []).map((entry) => [entry.id, entry]));
  const latestExecutions = readLatestExecutionsByFeature(dbPath, projectId);

  return readdirSync(featureRoot)
    .filter((entry) => {
      const fullPath = join(featureRoot, entry);
      return statSync(fullPath).isDirectory();
    })
    .sort()
    .map((folder) => {
      const state = readJson(join(featureRoot, folder, "spec-state.json"));
      const featureId = optionalString(state.featureId) ?? folderToFeatureId(folder);
      const queueEntry = queueById.get(featureId);
      const latestExecution = latestExecutions.get(featureId);
      return {
        id: featureId,
        folder,
        title: titleFromFolder(folder),
        status: optionalString(state.status) ?? "unknown",
        priority: optionalString(queueEntry?.priority),
        dependencies: stringArray(state.dependencies).length > 0 ? stringArray(state.dependencies) : stringArray(queueEntry?.dependencies),
        blockedReasons: stringArray(state.blockedReasons),
        nextAction: optionalString(state.nextAction),
        latestExecutionId: latestExecution?.executionId,
        latestExecutionStatus: latestExecution?.status,
        documents: [
          document("feature-requirements", "requirements.md", `docs/features/${folder}/requirements.md`, workspaceRoot),
          document("feature-design", "design.md", `docs/features/${folder}/design.md`, workspaceRoot),
          document("feature-tasks", "tasks.md", `docs/features/${folder}/tasks.md`, workspaceRoot),
          document("spec-state", "spec-state.json", `docs/features/${folder}/spec-state.json`, workspaceRoot),
        ],
      };
    });
}

function readFeatureQueuePlan(workspaceRoot: string): FeatureQueuePlan {
  return readJson(join(workspaceRoot, "docs/features/feature-pool-queue.json")) as FeatureQueuePlan;
}

function readLatestExecutionsByFeature(dbPath: string, projectId?: string): Map<string, { executionId: string; status: string }> {
  const result = runSqlite(dbPath, [], [
    {
      name: "executions",
      sql: `SELECT id, status, context_json
        FROM execution_records
        ${projectId ? "WHERE project_id = ?" : ""}
        ORDER BY COALESCE(started_at, created_at) DESC`,
      params: projectId ? [projectId] : [],
    },
  ]);
  const latest = new Map<string, { executionId: string; status: string }>();
  for (const row of result.queries.executions) {
    const context = parseJsonObject(optionalString(row.context_json));
    const featureId = optionalString(context.featureId);
    if (featureId && !latest.has(featureId)) {
      latest.set(featureId, { executionId: String(row.id), status: String(row.status) });
    }
  }
  return latest;
}

type QueueExecutionRow = {
  executionId: string;
  schedulerJobId?: string;
  jobType?: string;
  executorType: string;
  operation: string;
  projectId?: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  payload: Record<string, unknown>;
  status: string;
};

function findExecutionForQueueCommand(dbPath: string, command: IdeQueueCommandV1): QueueExecutionRow | undefined {
  const lookup = command.entityType === "job"
    ? { sql: "WHERE sj.id = ? OR sj.bullmq_job_id = ?", params: [command.entityId, command.entityId] }
    : { sql: "WHERE er.id = ?", params: [command.entityId] };
  const result = runSqlite(dbPath, [], [
    {
      name: "target",
      sql: `SELECT
          er.id AS execution_id,
          er.scheduler_job_id,
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
        ${lookup.sql}
        ORDER BY er.updated_at DESC
        LIMIT 1`,
      params: lookup.params,
    },
  ]);
  const row = result.queries.target[0];
  if (!row) return undefined;
  return {
    executionId: String(row.execution_id),
    schedulerJobId: optionalString(row.scheduler_job_id),
    jobType: optionalString(row.job_type),
    executorType: optionalString(row.executor_type) ?? "cli",
    operation: optionalString(row.operation) ?? "feature_execution",
    projectId: optionalString(row.project_id),
    context: parseJsonObject(optionalString(row.context_json)),
    metadata: parseJsonObject(optionalString(row.metadata_json)),
    payload: parseJsonObject(optionalString(row.payload_json)),
    status: optionalString(row.execution_status) ?? optionalString(row.job_status) ?? "unknown",
  };
}

function queueScheduleCommand(command: IdeQueueCommandV1, acceptedAt: string): ConsoleCommandInput {
  const payload = parseJsonObject(command.payload);
  const projectId = command.projectId ?? optionalString(payload.projectId) ?? (command.entityType === "project" ? command.entityId : undefined);
  const featureId = optionalString(payload.featureId) ?? (command.entityType === "feature" ? command.entityId : undefined);
  const taskId = optionalString(payload.taskId) ?? (command.entityType === "task" ? command.entityId : undefined);
  return {
    action: "schedule_run",
    entityType: command.entityType === "task" ? "task" : command.entityType === "feature" ? "feature" : "project",
    entityId: command.entityId,
    requestedBy: command.requestedBy ?? "vscode-extension",
    reason: command.reason,
    payload: {
      ...payload,
      projectId,
      featureId,
      taskId,
      mode: command.queueAction === "run_now" ? "manual" : optionalString(payload.mode) ?? "manual",
      requestedFor: command.queueAction === "run_now" ? acceptedAt : optionalString(payload.requestedFor),
      operation: optionalString(payload.operation) ?? "feature_execution",
      requestedAction: optionalString(payload.requestedAction) ?? "feature_execution",
      workspaceRoot: command.workspaceRoot ?? optionalString(payload.workspaceRoot),
      ideQueueAction: command.queueAction,
    },
    now: new Date(acceptedAt),
  };
}

function retryPayload(previous: QueueExecutionRow, command: IdeQueueCommandV1, acceptedAt: string) {
  const context = {
    ...previous.context,
    previousExecutionId: previous.executionId,
    retryReason: command.reason,
    retriedAt: acceptedAt,
  };
  return {
    executionId: randomUUID(),
    operation: previous.operation,
    projectId: command.projectId ?? previous.projectId,
    context,
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
        "Retry queued from VSCode IDE.",
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
    {
      sql: "UPDATE execution_records SET status = ?, completed_at = CASE WHEN ? IN ('cancelled', 'skipped') THEN ? ELSE completed_at END, metadata_json = ?, updated_at = ? WHERE id = ?",
      params: [status, status, acceptedAt, JSON.stringify(metadata), acceptedAt, target.executionId],
    },
  ]);
}

function updateQueuePriority(dbPath: string, target: QueueExecutionRow, payload: unknown, acceptedAt: string): void {
  const priority = Number(parseJsonObject(payload).priority ?? parseJsonObject(payload).rank ?? 0);
  const updatedPayload = { ...target.payload, priority, reprioritizedAt: acceptedAt };
  runSqlite(dbPath, [
    ...(target.schedulerJobId ? [{
      sql: "UPDATE scheduler_job_records SET payload_json = ?, updated_at = ? WHERE id = ?",
      params: [JSON.stringify(updatedPayload), acceptedAt, target.schedulerJobId],
    }] : []),
    {
      sql: "UPDATE execution_records SET metadata_json = ?, updated_at = ? WHERE id = ?",
      params: [JSON.stringify({ ...target.metadata, priority, reprioritizedAt: acceptedAt }), acceptedAt, target.executionId],
    },
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
    throw new Error("No active Codex app-server adapter configured. Activate an adapter before cancelling a running turn.");
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
  for (const row of result.queries.queue) {
    const payload = parseJsonObject(optionalString(row.payload_json));
    const context = parseJsonObject(optionalString(row.context_json));
    const payloadContext = isRecord(payload.context) ? payload.context : parseJsonObject(optionalString(payload.context));
    const metadata = parseJsonObject(optionalString(row.metadata_json));
    const status = optionalString(row.execution_status) ?? optionalString(row.job_status) ?? "unknown";
    const item: SpecDriveIdeQueueItem = {
      schedulerJobId: optionalString(row.scheduler_job_id),
      executionId: optionalString(row.execution_id),
      status,
      operation: optionalString(row.operation) ?? optionalString(payload.operation),
      jobType: optionalString(row.job_type),
      featureId: optionalString(context.featureId) ?? optionalString(payloadContext.featureId),
      taskId: optionalString(context.taskId) ?? optionalString(payloadContext.taskId),
      adapter: optionalString(metadata.skillSlug) ?? optionalString(metadata.adapterId) ?? optionalString(payloadContext.skillSlug),
      threadId: optionalString(metadata.threadId),
      turnId: optionalString(metadata.turnId),
      updatedAt: optionalString(row.execution_updated_at) ?? optionalString(row.job_updated_at),
      summary: optionalString(row.summary),
    };
    groups[status] = [...(groups[status] ?? []), item];
  }
  return { groups };
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

function folderToFeatureId(folder: string): string {
  const match = folder.match(/^feat-(\d+)/i);
  return match ? `FEAT-${match[1]}` : folder.toUpperCase();
}

function titleFromFolder(folder: string): string {
  return basename(folder)
    .replace(/^feat-\d+-/i, "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
