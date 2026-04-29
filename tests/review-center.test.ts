import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables, MIGRATIONS, SCHEMA_VERSION } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import { listAuditEvents } from "../src/persistence.ts";
import { submitConsoleCommand } from "../src/product-console.ts";
import {
  assertApprovalPresentForTerminalStatus,
  createReviewItem,
  listReviewCenterItems,
  recordApprovalDecision,
} from "../src/review-center.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

test("current schema includes review center approval context", () => {
  const dbPath = makeDbPath();
  const state = initializeSchema(dbPath);

  assert.equal(SCHEMA_VERSION, 14);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  const tables = listTables(dbPath);
  assert.equal(tables.includes("review_items"), true);
  assert.equal(tables.includes("approval_records"), true);
});

test("schema migration leaves legacy review evidence references explicit", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath, MIGRATIONS.filter((migration) => migration.version < 9));
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO features (id, project_id, title, status, priority, folder, primary_requirements_json)
        VALUES ('FEAT-LEGACY', 'project-1', 'Legacy Review', 'review_needed', 10, 'feat-legacy', '[]')`,
    },
    {
      sql: `INSERT INTO review_items (id, feature_id, status, severity, body, created_at)
        VALUES ('REV-LEGACY', 'FEAT-LEGACY', 'review_needed', 'high', '{"message":"Legacy review"}', '2026-04-28T11:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO evidence_packs (id, run_id, task_id, feature_id, path, kind, summary, metadata_json, created_at)
        VALUES ('EVID-LEGACY', 'RUN-LEGACY', NULL, 'FEAT-LEGACY', '.autobuild/evidence/legacy.json', 'status_checker', 'Legacy evidence.', '{}', '2026-04-28T11:01:00.000Z')`,
    },
    {
      sql: `INSERT INTO evidence_packs (id, run_id, task_id, feature_id, path, kind, summary, metadata_json, created_at)
        VALUES ('EVID-OTHER-TASK', 'RUN-OTHER', 'TASK-OTHER', 'FEAT-LEGACY', '.autobuild/evidence/other.json', 'status_checker', 'Other task evidence.', '{}', '2026-04-28T11:02:00.000Z')`,
    },
  ]);

  initializeSchema(dbPath);

  const item = listReviewCenterItems(dbPath).find((entry) => entry.id === "REV-LEGACY");
  assert.deepEqual(item?.evidenceRefs, []);
  assert.equal(item?.evidence[0].id, "EVID-LEGACY");
  assert.equal(item?.evidence.some((entry) => entry.id === "EVID-OTHER-TASK"), false);
  assert.deepEqual(item?.recommendedActions, ["approve_continue", "mark_complete", "reject", "request_changes"]);
});

test("schema migration preserves legacy approval decisions", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath, MIGRATIONS.filter((migration) => migration.version < 9));
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO review_items (id, feature_id, status, severity, body, created_at)
        VALUES ('REV-LEGACY-APPROVAL', 'FEAT-LEGACY', 'review_needed', 'high', '{"message":"Legacy review"}', '2026-04-28T11:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO approval_records (id, review_item_id, status, actor, decided_at)
        VALUES ('APPROVAL-LEGACY-APPROVED', 'REV-LEGACY-APPROVAL', 'approved', 'reviewer', '2026-04-28T11:01:00.000Z')`,
    },
    {
      sql: `INSERT INTO approval_records (id, review_item_id, status, actor, decided_at)
        VALUES ('APPROVAL-LEGACY-REJECTED', 'REV-LEGACY-APPROVAL', 'rejected', 'reviewer', '2026-04-28T11:02:00.000Z')`,
    },
    {
      sql: `INSERT INTO approval_records (id, review_item_id, status, actor, decided_at)
        VALUES ('APPROVAL-LEGACY-CHANGES', 'REV-LEGACY-APPROVAL', 'changes_requested', 'reviewer', '2026-04-28T11:03:00.000Z')`,
    },
  ]);

  initializeSchema(dbPath);

  const result = runSqlite(dbPath, [], [
    { name: "approvals", sql: "SELECT id, decision FROM approval_records ORDER BY id" },
  ]);
  assert.deepEqual(result.queries.approvals.map((row) => [row.id, row.decision]), [
    ["APPROVAL-LEGACY-APPROVED", "approve_continue"],
    ["APPROVAL-LEGACY-CHANGES", "request_changes"],
    ["APPROVAL-LEGACY-REJECTED", "reject"],
  ]);
});

test("legacy approved review items without approval rows still satisfy terminal gate", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath, MIGRATIONS.filter((migration) => migration.version < 9));
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO features (id, project_id, title, status, priority, folder, primary_requirements_json)
        VALUES ('FEAT-LEGACY-APPROVED', 'project-1', 'Legacy Approved Review', 'done', 10, 'feat-legacy-approved', '[]')`,
    },
    {
      sql: `INSERT INTO review_items (id, feature_id, status, severity, body, created_at)
        VALUES ('REV-LEGACY-APPROVED', 'FEAT-LEGACY-APPROVED', 'approved', 'high', '{"message":"Legacy approved review"}', '2026-04-28T11:00:00.000Z')`,
    },
  ]);

  initializeSchema(dbPath);

  assert.doesNotThrow(() => assertApprovalPresentForTerminalStatus(dbPath, { featureId: "FEAT-LEGACY-APPROVED", targetStatus: "done" }));
});

test("review router records clarification, approval, and risk review reasons with actions", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO evidence_packs (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES ('EVID-OTHER', 'RUN-011', 'TASK-011', 'FEAT-011', '.autobuild/evidence/unrelated.json', 'status_checker', 'Unrelated evidence.', '{}')`,
    },
  ]);

  const clarification = createReviewItem(dbPath, {
    id: "REV-CLARIFY",
    featureId: "FEAT-011",
    taskId: "TASK-011",
    runId: "RUN-011",
    message: "Ambiguous acceptance scope needs reviewer input.",
    reviewNeededReason: "clarification_needed",
    triggerReasons: ["high_impact_ambiguity"],
    now: stableDate,
  });
  const approval = createReviewItem(dbPath, {
    id: "REV-APPROVAL",
    featureId: "FEAT-011",
    taskId: "TASK-011",
    runId: "RUN-011",
    message: "Permission escalation requires approval.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    evidenceRefs: ["EVID-011"],
    now: stableDate,
  });
  const risk = createReviewItem(dbPath, {
    id: "REV-RISK",
    featureId: "FEAT-011",
    taskId: "TASK-011",
    runId: "RUN-011",
    message: "Forbidden file and architecture change require review.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["forbidden_file", "architecture_change"],
    body: {
      diff: { files: [".env", "src/review-center.ts"] },
      testResults: { unit: "passed" },
      riskExplanation: "Forbidden files must be reviewed before the task can continue.",
    },
    now: stableDate,
  });

  assert.deepEqual(clarification.recommendedActions, ["request_changes", "update_spec"]);
  assert.equal(approval.severity, "critical");
  assert.deepEqual(risk.recommendedActions, ["reject", "rollback", "request_changes"]);

  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => item.reviewNeededReason).sort(), [
    "approval_needed",
    "clarification_needed",
    "risk_review_needed",
  ]);
  assert.equal(items.find((item) => item.id === "REV-RISK")?.body.diff !== undefined, true);
  assert.equal(items.find((item) => item.id === "REV-APPROVAL")?.evidence[0].id, "EVID-011");
  assert.equal(items.find((item) => item.id === "REV-APPROVAL")?.evidence.length, 1);
  assert.equal(items.find((item) => item.id === "REV-RISK")?.evidence.length, 0);
});

test("review decisions cannot bypass recommended safety actions", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-FORBIDDEN-APPROVE",
    taskId: "TASK-011",
    message: "Forbidden file reviews cannot be approved through continue.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["forbidden_file"],
    now: stableDate,
  });

  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-FORBIDDEN-APPROVE",
        decision: "approve_continue",
        actor: "reviewer",
        reason: "Unsafe approval should be rejected.",
        targetStatus: "ready",
        now: stableDate,
      }),
    /not recommended/,
  );
  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-FORBIDDEN-APPROVE",
        decision: "mark_complete",
        actor: "reviewer",
        reason: "Unsafe completion should be rejected.",
        targetStatus: "done",
        now: stableDate,
      }),
    /not recommended/,
  );
});

test("task-scoped reviews inherit feature and project context", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [{ sql: "UPDATE features SET status = 'implementing' WHERE id = 'FEAT-011'" }]);

  const item = createReviewItem(dbPath, {
    id: "REV-TASK-ONLY",
    taskId: "TASK-011",
    message: "Task-only review still belongs to the feature.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["high_risk_file"],
    now: stableDate,
  });

  assert.equal(item.featureId, "FEAT-011");
  assert.equal(item.projectId, "project-1");
  assert.equal(listReviewCenterItems(dbPath, { projectId: "project-1" }).some((entry) => entry.id === "REV-TASK-ONLY"), true);
  assert.equal(runSqlite(dbPath, [], [{ name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" }]).queries.feature[0].status, "review_needed");
  assert.throws(
    () => assertApprovalPresentForTerminalStatus(dbPath, { featureId: "FEAT-011", targetStatus: "delivered" }),
    /Positive approval required/,
  );
});

test("refreshing an open review preserves original paused state", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [{ sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" }]);
  createReviewItem(dbPath, {
    id: "REV-REFRESH-PRESERVE-PAUSE",
    taskId: "TASK-011",
    message: "Initial review pauses running work.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["high_risk_file"],
    now: stableDate,
  });
  createReviewItem(dbPath, {
    id: "REV-REFRESH-PRESERVE-PAUSE",
    taskId: "TASK-011",
    message: "Refreshed review should keep the original paused state.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["high_risk_file"],
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  const item = listReviewCenterItems(dbPath).find((entry) => entry.id === "REV-REFRESH-PRESERVE-PAUSE");
  assert.equal(item?.body.pausedTaskStatus, "running");
});

test("graph-task-only reviews inherit context and pause the parent feature", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "DELETE FROM tasks WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'ready' WHERE id = 'TASK-011'" },
    { sql: "UPDATE features SET status = 'implementing' WHERE id = 'FEAT-011'" },
  ]);

  const item = createReviewItem(dbPath, {
    id: "REV-GRAPH-TASK-ONLY",
    taskId: "TASK-011",
    message: "Graph task review should still carry feature context.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["high_risk_file"],
    now: stableDate,
  });

  assert.equal(item.featureId, "FEAT-011");
  assert.equal(item.projectId, "project-1");
  assert.equal(item.body.pausedTaskStatus, "ready");
  const paused = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(paused.queries.feature[0].status, "review_needed");
  assert.equal(paused.queries.graphTask[0].status, "review_needed");
});

test("graph-task-only approvals use live graph task status", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "DELETE FROM tasks WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'ready' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-GRAPH-LIVE-STATUS",
    taskId: "TASK-011",
    message: "Graph task review should use graph task status.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["high_risk_file"],
    now: stableDate,
  });
  runSqlite(dbPath, [{ sql: "UPDATE task_graph_tasks SET status = 'blocked' WHERE id = 'TASK-011'" }]);

  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-GRAPH-LIVE-STATUS",
        decision: "approve_continue",
        actor: "reviewer",
        reason: "Blocked graph task should not jump to ready.",
        targetStatus: "ready",
        now: stableDate,
      }),
    /Illegal task transition/,
  );
});

test("task reviews synchronize uniquely matched graph tasks when ids differ", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE tasks SET status = 'ready' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET id = 'GRAPH-TASK-011', status = 'ready' WHERE id = 'TASK-011'" },
    { sql: "UPDATE features SET status = 'implementing' WHERE id = 'FEAT-011'" },
  ]);

  createReviewItem(dbPath, {
    id: "REV-DIVERGED-TASK-IDS",
    taskId: "TASK-011",
    message: "Runtime task and graph task identifiers can diverge.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["high_risk_file"],
    now: stableDate,
  });

  const paused = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'GRAPH-TASK-011'" },
  ]);
  assert.equal(paused.queries.task[0].status, "review_needed");
  assert.equal(paused.queries.graphTask[0].status, "review_needed");

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-DIVERGED-TASK-IDS",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Resume the task after review.",
    targetStatus: "ready",
    now: stableDate,
  });

  const restored = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'GRAPH-TASK-011'" },
  ]);
  assert.equal(restored.queries.task[0].status, "ready");
  assert.equal(restored.queries.graphTask[0].status, "ready");
});

test("feature-scoped reviews pause executable child tasks", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = 'implementing' WHERE id = 'FEAT-011'" },
    { sql: "UPDATE tasks SET status = 'ready' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'ready' WHERE id = 'TASK-011'" },
  ]);

  createReviewItem(dbPath, {
    id: "REV-FEATURE-PAUSE-CHILDREN",
    featureId: "FEAT-011",
    message: "Feature-level architecture change must stop child execution.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(result.queries.feature[0].status, "review_needed");
  assert.equal(result.queries.task[0].status, "review_needed");
  assert.equal(result.queries.graphTask[0].status, "review_needed");

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-FEATURE-PAUSE-CHILDREN",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Clarification resolved.",
    targetStatus: "ready",
    now: new Date("2026-04-28T12:03:00.000Z"),
  });

  const restored = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(restored.queries.feature[0].status, "ready");
  assert.equal(restored.queries.task[0].status, "ready");
  assert.equal(restored.queries.graphTask[0].status, "ready");
});

test("task-scoped reviews preserve failed sibling feature status", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO tasks (id, feature_id, title, status, recovery_state, allowed_files_json)
        VALUES ('TASK-FAILED-SIBLING', 'FEAT-011', 'Failed sibling', 'failed', 'failed', '[]')`,
    },
    { sql: "UPDATE features SET status = 'failed' WHERE id = 'FEAT-011'" },
  ]);

  createReviewItem(dbPath, {
    id: "REV-PRESERVE-FEATURE-FAILURE",
    taskId: "TASK-011",
    message: "A sibling failure should keep the feature failed.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["high_risk_file"],
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(result.queries.feature[0].status, "failed");
});

test("review pauses preserve failed, blocked, and terminal subject state", () => {
  const failedDbPath = seedReviewData();
  runSqlite(failedDbPath, [
    { sql: "UPDATE tasks SET status = 'failed' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'failed' WHERE id = 'TASK-011'" },
    { sql: "UPDATE features SET status = 'failed' WHERE id = 'FEAT-011'" },
  ]);

  createReviewItem(failedDbPath, {
    id: "REV-PRESERVE-FAILED-SUBJECT",
    taskId: "TASK-011",
    message: "Failed task should stay failed while review opens.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["repeated_failure"],
    now: stableDate,
  });

  const failed = runSqlite(failedDbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(failed.queries.task[0].status, "failed");
  assert.equal(failed.queries.graphTask[0].status, "failed");
  assert.equal(failed.queries.feature[0].status, "failed");

  const blockedDbPath = seedReviewData();
  runSqlite(blockedDbPath, [{ sql: "UPDATE features SET status = 'blocked' WHERE id = 'FEAT-011'" }]);

  createReviewItem(blockedDbPath, {
    id: "REV-PRESERVE-BLOCKED-FEATURE",
    featureId: "FEAT-011",
    message: "Blocked feature should stay blocked while review opens.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });

  const blocked = runSqlite(blockedDbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(blocked.queries.feature[0].status, "blocked");

  const deliveredDbPath = seedReviewData();
  runSqlite(deliveredDbPath, [
    { sql: "UPDATE tasks SET status = 'delivered' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'delivered' WHERE id = 'TASK-011'" },
    { sql: "UPDATE features SET status = 'delivered' WHERE id = 'FEAT-011'" },
  ]);

  createReviewItem(deliveredDbPath, {
    id: "REV-PRESERVE-DELIVERED-TASK",
    taskId: "TASK-011",
    message: "Delivered task should stay delivered while review opens.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  const delivered = runSqlite(deliveredDbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(delivered.queries.task[0].status, "delivered");
  assert.equal(delivered.queries.graphTask[0].status, "delivered");
  assert.equal(delivered.queries.feature[0].status, "delivered");
});

test("approval decisions write approval records, state transitions, and audit events", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-APPROVE",
    featureId: "FEAT-011",
    taskId: "TASK-011",
    runId: "RUN-011",
    message: "Reviewer approval is required before continuing.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  const approval = recordApprovalDecision(dbPath, {
    reviewItemId: "REV-APPROVE",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Evidence is complete and risk is accepted.",
    targetStatus: "ready",
    now: stableDate,
  });

  assert.equal(approval.decision, "approve_continue");
  assert.equal(approval.stateTransition?.from, "review_needed");
  assert.equal(approval.stateTransition?.to, "ready");

  const result = runSqlite(dbPath, [], [
    { name: "approval", sql: "SELECT decision, actor, reason FROM approval_records WHERE review_item_id = 'REV-APPROVE'" },
    { name: "transition", sql: "SELECT from_status, to_status, triggered_by FROM state_transitions WHERE id = ?", params: [approval.stateTransition?.id] },
    { name: "review", sql: "SELECT status FROM review_items WHERE id = 'REV-APPROVE'" },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(result.queries.approval[0].decision, "approve_continue");
  assert.equal(result.queries.transition[0].triggered_by, "review_center");
  assert.equal(result.queries.review[0].status, "approved");
  assert.equal(result.queries.task[0].status, "ready");
  assert.equal(listAuditEvents(dbPath, "review_item", "REV-APPROVE")[0].eventType, "approval_recorded");
  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-APPROVE",
        decision: "reject",
        actor: "reviewer",
        reason: "Stale duplicate decision.",
        now: stableDate,
      }),
    /already resolved/,
  );
});

test("missing or negative approval blocks Done", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-BLOCK",
    featureId: "FEAT-011",
    taskId: "TASK-011",
    message: "Task cannot complete without approval.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["failed_tests_continue"],
    now: stableDate,
  });

  assert.throws(
    () => assertApprovalPresentForTerminalStatus(dbPath, { taskId: "TASK-011", targetStatus: "done" }),
    /Positive approval required/,
  );

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-BLOCK",
    decision: "request_changes",
    actor: "reviewer",
    reason: "Reviewer requires a safer implementation before completion.",
    targetStatus: "ready",
    now: stableDate,
  });
  assert.throws(
    () => assertApprovalPresentForTerminalStatus(dbPath, { taskId: "TASK-011", targetStatus: "done" }),
    /Positive approval required/,
  );
  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-BLOCK",
        decision: "reject",
        actor: "reviewer",
        reason: "Rejected work cannot be completed.",
        targetStatus: "done",
        now: stableDate,
      }),
    /cannot target terminal status/,
  );

});

test("open feature-level reviews block task terminal status", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-FEATURE-BLOCKS-TASK-DONE",
    featureId: "FEAT-011",
    message: "Feature-level architecture review blocks child completion.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });

  assert.throws(
    () => assertApprovalPresentForTerminalStatus(dbPath, { taskId: "TASK-011", targetStatus: "done" }),
    /Positive approval required/,
  );
});

test("non-terminal approval does not unlock Done", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-CONTINUE-ONLY",
    featureId: "FEAT-011",
    taskId: "TASK-011",
    message: "Reviewer allows more work but not completion.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });
  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-CONTINUE-ONLY",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Continue implementation.",
    targetStatus: "ready",
    now: stableDate,
  });

  assert.throws(
    () => assertApprovalPresentForTerminalStatus(dbPath, { taskId: "TASK-011", targetStatus: "done" }),
    /Terminal approval required before done/,
  );
  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-CONTINUE-ONLY",
        decision: "approve_continue",
        actor: "reviewer",
        reason: "Continue is not terminal approval.",
        targetStatus: "done",
        now: stableDate,
      }),
    /Decision approve_continue cannot target terminal status done/,
  );
});

test("older unresolved reviews keep terminal status blocked", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-CHANGES",
    featureId: "FEAT-011",
    taskId: "TASK-011",
    message: "Reviewer requested changes first.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["failed_tests_continue"],
    now: stableDate,
  });
  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-CHANGES",
    decision: "request_changes",
    actor: "reviewer",
    reason: "Needs changes before completion.",
    targetStatus: "ready",
    now: stableDate,
  });
  createReviewItem(dbPath, {
    id: "REV-SUPERSEDING-APPROVAL",
    featureId: "FEAT-011",
    taskId: "TASK-011",
    message: "Follow-up review approves completion.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["failed_tests_continue"],
    now: new Date("2026-04-28T12:01:00.000Z"),
  });
  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-SUPERSEDING-APPROVAL",
        decision: "mark_complete",
        actor: "reviewer",
        reason: "Changes were completed.",
        targetStatus: "done",
        now: new Date("2026-04-28T12:01:00.000Z"),
      }),
    /unresolved reviews remain: REV-CHANGES/,
  );

  assert.throws(
    () => assertApprovalPresentForTerminalStatus(dbPath, { taskId: "TASK-011", targetStatus: "done" }),
    /Positive approval required before done: .*REV-CHANGES.*REV-SUPERSEDING-APPROVAL|Positive approval required before done: .*REV-SUPERSEDING-APPROVAL.*REV-CHANGES/,
  );
});

test("positive mark-complete approval updates task status and unblocks Done", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-COMPLETE",
    featureId: "FEAT-011",
    taskId: "TASK-011",
    message: "Task can complete only after positive reviewer approval.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["failed_tests_continue"],
    now: stableDate,
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-COMPLETE",
    decision: "mark_complete",
    actor: "reviewer",
    reason: "Reviewer confirmed the failed test was unrelated.",
    targetStatus: "done",
    now: stableDate,
  });

  assert.doesNotThrow(() => assertApprovalPresentForTerminalStatus(dbPath, { taskId: "TASK-011", targetStatus: "done" }));
  assert.throws(
    () => assertApprovalPresentForTerminalStatus(dbPath, { taskId: "TASK-011", targetStatus: "delivered" }),
    /Terminal approval required before delivered/,
  );

  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
    { name: "reviews", sql: "SELECT id, status FROM review_items ORDER BY id" },
  ]);
  assert.equal(result.queries.task[0].status, "done");
  assert.equal(result.queries.feature[0].status, "done");
  assert.deepEqual(result.queries.reviews.map((row) => [row.id, row.status]), [
    ["REV-COMPLETE", "approved"],
  ]);
});

test("post-completion approval unlocks a later review cycle", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-FIRST-COMPLETE",
    taskId: "TASK-011",
    message: "Initial completion approval.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });
  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-FIRST-COMPLETE",
    decision: "mark_complete",
    actor: "reviewer",
    reason: "Initial work is complete.",
    targetStatus: "done",
    now: stableDate,
  });
  createReviewItem(dbPath, {
    id: "REV-LATER-CYCLE",
    taskId: "TASK-011",
    message: "Later review cycle reopens the task.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: new Date("2026-04-28T12:05:00.000Z"),
  });
  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-LATER-CYCLE",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Continue after the later review.",
    now: new Date("2026-04-28T12:05:00.000Z"),
  });

  assert.doesNotThrow(() => assertApprovalPresentForTerminalStatus(dbPath, { taskId: "TASK-011", targetStatus: "done" }));
});

test("past task continue approvals do not force later terminal approval", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'running' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-PAST-TASK-CONTINUE-SAME-SCOPE",
    taskId: "TASK-011",
    message: "Task had a non-terminal review during execution.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });
  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-PAST-TASK-CONTINUE-SAME-SCOPE",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Continue execution.",
    targetStatus: "running",
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  assert.doesNotThrow(() => assertApprovalPresentForTerminalStatus(dbPath, { taskId: "TASK-011", targetStatus: "done" }));
});

test("task completion keeps parent feature blocked by unresolved feature review", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-FEATURE-BLOCKING",
    featureId: "FEAT-011",
    message: "Feature-level approval is still required.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });
  createReviewItem(dbPath, {
    id: "REV-TASK-COMPLETE-WITH-FEATURE-BLOCK",
    taskId: "TASK-011",
    message: "Task can complete, but the feature review remains open.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["failed_tests_continue"],
    now: stableDate,
  });

  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-TASK-COMPLETE-WITH-FEATURE-BLOCK",
        decision: "mark_complete",
        actor: "reviewer",
        reason: "Task-level evidence is accepted.",
        targetStatus: "done",
        now: stableDate,
      }),
    /unresolved reviews remain/,
  );

  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(result.queries.task[0].status, "review_needed");
  assert.equal(result.queries.feature[0].status, "review_needed");
});

test("task completion keeps parent feature blocked after feature review requests changes", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-FEATURE-CHANGES",
    featureId: "FEAT-011",
    message: "Feature-level review needs changes.",
    reviewNeededReason: "clarification_needed",
    triggerReasons: ["high_impact_ambiguity"],
    now: stableDate,
  });
  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-FEATURE-CHANGES",
    decision: "request_changes",
    actor: "reviewer",
    reason: "Feature needs spec clarification.",
    targetStatus: "planning",
    now: stableDate,
  });
  createReviewItem(dbPath, {
    id: "REV-TASK-COMPLETE-WITH-FEATURE-CHANGES",
    taskId: "TASK-011",
    message: "Task can complete, but feature-level changes remain open.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["failed_tests_continue"],
    now: stableDate,
  });

  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-TASK-COMPLETE-WITH-FEATURE-CHANGES",
        decision: "mark_complete",
        actor: "reviewer",
        reason: "Task-level evidence is accepted.",
        targetStatus: "done",
        now: stableDate,
      }),
    /unresolved reviews remain/,
  );

  const result = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(result.queries.feature[0].status, "review_needed");
});

test("task completion derives parent feature status from graph task state", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, required_skill_slug, subagent, estimated_effort
        ) VALUES (
          'TASK-011-GRAPH-FAILED', 'TG-FEAT-011', 'FEAT-011', 'Failed graph task', 'failed',
          '[]', '[]', '[]', '[]', 'medium', 'feature-spec-execution', 'coding', 1
        )`,
    },
  ]);
  createReviewItem(dbPath, {
    id: "REV-TASK-COMPLETE-WITH-GRAPH-FAILURE",
    taskId: "TASK-011",
    message: "Task row can complete, but graph task failure remains authoritative.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-TASK-COMPLETE-WITH-GRAPH-FAILURE",
    decision: "mark_complete",
    actor: "reviewer",
    reason: "Task-level evidence is accepted.",
    targetStatus: "done",
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(result.queries.feature[0].status, "failed");
});

test("product console review commands execute approval decisions", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-COMPLETE",
    taskId: "TASK-011",
    message: "Console reviewer must resolve this task.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  const receipt = submitConsoleCommand(dbPath, {
    action: "mark_review_complete",
    entityType: "review_item",
    entityId: "REV-CONSOLE-COMPLETE",
    requestedBy: "reviewer",
    reason: "Console approval completed the task.",
    payload: { targetStatus: "done" },
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "review", sql: "SELECT status FROM review_items WHERE id = 'REV-CONSOLE-COMPLETE'" },
    { name: "approval", sql: "SELECT decision, actor FROM approval_records WHERE id = ?", params: [receipt.approvalRecordId] },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(receipt.status, "accepted");
  assert.equal(result.queries.review[0].status, "approved");
  assert.equal(result.queries.approval[0].decision, "mark_complete");
  assert.equal(result.queries.approval[0].actor, "reviewer");
  assert.equal(result.queries.task[0].status, "done");
  assert.equal(result.queries.feature[0].status, "done");
});

test("product console mark_review_complete requires explicit terminal target", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [{ sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" }]);
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-COMPLETE-IN-FLIGHT",
    taskId: "TASK-011",
    message: "Console reviewer must not complete in-flight work by default.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  assert.throws(
    () =>
      submitConsoleCommand(dbPath, {
        action: "mark_review_complete",
        entityType: "review_item",
        entityId: "REV-CONSOLE-COMPLETE-IN-FLIGHT",
        requestedBy: "reviewer",
        reason: "Resolve review without changing completion state.",
        now: stableDate,
      }),
    /requires a terminal target status/,
  );

  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "review", sql: "SELECT status FROM review_items WHERE id = 'REV-CONSOLE-COMPLETE-IN-FLIGHT'" },
  ]);
  assert.equal(result.queries.review[0].status, "review_needed");
  assert.equal(result.queries.task[0].status, "review_needed");
});

test("product console approve_review resumes the paused task state", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [{ sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" }]);
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-RESUME-RUNNING",
    taskId: "TASK-011",
    message: "Running task needs temporary review.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  submitConsoleCommand(dbPath, {
    action: "approve_review",
    entityType: "review_item",
    entityId: "REV-CONSOLE-RESUME-RUNNING",
    requestedBy: "reviewer",
    reason: "Resume the paused running task.",
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(result.queries.task[0].status, "running");
});

test("task review approval restores parent feature to paused lifecycle stage", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = 'tasked' WHERE id = 'FEAT-011'" },
    { sql: "UPDATE tasks SET status = 'ready' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'ready' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-RESTORE-FEATURE-TASKED",
    taskId: "TASK-011",
    message: "Ready task needs review before execution.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-RESTORE-FEATURE-TASKED",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Resume task at the pre-review lifecycle point.",
    targetStatus: "ready",
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(result.queries.task[0].status, "ready");
  assert.equal(result.queries.feature[0].status, "tasked");
});

test("task review changes reopen parent feature from done", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = 'done' WHERE id = 'FEAT-011'" },
    { sql: "UPDATE tasks SET status = 'done' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'done' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-REOPEN-DONE-FEATURE",
    taskId: "TASK-011",
    message: "Completed task needs changes after review.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-REOPEN-DONE-FEATURE",
    decision: "request_changes",
    actor: "reviewer",
    reason: "Reopen task for required changes.",
    targetStatus: "ready",
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(result.queries.task[0].status, "ready");
  assert.equal(result.queries.feature[0].status, "implementing");
});

test("product console approve_review restores scheduled task reviews", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [{ sql: "UPDATE tasks SET status = 'scheduled' WHERE id = 'TASK-011'" }]);
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-RESUME-SCHEDULED",
    taskId: "TASK-011",
    message: "Scheduled task needs temporary review.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  submitConsoleCommand(dbPath, {
    action: "approve_review",
    entityType: "review_item",
    entityId: "REV-CONSOLE-RESUME-SCHEDULED",
    requestedBy: "reviewer",
    reason: "Resume the scheduled task safely.",
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(result.queries.task[0].status, "scheduled");
});

test("product console approve_review resolves feature-scoped reviews", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = 'ready' WHERE id = 'FEAT-011'" },
    { sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'running' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-FEATURE-APPROVAL",
    featureId: "FEAT-011",
    message: "Feature planning approval is required.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });

  const receipt = submitConsoleCommand(dbPath, {
    action: "approve_review",
    entityType: "review_item",
    entityId: "REV-CONSOLE-FEATURE-APPROVAL",
    requestedBy: "reviewer",
    reason: "Feature-level review is approved.",
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "review", sql: "SELECT status FROM review_items WHERE id = 'REV-CONSOLE-FEATURE-APPROVAL'" },
    { name: "approval", sql: "SELECT decision FROM approval_records WHERE id = ?", params: [receipt.approvalRecordId] },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(result.queries.review[0].status, "approved");
  assert.equal(result.queries.approval[0].decision, "approve_continue");
  assert.equal(result.queries.feature[0].status, "ready");
  assert.equal(result.queries.task[0].status, "running");
  assert.equal(result.queries.graphTask[0].status, "running");
});

test("feature-scoped approvals keep blocking while sibling feature reviews remain open", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = 'ready' WHERE id = 'FEAT-011'" },
    { sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'running' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-FEATURE-ARCHITECTURE",
    featureId: "FEAT-011",
    message: "Architecture review pauses the feature.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });
  createReviewItem(dbPath, {
    id: "REV-FEATURE-CLARIFICATION",
    featureId: "FEAT-011",
    message: "Clarification review must remain blocking.",
    reviewNeededReason: "clarification_needed",
    triggerReasons: ["high_impact_ambiguity"],
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-FEATURE-ARCHITECTURE",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Architecture risk accepted.",
    targetStatus: "ready",
    now: new Date("2026-04-28T12:02:00.000Z"),
  });

  const result = runSqlite(dbPath, [], [
    { name: "reviews", sql: "SELECT id, status FROM review_items WHERE id IN ('REV-FEATURE-ARCHITECTURE', 'REV-FEATURE-CLARIFICATION') ORDER BY id" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
  ]);
  assert.deepEqual(result.queries.reviews.map((row) => [row.id, row.status]), [
    ["REV-FEATURE-ARCHITECTURE", "approved"],
    ["REV-FEATURE-CLARIFICATION", "review_needed"],
  ]);
  assert.equal(result.queries.feature[0].status, "review_needed");
  assert.equal(result.queries.task[0].status, "review_needed");
  assert.equal(result.queries.graphTask[0].status, "review_needed");
});

test("feature-scoped approvals keep blocking while child task reviews remain open", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = 'ready' WHERE id = 'FEAT-011'" },
    { sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'running' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-FEATURE-WITH-CHILD-REVIEW",
    featureId: "FEAT-011",
    message: "Feature approval should wait for child task reviews.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });
  createReviewItem(dbPath, {
    id: "REV-OPEN-CHILD-REVIEW",
    taskId: "TASK-011",
    message: "Child task review remains unresolved.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    pauseEntity: false,
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-FEATURE-WITH-CHILD-REVIEW",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Feature-level risk accepted.",
    targetStatus: "ready",
    now: new Date("2026-04-28T12:02:00.000Z"),
  });

  const result = runSqlite(dbPath, [], [
    { name: "reviews", sql: "SELECT id, status FROM review_items WHERE id IN ('REV-FEATURE-WITH-CHILD-REVIEW', 'REV-OPEN-CHILD-REVIEW') ORDER BY id" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
  ]);
  assert.deepEqual(result.queries.reviews.map((row) => [row.id, row.status]), [
    ["REV-FEATURE-WITH-CHILD-REVIEW", "approved"],
    ["REV-OPEN-CHILD-REVIEW", "review_needed"],
  ]);
  assert.equal(result.queries.feature[0].status, "review_needed");
  assert.equal(result.queries.task[0].status, "review_needed");
  assert.equal(result.queries.graphTask[0].status, "review_needed");
});

test("feature-scoped change requests restore paused child tasks for rework", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = 'ready' WHERE id = 'FEAT-011'" },
    { sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'running' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-FEATURE-REQUEST-CHANGES",
    featureId: "FEAT-011",
    message: "Feature review sends work back for changes.",
    reviewNeededReason: "clarification_needed",
    triggerReasons: ["high_impact_ambiguity"],
    now: stableDate,
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-FEATURE-REQUEST-CHANGES",
    decision: "request_changes",
    actor: "reviewer",
    reason: "Rework required.",
    targetStatus: "planning",
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  const result = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(result.queries.feature[0].status, "planning");
  assert.equal(result.queries.task[0].status, "running");
  assert.equal(result.queries.graphTask[0].status, "running");
});

test("feature approval keeps mapped graph task paused while task review remains open", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = 'ready' WHERE id = 'FEAT-011'" },
    { sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET id = 'GRAPH-TASK-011', status = 'running' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-FEATURE-MAPPED-GRAPH",
    featureId: "FEAT-011",
    message: "Feature review pauses mapped graph task.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });
  createReviewItem(dbPath, {
    id: "REV-TASK-MAPPED-GRAPH",
    taskId: "TASK-011",
    message: "Task review remains open.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    pauseEntity: false,
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-FEATURE-MAPPED-GRAPH",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Feature review resolved.",
    targetStatus: "ready",
    now: new Date("2026-04-28T12:02:00.000Z"),
  });

  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'GRAPH-TASK-011'" },
  ]);
  assert.equal(result.queries.task[0].status, "review_needed");
  assert.equal(result.queries.graphTask[0].status, "review_needed");
});

test("task approvals resume task execution while parent feature review stays open", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = 'ready' WHERE id = 'FEAT-011'" },
    { sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'running' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-PARENT-FEATURE",
    featureId: "FEAT-011",
    message: "Parent feature review must keep children paused.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });
  createReviewItem(dbPath, {
    id: "REV-CHILD-TASK",
    taskId: "TASK-011",
    message: "Task-level review is ready to resume, but parent is not.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    pauseEntity: false,
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-CHILD-TASK",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Task-level risk accepted.",
    targetStatus: "running",
    now: new Date("2026-04-28T12:02:00.000Z"),
  });

  const result = runSqlite(dbPath, [], [
    { name: "reviews", sql: "SELECT id, status FROM review_items WHERE id IN ('REV-PARENT-FEATURE', 'REV-CHILD-TASK') ORDER BY id" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
  ]);
  assert.deepEqual(result.queries.reviews.map((row) => [row.id, row.status]), [
    ["REV-CHILD-TASK", "approved"],
    ["REV-PARENT-FEATURE", "review_needed"],
  ]);
  assert.equal(result.queries.feature[0].status, "review_needed");
  assert.equal(result.queries.task[0].status, "running");
  assert.equal(result.queries.graphTask[0].status, "running");
});

test("task approvals stay paused while sibling task reviews remain open", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE features SET status = 'ready' WHERE id = 'FEAT-011'" },
    { sql: "UPDATE tasks SET status = 'running' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'running' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-TASK-FIRST",
    taskId: "TASK-011",
    message: "First task review.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });
  createReviewItem(dbPath, {
    id: "REV-TASK-SECOND",
    taskId: "TASK-011",
    message: "Second task review.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["high_risk_file"],
    pauseEntity: false,
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-TASK-FIRST",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "First review resolved.",
    targetStatus: "running",
    now: new Date("2026-04-28T12:02:00.000Z"),
  });

  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-011'" },
    { name: "review", sql: "SELECT status FROM review_items WHERE id = 'REV-TASK-FIRST'" },
  ]);
  assert.equal(result.queries.review[0].status, "approved");
  assert.equal(result.queries.task[0].status, "review_needed");
  assert.equal(result.queries.graphTask[0].status, "review_needed");
});

test("past task continue approvals do not force feature terminal approval", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-PAST-TASK-CONTINUE",
    taskId: "TASK-011",
    message: "Task had a non-terminal review during implementation.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });
  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-PAST-TASK-CONTINUE",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Continue implementation.",
    targetStatus: "ready",
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  assert.doesNotThrow(() => assertApprovalPresentForTerminalStatus(dbPath, { featureId: "FEAT-011", targetStatus: "done" }));
});

test("past feature continue approvals do not force task terminal approval", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-PAST-FEATURE-CONTINUE",
    featureId: "FEAT-011",
    message: "Feature had a non-terminal review during implementation.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });
  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-PAST-FEATURE-CONTINUE",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Continue implementation.",
    targetStatus: "ready",
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  assert.doesNotThrow(() => assertApprovalPresentForTerminalStatus(dbPath, { taskId: "TASK-011", targetStatus: "done" }));
});

test("product console repeated-failure reviews require recommended recovery actions", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE tasks SET status = 'failed' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'failed' WHERE id = 'TASK-011'" },
    { sql: "UPDATE features SET status = 'failed' WHERE id = 'FEAT-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-REPEATED-FAILURE",
    taskId: "TASK-011",
    message: "Repeated failure requires recovery review.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["repeated_failure"],
    pauseEntity: false,
    now: stableDate,
  });

  submitConsoleCommand(dbPath, {
    action: "rollback_review",
    entityType: "review_item",
    entityId: "REV-CONSOLE-REPEATED-FAILURE",
    requestedBy: "reviewer",
    reason: "Rollback after reviewing repeated failure.",
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "review", sql: "SELECT status FROM review_items WHERE id = 'REV-CONSOLE-REPEATED-FAILURE'" },
    { name: "approval", sql: "SELECT decision FROM approval_records" },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(result.queries.review[0].status, "changes_requested");
  assert.equal(result.queries.approval[0].decision, "rollback");
  assert.equal(result.queries.task[0].status, "failed");
  assert.equal(result.queries.feature[0].status, "failed");
});

test("product console approve_review preserves post-completion reviews without terminal transition", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE tasks SET status = 'done' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'done' WHERE id = 'TASK-011'" },
    { sql: "UPDATE features SET status = 'done' WHERE id = 'FEAT-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-POST-COMPLETE-APPROVE",
    taskId: "TASK-011",
    message: "Post-completion review should approve without moving status.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  const receipt = submitConsoleCommand(dbPath, {
    action: "approve_review",
    entityType: "review_item",
    entityId: "REV-CONSOLE-POST-COMPLETE-APPROVE",
    requestedBy: "reviewer",
    reason: "Approve review without terminal completion.",
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "review", sql: "SELECT status FROM review_items WHERE id = 'REV-CONSOLE-POST-COMPLETE-APPROVE'" },
    { name: "approval", sql: "SELECT decision FROM approval_records WHERE id = ?", params: [receipt.approvalRecordId] },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(result.queries.review[0].status, "approved");
  assert.equal(result.queries.approval[0].decision, "approve_continue");
  assert.equal(result.queries.task[0].status, "done");

  runSqlite(dbPath, [
    { sql: "UPDATE tasks SET status = 'delivered' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'delivered' WHERE id = 'TASK-011'" },
    { sql: "UPDATE features SET status = 'delivered' WHERE id = 'FEAT-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-POST-DELIVERY-APPROVE",
    taskId: "TASK-011",
    message: "Post-delivery review should approve without moving status.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  submitConsoleCommand(dbPath, {
    action: "approve_review",
    entityType: "review_item",
    entityId: "REV-CONSOLE-POST-DELIVERY-APPROVE",
    requestedBy: "reviewer",
    reason: "Approve delivered review without reopening work.",
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  const delivered = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(delivered.queries.task[0].status, "delivered");
});

test("product console mark_review_complete preserves delivered status", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE tasks SET status = 'delivered' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'delivered' WHERE id = 'TASK-011'" },
    { sql: "UPDATE features SET status = 'delivered' WHERE id = 'FEAT-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-DELIVERED-COMPLETE",
    taskId: "TASK-011",
    message: "Delivered work needs review completion.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  submitConsoleCommand(dbPath, {
    action: "mark_review_complete",
    entityType: "review_item",
    entityId: "REV-CONSOLE-DELIVERED-COMPLETE",
    requestedBy: "reviewer",
    reason: "Delivered review is complete.",
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(result.queries.task[0].status, "delivered");
});

test("task-level review completion preserves delivered parent feature", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE tasks SET status = 'delivered' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'delivered' WHERE id = 'TASK-011'" },
    { sql: "UPDATE features SET status = 'delivered' WHERE id = 'FEAT-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-DELIVERED-PARENT",
    taskId: "TASK-011",
    message: "Task-level review should not downgrade delivered feature.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-DELIVERED-PARENT",
    decision: "mark_complete",
    actor: "reviewer",
    reason: "Delivered task review is complete.",
    targetStatus: "delivered",
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.equal(result.queries.feature[0].status, "delivered");
});

test("product console resolves draft feature reviews with legal defaults", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [{ sql: "UPDATE features SET status = 'draft' WHERE id = 'FEAT-011'" }]);
  createReviewItem(dbPath, {
    id: "REV-DRAFT-APPROVE",
    featureId: "FEAT-011",
    message: "Draft feature review can be approved into the ready queue.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["architecture_change"],
    now: stableDate,
  });
  submitConsoleCommand(dbPath, {
    action: "approve_review",
    entityType: "review_item",
    entityId: "REV-DRAFT-APPROVE",
    requestedBy: "reviewer",
    reason: "Draft review approved.",
    now: stableDate,
  });

  runSqlite(dbPath, [{ sql: "UPDATE features SET status = 'draft' WHERE id = 'FEAT-011'" }]);
  createReviewItem(dbPath, {
    id: "REV-DRAFT-UPDATE-SPEC",
    featureId: "FEAT-011",
    message: "Draft feature review needs spec updates.",
    reviewNeededReason: "clarification_needed",
    triggerReasons: ["high_impact_ambiguity"],
    now: new Date("2026-04-28T12:01:00.000Z"),
  });
  submitConsoleCommand(dbPath, {
    action: "update_spec",
    entityType: "review_item",
    entityId: "REV-DRAFT-UPDATE-SPEC",
    requestedBy: "reviewer",
    reason: "Draft review needs a spec update.",
    now: new Date("2026-04-28T12:01:00.000Z"),
  });

  const result = runSqlite(dbPath, [], [
    { name: "reviews", sql: "SELECT id, status FROM review_items WHERE id IN ('REV-DRAFT-APPROVE', 'REV-DRAFT-UPDATE-SPEC') ORDER BY id" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-011'" },
  ]);
  assert.deepEqual(result.queries.reviews.map((row) => [row.id, row.status]), [
    ["REV-DRAFT-APPROVE", "approved"],
    ["REV-DRAFT-UPDATE-SPEC", "changes_requested"],
  ]);
  assert.equal(result.queries.feature[0].status, "planning");
});

test("product console change requests do not restore terminal done work", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE tasks SET status = 'done' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'done' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-REQUEST-CHANGES-DONE",
    taskId: "TASK-011",
    message: "A post-completion review found required changes.",
    reviewNeededReason: "risk_review_needed",
    triggerReasons: ["failed_tests_continue"],
    now: stableDate,
  });

  const receipt = submitConsoleCommand(dbPath, {
    action: "request_review_changes",
    entityType: "review_item",
    entityId: "REV-CONSOLE-REQUEST-CHANGES-DONE",
    requestedBy: "reviewer",
    reason: "Reviewer requested changes after completion.",
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "review", sql: "SELECT status FROM review_items WHERE id = 'REV-CONSOLE-REQUEST-CHANGES-DONE'" },
    { name: "approval", sql: "SELECT decision FROM approval_records WHERE id = ?", params: [receipt.approvalRecordId] },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(result.queries.review[0].status, "changes_requested");
  assert.equal(result.queries.approval[0].decision, "request_changes");
  assert.equal(result.queries.task[0].status, "done");
});

test("product console update_spec command records the recommended review decision", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-CONSOLE-UPDATE-SPEC",
    taskId: "TASK-011",
    message: "Clarification needs a spec update.",
    reviewNeededReason: "clarification_needed",
    triggerReasons: ["high_impact_ambiguity"],
    now: stableDate,
  });

  const receipt = submitConsoleCommand(dbPath, {
    action: "update_spec",
    entityType: "review_item",
    entityId: "REV-CONSOLE-UPDATE-SPEC",
    requestedBy: "reviewer",
    reason: "Spec update requested from Review Center.",
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    { name: "review", sql: "SELECT status FROM review_items WHERE id = 'REV-CONSOLE-UPDATE-SPEC'" },
    { name: "approval", sql: "SELECT decision FROM approval_records WHERE id = ?", params: [receipt.approvalRecordId] },
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-011'" },
  ]);
  assert.equal(result.queries.review[0].status, "changes_requested");
  assert.equal(result.queries.approval[0].decision, "update_spec");
  assert.equal(result.queries.task[0].status, "ready");
});

test("feature-scoped terminal approval requires completed child tasks", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-FEATURE-ONLY",
    featureId: "FEAT-011",
    message: "Feature cannot complete while child tasks are still open.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-FEATURE-ONLY",
        decision: "mark_complete",
        actor: "reviewer",
        reason: "Feature-level approval should still honor child task state.",
        targetStatus: "done",
        now: stableDate,
      }),
    /cannot target done until all child tasks are done or delivered/,
  );
});

test("feature-scoped terminal approval requires completed graph tasks", () => {
  const dbPath = seedReviewData();
  runSqlite(dbPath, [
    { sql: "UPDATE tasks SET status = 'done' WHERE id = 'TASK-011'" },
    { sql: "UPDATE task_graph_tasks SET status = 'running' WHERE id = 'TASK-011'" },
  ]);
  createReviewItem(dbPath, {
    id: "REV-FEATURE-GRAPH-OPEN",
    featureId: "FEAT-011",
    message: "Feature cannot complete while graph task is still open.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-FEATURE-GRAPH-OPEN",
        decision: "mark_complete",
        actor: "reviewer",
        reason: "Graph task should keep feature completion blocked.",
        targetStatus: "done",
        now: stableDate,
      }),
    /cannot target done until all child tasks are done or delivered/,
  );
});

test("failed product console review commands do not write accepted audit events", () => {
  const dbPath = seedReviewData();

  assert.throws(
    () =>
      submitConsoleCommand(dbPath, {
        action: "mark_review_complete",
        entityType: "review_item",
        entityId: "REV-MISSING",
        requestedBy: "reviewer",
        reason: "This review item does not exist.",
        now: stableDate,
      }),
    /Review item not found/,
  );

  const result = runSqlite(dbPath, [], [
    { name: "audit", sql: "SELECT id FROM audit_timeline_events WHERE event_type = 'console_command_mark_review_complete'" },
  ]);
  assert.equal(result.queries.audit.length, 0);
});

test("approval transition uses latest entity status instead of overwriting blocked work", () => {
  const dbPath = seedReviewData();
  createReviewItem(dbPath, {
    id: "REV-LATEST-STATUS",
    featureId: "FEAT-011",
    taskId: "TASK-011",
    message: "Task was blocked before review resolution.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });
  runSqlite(dbPath, [
    { sql: "UPDATE tasks SET status = 'blocked' WHERE id = 'TASK-011'" },
  ]);

  assert.throws(
    () =>
      recordApprovalDecision(dbPath, {
        reviewItemId: "REV-LATEST-STATUS",
        decision: "mark_complete",
        actor: "reviewer",
        reason: "This should not jump from blocked to done.",
        targetStatus: "done",
        now: stableDate,
      }),
    /Illegal task transition/,
  );
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "feat-011-review-db-")), ".autobuild", "autobuild.db");
}

function seedReviewData(): string {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, environment, status)
        VALUES ('project-1', 'SpecDrive', 'Automate specs', 'typescript-service', '[]', 'local', 'ready')`,
    },
    {
      sql: `INSERT INTO features (id, project_id, title, status, priority, folder, primary_requirements_json)
        VALUES ('FEAT-011', 'project-1', 'Review Center', 'review_needed', 20, 'feat-011-review-center', '["REQ-046","REQ-047","REQ-057"]')`,
    },
    {
      sql: `INSERT INTO tasks (id, feature_id, title, status, recovery_state, allowed_files_json)
        VALUES ('TASK-011', 'FEAT-011', 'Implement approval gate', 'review_needed', 'pending', '[]')`,
    },
    {
      sql: `INSERT INTO task_graphs (id, feature_id, graph_json)
        VALUES ('TG-FEAT-011', 'FEAT-011', '{"tasks":[{"taskId":"TASK-011"}]}')`,
    },
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, required_skill_slug, subagent, estimated_effort
        ) VALUES (
          'TASK-011', 'TG-FEAT-011', 'FEAT-011', 'Implement approval gate', 'review_needed',
          '[]', '[]', '[]', '[]', 'medium', 'feature-spec-execution', 'coding', 1
        )`,
    },
    {
      sql: `INSERT INTO runs (id, task_id, feature_id, project_id, status, metadata_json)
        VALUES ('RUN-011', 'TASK-011', 'FEAT-011', 'project-1', 'review_needed', '{"automatic":true}')`,
    },
    {
      sql: `INSERT INTO evidence_packs (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES ('EVID-011', 'RUN-011', 'TASK-011', 'FEAT-011', '.autobuild/evidence/RUN-011.json', 'status_checker', 'Status checker requested review.', '{}')`,
    },
  ]);
  return dbPath;
}
