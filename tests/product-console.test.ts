import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  buildDashboardBoardView,
  buildDashboardQuery,
  buildProjectOverview,
  buildReviewCenterView,
  buildRunnerConsoleView,
  buildSkillCenterView,
  buildSpecWorkspaceView,
  buildSubagentConsoleView,
  submitConsoleCommand,
} from "../src/product-console.ts";

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
  assert.equal(dashboard.runningSubagents, 1);
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
          allowed_files_json, dependencies_json, risk, required_skill_slug, subagent, estimated_effort
        ) VALUES ('TASK-HIGH-APPROVED', 'TG-FEAT-013', 'FEAT-013', 'High risk approved board task', 'scheduled', '[]', '[]', '[]', '[]', 'high', 'console-skill', 'coding', 1)`,
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
          allowed_files_json, dependencies_json, risk, required_skill_slug, subagent, estimated_effort
        ) VALUES ('TASK-DONE-BLOCKED', 'TG-FEAT-013', 'FEAT-013', 'Done blocked by dependency', 'running', '[]', '[]', '[]', '["TASK-READY"]', 'low', 'console-skill', 'coding', 1)`,
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
          allowed_files_json, dependencies_json, risk, required_skill_slug, subagent, estimated_effort
        ) VALUES ('TASK-FEATURE-GATED', 'TG-FEAT-013', 'FEAT-013', 'Feature gated task', 'running', '[]', '[]', '[]', '[]', 'low', 'console-skill', 'coding', 1)`,
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
          allowed_files_json, dependencies_json, risk, required_skill_slug, subagent, estimated_effort
        ) VALUES ('TASK-OTHER-READY', 'TG-FEAT-OTHER', 'FEAT-OTHER', 'Other feature task', 'ready', '[]', '[]', '[]', '[]', 'low', 'console-skill', 'coding', 1)`,
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
    ["TASK-READY", "ready"],
    ["TASK-SCHEDULED", "scheduled"],
  ]);
});

test("console view models expose specs, skills, subagents, runner, and reviews", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);

  const specWorkspace = buildSpecWorkspaceView(dbPath, "FEAT-013");
  const scopedSpecWorkspace = buildSpecWorkspaceView(dbPath, "FEAT-013", "project-1");
  assert.equal(specWorkspace.selectedFeature?.requirements[0].id, "REQ-052");
  assert.equal(scopedSpecWorkspace.features.some((feature) => feature.id === "FEAT-OTHER"), false);
  assert.equal(specWorkspace.selectedFeature?.qualityChecklist.every((item) => item.passed), true);
  assert.equal(specWorkspace.selectedFeature?.clarificationRecords.length, 1);
  assert.deepEqual(specWorkspace.selectedFeature?.dataModels, [{ entities: ["ConsoleDashboard"] }]);
  assert.deepEqual(specWorkspace.selectedFeature?.contracts, [{ endpoints: ["/console/dashboard"] }]);
  assert.equal(specWorkspace.selectedFeature?.versionDiffs.length, 2);
  assert.equal(specWorkspace.commands[0].action, "create_feature");
  assert.equal(specWorkspace.commands.some((command) => command.action === "schedule_run"), true);

  const skillCenter = buildSkillCenterView(dbPath, "project-1");
  assert.equal(skillCenter.skills[0].slug, "console-skill");
  assert.equal(skillCenter.skills[0].description, "Displays console data.");

  const subagents = buildSubagentConsoleView(dbPath);
  const scopedSubagents = buildSubagentConsoleView(dbPath, "project-1");
  assert.equal(subagents.runs.some((run) => run.evidence.length > 0 && run.statusChecks.length > 0 && run.tokenUsage), true);
  assert.equal(scopedSubagents.runs.some((run) => run.id === "RUN-OTHER"), false);
  assert.equal(subagents.commands.length, 0);

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
  assert.equal(scopedRunner.factSources.includes("audit_timeline_events"), true);
  assert.equal(runner.commands.map((command) => command.action).join(","), "pause_runner,resume_runner,schedule_run,schedule_board_tasks,run_board_tasks");

  const reviews = buildReviewCenterView(dbPath);
  const scopedReviews = buildReviewCenterView(dbPath, "project-1");
  assert.equal(reviews.items[0].id, "REV-1");
  assert.equal(reviews.items[0].taskId, "TASK-RUNNING");
  assert.equal(reviews.items[0].body, "Needs approval");
  assert.equal(reviews.items[0].evidence.some((entry) => entry.path === ".autobuild/evidence/RUN-013.json"), true);
  assert.equal(scopedReviews.items.some((item) => item.id === "REV-OTHER"), false);
  assert.equal(reviews.items.find((item) => item.id === "REV-GLOBAL")?.evidence.length, 0);
  assert.equal(reviews.items[0].goal, "Approve console review controls.");
  assert.equal(reviews.items[0].specRef, "docs/features/feat-013-product-console/design.md");
  assert.deepEqual(reviews.items[0].runContract, { command: "npm test" });
  assert.deepEqual(reviews.items[0].diff, { files: ["src/product-console.ts"] });
  assert.deepEqual(reviews.riskFilters, ["high", "medium"]);
  assert.equal(reviews.commands.some((command) => command.action === "write_spec_evolution"), true);
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

  const runner = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:00:20.000Z"), "project-1");

  assert.equal(runner.summary.onlineRunners, 1);
  assert.equal(runner.summary.readyTasks, 1);
  assert.equal(runner.lanes.ready[0].id, "TASK-READY");
  assert.equal(runner.lanes.scheduled.some((task) => task.id === "TASK-SCHEDULED"), true);
  assert.equal(runner.lanes.running.length, 0);
  assert.equal(runner.lanes.blocked.some((task) => task.id === "TASK-HIGH"), true);
  assert.equal(runner.lanes.blocked.find((task) => task.id === "TASK-HIGH")?.action, "review");
  assert.equal(runner.lanes.ready[0].dependencies[0].satisfied, true);
  assert.equal(runner.lanes.ready[0].action, "schedule");
  assert.equal(runner.lanes.scheduled.find((task) => task.id === "TASK-SCHEDULED")?.action, "run");
  assert.equal(runner.recentTriggers.some((entry) => entry.action === "schedule_board_tasks"), true);

  const otherProject = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:00:20.000Z"), "project-2");
  assert.equal(otherProject.lanes.ready.some((task) => task.featureId === "FEAT-013"), false);
  assert.equal(otherProject.runners.some((entry) => entry.runnerId === "runner-main"), false);
});

test("skill center reads skills from the selected project directory", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  const targetRoot = mkdtempSync(join(tmpdir(), "feat-013-target-project-"));
  writeSkill(targetRoot, "target-project-skill", "---\nname: Target Project Skill\ndescription: Reads from selected project.\n---\n");

  runSqlite(dbPath, [
    {
      sql: "UPDATE projects SET target_repo_path = ? WHERE id = 'project-1'",
      params: [targetRoot],
    },
  ]);

  const skillCenter = buildSkillCenterView(dbPath, "project-1");

  assert.deepEqual(skillCenter.skills.map((skill) => skill.slug), ["target-project-skill"]);
  assert.equal(skillCenter.skills[0].path, join(targetRoot, ".agents", "skills", "target-project-skill", "SKILL.md"));
});

test("console command gateway audits controlled writes without mutating worktrees", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);

  const before = runSqlite(dbPath, [], [
    { name: "worktrees", sql: "SELECT path, branch, status FROM worktree_records ORDER BY id" },
  ]).queries.worktrees;
  assert.throws(() => submitConsoleCommand(dbPath, {} as never), /Console command requires action/);
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
  const after = runSqlite(dbPath, [], [
    { name: "worktrees", sql: "SELECT path, branch, status FROM worktree_records ORDER BY id" },
    { name: "audit", sql: "SELECT event_type, source, reason, payload_json FROM audit_timeline_events WHERE id = ?", params: [receipt.auditEventId] },
  ]);

  assert.equal(receipt.status, "accepted");
  assert.equal(stringTimeReceipt.acceptedAt, "2026-04-28T12:00:00.000Z");
  assert.deepEqual(after.queries.worktrees, before);
  assert.equal(after.queries.audit[0].event_type, "console_command_pause_runner");
  assert.equal(after.queries.audit[0].source, "product_console");
  assert.match(String(after.queries.audit[0].payload_json), /operator/);
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
      name: "evidence",
      sql: `SELECT kind, feature_id, path, summary, metadata_json FROM evidence_packs
        WHERE kind IN ('project_rule', 'spec_evolution') AND metadata_json LIKE '%"commandAction"%'
        ORDER BY kind`,
    },
  ]);

  assert.deepEqual(result.queries.evidence.map((row) => row.kind), ["project_rule", "spec_evolution"]);
  assert.equal(result.queries.evidence[0].summary, "Do not bypass review approvals.");
  assert.equal(result.queries.evidence[1].feature_id, "FEAT-013");
  assert.match(String(result.queries.evidence[1].metadata_json), /write_spec_evolution/);
});

test("console schedule command records scheduler triggers without bypassing boundaries", () => {
  const dbPath = makeDbPath();
  seedConsoleData(dbPath);
  runSqlite(dbPath, [{ sql: "UPDATE features SET status = 'ready' WHERE id = 'FEAT-013'" }]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "schedule_run",
    entityType: "feature",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Schedule feature execution.",
    payload: { projectId: "project-1", mode: "manual" },
    now: stableDate,
  });
  const eventReceipt = submitConsoleCommand(dbPath, {
    action: "schedule_run",
    entityType: "feature",
    entityId: "FEAT-013",
    requestedBy: "operator",
    reason: "Record CI trigger.",
    payload: { projectId: "project-1", mode: "ci_failed" },
    now: stableDate,
  });
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
  ]);

  assert.equal(receipt.scheduleTriggerId, result.queries.triggers[0].id);
  assert.equal(receipt.selectionDecisionId, result.queries.decisions[0].id);
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
  assert.deepEqual(result.queries.decisions.map((row) => [row.selected_feature_id, row.memory_summary]), [
    ["FEAT-013", `schedule_trigger:${receipt.scheduleTriggerId}`],
  ]);
});

function makeDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), "feat-013-console-"));
  writeConsoleSkill(root);
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  return dbPath;
}

function writeConsoleSkill(root: string): void {
  writeSkill(root, "console-skill", "---\nname: Console Skill\ndescription: Displays console data.\n---\n");
}

function writeSkill(root: string, slug: string, content: string): void {
  const skillDir = join(root, ".agents", "skills", slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content, "utf8");
}

function seedBoardPatchData(dbPath: string): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, required_skill_slug, subagent, estimated_effort
        ) VALUES
          ('TASK-DONE', 'TG-FEAT-013', 'FEAT-013', 'Done prerequisite', 'done', '[]', '[]', '[]', '[]', 'low', 'console-skill', 'coding', 1),
          ('TASK-READY', 'TG-FEAT-013', 'FEAT-013', 'Ready board task', 'ready', '[]', '[]', '[]', '["TASK-DONE"]', 'low', 'console-skill', 'coding', 1),
          ('TASK-SCHEDULED', 'TG-FEAT-013', 'FEAT-013', 'Scheduled board task', 'scheduled', '[]', '[]', '[]', '["TASK-DONE"]', 'medium', 'console-skill', 'coding', 1),
          ('TASK-HIGH', 'TG-FEAT-013', 'FEAT-013', 'High risk board task', 'scheduled', '[]', '[]', '[]', '["TASK-DONE"]', 'high', 'console-skill', 'coding', 1),
          ('TASK-HIGH-NO-REVIEW', 'TG-FEAT-013', 'FEAT-013', 'High risk task without review', 'scheduled', '[]', '[]', '[]', '["TASK-DONE"]', 'high', 'console-skill', 'coding', 1)`,
    },
    {
      sql: `INSERT INTO state_transitions (
          id, entity_type, entity_id, from_status, to_status, reason, evidence, triggered_by, occurred_at
        ) VALUES ('STATE-TASK-READY', 'task', 'TASK-READY', 'backlog', 'ready', 'Prepared for board scheduling.', 'TASK-READY evidence', 'test', '2026-04-28T11:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO evidence_packs (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES (
          'EVID-TASK-READY', 'RUN-013', 'TASK-READY', 'FEAT-013', '.autobuild/evidence/TASK-READY.json', 'test',
          'Ready task test evidence.', '{"diff":{"files":["src/product-console.ts"]},"testResults":{"command":"node --test tests/product-console.test.ts","passed":true}}'
        )`,
    },
    {
      sql: `INSERT INTO recovery_attempts (
          id, fingerprint_id, task_id, action, strategy, command, file_scope_json, status, summary, evidence_pack_json, attempted_at
        ) VALUES (
          'REC-TASK-READY', 'FP-READY', 'TASK-READY', 'retry', 'rerun-targeted-test', 'node --test tests/product-console.test.ts',
          '["src/product-console.ts"]', 'failed', 'Targeted recovery attempt failed.', '{"id":"EVID-TASK-READY"}', '2026-04-28T11:30:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO forbidden_retry_records (
          id, fingerprint_id, task_id, failed_strategy, failed_command, failed_file_scope_json, reason, evidence_pack_id, created_at
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
      sql: `INSERT INTO runs (id, task_id, feature_id, project_id, status, started_at, metadata_json)
        VALUES
          ('RUN-013', 'TASK-RUNNING', 'FEAT-013', 'project-1', 'running', '2026-04-28T08:00:00.000Z', '{"automatic":true}'),
          ('RUN-FAILED', 'TASK-FAILED', 'FEAT-013', 'project-1', 'failed', '2026-04-28T09:00:00.000Z', '{"automatic":true}'),
          ('RUN-MANUAL', 'TASK-RUNNING', 'FEAT-013', 'project-1', 'completed', '2026-04-28T10:00:00.000Z', '{"automatic":false}'),
          ('RUN-OTHER', 'TASK-OTHER', 'FEAT-OTHER', 'project-2', 'failed', '2026-04-28T10:30:00.000Z', '{"automatic":true}')`,
    },
    {
      sql: `INSERT INTO task_graphs (id, feature_id, graph_json)
        VALUES ('TG-FEAT-013', 'FEAT-013', '{"tasks":[{"taskId":"TASK-RUNNING"}]}')`,
    },
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, required_skill_slug, subagent, estimated_effort
        ) VALUES
          ('TASK-RUNNING', 'TG-FEAT-013', 'FEAT-013', 'Implement dashboard', 'running', '[]', '[]', '[]', '[]', 'low', 'console-skill', 'coding', 1),
          ('TASK-FAILED', 'TG-FEAT-013', 'FEAT-013', 'Implement review list', 'failed', '[]', '[]', '[]', '[]', 'low', 'console-skill', 'coding', 1)`,
    },
    {
      sql: `INSERT INTO planning_pipeline_runs (id, feature_id, status, stages_json)
        VALUES ('PLAN-FEAT-013', 'FEAT-013', 'completed', '[
          {"slug":"technical-context-skill","status":"completed"},
          {"slug":"data-model-skill","status":"completed","output":{"entities":["ConsoleDashboard"]}},
          {"slug":"contract-design-skill","status":"completed","output":{"endpoints":["/console/dashboard"]}}
        ]')`,
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
      sql: `INSERT INTO subagent_events (id, run_id, status, message, token_usage_json)
        VALUES ('EVT-1', 'RUN-013', 'running', 'Running dashboard work.', '{"inputTokens":10,"outputTokens":5,"totalTokens":15}')`,
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
      sql: `INSERT INTO evidence_packs (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES (
          'EVID-1', 'RUN-013', 'TASK-RUNNING', 'FEAT-013', '.autobuild/evidence/RUN-013.json', 'test',
          'Console evidence with PR metadata.', '{"pullRequest":{"id":"PR-13","title":"Product Console","url":"https://example.test/pr/13","createdAt":"2026-04-28T12:00:00.000Z"}}'
        )`,
    },
    {
      sql: `INSERT INTO evidence_packs (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES ('EVID-CLARIFY', 'RUN-013', 'TASK-RUNNING', 'FEAT-013', '.autobuild/evidence/clarification.json', 'clarification', 'Clarified console command boundary.', '{}')`,
    },
    {
      sql: `INSERT INTO evidence_packs (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES ('EVID-EVOLUTION', 'RUN-013', 'TASK-RUNNING', 'FEAT-013', '.autobuild/evidence/spec-evolution.json', 'spec_evolution', 'Spec diff for Product Console.', '{}')`,
    },
    {
      sql: `INSERT INTO delivery_reports (id, feature_id, path, summary)
        VALUES ('DELIVERY-13', 'FEAT-013', '.autobuild/reports/feat-013.md', 'Delivery report with spec version diff.')`,
    },
    {
      sql: `INSERT INTO review_items (id, feature_id, task_id, status, severity, body, evidence_refs_json, created_at)
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
    { sql: `INSERT INTO metric_samples (id, metric_name, metric_value, unit, labels_json) VALUES ('M-1', 'cost_usd', 1.25, 'usd', '{"projectId":"project-1"}')` },
    { sql: `INSERT INTO metric_samples (id, metric_name, metric_value, unit, labels_json) VALUES ('M-2', 'tokens_used', 9000, 'tokens', '{"projectId":"project-1"}')` },
    { sql: `INSERT INTO metric_samples (id, metric_name, metric_value, unit, labels_json) VALUES ('M-3', 'success_rate', 0.8, 'ratio', '{"projectId":"project-1"}')` },
    { sql: `INSERT INTO metric_samples (id, metric_name, metric_value, unit, labels_json) VALUES ('M-4', 'failure_rate', 0.2, 'ratio', '{"projectId":"project-1"}')` },
    { sql: `INSERT INTO metric_samples (id, metric_name, metric_value, unit, labels_json) VALUES ('M-OTHER', 'cost_usd', 99, 'usd', '{"projectId":"project-2"}')` },
  ]);
}
