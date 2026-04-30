import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  createMemoryScheduler,
  PLANNING_BRIDGE_NOT_IMPLEMENTED,
  runCliRunJob,
  runFeaturePlanJob,
  runFeatureSelectJob,
} from "../src/scheduler.ts";

test("scheduler schema records BullMQ job metadata", () => {
  const dbPath = makeDbPath();
  const tables = listTables(dbPath);
  assert.equal(tables.includes("scheduler_job_records"), true);

  const scheduler = createMemoryScheduler(dbPath);
  const job = scheduler.enqueueFeatureSelect({
    triggerId: "TRIG-001",
    projectId: "project-1",
    target: { type: "project", id: "project-1" },
    mode: "manual",
    requestedFor: "2026-04-28T12:00:00.000Z",
    createdAt: "2026-04-28T12:00:00.000Z",
  });
  const rows = runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT id, queue_name, job_type, target_type, target_id, status FROM scheduler_job_records" },
  ]).queries.jobs;

  assert.equal(job.queueName, "specdrive:feature-scheduler");
  assert.deepEqual(rows.map((row) => [row.id, row.queue_name, row.job_type, row.target_type, row.target_id, row.status]), [
    [job.schedulerJobId, "specdrive:feature-scheduler", "feature.select", "project", "project-1", "queued"],
  ]);
});

test("feature.select reads live ready features, records decision, and enqueues planning", () => {
  const dbPath = makeDbPath();
  seedFeatureSchedulerData(dbPath);
  const scheduler = createMemoryScheduler(dbPath);

  const result = runFeatureSelectJob(dbPath, scheduler, {
    triggerId: "TRIG-READY",
    projectId: "project-1",
    target: { type: "project", id: "project-1" },
    mode: "manual",
    requestedFor: "2026-04-28T12:00:00.000Z",
    createdAt: "2026-04-28T12:00:00.000Z",
  });
  const rows = runSqlite(dbPath, [], [
    { name: "features", sql: "SELECT id, status FROM features WHERE id IN ('FEAT-A', 'FEAT-B') ORDER BY id" },
    { name: "decisions", sql: "SELECT id, selected_feature_id, memory_summary FROM feature_selection_decisions" },
    { name: "jobs", sql: "SELECT job_type, target_id, status FROM scheduler_job_records ORDER BY rowid" },
  ]).queries;

  assert.equal(result.selectedFeatureId, "FEAT-B");
  assert.deepEqual(rows.features.map((row) => [row.id, row.status]), [["FEAT-A", "ready"], ["FEAT-B", "planning"]]);
  assert.deepEqual(rows.decisions.map((row) => [row.id, row.selected_feature_id, row.memory_summary]), [
    [result.decisionId, "FEAT-B", "schedule_trigger:TRIG-READY"],
  ]);
  assert.deepEqual(rows.jobs.map((row) => [row.job_type, row.target_id, row.status]), [["feature.plan", "FEAT-B", "queued"]]);
});

test("feature.plan blocks when Codex Skill bridge is absent and does not create fake tasks", () => {
  const dbPath = makeDbPath();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO features (id, project_id, title, status, priority, dependencies_json, primary_requirements_json)
        VALUES ('FEAT-PLAN', 'project-1', 'Planning bridge', 'planning', 10, '[]', '[]')`,
    },
  ]);

  runFeaturePlanJob(dbPath, { projectId: "project-1", featureId: "FEAT-PLAN", triggerId: "TRIG-PLAN" });
  const rows = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-PLAN'" },
    { name: "tasks", sql: "SELECT id FROM task_graph_tasks WHERE feature_id = 'FEAT-PLAN'" },
    { name: "audit", sql: "SELECT event_type, reason FROM audit_timeline_events WHERE entity_id = 'FEAT-PLAN' ORDER BY rowid DESC LIMIT 1" },
  ]).queries;

  assert.equal(rows.feature[0].status, "blocked");
  assert.equal(rows.tasks.length, 0);
  assert.deepEqual([rows.audit[0].event_type, rows.audit[0].reason], ["scheduler_job_blocked", PLANNING_BRIDGE_NOT_IMPLEMENTED]);
});

test("cli.run executes mocked Codex runner and persists runner artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-cli-run-"));
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);

  const result = await runCliRunJob(dbPath, { projectId: "project-1", featureId: "FEAT-CLI", taskId: "TASK-CLI", runId: "RUN-CLI" }, () => ({
    status: 0,
    stdout: '{"type":"session","session_id":"SESSION-CLI"}\n{"type":"result","message":"done"}',
    stderr: "",
  }));
  const rows = runSqlite(dbPath, [], [
    { name: "runs", sql: "SELECT status FROM runs WHERE id = 'RUN-CLI'" },
    { name: "task", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-CLI'" },
    { name: "sessions", sql: "SELECT session_id, exit_code FROM codex_session_records WHERE run_id = 'RUN-CLI'" },
    { name: "logs", sql: "SELECT stdout FROM raw_execution_logs WHERE run_id = 'RUN-CLI'" },
    { name: "evidence", sql: "SELECT kind, summary FROM evidence_packs WHERE run_id = 'RUN-CLI'" },
  ]).queries;

  assert.equal(result.status, "completed");
  assert.equal(rows.runs[0].status, "completed");
  assert.equal(rows.task[0].status, "checking");
  assert.deepEqual(rows.sessions.map((row) => [row.session_id, row.exit_code]), [["SESSION-CLI", 0]]);
  assert.match(String(rows.logs[0].stdout), /done/);
  assert.equal(rows.evidence[0].kind, "codex_runner");
});

function makeDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), "specdrive-scheduler-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  return dbPath;
}

function seedFeatureSchedulerData(dbPath: string): void {
  runSqlite(dbPath, [
    { sql: "INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, target_repo_path, default_branch, environment) VALUES ('project-1', 'Project', 'Goal', 'app', '[]', '/tmp/project', 'main', 'dev')" },
    {
      sql: `INSERT INTO features (id, project_id, title, status, priority, dependencies_json, primary_requirements_json)
        VALUES
          ('FEAT-A', 'project-1', 'Lower priority', 'ready', 1, '[]', '[]'),
          ('FEAT-B', 'project-1', 'Higher priority', 'ready', 10, '[]', '[]')`,
    },
  ]);
}

function seedCliRunData(dbPath: string, root: string): void {
  runSqlite(dbPath, [
    { sql: "INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, target_repo_path, default_branch, environment) VALUES (?, 'Project', 'Goal', 'app', '[]', ?, 'main', 'dev')", params: ["project-1", root] },
    { sql: "INSERT INTO features (id, project_id, title, status, priority, dependencies_json, primary_requirements_json) VALUES ('FEAT-CLI', 'project-1', 'CLI', 'tasked', 1, '[]', '[]')" },
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json,
          acceptance_criteria_json, allowed_files_json, dependencies_json, risk, estimated_effort
        ) VALUES ('TASK-CLI', 'TG-CLI', 'FEAT-CLI', 'Run CLI task', 'scheduled', '[]', '[]', '["src/index.ts"]', '[]', 'low', 1)`,
    },
  ]);
}
