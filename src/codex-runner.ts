import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize as normalizeFilePath } from "node:path";
import { ORDINARY_LOG_SECRET_PATTERNS } from "./persistence.ts";
import {
  buildFailureFingerprint,
  buildRecoveryDispatchInput,
  buildRecoveryTask,
  listRecoveryHistory,
  persistRecoveryAttempt,
  persistRecoveryResultHandling,
  type RecoveryDispatchInput,
  type ForbiddenRetryRecord,
  type RecoveryAttempt,
  type RecoveryResultHandling,
  type RecoveryTask,
} from "./recovery.ts";
import { runSqlite, type SqlStatement } from "./sqlite.ts";
import type { RiskLevel } from "./orchestration.ts";
import type { TestRunnerIsolationInput, WorktreeRecord } from "./workspace.ts";
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
export type RunnerReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type RunnerQueueStatus = "queued" | "running" | "completed" | "review_needed" | "blocked" | "failed";

export type RunnerPolicy = {
  id: string;
  runId: string;
  risk: RiskLevel;
  sandboxMode: RunnerSandboxMode;
  approvalPolicy: RunnerApprovalPolicy;
  model: string;
  reasoningEffort: RunnerReasoningEffort;
  profile?: string;
  outputSchema: Record<string, unknown>;
  workspaceRoot: string;
  testEnvironmentIsolation?: TestRunnerIsolationInput;
  resumeSessionId?: string;
  heartbeatIntervalSeconds: number;
  commandTimeoutMs: number;
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
  files?: CliInvocationLogFiles;
  createdAt: string;
};

export type CodexJsonEvent = {
  type?: string;
  session_id?: string;
  [key: string]: unknown;
};

export type CliAdapterStatus = "draft" | "active" | "disabled" | "invalid";

export type CliAdapterConfig = {
  id: string;
  displayName: string;
  schemaVersion: number;
  executable: string;
  argumentTemplate: string[];
  resumeArgumentTemplate?: string[];
  configSchema: Record<string, unknown>;
  formSchema: Record<string, unknown>;
  defaults: {
    model?: string;
    reasoningEffort?: RunnerReasoningEffort;
    reasoning_effort?: RunnerReasoningEffort;
    profile?: string;
    sandbox?: RunnerSandboxMode;
    approval?: RunnerApprovalPolicy;
  };
  environmentAllowlist: string[];
  outputMapping: {
    eventStream: "json";
    evidenceSchema: string;
    sessionIdPath: string;
  };
  status: CliAdapterStatus;
  updatedAt: string;
};

export type CliAdapterValidationResult = {
  valid: boolean;
  errors: string[];
  command?: string;
  args?: string[];
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
  testEnvironmentIsolation?: TestRunnerIsolationInput;
  skillInvocation?: SkillInvocationContract;
  logFiles?: CliInvocationLogFiles;
};

export type CliInvocationLogFiles = {
  input: string;
  output: string;
  stdout: string;
  stderr: string;
};

export type RunnerPolicyInput = {
  runId: string;
  risk: RiskLevel;
  taskType?: string;
  workspaceRoot: string;
  model?: string;
  reasoningEffort?: RunnerReasoningEffort;
  profile?: string;
  outputSchema?: Record<string, unknown>;
  resumeSessionId?: string;
  requestedSandboxMode?: RunnerSandboxMode;
  requestedApprovalPolicy?: RunnerApprovalPolicy;
  testEnvironmentIsolation?: TestRunnerIsolationInput;
  heartbeatIntervalSeconds?: number;
  commandTimeoutMs?: number;
  now?: Date;
};

export type SafetyGateInput = {
  policy: RunnerPolicy;
  prompt?: string;
  files?: string[];
  commands?: string[];
  taskText?: string;
  skillInvocation?: SkillInvocationContract;
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
  imagePaths?: string[];
  adapterConfig?: CliAdapterConfig;
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
  adapterConfig?: CliAdapterConfig;
  recoveryDispatcher?: (dispatch: RecoveryDispatch) => void | Promise<void>;
  skillInvocation?: SkillInvocationContract;
};

export type SkillInvocationContract = {
  projectId: string;
  workspaceRoot: string;
  skillSlug: string;
  sourcePaths: string[];
  imagePaths?: string[];
  expectedArtifacts: string[];
  traceability: {
    featureId?: string;
    taskId?: string;
    requirementIds: string[];
    changeIds: string[];
  };
  requestedAction: string;
};

export type WorkspaceValidationResult = {
  valid: boolean;
  workspaceRoot?: string;
  blockedReasons: string[];
};

export type RecoveryDispatch = {
  scheduledAt: string;
  policy: RunnerPolicy;
  dispatchInput: RecoveryDispatchInput;
};

export type PersistedRecoveryDispatch = RecoveryDispatch & {
  dispatchId: string;
  status: "running";
};

export type RecoveryDispatchRunner = (dispatch: PersistedRecoveryDispatch) => Promise<void> | void;

export type RunnerQueueWorkerResult = {
  runId: string;
  status: RunnerQueueStatus;
  safety: SafetyGateResult;
  adapterResult?: CodexAdapterResult;
  statusCheckResult?: StatusCheckResult;
  recoveryTask?: RecoveryTask;
  recoveryDispatchInput?: RecoveryDispatchInput;
  recoverySafety?: SafetyGateResult;
  recoveryDispatch?: RecoveryDispatch;
  evidence: string;
};

export type RunnerStatusCheckInput = {
  dbPath?: string;
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
  recoveryAttempts?: RecoveryAttempt[];
  forbiddenRetryItems?: ForbiddenRetryRecord[];
  recoveryResult?: RecoveryResultHandling;
  testEnvironmentIsolation?: TestRunnerIsolationInput;
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

const DEFAULT_MODEL = "gpt-5.3-codex-spark";
const DEFAULT_REASONING_EFFORT: RunnerReasoningEffort = "medium";
const DEFAULT_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_CLI_ADAPTER_CONFIG: CliAdapterConfig = {
  id: "codex-cli",
  displayName: "Codex CLI",
  schemaVersion: 1,
  executable: "codex",
  argumentTemplate: [
    "-a",
    "{{approval}}",
    "-c",
    "model_reasoning_effort=\"{{reasoning_effort}}\"",
    "--cd",
    "{{workspace}}",
    "exec",
    "--json",
    "--sandbox",
    "{{sandbox}}",
    "--model",
    "{{model}}",
    "--output-schema",
    "{{output_schema}}",
    "{{prompt}}",
  ],
  resumeArgumentTemplate: [
    "-a",
    "{{approval}}",
    "--sandbox",
    "{{sandbox}}",
    "-c",
    "model_reasoning_effort=\"{{reasoning_effort}}\"",
    "--cd",
    "{{workspace}}",
    "{{profile_flag}}",
    "{{profile}}",
    "exec",
    "resume",
    "--json",
    "-m",
    "{{model}}",
    "{{resume_session_id}}",
    "{{resume_prompt}}",
  ],
  configSchema: {
    type: "object",
    required: ["id", "executable", "argumentTemplate", "outputMapping"],
  },
  formSchema: {
    fields: [
      { path: "executable", label: "Executable", type: "text" },
      { path: "argumentTemplate", label: "Arguments", type: "list" },
      { path: "defaults.model", label: "Default model", type: "text" },
      { path: "defaults.reasoningEffort", label: "Default reasoning effort", type: "select" },
      { path: "defaults.sandbox", label: "Sandbox", type: "select" },
      { path: "defaults.approval", label: "Approval", type: "select" },
      { path: "outputMapping.sessionIdPath", label: "Session id path", type: "text" },
    ],
  },
  defaults: {
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    sandbox: "workspace-write",
    approval: "never",
  },
  environmentAllowlist: [],
  outputMapping: {
    eventStream: "json",
    evidenceSchema: "evidence.schema.json",
    sessionIdPath: "session_id",
  },
  status: "active",
  updatedAt: new Date(0).toISOString(),
};
const DEFAULT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
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
  const commandTimeoutMs = clampCommandTimeout(input.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);

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
    reasoningEffort: input.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    profile: input.profile,
    outputSchema: input.outputSchema ?? DEFAULT_OUTPUT_SCHEMA,
    workspaceRoot: input.workspaceRoot,
    testEnvironmentIsolation: input.testEnvironmentIsolation,
    resumeSessionId: input.resumeSessionId,
    heartbeatIntervalSeconds,
    commandTimeoutMs,
    createdAt: now.toISOString(),
  };
}

export function buildRunnerPolicyFromContract(input: {
  runId: string;
  risk: RiskLevel;
  workspace: Pick<WorktreeRecord, "path">;
  outputSchema?: Record<string, unknown>;
  resumeSessionId?: string;
  testEnvironmentIsolation?: TestRunnerIsolationInput;
  now?: Date;
}): RunnerPolicy {
  return resolveRunnerPolicy({
    runId: input.runId,
    risk: input.risk,
    workspaceRoot: input.workspace.path,
    outputSchema: input.outputSchema,
    resumeSessionId: input.resumeSessionId,
    testEnvironmentIsolation: input.testEnvironmentIsolation,
    now: input.now,
  });
}

export function evaluateRunnerSafety(input: SafetyGateInput): SafetyGateResult {
  const reasons: string[] = [];
  const directWrite = isTrustedDirectWriteInvocation(input.skillInvocation, input.files);
  if (input.policy.sandboxMode === "danger-full-access" && !directWrite) {
    reasons.push("danger-full-access sandbox requires a trusted project skill with bounded write scope");
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

  const safetyText = [input.taskText, input.prompt ? stripWorkspaceContextBundle(input.prompt) : undefined].filter(Boolean).join("\n");
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

export function isTrustedDocsDirectWriteInvocation(invocation?: SkillInvocationContract): boolean {
  return isTrustedDirectWriteInvocation(invocation);
}

export function isTrustedDirectWriteInvocation(invocation?: SkillInvocationContract, allowedFiles: string[] = []): boolean {
  if (!invocation) return false;
  if (!isSafeSkillSlug(invocation.skillSlug)) return false;

  const safeAllowedFiles = allowedFiles.filter(isSafeWorkspaceWritePath);
  if (invocation.skillSlug === "codex-coding-skill") {
    return safeAllowedFiles.length > 0 && safeAllowedFiles.length === allowedFiles.length;
  }

  const safeArtifacts = invocation.expectedArtifacts.filter(isSafeExpectedArtifactPath);
  return safeArtifacts.length > 0 && safeArtifacts.length === invocation.expectedArtifacts.length;
}

function stripWorkspaceContextBundle(prompt: string): string {
  const marker = "Workspace Context Bundle:";
  const index = prompt.indexOf(marker);
  return index >= 0 ? prompt.slice(0, index) : prompt;
}

export function normalizeCliAdapterConfig(input: Partial<CliAdapterConfig> | Record<string, unknown>): CliAdapterConfig {
  const defaults = isRecord(input.defaults) ? input.defaults : {};
  const outputMapping = isRecord(input.outputMapping) ? input.outputMapping : {};
  return {
    ...DEFAULT_CLI_ADAPTER_CONFIG,
    id: optionalConfigString(input.id) ?? DEFAULT_CLI_ADAPTER_CONFIG.id,
    displayName: optionalConfigString(input.displayName) ?? optionalConfigString(input.display_name) ?? DEFAULT_CLI_ADAPTER_CONFIG.displayName,
    schemaVersion: Number(input.schemaVersion ?? input.schema_version ?? DEFAULT_CLI_ADAPTER_CONFIG.schemaVersion),
    executable: optionalConfigString(input.executable) ?? DEFAULT_CLI_ADAPTER_CONFIG.executable,
    argumentTemplate: stringArray(input.argumentTemplate ?? input.argument_template, DEFAULT_CLI_ADAPTER_CONFIG.argumentTemplate),
    resumeArgumentTemplate: stringArray(input.resumeArgumentTemplate ?? input.resume_argument_template, DEFAULT_CLI_ADAPTER_CONFIG.resumeArgumentTemplate ?? []),
    configSchema: isRecord(input.configSchema) ? input.configSchema : isRecord(input.config_schema) ? input.config_schema : DEFAULT_CLI_ADAPTER_CONFIG.configSchema,
    formSchema: isRecord(input.formSchema) ? input.formSchema : isRecord(input.form_schema) ? input.form_schema : DEFAULT_CLI_ADAPTER_CONFIG.formSchema,
    defaults: {
      model: optionalConfigString(defaults.model) ?? DEFAULT_CLI_ADAPTER_CONFIG.defaults.model,
      reasoningEffort: normalizeReasoningEffort(defaults.reasoningEffort ?? defaults.reasoning_effort) ?? DEFAULT_CLI_ADAPTER_CONFIG.defaults.reasoningEffort,
      profile: optionalConfigString(defaults.profile),
      sandbox: normalizeSandbox(defaults.sandbox) ?? DEFAULT_CLI_ADAPTER_CONFIG.defaults.sandbox,
      approval: normalizeApproval(defaults.approval) ?? DEFAULT_CLI_ADAPTER_CONFIG.defaults.approval,
    },
    environmentAllowlist: stringArray(input.environmentAllowlist ?? input.environment_allowlist, []),
    outputMapping: {
      eventStream: outputMapping.eventStream === "json" || outputMapping.event_stream === "json" ? "json" : DEFAULT_CLI_ADAPTER_CONFIG.outputMapping.eventStream,
      evidenceSchema: optionalConfigString(outputMapping.evidenceSchema) ?? optionalConfigString(outputMapping.evidence_schema) ?? DEFAULT_CLI_ADAPTER_CONFIG.outputMapping.evidenceSchema,
      sessionIdPath: optionalConfigString(outputMapping.sessionIdPath) ?? optionalConfigString(outputMapping.session_id_path) ?? DEFAULT_CLI_ADAPTER_CONFIG.outputMapping.sessionIdPath,
    },
    status: normalizeAdapterStatus(input.status) ?? DEFAULT_CLI_ADAPTER_CONFIG.status,
    updatedAt: optionalConfigString(input.updatedAt) ?? optionalConfigString(input.updated_at) ?? new Date().toISOString(),
  };
}

export function validateCliAdapterConfig(config: CliAdapterConfig): CliAdapterValidationResult {
  const errors: string[] = [];
  if (!config.id.trim()) errors.push("id is required");
  if (!config.executable.trim()) errors.push("executable is required");
  if (config.status === "disabled") errors.push("adapter is disabled");
  if (config.status === "invalid") errors.push("adapter status is invalid");
  if (!Number.isInteger(config.schemaVersion) || config.schemaVersion < 1) errors.push("schemaVersion must be a positive integer");
  if (config.argumentTemplate.length === 0) errors.push("argumentTemplate must contain at least one argument");
  if (!config.argumentTemplate.some((entry) => entry.includes("{{prompt}}"))) errors.push("argumentTemplate must include {{prompt}}");
  if (!config.argumentTemplate.some((entry) => entry.includes("{{output_schema}}"))) errors.push("argumentTemplate must include {{output_schema}}");
  if (config.outputMapping.eventStream !== "json") errors.push("outputMapping.eventStream must be json");
  if (!config.outputMapping.sessionIdPath.trim()) errors.push("outputMapping.sessionIdPath is required");
  if (config.defaults.sandbox === "danger-full-access") errors.push("default sandbox may not be danger-full-access");
  if (config.defaults.approval === "bypass") errors.push("default approval may not bypass approvals");
  if (!normalizeReasoningEffort(config.defaults.reasoningEffort)) errors.push("default reasoning effort must be low, medium, high, or xhigh");
  return { valid: errors.length === 0, errors };
}

export function dryRunCliAdapterConfig(input: {
  config: CliAdapterConfig;
  policy?: RunnerPolicy;
  prompt?: string;
  outputSchemaPath?: string;
}): CliAdapterValidationResult {
  const validation = validateCliAdapterConfig(input.config);
  if (!validation.valid) {
    return validation;
  }
  try {
    const rendered = renderCliAdapterCommand({
      config: input.config,
      policy: input.policy ?? resolveRunnerPolicy({
        runId: "DRY-RUN",
        risk: "low",
        workspaceRoot: "/workspace/project",
        now: new Date(0),
      }),
      prompt: input.prompt ?? "Dry-run prompt",
      outputSchemaPath: input.outputSchemaPath ?? "/tmp/evidence.schema.json",
    });
    return { valid: true, errors: [], command: rendered.command, args: rendered.args };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function renderCliAdapterCommand(input: {
  config?: CliAdapterConfig;
  policy: RunnerPolicy;
  prompt: string;
  outputSchemaPath: string;
  imagePaths?: string[];
}): { command: string; args: string[] } {
  const config = input.config ?? DEFAULT_CLI_ADAPTER_CONFIG;
  const validation = validateCliAdapterConfig(config);
  if (!validation.valid) {
    throw new Error(`CLI Adapter ${config.id} is invalid: ${validation.errors.join("; ")}`);
  }
  const template = input.policy.resumeSessionId && config.resumeArgumentTemplate?.length
    ? config.resumeArgumentTemplate
    : config.argumentTemplate;
  const values = {
    approval: input.policy.approvalPolicy,
    sandbox: input.policy.sandboxMode,
    model: input.policy.model,
    reasoning_effort: input.policy.reasoningEffort,
    profile: input.policy.profile ?? "",
    profile_flag: input.policy.profile ? "-p" : "",
    output_schema: input.outputSchemaPath,
    workspace: input.policy.workspaceRoot,
    prompt: input.prompt,
    resume_session_id: input.policy.resumeSessionId ?? "",
    resume_prompt: buildResumePrompt(input.policy, input.prompt, input.outputSchemaPath),
  };
  const rendered = template
    .map((entry) => renderTemplateEntry(entry, values))
    .filter((entry) => entry.length > 0);
  if (rendered.some((arg) => /{{[^}]+}}/.test(arg))) {
    throw new Error("CLI Adapter command contains unresolved template variables");
  }
  // Terminate the variadic --image values so the final positional prompt is not consumed as another image path.
  const imageFlags: string[] = (input.imagePaths ?? []).flatMap((p) => ["-i", p]);
  const args = imageFlags.length
    ? [...rendered.slice(0, -1), ...imageFlags, "--", rendered[rendered.length - 1]]
    : rendered;
  return { command: config.executable, args };
}

export function validateWorkspaceRoot(workspaceRoot: string | undefined): WorkspaceValidationResult {
  const blockedReasons: string[] = [];
  const trimmed = workspaceRoot?.trim();
  if (!trimmed) {
    return { valid: false, blockedReasons: ["Project workspace root is required."] };
  }
  try {
    const stat = statSync(trimmed);
    if (!stat.isDirectory()) {
      blockedReasons.push(`Project workspace root is not a directory: ${trimmed}`);
    }
    accessSync(trimmed, constants.R_OK | constants.X_OK);
  } catch {
    blockedReasons.push(`Project workspace root is missing or unreadable: ${trimmed}`);
  }

  const skillsPath = join(trimmed, ".agents", "skills");
  try {
    const stat = statSync(skillsPath);
    if (!stat.isDirectory()) {
      blockedReasons.push(`Project workspace skills directory is not a directory: ${skillsPath}`);
    }
    accessSync(skillsPath, constants.R_OK | constants.X_OK);
  } catch {
    blockedReasons.push(`Project workspace is missing readable .agents/skills: ${skillsPath}`);
  }

  const agentsPath = join(trimmed, "AGENTS.md");
  try {
    const stat = statSync(agentsPath);
    if (!stat.isFile()) {
      blockedReasons.push(`Project workspace AGENTS.md is not a file: ${agentsPath}`);
    }
    accessSync(agentsPath, constants.R_OK);
  } catch {
    blockedReasons.push(`Project workspace is missing readable AGENTS.md: ${agentsPath}`);
  }

  return { valid: blockedReasons.length === 0, workspaceRoot: trimmed, blockedReasons };
}

export function buildSkillInvocationPrompt(contract: SkillInvocationContract, context: string): string {
  const taskSlicingRules = contract.skillSlug === "task-slicing-skill"
    ? [
        "- For split_feature_specs, decompose PRD, EARS requirements, and HLD into implementation-ready Feature Spec package directories.",
        "- Do not treat .autobuild/specs/FEAT-INTAKE-*.json as a Feature Spec package; it is only an intake artifact.",
        "- Write Feature Spec packages under docs/features/<feature-id>/ with requirements.md, design.md, tasks.md, and update docs/features/README.md.",
      ]
    : [];
  return [
    "Execute this SpecDrive CLI skill invocation inside the current workspace.",
    "",
    "Skill Invocation Contract:",
    JSON.stringify(contract, null, 2),
    "",
    "Rules:",
    "- Use only skills discovered from this workspace's .agents/skills directory.",
    "- Treat AGENTS.md and the referenced source paths as governing context.",
    "- If the prompt includes a Workspace Context Bundle, use it as already-read workspace evidence; do not block solely because shell-based file reads fail.",
    "- Produce the expected artifacts and include traceability in the final evidence.",
    "- Prefer writing expected artifacts directly to the workspace paths named in the contract.",
    "- If direct file writes fail, return each complete artifact as one evidence string using exactly: ARTIFACT: <relative-path> followed by a markdown fenced block containing the full file content.",
    "- Do not assume a platform Skill Registry or Skill Center exists.",
    ...taskSlicingRules,
    "",
    "Context:",
    context,
  ].join("\n");
}

export async function runCodexCli(input: CodexAdapterInput): Promise<CodexAdapterResult> {
  const now = input.now ?? new Date();
  const shouldCleanupOutputSchema = !input.outputSchemaPath;
  const outputSchemaPath = input.outputSchemaPath ?? writeOutputSchema(input.policy);
  const rendered = renderCliAdapterCommand({
    config: input.adapterConfig,
    policy: input.policy,
    prompt: input.prompt,
    outputSchemaPath,
    imagePaths: input.imagePaths,
  });
  const logFiles = writeCliInputLog({
    policy: input.policy,
    prompt: input.prompt,
    taskId: input.taskId,
    featureId: input.featureId,
    command: rendered.command,
    args: rendered.args,
    outputSchemaPath,
    imagePaths: input.imagePaths,
    skillInvocation: input.skillInvocation,
    createdAt: now.toISOString(),
  });
  try {
    let result: CodexCommandResult;
    try {
      result = input.asyncRunner
        ? await input.asyncRunner(rendered.command, rendered.args, input.policy.workspaceRoot)
        : input.runner
          ? input.runner(rendered.command, rendered.args, input.policy.workspaceRoot)
          : await runCommand(
              rendered.command,
              rendered.args,
              input.policy.workspaceRoot,
              input.policy.heartbeatIntervalSeconds,
              input.policy.commandTimeoutMs,
              input.onHeartbeat,
            );
    } catch (error) {
      writeCliOutputLog(logFiles, {
        status: null,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error : new Error(String(error)),
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
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
      command: rendered.command,
      args: rendered.args.map(redactLog),
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
      files: logFiles,
      createdAt: completedAt,
    };
    materializeArtifactEvidence(input.policy.workspaceRoot, input.skillInvocation, events);
    const completedEvent = events.find((e) => e.type === "turn.completed" && e.usage);
    const usage = completedEvent?.usage as Record<string, number> | undefined;
    writeCliOutputLog(logFiles, {
      status: result.status,
      stdout,
      stderr,
      error: result.error,
      completedAt,
      eventCount: redactedEvents.length,
      sessionId,
      usage,
    });
    const evidence: EvidenceInput = {
      runId: input.policy.runId,
      taskId: input.taskId,
      featureId: input.featureId,
      sessionId,
      exitCode: result.status,
      events: redactedEvents,
      stdout: rawLog.stdout,
      stderr: rawLog.stderr,
      testEnvironmentIsolation: input.policy.testEnvironmentIsolation,
      skillInvocation: input.skillInvocation,
      logFiles,
    };

    return { session, rawLog, evidence };
  } finally {
    if (shouldCleanupOutputSchema) {
      rmSync(dirname(outputSchemaPath), { recursive: true, force: true });
    }
  }
}

function materializeArtifactEvidence(
  workspaceRoot: string,
  invocation: SkillInvocationContract | undefined,
  events: CodexJsonEvent[],
): void {
  if (!invocation) return;
  const expected = new Set(invocation.expectedArtifacts.filter(isMaterializedSpecArtifact));
  if (expected.size === 0) return;

  for (const evidence of extractEvidenceStrings(events)) {
    const artifact = parseArtifactEvidence(evidence);
    if (!artifact || !expected.has(artifact.path)) continue;
    const outputPath = join(workspaceRoot, artifact.path);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, artifact.content, { encoding: "utf8" });
  }
}

function extractEvidenceStrings(events: CodexJsonEvent[]): string[] {
  return events.flatMap((event) => {
    const records: Record<string, unknown>[] = [];
    if (typeof event.output === "object" && event.output !== null) records.push(event.output as Record<string, unknown>);
    if (Array.isArray(event.evidence)) records.push(event as Record<string, unknown>);
    const item = typeof event.item === "object" && event.item !== null ? event.item as Record<string, unknown> : undefined;
    if (typeof item?.text === "string") {
      try {
        const parsed = JSON.parse(item.text) as Record<string, unknown>;
        records.push(parsed);
      } catch {
        // Ignore free-form agent text.
      }
    }
    return records.flatMap((record) => {
      const evidence = Array.isArray(record.evidence) ? record.evidence.filter((value): value is string => typeof value === "string") : [];
      const summary = typeof record.summary === "string" ? [record.summary] : [];
      return [...evidence, ...summary];
    });
  });
}

function parseArtifactEvidence(evidence: string): { path: string; content: string } | undefined {
  const match = evidence.match(/^ARTIFACT:\s*([^\n]+)\n```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/);
  if (!match) return undefined;
  const path = normalizePath(match[1].trim());
  if (!path || path.startsWith("../") || path.startsWith("/") || path.includes("<")) return undefined;
  return { path, content: match[2].endsWith("\n") ? match[2] : `${match[2]}\n` };
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
    imagePaths: input.skillInvocation?.imagePaths,
    adapterConfig: input.adapterConfig,
    skillInvocation: input.skillInvocation,
    runner,
    onHeartbeat,
  });
  const status = classifyQueueStatus(adapterResult);
  const testEnvironmentIsolation = input.statusCheck?.testEnvironmentIsolation ?? input.policy.testEnvironmentIsolation;
  let statusCheckResult = input.statusCheck
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
          evidence: { ...adapterResult.evidence, testEnvironmentIsolation },
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
  if (input.statusCheck?.recoveryResult && input.statusCheck.dbPath) {
    try {
      persistRecoveryResultHandling(input.statusCheck.dbPath, input.statusCheck.recoveryResult);
    } catch (error) {
      if (statusCheckResult) {
        statusCheckResult = recoveryPersistenceFailureResult(statusCheckResult, error);
        persistRecoveryPersistenceFailureStatus(input, statusCheckResult);
      } else {
        throw error;
      }
    }
  }
  let shouldRecover = statusCheckResult ? shouldCreateRecoveryTask(statusCheckResult) : false;
  const recoveryTaskId = statusCheckResult && shouldRecover
    ? recoverableTaskId(input.taskId ?? statusCheckResult.taskId, input.policy.workspaceRoot)
    : undefined;
  const recoveryHistoryTaskId = traceableRecoveryTaskId(recoveryTaskId);
  const recoveryHistoryFingerprintId = statusCheckResult && shouldRecover
    ? buildFailureFingerprint({ taskId: recoveryTaskId, statusCheckResult, relatedFiles: input.files }).id
    : undefined;
  let recoveryHistory = { attempts: input.statusCheck?.recoveryAttempts ?? [], forbiddenRetryItems: input.statusCheck?.forbiddenRetryItems ?? [] };
  if (statusCheckResult && shouldRecover) {
    try {
      recoveryHistory = mergeRecoveryHistory(
        recoveryHistoryTaskId && input.statusCheck.dbPath
          ? listRecoveryHistory(input.statusCheck.dbPath, { taskId: recoveryHistoryTaskId })
          : { attempts: [], forbiddenRetryItems: [] },
        recoveryHistory,
      );
    } catch (error) {
      statusCheckResult = recoveryPersistenceFailureResult(statusCheckResult, error);
      persistRecoveryPersistenceFailureStatus(input, statusCheckResult);
      shouldRecover = false;
    }
  }
  if (recoveryHistoryFingerprintId && hasActiveDispatcherBlockedAttempt(recoveryHistory.attempts, recoveryHistoryFingerprintId)) {
    shouldRecover = false;
  }
  const recoveryTask = statusCheckResult && shouldRecover
    ? buildRecoveryTask({
        taskId: recoveryTaskId,
        featureId: input.featureId,
        statusCheckResult,
        failureStage: "status_check",
        recoverable: shouldRecover,
        dangerousOperation: input.policy.risk === "high" ||
          statusCheckResult.status === "review_needed" ||
          hasHighRiskFailedCommand(statusCheckResult) ||
          hasHighRiskRecoveryFiles(statusCheckResult) ||
          !recoveryHistoryTaskId,
        relatedFiles: input.files,
        historicalAttempts: recoveryHistory.attempts,
        forbiddenRetryItems: recoveryHistory.forbiddenRetryItems,
      })
    : undefined;
  const recoveryDispatchInput = recoveryTask ? buildRecoveryDispatchInput(recoveryTask) : undefined;
  const recoveryPolicy = recoveryTask
    ? {
        ...input.policy,
        id: randomUUID(),
        runId: `${input.runId}:recovery:${recoveryTask.id}`,
        resumeSessionId: adapterResult.session.sessionId ?? input.policy.resumeSessionId,
        createdAt: new Date().toISOString(),
      }
    : undefined;
  const recoverySafety = recoveryTask && recoveryPolicy && recoveryDispatchInput
    ? evaluateRunnerSafety({
        policy: recoveryPolicy,
        files: recoveryTask.proposedFileScope ?? recoveryTask.relatedFiles,
        commands: recoveryTask.proposedCommand ? [recoveryTask.proposedCommand] : [],
        taskText: `failure recovery action ${recoveryTask.requestedAction}`,
      })
    : undefined;
  let recoveryDispatch: RunnerQueueWorkerResult["recoveryDispatch"];
  let recoveryPersistenceBlocked = false;
  if (recoveryTask?.retrySchedule?.status === "scheduled" && recoverySafety && !recoverySafety.allowed) {
    try {
      if (input.statusCheck.dbPath) {
        persistRecoveryAttempt(input.statusCheck.dbPath, buildSafetyBlockedRecoveryAttempt(recoveryTask, recoverySafety));
      }
    } catch (error) {
      if (statusCheckResult) {
        statusCheckResult = recoveryPersistenceFailureResult(statusCheckResult, error);
        persistRecoveryPersistenceFailureStatus(input, statusCheckResult);
        recoveryPersistenceBlocked = true;
      } else {
        throw error;
      }
    }
  }
  const shouldDispatchRecovery = !recoveryPersistenceBlocked &&
    recoveryTask &&
    recoveryPolicy &&
    recoveryDispatchInput &&
    recoverySafety?.allowed &&
    input.statusCheck.dbPath &&
    shouldEnqueueRecoveryTask(recoveryTask);
  if (shouldDispatchRecovery) {
    const recoveryDispatcher = input.recoveryDispatcher ?? createDefaultRecoveryDispatcher(input.statusCheck.dbPath!);
    try {
      recoveryDispatch = {
        scheduledAt: recoveryTask.retrySchedule!.scheduledAt!,
        policy: recoveryPolicy,
        dispatchInput: recoveryDispatchInput,
      };
      if (recoveryTask.retrySchedule?.status === "scheduled" && input.statusCheck.dbPath) {
        persistRecoveryAttempt(input.statusCheck.dbPath, buildScheduledRecoveryAttempt(recoveryTask));
      }
      await recoveryDispatcher(recoveryDispatch);
    } catch (error) {
      if (recoveryTask.retrySchedule?.status === "scheduled") {
        try {
          persistRecoveryAttempt(input.statusCheck.dbPath, buildDispatchBlockedRecoveryAttempt(recoveryTask, error));
        } catch {
          // The status-check result below still reports the dispatch persistence failure.
        }
      }
      if (statusCheckResult) {
        statusCheckResult = recoveryDispatchFailureResult(statusCheckResult, error);
        persistRecoveryPersistenceFailureStatus(input, statusCheckResult);
        recoveryDispatch = undefined;
      } else {
        throw error;
      }
    }
  }
  if (!recoveryPersistenceBlocked && recoveryTask && input.statusCheck?.dbPath && shouldRecordRoutedRecoveryTask(recoveryTask)) {
    try {
      persistRecoveryAttempt(input.statusCheck.dbPath, buildRoutedRecoveryAttempt(recoveryTask));
    } catch (error) {
      if (statusCheckResult) {
        statusCheckResult = recoveryPersistenceFailureResult(statusCheckResult, error);
        persistRecoveryPersistenceFailureStatus(input, statusCheckResult);
        recoveryPersistenceBlocked = true;
      } else {
        throw error;
      }
    }
  }
  const finalStatus = statusCheckResult ? queueStatusFromStatusCheck(statusCheckResult.status, status) : status;
  return {
    runId: input.runId,
    status: finalStatus,
    safety,
    adapterResult,
    statusCheckResult,
    recoveryTask,
    recoveryDispatchInput,
    recoverySafety,
    recoveryDispatch,
    evidence: `Codex CLI exited with ${adapterResult.session.exitCode ?? "unknown"}.`,
  };
}

function shouldCreateRecoveryTask(statusCheckResult: StatusCheckResult): boolean {
  if (statusCheckResult.status === "failed") return !isTerminalStatusCheckFailure(statusCheckResult) && !isInfrastructureBlockedStatus(statusCheckResult);
  if (statusCheckResult.status === "review_needed") return hasFailureSignal(statusCheckResult) || statusCheckResult.specAlignment?.aligned === false;
  if (statusCheckResult.status !== "blocked") return false;
  return !isInfrastructureBlockedStatus(statusCheckResult);
}

function shouldEnqueueRecoveryTask(recoveryTask: RecoveryTask): boolean {
  if (recoveryTask.route !== "automatic" || !recoveryTask.retrySchedule?.scheduledAt) return false;
  if (recoveryTask.retrySchedule.status === "scheduled") return true;
  return false;
}

function shouldRecordRoutedRecoveryTask(recoveryTask: RecoveryTask): boolean {
  return recoveryTask.route === "review_needed" || recoveryTask.route === "manual";
}

export function listDueRecoveryDispatches(dbPath: string, now: Date = new Date()): PersistedRecoveryDispatch[] {
  const rows = runSqlite(dbPath, [], [
    {
      name: "runs",
      sql: `SELECT id, status, scheduled_at, policy_json, dispatch_input_json FROM recovery_dispatches
        WHERE status IN (?, ?)
        ORDER BY created_at, id`,
      params: ["queued", "scheduled"],
    },
  ]).queries.runs;
  const due: PersistedRecoveryDispatch[] = [];
  const dueIds: string[] = [];
  for (const row of rows) {
    const dispatch = parseRecoveryDispatchRow(row);
    if (!dispatch) continue;
    const status = String(row.status);
    if (status === "scheduled" && new Date(dispatch.scheduledAt).getTime() > now.getTime()) continue;
    due.push({
      dispatchId: String(row.id),
      status: "running",
      scheduledAt: dispatch.scheduledAt,
      policy: dispatch.policy,
      dispatchInput: dispatch.dispatchInput,
    });
    dueIds.push(String(row.id));
  }
  if (dueIds.length) {
    runSqlite(dbPath, dueIds.map((id) => ({
      sql: "UPDATE recovery_dispatches SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: ["running", id],
    })));
  }
  return due;
}

export async function runDueRecoveryDispatches(
  dbPath: string,
  runner: RecoveryDispatchRunner,
  now: Date = new Date(),
): Promise<PersistedRecoveryDispatch[]> {
  const dispatches = listDueRecoveryDispatches(dbPath, now);
  for (const dispatch of dispatches) {
    try {
      await runner(dispatch);
      updateRecoveryDispatchStatus(dbPath, dispatch.dispatchId, "completed");
    } catch (error) {
      updateRecoveryDispatchStatus(dbPath, dispatch.dispatchId, "failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  return dispatches;
}

function createDefaultRecoveryDispatcher(dbPath: string): (dispatch: RecoveryDispatch) => void {
  return (dispatch) => {
    const runStatus = new Date(dispatch.scheduledAt).getTime() > Date.now() ? "scheduled" : "queued";
    runSqlite(dbPath, [
      {
        sql: `INSERT INTO recovery_dispatches (id, run_id, status, scheduled_at, policy_json, dispatch_input_json)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            run_id = excluded.run_id,
            status = excluded.status,
            scheduled_at = excluded.scheduled_at,
            policy_json = excluded.policy_json,
            dispatch_input_json = excluded.dispatch_input_json,
            updated_at = CURRENT_TIMESTAMP`,
        params: [
          dispatch.dispatchInput.recovery_task_id,
          dispatch.policy.runId,
          runStatus,
          dispatch.scheduledAt,
          JSON.stringify(dispatch.policy),
          JSON.stringify(dispatch.dispatchInput),
        ],
      },
    ]);
  };
}

function parseRecoveryDispatchRow(row: Record<string, unknown>): RecoveryDispatch | undefined {
  try {
    const scheduledAt = String(row.scheduled_at ?? "");
    if (!scheduledAt) return undefined;
    return {
      scheduledAt,
      policy: JSON.parse(String(row.policy_json ?? "{}")) as RunnerPolicy,
      dispatchInput: JSON.parse(String(row.dispatch_input_json ?? "{}")) as RecoveryDispatchInput,
    };
  } catch {
    return undefined;
  }
}

function updateRecoveryDispatchStatus(dbPath: string, id: string, status: string, output?: string): void {
  runSqlite(dbPath, [
    {
      sql: "UPDATE recovery_dispatches SET status = ?, output_json = COALESCE(?, output_json), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [status, output ? JSON.stringify({ error: output }) : null, id],
    },
  ]);
}

function hasActiveDispatcherBlockedAttempt(attempts: RecoveryAttempt[], fingerprintId: string): boolean {
  return attempts.some((attempt) =>
    attempt.fingerprintId === fingerprintId &&
    attempt.status === "blocked" &&
    /blocked by recovery dispatcher/i.test(attempt.summary) &&
    new Date(attempt.attemptedAt).getTime() + 30 * 60_000 > Date.now()
  );
}

function traceableRecoveryTaskId(taskId?: string): string | undefined {
  if (!taskId || taskId === "unknown-task" || taskId.startsWith("untraceable:")) return undefined;
  return taskId;
}

function recoverableTaskId(taskId: string | undefined, workspaceRoot: string): string {
  if (taskId && taskId !== "unknown-task") return taskId;
  const workspaceKey = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 16);
  return `untraceable:${workspaceKey}`;
}

function evidenceFileName(runId: string, evidencePackId: string): string {
  return `${safeArtifactName(runId)}-${safeArtifactName(evidencePackId)}.json`;
}

function safeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isTerminalStatusCheckFailure(statusCheckResult: StatusCheckResult): boolean {
  return statusCheckResult.reasons.some((reason) => reason.includes("Failure threshold reached"));
}

function mergeRecoveryHistory(
  stored: { attempts: RecoveryAttempt[]; forbiddenRetryItems: ForbiddenRetryRecord[] },
  provided: { attempts: RecoveryAttempt[]; forbiddenRetryItems: ForbiddenRetryRecord[] },
): { attempts: RecoveryAttempt[]; forbiddenRetryItems: ForbiddenRetryRecord[] } {
  return {
    attempts: uniqueById([...stored.attempts, ...provided.attempts]),
    forbiddenRetryItems: uniqueById([...stored.forbiddenRetryItems, ...provided.forbiddenRetryItems]),
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function buildScheduledRecoveryAttempt(recoveryTask: RecoveryTask): RecoveryAttempt {
  return {
    id: recoveryTask.id,
    fingerprintId: recoveryTask.fingerprint.id,
    taskId: recoveryTask.taskId,
    action: recoveryTask.requestedAction,
    strategy: recoveryTask.proposedStrategy ?? recoveryTask.requestedAction,
    command: recoveryTask.proposedCommand,
    fileScope: recoveryTask.proposedFileScope ?? recoveryTask.relatedFiles,
    status: "scheduled",
    summary: `Automatic recovery ${recoveryTask.requestedAction} scheduled for ${recoveryTask.fingerprint.id}.`,
    attemptedAt: recoveryTask.retrySchedule?.scheduledAt ?? recoveryTask.createdAt,
  };
}

function buildSafetyBlockedRecoveryAttempt(recoveryTask: RecoveryTask, safety: SafetyGateResult): RecoveryAttempt {
  return {
    id: recoveryTask.id,
    fingerprintId: recoveryTask.fingerprint.id,
    taskId: recoveryTask.taskId,
    action: recoveryTask.requestedAction,
    strategy: recoveryTask.proposedStrategy ?? recoveryTask.requestedAction,
    command: recoveryTask.proposedCommand,
    fileScope: recoveryTask.proposedFileScope ?? recoveryTask.relatedFiles,
    status: "blocked",
    summary: `Automatic recovery ${recoveryTask.requestedAction} blocked by runner safety gate: ${safety.reasons.join("; ")}`,
    attemptedAt: new Date().toISOString(),
  };
}

function writeCliInputLog(input: {
  policy: RunnerPolicy;
  prompt: string;
  taskId?: string;
  featureId?: string;
  command: string;
  args: string[];
  outputSchemaPath: string;
  imagePaths?: string[];
  skillInvocation?: SkillInvocationContract;
  createdAt: string;
}): CliInvocationLogFiles {
  const dir = cliRunLogDir(input.policy.workspaceRoot, input.policy.runId);
  const files = cliInvocationLogFiles(input.policy.workspaceRoot, input.policy.runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    files.input,
    `${JSON.stringify(
      {
        runId: input.policy.runId,
        taskId: input.taskId,
        featureId: input.featureId,
        workspaceRoot: input.policy.workspaceRoot,
        command: input.command,
        args: input.args.map(redactLog),
        prompt: redactLog(input.prompt),
        outputSchemaPath: input.outputSchemaPath,
        imagePaths: input.imagePaths,
        policy: {
          sandboxMode: input.policy.sandboxMode,
          approvalPolicy: input.policy.approvalPolicy,
          model: input.policy.model,
          profile: input.policy.profile,
          heartbeatIntervalSeconds: input.policy.heartbeatIntervalSeconds,
          commandTimeoutMs: input.policy.commandTimeoutMs,
        },
        skillInvocation: input.skillInvocation,
        createdAt: input.createdAt,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return files;
}

function writeCliOutputLog(
  files: CliInvocationLogFiles,
  output: {
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
    completedAt: string;
    eventCount?: number;
    sessionId?: string;
    usage?: Record<string, number>;
  },
): void {
  writeFileSync(files.stdout, redactLog(output.stdout), { encoding: "utf8", mode: 0o600 });
  writeFileSync(files.stderr, redactLog([output.stderr, output.error?.message].filter(Boolean).join("\n")), {
    encoding: "utf8",
    mode: 0o600,
  });
  writeFileSync(
    files.output,
    `${JSON.stringify(
      {
        status: output.status,
        sessionId: output.sessionId,
        eventCount: output.eventCount ?? 0,
        usage: output.usage,
        error: output.error
          ? {
              name: output.error.name,
              message: redactLog(output.error.message),
              stack: output.error.stack ? redactLog(output.error.stack) : undefined,
            }
          : undefined,
        stdoutPath: files.stdout,
        stderrPath: files.stderr,
        completedAt: output.completedAt,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function cliInvocationLogFiles(workspaceRoot: string, runId: string): CliInvocationLogFiles {
  const dir = cliRunLogDir(workspaceRoot, runId);
  return {
    input: join(dir, "cli-input.json"),
    output: join(dir, "cli-output.json"),
    stdout: join(dir, "stdout.log"),
    stderr: join(dir, "stderr.log"),
  };
}

function cliRunLogDir(workspaceRoot: string, runId: string): string {
  return join(workspaceRoot, ".autobuild", "runs", sanitizePathSegment(runId));
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-") || "run";
}

function buildDispatchBlockedRecoveryAttempt(recoveryTask: RecoveryTask, error: unknown): RecoveryAttempt {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: recoveryTask.id,
    fingerprintId: recoveryTask.fingerprint.id,
    taskId: recoveryTask.taskId,
    action: recoveryTask.requestedAction,
    strategy: recoveryTask.proposedStrategy ?? recoveryTask.requestedAction,
    command: recoveryTask.proposedCommand,
    fileScope: recoveryTask.proposedFileScope ?? recoveryTask.relatedFiles,
    status: "blocked",
    summary: `Automatic recovery ${recoveryTask.requestedAction} blocked by recovery dispatcher: ${message}`,
    attemptedAt: new Date().toISOString(),
  };
}

function buildRoutedRecoveryAttempt(recoveryTask: RecoveryTask): RecoveryAttempt {
  const routeLabel = recoveryTask.route === "manual" ? "manual approval" : "review";
  return {
    id: recoveryTask.id,
    fingerprintId: recoveryTask.fingerprint.id,
    taskId: recoveryTask.taskId,
    action: recoveryTask.requestedAction,
    strategy: recoveryTask.proposedStrategy ?? recoveryTask.requestedAction,
    command: recoveryTask.proposedCommand,
    fileScope: recoveryTask.proposedFileScope ?? recoveryTask.relatedFiles,
    status: "review_needed",
    summary: `Failure recovery routed to ${routeLabel} for ${recoveryTask.fingerprint.id}.`,
    attemptedAt: recoveryTask.createdAt,
  };
}

function recoveryPersistenceFailureResult(result: StatusCheckResult, error: unknown): StatusCheckResult {
  const message = error instanceof Error ? error.message : String(error);
  const summary = "Status check blocked because recovery history persistence failed.";
  const reasons = [...result.reasons, `Recovery history persistence failed: ${message}`];
  const recommendedActions = [
    "Inspect recovery database configuration and retry the status check.",
    ...result.recommendedActions,
  ];
  const evidenceWriteError = result.evidenceWriteError
    ? `${result.evidenceWriteError}; recovery persistence failed: ${message}`
    : `Recovery persistence failed: ${message}`;
  const evidencePack = {
    ...result.evidencePack,
    status: "blocked" as const,
    summary,
    reasons,
    recommendedActions,
    evidenceWriteError,
  };
  return {
    ...result,
    status: "blocked",
    summary,
    reasons,
    recommendedActions,
    evidencePack,
    evidenceWriteError,
  };
}

function recoveryDispatchFailureResult(result: StatusCheckResult, error: unknown): StatusCheckResult {
  const message = error instanceof Error ? error.message : String(error);
  const summary = "Status check blocked because recovery dispatch scheduling failed.";
  const reasons = [...result.reasons, `Recovery dispatch scheduling failed: ${message}`];
  const recommendedActions = [
    "Inspect recovery dispatcher configuration and retry the status check.",
    ...result.recommendedActions,
  ];
  const evidenceWriteError = result.evidenceWriteError ?? `Recovery dispatch scheduling failed: ${message}`;
  const evidencePack = {
    ...result.evidencePack,
    status: "blocked" as const,
    summary,
    reasons,
    recommendedActions,
    evidenceWriteError,
    metadata: {
      ...result.evidencePack.metadata,
      recoveryDispatchError: message,
    },
  };
  return {
    ...result,
    status: "blocked",
    summary,
    reasons,
    recommendedActions,
    evidenceWriteError,
    evidencePack,
  };
}

function persistRecoveryPersistenceFailureStatus(input: RunnerQueueItem, result: StatusCheckResult): void {
  if (!input.statusCheck?.dbPath) return;
  const evidenceContent = redactLog(JSON.stringify(result.evidencePack, null, 2));
  const evidenceChecksum = createHash("sha256").update(evidenceContent).digest("hex");
  try {
    runSqlite(input.statusCheck.dbPath, [
      {
        sql: `UPDATE status_check_results
          SET status = ?, summary = ?, reasons_json = ?, recommended_actions_json = ?, evidence_write_error = ?
          WHERE id = ?`,
        params: [
          result.status,
          redactLog(result.summary),
          JSON.stringify(result.reasons.map(redactLog)),
          JSON.stringify(result.recommendedActions.map(redactLog)),
          result.evidenceWriteError ?? null,
          result.id,
        ],
      },
      {
        sql: `UPDATE evidence_packs
          SET checksum = ?, summary = ?, metadata_json = ?
          WHERE id = ?`,
        params: [
          evidenceChecksum,
          redactLog(result.summary),
          redactLog(JSON.stringify({ statusCheckerEvidencePack: result.evidencePack })),
          result.evidencePack.id,
        ],
      },
    ]);
  } catch {
    return;
  }

  if (!result.evidencePath) return;
  try {
    const artifactRoot = input.statusCheck.artifactRoot ?? join(input.statusCheck.workspaceRoot ?? input.policy.workspaceRoot, ".autobuild");
    const evidencePath = join(artifactRoot, "evidence", evidenceFileName(input.runId, result.evidencePack.id));
    writeFileSync(evidencePath, evidenceContent, "utf8");
  } catch {
    // The queue result already carries the blocked state; DB persistence is the durable source here.
  }
}

function isInfrastructureBlockedStatus(statusCheckResult: StatusCheckResult): boolean {
  if (statusCheckResult.evidenceWriteError) return true;
  return [statusCheckResult.summary, ...statusCheckResult.reasons].some((text) =>
    /runner output is missing/i.test(text) ||
    /evidence (could not be written|persistence failed|persistence)/i.test(text) ||
    /recovery history persistence failed/i.test(text) ||
    /recovery dispatch scheduling failed/i.test(text)
  );
}

function hasHighRiskFailedCommand(statusCheckResult: StatusCheckResult): boolean {
  return statusCheckResult.evidencePack.commands.some((command) =>
    command.status === "failed" &&
    Boolean(command.command) &&
    [...DANGEROUS_COMMAND_PATTERNS, ...HIGH_RISK_TEXT_PATTERNS].some((pattern) => pattern.test(command.command ?? ""))
  );
}

function hasHighRiskRecoveryFiles(statusCheckResult: StatusCheckResult): boolean {
  return statusCheckResult.evidencePack.diff.files.some((file) =>
    FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(normalizePath(file)))
  );
}

function hasFailureSignal(statusCheckResult: StatusCheckResult): boolean {
  const runner = statusCheckResult.evidencePack.runner;
  return runner.status === "failed" ||
    (runner.exitCode ?? 0) !== 0 ||
    statusCheckResult.evidencePack.commands.some((command) => command.status === "failed");
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
      skillInvocation: input.skillInvocation,
      logFiles: input.logFiles,
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
        id, run_id, risk, sandbox_mode, approval_policy, model, reasoning_effort, profile,
        output_schema_json, workspace_root, resume_session_id, heartbeat_interval_seconds, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        risk = excluded.risk,
        sandbox_mode = excluded.sandbox_mode,
        approval_policy = excluded.approval_policy,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
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
        input.policy.reasoningEffort,
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

function classifyQueueStatus(result: CodexAdapterResult): RunnerQueueStatus {
  if (result.session.exitCode !== 0) {
    return "failed";
  }

  const reportedStatus = extractReportedStatus(result.rawLog.events);
  if (reportedStatus) {
    return reportedStatus;
  }

  if (result.evidence.skillInvocation && missingExpectedArtifacts(result).length > 0) {
    return "failed";
  }

  if (result.session.args.includes("resume")) {
    return "review_needed";
  }

  return "completed";
}

function extractReportedStatus(events: CodexJsonEvent[]): RunnerQueueStatus | undefined {
  for (const event of events) {
    const status = typeof event.status === "string" ? event.status : undefined;
    const normalizedStatus = normalizeQueueStatus(status);
    if (normalizedStatus) return normalizedStatus;

    const output = typeof event.output === "object" && event.output !== null ? event.output as Record<string, unknown> : undefined;
    const outputStatus = typeof output?.status === "string" ? output.status : undefined;
    const normalizedOutputStatus = normalizeQueueStatus(outputStatus);
    if (normalizedOutputStatus) return normalizedOutputStatus;

    const item = typeof event.item === "object" && event.item !== null ? event.item as Record<string, unknown> : undefined;
    const itemStatus = normalizeQueueStatus(typeof item?.status === "string" ? item.status : undefined);
    if (itemStatus) return itemStatus;
    const itemTextStatus = parseReportedStatusFromText(typeof item?.text === "string" ? item.text : undefined);
    if (itemTextStatus) return itemTextStatus;
  }
  return undefined;
}

function normalizeQueueStatus(status?: string): RunnerQueueStatus | undefined {
  return status === "review_needed" || status === "blocked" || status === "failed" || status === "completed"
    ? status
    : undefined;
}

function parseReportedStatusFromText(text?: string): RunnerQueueStatus | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return normalizeQueueStatus(typeof parsed.status === "string" ? parsed.status : undefined);
  } catch {
    return undefined;
  }
}

function missingExpectedArtifacts(result: CodexAdapterResult): string[] {
  const invocation = result.evidence.skillInvocation;
  if (!invocation) return [];
  return invocation.expectedArtifacts.filter((artifact) => {
    if (!isMaterializedSpecArtifact(artifact)) return false;
    return !existsSync(join(invocation.workspaceRoot, artifact));
  });
}

function isMaterializedSpecArtifact(artifact: string): boolean {
  return artifact.startsWith("docs/") && !artifact.includes("<") && !artifact.startsWith("/");
}

function writeOutputSchema(policy: RunnerPolicy): string {
  const directory = mkdtempSync(join(tmpdir(), "specdrive-codex-schema-"));
  const path = join(directory, `${policy.runId}.schema.json`);
  writeFileSync(path, JSON.stringify(policy.outputSchema, null, 2));
  return path;
}

function buildResumePrompt(policy: RunnerPolicy, prompt: string, outputSchemaPath: string): string {
  return [
    prompt,
    "",
    "Continue from the resumed session, but return the final response as JSON matching this schema:",
    JSON.stringify(policy.outputSchema),
    `Schema path for audit: ${outputSchemaPath}`,
  ].join("\n");
}

function renderTemplateEntry(entry: string, values: Record<string, string>): string {
  return entry.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => values[key] ?? `{{${key}}}`);
}

function optionalConfigString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length > 0 ? strings : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSandbox(value: unknown): RunnerSandboxMode | undefined {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access" ? value : undefined;
}

function normalizeApproval(value: unknown): RunnerApprovalPolicy | undefined {
  return value === "untrusted" || value === "on-failure" || value === "on-request" || value === "never" || value === "bypass"
    ? value
    : undefined;
}

function normalizeReasoningEffort(value: unknown): RunnerReasoningEffort | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" ? value : undefined;
}

function normalizeAdapterStatus(value: unknown): CliAdapterStatus | undefined {
  return value === "draft" || value === "active" || value === "disabled" || value === "invalid" ? value : undefined;
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

function clampCommandTimeout(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_COMMAND_TIMEOUT_MS;
  return Math.min(60 * 60 * 1000, Math.max(1000, Math.round(value)));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isSafeSkillSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function isSafeWorkspaceWritePath(value: string): boolean {
  const normalized = normalizePath(normalizeFilePath(value.trim()));
  return normalized.length > 0 &&
    normalized !== "." &&
    normalized !== ".." &&
    !normalized.startsWith("/") &&
    !normalized.startsWith("../") &&
    !normalized.includes("/../") &&
    !FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isSafeExpectedArtifactPath(value: string): boolean {
  const normalized = normalizePath(value.trim());
  return isSafeWorkspaceWritePath(normalized) &&
    (normalized.startsWith("docs/") || normalized.startsWith(".autobuild/evidence/"));
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  heartbeatIntervalSeconds: number,
  commandTimeoutMs: number,
  onHeartbeat?: () => void,
): Promise<CodexCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const heartbeat = onHeartbeat
      ? setInterval(onHeartbeat, Math.max(10, heartbeatIntervalSeconds) * 1000)
      : undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2000).unref();
    }, commandTimeoutMs);

    child.stdin?.end();
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (heartbeat) clearInterval(heartbeat);
      clearTimeout(timeout);
      resolve({
        status: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error,
      });
    });
    child.on("close", (code) => {
      if (heartbeat) clearInterval(heartbeat);
      clearTimeout(timeout);
      resolve({
        status: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error: timedOut ? new Error(`Codex command timed out after ${commandTimeoutMs}ms`) : undefined,
      });
    });
  });
}
