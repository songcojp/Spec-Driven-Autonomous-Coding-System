import { createHash, randomUUID } from "node:crypto";
import type { BoardColumn, ReviewNeededReason } from "./orchestration.ts";
import { sanitizeForOrdinaryLog } from "./persistence.ts";
import { runSqlite } from "./sqlite.ts";
import type { ExecutionResult, StatusCheckResult } from "./status-checker.ts";
import type { WorktreeRecord } from "./workspace.ts";

export type FailureStage =
  | "planning"
  | "implementation"
  | "test"
  | "review"
  | "status_check"
  | "delivery"
  | "custom";

export type FailureType =
  | "command_failed"
  | "status_check_failed"
  | "spec_alignment_failed"
  | "rollback_required"
  | "dependency_blocked"
  | "manual_approval_required"
  | "unknown";

export type RecoveryAction =
  | "auto_fix"
  | "rollback"
  | "split_task"
  | "read_only_analysis"
  | "manual_approval"
  | "spec_update"
  | "dependency_update";

export type RecoveryRoute = "automatic" | "review_needed" | "manual" | "not_recoverable";
export type RecoveryTaskStatus = "created" | "scheduled" | "running" | "completed" | "review_needed" | "blocked" | "failed";
export type RetryScheduleStatus = "scheduled" | "already_scheduled" | "max_retries_reached" | "blocked_by_forbidden_duplicate";
export type RecoveryResultStatus = "scheduled" | "completed" | "review_needed" | "blocked" | "failed";

export type FailureFingerprint = {
  id: string;
  taskId: string;
  stage: FailureStage;
  failedCommandOrCheck: string;
  normalizedErrorSummary: string;
  relatedFiles: string[];
  source: {
    rawSummary: string;
    failedCommand?: string;
    checkItem?: string;
  };
};

export type RecoveryAttempt = {
  id: string;
  fingerprintId: string;
  taskId: string;
  action: RecoveryAction;
  strategy: string;
  command?: string;
  fileScope: string[];
  status: RecoveryResultStatus;
  summary: string;
  executionResult?: RecoveryExecutionResult;
  attemptedAt: string;
};

export type ForbiddenRetryRecord = {
  id: string;
  fingerprintId: string;
  taskId: string;
  failedStrategy: string;
  failedCommand?: string;
  failedFileScope: string[];
  reason: string;
  executionResultId?: string;
  createdAt: string;
};

export type RetrySchedule = {
  id: string;
  fingerprintId: string;
  taskId: string;
  attemptNumber: number;
  maxRetries: number;
  backoffMinutes?: number;
  scheduledAt?: string;
  status: RetryScheduleStatus;
  reason: string;
};

export type RecoveryTask = {
  id: string;
  taskId: string;
  featureId?: string;
  projectId?: string;
  statusCheckResultId?: string;
  failureType: FailureType;
  failureStage: FailureStage;
  failedCommand?: string;
  checkItem?: string;
  summary: string;
  relatedFiles: string[];
  historicalAttempts: RecoveryAttempt[];
  forbiddenRetryItems: ForbiddenRetryRecord[];
  maxRetries: number;
  fingerprint: FailureFingerprint;
  route: RecoveryRoute;
  requestedAction: RecoveryAction;
  proposedStrategy?: string;
  proposedCommand?: string;
  proposedFileScope?: string[];
  retrySchedule?: RetrySchedule;
  worktree?: Pick<WorktreeRecord, "id" | "path" | "branch" | "baseCommit" | "targetBranch" | "featureId" | "taskId">;
  sourceExecutionResult?: ExecutionResult;
  createdAt: string;
};

export type RecoveryFailureInput = {
  taskId?: string;
  featureId?: string;
  projectId?: string;
  failureType?: FailureType;
  failureStage?: FailureStage;
  failedCommand?: string;
  checkItem?: string;
  summary?: string;
  relatedFiles?: string[];
  statusCheckResult?: StatusCheckResult;
  worktree?: WorktreeRecord;
  recoverable?: boolean;
  dangerousOperation?: boolean;
  rollbackSharedState?: boolean;
  requiresManualApproval?: boolean;
  requiresSpecUpdate?: boolean;
  requiresDependencyUpdate?: boolean;
  requestedAction?: RecoveryAction;
  proposedStrategy?: string;
  proposedCommand?: string;
  proposedFileScope?: string[];
  historicalAttempts?: RecoveryAttempt[];
  forbiddenRetryItems?: ForbiddenRetryRecord[];
  maxRetries?: number;
  now?: Date;
};

export type RecoveryRouteDecision = {
  route: RecoveryRoute;
  action: RecoveryAction;
  reasons: string[];
  reviewNeededReason?: ReviewNeededReason;
  boardStatus: BoardColumn;
};

export type ForbiddenRetryCheck = {
  allowed: boolean;
  violations: Array<{
    record: ForbiddenRetryRecord;
    reason: "strategy" | "command" | "file_scope";
  }>;
};

export type RecoveryDispatchInput = {
  schema_version: "1.0.0";
  recovery_task_id: string;
  task_id: string;
  feature_id?: string;
  project_id?: string;
  requested_action: RecoveryAction;
  failure: {
    type: FailureType;
    stage: FailureStage;
    failed_command?: string;
    check_item?: string;
    summary: string;
    related_files: string[];
    fingerprint_id: string;
  };
  recovery_plan: {
    strategy: string;
    command?: string;
    file_scope: string[];
  };
  retry_policy: {
    max_retries: number;
    attempt_number: number;
    backoff_minutes?: number;
    forbidden_retry_items: Array<{
      strategy: string;
      command?: string;
      file_scope: string[];
      reason: string;
    }>;
  };
  historical_attempts: Array<{
    action: RecoveryAction;
    strategy: string;
    command?: string;
    file_scope: string[];
    status: RecoveryResultStatus;
    summary: string;
  }>;
  execution_result?: ExecutionResult;
  recommendations: string[];
};

export type RecoveryActionResultInput = {
  recoveryTask: RecoveryTask;
  action: RecoveryAction;
  status: RecoveryResultStatus;
  strategy: string;
  summary: string;
  command?: string;
  fileScope?: string[];
  result?: unknown;
  recommendations?: string[];
  risks?: string[];
  now?: Date;
};

export type RecoveryExecutionResult = {
  id: string;
  recoveryTaskId: string;
  fingerprintId: string;
  taskId: string;
  action: RecoveryAction;
  status: RecoveryResultStatus;
  strategy: string;
  summary: string;
  reasons: string[];
  recommendations: string[];
  result?: unknown;
  createdAt: string;
};

export type RecoveryResultHandling = {
  attempt: RecoveryAttempt;
  executionResult: RecoveryExecutionResult;
  nextStepRecommendations: string[];
  boardStatus: BoardColumn;
  reviewNeededReason?: ReviewNeededReason;
  forbiddenRetryRecord?: ForbiddenRetryRecord;
};

export type RecoveryHistory = {
  attempts: RecoveryAttempt[];
  forbiddenRetryItems: ForbiddenRetryRecord[];
};

const DEFAULT_MAX_RETRIES = 3;
const RETRY_BACKOFF_MINUTES = [2, 4, 8] as const;
const SCHEDULED_RETRY_STALE_MINUTES = 30;
const REVIEW_ACTIONS = new Set<RecoveryAction>(["rollback", "manual_approval", "spec_update"]);
const AUTOMATIC_RETRY_BUDGET_ACTIONS = new Set<RecoveryAction>(["auto_fix", "split_task", "read_only_analysis", "dependency_update"]);

export function buildFailureFingerprint(input: {
  taskId?: string;
  stage?: FailureStage;
  failedCommand?: string;
  checkItem?: string;
  summary?: string;
  relatedFiles?: string[];
  statusCheckResult?: StatusCheckResult;
}): FailureFingerprint {
  const taskId = input.taskId ?? input.statusCheckResult?.taskId ?? "unknown-task";
  const stage = input.stage ?? "status_check";
  const rawSummary = input.summary ?? statusFailureSummary(input.statusCheckResult) ?? "Unknown failure.";
  const failedCommandOrCheck = normalizeCommand(
    input.failedCommand ??
    input.checkItem ??
    failureCommandFromStatus(input.statusCheckResult) ??
    "unknown-check",
  );
  const normalizedErrorSummary = normalizeErrorSummary(rawSummary);
  const relatedFiles = normalizeFileSet([
    ...(input.relatedFiles ?? []),
    ...(input.statusCheckResult?.executionResult?.diff?.files ?? []),
  ]);
  const id = createHash("sha256")
    .update(JSON.stringify({ taskId, stage, failedCommandOrCheck, normalizedErrorSummary, relatedFiles }))
    .digest("hex");

  return {
    id,
    taskId,
    stage,
    failedCommandOrCheck,
    normalizedErrorSummary,
    relatedFiles,
    source: {
      rawSummary,
      failedCommand: input.failedCommand,
      checkItem: input.checkItem,
    },
  };
}

export function scheduleRecoveryRetry(input: {
  fingerprint: FailureFingerprint;
  historicalAttempts?: RecoveryAttempt[];
  maxRetries?: number;
  now?: Date;
  forbiddenCheck?: ForbiddenRetryCheck;
}): RetrySchedule {
  const now = input.now ?? new Date();
  const maxRetries = Math.min(input.maxRetries ?? DEFAULT_MAX_RETRIES, DEFAULT_MAX_RETRIES);
  const previousAutoRetries = (input.historicalAttempts ?? []).filter((attempt) =>
    attempt.fingerprintId === input.fingerprint.id &&
    AUTOMATIC_RETRY_BUDGET_ACTIONS.has(attempt.action) &&
    isAutomaticRetryBudgetAttempt(attempt)
  ).length;
  const activeScheduledAttempt = (input.historicalAttempts ?? []).find((attempt) =>
    attempt.fingerprintId === input.fingerprint.id &&
    AUTOMATIC_RETRY_BUDGET_ACTIONS.has(attempt.action) &&
    attempt.status === "scheduled"
  );
  if (activeScheduledAttempt) {
    const scheduledAt = new Date(activeScheduledAttempt.attemptedAt);
    const staleAt = new Date(scheduledAt.getTime() + SCHEDULED_RETRY_STALE_MINUTES * 60_000);
    if (staleAt.getTime() <= now.getTime()) {
      return {
        id: activeScheduledAttempt.id,
        fingerprintId: input.fingerprint.id,
        taskId: input.fingerprint.taskId,
        attemptNumber: previousAutoRetries + 1,
        maxRetries,
        scheduledAt: now.toISOString(),
        status: "scheduled",
        reason: `Stale scheduled recovery attempt ${activeScheduledAttempt.id} is being re-enqueued.`,
      };
    }
    return {
      id: activeScheduledAttempt.id,
      fingerprintId: input.fingerprint.id,
      taskId: input.fingerprint.taskId,
      attemptNumber: previousAutoRetries + 1,
      maxRetries,
      scheduledAt: activeScheduledAttempt.attemptedAt,
      status: "already_scheduled",
      reason: `Automatic recovery is already scheduled by attempt ${activeScheduledAttempt.id}.`,
    };
  }
  const attemptNumber = previousAutoRetries + 1;

  if (input.forbiddenCheck && !input.forbiddenCheck.allowed) {
    return {
      id: randomUUID(),
      fingerprintId: input.fingerprint.id,
      taskId: input.fingerprint.taskId,
      attemptNumber,
      maxRetries,
      status: "blocked_by_forbidden_duplicate",
      reason: "Forbidden duplicate policy blocked the automatic retry.",
    };
  }

  if (attemptNumber > maxRetries) {
    return {
      id: randomUUID(),
      fingerprintId: input.fingerprint.id,
      taskId: input.fingerprint.taskId,
      attemptNumber,
      maxRetries,
      status: "max_retries_reached",
      reason: `Automatic retry limit reached for fingerprint ${input.fingerprint.id}.`,
    };
  }

  const backoffMinutes = RETRY_BACKOFF_MINUTES[Math.min(attemptNumber - 1, RETRY_BACKOFF_MINUTES.length - 1)];
  const scheduledAt = new Date(now.getTime() + backoffMinutes * 60_000).toISOString();

  return {
    id: randomUUID(),
    fingerprintId: input.fingerprint.id,
    taskId: input.fingerprint.taskId,
    attemptNumber,
    maxRetries,
    backoffMinutes,
    scheduledAt,
    status: "scheduled",
    reason: `Automatic recovery retry ${attemptNumber}/${maxRetries} scheduled after ${backoffMinutes} minute(s).`,
  };
}

export function checkForbiddenRetry(input: {
  fingerprint: FailureFingerprint;
  action: RecoveryAction;
  strategy: string;
  command?: string;
  fileScope?: string[];
  forbiddenRetryItems?: ForbiddenRetryRecord[];
}): ForbiddenRetryCheck {
  const strategy = normalizeText(input.strategy);
  const command = input.command ? normalizeCommand(input.command) : undefined;
  const fileScope = normalizeFileSet(input.fileScope ?? []);
  const violations: ForbiddenRetryCheck["violations"] = [];

  for (const record of input.forbiddenRetryItems ?? []) {
    if (record.fingerprintId !== input.fingerprint.id) continue;
    if (normalizeText(record.failedStrategy) === strategy) {
      violations.push({ record, reason: "strategy" });
    }
    if (command && record.failedCommand && normalizeCommand(record.failedCommand) === command) {
      violations.push({ record, reason: "command" });
    }
    if (fileScope.length > 0 && sameFileScope(fileScope, normalizeFileSet(record.failedFileScope))) {
      violations.push({ record, reason: "file_scope" });
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

export function routeRecovery(input: RecoveryFailureInput & { fingerprint?: FailureFingerprint; retrySchedule?: RetrySchedule }): RecoveryRouteDecision {
  const reasons: string[] = [];
  const recoverable = input.recoverable ?? recoverableStatus(input.statusCheckResult);
  const action = input.requestedAction ?? chooseRecoveryAction(input);

  if (!recoverable) {
    return {
      route: "not_recoverable",
      action: "manual_approval",
      reasons: ["Failure is not marked as automatically recoverable."],
      reviewNeededReason: "risk_review_needed",
      boardStatus: "failed",
    };
  }

  if (input.retrySchedule?.status === "max_retries_reached") {
    return {
      route: "manual",
      action: "manual_approval",
      reasons: [input.retrySchedule.reason, "Same failure pattern reached the automatic retry limit."],
      reviewNeededReason: "approval_needed",
      boardStatus: "review_needed",
    };
  }

  if (input.retrySchedule?.status === "blocked_by_forbidden_duplicate") {
    return {
      route: "manual",
      action: "manual_approval",
      reasons: [input.retrySchedule.reason, "Automatic retry would duplicate a forbidden strategy, command, or file scope."],
      reviewNeededReason: "approval_needed",
      boardStatus: "review_needed",
    };
  }

  if (input.requiresManualApproval) reasons.push("Manual approval requested by recovery input.");
  if (input.dangerousOperation) reasons.push("Recovery includes a dangerous operation.");
  if (input.rollbackSharedState) reasons.push("Recovery may affect shared state.");
  if (input.requiresSpecUpdate) reasons.push("Recovery requires Spec updates.");
  if (REVIEW_ACTIONS.has(action)) reasons.push(`Recovery action ${action} requires review.`);

  if (reasons.length > 0) {
    return {
      route: input.requiresManualApproval ? "manual" : "review_needed",
      action,
      reasons,
      reviewNeededReason: input.requiresManualApproval ? "approval_needed" : "risk_review_needed",
      boardStatus: "review_needed",
    };
  }

  return {
    route: "automatic",
    action,
    reasons: ["Failure is recoverable and retry policy allows automatic recovery."],
    boardStatus: "scheduled",
  };
}

export function buildRecoveryTask(input: RecoveryFailureInput): RecoveryTask {
  const now = input.now ?? new Date();
  const fingerprint = buildFailureFingerprint({
    taskId: input.taskId,
    stage: input.failureStage,
    failedCommand: input.failedCommand,
    checkItem: input.checkItem,
    summary: input.summary,
    relatedFiles: input.relatedFiles,
    statusCheckResult: input.statusCheckResult,
  });
  const action = input.requestedAction ?? chooseRecoveryAction(input);
  const hasRetryProposal = input.proposedStrategy || input.proposedCommand || input.proposedFileScope?.length;
  const forbiddenCheck = hasRetryProposal
    ? checkForbiddenRetry({
        fingerprint,
        action,
        strategy: input.proposedStrategy ?? action,
        command: input.proposedCommand ?? recoveryOperationCommand(input),
        fileScope: input.proposedFileScope?.length ? input.proposedFileScope : fingerprint.relatedFiles,
        forbiddenRetryItems: input.forbiddenRetryItems,
      })
    : checkForbiddenRetry({
        fingerprint,
        action,
        strategy: action,
        command: recoveryOperationCommand(input),
        fileScope: fingerprint.relatedFiles,
        forbiddenRetryItems: input.forbiddenRetryItems,
      });
  const preliminaryRoute = routeRecovery({ ...input, fingerprint, requestedAction: action });
  const retrySchedule = preliminaryRoute.route === "automatic"
    ? scheduleRecoveryRetry({
        fingerprint,
        historicalAttempts: input.historicalAttempts,
        maxRetries: input.maxRetries,
        now,
        forbiddenCheck,
      })
    : undefined;
  const route = retrySchedule
    ? routeRecovery({ ...input, fingerprint, retrySchedule, requestedAction: action })
    : preliminaryRoute;
  const taskId = input.taskId ?? input.statusCheckResult?.taskId ?? fingerprint.taskId;
  const recoveryTaskId = retrySchedule && shouldReuseScheduledRecoveryTaskId(retrySchedule) ? retrySchedule.id : randomUUID();
  const proposedFileScope = input.proposedFileScope?.length ? normalizeFileSet(input.proposedFileScope) : undefined;

  return {
    id: recoveryTaskId,
    taskId,
    featureId: input.featureId ?? input.statusCheckResult?.featureId,
    projectId: input.projectId ?? input.statusCheckResult?.projectId,
    statusCheckResultId: input.statusCheckResult?.id,
    failureType: input.failureType ?? inferFailureType(input.statusCheckResult),
    failureStage: input.failureStage ?? "status_check",
    failedCommand: input.failedCommand ?? failureCommandFromStatus(input.statusCheckResult),
    checkItem: input.checkItem,
    summary: input.summary ?? input.statusCheckResult?.summary ?? "Unknown failure.",
    relatedFiles: fingerprint.relatedFiles,
    historicalAttempts: input.historicalAttempts ?? [],
    forbiddenRetryItems: input.forbiddenRetryItems ?? [],
    maxRetries: Math.min(input.maxRetries ?? DEFAULT_MAX_RETRIES, DEFAULT_MAX_RETRIES),
    fingerprint,
    route: route.route,
    requestedAction: route.action,
    proposedStrategy: input.proposedStrategy,
    proposedCommand: input.proposedCommand,
    proposedFileScope,
    retrySchedule,
    worktree: input.worktree ? pickWorktree(input.worktree) : undefined,
    sourceExecutionResult: input.statusCheckResult?.executionResult,
    createdAt: now.toISOString(),
  };
}

export function buildRecoveryDispatchInput(recoveryTask: RecoveryTask): RecoveryDispatchInput {
  const historicalAttempts = recoveryTask.historicalAttempts.filter((attempt) => attempt.fingerprintId === recoveryTask.fingerprint.id);
  const forbiddenRetryItems = recoveryTask.forbiddenRetryItems.filter((item) => item.fingerprintId === recoveryTask.fingerprint.id);
  return {
    schema_version: "1.0.0",
    recovery_task_id: recoveryTask.id,
    task_id: recoveryTask.taskId,
    feature_id: recoveryTask.featureId,
    project_id: recoveryTask.projectId,
    requested_action: recoveryTask.requestedAction,
    failure: {
      type: recoveryTask.failureType,
      stage: recoveryTask.failureStage,
      failed_command: recoveryTask.failedCommand ? sanitizeForOrdinaryLog(recoveryTask.failedCommand) : undefined,
      check_item: recoveryTask.checkItem ? sanitizeForOrdinaryLog(recoveryTask.checkItem) : undefined,
      summary: sanitizeForOrdinaryLog(recoveryTask.summary),
      related_files: recoveryTask.proposedFileScope ?? recoveryTask.relatedFiles,
      fingerprint_id: recoveryTask.fingerprint.id,
    },
    recovery_plan: {
      strategy: sanitizeForOrdinaryLog(recoveryTask.proposedStrategy ?? recoveryTask.requestedAction),
      command: recoveryTask.proposedCommand ? sanitizeForOrdinaryLog(recoveryTask.proposedCommand) : undefined,
      file_scope: recoveryTask.proposedFileScope ?? recoveryTask.relatedFiles,
    },
    retry_policy: {
      max_retries: recoveryTask.maxRetries,
      attempt_number: recoveryTask.retrySchedule?.attemptNumber ?? 1,
      backoff_minutes: recoveryTask.retrySchedule?.backoffMinutes,
      forbidden_retry_items: forbiddenRetryItems.map((item) => ({
        strategy: sanitizeForOrdinaryLog(item.failedStrategy),
        command: item.failedCommand ? sanitizeForOrdinaryLog(item.failedCommand) : undefined,
        file_scope: item.failedFileScope,
        reason: sanitizeForOrdinaryLog(item.reason),
      })),
    },
    historical_attempts: historicalAttempts.map((attempt) => ({
      action: attempt.action,
      strategy: sanitizeForOrdinaryLog(attempt.strategy),
      command: attempt.command ? sanitizeForOrdinaryLog(attempt.command) : undefined,
      file_scope: attempt.fileScope,
      status: attempt.status,
      summary: sanitizeForOrdinaryLog(attempt.summary),
    })),
    execution_result: recoveryTask.sourceExecutionResult ? sanitizeRecoveryResult(recoveryTask.sourceExecutionResult) as ExecutionResult : undefined,
    recommendations: recoveryRecommendations(recoveryTask).map(sanitizeForOrdinaryLog),
  };
}

export function handleRecoveryResult(input: RecoveryActionResultInput): RecoveryResultHandling {
  const now = input.now ?? new Date();
  const reasons = [
    `${input.action} completed with status ${input.status}.`,
    ...input.risks?.map((risk) => `Risk: ${risk}`) ?? [],
  ];
  const nextStepRecommendations = input.recommendations?.length
    ? input.recommendations
    : defaultResultRecommendations(input.action, input.status);
  const executionResult: RecoveryExecutionResult = {
    id: randomUUID(),
    recoveryTaskId: input.recoveryTask.id,
    fingerprintId: input.recoveryTask.fingerprint.id,
    taskId: input.recoveryTask.taskId,
    action: input.action,
    status: input.status,
    strategy: sanitizeForOrdinaryLog(input.strategy),
    summary: sanitizeForOrdinaryLog(input.summary),
    reasons: reasons.map(sanitizeForOrdinaryLog),
    recommendations: nextStepRecommendations.map(sanitizeForOrdinaryLog),
    result: sanitizeRecoveryResult(input.result),
    createdAt: now.toISOString(),
  };
  const plannedCommand = input.command ?? input.recoveryTask.proposedCommand;
  const attempt: RecoveryAttempt = {
    id: input.recoveryTask.id,
    fingerprintId: input.recoveryTask.fingerprint.id,
    taskId: input.recoveryTask.taskId,
    action: input.action,
    strategy: sanitizeForOrdinaryLog(input.strategy),
    command: plannedCommand ? sanitizeForOrdinaryLog(plannedCommand) : undefined,
    fileScope: normalizeFileSet(input.fileScope ?? input.recoveryTask.proposedFileScope ?? input.recoveryTask.relatedFiles),
    status: input.status,
    summary: sanitizeForOrdinaryLog(input.summary),
    executionResult,
    attemptedAt: now.toISOString(),
  };
  const boardStatus = resultBoardStatus(input.action, input.status);
  const reviewNeededReason = boardStatus === "review_needed" ? resultReviewReason(input.action) : undefined;
  const forbiddenRetryRecord = input.status === "failed" && AUTOMATIC_RETRY_BUDGET_ACTIONS.has(input.action)
    ? {
        id: randomUUID(),
        fingerprintId: input.recoveryTask.fingerprint.id,
        taskId: input.recoveryTask.taskId,
        failedStrategy: sanitizeForOrdinaryLog(input.strategy),
        failedCommand: plannedCommand ? sanitizeForOrdinaryLog(plannedCommand) : undefined,
        failedFileScope: attempt.fileScope,
        reason: `Failed recovery attempt ${attempt.id} must not be automatically repeated for the same fingerprint.`,
        executionResultId: executionResult.id,
        createdAt: now.toISOString(),
      }
    : undefined;

  return {
    attempt,
    executionResult,
    nextStepRecommendations,
    boardStatus,
    reviewNeededReason,
    forbiddenRetryRecord,
  };
}

export function listRecoveryHistory(dbPath: string, input: { taskId?: string; fingerprintId?: string } = {}): RecoveryHistory {
  const attemptFilters: string[] = [];
  const attemptParams: unknown[] = [];
  const forbiddenFilters: string[] = [];
  const forbiddenParams: unknown[] = [];
  if (input.taskId) {
    attemptFilters.push("task_id = ?");
    attemptParams.push(input.taskId);
    forbiddenFilters.push("task_id = ?");
    forbiddenParams.push(input.taskId);
  }
  if (input.fingerprintId) {
    attemptFilters.push("fingerprint_id = ?");
    attemptParams.push(input.fingerprintId);
    forbiddenFilters.push("fingerprint_id = ?");
    forbiddenParams.push(input.fingerprintId);
  }
  const attemptWhere = attemptFilters.length ? `WHERE ${attemptFilters.join(" AND ")}` : "";
  const forbiddenWhere = forbiddenFilters.length ? `WHERE ${forbiddenFilters.join(" AND ")}` : "";
  const result = runSqlite(dbPath, [], [
    {
      name: "attempts",
      sql: `SELECT * FROM recovery_attempts ${attemptWhere} ORDER BY attempted_at, id`,
      params: attemptParams,
    },
    {
      name: "forbidden",
      sql: `SELECT * FROM forbidden_retry_records ${forbiddenWhere} ORDER BY created_at, id`,
      params: forbiddenParams,
    },
  ]);

  return {
    attempts: result.queries.attempts.map((row) => ({
      id: String(row.id),
      fingerprintId: String(row.fingerprint_id),
      taskId: String(row.task_id),
      action: String(row.action) as RecoveryAction,
      strategy: String(row.strategy),
      command: nullableString(row.command),
      fileScope: parseStringArray(row.file_scope_json),
      status: String(row.status) as RecoveryResultStatus,
      summary: String(row.summary),
      executionResult: row.execution_result_json ? JSON.parse(String(row.execution_result_json)) as RecoveryExecutionResult : undefined,
      attemptedAt: String(row.attempted_at),
    })),
    forbiddenRetryItems: result.queries.forbidden.map((row) => ({
      id: String(row.id),
      fingerprintId: String(row.fingerprint_id),
      taskId: String(row.task_id),
      failedStrategy: String(row.failed_strategy),
      failedCommand: nullableString(row.failed_command),
      failedFileScope: parseStringArray(row.failed_file_scope_json),
      reason: String(row.reason),
      executionResultId: nullableString(row.execution_result_id),
      createdAt: String(row.created_at),
    })),
  };
}

export function persistRecoveryAttempt(dbPath: string, attempt: RecoveryAttempt): void {
  const safeAttempt: RecoveryAttempt = {
    ...attempt,
    strategy: sanitizeForOrdinaryLog(attempt.strategy),
    command: attempt.command ? sanitizeForOrdinaryLog(attempt.command) : undefined,
    fileScope: normalizeFileSet(attempt.fileScope),
    summary: sanitizeForOrdinaryLog(attempt.summary),
    executionResult: attempt.executionResult
      ? sanitizeRecoveryResult(attempt.executionResult) as RecoveryExecutionResult
      : undefined,
  };
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO recovery_attempts (
        id, fingerprint_id, task_id, action, strategy, command, file_scope_json,
        status, summary, execution_result_json, attempted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        fingerprint_id = excluded.fingerprint_id,
        task_id = excluded.task_id,
        action = excluded.action,
        strategy = excluded.strategy,
        command = excluded.command,
        file_scope_json = excluded.file_scope_json,
        status = excluded.status,
        summary = excluded.summary,
        execution_result_json = excluded.execution_result_json,
        attempted_at = excluded.attempted_at`,
      params: [
        safeAttempt.id,
        safeAttempt.fingerprintId,
        safeAttempt.taskId,
        safeAttempt.action,
        safeAttempt.strategy,
        safeAttempt.command ?? null,
        JSON.stringify(safeAttempt.fileScope),
        safeAttempt.status,
        safeAttempt.summary,
        safeAttempt.executionResult ? JSON.stringify(safeAttempt.executionResult) : null,
        safeAttempt.attemptedAt,
      ],
    },
  ]);
}

export function persistForbiddenRetryRecord(dbPath: string, record: ForbiddenRetryRecord): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT OR IGNORE INTO forbidden_retry_records (
        id, fingerprint_id, task_id, failed_strategy, failed_command,
        failed_file_scope_json, reason, execution_result_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        record.id,
        record.fingerprintId,
        record.taskId,
        record.failedStrategy,
        record.failedCommand ?? null,
        JSON.stringify(normalizeFileSet(record.failedFileScope)),
        record.reason,
        record.executionResultId ?? null,
        record.createdAt,
      ],
    },
  ]);
}

export function persistRecoveryResultHandling(dbPath: string, result: RecoveryResultHandling): void {
  persistRecoveryAttempt(dbPath, result.attempt);
  if (result.forbiddenRetryRecord) {
    persistForbiddenRetryRecord(dbPath, result.forbiddenRetryRecord);
  }
}

function chooseRecoveryAction(input: RecoveryFailureInput): RecoveryAction {
  if (input.requiresManualApproval) return "manual_approval";
  if (input.requiresSpecUpdate) return "spec_update";
  if (input.requiresDependencyUpdate) return "dependency_update";
  if (input.failureType === "rollback_required") return "rollback";
  if (input.failureType === "dependency_blocked") return "dependency_update";
  if (input.statusCheckResult?.specAlignment?.aligned === false) return "read_only_analysis";
  return "auto_fix";
}

function inferFailureType(statusCheckResult?: StatusCheckResult): FailureType {
  if (!statusCheckResult) return "unknown";
  if (statusCheckResult.specAlignment?.aligned === false) return "spec_alignment_failed";
  if (statusCheckResult.executionResult?.commands?.some((command) => command.status === "failed")) return "command_failed";
  if (statusCheckResult.status === "failed" || statusCheckResult.status === "blocked") return "status_check_failed";
  return "unknown";
}

function recoverableStatus(statusCheckResult?: StatusCheckResult): boolean {
  if (!statusCheckResult) return true;
  return statusCheckResult.status === "blocked" || statusCheckResult.status === "failed" || statusCheckResult.status === "review_needed";
}

function firstFailedCommand(statusCheckResult?: StatusCheckResult): string | undefined {
  return statusCheckResult?.executionResult?.commands?.find((command) => command.status === "failed")?.command;
}

function statusFailureSummary(statusCheckResult?: StatusCheckResult): string | undefined {
  if (!statusCheckResult) return undefined;
  const failedCommands = statusCheckResult.executionResult.commands
    .filter((command) => command.status === "failed")
    .map((command) => [
      command.kind,
      command.command,
      command.exitCode === undefined || command.exitCode === null ? undefined : `exit=${command.exitCode}`,
      command.summary,
    ].filter(Boolean).join(" "));
  const specAlignment = statusCheckResult.executionResult.specAlignment;
  const specAlignmentDetails = specAlignment?.aligned === false
    ? [
        ...specAlignment.reasons,
        ...specAlignment.missingTraceability.map((item) => `missing-traceability=${item}`),
        ...specAlignment.coverageGaps.map((item) => `coverage-gap=${item}`),
        ...specAlignment.forbiddenFiles.map((item) => `forbidden-file=${item}`),
        ...specAlignment.unauthorizedFiles.map((item) => `unauthorized-file=${item}`),
      ].join(" ")
    : undefined;
  const runner = statusCheckResult.executionResult.runner;
  const runnerDetails = runner.status === "failed" || (runner.exitCode ?? 0) !== 0
    ? [
        "runner",
        runner.exitCode === undefined || runner.exitCode === null ? undefined : `exit=${runner.exitCode}`,
        runner.summary,
      ].filter(Boolean).join(" ")
    : undefined;
  return [statusCheckResult.summary, ...failedCommands, specAlignmentDetails, runnerDetails].filter(Boolean).join(" | ");
}

function failureCommandFromStatus(statusCheckResult?: StatusCheckResult): string | undefined {
  const failedCommand = firstFailedCommand(statusCheckResult);
  if (failedCommand) return failedCommand;
  const runner = statusCheckResult?.executionResult.runner;
  if (!runner || (runner.status !== "failed" && (runner.exitCode ?? 0) === 0)) return undefined;
  return `codex runner exit=${runner.exitCode ?? "unknown"}`;
}

function recoveryOperationCommand(input: RecoveryFailureInput): string | undefined {
  return input.proposedCommand ?? input.failedCommand ?? failureCommandFromStatus(input.statusCheckResult);
}

function isAutomaticRetryBudgetAttempt(attempt: RecoveryAttempt): boolean {
  if (attempt.status === "scheduled") return false;
  if (attempt.status === "review_needed") return false;
  if (attempt.status === "blocked" && /blocked by runner safety gate/i.test(attempt.summary)) return false;
  if (attempt.status === "blocked" && /blocked by recovery dispatcher/i.test(attempt.summary)) return false;
  return true;
}

function shouldReuseScheduledRecoveryTaskId(retrySchedule: RetrySchedule): boolean {
  return retrySchedule.status === "already_scheduled" || retrySchedule.reason.startsWith("Stale scheduled recovery attempt");
}

function recoveryRecommendations(recoveryTask: RecoveryTask): string[] {
  if (recoveryTask.route === "automatic" && recoveryTask.retrySchedule?.status === "scheduled") {
    return [
      `Dispatch recovery action ${recoveryTask.requestedAction}.`,
      `Use retry backoff of ${recoveryTask.retrySchedule.backoffMinutes} minute(s).`,
      "Record the recovery execution result before advancing task state.",
    ];
  }
  if (recoveryTask.route === "manual") {
    return [
      "Stop automatic recovery and request manual approval.",
      "Attach prior execution results and forbidden retry records to the review request.",
    ];
  }
  if (recoveryTask.route === "review_needed") {
    return [
      "Route recovery through Review Center before executing write actions.",
      "Include rollback, shared-state, Spec, and dependency implications in the recovery result.",
    ];
  }
  return ["Record unrecoverable failure details and keep task in failed state."];
}

function defaultResultRecommendations(action: RecoveryAction, status: RecoveryResultStatus): string[] {
  if (status === "completed" && action === "auto_fix") return ["Run status checks again for the failed task."];
  if (status === "completed" && action === "rollback") return ["Verify rollback boundary details before rescheduling the task."];
  if (status === "completed" && action === "split_task") return ["Create child tasks and update task dependencies before retrying implementation."];
  if (status === "completed" && action === "read_only_analysis") return ["Review analysis findings and choose a write-safe recovery action."];
  if (status === "completed" && action === "dependency_update") return ["Recompute task readiness after dependency updates."];
  if (status === "completed" && action === "spec_update") return ["Route Spec changes through review before resuming implementation."];
  if (action === "manual_approval") return ["Wait for manual approval before further automatic recovery."];
  return ["Record failed recovery details and update the forbidden duplicate policy."];
}

function resultBoardStatus(action: RecoveryAction, status: RecoveryResultStatus): BoardColumn {
  if (status === "failed") return "failed";
  if (status === "blocked") return "blocked";
  if (status === "review_needed") return "review_needed";
  if (action === "manual_approval" || action === "spec_update" || action === "rollback") return "review_needed";
  if (action === "split_task" || action === "dependency_update") return "ready";
  return "checking";
}

function resultReviewReason(action: RecoveryAction): ReviewNeededReason {
  return action === "manual_approval" ? "approval_needed" : "risk_review_needed";
}

function pickWorktree(worktree: WorktreeRecord): RecoveryTask["worktree"] {
  return {
    id: worktree.id,
    path: worktree.path,
    branch: worktree.branch,
    baseCommit: worktree.baseCommit,
    targetBranch: worktree.targetBranch,
    featureId: worktree.featureId,
    taskId: worktree.taskId,
  };
}

function normalizeErrorSummary(value: string): string {
  return normalizeText(value)
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\/[^\s:)]+/g, "<path>")
    .replace(/:(\d+)(?=\b)/g, ":<number>")
    .replace(/\b(code|exit|line|column|col|status)\s*[=:]?\s*\d+\b/gi, "$1 <number>")
    .slice(0, 280);
}

function normalizeCommand(value: string): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function sanitizeRecoveryResult(value: unknown): unknown {
  if (typeof value === "string") return sanitizeForOrdinaryLog(value);
  if (Array.isArray(value)) return value.map(sanitizeRecoveryResult);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeRecoveryResult(entry)]),
    );
  }
  return value;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeFileSet(files: string[]): string[] {
  return [...new Set(files.map((file) => file.replace(/\\/g, "/").replace(/^\.\//, "").trim()).filter(Boolean))].sort();
}

function sameFileScope(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((file, index) => file === right[index]);
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}
