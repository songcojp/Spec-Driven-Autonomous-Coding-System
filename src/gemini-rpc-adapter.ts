import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { validateSkillOutputContract, writeRunReport } from "./cli-adapter.ts";
import type {
  CliAdapterResult,
  CliJsonEvent,
  RawExecutionLog,
  RunnerPolicy,
  SkillOutputContract,
} from "./cli-adapter.ts";
import type {
  ExecutionAdapterInvocationV1,
  ExecutionAdapterProviderSessionV1,
  ExecutionAdapterResultV1,
} from "./execution-adapter-contracts.ts";
import {
  rpcAdapterConfigToExecutionAdapterConfig,
  type JsonRpcRequest,
  type RpcAdapterConfig,
  type RpcAdapterConfigV1,
} from "./rpc-adapter.ts";

export type GeminiAcpAdapterConfig = RpcAdapterConfig & {
  provider?: "gemini-acp";
};

export type GeminiAcpStdioProcess = {
  stdin: Pick<Writable, "write" | "end">;
  stdout: Readable;
  stderr?: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
};

export type GeminiAcpTransport = {
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  events(): AsyncIterable<CliJsonEvent>;
  close?(): Promise<void> | void;
};

export type GeminiAcpSessionInput = {
  runId: string;
  workspaceRoot: string;
  prompt: string;
  policy: RunnerPolicy;
  transport: GeminiAcpTransport;
  commandArgs?: string[];
  executionInvocation?: ExecutionAdapterInvocationV1;
  sessionId?: string;
  startedAt?: string;
  now?: Date;
};

export type GeminiAcpAdapterResultInput = {
  runId: string;
  workspaceRoot: string;
  events: CliJsonEvent[];
  policy: RunnerPolicy;
  commandArgs?: string[];
  startedAt: string;
  completedAt: string;
  executionInvocation?: ExecutionAdapterInvocationV1;
};

export const DEFAULT_GEMINI_ACP_ADAPTER_CONFIG: GeminiAcpAdapterConfig = {
  id: "gemini-acp-default",
  displayName: "Built-in Gemini ACP",
  provider: "gemini-acp",
  executable: "gemini",
  args: ["--acp", "--skip-trust"],
  transport: "stdio",
  endpoint: "stdio://",
  requestTimeoutMs: 120_000,
  defaults: {
    model: "gemini-3-pro-preview",
    costRates: {},
  },
  status: "disabled",
};

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export function geminiAcpConfigToExecutionAdapterConfig(config: GeminiAcpAdapterConfig): RpcAdapterConfigV1 {
  return rpcAdapterConfigToExecutionAdapterConfig({
    config,
    provider: "gemini-acp",
    capabilities: ["json-rpc", "acp", "session", "prompt", "permission", "event-stream", "skill-output-contract"],
    outputMapping: {
      eventStream: "json-rpc",
      outputSchema: "skill-output.schema.json",
      sessionIdPath: "sessionId",
    },
  });
}

export function createGeminiAcpStdioTransport(input: {
  command?: string;
  args?: string[];
  cwd: string;
  requestTimeoutMs?: number;
  process?: GeminiAcpStdioProcess;
}): GeminiAcpTransport {
  const command = input.command ?? "gemini";
  const args = input.args ?? ["--acp", "--skip-trust"];
  const process = input.process ?? spawn(command, args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  const requestTimeoutMs = input.requestTimeoutMs ?? 120_000;
  const pending = new Map<string, PendingRequest>();
  const queuedEvents: CliJsonEvent[] = [];
  const eventWaiters: Array<(event: CliJsonEvent | undefined) => void> = [];
  let closed = false;

  const stdout = createInterface({ input: process.stdout });
  stdout.on("line", (line) => {
    const message = parseJsonLine(line);
    if (!message) {
      if (line.trim()) pushEvent({ type: "stdout/noise", text: line });
      return;
    }
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
    pushEvent(normalizeAcpEvent(message));
  });
  process.stderr?.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    if (text.trim()) pushEvent({ type: "stderr", text });
  });
  process.on("exit", (code, signal) => {
    closed = true;
    const error = new Error(`Gemini ACP exited before completing pending requests: code=${code ?? "null"} signal=${signal ?? "null"}`);
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

  function pushEvent(event: CliJsonEvent): void {
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
      if (closed) return Promise.reject(new Error("Gemini ACP transport is closed."));
      const id = `${method}:${randomUUID()}`;
      const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Gemini ACP request timed out: ${method}`));
        }, requestTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        process.stdin.write(`${JSON.stringify(payload)}\n`);
      });
    },
    async *events() {
      while (!closed || queuedEvents.length > 0) {
        const event = queuedEvents.shift() ?? await new Promise<CliJsonEvent | undefined>((resolve) => {
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

export function createGeminiAcpTransportFromConfig(config: GeminiAcpAdapterConfig, cwd: string): GeminiAcpTransport {
  if (config.transport !== "stdio") {
    throw new Error(`Gemini ACP transport is not supported yet: ${config.transport}`);
  }
  return createGeminiAcpStdioTransport({
    command: config.executable,
    args: config.args,
    cwd,
    requestTimeoutMs: config.requestTimeoutMs,
  });
}

export async function runGeminiAcpSession(input: GeminiAcpSessionInput): Promise<CliAdapterResult> {
  const startedAt = input.startedAt ?? (input.now ?? new Date()).toISOString();
  const events: CliJsonEvent[] = [];
  const initializeResult = await input.transport.request("initialize", {
    clientInfo: { name: "SpecDrive AutoBuild", version: "0.1.0" },
    clientCapabilities: {},
  });
  events.push({ type: "initialize/result", ...initializeResult });

  const sessionResult = input.sessionId
    ? await input.transport.request("loadSession", { sessionId: input.sessionId, cwd: input.workspaceRoot, mcpServers: [] })
    : await input.transport.request("newSession", { cwd: input.workspaceRoot, mcpServers: [] });
  const sessionId = input.sessionId ?? optionalString(sessionResult.sessionId);
  if (!sessionId) {
    throw new Error("Gemini ACP did not return a session id.");
  }
  events.push({ type: input.sessionId ? "loadSession/result" : "newSession/result", sessionId, ...sessionResult });

  const promptPromise = input.transport.request("prompt", {
    sessionId,
    prompt: [{ type: "text", text: input.prompt }],
  });
  const promptResult = await collectGeminiAcpPromptResult(input.transport, promptPromise, events);
  if (promptResult) events.push({ type: "prompt/result", sessionId, ...promptResult });
  const completedAt = (input.now ?? new Date()).toISOString();
  return buildGeminiAcpAdapterResult({
    runId: input.runId,
    workspaceRoot: input.workspaceRoot,
    events,
    policy: input.policy,
    commandArgs: input.commandArgs,
    startedAt,
    completedAt,
    executionInvocation: input.executionInvocation,
  });
}

export function buildGeminiAcpAdapterResult(input: GeminiAcpAdapterResultInput): CliAdapterResult {
  const projection = projectGeminiAcpEvents(input.events);
  const contractValidation = validateSkillOutputContract(input.executionInvocation, projection.skillOutput);
  const failedContract = input.executionInvocation && projection.status !== "approval_needed" && !contractValidation.valid;
  const exitCode = projection.status === "failed" || failedContract ? 1 : 0;
  const stderr = projection.error ?? (failedContract ? contractValidation.reasons.join("; ") : "");
  const commandArgs = input.commandArgs ?? DEFAULT_GEMINI_ACP_ADAPTER_CONFIG.args;
  const providerSession: ExecutionAdapterProviderSessionV1 = {
    provider: "gemini-acp",
    transport: "stdio",
    command: "gemini",
    args: commandArgs,
    cwd: input.workspaceRoot,
    sessionId: projection.sessionId,
    model: input.policy.model,
    exitCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    eventRefs: input.events.map((event, index) => ({
      index,
      type: optionalString(event.type) ?? optionalString(event.method),
    })),
    approvalState: projection.status === "approval_needed" ? "pending" : "none",
  };
  const rawLog: RawExecutionLog = {
    id: `${input.runId}:gemini-acp-log`,
    runId: input.runId,
    stdout: projection.assistantMessage,
    stderr,
    events: input.events,
    createdAt: input.completedAt,
  };
  const executionAdapterResult: ExecutionAdapterResultV1 = {
    contractVersion: "execution-adapter/v1",
    executionId: input.runId,
    status: projection.status === "approval_needed"
      ? "approval_needed"
      : exitCode === 0
        ? projection.skillOutput?.status ?? "completed"
        : "failed",
    providerSession,
    summary: projection.skillOutput?.summary ?? projection.error ?? (projection.status === "approval_needed" ? "Gemini ACP is waiting for permission." : `Gemini ACP exit=${exitCode}.`),
    skillOutput: projection.skillOutput,
    producedArtifacts: projection.skillOutput?.producedArtifacts ?? [],
    traceability: projection.skillOutput?.traceability ?? input.executionInvocation?.traceability ?? { requirementIds: [], changeIds: [] },
    nextAction: projection.skillOutput?.nextAction,
    rawLogRefs: [rawLog.id],
    error: stderr || undefined,
  };
  const reportPath = writeRunReport(input.workspaceRoot, input.runId, {
    runId: input.runId,
    featureId: input.executionInvocation?.featureId ?? input.executionInvocation?.traceability.featureId,
    status: executionAdapterResult.status === "cancelled" ? "blocked" : executionAdapterResult.status,
    exitCode,
    sessionId: projection.sessionId,
    eventCount: input.events.length,
    executionInvocation: input.executionInvocation,
    skillOutput: projection.skillOutput,
    contractValidation,
    producedArtifacts: projection.skillOutput?.producedArtifacts ?? [],
    error: stderr || undefined,
    completedAt: input.completedAt,
  });
  if (reportPath) executionAdapterResult.rawLogRefs.push(reportPath);
  return {
    session: {
      id: `${input.runId}:gemini-acp-session`,
      runId: input.runId,
      sessionId: projection.sessionId,
      workspaceRoot: input.workspaceRoot,
      command: "gemini",
      args: commandArgs,
      exitCode,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    },
    rawLog,
    result: {
      runId: input.runId,
      featureId: input.executionInvocation?.featureId ?? input.executionInvocation?.traceability.featureId,
      sessionId: projection.sessionId,
      exitCode,
      events: input.events,
      stdout: projection.assistantMessage,
      stderr,
      executionInvocation: input.executionInvocation,
      skillOutput: projection.skillOutput,
      contractValidation,
    },
    executionAdapterResult,
  };
}

async function collectGeminiAcpPromptResult(
  transport: GeminiAcpTransport,
  promptPromise: Promise<Record<string, unknown>>,
  events: CliJsonEvent[],
): Promise<Record<string, unknown> | undefined> {
  const iterator = transport.events()[Symbol.asyncIterator]();
  let promptDone = false;
  let promptResult: Record<string, unknown> | undefined;
  promptPromise.then((result) => {
    promptDone = true;
    promptResult = result;
  }).catch((error) => {
    promptDone = true;
    promptResult = { stopReason: "error", error: error instanceof Error ? error.message : String(error) };
  });
  while (!promptDone) {
    const next = await Promise.race([
      iterator.next(),
      promptPromise.then((result) => ({ done: true, value: { type: "prompt/result", ...result } as CliJsonEvent })),
    ]);
    if (next.value) {
      const event = next.value as CliJsonEvent;
      if (event.type !== "prompt/result") events.push(event);
      if (isPermissionRequest(event)) return { stopReason: "approval_needed" };
    }
    if (next.done) break;
  }
  return promptResult;
}

function projectGeminiAcpEvents(events: CliJsonEvent[]): {
  sessionId?: string;
  status: "completed" | "failed" | "approval_needed" | "cancelled";
  assistantMessage: string;
  skillOutput?: SkillOutputContract;
  error?: string;
} {
  let sessionId: string | undefined;
  let status: "completed" | "failed" | "approval_needed" | "cancelled" = "completed";
  let assistantMessage = "";
  let skillOutput: SkillOutputContract | undefined;
  let error: string | undefined;
  for (const event of events) {
    sessionId = optionalString(event.sessionId) ?? optionalString(event.session_id) ?? sessionId;
    if (isPermissionRequest(event)) status = "approval_needed";
    const type = String(event.type ?? event.method ?? "");
    if (type === "session/update" || type === "sessionUpdate") {
      const update = isRecord(event.update) ? event.update : isRecord(event.sessionUpdate) ? event.sessionUpdate : event;
      const updateType = optionalString(update.sessionUpdate);
      if (updateType === "agent_message_chunk") {
        const text = contentText(update.content);
        assistantMessage += text;
        skillOutput = parseSkillOutputText(text) ?? skillOutput;
      }
      if (updateType === "agent_thought_chunk") {
        assistantMessage += "";
      }
      if (updateType === "tool_call" || updateType === "tool_call_update") {
        // Raw tool updates are preserved in events; they are not assistant text.
      }
    }
    if (type === "prompt/result") {
      const stopReason = optionalString(event.stopReason);
      if (stopReason === "cancelled") status = "cancelled";
      if (stopReason === "approval_needed") status = "approval_needed";
      if (stopReason && !["end_turn", "approval_needed", "cancelled"].includes(stopReason)) status = "failed";
      const meta = isRecord(event._meta) ? event._meta : undefined;
      if (meta) {
        event.usage = isRecord(meta.quota) ? meta.quota : meta;
      }
    }
    if (type === "error" || optionalString(event.error)) {
      status = "failed";
      error = optionalString(event.message) ?? optionalString(event.error) ?? error;
    }
  }
  if (!skillOutput) {
    skillOutput = parseSkillOutputText(assistantMessage);
  }
  return { sessionId, status, assistantMessage, skillOutput, error };
}

function normalizeAcpEvent(message: Record<string, unknown>): CliJsonEvent {
  if (typeof message.method === "string") {
    return {
      type: message.method,
      requestId: optionalString(message.id),
      ...(isRecord(message.params) ? message.params : {}),
    };
  }
  return message;
}

function isPermissionRequest(event: CliJsonEvent): boolean {
  const type = String(event.type ?? event.method ?? "");
  return type === "requestPermission" || type.endsWith("/requestPermission");
}

function contentText(value: unknown): string {
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  if (isRecord(value.content) && typeof value.content.text === "string") return value.content.text;
  return "";
}

function parseSkillOutputText(text: string | undefined): SkillOutputContract | undefined {
  if (!text) return undefined;
  for (const candidate of candidateJsonTexts(text)) {
    try {
      const parsed = JSON.parse(candidate);
      if (isSkillOutput(parsed)) return parsed;
    } catch {
      continue;
    }
  }
  return undefined;
}

function candidateJsonTexts(text: string): string[] {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  return [...new Set(candidates.filter(Boolean))];
}

function isSkillOutput(value: unknown): value is SkillOutputContract {
  return isRecord(value)
    && value.contractVersion === "skill-contract/v1"
    && typeof value.executionId === "string"
    && typeof value.skillSlug === "string"
    && typeof value.requestedAction === "string"
    && typeof value.status === "string"
    && typeof value.summary === "string"
    && (typeof value.nextAction === "string" || value.nextAction === null)
    && Array.isArray(value.producedArtifacts)
    && isRecord(value.traceability)
    && isRecord(value.result);
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

function errorMessageFromJsonRpc(error: unknown): string {
  if (isRecord(error)) {
    return optionalString(error.message) ?? JSON.stringify(error);
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
