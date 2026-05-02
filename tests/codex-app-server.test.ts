import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  buildCodexAppServerAdapterResult,
  buildCodexAppServerRequestSequence,
  createCodexAppServerStdioTransport,
  interruptCodexAppServerTurn,
  projectCodexAppServerEvents,
  runCodexAppServerSession,
  type CodexAppServerTransport,
  type JsonRpcStdioProcess,
} from "../src/codex-app-server.ts";
import type { RunnerPolicy, SkillInvocationContract, SkillOutputContract } from "../src/codex-runner.ts";

test("Codex app-server request sequence initializes, starts a thread, and starts a schema-bound turn", () => {
  const sequence = buildCodexAppServerRequestSequence({
    executionId: "RUN-APP",
    workspaceRoot: "/repo",
    prompt: "Run the skill.",
    outputSchema: { type: "object", additionalProperties: false },
    skillInvocation: skillInvocation(),
  });

  assert.equal(sequence.initialize.method, "initialize");
  assert.equal(sequence.initialized.method, "initialized");
  assert.equal(sequence.thread.method, "thread/start");
  assert.deepEqual(sequence.thread.params, { cwd: "/repo" });
  assert.equal(sequence.turn.method, "turn/start");
  assert.equal(sequence.turn.params.cwd, "/repo");
  assert.deepEqual(sequence.turn.params.outputSchema, { type: "object", additionalProperties: false });
  assert.deepEqual(sequence.turn.params.input, [
    { type: "text", text: "Run the skill." },
    { type: "skill", name: "codex-coding-skill", path: ".agents/skills/codex-coding-skill/SKILL.md" },
  ]);
});

test("Codex app-server request sequence resumes an existing thread", () => {
  const sequence = buildCodexAppServerRequestSequence({
    executionId: "RUN-APP",
    workspaceRoot: "/repo",
    prompt: "Resume.",
    outputSchema: {},
    threadId: "thread-1",
  });

  assert.equal(sequence.thread.method, "thread/resume");
  assert.deepEqual(sequence.thread.params, { threadId: "thread-1", cwd: "/repo" });
  assert.equal(sequence.turn.params.threadId, "thread-1");
});

test("Codex app-server event projection extracts ids, streams, approvals, diffs, and Skill output", () => {
  const output = skillOutput();
  const projection = projectCodexAppServerEvents([
    { type: "thread/started", id: "thread-1" },
    { type: "turn/started", id: "turn-1", threadId: "thread-1" },
    { type: "item/agentMessage/delta", delta: "hello " },
    { type: "item/commandExecution/outputDelta", delta: "npm test\n" },
    { type: "turn/diff/updated" },
    { type: "approval/request", id: "approval-1", command: "npm test" },
    { type: "turn/completed", status: "completed", output },
  ]);

  assert.equal(projection.threadId, "thread-1");
  assert.equal(projection.turnId, "turn-1");
  assert.equal(projection.status, "completed");
  assert.equal(projection.assistantMessage, "hello ");
  assert.equal(projection.commandOutput, "npm test\n");
  assert.equal(projection.diffUpdated, true);
  assert.equal(projection.approvalRequests.length, 1);
  assert.equal(projection.skillOutput?.executionId, "RUN-APP");
});

test("Codex app-server adapter result maps event projection to runner evidence", () => {
  const result = buildCodexAppServerAdapterResult({
    runId: "RUN-APP",
    workspaceRoot: "/repo",
    events: [
      { type: "thread/started", id: "thread-1" },
      { type: "turn/started", id: "turn-1", threadId: "thread-1" },
      { type: "item/agentMessage/delta", delta: "done" },
      { type: "turn/completed", status: "completed", output: JSON.stringify(skillOutput()) },
    ],
    policy: runnerPolicy(),
    startedAt: "2026-05-02T12:00:00.000Z",
    completedAt: "2026-05-02T12:01:00.000Z",
    skillInvocation: skillInvocation(),
  });

  assert.equal(result.session.sessionId, "thread-1");
  assert.equal(result.session.command, "codex");
  assert.deepEqual(result.session.args, ["app-server"]);
  assert.equal(result.session.exitCode, 0);
  assert.equal(result.rawLog.stdout, "done");
  assert.equal(result.evidence.featureId, "FEAT-016");
  assert.equal(result.evidence.skillOutput?.status, "completed");
});

test("Codex app-server failed turn maps to failed adapter evidence", () => {
  const result = buildCodexAppServerAdapterResult({
    runId: "RUN-APP",
    workspaceRoot: "/repo",
    events: [
      { type: "thread/started", id: "thread-1" },
      { type: "turn/completed", status: "failed", error: "not logged in" },
    ],
    policy: runnerPolicy(),
    startedAt: "2026-05-02T12:00:00.000Z",
    completedAt: "2026-05-02T12:01:00.000Z",
  });

  assert.equal(result.session.exitCode, 1);
  assert.equal(result.rawLog.stderr, "not logged in");
  assert.equal(result.evidence.exitCode, 1);
});

test("Codex app-server session runs initialize, thread, turn, and collects terminal events", async () => {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const transport: CodexAppServerTransport = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: "thread-created" } };
      if (method === "turn/start") return { turn: { id: "turn-created" } };
      return {};
    },
    notify(method, params) {
      calls.push({ method, params });
    },
    async *events() {
      yield { type: "item/agentMessage/delta", delta: "working" };
      yield { type: "turn/completed", status: "completed", output: skillOutput() };
    },
  };

  const result = await runCodexAppServerSession({
    runId: "RUN-APP",
    workspaceRoot: "/repo",
    prompt: "Run.",
    policy: runnerPolicy(),
    transport,
    skillInvocation: skillInvocation(),
    startedAt: "2026-05-02T12:00:00.000Z",
    now: new Date("2026-05-02T12:01:00.000Z"),
  });

  assert.deepEqual(calls.map((call) => call.method), ["initialize", "initialized", "thread/start", "turn/start"]);
  assert.equal((calls[3].params as { threadId?: string }).threadId, "thread-created");
  assert.equal(result.session.sessionId, "thread-created");
  assert.equal(result.rawLog.stdout, "working");
  assert.equal(result.evidence.skillOutput?.executionId, "RUN-APP");
});

test("Codex app-server session resumes supplied thread id", async () => {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const transport: CodexAppServerTransport = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/resume") return { threadId: "thread-existing" };
      if (method === "turn/start") return { turnId: "turn-resumed" };
      return {};
    },
    notify(method, params) {
      calls.push({ method, params });
    },
    async *events() {
      yield { type: "turn/completed", status: "completed", output: skillOutput() };
    },
  };

  const result = await runCodexAppServerSession({
    runId: "RUN-APP",
    workspaceRoot: "/repo",
    prompt: "Resume.",
    policy: runnerPolicy(),
    transport,
    threadId: "thread-existing",
    now: new Date("2026-05-02T12:01:00.000Z"),
  });

  assert.equal(calls[2].method, "thread/resume");
  assert.deepEqual(calls[2].params, {
    threadId: "thread-existing",
    cwd: "/repo",
    persistExtendedHistory: true,
    excludeTurns: true,
  });
  assert.equal((calls[3].params as { threadId?: string }).threadId, "thread-existing");
  assert.equal(result.session.sessionId, "thread-existing");
});

test("Codex app-server adapter can interrupt a running turn", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const transport: CodexAppServerTransport = {
    async request(method, params) {
      calls.push({ method, params });
      return {};
    },
    notify() {},
    async *events() {},
  };

  const result = await interruptCodexAppServerTurn(transport, "thread-1", "turn-1");

  assert.deepEqual(result, {});
  assert.deepEqual(calls, [{ method: "turn/interrupt", params: { threadId: "thread-1", turnId: "turn-1" } }]);
});

test("Codex app-server session fails before turn start when thread id is missing", async () => {
  const calls: string[] = [];
  const transport: CodexAppServerTransport = {
    async request(method) {
      calls.push(method);
      return {};
    },
    notify(method) {
      calls.push(method);
    },
    async *events() {
      yield { type: "turn/completed", status: "completed", output: skillOutput() };
    },
  };

  await assert.rejects(
    () => runCodexAppServerSession({
      runId: "RUN-APP",
      workspaceRoot: "/repo",
      prompt: "Run.",
      policy: runnerPolicy(),
      transport,
    }),
    /did not return a thread id/,
  );
  assert.deepEqual(calls, ["initialize", "initialized", "thread/start"]);
});

test("Codex app-server stdio transport writes JSON-RPC and matches responses by id", async () => {
  const process = new FakeJsonRpcProcess();
  const transport = createCodexAppServerStdioTransport({
    cwd: "/repo",
    process,
    requestTimeoutMs: 1000,
  });
  const request = transport.request("initialize", { clientInfo: { name: "test" } });
  const initialize = process.takeWrittenJson();
  assert.equal(initialize.method, "initialize");
  assert.equal(initialize.params.clientInfo.name, "test");
  process.send({ jsonrpc: "2.0", id: initialize.id, result: { serverInfo: { version: "test" } } });

  assert.deepEqual(await request, { serverInfo: { version: "test" } });
  transport.close?.();
});

test("Codex app-server stdio transport yields server notifications as events", async () => {
  const process = new FakeJsonRpcProcess();
  const transport = createCodexAppServerStdioTransport({
    cwd: "/repo",
    process,
    requestTimeoutMs: 1000,
  });
  const events = transport.events()[Symbol.asyncIterator]();
  process.send({ jsonrpc: "2.0", method: "turn/completed", params: { status: "completed", turnId: "turn-1" } });

  const next = await events.next();
  assert.equal(next.value.type, "turn/completed");
  assert.equal(next.value.status, "completed");
  assert.equal(next.value.turnId, "turn-1");
  transport.close?.();
});

test("Codex app-server stdio transport rejects JSON-RPC errors", async () => {
  const process = new FakeJsonRpcProcess();
  const transport = createCodexAppServerStdioTransport({
    cwd: "/repo",
    process,
    requestTimeoutMs: 1000,
  });
  const request = transport.request("thread/start", { cwd: "/repo" });
  const message = process.takeWrittenJson();
  process.send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "not logged in" } });

  await assert.rejects(() => request, /not logged in/);
  transport.close?.();
});

function skillInvocation(): SkillInvocationContract {
  return {
    contractVersion: "skill-contract/v1",
    executionId: "RUN-APP",
    projectId: "project-1",
    workspaceRoot: "/repo",
    operation: "feature_execution",
    skillSlug: "codex-coding-skill",
    sourcePaths: ["docs/features/feat-016/requirements.md"],
    expectedArtifacts: [],
    traceability: {
      featureId: "FEAT-016",
      taskId: "TASK-001",
      requirementIds: ["REQ-VSC-010"],
      changeIds: [],
    },
    constraints: {
      allowedFiles: ["src/**"],
      risk: "medium",
    },
    requestedAction: "feature_execution",
  };
}

function skillOutput(): SkillOutputContract {
  return {
    contractVersion: "skill-contract/v1",
    executionId: "RUN-APP",
    skillSlug: "codex-coding-skill",
    requestedAction: "feature_execution",
    status: "completed",
    summary: "Implemented.",
    producedArtifacts: [],
    evidence: [],
    traceability: {
      featureId: "FEAT-016",
      taskId: "TASK-001",
      requirementIds: ["REQ-VSC-010"],
      changeIds: [],
    },
  };
}

function runnerPolicy(): RunnerPolicy {
  return {
    id: "policy-1",
    runId: "RUN-APP",
    risk: "medium",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    model: "gpt-5.5",
    reasoningEffort: "medium",
    outputSchema: {},
    workspaceRoot: "/repo",
    heartbeatIntervalSeconds: 30,
    commandTimeoutMs: 60000,
    createdAt: "2026-05-02T12:00:00.000Z",
  };
}

class FakeJsonRpcProcess extends EventEmitter implements JsonRpcStdioProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly written: string[] = [];
  readonly stdin = {
    write: (chunk: string | Buffer) => {
      this.written.push(String(chunk));
      return true;
    },
    end: () => undefined,
  };

  kill(): boolean {
    this.emit("exit", 0, null);
    return true;
  }

  send(message: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  takeWrittenJson(): Record<string, any> {
    const raw = this.written.shift();
    assert.equal(typeof raw, "string");
    return JSON.parse(String(raw)) as Record<string, any>;
  }
}
