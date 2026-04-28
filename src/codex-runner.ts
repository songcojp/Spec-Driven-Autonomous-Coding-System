import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ORDINARY_LOG_SECRET_PATTERNS } from "./persistence.ts";
import { runSqlite, type SqlStatement } from "./sqlite.ts";
import type { RiskLevel } from "./orchestration.ts";
import type { WorktreeRecord } from "./workspace.ts";
import {
  runStatusCheck,
  type CommandCheckKind,
  type CommandCheckResult,
  type CommandCheckStatus,
  type DiffSummary,
  type EvidenceAttachmentRef,
  type RunnerTerminalStatus,
  type SpecAlignmentInput,
  type StatusCheckResult,
  type StatusDecision,
} from "./status-checker.ts";

export type RunnerSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type RunnerApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never" | "bypass";
export type RunnerQueueStatus = "queued" | "running" | "completed" | "review_needed" | "blocked" | "failed";

export type RunnerPolicy = {
  id: string;
  runId: string;
  risk: RiskLevel;
  sandboxMode: RunnerSandboxMode;
  approvalPolicy: RunnerApprovalPolicy;
  model: string;
  profile?: string;
  outputSchema: Record<string, unknown>;
  workspaceRoot: string;
  resumeSessionId?: string;
  heartbeatIntervalSeconds: number;
  createdAt: string;
};

export type RunnerHeartbeat = {
  id: string;
  runId: string;
  runnerId: string;
  status: "online" | "offline";
  sandboxMode: RunnerSandboxMode;
  approvalPolicy: RunnerApprovalPolicy;
  queueStatus: RunnerQueueStatus;
  message?: string;
  beatAt: string;
};

export type CodexSessionRecord = {
  id: string;
  runId: string;
  sessionId?: string;
  workspaceRoot: string;
  command: string;
  args: string[];
  exitCode: number | null;
  startedAt: string;
  completedAt: string;
};

export type RawExecutionLog = {
  id: string;
  runId: string;
  stdout: string;
  stderr: string;
  events: CodexJsonEvent[];
  createdAt: string;
};

export type CodexJsonEvent = {
  type?: string;
  session_id?: string;
  [key: string]: unknown;
};

export type EvidenceInput = {
  runId: string;
  taskId?: string;
  featureId?: string;
  sessionId?: string;
  exitCode: number | null;
  events: CodexJsonEvent[];
  stdout: string;
  stderr: string;
};

export type RunnerPolicyInput = {
  runId: string;
  risk: RiskLevel;
  taskType?: string;
  workspaceRoot: string;
  model?: string;
  profile?: string;
  outputSchema?: Record<string, unknown>;
  resumeSessionId?: string;
  requestedSandboxMode?: RunnerSandboxMode;
  requestedApprovalPolicy?: RunnerApprovalPolicy;
  heartbeatIntervalSeconds?: number;
  now?: Date;
};

export type SafetyGateInput = {
  policy: RunnerPolicy;
  prompt?: string;
  files?: string[];
  commands?: string[];
  taskText?: string;
};

export type SafetyGateResult = {
  allowed: boolean;
  reviewNeeded: boolean;
  reasons: string[];
  evidence: string;
};

export type CodexCommandResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
};

export type CodexCommandRunner = (command: string, args: string[], cwd: string) => CodexCommandResult;
export type AsyncCodexCommandRunner = (command: string, args: string[], cwd: string) => Promise<CodexCommandResult>;

export type CodexAdapterInput = {
  policy: RunnerPolicy;
  prompt: string;
  taskId?: string;
  featureId?: string;
  outputSchemaPath?: string;
  runner?: CodexCommandRunner;
  asyncRunner?: AsyncCodexCommandRunner;
  onHeartbeat?: () => void;
  now?: Date;
};

export type CodexAdapterResult = {
  session: CodexSessionRecord;
  rawLog: RawExecutionLog;
  evidence: EvidenceInput;
};

export type RunnerQueueItem = {
  runId: string;
  taskId?: string;
  featureId?: string;
  prompt: string;
  policy: RunnerPolicy;
  files?: string[];
  commands?: string[];
  taskText?: string;
  statusCheck?: RunnerStatusCheckInput;
};

export type RunnerQueueWorkerResult = {
  runId: string;
  status: RunnerQueueStatus;
  safety: SafetyGateResult;
  adapterResult?: CodexAdapterResult;
  statusCheckResult?: StatusCheckResult;
  evidence: string;
};

export type RunnerStatusCheckInput = {
  dbPath: string;
  workspaceRoot?: string;
  artifactRoot?: string;
  diff?: DiffSummary;
  commandChecks?: CommandCheckResult[];
  requiredCommandChecks?: CommandCheckKind[];
  specAlignment?: SpecAlignmentInput;
  allowedFiles?: string[];
  forbiddenFiles?: string[];
  failureHistory?: Array<StatusDecision | RunnerTerminalStatus | CommandCheckStatus>;
  failureThreshold?: number;
  attachments?: EvidenceAttachmentRef[];
};

export type RunnerConsoleSnapshot = {
  runnerId: string;
  online: boolean;
  lastHeartbeatAt?: string;
  codexVersion?: string;
  sandboxMode: RunnerSandboxMode;
  approvalPolicy: RunnerApprovalPolicy;
  queue: Array<{ runId: string; status: RunnerQueueStatus }>;
  recentLogs: Array<{ runId: string; stdout: string; stderr: string; createdAt: string }>;
  heartbeatStale: boolean;
};

const DEFAULT_MODEL = "gpt-5-codex";
const DEFAULT_OUTPUT_SCHEMA = {
  type: "object",
  required: ["summary", "status", "evidence"],
  properties: {
    summary: { type: "string" },
    status: { enum: ["completed", "review_needed", "blocked", "failed"] },
    evidence: { type: "array", items: { type: "string" } },
  },
};
const FORBIDDEN_FILE_PATTERNS = [
  /(^|\/)\.env($|\.)/,
  /(^|\/)secrets?\//i,
  /(^|\/)credentials?\//i,
  /(^|\/)id_rsa$/,
  /(^|\/)\.ssh\//,
  /(^|\/)payment/i,
  /(^|\/)auth/i,
  /(^|\/)permission/i,
  /migration/i,
];
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+push\b.*\s--force\b/,
  /\bchmod\s+777\b/,
  /\bsudo\b/,
  /\bdrop\s+database\b/i,
];
const HIGH_RISK_TEXT_PATTERNS = [/\bauth/i, /\bpermission/i, /\bpayment/i, /\bmigrat(?:e|ion)\b/i, /\bsecret/i, /\btoken/i, /\bkey/i];

export function resolveRunnerPolicy(input: RunnerPolicyInput): RunnerPolicy {
  const now = input.now ?? new Date();
  const requestedSandboxMode = input.requestedSandboxMode ?? (input.risk === "high" ? "read-only" : "workspace-write");
  const requestedApprovalPolicy =
    input.requestedApprovalPolicy ?? (input.risk === "high" ? "untrusted" : "on-request");
  const sandboxMode = input.risk === "high" && requestedSandboxMode === "danger-full-access" ? "read-only" : requestedSandboxMode;
  const approvalPolicy = requestedApprovalPolicy === "bypass" ? "on-request" : requestedApprovalPolicy;
  const heartbeatIntervalSeconds = clampHeartbeat(input.heartbeatIntervalSeconds ?? 20);

  if (!input.workspaceRoot.trim()) {
    throw new Error("RunnerPolicy requires a workspace root.");
  }

  return {
    id: randomUUID(),
    runId: input.runId,
    risk: input.risk,
    sandboxMode,
    approvalPolicy,
    model: input.model ?? DEFAULT_MODEL,
    profile: input.profile,
    outputSchema: input.outputSchema ?? DEFAULT_OUTPUT_SCHEMA,
    workspaceRoot: input.workspaceRoot,
    resumeSessionId: input.resumeSessionId,
    heartbeatIntervalSeconds,
    createdAt: now.toISOString(),
  };
}

export function buildRunnerPolicyFromContract(input: {
  runId: string;
  risk: RiskLevel;
  workspace: Pick<WorktreeRecord, "path">;
  outputSchema?: Record<string, unknown>;
  resumeSessionId?: string;
  now?: Date;
}): RunnerPolicy {
  return resolveRunnerPolicy({
    runId: input.runId,
    risk: input.risk,
    workspaceRoot: input.workspace.path,
    outputSchema: input.outputSchema,
    resumeSessionId: input.resumeSessionId,
    now: input.now,
  });
}

export function evaluateRunnerSafety(input: SafetyGateInput): SafetyGateResult {
  const reasons: string[] = [];
  if (input.policy.sandboxMode === "danger-full-access") {
    reasons.push("danger-full-access sandbox is not allowed for automatic runner execution");
  }
  if (input.policy.approvalPolicy === "bypass") {
    reasons.push("approval bypass is not allowed for automatic runner execution");
  }
  if (input.policy.risk === "high" && input.policy.sandboxMode !== "read-only") {
    reasons.push("high-risk runner tasks must start in read-only sandbox mode");
  }

  for (const file of input.files ?? []) {
    if (FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(normalizePath(file)))) {
      reasons.push(`forbidden or high-risk file requires review: ${file}`);
    }
  }

  for (const command of input.commands ?? []) {
    if (DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) {
      reasons.push(`dangerous command requires review: ${command}`);
    }
    if (HIGH_RISK_TEXT_PATTERNS.some((pattern) => pattern.test(command))) {
      reasons.push(`high-risk command requires review: ${command}`);
    }
  }

  const safetyText = [input.taskText, input.prompt].filter(Boolean).join("\n");
  if (safetyText && DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(safetyText))) {
    reasons.push("prompt or task text includes a dangerous command and requires review");
  }
  if (safetyText && HIGH_RISK_TEXT_PATTERNS.some((pattern) => pattern.test(safetyText))) {
    reasons.push("task text or prompt references high-risk auth, permission, payment, migration, secret, token, or key changes");
  }

  const reviewNeeded = reasons.length > 0;
  return {
    allowed: !reviewNeeded,
    reviewNeeded,
    reasons,
    evidence: reviewNeeded ? `Runner safety gate blocked execution: ${reasons.join("; ")}.` : "Runner safety gate passed.",
  };
}

export async function runCodexCli(input: CodexAdapterInput): Promise<CodexAdapterResult> {
  const now = input.now ?? new Date();
  const shouldCleanupOutputSchema = !input.outputSchemaPath;
  const outputSchemaPath = input.outputSchemaPath ?? writeOutputSchema(input.policy);
  const args = buildCodexArgs(input.policy, input.prompt, outputSchemaPath);
  try {
    const result = input.asyncRunner
      ? await input.asyncRunner("codex", args, input.policy.workspaceRoot)
      : input.runner
        ? input.runner("codex", args, input.policy.workspaceRoot)
        : await runCommand("codex", args, input.policy.workspaceRoot, input.policy.heartbeatIntervalSeconds, input.onHeartbeat);
    const stdout = result.stdout ?? "";
    const stderr = [result.stderr, result.error?.message].filter(Boolean).join("\n");
    const events = parseJsonEvents(stdout);
    const redactedEvents = events.map(redactEvent);
    const sessionId = events.find((event) => typeof event.session_id === "string")?.session_id ?? input.policy.resumeSessionId;
    const completedAt = new Date().toISOString();
    const session: CodexSessionRecord = {
      id: randomUUID(),
      runId: input.policy.runId,
      sessionId,
      workspaceRoot: input.policy.workspaceRoot,
      command: "codex",
      args: args.map(redactLog),
      exitCode: result.status,
      startedAt: now.toISOString(),
      completedAt,
    };
    const rawLog: RawExecutionLog = {
      id: randomUUID(),
      runId: input.policy.runId,
      stdout: redactLog(stdout),
      stderr: redactLog(stderr),
      events: redactedEvents,
      createdAt: completedAt,
    };
    const evidence: EvidenceInput = {
      runId: input.policy.runId,
      taskId: input.taskId,
      featureId: input.featureId,
      sessionId,
      exitCode: result.status,
      events: redactedEvents,
      stdout: rawLog.stdout,
      stderr: rawLog.stderr,
    };

    return { session, rawLog, evidence };
  } finally {
    if (shouldCleanupOutputSchema) {
      rmSync(dirname(outputSchemaPath), { recursive: true, force: true });
    }
  }
}

export async function processRunnerQueueItem(
  input: RunnerQueueItem,
  runner?: CodexCommandRunner,
  onHeartbeat?: () => void,
): Promise<RunnerQueueWorkerResult> {
  const safety = evaluateRunnerSafety(input);
  if (!safety.allowed) {
    return {
      runId: input.runId,
      status: "review_needed",
      safety,
      evidence: safety.evidence,
    };
  }

  const adapterResult = await runCodexCli({
    policy: input.policy,
    prompt: input.prompt,
    taskId: input.taskId,
    featureId: input.featureId,
    runner,
    onHeartbeat,
  });
  const status = classifyQueueStatus(adapterResult);
  const statusCheckResult = input.statusCheck
    ? runStatusCheck({
        runId: input.runId,
        taskId: input.taskId,
        featureId: input.featureId,
        agentType: "codex",
        dbPath: input.statusCheck.dbPath,
        workspaceRoot: input.statusCheck.workspaceRoot ?? input.policy.workspaceRoot,
        artifactRoot: input.statusCheck.artifactRoot,
        runner: {
          status: status === "completed" ? "completed" : status,
          exitCode: adapterResult.session.exitCode,
          summary: `Codex runner ${status}.`,
          stdout: adapterResult.rawLog.stdout,
          stderr: adapterResult.rawLog.stderr,
          evidence: adapterResult.evidence,
        },
        diff: input.statusCheck.diff,
        commandChecks: input.statusCheck.commandChecks,
        requiredCommandChecks: input.statusCheck.requiredCommandChecks,
        specAlignment: input.statusCheck.specAlignment,
        allowedFiles: input.statusCheck.allowedFiles,
        forbiddenFiles: input.statusCheck.forbiddenFiles,
        failureHistory: input.statusCheck.failureHistory,
        failureThreshold: input.statusCheck.failureThreshold,
        attachments: input.statusCheck.attachments,
      })
    : undefined;
  const finalStatus = statusCheckResult ? queueStatusFromStatusCheck(statusCheckResult.status, status) : status;
  return {
    runId: input.runId,
    status: finalStatus,
    safety,
    adapterResult,
    statusCheckResult,
    evidence: `Codex CLI exited with ${adapterResult.session.exitCode ?? "unknown"}.`,
  };
}

function queueStatusFromStatusCheck(status: StatusDecision, fallback: RunnerQueueStatus): RunnerQueueStatus {
  if (fallback === "failed") return "failed";
  if (status === "done") return "completed";
  if (status === "review_needed" || status === "blocked" || status === "failed") return status;
  return fallback;
}

export function recordRunnerHeartbeat(input: {
  runId: string;
  runnerId: string;
  policy: RunnerPolicy;
  queueStatus: RunnerQueueStatus;
  status?: "online" | "offline";
  message?: string;
  now?: Date;
}): RunnerHeartbeat {
  return {
    id: randomUUID(),
    runId: input.runId,
    runnerId: input.runnerId,
    status: input.status ?? "online",
    sandboxMode: input.policy.sandboxMode,
    approvalPolicy: input.policy.approvalPolicy,
    queueStatus: input.queueStatus,
    message: input.message,
    beatAt: (input.now ?? new Date()).toISOString(),
  };
}

export function buildEvidencePackInput(input: EvidenceInput): {
  runId: string;
  taskId?: string;
  featureId?: string;
  kind: "codex_runner";
  summary: string;
  metadata: Record<string, unknown>;
} {
  return {
    runId: input.runId,
    taskId: input.taskId,
    featureId: input.featureId,
    kind: "codex_runner",
    summary: `Codex run exit=${input.exitCode ?? "unknown"} session=${input.sessionId ?? "none"} events=${input.events.length}`,
    metadata: {
      sessionId: input.sessionId,
      exitCode: input.exitCode,
      eventTypes: input.events.map((event) => event.type).filter(Boolean),
      stdout: input.stdout,
      stderr: input.stderr,
    },
  };
}

export function buildRunnerConsoleSnapshot(input: {
  runnerId: string;
  codexVersion?: string;
  policy: RunnerPolicy;
  heartbeats?: RunnerHeartbeat[];
  queue?: Array<{ runId: string; status: RunnerQueueStatus }>;
  logs?: RawExecutionLog[];
  now?: Date;
}): RunnerConsoleSnapshot {
  const now = input.now ?? new Date();
  const lastHeartbeat = [...(input.heartbeats ?? [])]
    .filter((heartbeat) => heartbeat.runnerId === input.runnerId)
    .sort((a, b) => b.beatAt.localeCompare(a.beatAt))[0];
  const lastHeartbeatAt = lastHeartbeat?.beatAt;
  const heartbeatStale = lastHeartbeatAt
    ? now.getTime() - new Date(lastHeartbeatAt).getTime() > input.policy.heartbeatIntervalSeconds * 2 * 1000
    : true;

  return {
    runnerId: input.runnerId,
    online: lastHeartbeat?.status === "online" && !heartbeatStale,
    lastHeartbeatAt,
    codexVersion: input.codexVersion,
    sandboxMode: input.policy.sandboxMode,
    approvalPolicy: input.policy.approvalPolicy,
    queue: input.queue ?? [],
    recentLogs: [...(input.logs ?? [])]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
      .map((log) => ({ runId: log.runId, stdout: log.stdout, stderr: log.stderr, createdAt: log.createdAt })),
    heartbeatStale,
  };
}

export function persistCodexRunnerArtifacts(
  dbPath: string,
  input: {
    policy: RunnerPolicy;
    heartbeat?: RunnerHeartbeat;
    session?: CodexSessionRecord;
    rawLog?: RawExecutionLog;
  },
): void {
  const statements: SqlStatement[] = [
    {
      sql: `INSERT INTO runner_policies (
        id, run_id, risk, sandbox_mode, approval_policy, model, profile,
        output_schema_json, workspace_root, resume_session_id, heartbeat_interval_seconds, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        risk = excluded.risk,
        sandbox_mode = excluded.sandbox_mode,
        approval_policy = excluded.approval_policy,
        model = excluded.model,
        profile = excluded.profile,
        output_schema_json = excluded.output_schema_json,
        workspace_root = excluded.workspace_root,
        resume_session_id = excluded.resume_session_id,
        heartbeat_interval_seconds = excluded.heartbeat_interval_seconds`,
      params: [
        input.policy.id,
        input.policy.runId,
        input.policy.risk,
        input.policy.sandboxMode,
        input.policy.approvalPolicy,
        input.policy.model,
        input.policy.profile ?? null,
        JSON.stringify(input.policy.outputSchema),
        input.policy.workspaceRoot,
        input.policy.resumeSessionId ?? null,
        input.policy.heartbeatIntervalSeconds,
        input.policy.createdAt,
      ],
    },
  ];

  if (input.heartbeat) {
    statements.push({
      sql: `INSERT INTO runner_heartbeats (
        id, run_id, runner_id, status, sandbox_mode, approval_policy, queue_status, message, beat_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.heartbeat.id,
        input.heartbeat.runId,
        input.heartbeat.runnerId,
        input.heartbeat.status,
        input.heartbeat.sandboxMode,
        input.heartbeat.approvalPolicy,
        input.heartbeat.queueStatus,
        input.heartbeat.message ?? null,
        input.heartbeat.beatAt,
      ],
    });
  }

  if (input.session) {
    statements.push({
      sql: `INSERT INTO codex_session_records (
        id, run_id, session_id, workspace_root, command, args_json, exit_code, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.session.id,
        input.session.runId,
        input.session.sessionId ?? null,
        input.session.workspaceRoot,
        input.session.command,
        JSON.stringify(input.session.args),
        input.session.exitCode,
        input.session.startedAt,
        input.session.completedAt,
      ],
    });
  }

  if (input.rawLog) {
    statements.push({
      sql: `INSERT INTO raw_execution_logs (
        id, run_id, stdout, stderr, events_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        input.rawLog.id,
        input.rawLog.runId,
        input.rawLog.stdout,
        input.rawLog.stderr,
        JSON.stringify(input.rawLog.events),
        input.rawLog.createdAt,
      ],
    });
  }

  runSqlite(dbPath, statements);
}

export function redactLog(value: string): string {
  let redacted = value;
  for (const pattern of ORDINARY_LOG_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "$1[REDACTED]");
  }
  return redacted;
}

function buildCodexArgs(policy: RunnerPolicy, prompt: string, outputSchemaPath: string): string[] {
  if (policy.resumeSessionId) {
    const resumePrompt = [
      prompt,
      "",
      "Continue from the resumed session, but return the final response as JSON matching this schema:",
      JSON.stringify(policy.outputSchema),
      `Schema path for audit: ${outputSchemaPath}`,
    ].join("\n");
    const resumeArgs = [
      "-a",
      policy.approvalPolicy,
      "--sandbox",
      policy.sandboxMode,
    ];
    if (policy.profile) {
      resumeArgs.push("-p", policy.profile);
    }
    resumeArgs.push("exec", "resume", "--json", "-m", policy.model);
    resumeArgs.push(policy.resumeSessionId, resumePrompt);
    return resumeArgs;
  }

  const args = [
    "-a",
    policy.approvalPolicy,
    "exec",
    "--json",
    "--sandbox",
    policy.sandboxMode,
    "--model",
    policy.model,
    "--output-schema",
    outputSchemaPath,
  ];
  if (policy.profile) {
    args.push("--profile", policy.profile);
  }
  args.push(prompt);
  return args;
}

function classifyQueueStatus(result: CodexAdapterResult): RunnerQueueStatus {
  if (result.session.exitCode !== 0) {
    return "failed";
  }

  const reportedStatus = extractReportedStatus(result.rawLog.events);
  if (reportedStatus) {
    return reportedStatus;
  }

  if (result.session.args.includes("resume")) {
    return "review_needed";
  }

  return "completed";
}

function extractReportedStatus(events: CodexJsonEvent[]): RunnerQueueStatus | undefined {
  for (const event of events) {
    const status = typeof event.status === "string" ? event.status : undefined;
    if (status === "review_needed" || status === "blocked" || status === "failed" || status === "completed") {
      return status;
    }

    const output = typeof event.output === "object" && event.output !== null ? event.output as Record<string, unknown> : undefined;
    const outputStatus = typeof output?.status === "string" ? output.status : undefined;
    if (outputStatus === "review_needed" || outputStatus === "blocked" || outputStatus === "failed" || outputStatus === "completed") {
      return outputStatus;
    }
  }
  return undefined;
}

function writeOutputSchema(policy: RunnerPolicy): string {
  const directory = mkdtempSync(join(tmpdir(), "specdrive-codex-schema-"));
  const path = join(directory, `${policy.runId}.schema.json`);
  writeFileSync(path, JSON.stringify(policy.outputSchema, null, 2));
  return path;
}

function redactEvent(event: CodexJsonEvent): CodexJsonEvent {
  return redactJsonValue(event) as CodexJsonEvent;
}

function redactJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactLog(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactJsonValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactJsonValue(entry)]));
  }
  return value;
}

function parseJsonEvents(stdout: string): CodexJsonEvent[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as CodexJsonEvent];
      } catch {
        return [];
      }
    });
}

function clampHeartbeat(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(30, Math.max(10, Math.round(value)));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  heartbeatIntervalSeconds: number,
  onHeartbeat?: () => void,
): Promise<CodexCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const heartbeat = onHeartbeat
      ? setInterval(onHeartbeat, Math.max(10, heartbeatIntervalSeconds) * 1000)
      : undefined;

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (heartbeat) clearInterval(heartbeat);
      resolve({
        status: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error,
      });
    });
    child.on("close", (code) => {
      if (heartbeat) clearInterval(heartbeat);
      resolve({
        status: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
