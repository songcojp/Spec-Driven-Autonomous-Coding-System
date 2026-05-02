import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  BULLMQ_CLI_RUNNER_QUEUE,
  CLI_WORKER_LOCK_DURATION_MS,
  CLI_RUNNER_QUEUE,
  createMemoryScheduler,
  runCliRunJob,
} from "../src/scheduler.ts";

test("BullMQ queue names avoid reserved colon separator while logical queue names stay traceable", () => {
  assert.equal(CLI_RUNNER_QUEUE, "specdrive:cli-runner");
  assert.equal(BULLMQ_CLI_RUNNER_QUEUE.includes(":"), false);
});

test("CLI worker lock is long enough for skill invocations", () => {
  assert.equal(CLI_WORKER_LOCK_DURATION_MS >= 60 * 60 * 1000, true);
});

test("scheduler schema records executor job metadata without feature target columns", () => {
  const dbPath = makeDbPath();
  const tables = listTables(dbPath);
  assert.equal(tables.includes("scheduler_job_records"), true);
  assert.equal(tables.includes("execution_records"), true);

  const scheduler = createMemoryScheduler(dbPath);
  const job = scheduler.enqueueCliRun({
    executionId: "EXEC-001",
    operation: "feature_execution",
    projectId: "project-1",
    context: { featureId: "FEAT-001", featureSpecPath: "docs/features/feat-001" },
  });
  const rows = runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT id, queue_name, job_type, status, payload_json FROM scheduler_job_records" },
    { name: "columns", sql: "PRAGMA table_info(scheduler_job_records)" },
  ]).queries.jobs;
  const columns = runSqlite(dbPath, [], [{ name: "columns", sql: "PRAGMA table_info(scheduler_job_records)" }]).queries.columns.map((row) => row.name);

  assert.equal(job.queueName, "specdrive:cli-runner");
  assert.equal(columns.includes("target_type"), false);
  assert.equal(columns.includes("target_id"), false);
  assert.deepEqual(rows.map((row) => [row.id, row.queue_name, row.job_type, row.status, JSON.parse(String(row.payload_json)).operation]), [
    [job.schedulerJobId, "specdrive:cli-runner", "cli.run", "queued", "feature_execution"],
  ]);
});

test("cli.run executes mocked Codex runner and persists runner artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-cli-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  const calls: Array<{ cwd: string; args: string[] }> = [];

  const result = await runCliRunJob(dbPath, cliRunPayload("RUN-CLI"), () => ({
    status: 0,
    stdout: `{"type":"session","session_id":"SESSION-CLI"}\n${skillOutputEvent("RUN-CLI")}`,
    stderr: "",
  }));
  const resultWithSpy = await runCliRunJob(dbPath, cliRunPayload("RUN-CLI-SPY"), (_command, args, cwd) => {
    calls.push({ cwd, args });
    return {
    status: 0,
    stdout: `{"type":"session","session_id":"SESSION-CLI"}\n${skillOutputEvent("RUN-CLI-SPY")}`,
    stderr: "",
    };
  });
  const rows = runSqlite(dbPath, [], [
    { name: "runs", sql: "SELECT status, metadata_json FROM execution_records WHERE id = 'RUN-CLI'" },
    { name: "task", sql: "SELECT status FROM task_graph_tasks WHERE id = 'TASK-CLI'" },
    { name: "sessions", sql: "SELECT session_id, exit_code FROM codex_session_records WHERE run_id = 'RUN-CLI'" },
    { name: "logs", sql: "SELECT stdout FROM raw_execution_logs WHERE run_id = 'RUN-CLI'" },
    { name: "evidence", sql: "SELECT kind, summary, metadata_json FROM evidence_packs WHERE run_id = 'RUN-CLI-SPY'" },
    { name: "policy", sql: "SELECT sandbox_mode FROM runner_policies WHERE run_id = 'RUN-CLI-SPY'" },
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
  assert.equal(rows.policy[0].sandbox_mode, "danger-full-access");
  assert.match(calls[0].args.join("\n"), /--sandbox\ndanger-full-access/);
  assert.equal(rows.runs[0].status, "completed");
  assert.equal(JSON.parse(String(rows.runs[0].metadata_json)).contractValidation.valid, true);
  assert.equal(rows.task[0].status, "checking");
  assert.deepEqual(rows.sessions.map((row) => [row.session_id, row.exit_code]), [["SESSION-CLI", 0]]);
  assert.match(String(rows.logs[0].stdout), /skill-contract\/v1/);
  assert.equal(rows.evidence[0].kind, "codex_runner");
  assert.equal(JSON.parse(String(rows.evidence[0].metadata_json)).skillInvocation.skillSlug, "codex-coding-skill");
});

test("cli.run uses danger-full-access for trusted direct-write runs with bounded scope", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-cli-run-"));
  prepareSkillWorkspace(root);
  mkdirSync(join(root, ".agents", "skills", "pr-ears-requirement-decomposition-skill"), { recursive: true });
  writeFileSync(join(root, ".agents", "skills", "pr-ears-requirement-decomposition-skill", "SKILL.md"), "# PR EARS skill\n");
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "PRD.md"), "# PRD\n");
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  const calls: Array<{ args: string[] }> = [];

  const result = await runCliRunJob(
    dbPath,
    {
      projectId: "project-1",
      executionId: "RUN-EARS-DIRECT",
      operation: "generate_ears",
      requestedAction: "generate_ears",
      context: {
        skillSlug: "pr-ears-requirement-decomposition-skill",
        skillPhase: "generate_ears",
        sourcePaths: ["docs/PRD.md"],
        expectedArtifacts: ["docs/requirements.md"],
      },
    },
    (_command, args) => {
      calls.push({ args });
      writeFileSync(join(root, "docs", "requirements.md"), "# Requirements\n");
      return {
        status: 0,
        stdout: `{"type":"session","session_id":"SESSION-EARS"}\n${skillOutputEvent("RUN-EARS-DIRECT", {
          skillSlug: "pr-ears-requirement-decomposition-skill",
          requestedAction: "generate_ears",
          producedArtifacts: [{ path: "docs/requirements.md", kind: "markdown", status: "created" }],
        })}`,
        stderr: "",
      };
    },
  );
  const rows = runSqlite(dbPath, [], [
    { name: "policy", sql: "SELECT sandbox_mode FROM runner_policies WHERE run_id = 'RUN-EARS-DIRECT'" },
  ]).queries;

  assert.equal(result.status, "completed");
  assert.equal(rows.policy[0].sandbox_mode, "danger-full-access");
  assert.match(calls[0].args.join("\n"), /--sandbox\ndanger-full-access/);
});

test("cli.run uses development sandbox defaults when allowed file scope is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-cli-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  runSqlite(dbPath, [
    { sql: "UPDATE task_graph_tasks SET allowed_files_json = '[]' WHERE id = 'TASK-CLI'" },
  ]);
  const calls: Array<{ args: string[] }> = [];

  const result = await runCliRunJob(
    dbPath,
    cliRunPayload("RUN-CODING-UNBOUNDED"),
    (_command, args) => {
      calls.push({ args });
      return {
        status: 0,
        stdout: `{"type":"session","session_id":"SESSION-CODING"}\n${skillOutputEvent("RUN-CODING-UNBOUNDED")}`,
        stderr: "",
      };
    },
  );
  const rows = runSqlite(dbPath, [], [
    { name: "policy", sql: "SELECT sandbox_mode FROM runner_policies WHERE run_id = 'RUN-CODING-UNBOUNDED'" },
  ]).queries;

  assert.equal(result.status, "completed");
  assert.equal(rows.policy[0].sandbox_mode, "danger-full-access");
  assert.match(calls[0].args.join("\n"), /--sandbox\ndanger-full-access/);
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

  const result = await runCliRunJob(dbPath, cliRunPayload("RUN-BLOCKED"), () => {
    throw new Error("runner should not be called");
  });
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT status, summary FROM execution_records WHERE id = 'RUN-BLOCKED'" },
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

  const result = await runCliRunJob(dbPath, cliRunPayload("RUN-NO-ADAPTER"), () => {
    throw new Error("runner should not be called");
  });
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT status, summary FROM execution_records WHERE id = 'RUN-NO-ADAPTER'" },
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

  const result = await runCliRunJob(dbPath, cliRunPayload("RUN-DEFAULT-ADAPTER"), () => ({
    status: 0,
    stdout: `{"type":"session","session_id":"SESSION-DEFAULT"}\n${skillOutputEvent("RUN-DEFAULT-ADAPTER")}`,
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

function cliRunPayload(executionId: string) {
  return {
    projectId: "project-1",
    executionId,
    operation: "feature_execution",
    context: {
      featureId: "FEAT-CLI",
      taskId: "TASK-CLI",
      skillPhase: "feature_execution",
    },
  };
}

function skillOutputEvent(executionId: string, overrides: {
  skillSlug?: string;
  requestedAction?: string;
  producedArtifacts?: Array<{ path: string; kind: string; status: string }>;
} = {}): string {
  const output = {
    contractVersion: "skill-contract/v1",
    executionId,
    skillSlug: overrides.skillSlug ?? "codex-coding-skill",
    requestedAction: overrides.requestedAction ?? "feature_execution",
    status: "completed",
    summary: "Skill completed.",
    producedArtifacts: overrides.producedArtifacts ?? [],
    evidence: [{ kind: "command", summary: "Mock runner completed.", status: "passed" }],
    traceability: {
      featureId: overrides.skillSlug ? undefined : "FEAT-CLI",
      taskId: overrides.skillSlug ? undefined : "TASK-CLI",
      requirementIds: [],
      changeIds: ["CHG-016"],
    },
  };
  return JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(output) } });
}

function prepareSkillWorkspace(root: string): void {
  mkdirSync(join(root, ".agents", "skills", "codex-coding-skill"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "# Test workspace\n");
  writeFileSync(join(root, ".agents", "skills", "codex-coding-skill", "SKILL.md"), "# Codex coding skill\n");
}
