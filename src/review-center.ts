import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "./persistence.ts";
import { runSqlite, type SqlStatement } from "./sqlite.ts";
import {
  transitionFeature,
  transitionTask,
  type BoardColumn,
  type FeatureLifecycleStatus,
  type ReviewNeededReason,
  type RiskLevel,
  type StateTransition,
} from "./orchestration.ts";

export type ReviewTrigger =
  | "high_risk_file"
  | "diff_threshold_exceeded"
  | "forbidden_file"
  | "repeated_failure"
  | "failed_tests_continue"
  | "high_impact_ambiguity"
  | "permission_escalation"
  | "constitution_change"
  | "architecture_change";

export type ReviewItemStatus = "review_needed" | "approved" | "rejected" | "changes_requested" | "closed";
export type ReviewDecision =
  | "approve_continue"
  | "reject"
  | "request_changes"
  | "rollback"
  | "split_task"
  | "update_spec"
  | "mark_complete";

export type ReviewItem = {
  id: string;
  projectId?: string;
  featureId?: string;
  taskId?: string;
  runId?: string;
  status: ReviewItemStatus;
  severity: RiskLevel | "critical";
  reviewNeededReason: ReviewNeededReason;
  triggerReasons: ReviewTrigger[];
  body: {
    goal?: string;
    message: string;
    specRef?: string;
    runContract?: unknown;
    diff?: unknown;
    testResults?: unknown;
    riskExplanation?: string;
    pausedTaskStatus?: BoardColumn;
    pausedFeatureStatus?: FeatureLifecycleStatus;
    pausedChildTaskStatuses?: Array<{ id: string; status: BoardColumn }>;
    pausedChildGraphTaskStatuses?: Array<{ id: string; status: BoardColumn }>;
  };
  evidenceRefs: string[];
  recommendedActions: ReviewDecision[];
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRecord = {
  id: string;
  reviewItemId: string;
  decision: ReviewDecision;
  status: "recorded";
  actor: string;
  reason: string;
  decidedAt: string;
  stateTransition?: StateTransition;
  metadata?: Record<string, unknown>;
};

export type ReviewCenterItem = ReviewItem & {
  evidence: Array<{ id: string; summary: string; path?: string; kind?: string }>;
  task?: { id: string; title: string; status: string };
  feature?: { id: string; title: string; status: string };
  approvals: ApprovalRecord[];
};

export type CreateReviewItemInput = Omit<Partial<ReviewItem>, "id" | "status" | "createdAt" | "updatedAt"> & {
  message: string;
  reviewNeededReason: ReviewNeededReason;
  triggerReasons: ReviewTrigger[];
  recommendedActions?: ReviewDecision[];
  pauseEntity?: boolean;
  now?: Date;
};

export type RecordApprovalInput = {
  reviewItemId: string;
  decision: ReviewDecision;
  actor: string;
  reason: string;
  targetStatus?: BoardColumn | FeatureLifecycleStatus;
  evidence?: string;
  now?: Date;
  metadata?: Record<string, unknown>;
};

export function createReviewItem(dbPath: string, input: CreateReviewItemInput): ReviewItem {
  if (input.triggerReasons.length === 0) {
    throw new Error("ReviewItem requires at least one trigger reason.");
  }

  const now = (input.now ?? new Date()).toISOString();
  const id = input.id ?? randomUUID();
  const existing = listReviewCenterItems(dbPath).find((entry) => entry.id === id);
  const context = resolveReviewContext(dbPath, input);
  const severity = input.severity ?? inferSeverity(input.triggerReasons, input.reviewNeededReason);
  const recommendedActions = input.recommendedActions?.length
    ? input.recommendedActions
    : defaultRecommendedActions(input.reviewNeededReason, input.triggerReasons);
  const item: ReviewItem = {
    id,
    projectId: context.projectId,
    featureId: context.featureId,
    taskId: context.taskId,
    runId: context.runId,
    status: "review_needed",
    severity,
    reviewNeededReason: input.reviewNeededReason,
    triggerReasons: input.triggerReasons,
    body: {
      goal: input.body?.goal,
      message: input.message,
      specRef: input.body?.specRef,
      runContract: input.body?.runContract,
      diff: input.body?.diff,
      testResults: input.body?.testResults,
      riskExplanation: input.body?.riskExplanation,
      pausedTaskStatus: existing?.body.pausedTaskStatus ?? context.taskStatus,
      pausedFeatureStatus: existing?.body.pausedFeatureStatus ?? context.featureStatus,
      pausedChildTaskStatuses: existing?.body.pausedChildTaskStatuses ?? context.pausedChildTaskStatuses,
      pausedChildGraphTaskStatuses: existing?.body.pausedChildGraphTaskStatuses ?? context.pausedChildGraphTaskStatuses,
    },
    evidenceRefs: input.evidenceRefs ?? [],
    recommendedActions,
    createdAt: now,
    updatedAt: now,
  };

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO review_items (
        id, project_id, feature_id, task_id, run_id, status, severity, review_needed_reason,
        trigger_reasons_json, recommended_actions_json, evidence_refs_json, body, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        feature_id = excluded.feature_id,
        task_id = excluded.task_id,
        run_id = excluded.run_id,
        status = excluded.status,
        severity = excluded.severity,
        review_needed_reason = excluded.review_needed_reason,
        trigger_reasons_json = excluded.trigger_reasons_json,
        recommended_actions_json = excluded.recommended_actions_json,
        evidence_refs_json = excluded.evidence_refs_json,
        body = excluded.body,
        updated_at = excluded.updated_at`,
      params: [
        item.id,
        item.projectId ?? null,
        item.featureId ?? null,
        item.taskId ?? null,
        item.runId ?? null,
        item.status,
        item.severity,
        item.reviewNeededReason,
        JSON.stringify(item.triggerReasons),
        JSON.stringify(item.recommendedActions),
        JSON.stringify(item.evidenceRefs),
        JSON.stringify(item.body),
        item.createdAt,
        item.updatedAt,
      ],
    },
    ...(input.pauseEntity === false ? [] : reviewPauseStatements(item, now)),
  ]);

  recordAuditEvent(dbPath, {
    entityType: item.taskId ? "task" : "feature",
    entityId: item.taskId ?? item.featureId ?? item.id,
    eventType: "review_item_created",
    source: "review_center",
    reason: item.body.message,
    payload: {
      reviewItemId: item.id,
      reviewNeededReason: item.reviewNeededReason,
      triggerReasons: item.triggerReasons,
      recommendedActions: item.recommendedActions,
    },
  });

  return item;
}

export function listReviewCenterItems(dbPath: string, input: { projectId?: string; status?: ReviewItemStatus } = {}): ReviewCenterItem[] {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (input.projectId) {
    filters.push(`(
      ri.project_id = ?
      OR f.project_id = ?
      OR t.feature_id IN (SELECT id FROM features WHERE project_id = ?)
      OR ri.run_id IN (SELECT id FROM runs WHERE project_id = ?)
    )`);
    params.push(input.projectId, input.projectId, input.projectId, input.projectId);
  }
  if (input.status) {
    filters.push("ri.status = ?");
    params.push(input.status);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = runSqlite(dbPath, [], [
    {
      name: "items",
      sql: `SELECT ri.*, f.title AS feature_title, f.status AS feature_status, f.project_id AS feature_project_id,
          COALESCE(t.title, gt.title) AS task_title,
          COALESCE(t.status, gt.status) AS task_status,
          COALESCE(t.feature_id, gt.feature_id) AS task_feature_id
        FROM review_items ri
        LEFT JOIN features f ON f.id = ri.feature_id
        LEFT JOIN tasks t ON t.id = ri.task_id
        LEFT JOIN task_graph_tasks gt ON gt.id = ri.task_id
        ${where}
        ORDER BY ri.created_at DESC, ri.id ASC`,
      params,
    },
    { name: "evidence", sql: "SELECT id, run_id, task_id, feature_id, path, kind, summary FROM evidence_packs ORDER BY created_at DESC" },
    { name: "approvals", sql: "SELECT * FROM approval_records ORDER BY COALESCE(decided_at, created_at) DESC, rowid DESC" },
  ]);

  return result.queries.items.map((row) => {
    const item = rowToReviewItem(row);
    const evidenceRefs = new Set(item.evidenceRefs);
    const evidence = result.queries.evidence
      .filter((entry) => evidenceRefs.size > 0 ? evidenceRefs.has(String(entry.id)) : linkedEvidenceMatchesReview(entry, item))
      .slice(0, 5)
      .map((entry) => ({
        id: String(entry.id),
        summary: String(entry.summary ?? ""),
        path: optionalString(entry.path),
        kind: optionalString(entry.kind),
      }));
    return {
      ...item,
      evidence,
      task: item.taskId ? { id: item.taskId, title: String(row.task_title ?? ""), status: String(row.task_status ?? "") } : undefined,
      feature: item.featureId ? { id: item.featureId, title: String(row.feature_title ?? ""), status: String(row.feature_status ?? "") } : undefined,
      approvals: result.queries.approvals
        .filter((approval) => approval.review_item_id === item.id)
        .map(rowToApprovalRecord),
    };
  });
}

function linkedEvidenceMatchesReview(entry: Record<string, unknown>, item: ReviewItem): boolean {
  if (item.runId) {
    return entry.run_id === item.runId;
  }
  if (item.taskId) {
    return entry.task_id === item.taskId;
  }
  if (item.featureId) {
    return entry.feature_id === item.featureId;
  }
  return false;
}

export function recordApprovalDecision(dbPath: string, input: RecordApprovalInput): ApprovalRecord {
  const item = listReviewCenterItems(dbPath).find((entry) => entry.id === input.reviewItemId);
  if (!item) {
    throw new Error(`Review item not found: ${input.reviewItemId}`);
  }
  if (item.status === "approved" || item.status === "closed") {
    throw new Error(`Review item ${input.reviewItemId} is already resolved.`);
  }
  assertRecommendedDecision(item, input);
  assertDecisionCanTargetStatus(item, input);
  assertFeatureCanTargetTerminalStatus(dbPath, item, input);
  assertNoOtherOpenReviewsForTerminalTarget(dbPath, item, input);

  const decidedAt = (input.now ?? new Date()).toISOString();
  const stateTransition = buildApprovalTransition(dbPath, item, input, decidedAt);
  const record: ApprovalRecord = {
    id: randomUUID(),
    reviewItemId: input.reviewItemId,
    decision: input.decision,
    status: "recorded",
    actor: input.actor,
    reason: input.reason,
    decidedAt,
    stateTransition,
    metadata: { ...(input.metadata ?? {}), targetStatus: input.targetStatus },
  };
  const nextStatus = reviewStatusForDecision(input.decision);
  const statements: SqlStatement[] = [
    {
      sql: `INSERT INTO approval_records (
        id, review_item_id, decision, status, actor, reason, state_transition_id, metadata_json, decided_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        record.id,
        record.reviewItemId,
        record.decision,
        record.status,
        record.actor,
        record.reason,
        record.stateTransition?.id ?? null,
        JSON.stringify(record.metadata ?? {}),
        record.decidedAt,
        record.decidedAt,
      ],
    },
    {
      sql: "UPDATE review_items SET status = ?, updated_at = ? WHERE id = ?",
      params: [nextStatus, decidedAt, input.reviewItemId],
    },
    ...approvalTargetStatusStatements(item, input, stateTransition, decidedAt),
  ];

  runSqlite(dbPath, statements);
  if (stateTransition) {
    persistApprovalTransition(dbPath, stateTransition);
  }
  recordAuditEvent(dbPath, {
    entityType: "review_item",
    entityId: input.reviewItemId,
    eventType: "approval_recorded",
    source: "review_center",
    reason: input.reason,
    payload: {
      approvalRecordId: record.id,
      decision: input.decision,
      actor: input.actor,
      stateTransitionId: stateTransition?.id,
    },
  });

  return record;
}

export function assertApprovalPresentForTerminalStatus(
  dbPath: string,
  input: { taskId?: string; featureId?: string; targetStatus: BoardColumn | FeatureLifecycleStatus },
): void {
  if (!["done", "delivered"].includes(input.targetStatus)) {
    return;
  }
  const taskFeatureId = input.taskId ? resolveFeatureIdForTask(dbPath, input.taskId) : undefined;
  const items = listReviewCenterItems(dbPath).filter(
    (item) =>
      (input.taskId && item.taskId === input.taskId) ||
      (input.featureId && item.featureId === input.featureId) ||
      (taskFeatureId && item.featureId === taskFeatureId && !item.taskId),
  );
  const blocking = items.filter((item) => item.status !== "approved" && item.status !== "closed");
  if (blocking.length > 0) {
    throw new Error(`Positive approval required before ${input.targetStatus}: ${blocking.map((item) => item.id).join(", ")}`);
  }
  const terminalApprovalItems = (input.taskId ? items.filter((item) => item.taskId === input.taskId) : items.filter((item) => !item.taskId))
    .filter((item) => requiresTerminalApprovalGate(item, input.targetStatus));
  if (terminalApprovalItems.length > 0 && !hasTerminalApprovalSinceLatestReview(terminalApprovalItems, input.targetStatus)) {
    throw new Error(`Terminal approval required before ${input.targetStatus}.`);
  }
}

function resolveFeatureIdForTask(dbPath: string, taskId: string): string | undefined {
  const result = runSqlite(dbPath, [], [
    {
      name: "feature",
      sql: `SELECT COALESCE(
          (SELECT feature_id FROM tasks WHERE id = ?),
          (SELECT feature_id FROM task_graph_tasks WHERE id = ?)
        ) AS feature_id`,
      params: [taskId, taskId],
    },
  ]);
  return optionalString(result.queries.feature[0]?.feature_id);
}

function buildApprovalTransition(dbPath: string, item: ReviewCenterItem, input: RecordApprovalInput, occurredAt: string): StateTransition | undefined {
  if (!input.targetStatus) {
    return undefined;
  }
  const evidence = input.evidence ?? `review:${input.reviewItemId}`;
  if (item.taskId) {
    if (hasOpenTaskReviews(dbPath, item.taskId, item.id)) {
      return undefined;
    }
    const from = currentTaskStatus(item);
    const to = input.targetStatus as BoardColumn;
    if (from === to) {
      return approvalSelfTransition("task", item.taskId, from, to, input.reason, evidence, occurredAt);
    }
    return transitionTask(item.taskId, from, to, {
      reason: input.reason,
      evidence,
      triggeredBy: "review_center",
    });
  }
  if (item.featureId) {
    if (hasOpenReviewsForFeature(dbPath, item.featureId, item.id)) {
      return undefined;
    }
    const from = currentFeatureStatus(item);
    const to = input.targetStatus as FeatureLifecycleStatus;
    if (from === to) {
      return approvalSelfTransition("feature", item.featureId, from, to, input.reason, evidence, occurredAt);
    }
    return transitionFeature(item.featureId, from, to, {
      reason: input.reason,
      evidence,
      triggeredBy: "review_center",
    });
  }
  return undefined;
}

function approvalSelfTransition(
  entityType: "feature" | "task",
  entityId: string,
  from: FeatureLifecycleStatus | BoardColumn,
  to: FeatureLifecycleStatus | BoardColumn,
  reason: string,
  evidence: string,
  occurredAt: string,
): StateTransition {
  return {
    id: randomUUID(),
    entityType,
    entityId,
    from,
    to,
    reason,
    evidence,
    triggeredBy: "review_center",
    occurredAt,
  };
}

function persistApprovalTransition(dbPath: string, transition: StateTransition): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO state_transitions (
        id, entity_type, entity_id, from_status, to_status, reason, evidence,
        triggered_by, review_needed_reason, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        transition.id,
        transition.entityType,
        transition.entityId,
        transition.from,
        transition.to,
        transition.reason,
        transition.evidence,
        transition.triggeredBy,
        transition.reviewNeededReason ?? null,
        transition.occurredAt,
      ],
    },
  ]);
  recordAuditEvent(dbPath, {
    entityType: transition.entityType,
    entityId: transition.entityId,
    eventType: "state_changed",
    source: "review_center",
    reason: transition.reason,
    payload: {
      from: transition.from,
      to: transition.to,
      evidence: transition.evidence,
      reviewNeededReason: transition.reviewNeededReason,
    },
  });
}

function approvalTargetStatusStatements(item: ReviewItem, input: RecordApprovalInput, transition: StateTransition | undefined, updatedAt: string): SqlStatement[] {
  if (!transition) {
    return [];
  }
  if (transition.entityType === "task" && item.taskId) {
    return [
      { sql: "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", params: [transition.to, updatedAt, item.taskId] },
      {
        sql: `UPDATE task_graph_tasks
          SET status = ?, updated_at = ?
          WHERE id = ?
            OR (
              feature_id = ?
              AND title = (SELECT title FROM tasks WHERE id = ?)
              AND (
                SELECT COUNT(*) FROM task_graph_tasks
                WHERE feature_id = ?
                  AND title = (SELECT title FROM tasks WHERE id = ?)
              ) = 1
            )`,
        params: [transition.to, updatedAt, item.taskId, item.featureId ?? "", item.taskId, item.featureId ?? "", item.taskId],
      },
      ...parentFeatureStatusStatements(item.featureId, updatedAt, item.body.pausedFeatureStatus),
    ];
  }
  if (transition.entityType === "feature" && item.featureId) {
    return [
      { sql: "UPDATE features SET status = ?, updated_at = ? WHERE id = ?", params: [transition.to, updatedAt, item.featureId] },
      ...featureChildRestoreStatements(item, input, updatedAt),
      ...featureReviewGateStatusStatements(item.featureId, updatedAt),
    ];
  }
  return [];
}

function featureChildRestoreStatements(item: ReviewItem, input: RecordApprovalInput, updatedAt: string): SqlStatement[] {
  if (!["approve_continue", "request_changes", "update_spec"].includes(input.decision)) {
    return [];
  }
  return [
    ...(item.body.pausedChildTaskStatuses ?? []).map((entry) => ({
      sql: `UPDATE tasks
        SET status = ?, updated_at = ?
        WHERE id = ?
          AND status = 'review_needed'
          AND NOT EXISTS (
            SELECT 1 FROM review_items
            WHERE task_id = tasks.id
              AND id <> ?
              AND status IN ('review_needed', 'changes_requested', 'rejected')
          )`,
      params: [entry.status, updatedAt, entry.id, item.id],
    })),
    ...(item.body.pausedChildGraphTaskStatuses ?? []).map((entry) => ({
      sql: `UPDATE task_graph_tasks
        SET status = ?, updated_at = ?
        WHERE id = ?
          AND status = 'review_needed'
          AND NOT EXISTS (
            SELECT 1 FROM review_items
            WHERE (
                task_id = task_graph_tasks.id
                OR task_id IN (
                  SELECT t.id FROM tasks t
                  WHERE t.feature_id = task_graph_tasks.feature_id
                    AND t.title = task_graph_tasks.title
                )
              )
              AND id <> ?
              AND status IN ('review_needed', 'changes_requested', 'rejected')
          )`,
      params: [entry.status, updatedAt, entry.id, item.id],
    })),
  ];
}

function reviewPauseStatements(item: ReviewItem, updatedAt: string): SqlStatement[] {
  if (item.taskId) {
    return [
      { sql: "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('failed', 'blocked', 'done', 'delivered')", params: ["review_needed", updatedAt, item.taskId] },
      {
        sql: `UPDATE task_graph_tasks
          SET status = ?, updated_at = ?
          WHERE (
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
            )
            AND status NOT IN ('failed', 'blocked', 'done', 'delivered')`,
        params: ["review_needed", updatedAt, item.taskId, item.featureId ?? "", item.taskId, item.featureId ?? "", item.taskId],
      },
      ...parentFeatureStatusStatements(item.featureId, updatedAt, item.body.pausedFeatureStatus),
    ];
  }
  if (item.featureId) {
    return [
      { sql: "UPDATE features SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('failed', 'blocked', 'done', 'delivered')", params: ["review_needed", updatedAt, item.featureId] },
      { sql: "UPDATE tasks SET status = ?, updated_at = ? WHERE feature_id = ? AND status NOT IN ('failed', 'blocked', 'review_needed', 'done', 'delivered')", params: ["review_needed", updatedAt, item.featureId] },
      { sql: "UPDATE task_graph_tasks SET status = ?, updated_at = ? WHERE feature_id = ? AND status NOT IN ('failed', 'blocked', 'review_needed', 'done', 'delivered')", params: ["review_needed", updatedAt, item.featureId] },
    ];
  }
  return [];
}

function parentFeatureStatusStatements(featureId: string | undefined, updatedAt: string, pausedStatus?: FeatureLifecycleStatus): SqlStatement[] {
  if (!featureId) {
    return [];
  }
  return [
    {
      sql: `UPDATE features
        SET status = CASE
            WHEN status = 'delivered' THEN 'delivered'
            WHEN NOT EXISTS (SELECT 1 FROM tasks WHERE feature_id = ?)
              AND NOT EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ?) THEN 'review_needed'
            WHEN EXISTS (SELECT 1 FROM tasks WHERE feature_id = ? AND status = 'failed') THEN 'failed'
            WHEN EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ? AND status = 'failed') THEN 'failed'
            WHEN EXISTS (SELECT 1 FROM tasks WHERE feature_id = ? AND status = 'blocked') THEN 'blocked'
            WHEN EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ? AND status = 'blocked') THEN 'blocked'
            WHEN EXISTS (SELECT 1 FROM tasks WHERE feature_id = ? AND status = 'review_needed') THEN 'review_needed'
            WHEN EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ? AND status = 'review_needed') THEN 'review_needed'
            WHEN EXISTS (SELECT 1 FROM review_items WHERE feature_id = ? AND task_id IS NULL AND status IN ('review_needed', 'changes_requested', 'rejected')) THEN 'review_needed'
            WHEN NOT EXISTS (SELECT 1 FROM tasks WHERE feature_id = ? AND status NOT IN ('done', 'delivered'))
              AND NOT EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ? AND status NOT IN ('done', 'delivered')) THEN 'done'
            ELSE ?
          END,
          updated_at = ?
        WHERE id = ?`,
      params: [
        featureId,
        featureId,
        featureId,
        featureId,
        featureId,
        featureId,
        featureId,
        featureId,
        featureId,
        featureId,
        featureId,
        parentFeatureFallbackStatus(pausedStatus),
        updatedAt,
        featureId,
      ],
    },
  ];
}

function featureReviewGateStatusStatements(featureId: string, updatedAt: string): SqlStatement[] {
  return [
    {
      sql: `UPDATE features
        SET status = CASE
            WHEN EXISTS (SELECT 1 FROM tasks WHERE feature_id = ? AND status = 'failed') THEN 'failed'
            WHEN EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ? AND status = 'failed') THEN 'failed'
            WHEN EXISTS (SELECT 1 FROM tasks WHERE feature_id = ? AND status = 'blocked') THEN 'blocked'
            WHEN EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ? AND status = 'blocked') THEN 'blocked'
            WHEN EXISTS (SELECT 1 FROM tasks WHERE feature_id = ? AND status = 'review_needed') THEN 'review_needed'
            WHEN EXISTS (SELECT 1 FROM task_graph_tasks WHERE feature_id = ? AND status = 'review_needed') THEN 'review_needed'
            WHEN EXISTS (
              SELECT 1 FROM review_items
              WHERE feature_id = ?
                AND task_id IS NOT NULL
                AND status IN ('review_needed', 'changes_requested', 'rejected')
            ) THEN 'review_needed'
            ELSE status
          END,
          updated_at = ?
        WHERE id = ?`,
      params: [featureId, featureId, featureId, featureId, featureId, featureId, featureId, updatedAt, featureId],
    },
  ];
}

function assertFeatureCanTargetTerminalStatus(dbPath: string, item: ReviewCenterItem, input: RecordApprovalInput): void {
  if (item.taskId || !item.featureId || !["done", "delivered"].includes(input.targetStatus ?? "")) {
    return;
  }
  const result = runSqlite(dbPath, [], [
    { name: "tasks", sql: "SELECT id, status FROM tasks WHERE feature_id = ? ORDER BY id", params: [item.featureId] },
    { name: "graphTasks", sql: "SELECT id, status FROM task_graph_tasks WHERE feature_id = ? ORDER BY id", params: [item.featureId] },
  ]);
  const workItems = [...result.queries.tasks, ...result.queries.graphTasks];
  const openWorkItems = workItems.filter((workItem) => !["done", "delivered"].includes(String(workItem.status)));
  if (workItems.length === 0 || openWorkItems.length > 0) {
    throw new Error(`Feature ${item.featureId} cannot target ${input.targetStatus} until all child tasks are done or delivered.`);
  }
}

function assertNoOtherOpenReviewsForTerminalTarget(dbPath: string, item: ReviewCenterItem, input: RecordApprovalInput): void {
  if (!["done", "delivered"].includes(input.targetStatus ?? "")) {
    return;
  }
  const items = listReviewCenterItems(dbPath).filter(
    (entry) =>
      entry.id !== item.id &&
      entry.status !== "approved" &&
      entry.status !== "closed" &&
      (
        (item.taskId && (entry.taskId === item.taskId || (!entry.taskId && item.featureId && entry.featureId === item.featureId))) ||
        (!item.taskId && item.featureId && entry.featureId === item.featureId)
      ),
  );
  if (items.length > 0) {
    throw new Error(`Cannot target ${input.targetStatus} while unresolved reviews remain: ${items.map((entry) => entry.id).join(", ")}`);
  }
}

function hasOpenFeatureReviews(dbPath: string, featureId: string, excludeReviewItemId: string): boolean {
  return hasOpenReviewsForFeature(dbPath, featureId, excludeReviewItemId, { featureLevelOnly: true });
}

function hasOpenTaskReviews(dbPath: string, taskId: string, excludeReviewItemId: string): boolean {
  return listReviewCenterItems(dbPath).some(
    (entry) =>
      entry.id !== excludeReviewItemId &&
      entry.taskId === taskId &&
      entry.status !== "approved" &&
      entry.status !== "closed",
  );
}

function hasOpenReviewsForFeature(
  dbPath: string,
  featureId: string,
  excludeReviewItemId: string,
  options: { featureLevelOnly?: boolean } = {},
): boolean {
  return listReviewCenterItems(dbPath).some(
    (entry) =>
      entry.id !== excludeReviewItemId &&
      entry.featureId === featureId &&
      (!options.featureLevelOnly || !entry.taskId) &&
      entry.status !== "approved" &&
      entry.status !== "closed",
  );
}

function resolveReviewContext(dbPath: string, input: CreateReviewItemInput): {
  projectId?: string;
  featureId?: string;
  taskId?: string;
  runId?: string;
  taskStatus?: BoardColumn;
  featureStatus?: FeatureLifecycleStatus;
  pausedChildTaskStatuses?: Array<{ id: string; status: BoardColumn }>;
  pausedChildGraphTaskStatuses?: Array<{ id: string; status: BoardColumn }>;
} {
  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT id, feature_id, title, status FROM tasks WHERE id = ?", params: [input.taskId ?? ""] },
    {
      name: "graphTask",
      sql: `SELECT id, feature_id, status FROM task_graph_tasks
        WHERE id = ?
          OR (
            feature_id = COALESCE(?, (SELECT feature_id FROM tasks WHERE id = ?))
            AND title = (SELECT title FROM tasks WHERE id = ?)
            AND (
              SELECT COUNT(*) FROM task_graph_tasks
              WHERE feature_id = COALESCE(?, (SELECT feature_id FROM tasks WHERE id = ?))
                AND title = (SELECT title FROM tasks WHERE id = ?)
            ) = 1
          )
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
        LIMIT 1`,
      params: [
        input.taskId ?? "",
        input.featureId ?? null,
        input.taskId ?? "",
        input.taskId ?? "",
        input.featureId ?? null,
        input.taskId ?? "",
        input.taskId ?? "",
        input.taskId ?? "",
      ],
    },
    { name: "run", sql: "SELECT id, task_id, feature_id, project_id FROM runs WHERE id = ?", params: [input.runId ?? ""] },
    {
      name: "feature",
      sql: `SELECT id, project_id, status FROM features
        WHERE id = COALESCE(
          ?,
          (SELECT feature_id FROM tasks WHERE id = ?),
          (SELECT feature_id FROM task_graph_tasks WHERE id = ?),
          (SELECT feature_id FROM runs WHERE id = ?)
        )`,
      params: [input.featureId ?? null, input.taskId ?? "", input.taskId ?? "", input.runId ?? ""],
    },
  ]);
  const task = result.queries.task[0];
  const graphTask = result.queries.graphTask[0];
  const run = result.queries.run[0];
  const feature = result.queries.feature[0];
  const taskId = input.taskId ?? optionalString(run?.task_id);
  const featureId = input.featureId ?? optionalString(task?.feature_id) ?? optionalString(graphTask?.feature_id) ?? optionalString(run?.feature_id) ?? optionalString(feature?.id);
  const childStatuses = featureId && !taskId ? resolveFeatureChildStatuses(dbPath, featureId) : undefined;
  return {
    projectId: input.projectId ?? optionalString(run?.project_id) ?? optionalString(feature?.project_id),
    featureId,
    taskId,
    runId: input.runId,
    taskStatus: (optionalString(task?.status) ?? optionalString(graphTask?.status)) as BoardColumn | undefined,
    featureStatus: optionalString(feature?.status) as FeatureLifecycleStatus | undefined,
    pausedChildTaskStatuses: childStatuses?.tasks,
    pausedChildGraphTaskStatuses: childStatuses?.graphTasks,
  };
}

function resolveFeatureChildStatuses(
  dbPath: string,
  featureId: string,
): { tasks: Array<{ id: string; status: BoardColumn }>; graphTasks: Array<{ id: string; status: BoardColumn }> } {
  const pausableStatuses = ["backlog", "ready", "scheduled", "running", "checking", "review_needed"];
  const result = runSqlite(dbPath, [], [
    {
      name: "tasks",
      sql: "SELECT id, status FROM tasks WHERE feature_id = ? AND status IN ('backlog', 'ready', 'scheduled', 'running', 'checking', 'review_needed') ORDER BY id",
      params: [featureId],
    },
    {
      name: "graphTasks",
      sql: "SELECT id, status FROM task_graph_tasks WHERE feature_id = ? AND status IN ('backlog', 'ready', 'scheduled', 'running', 'checking', 'review_needed') ORDER BY id",
      params: [featureId],
    },
  ]);
  const previousFeatureReviews = listReviewCenterItems(dbPath).filter(
    (item) =>
      item.featureId === featureId &&
      !item.taskId &&
      item.status !== "approved" &&
      item.status !== "closed",
  );
  return {
    tasks: result.queries.tasks
      .filter((row) => pausableStatuses.includes(String(row.status)))
      .map((row) => ({
        id: String(row.id),
        status: childSnapshotStatus(previousFeatureReviews, "task", String(row.id), String(row.status) as BoardColumn),
      })),
    graphTasks: result.queries.graphTasks
      .filter((row) => pausableStatuses.includes(String(row.status)))
      .map((row) => ({
        id: String(row.id),
        status: childSnapshotStatus(previousFeatureReviews, "graphTask", String(row.id), String(row.status) as BoardColumn),
      })),
  };
}

function childSnapshotStatus(
  previousFeatureReviews: ReviewCenterItem[],
  kind: "task" | "graphTask",
  id: string,
  currentStatus: BoardColumn,
): BoardColumn {
  if (currentStatus !== "review_needed") {
    return currentStatus;
  }
  const field = kind === "task" ? "pausedChildTaskStatuses" : "pausedChildGraphTaskStatuses";
  for (const review of previousFeatureReviews) {
    const snapshot = review.body[field]?.find((entry) => entry.id === id);
    if (snapshot && snapshot.status !== "review_needed") {
      return snapshot.status;
    }
  }
  return currentStatus;
}

function currentTaskStatus(item: ReviewCenterItem): BoardColumn {
  return (item.task?.status || "review_needed") as BoardColumn;
}

function currentFeatureStatus(item: ReviewCenterItem): FeatureLifecycleStatus {
  return (item.feature?.status || "review_needed") as FeatureLifecycleStatus;
}

function inferSeverity(triggers: ReviewTrigger[], reason: ReviewNeededReason): RiskLevel | "critical" {
  if (triggers.includes("constitution_change") || triggers.includes("permission_escalation")) return "critical";
  if (triggers.includes("forbidden_file") || triggers.includes("architecture_change")) return "high";
  if (reason === "clarification_needed") return "medium";
  return "high";
}

function defaultRecommendedActions(reason: ReviewNeededReason, triggers: ReviewTrigger[]): ReviewDecision[] {
  if (reason === "clarification_needed") return ["request_changes", "update_spec"];
  if (reason === "approval_needed") return ["approve_continue", "mark_complete", "reject", "request_changes"];
  if (triggers.includes("forbidden_file")) return ["reject", "rollback", "request_changes"];
  if (triggers.includes("repeated_failure") || triggers.includes("failed_tests_continue")) return ["rollback", "split_task", "request_changes"];
  return ["approve_continue", "reject", "request_changes"];
}

function assertRecommendedDecision(item: ReviewCenterItem, input: RecordApprovalInput): void {
  if (item.recommendedActions.includes(input.decision)) {
    return;
  }
  throw new Error(`Decision ${input.decision} is not recommended for review item ${item.id}.`);
}

function reviewStatusForDecision(decision: ReviewDecision): ReviewItemStatus {
  if (decision === "approve_continue" || decision === "mark_complete") return "approved";
  if (decision === "reject") return "rejected";
  if (decision === "request_changes" || decision === "rollback" || decision === "split_task" || decision === "update_spec") {
    return "changes_requested";
  }
  return "closed";
}

function assertDecisionCanTargetStatus(item: ReviewCenterItem, input: RecordApprovalInput): void {
  const targetStatus = input.targetStatus;
  if (input.decision === "mark_complete" && (!targetStatus || !["done", "delivered"].includes(targetStatus))) {
    throw new Error("Decision mark_complete requires a terminal target status.");
  }
  if (!targetStatus || !["done", "delivered"].includes(targetStatus)) {
    return;
  }
  if (input.decision !== "mark_complete") {
    throw new Error(`Decision ${input.decision} cannot target terminal status ${targetStatus}.`);
  }
  const pausedStatus = item.taskId ? item.body.pausedTaskStatus : item.body.pausedFeatureStatus;
  if (pausedStatus !== targetStatus) {
    throw new Error(`Decision mark_complete cannot target ${targetStatus} for work paused from ${pausedStatus ?? "unknown"}.`);
  }
}

function hasTerminalApprovalSinceLatestReview(scoped: ReviewCenterItem[], targetStatus: BoardColumn | FeatureLifecycleStatus): boolean {
  const latestReviewAt = scoped.reduce((latest, item) => item.createdAt > latest ? item.createdAt : latest, "");
  return scoped.some((item) =>
    item.status === "approved" &&
    (
      (item.approvals.length === 0 && item.createdAt >= latestReviewAt) ||
      item.approvals.some((approval) =>
        approval.decidedAt >= latestReviewAt &&
        (
          (approval.decision === "mark_complete" && approval.metadata?.targetStatus === targetStatus) ||
          (
            approval.decision === "approve_continue" &&
            terminalPausedStatus(item, targetStatus)
          )
        ),
      )
    ),
  );
}

function requiresTerminalApprovalGate(item: ReviewCenterItem, targetStatus: BoardColumn | FeatureLifecycleStatus): boolean {
  return terminalPausedStatus(item, targetStatus) || (item.status === "approved" && item.approvals.length === 0);
}

function parentFeatureFallbackStatus(pausedStatus?: FeatureLifecycleStatus): FeatureLifecycleStatus {
  return pausedStatus && !["done", "delivered"].includes(pausedStatus) ? pausedStatus : "implementing";
}

function terminalPausedStatus(item: ReviewCenterItem, targetStatus: BoardColumn | FeatureLifecycleStatus): boolean {
  const pausedStatus = item.taskId ? item.body.pausedTaskStatus : item.body.pausedFeatureStatus;
  return pausedStatus === targetStatus && (pausedStatus === "done" || pausedStatus === "delivered");
}

function rowToReviewItem(row: Record<string, unknown>): ReviewItem {
  const body = parseJsonObject(row.body);
  const now = String(row.created_at ?? "");
  return {
    id: String(row.id),
    projectId: optionalString(row.project_id) ?? optionalString(row.feature_project_id),
    featureId: optionalString(row.feature_id) ?? optionalString(row.task_feature_id),
    taskId: optionalString(row.task_id),
    runId: optionalString(row.run_id),
    status: String(row.status) as ReviewItemStatus,
    severity: String(row.severity) as RiskLevel | "critical",
    reviewNeededReason: (optionalString(row.review_needed_reason) ?? "risk_review_needed") as ReviewNeededReason,
    triggerReasons: parseJsonStringArray(row.trigger_reasons_json) as ReviewTrigger[],
    body: {
      goal: optionalString(body.goal),
      message: typeof body.message === "string" ? body.message : String(row.body ?? ""),
      specRef: optionalString(body.specRef),
      runContract: body.runContract,
      diff: body.diff,
      testResults: body.testResults,
      riskExplanation: optionalString(body.riskExplanation),
      pausedTaskStatus: optionalString(body.pausedTaskStatus) as BoardColumn | undefined,
      pausedFeatureStatus: optionalString(body.pausedFeatureStatus) as FeatureLifecycleStatus | undefined,
      pausedChildTaskStatuses: parseStatusSnapshots(body.pausedChildTaskStatuses),
      pausedChildGraphTaskStatuses: parseStatusSnapshots(body.pausedChildGraphTaskStatuses),
    },
    evidenceRefs: parseJsonStringArray(row.evidence_refs_json),
    recommendedActions: parseJsonStringArray(row.recommended_actions_json) as ReviewDecision[],
    createdAt: now,
    updatedAt: String(row.updated_at ?? now),
  };
}

function parseStatusSnapshots(value: unknown): Array<{ id: string; status: BoardColumn }> {
  return Array.isArray(value)
    ? value
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
      .filter((entry) => typeof entry.id === "string" && typeof entry.status === "string")
      .map((entry) => ({ id: String(entry.id), status: String(entry.status) as BoardColumn }))
    : [];
}

function rowToApprovalRecord(row: Record<string, unknown>): ApprovalRecord {
  return {
    id: String(row.id),
    reviewItemId: String(row.review_item_id),
    decision: (optionalString(row.decision) ?? optionalString(row.status) ?? "request_changes") as ReviewDecision,
    status: "recorded",
    actor: optionalString(row.actor) ?? "",
    reason: optionalString(row.reason) ?? "",
    decidedAt: optionalString(row.decided_at) ?? optionalString(row.created_at) ?? "",
    metadata: parseJsonObject(row.metadata_json),
  };
}

function parseJsonStringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : String(value);
}
