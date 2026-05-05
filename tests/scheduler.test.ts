import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  BULLMQ_CLI_RUNNER_QUEUE,
  BULLMQ_EXECUTION_ADAPTER_QUEUE,
  CLI_WORKER_LOCK_DURATION_MS,
  CLI_RUNNER_QUEUE,
  EXECUTION_ADAPTER_QUEUE,
  createMemoryScheduler,
  bullMqExecutionAdapterQueueName,
  listRecoverableSchedulerJobs,
  runCodexAppServerRunJob,
  runCliRunJob,
  runRpcRunJob,
} from "../src/scheduler.ts";
import type { CliJsonEvent } from "../src/cli-adapter.ts";
import type { CodexAppServerTransport } from "../src/codex-rpc-adapter.ts";
import type { GeminiAcpTransport } from "../src/gemini-rpc-adapter.ts";

test("BullMQ queue names avoid reserved colon separator while logical queue names stay traceable", () => {
  assert.equal(EXECUTION_ADAPTER_QUEUE, "specdrive:execution-adapter");
  assert.equal(CLI_RUNNER_QUEUE, EXECUTION_ADAPTER_QUEUE);
  assert.equal(BULLMQ_EXECUTION_ADAPTER_QUEUE.includes(":"), false);
  assert.equal(BULLMQ_CLI_RUNNER_QUEUE.includes(":"), false);
  assert.match(bullMqExecutionAdapterQueueName("/tmp/project-a/.autobuild/autobuild.db"), /^specdrive-execution-adapter-[a-f0-9]{12}$/);
  assert.notEqual(
    bullMqExecutionAdapterQueueName("/tmp/project-a/.autobuild/autobuild.db"),
    bullMqExecutionAdapterQueueName("/tmp/project-b/.autobuild/autobuild.db"),
  );
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
  assert.equal(job.queueName, "specdrive:execution-adapter");
  const appServerJob = scheduler.enqueueRpcRun?.({
    executionId: "EXEC-APP",
    operation: "feature_execution",
    projectId: "project-1",
    context: { featureId: "FEAT-001", featureSpecPath: "docs/features/feat-001" },
  });
  assert.equal(appServerJob?.jobType, "rpc.run");
  const query = runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT id, queue_name, job_type, status, payload_json FROM scheduler_job_records ORDER BY rowid" },
    { name: "columns", sql: "PRAGMA table_info(scheduler_job_records)" },
  ]).queries;
  const rows = query.jobs;
  const columns = query.columns.map((row) => row.name);
  assert.equal(columns.includes("target_type"), false);
  assert.equal(columns.includes("target_id"), false);
  assert.deepEqual(rows.map((row) => [row.queue_name, row.job_type, row.status, JSON.parse(String(row.payload_json)).operation]), [
    ["specdrive:execution-adapter", "cli.run", "queued", "feature_execution"],
    ["specdrive:execution-adapter", "rpc.run", "queued", "feature_execution"],
  ]);
});

test("scheduler worker startup can recover transient queued jobs created while worker was unavailable", () => {
  const dbPath = makeDbPath();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, error, payload_json)
        VALUES ('JOB-OFF', 'BULL-OFF', 'specdrive:execution-adapter', 'cli.run', 'blocked', 'Scheduler worker mode is off.', ?)`,
      params: [JSON.stringify({
        executionId: "RUN-OFF",
        operation: "generate_ears",
        projectId: "project-1",
        requestedAction: "generate_ears",
      })],
    },
    {
      sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status)
        VALUES ('RUN-OFF', 'JOB-OFF', 'cli', 'generate_ears', 'project-1', '{}', 'queued')`,
    },
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, error, payload_json)
        VALUES ('JOB-REAL-BLOCKED', 'BULL-REAL-BLOCKED', 'specdrive:execution-adapter', 'cli.run', 'blocked', 'Project workspace root is required.', ?)`,
      params: [JSON.stringify({ executionId: "RUN-REAL-BLOCKED", operation: "generate_ears" })],
    },
  ]);

  assert.deepEqual(listRecoverableSchedulerJobs(dbPath).map((job) => [job.schedulerJobId, job.bullmqJobId, job.jobType, job.payload.operation]), [
    ["JOB-OFF", "BULL-OFF", "cli.run", "generate_ears"],
  ]);
});

test("cli.run executes mocked CLI runner and persists runner artifacts", async () => {
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
    { name: "sessions", sql: "SELECT session_id, exit_code FROM cli_session_records WHERE run_id = 'RUN-CLI'" },
    { name: "logs", sql: "SELECT stdout FROM raw_execution_logs WHERE run_id = 'RUN-CLI'" },
    { name: "statusChecks", sql: "SELECT kind, summary, metadata_json FROM status_check_results WHERE run_id = 'RUN-CLI-SPY'" },
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
  assert.equal(rows.statusChecks.length, 0);
});

test("cli.run passes clarification operator input into the skill invocation prompt", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-clarification-run-"));
  prepareSkillWorkspace(root);
  mkdirSync(join(root, ".agents", "skills", "ambiguity-clarification-skill"), { recursive: true });
  mkdirSync(join(root, "docs", "zh-CN"), { recursive: true });
  writeFileSync(join(root, ".agents", "skills", "ambiguity-clarification-skill", "SKILL.md"), "# Ambiguity clarification skill\n");
  writeFileSync(join(root, "docs", "zh-CN", "requirements.md"), "# Requirements\n\n## Open Questions\n\n1. 彩票类型未明确。\n");
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  const calls: Array<{ args: string[] }> = [];

  const result = await runCliRunJob(
    dbPath,
    {
      projectId: "project-1",
      executionId: "RUN-CLARIFICATION",
      operation: "resolve_clarification",
      requestedAction: "resolve_clarification",
      traceability: { requirementIds: [] },
      context: {
        sourcePaths: ["docs/zh-CN/requirements.md"],
        expectedArtifacts: ["docs/zh-CN/requirements.md"],
        workspaceRoot: root,
        skillSlug: "ambiguity-clarification-skill",
        skillPhase: "resolve_clarification",
        clarificationText: "彩票类型支持大乐透和双色球",
        comment: "彩票类型支持大乐透和双色球",
        specChangeIntent: "clarification",
      },
    },
    (_command, args) => {
      calls.push({ args });
      return {
        status: 0,
        stdout: `{"type":"session","session_id":"SESSION-CLARIFICATION"}\n${skillOutputEvent("RUN-CLARIFICATION", { skillSlug: "ambiguity-clarification-skill", requestedAction: "resolve_clarification" })}`,
        stderr: "",
      };
    },
  );

  const prompt = calls[0].args.join("\n");
  assert.equal(result.status, "completed");
  assert.match(prompt, /\"operatorInput\"/);
  assert.match(prompt, /\"clarificationText\": \"彩票类型支持大乐透和双色球\"/);
  assert.match(prompt, /operator-provided answer\/decision/);
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
      traceability: { requirementIds: [] },
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

test("cli.run does not include change ids in the skill invocation contract", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-cli-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);

  const result = await runCliRunJob(
    dbPath,
    {
      ...cliRunPayload("RUN-NO-CHANGE-ID"),
      traceability: { requirementIds: [] },
    },
    () => ({
      status: 0,
      stdout: `{"type":"session","session_id":"SESSION-NO-CHANGE-ID"}\n${skillOutputEvent("RUN-NO-CHANGE-ID", { changeIds: [] })}`,
      stderr: "",
    }),
  );
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT metadata_json FROM execution_records WHERE id = 'RUN-NO-CHANGE-ID'" },
  ]).queries.run;
  const metadata = JSON.parse(String(rows[0].metadata_json));

  assert.equal(result.status, "completed");
  assert.equal(Object.prototype.hasOwnProperty.call(metadata.skillInvocationContract.traceability, "changeIds"), false);
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

test("cli.run uses active Gemini CLI adapter from adapter configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-cli-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO cli_adapter_configs (id, display_name, schema_version, executable, argument_template_json,
          resume_argument_template_json, config_schema_json, form_schema_json, defaults_json,
          environment_allowlist_json, output_mapping_json, status, updated_at)
        VALUES ('gemini-cli', 'Google Gemini CLI', 1, 'gemini', ?, '[]', '{}', '{}', ?, '[]', ?, 'active', CURRENT_TIMESTAMP)`,
      params: [
        JSON.stringify(["--model", "{{model}}", "--output-format", "stream-json", "-p", "{{prompt}}"]),
        JSON.stringify({ model: "gemini-3-pro-preview", reasoningEffort: "medium", sandbox: "danger-full-access", approval: "never" }),
        JSON.stringify({ eventStream: "json", outputSchema: "skill-output.schema.json", sessionIdPath: "session_id", responseTextPaths: ["response"] }),
      ],
    },
  ]);

  const result = await runCliRunJob(dbPath, cliRunPayload("RUN-GEMINI-ADAPTER"), (command, args, cwd) => {
    calls.push({ command, args, cwd });
    return {
      status: 0,
      stdout: `{"type":"init","session_id":"SESSION-GEMINI"}\n${JSON.stringify({ type: "message", response: JSON.stringify(skillOutputObject("RUN-GEMINI-ADAPTER")) })}`,
      stderr: "",
    };
  });

  assert.equal(result.status, "completed");
  assert.equal(calls[0].command, "gemini");
  assert.deepEqual(calls[0].args.slice(0, 5), ["--model", "gemini-3-pro-preview", "--output-format", "stream-json", "-p"]);
  assert.equal(calls[0].cwd, root);
});

test("codex.rpc.run executes mocked app-server transport and persists runner artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-app-server-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  const calls: string[] = [];
  const transport: CodexAppServerTransport = {
    async request(method) {
      calls.push(method);
      if (method === "thread/start") return { threadId: "THREAD-APP" };
      if (method === "turn/start") return { turnId: "TURN-APP" };
      return {};
    },
    notify(method) {
      calls.push(method);
    },
    async *events() {
      yield { type: "item/agentMessage/delta", delta: "done" };
      yield {
        type: "turn/completed",
        status: "completed",
        output: {
          contractVersion: "skill-contract/v1",
          executionId: "RUN-APP-SERVER",
          skillSlug: "codex-coding-skill",
          requestedAction: "feature_execution",
          status: "completed",
          summary: "App server completed.",
          nextAction: "Continue.",
          producedArtifacts: [],
          traceability: {
            featureId: "FEAT-CLI",
            taskId: "TASK-CLI",
            requirementIds: [],
            changeIds: ["CHG-016"],
          },
          result: { verification: [{ status: "passed" }] },
        },
      };
    },
  };

  const result = await runCodexAppServerRunJob(dbPath, cliRunPayload("RUN-APP-SERVER"), transport);
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT status, metadata_json FROM execution_records WHERE id = 'RUN-APP-SERVER'" },
    { name: "session", sql: "SELECT session_id, command, args_json, exit_code FROM cli_session_records WHERE run_id = 'RUN-APP-SERVER'" },
    { name: "log", sql: "SELECT stdout FROM raw_execution_logs WHERE run_id = 'RUN-APP-SERVER'" },
    { name: "statusChecks", sql: "SELECT kind, summary FROM status_check_results WHERE run_id = 'RUN-APP-SERVER'" },
  ]).queries;

  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["initialize", "initialized", "thread/start", "turn/start"]);
  assert.equal(rows.run[0].status, "completed");
  const metadata = JSON.parse(String(rows.run[0].metadata_json));
  assert.equal(metadata.threadId, "THREAD-APP");
  assert.equal(metadata.turnId, "TURN-APP");
  assert.equal(metadata.transport, "stdio");
  assert.equal(metadata.model, "gpt-5.5");
  assert.equal(metadata.cwd, root);
  assert.equal(metadata.contractValidation.valid, true);
  assert.equal(rows.session[0].session_id, "THREAD-APP");
  assert.equal(rows.session[0].command, "codex");
  assert.deepEqual(JSON.parse(String(rows.session[0].args_json)), ["app-server"]);
  assert.equal(rows.session[0].exit_code, 0);
  assert.equal(rows.log[0].stdout, "done");
  assert.equal(rows.statusChecks.length, 0);
});

test("rpc.run dispatches active Gemini ACP provider and persists runner artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-gemini-acp-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO rpc_adapter_configs (
        id, display_name, provider, schema_version, executable, args_json, transport, endpoint,
        request_timeout_ms, config_schema_json, form_schema_json, defaults_json, status
      ) VALUES ('gemini-acp-test', 'Gemini ACP Test', 'gemini-acp', 1, 'gemini',
        '["--acp","--skip-trust"]', 'stdio', 'stdio://', 1000, '{}', '{}', '{}', 'active')`,
    },
  ]);
  const calls: string[] = [];
  const transport: GeminiAcpTransport = {
    async request(method) {
      calls.push(method);
      if (method === "newSession") return { sessionId: "GEMINI-ACP-THREAD" };
      if (method === "prompt") {
        return new Promise((resolve) => setTimeout(() => resolve({ stopReason: "end_turn" }), 0));
      }
      return {};
    },
    async *events(): AsyncIterable<CliJsonEvent> {
      yield {
        type: "session/update",
        sessionId: "GEMINI-ACP-THREAD",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: JSON.stringify(skillOutputObject("RUN-GEMINI-ACP-RPC")) },
        },
      };
    },
  };

  const result = await runRpcRunJob(dbPath, cliRunPayload("RUN-GEMINI-ACP-RPC"), undefined, transport);
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT status, metadata_json FROM execution_records WHERE id = 'RUN-GEMINI-ACP-RPC'" },
    { name: "session", sql: "SELECT session_id, command, args_json, exit_code FROM cli_session_records WHERE run_id = 'RUN-GEMINI-ACP-RPC'" },
    { name: "log", sql: "SELECT stdout FROM raw_execution_logs WHERE run_id = 'RUN-GEMINI-ACP-RPC'" },
  ]).queries;

  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["initialize", "newSession", "prompt"]);
  assert.equal(rows.run[0].status, "completed");
  const metadata = JSON.parse(String(rows.run[0].metadata_json));
  assert.equal(metadata.provider, "gemini-acp");
  assert.equal(metadata.sessionId, "GEMINI-ACP-THREAD");
  assert.equal(metadata.contractValidation.valid, true);
  assert.equal(rows.session[0].session_id, "GEMINI-ACP-THREAD");
  assert.equal(rows.session[0].command, "gemini");
  assert.deepEqual(JSON.parse(String(rows.session[0].args_json)), ["--acp", "--skip-trust"]);
  assert.equal(rows.session[0].exit_code, 0);
  assert.match(String(rows.log[0].stdout), /RUN-GEMINI-ACP-RPC/);
});

test("codex.rpc.run projects approval pending to Feature spec-state", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-app-server-approval-"));
  prepareSkillWorkspace(root);
  const featureDir = join(root, "docs", "features", "feat-cli");
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, "requirements.md"), "# Feature Spec: FEAT-CLI\n");
  writeFileSync(join(featureDir, "design.md"), "# Design\n");
  writeFileSync(join(featureDir, "tasks.md"), "# Tasks\n");
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  const transport: CodexAppServerTransport = {
    async request(method) {
      if (method === "thread/start") return { threadId: "THREAD-APPROVAL" };
      if (method === "turn/start") return { turnId: "TURN-APPROVAL" };
      return {};
    },
    notify() {},
    async *events() {
      yield {
        type: "approval/request",
        threadId: "THREAD-APPROVAL",
        turnId: "TURN-APPROVAL",
        request: { id: "APPROVAL-1", summary: "Approve file write." },
      };
    },
  };
  const payload = cliRunPayload("RUN-APPROVAL");

  const result = await runCodexAppServerRunJob(dbPath, {
    ...payload,
    context: {
      ...payload.context,
      featureSpecPath: "docs/features/feat-cli",
      skillSlug: "codex-coding-skill",
    },
  }, transport);
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT status, summary, metadata_json FROM execution_records WHERE id = 'RUN-APPROVAL'" },
  ]).queries.run;
  const state = JSON.parse(readFileSync(join(featureDir, "spec-state.json"), "utf8"));
  const metadata = JSON.parse(String(rows[0].metadata_json));

  assert.equal(result.status, "approval_needed");
  assert.equal(rows[0].status, "approval_needed");
  assert.match(String(rows[0].summary), /waiting for approval/i);
  assert.equal(metadata.approvalState, "pending");
  assert.equal(state.status, "approval_needed");
  assert.match(state.nextAction, /approval/i);
});

test("codex.rpc.run writes completed Feature execution to spec-state file", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-app-server-completed-state-"));
  prepareSkillWorkspace(root);
  const featureDir = join(root, "docs", "features", "feat-cli");
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, "requirements.md"), "# Feature Spec: FEAT-CLI\n");
  writeFileSync(join(featureDir, "design.md"), "# Design\n");
  writeFileSync(join(featureDir, "tasks.md"), "# Tasks\n");
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  const transport: CodexAppServerTransport = {
    async request(method) {
      if (method === "thread/start") return { threadId: "THREAD-COMPLETED" };
      if (method === "turn/start") return { turnId: "TURN-COMPLETED" };
      return {};
    },
    notify() {},
    async *events() {
      yield {
        type: "turn/completed",
        status: "completed",
        output: skillOutputObject("RUN-COMPLETED-STATE"),
      };
    },
  };
  const payload = cliRunPayload("RUN-COMPLETED-STATE");

  const result = await runCodexAppServerRunJob(dbPath, {
    ...payload,
    context: {
      ...payload.context,
      featureSpecPath: "docs/features/feat-cli",
    },
  }, transport);
  const state = JSON.parse(readFileSync(join(featureDir, "spec-state.json"), "utf8"));

  assert.equal(result.status, "completed");
  assert.equal(state.status, "completed");
  assert.equal(state.currentJob.executionId, "RUN-COMPLETED-STATE");
  assert.equal(state.lastResult.status, "completed");
  assert.equal(state.lastResult.summary, "Skill completed.");
});

test("codex.rpc.run fails when app-server cannot be started", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-app-server-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO codex_app_server_adapter_configs (
        id, display_name, schema_version, executable, args_json, transport, endpoint,
        request_timeout_ms, config_schema_json, form_schema_json, defaults_json, status
      ) VALUES ('bad-app-server', 'Bad app-server', 1, '/tmp/specdrive-missing-codex-rpc',
        '["app-server","--listen","stdio://"]', 'stdio', 'stdio://', 1000, '{}', '{}', '{}', 'active')`,
    },
  ]);

  const result = await runCodexAppServerRunJob(dbPath, cliRunPayload("RUN-NO-APP-SERVER"));
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT status, summary FROM execution_records WHERE id = 'RUN-NO-APP-SERVER'" },
  ]).queries.run;

  assert.equal(result.status, "failed");
  assert.equal(rows[0].status, "failed");
  assert.match(String(rows[0].summary), /ENOENT|spawn/);
});

test("codex.rpc.run blocks when configured Codex RPC adapters are disabled", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-app-server-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO codex_app_server_adapter_configs (
        id, display_name, schema_version, executable, args_json, transport, endpoint,
        request_timeout_ms, config_schema_json, form_schema_json, defaults_json, status
      ) VALUES ('disabled-app-server', 'Disabled app-server', 1, 'codex',
        '["app-server","--listen","stdio://"]', 'stdio', 'stdio://', 1000, '{}', '{}', '{}', 'disabled')`,
    },
  ]);

  const result = await runCodexAppServerRunJob(dbPath, cliRunPayload("RUN-DISABLED-APP-SERVER"), {
    async request() {
      throw new Error("transport should not be called");
    },
    notify() {
      throw new Error("transport should not be called");
    },
    async *events() {},
  });
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT status, summary FROM execution_records WHERE id = 'RUN-DISABLED-APP-SERVER'" },
  ]).queries.run;

  assert.equal(result.status, "blocked");
  assert.equal(rows[0].status, "blocked");
  assert.match(String(rows[0].summary), /No active Codex RPC adapter/);
});

test("codex.rpc.run fails when SkillOutputContractV1 validation fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "specdrive-app-server-run-"));
  prepareSkillWorkspace(root);
  const dbPath = makeDbPath();
  seedCliRunData(dbPath, root);
  const transport: CodexAppServerTransport = {
    async request(method) {
      if (method === "thread/start") return { thread: { id: "THREAD-BAD-CONTRACT" } };
      if (method === "turn/start") return { turn: { id: "TURN-BAD-CONTRACT" } };
      return {};
    },
    notify() {},
    async *events() {
      yield {
        type: "turn/completed",
        status: "completed",
        output: {
          contractVersion: "skill-contract/v1",
          executionId: "WRONG-RUN",
          skillSlug: "codex-coding-skill",
          requestedAction: "feature_execution",
          status: "completed",
          summary: "Bad contract.",
          nextAction: "Review mismatch.",
          producedArtifacts: [],
          traceability: {
            featureId: "FEAT-CLI",
            taskId: "TASK-CLI",
            requirementIds: [],
            changeIds: ["CHG-016"],
          },
          result: {},
        },
      };
    },
  };

  const result = await runCodexAppServerRunJob(dbPath, cliRunPayload("RUN-BAD-CONTRACT"), transport);
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT status, summary, metadata_json FROM execution_records WHERE id = 'RUN-BAD-CONTRACT'" },
    { name: "log", sql: "SELECT stderr FROM raw_execution_logs WHERE run_id = 'RUN-BAD-CONTRACT'" },
  ]).queries;
  const metadata = JSON.parse(String(rows.run[0].metadata_json));

  assert.equal(result.status, "failed");
  assert.equal(rows.run[0].status, "failed");
  assert.match(String(rows.run[0].summary), /executionId mismatch/);
  assert.equal(metadata.contractValidation.valid, false);
  assert.match(String(rows.log[0].stderr), /executionId mismatch/);
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
    traceability: { requirementIds: [] },
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
  changeIds?: string[];
} = {}): string {
  const output = {
    contractVersion: "skill-contract/v1",
    executionId,
    skillSlug: overrides.skillSlug ?? "codex-coding-skill",
    requestedAction: overrides.requestedAction ?? "feature_execution",
    status: "completed",
    summary: "Skill completed.",
    nextAction: "Continue scheduler flow.",
    producedArtifacts: overrides.producedArtifacts ?? [],
    traceability: {
      featureId: overrides.skillSlug ? undefined : "FEAT-CLI",
      taskId: overrides.skillSlug ? undefined : "TASK-CLI",
      requirementIds: [],
      changeIds: overrides.changeIds ?? ["CHG-016"],
    },
    result: {},
  };
  return JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(output) } });
}

function skillOutputObject(executionId: string): Record<string, unknown> {
  return {
    contractVersion: "skill-contract/v1",
    executionId,
    skillSlug: "codex-coding-skill",
    requestedAction: "feature_execution",
    status: "completed",
    summary: "Skill completed.",
    nextAction: "Continue scheduler flow.",
    producedArtifacts: [],
    traceability: {
      featureId: "FEAT-CLI",
      taskId: "TASK-CLI",
      requirementIds: [],
      changeIds: ["CHG-016"],
    },
    result: {},
  };
}

function prepareSkillWorkspace(root: string): void {
  mkdirSync(join(root, ".agents", "skills", "codex-coding-skill"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "# Test workspace\n");
  writeFileSync(join(root, ".agents", "skills", "codex-coding-skill", "SKILL.md"), "# Codex coding skill\n");
}
