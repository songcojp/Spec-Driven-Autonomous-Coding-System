import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  buildAuditCenterView,
  buildDashboardBoardView,
  buildDashboardQuery,
  buildProjectOverview,
  buildReviewCenterView,
  buildRunnerConsoleView,
  buildSpecWorkspaceView,
  buildSystemSettingsView,
  submitConsoleCommand,
} from "../src/product-console.ts";
import { createMemoryScheduler } from "../src/scheduler.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

test("project overview aggregates all projects without current project filtering", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);

  const overview = buildProjectOverview(dbPath);

  assert.equal(overview.summary.totalProjects, 2);
  assert.equal(overview.summary.healthyProjects, 1);
  assert.equal(overview.summary.blockedProjects, 1);
  assert.equal(overview.summary.pendingReviews, 2);
  assert.equal(overview.summary.onlineRunners, 2);
  assert.equal(overview.summary.totalCostUsd, 100.25);
  assert.deepEqual(overview.projects.map((project) => project.id).sort(), ["project-1", "project-2"]);
  assert.equal(overview.projects.find((project) => project.id === "project-1")?.activeFeature?.id, "FEAT-013");
  assert.equal(overview.projects.find((project) => project.id === "project-1")?.taskCounts.running, 1);
  assert.equal(overview.projects.find((project) => project.id === "project-1")?.pendingReviews, 1);
  assert.equal(overview.projects.find((project) => project.id === "project-1")?.runnerSuccessRate, 0.8);
  assert.equal(overview.projects.find((project) => project.id === "project-2")?.pendingReviews, 1);
  assert.equal(overview.projects.find((project) => project.id === "project-2")?.costUsd, 99);
  assert.equal(overview.factSources.includes("projects"), true);
});

test("project overview ignores failed runs superseded by newer target executions", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  runSqlite(dbPath, [
    { sql: "UPDATE review_items SET status = 'resolved', severity = 'low' WHERE id IN ('REV-1', 'REV-OTHER', 'REV-GLOBAL')" },
    {
      sql: `INSERT INTO execution_records (id, executor_type, operation, project_id, context_json, status, started_at, metadata_json)
        VALUES
          ('RUN-FEATURE-OLD-FAILED', 'cli', 'feature_execution', 'project-1', '{"featureId":"FEAT-013"}', 'failed', '2026-04-28T10:40:00.000Z', '{}'),
          ('RUN-FEATURE-LATEST-DONE', 'cli', 'feature_execution', 'project-1', '{"featureId":"FEAT-013"}', 'completed', '2026-04-28T10:45:00.000Z', '{}')`,
    },
  ]);

  const overview = buildProjectOverview(dbPath);
  const project = overview.projects.find((entry) => entry.id === "project-1");

  assert.notEqual(project?.latestRisk?.source, "RUN-FEATURE-OLD-FAILED");
  assert.equal(project?.latestRisk?.source, "RUN-FAILED");
});

test("dashboard aggregates control-plane facts and records performance baselines", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);

  const dashboard = buildDashboardQuery(dbPath, { projectId: "project-1", now: stableDate });
  const refreshed = buildDashboardQuery(dbPath, { projectId: "project-1", now: stableDate, refresh: true });

  assert.equal(dashboard.projectHealth.totalProjects, 1);
  assert.equal(dashboard.projectHealth.ready, 1);
  assert.equal(dashboard.activeFeatures[0].id, "FEAT-013");
  assert.equal(dashboard.boardCounts.running, 1);
  assert.equal(dashboard.boardCounts.failed, 1);
  assert.equal(dashboard.activeRuns, 1);
  assert.equal(dashboard.todayAutomaticExecutions, 2);
  assert.equal(dashboard.failedTasks[0].id, "TASK-FAILED");
  assert.equal(dashboard.pendingApprovals, 1);
  assert.equal(dashboard.cost.totalUsd, 1.25);
  assert.equal(dashboard.cost.tokensUsed, 9000);
  assert.equal(dashboard.runner.heartbeats, 2);
  assert.equal(dashboard.runner.online, 1);
  assert.equal(dashboard.runner.successRate, 0.8);
  assert.equal(dashboard.runner.failureRate, 0.2);
  assert.equal(dashboard.recentPullRequests[0].url, "https://example.test/pr/13");
  assert.equal(dashboard.risks.some((risk) => risk.source === "REV-1"), true);
  assert.equal(dashboard.risks.find((risk) => risk.source === "REV-1")?.message, "Needs approval");
  assert.equal(dashboard.risks.some((risk) => risk.source === "REV-OTHER"), false);
  assert.equal(refreshed.performance.refreshMs !== undefined, true);
  assert.equal(dashboard.factSources.includes("tasks"), true);

  const metrics = runSqlite(dbPath, [], [
    { name: "metrics", sql: "SELECT metric_name, labels_json FROM metric_samples WHERE labels_json LIKE '%product_console%' ORDER BY rowid" },
  ]).queries.metrics;
  assert.deepEqual(metrics.slice(-2).map((row) => row.metric_name), ["dashboard_load_ms", "status_refresh_ms"]);
  assert.equal(metrics.every((row) => String(row.labels_json).includes('"projectId":"project-1"')), true);
});

test("dashboard risks ignore stale failed runs when the same target later completed", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  runSqlite(dbPath, [
    { sql: "UPDATE review_items SET status = 'resolved', severity = 'low' WHERE id IN ('REV-1', 'REV-OTHER', 'REV-GLOBAL')" },
    {
      sql: `INSERT INTO execution_records (id, executor_type, operation, project_id, context_json, status, started_at, metadata_json)
        VALUES
          ('RUN-FEATURE-OLD-FAILED', 'cli', 'feature_execution', 'project-1', '{"featureId":"FEAT-013"}', 'failed', '2026-04-28T10:40:00.000Z', '{}'),
          ('RUN-FEATURE-LATEST-DONE', 'cli', 'feature_execution', 'project-1', '{"featureId":"FEAT-013"}', 'completed', '2026-04-28T10:45:00.000Z', '{}')`,
    },
  ]);

  const dashboard = buildDashboardQuery(dbPath, { projectId: "project-1", now: stableDate });

  assert.equal(dashboard.risks.some((risk) => risk.source === "RUN-FEATURE-OLD-FAILED"), false);
  assert.equal(dashboard.risks.some((risk) => risk.source === "RUN-FAILED"), true);
});

test("dashboard counts unresolved review decisions as pending approvals", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  runSqlite(dbPath, [
    {
      sql: `UPDATE review_items
        SET status = 'changes_requested'
        WHERE id = 'REV-1'`,
    },
    {
      sql: `INSERT INTO review_items (id, project_id, status, severity, body, created_at)
        VALUES ('REV-PROJECT', 'project-1', 'review_needed', 'high', '{"message":"Project-level approval"}', '2026-04-28T12:01:00.000Z')`,
    },
  ]);

  const dashboard = buildDashboardQuery(dbPath, { projectId: "project-1", now: stableDate });

  assert.equal(dashboard.pendingApprovals, 2);
  assert.equal(dashboard.risks.some((risk) => risk.source === "REV-PROJECT"), true);
});

test("dashboard board exposes task facts, dependencies, diffs, tests, approvals, and recovery history", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  seedBoardPatchData(dbPath);

  const board = buildDashboardBoardView(dbPath, "project-1");
  const readyTask = board.tasks.find((task) => task.id === "TASK-READY");
  const highRiskTask = board.tasks.find((task) => task.id === "TASK-HIGH");
  const highRiskWithoutReview = board.tasks.find((task) => task.id === "TASK-HIGH-NO-REVIEW");

  assert.equal(readyTask?.name, "Ready board task");
  assert.equal(readyTask?.dependencies[0].satisfied, true);
  assert.deepEqual(readyTask?.diff, { files: ["src/product-console.ts"] });
  assert.deepEqual(readyTask?.testResults, { command: "node --test tests/product-console.test.ts", passed: true });
  assert.equal(readyTask?.approvalStatus, "not_required");
  assert.equal(readyTask?.recoveryHistory.some((entry) => entry.to === "ready"), true);
  assert.equal(readyTask?.recoveryHistory.some((entry) => entry.to === "failed"), true);
  assert.equal(readyTask?.recoveryHistory.some((entry) => entry.to === "forbidden_retry"), true);
  assert.equal(highRiskTask?.approvalStatus, "pending");
  assert.equal(highRiskTask?.blockedReasons.some((reason) => reason.includes("high risk")), true);
  assert.equal(highRiskWithoutReview?.approvalStatus, "pending");
  assert.equal(highRiskWithoutReview?.blockedReasons.some((reason) => reason.includes("high risk")), true);
  assert.equal(board.commands.some((command) => command.action === "schedule_board_tasks"), true);
  assert.equal(board.factSources.includes("state_transitions"), true);

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO review_items (id, feature_id, status, severity, body, created_at)
        VALUES ('REV-FEATURE-VIEW', 'FEAT-013', 'review_needed', 'medium', '{"message":"Feature-level gate for board view."}', '2026-04-28T12:04:00.000Z')`,
    },
    {
      sql: `INSERT INTO approval_records (id, review_item_id, status, decision, actor, reason, decided_at, created_at, metadata_json)
        VALUES ('APP-OLD-FEATURE-VIEW', 'REV-FEATURE-VIEW', 'recorded', 'approve_continue', 'operator', 'Old approval should not hide pending review.', '2026-04-28T12:03:00.000Z', '2026-04-28T12:03:00.000Z', '{}')`,
    },
  ]);

  const gatedBoard = buildDashboardBoardView(dbPath, "project-1");
  assert.equal(gatedBoard.tasks.find((task) => task.id === "TASK-READY")?.approvalStatus, "pending");
});

test("dashboard board does not load oversized evidence metadata blobs", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  seedBoardPatchData(dbPath);
  runSqlite(dbPath, [
    {
      sql: "UPDATE status_check_results SET metadata_json = ? WHERE id = 'EVID-TASK-READY'",
      params: [JSON.stringify({ large: "x".repeat(11 * 1024 * 1024) })],
    },
  ]);

  const board = buildDashboardBoardView(dbPath, "project-1");

  assert.equal(board.tasks.find((task) => task.id === "TASK-READY")?.name, "Ready board task");
});

test("board commands validate state, dependency, risk, and approval gates before audit", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  seedBoardPatchData(dbPath);

  const scheduleReceipt = submitConsoleCommand(dbPath, {
    action: "schedule_board_tasks",
    entityType: "feature",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Schedule ready board work.",
    payload: { taskIds: ["TASK-READY"] },
    now: stableDate,
  });
  const blockedReceipt = submitConsoleCommand(dbPath, {
    action: "run_board_tasks",
    entityType: "feature",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Try to run high risk work without approval.",
    payload: { taskIds: ["TASK-HIGH"] },
    now: stableDate,
  });
  const movedReceipt = submitConsoleCommand(dbPath, {
    action: "move_board_task",
    entityType: "task",
    entityId: "TASK-SCHEDULED",
    requestedBy: "operator",
    reason: "Start scheduled work.",
    payload: { targetStatus: "running" },
    now: stableDate,
  });
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, estimated_effort
        ) VALUES ('TASK-HIGH-APPROVED', 'TG-FEAT-013', 'FEAT-013', 'High risk approved board task', 'scheduled', '[]', '[]', '[]', '[]', 'high', 1)`,
    },
    {
      sql: `INSERT INTO review_items (id, feature_id, status, severity, body, created_at)
        VALUES ('REV-FEATURE-APPROVED', 'FEAT-013', 'approved', 'high', '{"message":"Feature-level approval covers high risk board run."}', '2026-04-28T12:02:30.000Z')`,
    },
    {
      sql: `INSERT INTO approval_records (id, review_item_id, status, decision, actor, reason, decided_at, created_at, metadata_json)
        VALUES ('APP-FEATURE-APPROVED', 'REV-FEATURE-APPROVED', 'recorded', 'approve_continue', 'operator', 'Approve high risk board run.', '2026-04-28T12:02:31.000Z', '2026-04-28T12:02:31.000Z', '{}')`,
    },
  ]);
  const highRiskApprovedReceipt = submitConsoleCommand(dbPath, {
    action: "run_board_tasks",
    entityType: "feature",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Run high risk work with feature approval.",
    payload: { taskIds: ["TASK-HIGH-APPROVED"] },
    now: stableDate,
  });
  const mismatchedTaskReceipt = submitConsoleCommand(dbPath, {
    action: "move_board_task",
    entityType: "task",
    entityId: "TASK-SCHEDULED",
    requestedBy: "operator",
    reason: "Try to move a different task than the audited entity.",
    payload: { targetStatus: "running", taskIds: ["TASK-READY"] },
    now: stableDate,
  });
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, estimated_effort
        ) VALUES ('TASK-DONE-BLOCKED', 'TG-FEAT-013', 'FEAT-013', 'Done blocked by dependency', 'running', '[]', '[]', '[]', '["TASK-READY"]', 'low', 1)`,
    },
  ]);
  const dependencyBlockedReceipt = submitConsoleCommand(dbPath, {
    action: "move_board_task",
    entityType: "task",
    entityId: "TASK-DONE-BLOCKED",
    requestedBy: "operator",
    reason: "Try to complete before dependency is done.",
    payload: { targetStatus: "done" },
    now: stableDate,
  });
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, estimated_effort
        ) VALUES ('TASK-FEATURE-GATED', 'TG-FEAT-013', 'FEAT-013', 'Feature gated task', 'running', '[]', '[]', '[]', '[]', 'low', 1)`,
    },
    {
      sql: `INSERT INTO review_items (id, feature_id, status, severity, body, created_at)
        VALUES ('REV-FEATURE-GATE', 'FEAT-013', 'review_needed', 'medium', '{"message":"Feature-level gate."}', '2026-04-28T12:03:00.000Z')`,
    },
  ]);
  const terminalBlockedReceipt = submitConsoleCommand(dbPath, {
    action: "move_board_task",
    entityType: "task",
    entityId: "TASK-FEATURE-GATED",
    requestedBy: "operator",
    reason: "Try to complete without feature approval.",
    payload: { targetStatus: "done" },
    now: stableDate,
  });
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, estimated_effort
        ) VALUES ('TASK-OTHER-READY', 'TG-FEAT-OTHER', 'FEAT-OTHER', 'Other feature task', 'ready', '[]', '[]', '[]', '[]', 'low', 1)`,
    },
  ]);
  const crossFeatureReceipt = submitConsoleCommand(dbPath, {
    action: "schedule_board_tasks",
    entityType: "feature",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Try to schedule another feature through FEAT-013.",
    payload: { taskIds: ["TASK-OTHER-READY"] },
    now: stableDate,
  });

  assert.equal(scheduleReceipt.status, "accepted");
  assert.equal(blockedReceipt.status, "blocked");
  assert.equal(blockedReceipt.blockedReasons?.some((reason) => reason.includes("high risk")), true);
  assert.equal(movedReceipt.status, "accepted");
  assert.equal(highRiskApprovedReceipt.status, "accepted");
  assert.equal(mismatchedTaskReceipt.status, "blocked");
  assert.equal(mismatchedTaskReceipt.blockedReasons?.some((reason) => reason.includes("payload must match")), true);
  assert.equal(dependencyBlockedReceipt.status, "blocked");
  assert.equal(dependencyBlockedReceipt.blockedReasons?.some((reason) => reason.includes("Dependencies are not done")), true);
  assert.equal(terminalBlockedReceipt.status, "blocked");
  assert.equal(terminalBlockedReceipt.blockedReasons?.some((reason) => reason.includes("Positive approval")), true);
  assert.equal(crossFeatureReceipt.status, "blocked");
  assert.equal(crossFeatureReceipt.blockedReasons?.some((reason) => reason.includes("does not belong")), true);

  const audit = runSqlite(dbPath, [], [
    { name: "events", sql: "SELECT event_type, payload_json FROM audit_timeline_events WHERE event_type LIKE 'console_command_%board%' ORDER BY created_at, rowid" },
    { name: "tasks", sql: "SELECT id, status FROM task_graph_tasks WHERE id IN ('TASK-READY', 'TASK-HIGH', 'TASK-SCHEDULED') ORDER BY id" },
    { name: "jobs", sql: "SELECT payload_json FROM scheduler_job_records ORDER BY created_at, rowid" },
  ]);
  assert.deepEqual(audit.queries.events.map((row) => row.event_type), [
    "console_command_schedule_board_tasks",
    "console_command_run_board_tasks",
    "console_command_move_board_task",
    "console_command_run_board_tasks",
    "console_command_move_board_task",
    "console_command_move_board_task",
    "console_command_move_board_task",
    "console_command_schedule_board_tasks",
  ]);
  assert.match(String(audit.queries.events[1].payload_json), /blockedReasons/);
  assert.deepEqual(audit.queries.tasks.map((row) => [row.id, row.status]), [
    ["TASK-HIGH", "scheduled"],
    ["TASK-READY", "scheduled"],
    ["TASK-SCHEDULED", "running"],
  ]);
  assert.equal(JSON.parse(String(audit.queries.jobs[0].payload_json)).context.taskName, "High risk approved board task");
  assert.equal(
    buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:00:20.000Z"), "project-1").schedulerJobs.find((job) => job.taskId === "TASK-HIGH-APPROVED")?.name,
    "High risk approved board task",
  );
});

test("console view models expose specs, scheduler state, runner, and reviews", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);

  const specWorkspace = buildSpecWorkspaceView(dbPath, "FEAT-013");
  const scopedSpecWorkspace = buildSpecWorkspaceView(dbPath, "FEAT-013", "project-1");
  assert.equal(specWorkspace.selectedFeature?.requirements[0].id, "REQ-052");
  assert.equal(scopedSpecWorkspace.features.some((feature) => feature.id === "FEAT-OTHER"), false);
  const checklist = new Map(specWorkspace.selectedFeature?.qualityChecklist.map((item) => [item.item, item.passed]));
  assert.equal(checklist.get("requirements_present"), true);
  assert.equal(checklist.get("requirements_md_present"), false);
  assert.equal(checklist.get("design_md_present"), false);
  assert.equal(checklist.get("tasks_md_present"), false);
  assert.equal(checklist.get("status_ready_for_scheduling"), false);
  assert.equal(specWorkspace.selectedFeature?.clarificationRecords.length, 1);
  assert.deepEqual(specWorkspace.selectedFeature?.dataModels, []);
  assert.deepEqual(specWorkspace.selectedFeature?.contracts, []);
  assert.equal(specWorkspace.selectedFeature?.versionDiffs.length, 2);
  assert.equal(specWorkspace.commands[0].action, "create_feature");
  assert.equal(specWorkspace.commands.some((command) => command.action === "scan_prd_source"), true);
  assert.equal(specWorkspace.commands.some((command) => command.action === "generate_ears"), true);
  assert.equal(specWorkspace.prdWorkflow.sourcePath, "No Spec source selected");
  assert.deepEqual(specWorkspace.prdWorkflow.phases.map((phase) => phase.key), ["project_initialization", "requirement_intake", "feature_execution"]);
  assert.equal(specWorkspace.prdWorkflow.phases[0].stages.some((stage) => stage.key === "initialize_project_memory"), true);
  assert.equal(specWorkspace.prdWorkflow.phases[1].stages.some((stage) => stage.key === "spec_source_intake"), true);
  assert.equal(specWorkspace.prdWorkflow.phases[1].stages.some((stage) => stage.key === "scan_prd"), false);
  assert.equal(specWorkspace.prdWorkflow.phases[1].stages.some((stage) => stage.key === "upload_prd"), false);
  assert.equal(specWorkspace.prdWorkflow.phases[1].stages.some((stage) => stage.key === "generate_ears"), true);
  assert.equal(specWorkspace.prdWorkflow.phases[1].stages.some((stage) => stage.key === "feature_spec_pool"), false);
  assert.equal(specWorkspace.prdWorkflow.phases[2].stages.some((stage) => stage.key === "generate_hld"), true);
  assert.equal(specWorkspace.prdWorkflow.phases[2].stages.some((stage) => stage.key === "generate_ui_spec"), true);
  assert.equal(specWorkspace.prdWorkflow.phases[2].stages.some((stage) => stage.key === "status_check"), true);
  assert.equal(specWorkspace.prdWorkflow.phases[2].stages.some((stage) => stage.key === "task_scheduling"), true);
  assert.equal(specWorkspace.prdWorkflow.phases[2].stages.some((stage) => stage.key === "feature_spec_pool"), false);
  assert.equal(specWorkspace.prdWorkflow.stages.some((stage) => stage.key === "generate_hld"), false);
  assert.equal(specWorkspace.commands.some((command) => command.action === "generate_hld"), false);
  assert.equal(specWorkspace.commands.some((command) => command.action === "schedule_run"), true);

  runSqlite(dbPath, [
    { sql: "DELETE FROM memory_version_records WHERE id = 'MEM-1'" },
    { sql: "DELETE FROM project_constitutions WHERE id = 'CONST-1'" },
  ]);
  const initializationWorkspace = buildSpecWorkspaceView(dbPath, "FEAT-013", "project-1");
  const initializationStages = initializationWorkspace.prdWorkflow.phases[0].stages;
  assert.equal(
    initializationStages.find((stage) => stage.key === "import_or_create_constitution")?.status,
    "pending",
  );
  assert.equal(
    initializationStages.find((stage) => stage.key === "initialize_project_memory")?.status,
    "pending",
  );
  submitConsoleCommand(dbPath, {
    action: "import_or_create_constitution",
    entityType: "project",
    entityId: "project-1",
    projectId: "project-1",
    requestedBy: "operator",
    reason: "Operator requested import_or_create_constitution.",
    payload: {
      stage: "import_or_create_constitution",
      targetRepoPath: "/workspace/specdrive",
    },
    now: new Date("2026-04-28T07:06:30.000Z"),
  });
  const acceptedInitializationWorkspace = buildSpecWorkspaceView(dbPath, "FEAT-013", "project-1");
  assert.equal(
    acceptedInitializationWorkspace.prdWorkflow.phases[0].stages.find((stage) => stage.key === "import_or_create_constitution")?.status,
    "completed",
  );

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO memory_version_records (id, project_memory_id, version, run_id, summary, checksum, content, created_at)
        VALUES ('MEM-1', 'memory-project-1', 1, NULL, 'Initial project memory.', 'checksum', '{"projectId":"project-1"}', '2026-04-28T07:07:00.000Z')`,
    },
  ]);

  runSqlite(dbPath, [
    {
      sql: "UPDATE project_health_checks SET status = 'blocked', reasons_json = ? WHERE id = 'HC-1'",
      params: [JSON.stringify(["uncommitted_changes_present"])],
    },
  ]);
  const dirtyWorkspace = buildSpecWorkspaceView(dbPath, "FEAT-013", "project-1");
  assert.equal(dirtyWorkspace.prdWorkflow.phases[0].status, "completed");
  assert.notEqual(dirtyWorkspace.prdWorkflow.phases[1].status, "blocked");
  assert.equal(
    dirtyWorkspace.prdWorkflow.phases[0].stages.find((stage) => stage.key === "initialize_spec_protocol")?.status,
    "completed",
  );
  assert.equal(
    dirtyWorkspace.prdWorkflow.phases[0].blockedReasons.includes("uncommitted_changes_present"),
    false,
  );
  runSqlite(dbPath, [
    {
      sql: "UPDATE project_health_checks SET reasons_json = ? WHERE id = 'HC-1'",
      params: [JSON.stringify(["spec_protocol_directory_missing"])],
    },
  ]);
  const missingSpecWorkspace = buildSpecWorkspaceView(dbPath, "FEAT-013", "project-1");
  assert.equal(missingSpecWorkspace.prdWorkflow.phases[0].status, "blocked");
  assert.equal(
    missingSpecWorkspace.prdWorkflow.phases[0].stages.find((stage) => stage.key === "initialize_spec_protocol")?.status,
    "blocked",
  );

  const runner = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:00:20.000Z"));
  const scopedRunner = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:00:20.000Z"), "project-1");
  assert.equal(runner.runners[0].online, true);
  assert.equal(runner.runners[0].queue.length, 1);
  assert.equal(runner.runners[0].queue[0].status, "running");
  assert.equal(runner.runners.find((entry) => entry.runnerId === "runner-other")?.codexVersion, undefined);
  assert.equal(scopedRunner.runners.some((entry) => entry.runnerId === "runner-other"), false);
  assert.equal(scopedRunner.summary.onlineRunners, 1);
  assert.equal(scopedRunner.summary.successRate, 0.8);
  assert.equal(scopedRunner.lanes.blocked.some((task) => task.id === "TASK-RUNNING"), true);
  assert.equal(scopedRunner.lanes.blocked.find((task) => task.id === "TASK-RUNNING")?.blockedReasons.some((reason) => reason.includes("unresolved review")), true);
  assert.equal(scopedRunner.lanes.blocked.find((task) => task.id === "TASK-RUNNING")?.runnerId, "runner-main");
  assert.equal(scopedRunner.factSources.includes("scheduler_job_records"), true);
  assert.equal(scopedRunner.factSources.includes("execution_records"), true);
  assert.equal(runner.commands.map((command) => command.action).join(","), "pause_runner,resume_runner,schedule_run,schedule_board_tasks,run_board_tasks");

  const reviews = buildReviewCenterView(dbPath);
  const scopedReviews = buildReviewCenterView(dbPath, "project-1");
  assert.equal(reviews.items[0].id, "REV-1");
  assert.equal(reviews.items[0].taskId, "TASK-RUNNING");
  assert.equal(reviews.items[0].body, "Needs approval");
  assert.equal(reviews.items[0].evidence.some((entry) => entry.path === ".autobuild/reports/RUN-013.json"), true);
  assert.equal(scopedReviews.items.some((item) => item.id === "REV-OTHER"), false);
  assert.equal(reviews.items.find((item) => item.id === "REV-GLOBAL")?.evidence.length, 0);
  assert.equal(reviews.items[0].goal, "Approve console review controls.");
  assert.equal(reviews.items[0].specRef, "docs/features/feat-013-product-console/design.md");
  assert.deepEqual(reviews.items[0].runContract, { command: "npm test" });
  assert.deepEqual(reviews.items[0].diff, { files: ["src/product-console.ts"] });
  assert.deepEqual(reviews.riskFilters, ["high", "medium"]);
  assert.equal(reviews.commands.some((command) => command.action === "write_spec_evolution"), true);

  const audit = buildAuditCenterView(dbPath, "project-1");
  assert.equal(audit.factSources.includes("audit_timeline_events"), true);
  assert.equal(audit.timeline.some((event) => event.eventType === "console_command_import_or_create_constitution"), true);
  assert.equal(audit.timeline.some((event) => event.eventType === "execution_result_recorded" && event.executionResultId === "EVID-1"), true);
  assert.equal(audit.executionResults.some((entry) => entry.id === "EVID-1"), true);
  assert.equal(audit.summary.pendingApprovals, 1);
});

test("spec workspace parses selected Feature Spec documents for detail tabs", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "specdrive-feature-docs-"));
  const featureDir = join(projectPath, "docs", "features", "feat-013-product-console");
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(
    join(featureDir, "requirements.md"),
    [
      "# Feature Spec: FEAT-013 Product Console",
      "",
      "Spec Evolution:",
      "- CHG-020: Parse Feature Spec detail tabs from workspace docs.",
      "",
      "## Requirements",
      "- REQ-052 Dashboard shows status.",
      "",
      "## Acceptance Criteria",
      "- Selected Feature Spec tabs display parsed workspace content.",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(featureDir, "design.md"),
    [
      "# Design: FEAT-013 Product Console",
      "",
      "## Design Summary",
      "Spec Workspace detail tabs read Feature Spec markdown from the current project workspace.",
      "",
      "## Controlled Command Boundary",
      "The query path is read-only and does not mutate the workspace.",
      "",
      "## Review and Evidence",
      "Browser tests assert the parsed tab content.",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(featureDir, "tasks.md"), "# Tasks\n\n- [x] Legacy task file remains a scheduling input.\n", "utf8");
  runSqlite(dbPath, [
    {
      sql: "UPDATE repository_connections SET local_path = ? WHERE project_id = 'project-1'",
      params: [projectPath],
    },
  ]);

  const specWorkspace = buildSpecWorkspaceView(dbPath, "FEAT-013", "project-1");

  assert.equal(specWorkspace.selectedFeature?.documents.requirements?.exists, true);
  assert.equal(specWorkspace.selectedFeature?.documents.design?.exists, true);
  assert.equal(specWorkspace.selectedFeature?.documents.tasks?.exists, true);
  assert.match(specWorkspace.selectedFeature?.documents.design?.sections.find((section) => section.heading === "Design Summary")?.body ?? "", /Feature Spec markdown/);
  const checklist = new Map(specWorkspace.selectedFeature?.qualityChecklist.map((item) => [item.item, item.passed]));
  assert.equal(checklist.get("requirements_md_present"), true);
  assert.equal(checklist.get("design_md_present"), true);
  assert.equal(checklist.get("tasks_md_present"), true);
  assert.equal(checklist.get("status_ready_for_scheduling"), true);
});

test("runner console view model exposes scheduling lanes and recent triggers", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  seedBoardPatchData(dbPath);
  submitConsoleCommand(dbPath, {
    action: "schedule_board_tasks",
    entityType: "feature",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Schedule ready work from runner center.",
    payload: { taskIds: ["TASK-READY"] },
    now: stableDate,
  });
  runSqlite(dbPath, [
    {
      sql: `UPDATE task_graphs
        SET graph_json = ?
        WHERE id = 'TG-FEAT-013'`,
      params: [JSON.stringify({
        tasks: [
          {
            taskId: "TASK-READY",
            description: "Schedule the real Product Console task queue from persisted task graph facts.",
          },
        ],
      })],
    },
    {
      sql: `UPDATE task_graph_tasks
        SET source_requirements_json = ?, acceptance_criteria_json = ?, allowed_files_json = ?
        WHERE id = 'TASK-READY'`,
      params: [
        JSON.stringify(["REQ-052"]),
        JSON.stringify(["AC-RUNNER-QUEUE"]),
        JSON.stringify(["src/product-console.ts", "apps/product-console/src/pages/RunnerPage.tsx"]),
      ],
    },
  ]);

  const runner = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:00:20.000Z"), "project-1");

  assert.equal(runner.summary.onlineRunners, 1);
  assert.equal(runner.summary.readyTasks, 0);
  assert.equal(runner.lanes.scheduled.some((task) => task.id === "TASK-READY"), true);
  assert.equal(runner.lanes.scheduled.some((task) => task.id === "TASK-SCHEDULED"), true);
  assert.equal(runner.lanes.running.length, 0);
  assert.equal(runner.lanes.blocked.some((task) => task.id === "TASK-HIGH"), true);
  assert.equal(runner.lanes.blocked.find((task) => task.id === "TASK-HIGH")?.action, "review");
  assert.equal(runner.lanes.scheduled.find((task) => task.id === "TASK-READY")?.dependencies[0].satisfied, true);
  assert.equal(runner.lanes.scheduled.find((task) => task.id === "TASK-READY")?.action, "run");
  assert.equal(runner.lanes.scheduled.find((task) => task.id === "TASK-READY")?.name, "Ready board task");
  assert.equal(runner.lanes.scheduled.find((task) => task.id === "TASK-READY")?.description, "Schedule the real Product Console task queue from persisted task graph facts.");
  assert.deepEqual(runner.lanes.scheduled.find((task) => task.id === "TASK-READY")?.sourceRequirementIds, ["REQ-052"]);
  assert.deepEqual(runner.lanes.scheduled.find((task) => task.id === "TASK-READY")?.allowedFiles, ["src/product-console.ts", "apps/product-console/src/pages/RunnerPage.tsx"]);
  assert.equal(runner.lanes.scheduled.find((task) => task.id === "TASK-SCHEDULED")?.action, "run");
  assert.equal(runner.recentTriggers.some((entry) => entry.action === "schedule_board_tasks"), true);

  const otherProject = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:00:20.000Z"), "project-2");
  assert.equal(otherProject.lanes.ready.some((task) => task.featureId === "FEAT-013"), false);
  assert.equal(otherProject.runners.some((entry) => entry.runnerId === "runner-main"), false);
});

test("runner console does not load large policy output schemas", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  runSqlite(dbPath, [
    {
      sql: "UPDATE runner_policies SET output_schema_json = ? WHERE id = 'POLICY-1'",
      params: ["x".repeat(11 * 1024 * 1024)],
    },
  ]);

  const runner = buildRunnerConsoleView(dbPath, stableDate, "project-1");

  assert.equal(runner.runners.find((entry) => entry.runnerId === "runner-main")?.codexVersion, "codex 1.2.3");
});

test("audit center does not load large run and evidence metadata blobs", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  runSqlite(dbPath, [
    {
      sql: "UPDATE execution_records SET metadata_json = ? WHERE id = 'RUN-013'",
      params: [JSON.stringify({ large: "x".repeat(6 * 1024 * 1024) })],
    },
    {
      sql: "UPDATE status_check_results SET metadata_json = ? WHERE id = 'EVID-1'",
      params: [JSON.stringify({ large: "x".repeat(6 * 1024 * 1024) })],
    },
  ]);

  const audit = buildAuditCenterView(dbPath, "project-1");

  assert.equal(audit.timeline.some((event) => event.eventType === "execution_result_recorded" && event.executionResultId === "EVID-1"), true);
  assert.equal(audit.executionResults.some((entry) => entry.id === "EVID-1"), true);
});

test("runner and spec workspace record token consumption only from stdout.log", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "skill-output-"));
  const runDir = join(projectPath, ".autobuild", "runs", "RUN-SKILL");
  mkdirSync(runDir, { recursive: true });
  const skillOutput = {
    contractVersion: "skill-contract/v1",
    executionId: "RUN-SKILL",
    skillSlug: "task-slicing-skill",
    requestedAction: "split_feature_specs",
    status: "completed",
    summary: "Feature specs split and queue plan created.",
    nextAction: "Push the Feature Spec pool.",
    tokenUsage: { inputTokens: 1200, cachedInputTokens: 200, outputTokens: 320, reasoningOutputTokens: 80, totalTokens: 1600 },
    inputContract: { skillSlug: "task-slicing-skill", required: ["featureId", "workspaceRoot"] },
    outputContract: { contractVersion: "skill-contract/v1", required: ["status"], resultShape: { featureCount: "number" } },
    producedArtifacts: [{ path: "docs/features/feature-pool-queue.json", kind: "json", status: "created" }],
    evidence: [{ kind: "spec", summary: "Queue plan is ready.", path: "docs/features/feature-pool-queue.json" }],
    traceability: { featureId: "FEAT-013", requirementIds: ["REQ-052"], changeIds: [] },
    result: { featureCount: 3 },
  };
  writeFileSync(join(runDir, "stdout.log"), [
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(skillOutput) } }),
    JSON.stringify({ type: "turn.completed", usage: skillOutput.tokenUsage }),
    "",
  ].join("\n"));
  writeFileSync(join(runDir, "cli-output.json"), JSON.stringify({
    usage: { input_tokens: 9000000, cached_input_tokens: 0, output_tokens: 9000000, reasoning_output_tokens: 0 },
  }));
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO cli_adapter_configs (
          id, display_name, schema_version, executable, argument_template_json, resume_argument_template_json,
          config_schema_json, form_schema_json, defaults_json, environment_allowlist_json, output_mapping_json, status, updated_at
        ) VALUES (
          'codex-cli', 'Codex CLI', 2, 'codex', '["{{prompt}}","{{output_schema}}"]', '[]',
          '{}', '{}', ?, '[]', '{"eventStream":"json","evidenceSchema":"evidence.schema.json","sessionIdPath":"session_id"}', 'active', '2026-04-28T12:00:00.000Z'
        )`,
      params: [JSON.stringify({
        model: "gpt-5.5",
        reasoningEffort: "medium",
        sandbox: "danger-full-access",
        approval: "never",
        costRates: {
          "gpt-5.5": {
            inputUsdPer1M: 2,
            cachedInputUsdPer1M: 0.2,
            outputUsdPer1M: 8,
            reasoningOutputUsdPer1M: 8,
          },
        },
      })],
    },
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, attempts, updated_at)
        VALUES ('JOB-SKILL', 'BULL-SKILL', 'specdrive:cli-runner', 'cli.run', 'completed', ?, 1, '2026-04-28T12:04:00.000Z')`,
      params: [JSON.stringify({ projectId: "project-1", executionId: "RUN-SKILL", operation: "split_feature_specs", context: { featureId: "FEAT-013" } })],
    },
    {
      sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, started_at, completed_at, metadata_json)
        VALUES ('RUN-SKILL', 'JOB-SKILL', 'cli', 'split_feature_specs', 'project-1', ?, 'completed', '2026-04-28T12:03:00.000Z', '2026-04-28T12:04:00.000Z', ?)`,
      params: [
        JSON.stringify({ featureId: "FEAT-013", skillPhase: "split_feature_specs" }),
        JSON.stringify({ skillSlug: "task-slicing-skill" }),
      ],
    },
  ]);

  const runner = buildRunnerConsoleView(dbPath, stableDate, "project-1");
  const jobOutput = runner.schedulerJobs.find((job) => job.id === "JOB-SKILL")?.skillOutput;
  const workspace = buildSpecWorkspaceView(dbPath, "FEAT-013", "project-1");

  assert.equal(jobOutput?.parseStatus, "found");
  assert.equal(Object.hasOwn(jobOutput ?? {}, "raw"), false);
  assert.equal(jobOutput?.summary, "Feature specs split and queue plan created.");
  assert.deepEqual(jobOutput?.tokenUsage, skillOutput.tokenUsage);
  assert.equal(jobOutput?.tokenConsumption?.totalTokens, 1600);
  assert.equal(jobOutput?.tokenConsumption?.pricingStatus, "priced");
  assert.equal(jobOutput?.tokenConsumption?.costUsd, 0.00524);
  assert.deepEqual(jobOutput?.inputContract, skillOutput.inputContract);
  assert.equal(Object.hasOwn(jobOutput ?? {}, "outputContract"), false);
  assert.deepEqual(jobOutput?.producedArtifacts, skillOutput.producedArtifacts);
  assert.equal(runner.skillInvocations.find((entry) => entry.runId === "RUN-SKILL")?.output?.parseStatus, "found");
  assert.equal(workspace.selectedFeature?.skillOutput?.parseStatus, "found");
  assert.equal(Object.hasOwn(workspace.selectedFeature?.skillOutput ?? {}, "raw"), false);
  assert.deepEqual(workspace.selectedFeature?.skillOutput?.result, skillOutput.result);
  assert.equal(workspace.selectedFeature?.skillOutput?.tokenConsumption?.runId, "RUN-SKILL");
  const afterRepeatedViews = runSqlite(dbPath, [], [
    { name: "records", sql: "SELECT run_id FROM token_consumption_records WHERE run_id = 'RUN-SKILL'" },
  ]).queries.records;
  assert.equal(afterRepeatedViews.length, 1);

  const otherProject = buildRunnerConsoleView(dbPath, stableDate, "project-2");
  assert.equal(otherProject.schedulerJobs.some((job) => job.id === "JOB-SKILL"), false);

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, attempts, updated_at)
        VALUES ('JOB-MISSING', 'BULL-MISSING', 'specdrive:cli-runner', 'cli.run', 'completed', ?, 1, '2026-04-28T12:05:00.000Z')`,
      params: [JSON.stringify({ projectId: "project-1", executionId: "RUN-MISSING", operation: "generate_ui_spec", context: { featureId: "FEAT-013" } })],
    },
  ]);
  const missingRunDir = join(projectPath, ".autobuild", "runs", "RUN-MISSING");
  mkdirSync(missingRunDir, { recursive: true });
  writeFileSync(join(missingRunDir, "cli-output.json"), JSON.stringify({
    status: 0,
    usage: {
      input_tokens: 6201837,
      cached_input_tokens: 6086784,
      output_tokens: 46721,
      reasoning_output_tokens: 22274,
    },
  }));
  const missing = buildRunnerConsoleView(dbPath, stableDate, "project-1").schedulerJobs.find((job) => job.id === "JOB-MISSING")?.skillOutput;
  assert.equal(missing?.parseStatus, "missing");
  assert.equal(missing?.tokenUsage, undefined);
  assert.equal(missing?.tokenConsumption, undefined);
  assert.equal(runSqlite(dbPath, [], [
    { name: "records", sql: "SELECT run_id FROM token_consumption_records WHERE run_id = 'RUN-MISSING'" },
  ]).queries.records.length, 0);

  const invalidDir = join(projectPath, ".autobuild", "runs", "RUN-INVALID");
  mkdirSync(invalidDir, { recursive: true });
  writeFileSync(join(invalidDir, "stdout.log"), "{not-json");
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, attempts, updated_at)
        VALUES ('JOB-INVALID', 'BULL-INVALID', 'specdrive:cli-runner', 'cli.run', 'completed', ?, 1, '2026-04-28T12:06:00.000Z')`,
      params: [JSON.stringify({ projectId: "project-1", executionId: "RUN-INVALID", operation: "generate_ui_spec", context: { featureId: "FEAT-013" } })],
    },
  ]);
  const invalid = buildRunnerConsoleView(dbPath, stableDate, "project-1").schedulerJobs.find((job) => job.id === "JOB-INVALID")?.skillOutput;
  assert.equal(invalid?.parseStatus, "invalid");
});

test("system settings exposes CLI adapter config and governed activation", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);

  const initial = buildSystemSettingsView(dbPath);
  assert.equal(initial.cliAdapter.active.id, "codex-cli");
  assert.equal(initial.cliAdapter.validation.valid, true);
  assert.equal(initial.commands.some((command) => command.action === "activate_cli_adapter_config"), true);

  const receipt = submitConsoleCommand(dbPath, {
    action: "activate_cli_adapter_config",
    entityType: "cli_adapter",
    entityId: "gemini-cli",
    requestedBy: "operator",
    reason: "Switch CLI adapter from system settings.",
    payload: {
      config: {
        id: "gemini-cli",
        displayName: "Gemini CLI",
        executable: "gemini",
        argumentTemplate: ["--model", "{{model}}", "--schema", "{{output_schema}}", "{{prompt}}"],
        defaults: { model: "gemini-2.5-pro", sandbox: "workspace-write", approval: "on-request" },
        status: "draft",
      },
    },
  });

  assert.equal(receipt.status, "accepted");
  const settings = buildSystemSettingsView(dbPath);
  assert.equal(settings.cliAdapter.active.id, "gemini-cli");
  assert.equal(settings.cliAdapter.lastDryRun?.status, "passed");
  assert.equal(settings.cliAdapter.lastDryRun?.command, "gemini");
  const runner = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:00:20.000Z"));
  assert.equal(runner.adapterSummary.id, "gemini-cli");
  assert.equal(runner.commands.some((command) => command.action === "activate_cli_adapter_config"), false);
});

test("console command gateway audits controlled writes without mutating worktrees", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);

  const before = runSqlite(dbPath, [], [
    { name: "worktrees", sql: "SELECT path, branch, status FROM worktree_records ORDER BY id" },
  ]).queries.worktrees;
  assert.throws(() => submitConsoleCommand(dbPath, {} as never), /Console command requires action/);
  assert.throws(
    () => submitConsoleCommand(dbPath, {
      action: "unknown_command" as never,
      entityType: "project",
      entityId: "project-1",
      requestedBy: "operator",
      reason: "Reject unsupported command.",
      now: stableDate,
    }),
    /not supported/,
  );
  const receipt = submitConsoleCommand(dbPath, {
    action: "pause_runner",
    entityType: "runner",
    entityId: "runner-main",
    requestedBy: "operator",
    reason: "Pause before maintenance.",
    payload: { requestedState: "paused" },
    now: stableDate,
  });
  const stringTimeReceipt = submitConsoleCommand(dbPath, {
    action: "resume_runner",
    entityType: "runner",
    entityId: "runner-main",
    requestedBy: "operator",
    reason: "Resume after maintenance.",
    now: "2026-04-28T12:00:00.000Z" as never,
  });
  const workflowReceipt = submitConsoleCommand(dbPath, {
    action: "scan_prd_source",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Scan project PRD.",
    payload: {
      targetRepoPath: "workspace/acme-returns-portal",
      sourcePath: "docs/zh-CN/PRD.md",
      resolvedSourcePath: "workspace/acme-returns-portal/docs/zh-CN/PRD.md",
      scanMode: "smart",
    },
    now: stableDate,
  });
  const after = runSqlite(dbPath, [], [
    { name: "worktrees", sql: "SELECT path, branch, status FROM worktree_records ORDER BY id" },
    { name: "audit", sql: "SELECT event_type, source, reason, payload_json FROM audit_timeline_events WHERE id = ?", params: [receipt.auditEventId] },
    { name: "workflowAudit", sql: "SELECT event_type, payload_json FROM audit_timeline_events WHERE id = ?", params: [workflowReceipt.auditEventId] },
  ]);

  assert.equal(receipt.status, "accepted");
  assert.equal(workflowReceipt.status, "blocked");
  assert.equal(stringTimeReceipt.acceptedAt, "2026-04-28T12:00:00.000Z");
  assert.deepEqual(after.queries.worktrees, before);
  assert.equal(after.queries.audit[0].event_type, "console_command_pause_runner");
  assert.equal(after.queries.audit[0].source, "product_console");
  assert.match(String(after.queries.audit[0].payload_json), /operator/);
  assert.equal(after.queries.workflowAudit[0].event_type, "console_command_scan_prd_source");
  assert.equal(String(after.queries.workflowAudit[0].payload_json).includes("workspace/acme-returns-portal/docs/zh-CN/PRD.md"), true);
});

test("project initialization provisions AGENTS and workspace skills for CLI runs", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-agent-runtime-"));
  mkdirSync(join(projectPath, "docs"), { recursive: true });
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "initialize_spec_protocol",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Prepare project workspace.",
    payload: {},
    now: stableDate,
  });

  assert.equal(receipt.status, "accepted");
  assert.equal(existsSync(join(projectPath, "AGENTS.md")), true);
  assert.equal(existsSync(join(projectPath, ".agents", "skills", "task-slicing-skill", "SKILL.md")), true);
  assert.equal(existsSync(join(projectPath, ".agents", "skills", "requirement-intake-skill", "SKILL.md")), true);
});

test("spec intake commands scan, upload, and enqueue EARS skill invocation", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-intake-"));
  mkdirSync(join(projectPath, "docs", "zh-CN"), { recursive: true });
  mkdirSync(join(projectPath, ".autobuild", "reports"), { recursive: true });
  writeFileSync(
    join(projectPath, "docs", "zh-CN", "PRD.md"),
    "Feature: Intake Portal\nGoal: Capture requirements.\nPRD: The system shall scan spec sources. The system shall generate EARS requirements.",
    "utf8",
  );
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
  ]);

  const scanReceipt = submitConsoleCommand(dbPath, {
    action: "scan_prd_source",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Scan project specs.",
    payload: { sourcePath: "docs/zh-CN/PRD.md" },
    now: stableDate,
  });
  const uploadReceipt = submitConsoleCommand(dbPath, {
    action: "upload_prd_source",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Upload spec.",
    payload: {
      fileName: "uploaded-prd.md",
      sourcePath: "uploaded-prd.md",
      contentPreview: "PRD: The system shall accept uploaded specs.",
      contentLength: 45,
    },
    now: stableDate,
  });
  const generateReceipt = submitConsoleCommand(dbPath, {
    action: "generate_ears",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Generate EARS.",
    payload: { sourcePath: "docs/zh-CN/PRD.md" },
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "features", sql: "SELECT id, project_id, title, status FROM features WHERE id LIKE 'FEAT-INTAKE-%'" },
    { name: "requirements", sql: "SELECT id, feature_id, body FROM requirements WHERE feature_id LIKE 'FEAT-INTAKE-%' ORDER BY id" },
    { name: "reports", sql: "SELECT kind, feature_id, path, summary FROM status_check_results WHERE kind IN ('spec_source_scan','spec_source_upload','ears_generation') ORDER BY created_at, rowid" },
    { name: "executions", sql: "SELECT id, project_id, status, metadata_json, context_json FROM execution_records WHERE project_id = 'project-1' ORDER BY rowid DESC LIMIT 1" },
    { name: "jobs", sql: "SELECT job_type, payload_json FROM scheduler_job_records WHERE job_type = 'cli.run' ORDER BY rowid DESC LIMIT 1" },
  ]);

  assert.equal(scanReceipt.status, "accepted");
  assert.equal(uploadReceipt.status, "accepted");
  assert.equal(generateReceipt.status, "accepted");
  assert.equal(result.queries.features.length, 0);
  assert.equal(result.queries.requirements.length, 0);
  assert.deepEqual(result.queries.reports.map((row) => row.kind), ["spec_source_scan", "spec_source_upload"]);
  assert.equal(generateReceipt.executionId, result.queries.executions[0].id);
  const jobPayload = JSON.parse(String(result.queries.jobs[0].payload_json));
  assert.equal(JSON.parse(String(result.queries.executions[0].metadata_json)).skillSlug, "pr-ears-requirement-decomposition-skill");
  assert.equal(jobPayload.context.skillSlug, "pr-ears-requirement-decomposition-skill");
  assert.deepEqual(jobPayload.context.expectedArtifacts, ["docs/zh-CN/requirements.md"]);
});

test("spec workspace records EARS generation as a CLI skill run instead of direct Feature creation", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-intake-selected-"));
  mkdirSync(join(projectPath, "docs", "zh-CN"), { recursive: true });
  writeFileSync(
    join(projectPath, "docs", "zh-CN", "PRD.md"),
    [
      "Feature: Real Intake Flow",
      "Goal: Generate real requirements from a project PRD.",
      "PRD: The system shall generate requirements from the selected source file.",
      "PRD: The system shall preserve source traceability for generated EARS.",
    ].join("\n"),
    "utf8",
  );
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "generate_ears",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Generate EARS from real PRD.",
    payload: { sourcePath: "docs/zh-CN/PRD.md" },
    now: new Date("2026-04-28T12:03:00.000Z"),
  }, { scheduler });
  const workspace = buildSpecWorkspaceView(dbPath, undefined, "project-1");
  const runner = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:03:01.000Z"), "project-1");

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.featureId, undefined);
  const skillInvocation = runner.skillInvocations.find((entry) => entry.runId === receipt.executionId);
  assert.equal(skillInvocation?.skillSlug, "pr-ears-requirement-decomposition-skill");
  assert.equal(workspace.features.some((feature) => feature.id.startsWith("FEAT-INTAKE-")), false);
});

test("generate HLD dispatches the project HLD skill and writes hld.md", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);

  const receipt = submitConsoleCommand(dbPath, {
    action: "generate_hld",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Generate project HLD.",
    payload: {},
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT payload_json FROM scheduler_job_records WHERE job_type = 'cli.run' ORDER BY rowid DESC LIMIT 1" },
    { name: "executions", sql: "SELECT context_json, project_id, metadata_json FROM execution_records WHERE id = ?", params: [receipt.executionId ?? ""] },
  ]);
  const payload = JSON.parse(String(result.queries.jobs[0].payload_json));
  const runner = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:03:01.000Z"), "project-1");

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.featureId, undefined);
  assert.equal(payload.projectId, "project-1");
  assert.equal(payload.context.skillSlug, "create-project-hld");
  assert.equal(payload.requestedAction, "generate_hld");
  assert.deepEqual(payload.context.expectedArtifacts, ["docs/zh-CN/hld.md"]);
  assert.equal(payload.context.expectedArtifacts.includes("docs/zh-CN/design.md"), false);
  assert.deepEqual(payload.traceability.changeIds, []);
  assert.equal(JSON.parse(String(result.queries.executions[0].context_json)).featureId, undefined);
  assert.equal(JSON.parse(String(result.queries.executions[0].metadata_json)).skillSlug, "create-project-hld");
  assert.equal(runner.schedulerJobs.find((job) => job.executionId === receipt.executionId)?.name, "Generate project HLD");
});

test("spec workspace does not treat intake artifacts as Feature Specs", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-intake-artifact-only-"));
  mkdirSync(join(projectPath, "docs"), { recursive: true });
  mkdirSync(join(projectPath, ".autobuild", "specs"), { recursive: true });
  writeFileSync(join(projectPath, "docs", "PRD.md"), "# Lottery PRD\n\nThe system shall capture lottery tickets.", "utf8");
  writeFileSync(join(projectPath, ".autobuild", "specs", "FEAT-INTAKE-001.json"), '{"id":"FEAT-INTAKE-001"}\n', "utf8");
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
    {
      sql: `INSERT INTO features (id, project_id, title, status, folder, primary_requirements_json)
        VALUES ('FEAT-INTAKE-001', 'project-1', 'FEAT-INTAKE-001', 'draft', 'feat-intake-001', '[]')`,
    },
  ]);

  const workspace = buildSpecWorkspaceView(dbPath, undefined, "project-1");

  assert.deepEqual(workspace.features, []);
  assert.equal(workspace.selectedFeature, undefined);
  assert.equal(workspace.prdWorkflow.phases[1].facts.find((fact) => fact.label === "Features")?.value, "0");
});

test("spec workspace builds Feature Spec List from docs features packages", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-docs-features-"));
  mkdirSync(join(projectPath, "docs", "features", "feat-001-ticket-capture"), { recursive: true });
  mkdirSync(join(projectPath, ".autobuild", "specs"), { recursive: true });
  writeFileSync(join(projectPath, ".autobuild", "specs", "FEAT-INTAKE-001.json"), '{"id":"FEAT-INTAKE-001"}\n', "utf8");
  writeFileSync(
    join(projectPath, "docs", "features", "feat-001-ticket-capture", "requirements.md"),
    "# Feature Spec: FEAT-001 Ticket Capture\n\n- REQ-001: The system shall save lottery ticket records.\n- REQ-LOT-002: The system shall scan ticket images.",
    "utf8",
  );
  writeFileSync(join(projectPath, "docs", "features", "feat-001-ticket-capture", "design.md"), "# Design\n", "utf8");
  writeFileSync(join(projectPath, "docs", "features", "feat-001-ticket-capture", "tasks.md"), "# Tasks\n", "utf8");
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
    {
      sql: `INSERT INTO features (id, project_id, title, status, folder, primary_requirements_json)
        VALUES ('FEAT-INTAKE-001', 'project-1', 'FEAT-INTAKE-001', 'draft', 'feat-intake-001', '[]')`,
    },
  ]);

  const workspace = buildSpecWorkspaceView(dbPath, undefined, "project-1");

  assert.deepEqual(workspace.features.map((feature) => feature.id), ["FEAT-001"]);
  assert.equal(workspace.features[0].title, "Ticket Capture");
  assert.equal(workspace.features[0].folder, "feat-001-ticket-capture");
  assert.deepEqual(workspace.features[0].primaryRequirements, ["REQ-001", "REQ-LOT-002"]);
  assert.equal(workspace.features.some((feature) => feature.id.startsWith("FEAT-INTAKE-")), false);
});

test("split Feature Specs dispatches task-slicing skill with PRD EARS HLD inputs", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-split-feature-packages-"));
  mkdirSync(join(projectPath, "docs"), { recursive: true });
  writeFileSync(join(projectPath, "docs", "PRD.md"), "# Lottery PRD\n\nThe system shall manage lottery tickets.", "utf8");
  writeFileSync(join(projectPath, "docs", "requirements.md"), "# Requirements\n\nREQ-001: The system shall save tickets.", "utf8");
  writeFileSync(join(projectPath, "docs", "hld.md"), "# HLD\n\nUse local-first storage.", "utf8");
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
    { sql: "DELETE FROM execution_records" },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "split_feature_specs",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Split PRD/EARS/HLD into Feature Spec packages.",
    payload: {},
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT payload_json FROM scheduler_job_records WHERE job_type = 'cli.run' ORDER BY rowid DESC LIMIT 1" },
    { name: "executions", sql: "SELECT context_json, project_id, metadata_json FROM execution_records WHERE id = ?", params: [receipt.executionId ?? ""] },
  ]);
  const payload = JSON.parse(String(result.queries.jobs[0].payload_json));

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.featureId, undefined);
  assert.equal(payload.projectId, "project-1");
  assert.equal(payload.context.skillSlug, "task-slicing-skill");
  assert.equal(payload.requestedAction, "split_feature_specs");
  assert.equal(payload.context.sourcePaths.includes("docs/PRD.md"), true);
  assert.equal(payload.context.sourcePaths.includes("docs/requirements.md"), true);
  assert.equal(payload.context.sourcePaths.includes("docs/hld.md"), true);
  assert.equal(payload.context.expectedArtifacts.includes("docs/features/<feature-id>/requirements.md"), true);
  assert.equal(payload.context.expectedArtifacts.includes("docs/features/<feature-id>/design.md"), true);
  assert.equal(payload.context.expectedArtifacts.includes("docs/features/<feature-id>/tasks.md"), true);
  assert.equal(payload.context.expectedArtifacts.includes("docs/features/feature-pool-queue.json"), true);
  assert.equal(JSON.parse(String(result.queries.executions[0].context_json)).featureId, undefined);
  assert.equal(JSON.parse(String(result.queries.executions[0].metadata_json)).skillSlug, "task-slicing-skill");
});

test("split Feature Specs preserves uploaded PRD source for task-slicing context", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-split-uploaded-lottery-"));
  const uploadedSourcePath = ".autobuild/specs/uploads/lottery-prd.md";
  mkdirSync(join(projectPath, ".autobuild", "specs", "uploads"), { recursive: true });
  writeFileSync(
    join(projectPath, uploadedSourcePath),
    "# Lottery PRD\n\nThe system shall manage lottery tickets from uploaded product notes.",
    "utf8",
  );
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
    { sql: "DELETE FROM execution_records" },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "split_feature_specs",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Split uploaded Lottery PRD into Feature Spec packages.",
    payload: {
      sourcePath: uploadedSourcePath,
      resolvedSourcePath: join(projectPath, uploadedSourcePath),
    },
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT payload_json FROM scheduler_job_records WHERE job_type = 'cli.run' ORDER BY rowid DESC LIMIT 1" },
  ]);
  const payload = JSON.parse(String(result.queries.jobs[0].payload_json));

  assert.equal(receipt.status, "accepted");
  assert.equal(payload.context.skillSlug, "task-slicing-skill");
  assert.equal(payload.context.sourcePaths[0], uploadedSourcePath);
  assert.equal(payload.context.sourcePaths.includes(".autobuild/specs/uploads/requirements.md"), true);
  assert.equal(payload.context.sourcePaths.includes("docs/PRD.md"), true);
});

test("project schedule_run executes the skill-planned queue artifact", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-start-auto-run-"));
  mkdirSync(join(projectPath, "docs", "features", "feat-001-ticket-capture"), { recursive: true });
  mkdirSync(join(projectPath, "docs", "features", "feat-002-ticket-scan"), { recursive: true });
  writeFileSync(
    join(projectPath, "docs", "features", "README.md"),
    [
      "| Feature ID | Status | Name | Milestone | Dependencies |",
      "| --- | --- | --- | --- | --- |",
      "| FEAT-001 | ready | Ticket Capture | M1 | - |",
      "| FEAT-002 | ready | Ticket Scan | M1 | FEAT-001 |",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(projectPath, "docs", "features", "feature-pool-queue.json"),
    JSON.stringify({
      features: [
        { id: "FEAT-001", priority: 20, dependencies: [] },
        { id: "FEAT-002", priority: 10, dependencies: ["FEAT-001"] },
      ],
    }, null, 2),
    "utf8",
  );
  writeFileSync(
    join(projectPath, "docs", "features", "feat-001-ticket-capture", "requirements.md"),
    "# Feature Spec: FEAT-001 Ticket Capture\n\n- REQ-LOT-001: The system shall save lottery ticket records.",
    "utf8",
  );
  writeFileSync(join(projectPath, "docs", "features", "feat-001-ticket-capture", "design.md"), "# Design\n", "utf8");
  writeFileSync(join(projectPath, "docs", "features", "feat-001-ticket-capture", "tasks.md"), "# Tasks\n", "utf8");
  writeFileSync(
    join(projectPath, "docs", "features", "feat-002-ticket-scan", "requirements.md"),
    "# Feature Spec: FEAT-002 Ticket Scan\n\n- REQ-LOT-002: The system shall scan lottery ticket images.",
    "utf8",
  );
  writeFileSync(join(projectPath, "docs", "features", "feat-002-ticket-scan", "design.md"), "# Design\n", "utf8");
  writeFileSync(join(projectPath, "docs", "features", "feat-002-ticket-scan", "tasks.md"), "# Tasks\n", "utf8");
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM execution_records" },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "schedule_run",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Schedule autonomous Feature execution.",
    payload: { mode: "manual" },
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "features", sql: "SELECT id, status, priority, dependencies_json, primary_requirements_json FROM features WHERE project_id = 'project-1' ORDER BY id" },
    { name: "jobs", sql: "SELECT job_type, queue_name, status, payload_json FROM scheduler_job_records ORDER BY rowid DESC LIMIT 1" },
    { name: "executions", sql: "SELECT id, operation, context_json FROM execution_records" },
  ]);

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.executionId?.length > 0, true);
  assert.equal(receipt.scheduleTriggerId?.length > 0, true);
  assert.equal(receipt.schedulerJobId?.length > 0, true);
  assert.deepEqual(result.queries.features.map((row) => [
    row.id,
    row.status,
    JSON.parse(String(row.dependencies_json)),
    JSON.parse(String(row.primary_requirements_json)),
  ]), [
    ["FEAT-001", "ready", [], ["REQ-LOT-001"]],
    ["FEAT-002", "ready", ["FEAT-001"], ["REQ-LOT-002"]],
  ]);
  assert.equal(Number(result.queries.features[0].priority) > Number(result.queries.features[1].priority), true);
  assert.deepEqual(result.queries.jobs.map((row) => [row.job_type, row.queue_name, row.status, JSON.parse(String(row.payload_json)).operation]), [
    ["cli.run", "specdrive:cli-runner", "queued", "feature_execution"],
  ]);
  assert.equal(result.queries.executions[0].operation, "feature_execution");
});

test("start Auto Run accepts a feature-selection skill decision before enqueuing execution", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-start-auto-run-selector-"));
  for (const folder of ["feat-001-ticket-capture", "feat-002-ticket-scan"]) {
    mkdirSync(join(projectPath, "docs", "features", folder), { recursive: true });
    const id = folder.startsWith("feat-001") ? "FEAT-001" : "FEAT-002";
    writeFileSync(join(projectPath, "docs", "features", folder, "requirements.md"), `# Feature Spec: ${id} Demo\n`, "utf8");
    writeFileSync(join(projectPath, "docs", "features", folder, "design.md"), "# Design\n", "utf8");
    writeFileSync(join(projectPath, "docs", "features", folder, "tasks.md"), "# Tasks\n", "utf8");
  }
  writeFileSync(join(projectPath, "docs", "features", "feature-pool-queue.json"), JSON.stringify({
    features: [
      { id: "FEAT-001", priority: 20, dependencies: [] },
      { id: "FEAT-002", priority: 10, dependencies: [] },
    ],
  }, null, 2), "utf8");
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
    { sql: "DELETE FROM execution_records" },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "start_auto_run",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Use feature-selection-skill output.",
    payload: {
      featureSelectionResult: {
        decision: "selected",
        featureId: "FEAT-002",
        reason: "FEAT-002 is selected by reasoning over current operator context.",
        blockedReasons: [],
        dependencyFindings: ["FEAT-002:no-dependencies"],
        resumeRequiredFeatures: [],
        skippedFeatures: [],
      },
    },
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "execution", sql: "SELECT context_json FROM execution_records WHERE id = ?", params: [receipt.executionId] },
  ]);
  const context = JSON.parse(String(result.queries.execution[0].context_json));

  assert.equal(receipt.status, "accepted");
  assert.equal(context.featureId, "FEAT-002");
  assert.equal(context.selection.skillSlug, "feature-selection-skill");
  assert.equal(context.selection.source, "feature-selection-skill");
  assert.match(context.selection.reason, /selected by reasoning/);
});

test("start Auto Run rejects unsafe feature-selection skill decisions", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-start-auto-run-selector-block-"));
  for (const folder of ["feat-001-foundation", "feat-002-dependent"]) {
    mkdirSync(join(projectPath, "docs", "features", folder), { recursive: true });
    const id = folder.startsWith("feat-001") ? "FEAT-001" : "FEAT-002";
    writeFileSync(join(projectPath, "docs", "features", folder, "requirements.md"), `# Feature Spec: ${id} Demo\n`, "utf8");
    writeFileSync(join(projectPath, "docs", "features", folder, "design.md"), "# Design\n", "utf8");
    writeFileSync(join(projectPath, "docs", "features", folder, "tasks.md"), "# Tasks\n", "utf8");
  }
  writeFileSync(join(projectPath, "docs", "features", "feature-pool-queue.json"), JSON.stringify({
    features: [
      { id: "FEAT-001", priority: 20, dependencies: [] },
      { id: "FEAT-002", priority: 10, dependencies: ["FEAT-001"] },
    ],
  }, null, 2), "utf8");
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
    { sql: "DELETE FROM execution_records" },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "start_auto_run",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Reject unsafe feature-selection-skill output.",
    payload: {
      featureSelectionResult: {
        decision: "selected",
        featureId: "FEAT-002",
        reason: "Incorrectly selected before dependency completion.",
        blockedReasons: [],
        dependencyFindings: ["FEAT-001:incomplete"],
        resumeRequiredFeatures: [],
        skippedFeatures: [],
      },
    },
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "executions", sql: "SELECT id FROM execution_records" },
  ]);
  const state = JSON.parse(readFileSync(join(projectPath, "docs", "features", "feat-002-dependent", "spec-state.json"), "utf8"));

  assert.equal(receipt.status, "blocked");
  assert.equal(receipt.blockedReasons?.some((reason) => reason.includes("incomplete dependency")), true);
  assert.deepEqual(result.queries.executions, []);
  assert.equal(state.status, "blocked");
});

test("start Auto Run blocks when the skill queue plan is missing", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-start-auto-run-missing-plan-"));
  mkdirSync(join(projectPath, "docs", "features", "feat-001-ticket-capture"), { recursive: true });
  writeFileSync(
    join(projectPath, "docs", "features", "feat-001-ticket-capture", "requirements.md"),
    "# Feature Spec: FEAT-001 Ticket Capture\n\n- REQ-LOT-001: The system shall save lottery ticket records.",
    "utf8",
  );
  writeFileSync(join(projectPath, "docs", "features", "feat-001-ticket-capture", "design.md"), "# Design\n", "utf8");
  writeFileSync(join(projectPath, "docs", "features", "feat-001-ticket-capture", "tasks.md"), "# Tasks\n", "utf8");
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
    { sql: "DELETE FROM execution_records" },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "start_auto_run",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Start autonomous Feature scheduling.",
    payload: {},
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "features", sql: "SELECT id FROM features WHERE project_id = 'project-1'" },
    { name: "jobs", sql: "SELECT id FROM scheduler_job_records WHERE job_type = 'feature.select'" },
  ]);

  assert.equal(receipt.status, "blocked");
  assert.equal(receipt.blockedReasons?.some((reason) => reason.includes("feature-pool-queue.json")), true);
  assert.deepEqual(result.queries.features, []);
  assert.deepEqual(result.queries.jobs, []);
});

test("start Auto Run writes file-backed state and can skip to the next Feature", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-start-auto-run-skip-"));
  for (const folder of ["feat-001-ticket-capture", "feat-002-ticket-scan"]) {
    mkdirSync(join(projectPath, "docs", "features", folder), { recursive: true });
    const id = folder.startsWith("feat-001") ? "FEAT-001" : "FEAT-002";
    writeFileSync(join(projectPath, "docs", "features", folder, "requirements.md"), `# Feature Spec: ${id} Demo\n\n- REQ-${id.slice(-3)}: The system shall run this Feature.`, "utf8");
    writeFileSync(join(projectPath, "docs", "features", folder, "design.md"), "# Design\n", "utf8");
    writeFileSync(join(projectPath, "docs", "features", folder, "tasks.md"), "# Tasks\n", "utf8");
  }
  writeFileSync(join(projectPath, "docs", "features", "feature-pool-queue.json"), JSON.stringify({
    features: [
      { id: "FEAT-001", priority: 20, dependencies: [] },
      { id: "FEAT-002", priority: 10, dependencies: [] },
    ],
  }, null, 2), "utf8");
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
    { sql: "DELETE FROM execution_records" },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "start_auto_run",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Skip blocked work and pick the next Feature.",
    payload: { skipFeatureId: "FEAT-001" },
    now: stableDate,
  }, { scheduler });
  const skipped = JSON.parse(readFileSync(join(projectPath, "docs", "features", "feat-001-ticket-capture", "spec-state.json"), "utf8"));
  const queued = JSON.parse(readFileSync(join(projectPath, "docs", "features", "feat-002-ticket-scan", "spec-state.json"), "utf8"));
  const result = runSqlite(dbPath, [], [
    { name: "execution", sql: "SELECT context_json FROM execution_records WHERE id = ?", params: [receipt.executionId] },
  ]);
  const context = JSON.parse(String(result.queries.execution[0].context_json));

  assert.equal(receipt.status, "accepted");
  assert.equal(skipped.status, "skipped");
  assert.equal(queued.status, "queued");
  assert.equal(context.featureId, "FEAT-002");
  assert.equal(context.specStatePath, "docs/features/feat-002-ticket-scan/spec-state.json");
});

test("start Auto Run marks incomplete Feature Spec state as blocked", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-start-auto-run-blocked-state-"));
  mkdirSync(join(projectPath, "docs", "features", "feat-001-ticket-capture"), { recursive: true });
  writeFileSync(join(projectPath, "docs", "features", "feat-001-ticket-capture", "requirements.md"), "# Feature Spec: FEAT-001 Ticket Capture\n", "utf8");
  writeFileSync(join(projectPath, "docs", "features", "feature-pool-queue.json"), JSON.stringify({
    features: [{ id: "FEAT-001", priority: 20, dependencies: [] }],
  }, null, 2), "utf8");
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
    { sql: "DELETE FROM execution_records" },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "start_auto_run",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Start autonomous Feature scheduling.",
    payload: {},
    now: stableDate,
  }, { scheduler });
  const state = JSON.parse(readFileSync(join(projectPath, "docs", "features", "feat-001-ticket-capture", "spec-state.json"), "utf8"));

  assert.equal(receipt.status, "blocked");
  assert.equal(state.status, "blocked");
  assert.equal(state.blockedReasons.some((reason: string) => reason.includes("design.md")), true);
  assert.equal(state.blockedReasons.some((reason: string) => reason.includes("tasks.md")), true);
});

test("start Auto Run accepts skill queue plan P-level priorities", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-start-auto-run-priority-label-"));
  mkdirSync(join(projectPath, "docs", "features", "FEAT-001"), { recursive: true });
  mkdirSync(join(projectPath, "docs", "features", "FEAT-002"), { recursive: true });
  writeFileSync(
    join(projectPath, "docs", "features", "feature-pool-queue.json"),
    JSON.stringify({
      features: [
        { id: "FEAT-001", priority: "P1", dependencies: [] },
        { id: "FEAT-002", priority: "P2", dependencies: ["FEAT-001"] },
      ],
    }, null, 2),
    "utf8",
  );
  for (const featureId of ["FEAT-001", "FEAT-002"]) {
    writeFileSync(
      join(projectPath, "docs", "features", featureId, "requirements.md"),
      `# Feature Spec: ${featureId} Label Priority\n\n- REQ-LOT-${featureId.slice(-3)}: The system shall accept labeled queue priorities.`,
      "utf8",
    );
    writeFileSync(join(projectPath, "docs", "features", featureId, "design.md"), "# Design\n", "utf8");
    writeFileSync(join(projectPath, "docs", "features", featureId, "tasks.md"), "# Tasks\n", "utf8");
  }
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
    { sql: "DELETE FROM features WHERE project_id = 'project-1'" },
    { sql: "DELETE FROM execution_records" },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "start_auto_run",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Start autonomous Feature scheduling.",
    payload: {},
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "features", sql: "SELECT id, priority FROM features WHERE project_id = 'project-1' ORDER BY priority DESC" },
  ]);

  assert.equal(receipt.status, "accepted");
  assert.deepEqual(result.queries.features.map((row) => row.id), ["FEAT-001", "FEAT-002"]);
  assert.equal(Number(result.queries.features[0].priority) > Number(result.queries.features[1].priority), true);
});

test("generate UI Spec dispatches the UI spec skill from project-level Spec Workspace actions", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);

  const receipt = submitConsoleCommand(dbPath, {
    action: "generate_ui_spec",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Generate UI Spec from the Spec Workspace planning flow.",
    payload: {},
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT payload_json FROM scheduler_job_records WHERE job_type = 'cli.run' ORDER BY rowid DESC LIMIT 1" },
    { name: "executions", sql: "SELECT context_json, project_id, metadata_json FROM execution_records WHERE id = ?", params: [receipt.executionId ?? ""] },
  ]);
  const payload = JSON.parse(String(result.queries.jobs[0].payload_json));

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.featureId, undefined);
  assert.equal(payload.projectId, "project-1");
  assert.equal(payload.context.skillSlug, "ui-spec-skill");
  assert.equal(payload.requestedAction, "generate_ui_spec");
  assert.deepEqual(payload.context.imagePaths ?? [], []);
  assert.equal(payload.context.sourcePaths.includes("docs/zh-CN/requirements.md"), true);
  assert.equal(payload.context.expectedArtifacts.includes("docs/ui/ui-spec.md"), true);
  assert.equal(payload.context.expectedArtifacts.includes("docs/ui/concepts/<page-id>.svg"), true);
  assert.equal(JSON.parse(String(result.queries.executions[0].context_json)).featureId, undefined);
  assert.equal(JSON.parse(String(result.queries.executions[0].metadata_json)).skillSlug, "ui-spec-skill");
});

test("spec intake workflow displays the actual discovered source instead of a default PRD path", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-intake-readme-"));
  writeFileSync(
    join(projectPath, "README.md"),
    "Feature: README Intake\nGoal: Capture requirements from the project README.\nThe system shall scan available project specs.",
    "utf8",
  );
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "scan_prd_source",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Scan project specs.",
    payload: { sourcePath: "docs/zh-CN/PRD.md" },
    now: stableDate,
  });
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO audit_timeline_events (id, entity_type, entity_id, event_type, source, reason, payload_json, created_at)
        VALUES ('AUDIT-STALE-PRD', 'project', 'project-1', 'console_command_scan_prd_source', 'product_console', 'Legacy stale path.', ?, '2026-04-28T12:01:00.000Z')`,
      params: [JSON.stringify({
        boardValidation: { blockedReasons: [] },
        payload: {
          sourcePath: join(projectPath, "docs", "zh-CN", "PRD.md"),
          resolvedSourcePath: join(projectPath, "docs", "zh-CN", "PRD.md"),
        },
      })],
    },
  ]);
  const workspace = buildSpecWorkspaceView(dbPath, "FEAT-013", "project-1");

  assert.equal(receipt.status, "accepted");
  assert.equal(workspace.prdWorkflow.sourcePath, "README.md");
  assert.equal(workspace.prdWorkflow.resolvedSourcePath, join(projectPath, "README.md"));
  assert.equal(workspace.prdWorkflow.phases[1].facts.find((fact) => fact.label === "PRD")?.value, join(projectPath, "README.md"));
});

test("spec intake workflow discovers docs PRD at the project docs root", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "spec-intake-docs-prd-"));
  mkdirSync(join(projectPath, "docs"), { recursive: true });
  writeFileSync(
    join(projectPath, "docs", "PRD.md"),
    "Feature: Lottery Intake\nGoal: Capture requirements from docs/PRD.md.\nThe system shall scan root docs PRD files.",
    "utf8",
  );
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE repository_connections SET local_path = ? WHERE id = 'RC-1'", params: [projectPath] },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "scan_prd_source",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Scan project specs.",
    payload: {},
    now: stableDate,
  });
  const workspace = buildSpecWorkspaceView(dbPath, "FEAT-013", "project-1");
  const generateReceipt = submitConsoleCommand(dbPath, {
    action: "generate_ears",
    entityType: "project",
    entityId: "project-1",
    requestedBy: "operator",
    reason: "Generate EARS from root docs PRD.",
    payload: { sourcePath: workspace.prdWorkflow.sourcePath },
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT payload_json FROM scheduler_job_records WHERE job_type = 'cli.run' ORDER BY rowid DESC LIMIT 1" },
  ]);
  const jobPayload = JSON.parse(String(result.queries.jobs[0].payload_json));

  assert.equal(receipt.status, "accepted");
  assert.equal(workspace.prdWorkflow.sourcePath, "docs/PRD.md");
  assert.equal(workspace.prdWorkflow.resolvedSourcePath, join(projectPath, "docs", "PRD.md"));
  assert.equal(generateReceipt.status, "accepted");
  assert.deepEqual(jobPayload.context.sourcePaths, ["docs/PRD.md"]);
  assert.deepEqual(jobPayload.context.expectedArtifacts, ["docs/zh-CN/requirements.md"]);
});

test("console write commands persist rule and spec evolution evidence", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);

  submitConsoleCommand(dbPath, {
    action: "write_project_rule",
    entityType: "rule",
    entityId: "RULE-1",
    requestedBy: "operator",
    reason: "Capture a project operating rule.",
    payload: { projectId: "project-1", summary: "Do not bypass review approvals." },
    now: stableDate,
  });
  submitConsoleCommand(dbPath, {
    action: "write_spec_evolution",
    entityType: "spec",
    entityId: "SPEC-EVO-1",
    requestedBy: "operator",
    reason: "Capture implementation learning.",
    payload: { featureId: "FEAT-013", summary: "Review actions need evidence links." },
    now: stableDate,
  });

  const result = runSqlite(dbPath, [], [
    {
      name: "reports",
      sql: `SELECT kind, feature_id, path, summary, metadata_json FROM status_check_results
        WHERE kind IN ('project_rule', 'spec_evolution') AND metadata_json LIKE '%"commandAction"%'
        ORDER BY kind`,
    },
  ]);

  assert.deepEqual(result.queries.reports.map((row) => row.kind), ["project_rule", "spec_evolution"]);
  assert.equal(result.queries.reports[0].summary, "Do not bypass review approvals.");
  assert.equal(result.queries.reports[1].feature_id, "FEAT-013");
  assert.match(String(result.queries.reports[1].metadata_json), /write_spec_evolution/);
});

test("update_spec writes only workspace spec documents through controlled command", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "update-spec-"));
  mkdirSync(join(projectPath, "docs", "features", "feat-013-product-console"), { recursive: true });
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "update_spec",
    entityType: "spec",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Update Feature Spec tasks.",
    payload: {
      projectId: "project-1",
      path: "docs/features/feat-013-product-console/tasks.md",
      content: "# Tasks\n\n- [x] TASK-001: Updated through controlled command.\n",
    },
    now: stableDate,
  });

  assert.equal(receipt.status, "accepted");
  assert.equal(readFileSync(join(projectPath, "docs", "features", "feat-013-product-console", "tasks.md"), "utf8").includes("Updated through controlled command"), true);
  assert.throws(() => submitConsoleCommand(dbPath, {
    action: "update_spec",
    entityType: "spec",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Attempt unsafe write.",
    payload: {
      projectId: "project-1",
      path: "../outside.md",
      content: "bad",
    },
    now: stableDate,
  }), /inside the workspace/);
});

test("console schedule command records scheduler triggers without bypassing boundaries", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "feature-execution-"));
  const featureDir = join(projectPath, "docs", "features", "feat-013-product-console");
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, "requirements.md"), "# Requirements\n", "utf8");
  writeFileSync(join(featureDir, "design.md"), "# Design\n", "utf8");
  writeFileSync(join(featureDir, "tasks.md"), "# Tasks\n", "utf8");
  runSqlite(dbPath, [{ sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] }]);
  runSqlite(dbPath, [{ sql: "UPDATE features SET status = 'ready' WHERE id = 'FEAT-013'" }]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "schedule_run",
    entityType: "feature",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Schedule feature execution.",
    payload: { projectId: "project-1", mode: "manual" },
    now: stableDate,
  }, { scheduler });
  const eventReceipt = submitConsoleCommand(dbPath, {
    action: "schedule_run",
    entityType: "feature",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Record CI trigger.",
    payload: { projectId: "project-1", mode: "ci_failed" },
    now: stableDate,
  }, { scheduler });
  assert.throws(
    () =>
      submitConsoleCommand(dbPath, {
        action: "schedule_run",
        entityType: "feature",
        entityId: "FEAT-013",
        requestedBy: "operator",
        reason: "Malformed scheduled trigger.",
        payload: { projectId: "project-1", mode: "scheduled_at" },
        now: stableDate,
      }),
    /requires payload.requestedFor/,
  );

  const result = runSqlite(dbPath, [], [
    {
      name: "triggers",
      sql: "SELECT id, project_id, feature_id, target_type, target_id, mode, result FROM schedule_triggers ORDER BY rowid",
    },
    {
      name: "audit",
      sql: "SELECT entity_type, entity_id, event_type FROM audit_timeline_events WHERE event_type = 'schedule_triggered' ORDER BY rowid",
    },
    {
      name: "decisions",
      sql: "SELECT id, selected_feature_id, memory_summary FROM feature_selection_decisions ORDER BY rowid",
    },
    {
      name: "jobs",
      sql: "SELECT id, job_type, queue_name, status, payload_json FROM scheduler_job_records ORDER BY rowid",
    },
  ]);

  assert.equal(receipt.scheduleTriggerId, result.queries.triggers[0].id);
  assert.equal(receipt.schedulerJobId, result.queries.jobs[0].id);
  assert.equal(receipt.selectionDecisionId, undefined);
  assert.equal(eventReceipt.scheduleTriggerId, result.queries.triggers[1].id);
  assert.equal(eventReceipt.selectionDecisionId, undefined);
  assert.deepEqual(
    result.queries.triggers.map((row) => [row.project_id, row.feature_id, row.target_type, row.target_id, row.mode, row.result]),
    [
      ["project-1", "FEAT-013", "feature", "FEAT-013", "manual", "accepted"],
      ["project-1", "FEAT-013", "feature", "FEAT-013", "ci_failed", "recorded"],
    ],
  );
  assert.deepEqual(result.queries.audit.map((row) => [row.entity_type, row.entity_id]), [
    ["feature", "FEAT-013"],
    ["feature", "FEAT-013"],
  ]);
  assert.equal(receipt.executionId, JSON.parse(String(result.queries.jobs[0].payload_json)).executionId);
  const cliRunPayload = JSON.parse(String(result.queries.jobs[0].payload_json));
  assert.equal(cliRunPayload.requestedAction, "feature_execution");
  assert.equal(cliRunPayload.projectId, "project-1");
  assert.equal(cliRunPayload.context.featureId, "FEAT-013");
  assert.equal(cliRunPayload.context.featureSpecPath, "docs/features/feat-013-product-console");
  assert.equal(cliRunPayload.context.skillSlug, "codex-coding-skill");
  assert.equal(cliRunPayload.context.skillPhase, "feature_execution");
  assert.equal(cliRunPayload.context.workspaceRoot, projectPath);
  assert.deepEqual(cliRunPayload.context.expectedArtifacts, [".autobuild/reports/feature-execution.json"]);
  assert.equal(cliRunPayload.context.sourcePaths.includes("docs/features/feat-013-product-console/requirements.md"), true);
  assert.equal(cliRunPayload.context.sourcePaths.includes("docs/features/feat-013-product-console/design.md"), true);
  assert.equal(cliRunPayload.context.sourcePaths.includes("docs/features/feat-013-product-console/tasks.md"), true);
  assert.deepEqual(result.queries.jobs.map((row) => [row.job_type, row.queue_name, row.status, JSON.parse(String(row.payload_json)).operation]), [
    ["cli.run", "specdrive:cli-runner", "queued", "feature_execution"],
  ]);
  assert.deepEqual(result.queries.decisions, []);
});

test("console schedule command blocks feature execution when Feature Spec directory is incomplete", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);
  const projectPath = mkdtempSync(join(tmpdir(), "feature-execution-missing-"));
  mkdirSync(join(projectPath, "docs", "features", "feat-013-product-console"), { recursive: true });
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'", params: [projectPath] },
    { sql: "UPDATE features SET status = 'ready' WHERE id = 'FEAT-013'" },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "schedule_run",
    entityType: "feature",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Schedule incomplete feature execution.",
    payload: { projectId: "project-1", mode: "manual" },
    now: stableDate,
  }, { scheduler });
  const result = runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT id FROM scheduler_job_records" },
  ]);

  assert.equal(receipt.status, "blocked");
  assert.match(receipt.blockedReasons?.join("\n") ?? "", /missing requirements\.md, design\.md, tasks\.md/);
  assert.equal(receipt.schedulerJobId, undefined);
  assert.deepEqual(result.queries.jobs, []);
});

function makeDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), "feat-013-console-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  return dbPath;
}

function seedBoardPatchData(dbPath: string): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, estimated_effort
        ) VALUES
          ('TASK-DONE', 'TG-FEAT-013', 'FEAT-013', 'Done prerequisite', 'done', '[]', '[]', '[]', '[]', 'low', 1),
          ('TASK-READY', 'TG-FEAT-013', 'FEAT-013', 'Ready board task', 'ready', '[]', '[]', '[]', '["TASK-DONE"]', 'low', 1),
          ('TASK-SCHEDULED', 'TG-FEAT-013', 'FEAT-013', 'Scheduled board task', 'scheduled', '[]', '[]', '[]', '["TASK-DONE"]', 'medium', 1),
          ('TASK-HIGH', 'TG-FEAT-013', 'FEAT-013', 'High risk board task', 'scheduled', '[]', '[]', '[]', '["TASK-DONE"]', 'high', 1),
          ('TASK-HIGH-NO-REVIEW', 'TG-FEAT-013', 'FEAT-013', 'High risk task without review', 'scheduled', '[]', '[]', '[]', '["TASK-DONE"]', 'high', 1)`,
    },
    {
      sql: `INSERT INTO state_transitions (
          id, entity_type, entity_id, from_status, to_status, reason, evidence, triggered_by, occurred_at
        ) VALUES ('STATE-TASK-READY', 'task', 'TASK-READY', 'backlog', 'ready', 'Prepared for board scheduling.', 'TASK-READY evidence', 'test', '2026-04-28T11:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO status_check_results (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES (
          'EVID-TASK-READY', 'RUN-013', 'TASK-READY', 'FEAT-013', '.autobuild/reports/TASK-READY.json', 'test',
          'Ready task test evidence.', '{"diff":{"files":["src/product-console.ts"]},"testResults":{"command":"node --test tests/product-console.test.ts","passed":true}}'
        )`,
    },
    {
      sql: `INSERT INTO recovery_attempts (
          id, fingerprint_id, task_id, action, strategy, command, file_scope_json, status, summary, execution_result_json, attempted_at
        ) VALUES (
          'REC-TASK-READY', 'FP-READY', 'TASK-READY', 'retry', 'rerun-targeted-test', 'node --test tests/product-console.test.ts',
          '["src/product-console.ts"]', 'failed', 'Targeted recovery attempt failed.', '{"id":"EVID-TASK-READY"}', '2026-04-28T11:30:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO forbidden_retry_records (
          id, fingerprint_id, task_id, failed_strategy, failed_command, failed_file_scope_json, reason, execution_result_id, created_at
        ) VALUES (
          'FORBID-TASK-READY', 'FP-READY', 'TASK-READY', 'rerun-targeted-test', 'node --test tests/product-console.test.ts',
          '["src/product-console.ts"]', 'Do not repeat the failed recovery attempt automatically.', 'EVID-TASK-READY', '2026-04-28T11:31:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO review_items (id, feature_id, task_id, status, severity, body, created_at)
        VALUES (
          'REV-HIGH', 'FEAT-013', 'TASK-HIGH', 'review_needed', 'high',
          '{"message":"High risk board task requires approval."}',
          '2026-04-28T12:02:00.000Z'
        )`,
    },
  ]);
}

function seedConsoleData(dbPath: string): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, environment, status)
        VALUES ('project-1', 'SpecDrive', 'Automate specs', 'typescript-service', '[]', 'local', 'ready')`,
    },
    {
      sql: `INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, environment, status)
        VALUES ('project-2', 'Other Project', 'Unrelated work', 'typescript-service', '[]', 'local', 'blocked')`,
    },
    {
      sql: `INSERT INTO repository_connections (id, project_id, provider, remote_url, local_path, default_branch, connected_at)
        VALUES ('RC-1', 'project-1', 'github', 'git@github.com:example/specdrive.git', '/workspace/specdrive', 'main', '2026-04-28T07:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO project_health_checks (id, project_id, status, reasons_json, checked_at)
        VALUES ('HC-1', 'project-1', 'ready', '[]', '2026-04-28T07:05:00.000Z')`,
    },
    {
      sql: `INSERT INTO project_constitutions (
          id, project_id, version, source, title, project_goal,
          engineering_principles_json, boundary_rules_json, approval_rules_json, default_constraints_json, status, created_at
        ) VALUES (
          'CONST-1', 'project-1', 1, 'manual', 'SpecDrive Constitution', 'Automate specs',
          '[]', '[]', '[]', '[]', 'active', '2026-04-28T07:06:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO memory_version_records (id, project_memory_id, version, run_id, summary, checksum, content, created_at)
        VALUES ('MEM-1', 'memory-project-1', 1, NULL, 'Initial project memory.', 'checksum', '{"projectId":"project-1"}', '2026-04-28T07:07:00.000Z')`,
    },
    {
      sql: `INSERT INTO features (
          id, project_id, title, status, priority, folder, primary_requirements_json, milestone, dependencies_json, updated_at
        ) VALUES (
          'FEAT-013', 'project-1', 'Product Console', 'implementing', 20,
          'feat-013-product-console', '["REQ-052","REQ-053"]', 'M6', '[]', '2026-04-28T12:00:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO features (
          id, project_id, title, status, priority, folder, primary_requirements_json, milestone, dependencies_json, updated_at
        ) VALUES (
          'FEAT-OTHER', 'project-2', 'Other Console', 'blocked', 1,
          'feat-other', '[]', 'M6', '[]', '2026-04-28T12:00:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO requirements (id, feature_id, source_id, body, acceptance_criteria, priority, status)
        VALUES ('REQ-052', 'FEAT-013', 'docs/zh-CN/requirements.md#REQ-052', 'Dashboard shows status.', 'Status is visible.', 'must', 'active')`,
    },
    {
      sql: `INSERT INTO tasks (id, feature_id, title, status, recovery_state, allowed_files_json)
        VALUES
          ('TASK-RUNNING', 'FEAT-013', 'Implement dashboard', 'running', 'pending', '[]'),
          ('TASK-FAILED', 'FEAT-013', 'Implement review list', 'failed', 'incomplete', '[]')`,
    },
    {
      sql: `INSERT INTO execution_records (id, executor_type, operation, project_id, context_json, status, started_at, metadata_json)
        VALUES
          ('RUN-013', 'cli', 'feature_execution', 'project-1', '{"taskId":"TASK-RUNNING","featureId":"FEAT-013"}', 'running', '2026-04-28T08:00:00.000Z', '{"automatic":true}'),
          ('RUN-FAILED', 'cli', 'feature_execution', 'project-1', '{"taskId":"TASK-FAILED","featureId":"FEAT-013"}', 'failed', '2026-04-28T09:00:00.000Z', '{"automatic":true}'),
          ('RUN-MANUAL', 'cli', 'feature_execution', 'project-1', '{"taskId":"TASK-RUNNING","featureId":"FEAT-013"}', 'completed', '2026-04-28T10:00:00.000Z', '{"automatic":false}'),
          ('RUN-OTHER', 'cli', 'feature_execution', 'project-2', '{"taskId":"TASK-OTHER","featureId":"FEAT-OTHER"}', 'failed', '2026-04-28T10:30:00.000Z', '{"automatic":true}')`,
    },
    {
      sql: `INSERT INTO task_graphs (id, feature_id, graph_json)
        VALUES ('TG-FEAT-013', 'FEAT-013', '{"tasks":[{"taskId":"TASK-RUNNING"}]}')`,
    },
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, estimated_effort
        ) VALUES
          ('TASK-RUNNING', 'TG-FEAT-013', 'FEAT-013', 'Implement dashboard', 'running', '[]', '[]', '[]', '[]', 'low', 1),
          ('TASK-FAILED', 'TG-FEAT-013', 'FEAT-013', 'Implement review list', 'failed', '[]', '[]', '[]', '[]', 'low', 1)`,
    },
    {
      sql: `INSERT INTO runner_policies (
          id, run_id, risk, sandbox_mode, approval_policy, model, output_schema_json, workspace_root, heartbeat_interval_seconds
        ) VALUES ('POLICY-1', 'RUN-013', 'low', 'workspace-write', 'on-request', 'codex 1.2.3', '{}', '/workspace', 20)`,
    },
    {
      sql: `INSERT INTO runner_heartbeats (
          id, run_id, runner_id, status, sandbox_mode, approval_policy, queue_status, beat_at
        ) VALUES ('HB-1', 'RUN-013', 'runner-main', 'online', 'workspace-write', 'on-request', 'running', '2026-04-28T12:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO runner_heartbeats (
          id, run_id, runner_id, status, sandbox_mode, approval_policy, queue_status, beat_at
        ) VALUES ('HB-2', 'RUN-013', 'runner-main', 'online', 'workspace-write', 'on-request', 'running', '2026-04-28T12:00:10.000Z')`,
    },
    {
      sql: `INSERT INTO runner_heartbeats (
          id, run_id, runner_id, status, sandbox_mode, approval_policy, queue_status, beat_at
        ) VALUES ('HB-OTHER', 'RUN-OTHER', 'runner-other', 'online', 'workspace-write', 'on-request', 'failed', '2026-04-28T12:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO raw_execution_logs (id, run_id, stdout, stderr, events_json, created_at)
        VALUES ('LOG-1', 'RUN-013', 'ok', '', '[]', '2026-04-28T12:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO status_check_results (
          id, run_id, task_id, feature_id, project_id, status, summary, reasons_json, recommended_actions_json
        ) VALUES (
          'STATUS-1', 'RUN-013', 'TASK-RUNNING', 'FEAT-013', 'project-1', 'checking',
          'Status checker is observing the CLI run.', '[]', '[]'
        )`,
    },
    {
      sql: `INSERT INTO status_check_results (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES (
          'EVID-1', 'RUN-013', 'TASK-RUNNING', 'FEAT-013', '.autobuild/reports/RUN-013.json', 'test',
          'Console evidence with PR metadata.', '{"pullRequest":{"id":"PR-13","title":"Product Console","url":"https://example.test/pr/13","createdAt":"2026-04-28T12:00:00.000Z"}}'
        )`,
    },
    {
      sql: `INSERT INTO status_check_results (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES ('EVID-CLARIFY', 'RUN-013', 'TASK-RUNNING', 'FEAT-013', '.autobuild/reports/clarification.json', 'clarification', 'Clarified console command boundary.', '{}')`,
    },
    {
      sql: `INSERT INTO status_check_results (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES ('EVID-EVOLUTION', 'RUN-013', 'TASK-RUNNING', 'FEAT-013', '.autobuild/reports/spec-evolution.json', 'spec_evolution', 'Spec diff for Product Console.', '{}')`,
    },
    {
      sql: `INSERT INTO delivery_reports (id, feature_id, path, summary)
        VALUES ('DELIVERY-13', 'FEAT-013', '.autobuild/reports/feat-013.md', 'Delivery report with spec version diff.')`,
    },
    {
      sql: `INSERT INTO review_items (id, feature_id, task_id, status, severity, body, reference_refs_json, created_at)
        VALUES (
          'REV-1', 'FEAT-013', 'TASK-RUNNING', 'review_needed', 'high',
          '{"message":"Needs approval","goal":"Approve console review controls.","specRef":"docs/features/feat-013-product-console/design.md","runContract":{"command":"npm test"},"diff":{"files":["src/product-console.ts"]}}',
          '["EVID-1"]',
          '2026-04-28T12:00:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO review_items (id, feature_id, status, severity, body, created_at)
        VALUES ('REV-OTHER', 'FEAT-OTHER', 'review_needed', 'high', '{"message":"Other project risk"}', '2026-04-28T12:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO review_items (id, feature_id, status, severity, body, created_at)
        VALUES ('REV-GLOBAL', NULL, 'review_needed', 'medium', '{"message":"Project-level review"}', '2026-04-28T11:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO worktree_records (id, project_id, path, branch, status, feature_id, runner_id, base_commit, target_branch, cleanup_status)
        VALUES ('WT-1', 'project-1', '/workspace/feat-013', 'feat/feat-013-product-console', 'active', 'FEAT-013', 'runner-main', 'abc123', 'main', 'active')`,
    },
    { sql: `INSERT INTO metric_samples (id, metric_name, metric_value, unit, labels_json) VALUES ('M-3', 'success_rate', 0.8, 'ratio', '{"projectId":"project-1"}')` },
    { sql: `INSERT INTO metric_samples (id, metric_name, metric_value, unit, labels_json) VALUES ('M-4', 'failure_rate', 0.2, 'ratio', '{"projectId":"project-1"}')` },
    {
      sql: `INSERT INTO token_consumption_records (
          id, run_id, project_id, feature_id, task_id, operation, model, input_tokens, output_tokens, total_tokens,
          cost_usd, currency, pricing_status, usage_json, pricing_json, source_path, recorded_at
        ) VALUES (
          'TOKEN-1', 'RUN-MANUAL', 'project-1', 'FEAT-013', 'TASK-RUNNING', 'feature_execution', 'gpt-5.5',
          8000, 1000, 9000, 1.25, 'USD', 'priced', '{}', '{}', '/workspace/specdrive/.autobuild/runs/RUN-MANUAL/stdout.log', '2026-04-28T10:00:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO token_consumption_records (
          id, run_id, project_id, feature_id, task_id, operation, model, input_tokens, output_tokens, total_tokens,
          cost_usd, currency, pricing_status, usage_json, pricing_json, source_path, recorded_at
        ) VALUES (
          'TOKEN-OTHER', 'RUN-OTHER', 'project-2', 'FEAT-OTHER', 'TASK-OTHER', 'feature_execution', 'gpt-5.5',
          900000, 100000, 1000000, 99, 'USD', 'priced', '{}', '{}', '/workspace/other/.autobuild/runs/RUN-OTHER/stdout.log', '2026-04-28T10:30:00.000Z'
        )`,
    },
  ]);
}
