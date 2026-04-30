import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  BULLMQ_CLI_RUNNER_QUEUE,
  BULLMQ_FEATURE_SCHEDULER_QUEUE,
  CLI_WORKER_LOCK_DURATION_MS,
  CLI_RUNNER_QUEUE,
  createMemoryScheduler,
  FEATURE_WORKER_LOCK_DURATION_MS,
  FEATURE_SCHEDULER_QUEUE,
  PLANNING_BRIDGE_NOT_IMPLEMENTED,
  runCliRunJob,
  runFeaturePlanJob,
  runFeatureSelectJob,
} from "../src/scheduler.ts";

test("BullMQ queue names avoid reserved colon separator while logical queue names stay traceable", () => {
  assert.equal(FEATURE_SCHEDULER_QUEUE, "specdrive:feature-scheduler");
  assert.equal(CLI_RUNNER_QUEUE, "specdrive:cli-runner");
  assert.equal(BULLMQ_FEATURE_SCHEDULER_QUEUE.includes(":"), false);
  assert.equal(BULLMQ_CLI_RUNNER_QUEUE.includes(":"), false);
});

test("CLI worker lock is long enough for skill invocations", () => {
  assert.equal(FEATURE_WORKER_LOCK_DURATION_MS >= 5 * 60 * 1000, true);
  assert.equal(CLI_WORKER_LOCK_DURATION_MS >= 60 * 60 * 1000, true);
});

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
  const root = mkdtempSync(join(tmpdir(), "specdrive-feature-plan-"));
  prepareSkillWorkspace(root);
  runSqlite(dbPath, [
    { sql: "INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, target_repo_path, default_branch, environment) VALUES ('project-1', 'Project', 'Goal', 'app', '[]', ?, 'main', 'dev')", params: [root] },
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

test("feature.plan enqueues a workspace-aware planning CLI run when bridge is available", () => {
  const dbPath = makeDbPath();
  const root = mkdtempSync(join(tmpdir(), "specdrive-feature-plan-bridge-"));
  prepareSkillWorkspace(root);
  runSqlite(dbPath, [
    { sql: "INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, target_repo_path, default_branch, environment) VALUES ('project-1', 'Project', 'Goal', 'app', '[]', ?, 'main', 'dev')", params: [root] },
    { sql: "INSERT INTO repository_connections (id, project_id, provider, local_path, default_branch) VALUES ('repo-1', 'project-1', 'local', ?, 'main')", params: [root] },
    {
      sql: `INSERT INTO features (id, project_id, title, status, priority, dependencies_json, primary_requirements_json)
        VALUES ('FEAT-PLAN', 'project-1', 'Planning bridge', 'planning', 10, '[]', '["REQ-068"]')`,
    },
  ]);
  const scheduler = createMemoryScheduler(dbPath);

  const result = runFeaturePlanJob(dbPath, { projectId: "project-1", featureId: "FEAT-PLAN", triggerId: "TRIG-PLAN" }, scheduler);
  const rows = runSqlite(dbPath, [], [
    { name: "runs", sql: "SELECT id, feature_id, project_id, status, metadata_json FROM runs WHERE feature_id = 'FEAT-PLAN'" },
    { name: "jobs", sql: "SELECT job_type, target_type, target_id, payload_json FROM scheduler_job_records WHERE job_type = 'cli.run'" },
  ]).queries;

  assert.equal(Boolean(result.runId), true);
  assert.equal(rows.runs[0].status, "queued");
  assert.equal(JSON.parse(String(rows.runs[0].metadata_json)).workspaceRoot, root);
  assert.deepEqual(rows.jobs.map((row) => [row.job_type, row.target_type, row.target_id]), [["cli.run", "feature", "FEAT-PLAN"]]);
  assert.equal(JSON.parse(String(rows.jobs[0].payload_json)).skillSlug, "technical-context-skill");
});

test("cli.run executes mocked Codex runner and persists runner artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-cli-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  const calls: Array<{ cwd: string; args: string[] }> = [];

  const result = await runCliRunJob(dbPath, { projectId: "project-1", featureId: "FEAT-CLI", taskId: "TASK-CLI", runId: "RUN-CLI" }, () => ({
    status: 0,
    stdout: '{"type":"session","session_id":"SESSION-CLI"}\n{"type":"result","message":"done"}',
    stderr: "",
  }));
  const resultWithSpy = await runCliRunJob(dbPath, { projectId: "project-1", featureId: "FEAT-CLI", taskId: "TASK-CLI", runId: "RUN-CLI-SPY" }, (_command, args, cwd) => {
    calls.push({ cwd, args });
    return {
    status: 0,
    stdout: '{"type":"session","session_id":"SESSION-CLI"}\n{"type":"result","message":"done"}',
    stderr: "",
    };
  });
  const rows = runSqlite(dbPath, [], [
    { name: "runs", sql: "SELECT status FROM runs WHERE id = 'RUN-CLI'" },
    { name: "task", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-CLI'" },
    { name: "sessions", sql: "SELECT session_id, exit_code FROM codex_session_records WHERE run_id = 'RUN-CLI'" },
    { name: "logs", sql: "SELECT stdout FROM raw_execution_logs WHERE run_id = 'RUN-CLI'" },
    { name: "evidence", sql: "SELECT kind, summary, metadata_json FROM evidence_packs WHERE run_id = 'RUN-CLI-SPY'" },
  ]).queries;

  assert.equal(result.status, "completed");
  assert.equal(resultWithSpy.status, "completed");
  assert.equal(calls[0].cwd, root);
  assert.match(calls[0].args.join("\n"), /Skill Invocation Contract/);
  assert.match(calls[0].args.join("\n"), /codex-coding-skill/);
  assert.match(calls[0].args.join("\n"), /Workspace Context Bundle/);
  assert.match(calls[0].args.join("\n"), /### AGENTS.md/);
  assert.match(calls[0].args.join("\n"), /# Test workspace/);
  assert.match(calls[0].args.join("\n"), /### \.agents\/skills\/codex-coding-skill\/SKILL.md/);
  assert.match(calls[0].args.join("\n"), /# Codex coding skill/);
  assert.equal(rows.runs[0].status, "completed");
  assert.equal(rows.task[0].status, "checking");
  assert.deepEqual(rows.sessions.map((row) => [row.session_id, row.exit_code]), [["SESSION-CLI", 0]]);
  assert.match(String(rows.logs[0].stdout), /done/);
  assert.equal(rows.evidence[0].kind, "codex_runner");
  assert.equal(JSON.parse(String(rows.evidence[0].metadata_json)).skillInvocation.skillSlug, "codex-coding-skill");
});

test("cli.run blocks when target project workspace is missing or lacks workspace skills", async () => {
  const dbPath = makeDbPath();
  runSqlite(dbPath, [
    { sql: "INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, target_repo_path, default_branch, environment) VALUES ('project-1', 'Project', 'Goal', 'app', '[]', '/tmp/specdrive-missing-workspace', 'main', 'dev')" },
    { sql: "INSERT INTO features (id, project_id, title, status, priority, dependencies_json, primary_requirements_json) VALUES ('FEAT-CLI', 'project-1', 'CLI', 'tasked', 1, '[]', '[]')" },
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json,
          acceptance_criteria_json, allowed_files_json, dependencies_json, risk, estimated_effort
        ) VALUES ('TASK-CLI', 'TG-CLI', 'FEAT-CLI', 'Run CLI task', 'scheduled', '[]', '[]', '["src/index.ts"]', '[]', 'low', 1)`,
    },
  ]);

  const result = await runCliRunJob(dbPath, { projectId: "project-1", featureId: "FEAT-CLI", taskId: "TASK-CLI", runId: "RUN-BLOCKED" }, () => {
    throw new Error("runner should not be called");
  });
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT status, summary FROM runs WHERE id = 'RUN-BLOCKED'" },
  ]).queries.run;

  assert.equal(result.status, "blocked");
  assert.equal(rows[0].status, "blocked");
  assert.match(String(rows[0].summary), /workspace root is missing or unreadable/);
});

test("cli.run blocks when CLI adapters exist in DB but none is active", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-cli-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  // Insert a disabled adapter so the table is non-empty with no active row
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO cli_adapter_configs (id, display_name, schema_version, executable, argument_template_json,
          resume_argument_template_json, config_schema_json, form_schema_json, defaults_json,
          environment_allowlist_json, output_mapping_json, status, updated_at)
        VALUES ('adapter-disabled', 'Disabled Adapter', 1, 'codex', '[]', '[]', '{}', '{}', '{}', '[]', '{}', 'disabled', CURRENT_TIMESTAMP)`,
    },
  ]);

  const result = await runCliRunJob(dbPath, { projectId: "project-1", featureId: "FEAT-CLI", taskId: "TASK-CLI", runId: "RUN-NO-ADAPTER" }, () => {
    throw new Error("runner should not be called");
  });
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT status, summary FROM runs WHERE id = 'RUN-NO-ADAPTER'" },
  ]).queries.run;

  assert.equal(result.status, "blocked");
  assert.equal(rows[0].status, "blocked");
  assert.match(String(rows[0].summary), /No active CLI adapter/);
});

test("cli.run uses default built-in adapter when cli_adapter_configs table is empty", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-cli-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  // Table is empty (no adapters configured) — should fall back to DEFAULT and succeed

  const result = await runCliRunJob(dbPath, { projectId: "project-1", featureId: "FEAT-CLI", taskId: "TASK-CLI", runId: "RUN-DEFAULT-ADAPTER" }, () => ({
    status: 0,
    stdout: '{"type":"session","session_id":"SESSION-DEFAULT"}\n{"type":"result","message":"done"}',
    stderr: "",
  }));

  assert.equal(result.status, "completed");
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

function prepareSkillWorkspace(root: string): void {
  mkdirSync(join(root, ".agents", "skills", "codex-coding-skill"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "# Test workspace\n");
  writeFileSync(join(root, ".agents", "skills", "codex-coding-skill", "SKILL.md"), "# Codex coding skill\n");
}
