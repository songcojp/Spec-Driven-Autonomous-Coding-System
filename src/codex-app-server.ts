import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type {
  CodexAdapterResult,
  CodexJsonEvent,
  RawExecutionLog,
  RunnerPolicy,
  SkillInvocationContract,
  SkillOutputContract,
} from "./codex-runner.ts";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: Record<string, unknown>;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

export type CodexAppServerRequestSequenceInput = {
  executionId: string;
  workspaceRoot: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  skillInvocation?: SkillInvocationContract;
  threadId?: string;
  clientInfo?: {
    name: string;
    version: string;
  };
};

export type CodexAppServerRequestSequence = {
  initialize: JsonRpcRequest;
  initialized: JsonRpcNotification;
  thread: JsonRpcRequest;
  turn: JsonRpcRequest;
};

export type CodexAppServerProjection = {
  threadId?: string;
  turnId?: string;
  status: "running" | "completed" | "failed" | "approval_needed";
  assistantMessage: string;
  commandOutput: string;
  diffUpdated: boolean;
  approvalRequests: CodexJsonEvent[];
  skillOutput?: SkillOutputContract;
  error?: string;
};

export type CodexAppServerAdapterResultInput = {
  runId: string;
  workspaceRoot: string;
  events: CodexJsonEvent[];
  policy: RunnerPolicy;
  startedAt: string;
  completedAt: string;
  skillInvocation?: SkillInvocationContract;
};

export type CodexAppServerTransport = {
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  notify(method: string, params?: Record<string, unknown>): Promise<void> | void;
  events(): AsyncIterable<CodexJsonEvent>;
  close?(): Promise<void> | void;
};

export type CodexAppServerSessionInput = {
  runId: string;
  workspaceRoot: string;
  prompt: string;
  policy: RunnerPolicy;
  transport: CodexAppServerTransport;
  skillInvocation?: SkillInvocationContract;
  threadId?: string;
  startedAt?: string;
  now?: Date;
};

export type CodexAppServerStdioTransportInput = {
  command?: string;
  args?: string[];
  cwd: string;
  requestTimeoutMs?: number;
  process?: JsonRpcStdioProcess;
};

export type JsonRpcStdioProcess = {
  stdin: Pick<Writable, "write" | "end">;
  stdout: Readable;
  stderr?: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
};

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export function createCodexAppServerStdioTransport(input: CodexAppServerStdioTransportInput): CodexAppServerTransport {
  const command = input.command ?? "codex";
  const args = input.args ?? ["app-server", "--listen", "stdio://"];
  const process = input.process ?? spawn(command, args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const requestTimeoutMs = input.requestTimeoutMs ?? 120_000;
  const pending = new Map<string, PendingRequest>();
  const queuedEvents: CodexJsonEvent[] = [];
  const eventWaiters: Array<(event: CodexJsonEvent | undefined) => void> = [];
  let closed = false;

  const stdout = createInterface({ input: process.stdout });
  stdout.on("line", (line) => {
    const message = parseJsonLine(line);
    if (!message) return;
    if (typeof message.id === "string" && pending.has(message.id)) {
      const request = pending.get(message.id)!;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) {
        request.reject(new Error(errorMessageFromJsonRpc(message.error)));
      } else {
        request.resolve(isRecord(message.result) ? message.result : {});
      }
      return;
    }
    pushEvent(normalizeServerEvent(message));
  });
  process.on("exit", (code, signal) => {
    closed = true;
    const error = new Error(`Codex app-server exited before completing pending requests: code=${code ?? "null"} signal=${signal ?? "null"}`);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    flushEventWaiters();
  });
  process.on("error", (error) => {
    closed = true;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    flushEventWaiters();
  });

  function pushEvent(event: CodexJsonEvent): void {
    const waiter = eventWaiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }
    queuedEvents.push(event);
  }

  function flushEventWaiters(): void {
    while (eventWaiters.length > 0) {
      eventWaiters.shift()?.(undefined);
    }
  }

  return {
    request(method, params) {
      if (closed) return Promise.reject(new Error("Codex app-server transport is closed."));
      const id = `${method}:${randomUUID()}`;
      const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Codex app-server request timed out: ${method}`));
        }, requestTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        process.stdin.write(`${JSON.stringify(payload)}\n`);
      });
    },
    notify(method, params = {}) {
      if (closed) return;
      const payload: JsonRpcNotification = { jsonrpc: "2.0", method, params };
      process.stdin.write(`${JSON.stringify(payload)}\n`);
    },
    async *events() {
      while (!closed || queuedEvents.length > 0) {
        const event = queuedEvents.shift() ?? await new Promise<CodexJsonEvent | undefined>((resolve) => {
          eventWaiters.push(resolve);
        });
        if (!event) return;
        yield event;
      }
    },
    close() {
      closed = true;
      stdout.close();
      process.stdin.end();
      process.kill();
      flushEventWaiters();
    },
  };
}

export function buildCodexAppServerRequestSequence(input: CodexAppServerRequestSequenceInput): CodexAppServerRequestSequence {
  const threadMethod = input.threadId ? "thread/resume" : "thread/start";
  const threadParams = input.threadId
    ? { threadId: input.threadId, cwd: input.workspaceRoot }
    : { cwd: input.workspaceRoot };
  const skillInput = input.skillInvocation
    ? [{
        type: "skill",
        name: input.skillInvocation.skillSlug,
        path: `.agents/skills/${input.skillInvocation.skillSlug}/SKILL.md`,
      }]
    : [];

  return {
    initialize: {
      jsonrpc: "2.0",
      id: `${input.executionId}:initialize`,
      method: "initialize",
      params: {
        clientInfo: input.clientInfo ?? { name: "SpecDrive AutoBuild", version: "0.1.0" },
      },
    },
    initialized: {
      jsonrpc: "2.0",
      method: "initialized",
      params: {},
    },
    thread: {
      jsonrpc: "2.0",
      id: `${input.executionId}:thread`,
      method: threadMethod,
      params: threadParams,
    },
    turn: {
      jsonrpc: "2.0",
      id: `${input.executionId}:turn`,
      method: "turn/start",
      params: {
        threadId: input.threadId,
        cwd: input.workspaceRoot,
        input: [
          { type: "text", text: input.prompt },
          ...skillInput,
        ],
        outputSchema: input.outputSchema,
      },
    },
  };
}

export async function runCodexAppServerSession(input: CodexAppServerSessionInput): Promise<CodexAdapterResult> {
  const startedAt = input.startedAt ?? (input.now ?? new Date()).toISOString();
  await input.transport.request("initialize", {
    clientInfo: { name: "SpecDrive AutoBuild", version: "0.1.0" },
  });
  await input.transport.notify("initialized", {});

  const threadMethod = input.threadId ? "thread/resume" : "thread/start";
  const threadResult = await input.transport.request(threadMethod, input.threadId
    ? { threadId: input.threadId, cwd: input.workspaceRoot }
    : { cwd: input.workspaceRoot });
  const threadId = input.threadId ?? threadIdFromResult(threadResult);
  if (!threadId) {
    throw new Error("Codex app-server did not return a thread id.");
  }
  const turnResult = await input.transport.request("turn/start", {
    threadId,
    cwd: input.workspaceRoot,
    input: [
      { type: "text", text: input.prompt },
      ...(input.skillInvocation ? [{
        type: "skill",
        name: input.skillInvocation.skillSlug,
        path: `.agents/skills/${input.skillInvocation.skillSlug}/SKILL.md`,
      }] : []),
    ],
    outputSchema: input.policy.outputSchema,
  });
  const turnId = turnIdFromResult(turnResult);
  const events: CodexJsonEvent[] = [];
  if (threadId) events.push({ type: "thread/started", id: threadId });
  if (turnId) events.push({ type: "turn/started", id: turnId, threadId });
  for await (const event of input.transport.events()) {
    events.push(event);
    if (String(event.type ?? event.method ?? "") === "turn/completed") {
      break;
    }
  }
  const completedAt = (input.now ?? new Date()).toISOString();
  return buildCodexAppServerAdapterResult({
    runId: input.runId,
    workspaceRoot: input.workspaceRoot,
    events,
    policy: input.policy,
    startedAt,
    completedAt,
    skillInvocation: input.skillInvocation,
  });
}

export function projectCodexAppServerEvents(events: CodexJsonEvent[]): CodexAppServerProjection {
  let threadId: string | undefined;
  let turnId: string | undefined;
  let status: CodexAppServerProjection["status"] = "running";
  let assistantMessage = "";
  let commandOutput = "";
  let diffUpdated = false;
  let error: string | undefined;
  const approvalRequests: CodexJsonEvent[] = [];
  let skillOutput: SkillOutputContract | undefined;

  for (const event of events) {
    const type = String(event.type ?? event.method ?? "");
    threadId = optionalString(event.threadId) ?? optionalString(event.thread_id) ?? threadId;
    turnId = optionalString(event.turnId) ?? optionalString(event.turn_id) ?? turnId;

    if (type === "thread/started") {
      threadId = optionalString(event.id) ?? threadId;
    }
    if (type === "turn/started") {
      turnId = optionalString(event.id) ?? turnId;
      status = "running";
    }
    if (type === "item/agentMessage/delta") {
      assistantMessage += optionalString(event.delta) ?? optionalString(event.text) ?? "";
    }
    if (type === "item/commandExecution/outputDelta") {
      commandOutput += optionalString(event.delta) ?? optionalString(event.text) ?? "";
    }
    if (type === "turn/diff/updated") {
      diffUpdated = true;
    }
    if (type === "approval/request" || type.endsWith("/approval/request")) {
      status = "approval_needed";
      approvalRequests.push(event);
    }
    if (type === "turn/completed") {
      const terminalStatus = optionalString(event.status) ?? optionalString((event.result as Record<string, unknown> | undefined)?.status);
      status = terminalStatus === "failed" ? "failed" : "completed";
      error = optionalString(event.error) ?? optionalString((event.result as Record<string, unknown> | undefined)?.error);
      skillOutput = extractSkillOutput(event) ?? skillOutput;
    }
  }

  return {
    threadId,
    turnId,
    status,
    assistantMessage,
    commandOutput,
    diffUpdated,
    approvalRequests,
    skillOutput,
    error,
  };
}

export function buildCodexAppServerAdapterResult(input: CodexAppServerAdapterResultInput): CodexAdapterResult {
  const projection = projectCodexAppServerEvents(input.events);
  const rawLog: RawExecutionLog = {
    id: `${input.runId}:app-server-log`,
    runId: input.runId,
    stdout: projection.assistantMessage,
    stderr: projection.error ?? "",
    events: input.events,
    createdAt: input.completedAt,
  };
  return {
    session: {
      id: `${input.runId}:app-server-session`,
      runId: input.runId,
      sessionId: projection.threadId,
      workspaceRoot: input.workspaceRoot,
      command: "codex",
      args: ["app-server"],
      exitCode: projection.status === "failed" ? 1 : 0,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    },
    rawLog,
    evidence: {
      runId: input.runId,
      taskId: input.skillInvocation?.traceability.taskId,
      featureId: input.skillInvocation?.traceability.featureId,
      sessionId: projection.threadId,
      exitCode: projection.status === "failed" ? 1 : 0,
      events: input.events,
      stdout: projection.assistantMessage,
      stderr: projection.error ?? "",
      skillInvocation: input.skillInvocation,
      skillOutput: projection.skillOutput,
    },
  };
}

function extractSkillOutput(event: CodexJsonEvent): SkillOutputContract | undefined {
  const candidates = [
    event.output,
    event.result,
    isRecord(event.result) ? event.result.output : undefined,
    isRecord(event.result) ? event.result.finalOutput : undefined,
  ];
  for (const candidate of candidates) {
    if (isSkillOutput(candidate)) return candidate;
    if (typeof candidate === "string") {
      try {
        const parsed = JSON.parse(candidate);
        if (isSkillOutput(parsed)) return parsed;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function isSkillOutput(value: unknown): value is SkillOutputContract {
  if (!isRecord(value)) return false;
  return value.contractVersion === "skill-contract/v1"
    && typeof value.executionId === "string"
    && typeof value.skillSlug === "string"
    && typeof value.requestedAction === "string"
    && typeof value.status === "string"
    && typeof value.summary === "string"
    && Array.isArray(value.producedArtifacts)
    && Array.isArray(value.evidence);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  if (!line.trim()) return undefined;
  try {
    const parsed = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeServerEvent(message: Record<string, unknown>): CodexJsonEvent {
  if (typeof message.method === "string") {
    return {
      type: message.method,
      ...(isRecord(message.params) ? message.params : {}),
    };
  }
  return message;
}

function errorMessageFromJsonRpc(error: unknown): string {
  if (isRecord(error)) {
    return optionalString(error.message) ?? JSON.stringify(error);
  }
  return String(error);
}

function threadIdFromResult(result: Record<string, unknown>): string | undefined {
  return optionalString(result.threadId)
    ?? optionalString(result.thread_id)
    ?? optionalString(result.id)
    ?? (isRecord(result.thread) ? optionalString(result.thread.id) : undefined);
}

function turnIdFromResult(result: Record<string, unknown>): string | undefined {
  return optionalString(result.turnId)
    ?? optionalString(result.turn_id)
    ?? optionalString(result.id)
    ?? (isRecord(result.turn) ? optionalString(result.turn.id) : undefined);
}
