import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  buildDashboardQuery,
  buildReviewCenterView,
  buildRunnerConsoleView,
  buildSkillCenterView,
  buildSpecWorkspaceView,
  buildSubagentConsoleView,
  submitConsoleCommand,
} from "../src/product-console.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

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

  const skillCenter = buildSkillCenterView(dbPath, "project-1");
  assert.equal(skillCenter.skills[0].slug, "console-skill");
  assert.equal(skillCenter.skills[0].enabled, true);
  assert.equal(skillCenter.skills[0].successRate, 0.5);
  assert.deepEqual(skillCenter.skills[0].schema.input, { type: "object" });

  const subagents = buildSubagentConsoleView(dbPath);
  const scopedSubagents = buildSubagentConsoleView(dbPath, "project-1");
  assert.equal(subagents.runs.some((run) => run.runContract && run.contextSlice && run.tokenUsage), true);
  assert.equal(scopedSubagents.runs.some((run) => run.id === "RUN-OTHER"), false);
  assert.equal(subagents.commands.map((command) => command.action).join(","), "terminate_subagent,retry_subagent");

  const runner = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:00:20.000Z"));
  const scopedRunner = buildRunnerConsoleView(dbPath, new Date("2026-04-28T12:00:20.000Z"), "project-1");
  assert.equal(runner.runners[0].online, true);
  assert.equal(runner.runners[0].queue.length, 1);
  assert.equal(runner.runners[0].queue[0].status, "running");
  assert.equal(runner.runners.find((entry) => entry.runnerId === "runner-other")?.codexVersion, undefined);
  assert.equal(scopedRunner.runners.some((entry) => entry.runnerId === "runner-other"), false);
  assert.equal(runner.commands.map((command) => command.action).join(","), "pause_runner,resume_runner");

  const reviews = buildReviewCenterView(dbPath);
  const scopedReviews = buildReviewCenterView(dbPath, "project-1");
  assert.equal(reviews.items[0].id, "REV-1");
  assert.equal(reviews.items[0].body, "Needs approval");
  assert.equal(reviews.items[0].evidence.some((entry) => entry.path === ".autobuild/evidence/RUN-013.json"), true);
  assert.equal(scopedReviews.items.some((item) => item.id === "REV-OTHER"), false);
  assert.equal(reviews.items.find((item) => item.id === "REV-GLOBAL")?.evidence.length, 0);
  assert.deepEqual(reviews.items[0].diff, { files: ["src/product-console.ts"] });
  assert.deepEqual(reviews.riskFilters, ["high", "medium"]);
  assert.equal(reviews.commands.some((command) => command.action === "write_spec_evolution"), true);
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

function makeDbPath(): string {
  const dbPath = join(mkdtempSync(join(tmpdir(), "feat-013-console-")), ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  return dbPath;
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
      sql: `INSERT INTO skills (
          id, slug, name, description, trigger, risk_level, phase, input_schema_json, output_schema_json, current_version, enabled
        ) VALUES (
          'SKILL-1', 'console-skill', 'Console Skill', 'Displays console data.', 'console', 'low', 'review',
          '{"type":"object"}', '{"type":"object"}', '1.2.0', 1
        )`,
    },
    {
      sql: `INSERT INTO skill_runs (id, skill_slug, status)
        VALUES ('SKILL-RUN-1', 'console-skill', 'completed'), ('SKILL-RUN-2', 'console-skill', 'failed')`,
    },
    {
      sql: `INSERT INTO skill_runs (id, skill_slug, run_id, status)
        VALUES ('SKILL-RUN-OTHER', 'console-skill', 'RUN-OTHER', 'completed')`,
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
      sql: `INSERT INTO agent_run_contracts (id, run_id, contract_json)
        VALUES ('CONTRACT-1', 'RUN-013', '{"allowedFiles":["src/product-console.ts"]}')`,
    },
    {
      sql: `INSERT INTO context_slice_refs (id, run_id, refs_json, token_estimate)
        VALUES ('CTX-1', 'RUN-013', '[{"kind":"spec_slice","sourceId":"REQ-052"}]', 120)`,
    },
    {
      sql: `INSERT INTO subagent_events (id, run_id, status, message, token_usage_json)
        VALUES ('EVT-1', 'RUN-013', 'running', 'Running dashboard work.', '{"inputTokens":10,"outputTokens":5,"totalTokens":15}')`,
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
      sql: `INSERT INTO review_items (id, feature_id, status, severity, body, created_at)
        VALUES ('REV-1', 'FEAT-013', 'review_needed', 'high', '{"message":"Needs approval","diff":{"files":["src/product-console.ts"]}}', '2026-04-28T12:00:00.000Z')`,
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
