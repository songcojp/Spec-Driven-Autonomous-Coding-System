import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGeminiAcpAdapterResult,
  DEFAULT_GEMINI_ACP_ADAPTER_CONFIG,
  geminiAcpConfigToExecutionAdapterConfig,
  runGeminiAcpSession,
  type GeminiAcpTransport,
} from "../src/gemini-rpc-adapter.ts";
import type { CliJsonEvent, RunnerPolicy, SkillOutputContract } from "../src/cli-adapter.ts";
import type { ExecutionAdapterInvocationV1 } from "../src/execution-adapter-contracts.ts";

test("Gemini ACP config exposes unified RPC adapter config", () => {
  const config = geminiAcpConfigToExecutionAdapterConfig(DEFAULT_GEMINI_ACP_ADAPTER_CONFIG);

  assert.equal(config.kind, "rpc");
  assert.equal(config.provider, "gemini-acp");
  assert.equal(config.transport, "stdio");
  assert.equal(config.inputMapping.executable, "gemini");
});

test("Gemini ACP session initializes, starts a session, prompts, and projects SkillOutput", async () => {
  const output = skillOutput();
  const transport = new FakeGeminiAcpTransport([
    { type: "session/update", sessionId: "GEMINI-ACP-SESSION", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\`` } } },
  ]);

  const result = await runGeminiAcpSession({
    runId: "RUN-APP",
    workspaceRoot: "/repo",
    prompt: "Run the skill.",
    policy: runnerPolicy(),
    transport,
    executionInvocation: executionInvocation(),
    startedAt: "2026-05-02T12:00:00.000Z",
    now: new Date("2026-05-02T12:00:01.000Z"),
  });

  assert.deepEqual(transport.requests.map((request) => request.method), ["initialize", "newSession", "prompt"]);
  assert.equal(result.session.sessionId, "GEMINI-ACP-SESSION");
  assert.equal(result.result.skillOutput?.summary, "Implemented.");
  assert.equal(result.executionAdapterResult?.providerSession.provider, "gemini-acp");
  assert.equal(result.executionAdapterResult?.status, "completed");
});

test("Gemini ACP permission request projects approval_needed", async () => {
  const transport = new FakeGeminiAcpTransport([
    {
      type: "requestPermission",
      sessionId: "GEMINI-ACP-SESSION",
      toolCall: { toolCallId: "tool-1", title: "Edit file" },
    },
  ], { hangPrompt: true });

  const result = await runGeminiAcpSession({
    runId: "RUN-APP",
    workspaceRoot: "/repo",
    prompt: "Run the skill.",
    policy: runnerPolicy(),
    transport,
    executionInvocation: executionInvocation(),
    startedAt: "2026-05-02T12:00:00.000Z",
    now: new Date("2026-05-02T12:00:01.000Z"),
  });

  assert.equal(result.session.sessionId, "GEMINI-ACP-SESSION");
  assert.equal(result.executionAdapterResult?.status, "approval_needed");
  assert.equal(result.executionAdapterResult?.providerSession.approvalState, "pending");
});

test("Gemini ACP adapter result maps protocol errors to failed result", () => {
  const result = buildGeminiAcpAdapterResult({
    runId: "RUN-APP",
    workspaceRoot: "/repo",
    events: [
      { type: "newSession/result", sessionId: "GEMINI-ACP-SESSION" },
      { type: "error", message: "Rate limit exceeded." },
    ],
    policy: runnerPolicy(),
    startedAt: "2026-05-02T12:00:00.000Z",
    completedAt: "2026-05-02T12:00:01.000Z",
    executionInvocation: executionInvocation(),
  });

  assert.equal(result.session.exitCode, 1);
  assert.equal(result.executionAdapterResult?.status, "failed");
  assert.match(result.rawLog.stderr, /Rate limit/);
});

function executionInvocation(): ExecutionAdapterInvocationV1 {
  return {
    contractVersion: "execution-adapter/v1",
    executionId: "RUN-APP",
    projectId: "project-1",
    workspaceRoot: "/repo",
    operation: "feature_execution",
    featureId: "FEAT-016",
    traceability: {
      featureId: "FEAT-016",
      requirementIds: ["REQ-VSC-010"],
      changeIds: [],
    },
    constraints: {
      allowedFiles: ["src/**"],
      risk: "medium",
    },
    outputSchema: {},
    skillInstruction: {
      skillSlug: "feat-implement-skill",
      requestedAction: "feature_execution",
      sourcePaths: ["docs/features/feat-016/requirements.md"],
      expectedArtifacts: [],
    },
  };
}

function skillOutput(): SkillOutputContract {
  return {
    contractVersion: "skill-contract/v1",
    executionId: "RUN-APP",
    skillSlug: "feat-implement-skill",
    requestedAction: "feature_execution",
    status: "completed",
    summary: "Implemented.",
    nextAction: null,
    producedArtifacts: [],
    traceability: {
      featureId: "FEAT-016",
      requirementIds: ["REQ-VSC-010"],
      changeIds: [],
    },
    result: { changedFiles: ["src/example.ts"] },
  };
}

function runnerPolicy(): RunnerPolicy {
  return {
    id: "policy-1",
    runId: "RUN-APP",
    risk: "medium",
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
    model: "gemini-3-pro-preview",
    reasoningEffort: "medium",
    outputSchema: {},
    workspaceRoot: "/repo",
    heartbeatIntervalSeconds: 30,
    commandTimeoutMs: 60000,
    createdAt: "2026-05-02T12:00:00.000Z",
  };
}

class FakeGeminiAcpTransport implements GeminiAcpTransport {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  private readonly eventQueue: CliJsonEvent[];
  private readonly options: { hangPrompt?: boolean };

  constructor(
    eventQueue: CliJsonEvent[],
    options: { hangPrompt?: boolean } = {},
  ) {
    this.eventQueue = eventQueue;
    this.options = options;
  }

  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.requests.push({ method, params });
    if (method === "initialize") return Promise.resolve({ agentInfo: { name: "gemini-cli" } });
    if (method === "newSession") return Promise.resolve({ sessionId: "GEMINI-ACP-SESSION" });
    if (method === "loadSession") return Promise.resolve({});
    if (method === "prompt" && this.options.hangPrompt) return new Promise(() => undefined);
    if (method === "prompt") {
      return new Promise((resolve) => setTimeout(() => resolve({
        stopReason: "end_turn",
        _meta: { quota: { token_count: { input_tokens: 4, output_tokens: 5 }, model_usage: [] } },
      }), 0));
    }
    return Promise.resolve({});
  }

  async *events(): AsyncIterable<CliJsonEvent> {
    while (this.eventQueue.length > 0) {
      yield this.eventQueue.shift()!;
    }
  }
}
