import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  buildEvidencePackInput,
  buildRunnerConsoleSnapshot,
  evaluateRunnerSafety,
  persistCodexRunnerArtifacts,
  processRunnerQueueItem,
  recordRunnerHeartbeat,
  redactLog,
  resolveRunnerPolicy,
  runCodexCli,
} from "../src/codex-runner.ts";
import { listStatusCheckResults } from "../src/status-checker.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

test("schema includes Codex runner policies, heartbeats, sessions, and logs", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const tables = listTables(dbPath);
  for (const table of ["runner_policies", "runner_heartbeats", "codex_session_records", "raw_execution_logs"]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }
});

test("runner policy resolves safe defaults and clamps heartbeat cadence", () => {
  const lowRisk = resolveRunnerPolicy({
    runId: "RUN-001",
    risk: "low",
    workspaceRoot: "/workspace/project",
    heartbeatIntervalSeconds: 4,
    now: stableDate,
  });

  assert.equal(lowRisk.sandboxMode, "workspace-write");
  assert.equal(lowRisk.approvalPolicy, "on-request");
  assert.equal(lowRisk.heartbeatIntervalSeconds, 10);
  assert.notEqual(lowRisk.sandboxMode, "danger-full-access");

  const highRisk = resolveRunnerPolicy({
    runId: "RUN-002",
    risk: "high",
    workspaceRoot: "/workspace/project",
    requestedSandboxMode: "danger-full-access",
    requestedApprovalPolicy: "bypass",
    heartbeatIntervalSeconds: 60,
    now: stableDate,
  });

  assert.equal(highRisk.sandboxMode, "read-only");
  assert.equal(highRisk.approvalPolicy, "on-request");
  assert.equal(highRisk.heartbeatIntervalSeconds, 30);

  const defaultHighRisk = resolveRunnerPolicy({
    runId: "RUN-002B",
    risk: "high",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  assert.equal(defaultHighRisk.sandboxMode, "read-only");
  assert.equal(defaultHighRisk.approvalPolicy, "untrusted");

  const mediumRisk = resolveRunnerPolicy({
    runId: "RUN-002C",
    risk: "medium",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  assert.equal(mediumRisk.sandboxMode, "workspace-write");
  assert.equal(mediumRisk.approvalPolicy, "on-request");
});

test("safety gate blocks dangerous files, commands, high-risk text, and permission escalation", () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-003",
    risk: "high",
    workspaceRoot: "/workspace/project",
    requestedSandboxMode: "workspace-write",
    now: stableDate,
  });

  const result = evaluateRunnerSafety({
    policy,
    files: [".env", "src/auth/login.ts"],
    commands: ["rm -rf /tmp/demo"],
    taskText: "Update payment token migration",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reviewNeeded, true);
  assert.equal(result.reasons.some((reason) => reason.includes("high-risk runner tasks")), true);
  assert.equal(result.reasons.some((reason) => reason.includes(".env")), true);
  assert.equal(result.reasons.some((reason) => reason.includes("dangerous command")), true);
  assert.equal(result.reasons.some((reason) => reason.includes("task text")), true);

  const promptOnly = evaluateRunnerSafety({
    policy,
    prompt: "Update auth payment workflow",
  });
  assert.equal(promptOnly.allowed, false);
  assert.equal(promptOnly.reviewNeeded, true);

  const dangerousPrompt = evaluateRunnerSafety({
    policy,
    prompt: "Run git reset --hard before continuing",
  });
  assert.equal(dangerousPrompt.allowed, false);
  assert.equal(dangerousPrompt.reviewNeeded, true);
  assert.equal(dangerousPrompt.reasons.some((reason) => reason.includes("dangerous command")), true);
});

test("Codex CLI adapter captures JSON events, session id, output, and redacts logs", async () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-004",
    risk: "low",
    workspaceRoot: "/workspace/project",
    model: "gpt-5.3-codex",
    profile: "automation",
    resumeSessionId: "SESSION-OLD",
    now: stableDate,
  });
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  const result = await runCodexCli({
    policy,
    prompt: "Implement bounded task token=abc123",
    taskId: "TASK-001",
    featureId: "FEAT-008",
    outputSchemaPath: "/tmp/runner-output.schema.json",
    now: stableDate,
    runner: (command, args, cwd) => {
      calls.push({ command, args, cwd });
      return {
        status: 0,
        stdout: '{"type":"session","session_id":"SESSION-NEW"}\nplain line\n{"type":"result","message":"token=abc123"}\ntoken=abc123',
        stderr: "password=swordfish",
      };
    },
  });

  assert.equal(calls[0].command, "codex");
  assert.deepEqual(calls[0].args.slice(0, 12), [
    "-a",
    "on-request",
    "--sandbox",
    "workspace-write",
    "-p",
    "automation",
    "exec",
    "resume",
    "--json",
    "-m",
    "gpt-5.3-codex",
    "SESSION-OLD",
  ]);
  assert.match(calls[0].args[12], /Implement bounded task token=abc123/);
  assert.match(calls[0].args[12], /matching this schema/);
  assert.equal(calls[0].cwd, "/workspace/project");
  assert.doesNotMatch(result.session.args.join(" "), /abc123/);
  assert.match(result.session.args.join(" "), /token=\[REDACTED\]/);
  assert.equal(result.session.sessionId, "SESSION-NEW");
  assert.equal(result.session.exitCode, 0);
  assert.deepEqual(result.rawLog.events.map((event) => event.type), ["session", "result"]);
  assert.equal(result.rawLog.events[1].message, "token=[REDACTED]");
  assert.match(result.rawLog.stdout, /token=\[REDACTED\]/);
  assert.match(result.rawLog.stderr, /password=\[REDACTED\]/);

  const evidence = buildEvidencePackInput(result.evidence);
  assert.equal(evidence.kind, "codex_runner");
  assert.equal(evidence.featureId, "FEAT-008");
  assert.match(evidence.summary, /exit=0/);
});

test("Codex CLI adapter passes output schema for new exec runs", async () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-004B",
    risk: "low",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  const calls: Array<{ args: string[] }> = [];

  await runCodexCli({
    policy,
    prompt: "Implement bounded task",
    outputSchemaPath: "/tmp/runner-output.schema.json",
    runner: (_command, args) => {
      calls.push({ args });
      return { status: 0, stdout: '{"type":"result"}', stderr: "" };
    },
  });

  assert.deepEqual(calls[0].args.slice(0, 10), [
    "-a",
    "on-request",
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--model",
    "gpt-5-codex",
    "--output-schema",
    "/tmp/runner-output.schema.json",
  ]);
});

test("Codex CLI adapter removes generated output schema files after execution", async () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-004C",
    risk: "low",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  let generatedSchemaPath = "";

  await runCodexCli({
    policy,
    prompt: "Implement bounded task",
    runner: (_command, args) => {
      const schemaFlagIndex = args.indexOf("--output-schema");
      generatedSchemaPath = args[schemaFlagIndex + 1];
      assert.equal(existsSync(generatedSchemaPath), true);
      return { status: 0, stdout: '{"type":"result"}', stderr: "" };
    },
  });

  assert.equal(existsSync(generatedSchemaPath), false);
});

test("runner queue worker routes blocked work to review and executes allowed work", async () => {
  const blockedPolicy = resolveRunnerPolicy({
    runId: "RUN-005",
    risk: "low",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  const blocked = await processRunnerQueueItem({
    runId: "RUN-005",
    prompt: "Update secret",
    policy: blockedPolicy,
    files: ["secrets/prod.json"],
  });

  assert.equal(blocked.status, "review_needed");
  assert.equal(blocked.adapterResult, undefined);

  const allowedPolicy = resolveRunnerPolicy({
    runId: "RUN-006",
    risk: "low",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  const executed = await processRunnerQueueItem(
    {
      runId: "RUN-006",
      prompt: "Run tests",
      policy: allowedPolicy,
      commands: ["npm test"],
    },
    () => ({ status: 0, stdout: '{"type":"result"}', stderr: "" }),
  );

  assert.equal(executed.status, "completed");
  assert.equal(executed.adapterResult?.session.exitCode, 0);

  const reviewNeeded = await processRunnerQueueItem(
    {
      runId: "RUN-006",
      prompt: "Run tests",
      policy: allowedPolicy,
    },
    () => ({ status: 0, stdout: '{"type":"result","status":"review_needed"}', stderr: "" }),
  );

  assert.equal(reviewNeeded.status, "review_needed");

  const highRiskCommand = await processRunnerQueueItem({
    runId: "RUN-006C",
    prompt: "Run requested maintenance",
    policy: allowedPolicy,
    commands: ["pnpm prisma migrate deploy"],
  });

  assert.equal(highRiskCommand.status, "review_needed");
  assert.equal(highRiskCommand.adapterResult, undefined);

  const resumedPolicy = resolveRunnerPolicy({
    runId: "RUN-006B",
    risk: "low",
    workspaceRoot: "/workspace/project",
    resumeSessionId: "SESSION-OLD",
    now: stableDate,
  });
  const resumedWithoutStructuredStatus = await processRunnerQueueItem(
    {
      runId: "RUN-006B",
      prompt: "Run tests",
      policy: resumedPolicy,
    },
    () => ({ status: 0, stdout: "free-form resumed output", stderr: "" }),
  );

  assert.equal(resumedWithoutStructuredStatus.status, "review_needed");
});

test("runner queue worker records status check evidence after completed runs", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-runner-status-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-006S",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });

  const executed = await processRunnerQueueItem(
    {
      runId: "RUN-006S",
      taskId: "TASK-009",
      featureId: "FEAT-009",
      prompt: "Run tests",
      policy,
      statusCheck: {
        dbPath,
        diff: { files: ["src/status-checker.ts"], summary: "runner completed token=abc123" },
        allowedFiles: ["src/status-checker.ts"],
        commandChecks: [
          { kind: "build", command: "npm run build", status: "passed", exitCode: 0 },
          { kind: "unit_test", command: "npm test", status: "passed", exitCode: 0 },
        ],
        specAlignment: {
          taskId: "TASK-009",
          userStoryIds: ["REQ-040"],
          requirementIds: ["REQ-040"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-040"],
          testCoverage: true,
          changedFiles: ["src/status-checker.ts"],
        },
      },
    },
    () => ({ status: 0, stdout: '{"type":"result","status":"completed"}\ntoken=abc123', stderr: "" }),
  );

  assert.equal(executed.status, "review_needed");
  assert.equal(executed.statusCheckResult?.status, "review_needed");
  assert.equal(JSON.stringify(executed.statusCheckResult?.evidencePack).includes("abc123"), false);
  const persisted = listStatusCheckResults(dbPath, "RUN-006S");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].status, "review_needed");
});

test("runner queue worker preserves failed status when status check records diagnostics", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-runner-failed-status-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-006F",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });

  const result = await processRunnerQueueItem(
    {
      runId: "RUN-006F",
      prompt: "Run tests",
      policy,
      statusCheck: {
        dbPath,
        commandChecks: [{ kind: "unit_test", command: "npm test", status: "failed", exitCode: 1 }],
        specAlignment: {
          taskId: "TASK-009",
          userStoryIds: ["REQ-040"],
          requirementIds: ["REQ-040"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-040"],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.statusCheckResult?.status, "blocked");
});

test("runner status check resolves artifact-root attachments without workspace fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-runner-artifact-root-"));
  const artifactRoot = join(root, ".autobuild");
  const dbPath = join(root, "db", "autobuild.db");
  initializeSchema(dbPath);
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, "artifact.log"), "artifact evidence", "utf8");
  const policy = resolveRunnerPolicy({
    runId: "RUN-006A",
    risk: "low",
    workspaceRoot: join(root, "worktree"),
    now: stableDate,
  });

  await processRunnerQueueItem(
    {
      runId: "RUN-006A",
      prompt: "Run tests",
      policy,
      statusCheck: {
        dbPath,
        artifactRoot,
        commandChecks: [{ kind: "unit_test", command: "npm test", status: "passed", exitCode: 0 }],
        attachments: [{ kind: "log", path: "artifact.log" }],
        specAlignment: {
          taskId: "TASK-009",
          userStoryIds: ["REQ-040"],
          requirementIds: ["REQ-040"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-040"],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 0, stdout: '{"type":"result","status":"completed"}', stderr: "" }),
  );

  const rows = runSqlite(dbPath, [], [
    { name: "attachments", sql: "SELECT path, checksum FROM evidence_attachment_refs WHERE run_id = ?", params: ["RUN-006A"] },
  ]).queries.attachments;
  assert.equal(rows[0].path, "artifact.log");
  assert.equal(typeof rows[0].checksum, "string");
});

test("runner status check preserves workspace attachments with a custom artifact root", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-runner-workspace-attachment-"));
  const workspaceRoot = join(root, "worktree");
  const artifactRoot = join(root, "external-artifacts", ".autobuild");
  const dbPath = join(root, "db", "autobuild.db");
  initializeSchema(dbPath);
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, "workspace.log"), "workspace evidence", "utf8");
  const policy = resolveRunnerPolicy({
    runId: "RUN-006W",
    risk: "low",
    workspaceRoot,
    now: stableDate,
  });

  await processRunnerQueueItem(
    {
      runId: "RUN-006W",
      prompt: "Run tests",
      policy,
      statusCheck: {
        dbPath,
        artifactRoot,
        commandChecks: [{ kind: "unit_test", command: "npm test", status: "passed", exitCode: 0 }],
        attachments: [{ kind: "log", path: "workspace.log" }],
        specAlignment: {
          taskId: "TASK-009",
          userStoryIds: ["REQ-040"],
          requirementIds: ["REQ-040"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-040"],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 0, stdout: '{"type":"result","status":"completed"}', stderr: "" }),
  );

  const rows = runSqlite(dbPath, [], [
    { name: "attachments", sql: "SELECT path, checksum FROM evidence_attachment_refs WHERE run_id = ?", params: ["RUN-006W"] },
  ]).queries.attachments;
  assert.equal(rows[0].path, "workspace.log");
  assert.equal(rows[0].checksum, createHash("sha256").update("workspace evidence").digest("hex"));
});

test("Codex adapter records spawn failures as failed evidence instead of throwing", async () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-009",
    risk: "low",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  const result = await processRunnerQueueItem(
    {
      runId: "RUN-009",
      prompt: "Run tests",
      policy,
    },
    () => ({ status: null, error: Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }) }),
  );

  assert.equal(result.status, "failed");
  assert.match(result.adapterResult?.rawLog.stderr ?? "", /spawn codex ENOENT/);
});

test("heartbeat and console snapshot expose current safety configuration", () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-007",
    risk: "low",
    workspaceRoot: "/workspace/project",
    heartbeatIntervalSeconds: 15,
    now: stableDate,
  });
  const heartbeat = recordRunnerHeartbeat({
    runId: "RUN-007",
    runnerId: "runner-main",
    policy,
    queueStatus: "running",
    now: stableDate,
  });
  const snapshot = buildRunnerConsoleSnapshot({
    runnerId: "runner-main",
    codexVersion: "codex 1.2.3",
    policy,
    heartbeats: [heartbeat],
    queue: [{ runId: "RUN-007", status: "running" }],
    logs: [{ id: "LOG-1", runId: "RUN-007", stdout: "ok", stderr: "", events: [], createdAt: stableDate.toISOString() }],
    now: new Date("2026-04-28T12:00:20.000Z"),
  });

  assert.equal(snapshot.online, true);
  assert.equal(snapshot.heartbeatStale, false);
  assert.equal(snapshot.sandboxMode, "workspace-write");
  assert.equal(snapshot.approvalPolicy, "on-request");
  assert.equal(snapshot.queue[0].status, "running");
  assert.equal(snapshot.recentLogs[0].stdout, "ok");
});

test("runner artifacts persist for audit and console lookup", async () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-008",
    risk: "low",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  const heartbeat = recordRunnerHeartbeat({
    runId: policy.runId,
    runnerId: "runner-main",
    policy,
    queueStatus: "completed",
    now: stableDate,
  });
  const adapter = await runCodexCli({
    policy,
    prompt: "Produce output",
    outputSchemaPath: "/tmp/runner-output.schema.json",
    now: stableDate,
    runner: () => ({ status: 0, stdout: '{"type":"session","session_id":"S-1"}', stderr: "" }),
  });

  persistCodexRunnerArtifacts(dbPath, {
    policy,
    heartbeat,
    session: adapter.session,
    rawLog: adapter.rawLog,
  });

  const rows = runSqlite(dbPath, [], [
    { name: "policy", sql: "SELECT sandbox_mode, approval_policy FROM runner_policies WHERE id = ?", params: [policy.id] },
    { name: "heartbeat", sql: "SELECT queue_status FROM runner_heartbeats WHERE id = ?", params: [heartbeat.id] },
    { name: "session", sql: "SELECT session_id, exit_code FROM codex_session_records WHERE id = ?", params: [adapter.session.id] },
    { name: "log", sql: "SELECT events_json FROM raw_execution_logs WHERE id = ?", params: [adapter.rawLog.id] },
  ]);

  assert.equal(rows.queries.policy[0].sandbox_mode, "workspace-write");
  assert.equal(rows.queries.policy[0].approval_policy, "on-request");
  assert.equal(rows.queries.heartbeat[0].queue_status, "completed");
  assert.equal(rows.queries.session[0].session_id, "S-1");
  assert.equal(rows.queries.session[0].exit_code, 0);
  assert.equal(JSON.parse(String(rows.queries.log[0].events_json)).length, 1);
});

test("log redaction covers common secret formats", () => {
  assert.equal(redactLog("token=abc password: hunter2 api_key=xyz postgres://user:pass@host/db"), "token=[REDACTED] password: [REDACTED] api_key=[REDACTED] postgres://[REDACTED]");
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "specdrive-codex-runner-")), "control-plane.sqlite");
}
