import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables, MIGRATIONS } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  buildExecutionResultInput,
  buildSkillInvocationPrompt,
  buildRunnerConsoleSnapshot,
  cliAdapterConfigToExecutionAdapterConfig,
  DEFAULT_CLI_ADAPTER_CONFIG,
  GEMINI_CLI_ADAPTER_CONFIG,
  dryRunCliAdapterConfig,
  evaluateRunnerSafety,
  listDueRecoveryDispatches,
  normalizeCliAdapterConfig,
  persistCliRunnerArtifacts,
  processRunnerQueueItem,
  recordRunnerHeartbeat,
  redactLog,
  renderCliAdapterCommand,
  resolveRunnerPolicy,
  runCliAdapter,
  runDueRecoveryDispatches,
  validateCliAdapterConfig,
} from "../src/cli-adapter.ts";
import { listStatusCheckResults } from "../src/status-checker.ts";
import { handleRecoveryResult, persistRecoveryResultHandling } from "../src/recovery.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

function skillInvocationContract(overrides: Partial<{
  executionId: string;
  projectId: string;
  workspaceRoot: string;
  operation: string;
  skillSlug: string;
  sourcePaths: string[];
  expectedArtifacts: Array<{ path: string; kind: string; required: boolean }>;
  featureId: string;
  taskId: string;
  requirementIds: string[];
  changeIds: string[];
  requestedAction: string;
}> = {}) {
  return {
    contractVersion: "skill-contract/v1" as const,
    executionId: overrides.executionId ?? "RUN-SKILL",
    projectId: overrides.projectId ?? "project-1",
    workspaceRoot: overrides.workspaceRoot ?? "/workspace/project",
    operation: overrides.operation ?? overrides.requestedAction ?? "generate_ears",
    skillSlug: overrides.skillSlug ?? "pr-ears-requirement-decomposition-skill",
    sourcePaths: overrides.sourcePaths ?? ["docs/PRD.md"],
    expectedArtifacts: overrides.expectedArtifacts ?? [{ path: "docs/requirements.md", kind: "markdown", required: true }],
    traceability: {
      featureId: overrides.featureId,
      taskId: overrides.taskId,
      requirementIds: overrides.requirementIds ?? [],
      changeIds: overrides.changeIds ?? ["CHG-016"],
    },
    constraints: {
      allowedFiles: [],
      risk: "low" as const,
    },
    requestedAction: overrides.requestedAction ?? "generate_ears",
  };
}

function skillOutputEvent(overrides: Partial<{
  executionId: string;
  skillSlug: string;
  requestedAction: string;
  status: "completed" | "review_needed" | "blocked" | "failed";
  summary: string;
  nextAction: string;
  resultSummary: string;
  producedArtifacts: Array<{ path: string; kind: string; status: "created" | "updated" | "unchanged" | "missing" | "skipped" }>;
}> = {}): string {
  const output = {
    contractVersion: "skill-contract/v1",
    executionId: overrides.executionId ?? "RUN-SKILL",
    skillSlug: overrides.skillSlug ?? "pr-ears-requirement-decomposition-skill",
    requestedAction: overrides.requestedAction ?? "generate_ears",
    status: overrides.status ?? "completed",
    summary: overrides.summary ?? "Skill completed.",
    nextAction: "Update spec-state.json and continue.",
    producedArtifacts: overrides.producedArtifacts ?? [{ path: "docs/requirements.md", kind: "markdown", status: "created" }],
    traceability: { requirementIds: [], changeIds: ["CHG-016"] },
  };
  return JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(output) } });
}

function assertStrictSchemaObjects(schema: unknown, path = "$"): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const record = schema as Record<string, unknown>;
  if (record.type === "object") {
    assert.equal(record.additionalProperties, false, `${path} should reject additional properties`);
    const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
      ? record.properties as Record<string, unknown>
      : {};
    const required = Array.isArray(record.required) ? record.required.map(String).sort() : [];
    assert.deepEqual(required, Object.keys(properties).sort(), `${path} required should include every property`);
  }

  const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
    ? record.properties as Record<string, unknown>
    : {};
  for (const [key, value] of Object.entries(properties)) {
    assertStrictSchemaObjects(value, `${path}.properties.${key}`);
  }
  assertStrictSchemaObjects(record.items, `${path}.items`);
}

test("schema includes CLI runner policies, heartbeats, sessions, and logs", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const tables = listTables(dbPath);
  for (const table of ["runner_policies", "runner_heartbeats", "cli_session_records", "codex_session_records", "raw_execution_logs", "cli_adapter_configs"]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }
});

test("schema migrates legacy Codex session records into CLI session records", () => {
  const dbPath = makeDbPath();
  runSqlite(dbPath, [
    {
      sql: `CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      )`,
    },
    {
      sql: "INSERT INTO schema_migrations (version, applied_at, description) VALUES (24, CURRENT_TIMESTAMP, 'pre-cli-session')",
    },
    {
      sql: `CREATE TABLE codex_session_records (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT,
        workspace_root TEXT NOT NULL,
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        exit_code INTEGER,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      )`,
    },
    {
      sql: `INSERT INTO codex_session_records (
        id, run_id, session_id, workspace_root, command, args_json, exit_code, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: ["legacy-session", "RUN-LEGACY", "SESSION-LEGACY", "/workspace", "codex", "[]", 0, stableDate.toISOString(), stableDate.toISOString()],
    },
  ]);

  initializeSchema(dbPath);

  const rows = runSqlite(dbPath, [], [
    { name: "sessions", sql: "SELECT session_id, command, exit_code FROM cli_session_records WHERE id = 'legacy-session'" },
  ]).queries.sessions;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session_id, "SESSION-LEGACY");
  assert.equal(rows[0].command, "codex");
  assert.equal(rows[0].exit_code, 0);
});

test("CLI adapter dry-run validates JSON-managed command templates", () => {
  const result = dryRunCliAdapterConfig({
    config: DEFAULT_CLI_ADAPTER_CONFIG,
    outputSchemaPath: "/tmp/runner-output.schema.json",
    prompt: "Implement bounded task",
  });

  assert.equal(result.valid, true);
  assert.equal(result.command, "codex");
  assert.equal(result.args?.includes("--output-schema"), true);
  assert.equal(result.args?.includes("/tmp/runner-output.schema.json"), true);
});

test("CLI adapter exposes unified execution adapter config", () => {
  const config = cliAdapterConfigToExecutionAdapterConfig(DEFAULT_CLI_ADAPTER_CONFIG);

  assert.equal(config.contractVersion, undefined);
  assert.equal(config.kind, "cli");
  assert.equal(config.provider, "codex-cli");
  assert.equal(config.transport, "process");
  assert.equal(config.defaults.model, "gpt-5.3-codex-spark");
  assert.deepEqual(config.inputMapping.argumentTemplate, DEFAULT_CLI_ADAPTER_CONFIG.argumentTemplate);
});

test("Gemini CLI adapter preset validates and dry-renders headless stream-json command", () => {
  const result = dryRunCliAdapterConfig({
    config: GEMINI_CLI_ADAPTER_CONFIG,
    prompt: "Implement bounded task",
    outputSchemaPath: "/tmp/runner-output.schema.json",
  });

  assert.equal(result.valid, true);
  assert.equal(result.command, "gemini");
  assert.deepEqual(result.args, [
    "--model",
    "gemini-3-pro-preview",
    "--output-format",
    "stream-json",
    "-p",
    "Implement bounded task",
  ]);
  assert.equal(result.args?.includes("--output-schema"), false);
});

test("default SkillOutputContract schema is valid for Codex strict JSON schema", () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-SCHEMA",
    risk: "low",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  const schema = policy.outputSchema as {
    properties: {
      contractVersion: Record<string, unknown>;
      status: Record<string, unknown>;
      producedArtifacts: { items: { required: string[]; properties: { status: Record<string, unknown>; checksum: Record<string, unknown>; summary: Record<string, unknown> } } };
      traceability: { required: string[]; properties: { featureId: Record<string, unknown>; taskId: Record<string, unknown> } };
    };
  };

  assert.deepEqual(schema.properties.contractVersion, { type: "string", const: "skill-contract/v1" });
  assert.deepEqual(schema.properties.status, { type: "string", enum: ["completed", "review_needed", "blocked", "failed"] });
  assert.deepEqual(schema.properties.producedArtifacts.items.properties.status, {
    type: "string",
    enum: ["created", "updated", "unchanged", "missing", "skipped"],
  });
  assert.deepEqual(schema.properties.producedArtifacts.items.properties.checksum, { type: ["string", "null"] });
  assert.deepEqual(schema.properties.producedArtifacts.items.properties.summary, { type: ["string", "null"] });
  assert.deepEqual(schema.properties.traceability.properties.featureId, { type: ["string", "null"] });
  assert.deepEqual(schema.properties.traceability.properties.taskId, { type: ["string", "null"] });
  assertStrictSchemaObjects(policy.outputSchema);
});

test("CLI adapter validation rejects configs with missing or empty executable", () => {
  const missingExec = validateCliAdapterConfig({ ...DEFAULT_CLI_ADAPTER_CONFIG, executable: "" });
  assert.equal(missingExec.valid, false);
  assert.ok(missingExec.errors.some((e) => /executable/i.test(e)), "should report missing executable");

  const missingTemplate = validateCliAdapterConfig({ ...DEFAULT_CLI_ADAPTER_CONFIG, argumentTemplate: [] });
  assert.equal(missingTemplate.valid, false);
  assert.ok(missingTemplate.errors.some((e) => /argument.*template/i.test(e)), "should report missing argumentTemplate");

  const valid = validateCliAdapterConfig(DEFAULT_CLI_ADAPTER_CONFIG);
  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);
});

test("CLI adapter validation rejects invalid token pricing rates", () => {
  const invalid = validateCliAdapterConfig({
    ...DEFAULT_CLI_ADAPTER_CONFIG,
    defaults: {
      ...DEFAULT_CLI_ADAPTER_CONFIG.defaults,
      costRates: {
        "gpt-5.5": {
          inputUsdPer1M: -1,
          outputUsdPer1M: Number.NaN,
        },
      },
    },
  });

  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.includes("inputUsdPer1M")));
  assert.ok(invalid.errors.some((error) => error.includes("outputUsdPer1M")));
});

test("CLI adapter dry-run returns errors and invalid command for missing executable", () => {
  const result = dryRunCliAdapterConfig({
    config: { ...DEFAULT_CLI_ADAPTER_CONFIG, executable: "" },
    prompt: "Implement bounded task",
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  assert.equal(result.command, undefined);
  assert.equal(result.args, undefined);
});

test("CLI adapter normalizes snake_case DB row fields to camelCase config", () => {
  const normalized = normalizeCliAdapterConfig({
    id: "custom-adapter",
    display_name: "Custom CLI",
    schema_version: 2,
    executable: "gemini",
    argument_template: ["exec", "--prompt", "{prompt}"],
    resume_argument_template: ["resume", "{sessionId}"],
    config_schema: { type: "object" },
    form_schema: { fields: [] },
    defaults: { model: "gemini-pro", reasoning_effort: "high", sandbox: "workspace-write", approval: "on-request" },
    environment_allowlist: ["HOME", "PATH"],
    output_mapping: { event_stream: "json", output_schema: "v1", session_id_path: "session_id" },
    status: "active",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(normalized.id, "custom-adapter");
  assert.equal(normalized.displayName, "Custom CLI");
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.executable, "gemini");
  assert.deepEqual(normalized.argumentTemplate, ["exec", "--prompt", "{prompt}"]);
  assert.deepEqual(normalized.resumeArgumentTemplate, ["resume", "{sessionId}"]);
  assert.deepEqual(normalized.environmentAllowlist, ["HOME", "PATH"]);
  assert.equal(normalized.outputMapping.eventStream, "json");
  assert.equal(normalized.defaults.model, "gemini-pro");
  assert.equal(normalized.defaults.reasoningEffort, "high");
  assert.equal(normalized.status, "active");
});

test("CLI adapter upgrades stale built-in sandbox defaults", () => {
  const normalized = normalizeCliAdapterConfig({
    id: "codex-cli",
    schema_version: 1,
    defaults: {
      model: "gpt-5.3-codex-spark",
      reasoningEffort: "medium",
      sandbox: "workspace-write",
      approval: "never",
    },
  });

  assert.equal(normalized.schemaVersion, DEFAULT_CLI_ADAPTER_CONFIG.schemaVersion);
  assert.equal(normalized.defaults.sandbox, "danger-full-access");
  assert.equal(normalized.defaults.approval, "never");
});

test("runner policy resolves development defaults and clamps heartbeat cadence", () => {
  const lowRisk = resolveRunnerPolicy({
    runId: "RUN-001",
    risk: "low",
    workspaceRoot: "/workspace/project",
    heartbeatIntervalSeconds: 4,
    now: stableDate,
  });

  assert.equal(lowRisk.sandboxMode, "danger-full-access");
  assert.equal(lowRisk.approvalPolicy, "never");
  assert.equal(lowRisk.model, "gpt-5.3-codex-spark");
  assert.equal(lowRisk.reasoningEffort, "medium");
  assert.equal(lowRisk.heartbeatIntervalSeconds, 10);

  const highRisk = resolveRunnerPolicy({
    runId: "RUN-002",
    risk: "high",
    workspaceRoot: "/workspace/project",
    requestedSandboxMode: "danger-full-access",
    requestedApprovalPolicy: "bypass",
    heartbeatIntervalSeconds: 60,
    now: stableDate,
  });

  assert.equal(highRisk.sandboxMode, "danger-full-access");
  assert.equal(highRisk.approvalPolicy, "never");
  assert.equal(highRisk.heartbeatIntervalSeconds, 30);

  const defaultHighRisk = resolveRunnerPolicy({
    runId: "RUN-002B",
    risk: "high",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  assert.equal(defaultHighRisk.sandboxMode, "danger-full-access");
  assert.equal(defaultHighRisk.approvalPolicy, "never");

  const mediumRisk = resolveRunnerPolicy({
    runId: "RUN-002C",
    risk: "medium",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });
  assert.equal(mediumRisk.sandboxMode, "danger-full-access");
  assert.equal(mediumRisk.approvalPolicy, "never");

  const isolated = resolveRunnerPolicy({
    runId: "RUN-002D",
    risk: "medium",
    workspaceRoot: "/workspace/project",
    testEnvironmentIsolation: {
      environmentId: "it-run-002d",
      environmentType: "integration",
      resourceRefs: ["database:hash"],
      workspacePath: "/workspace/project",
      cleanupStrategy: "drop temp database",
    },
    now: stableDate,
  });
  assert.equal(isolated.testEnvironmentIsolation?.environmentId, "it-run-002d");
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

  const docsDirectWritePolicy = resolveRunnerPolicy({
    runId: "RUN-DOCS-DIRECT",
    risk: "low",
    workspaceRoot: "/workspace/project",
    requestedSandboxMode: "danger-full-access",
    now: stableDate,
  });
  const docsDirectWrite = evaluateRunnerSafety({
    policy: docsDirectWritePolicy,
    prompt: "Generate EARS requirements.",
    skillInvocation: skillInvocationContract(),
  });
  assert.equal(docsDirectWrite.allowed, true);
  assert.equal(docsDirectWrite.reviewNeeded, false);

  const codingDirectWrite = evaluateRunnerSafety({
    policy: docsDirectWritePolicy,
    prompt: "Implement the bounded task.",
    files: ["src/index.ts", "tests/index.test.ts"],
    skillInvocation: skillInvocationContract({
      skillSlug: "codex-coding-skill",
      operation: "task_execution",
      sourcePaths: ["docs/features/FEAT-001/tasks.md"],
      expectedArtifacts: [{ path: ".autobuild/reports/cli-adapter.json", kind: "json", required: true }],
      requirementIds: ["REQ-001"],
      requestedAction: "task_execution",
    }),
  });
  assert.equal(codingDirectWrite.allowed, true);
  assert.equal(codingDirectWrite.reviewNeeded, false);

  const unboundedCodingDirectWrite = evaluateRunnerSafety({
    policy: docsDirectWritePolicy,
    prompt: "Implement the task without file scope.",
    skillInvocation: skillInvocationContract({
      skillSlug: "codex-coding-skill",
      operation: "task_execution",
      sourcePaths: ["docs/features/FEAT-001/tasks.md"],
      expectedArtifacts: [{ path: ".autobuild/reports/cli-adapter.json", kind: "json", required: true }],
      requirementIds: ["REQ-001"],
      requestedAction: "task_execution",
    }),
  });
  assert.equal(unboundedCodingDirectWrite.allowed, true);
  assert.equal(unboundedCodingDirectWrite.reviewNeeded, false);

  const unsafeArtifactDirectWrite = evaluateRunnerSafety({
    policy: docsDirectWritePolicy,
    prompt: "Generate a risky artifact.",
    skillInvocation: skillInvocationContract({
      skillSlug: "technical-context-skill",
      expectedArtifacts: [{ path: "../outside.md", kind: "markdown", required: true }],
      requestedAction: "feature_planning",
    }),
  });
  assert.equal(unsafeArtifactDirectWrite.allowed, true);
  assert.equal(unsafeArtifactDirectWrite.reviewNeeded, false);

  const unscopedDanger = evaluateRunnerSafety({
    policy: docsDirectWritePolicy,
    prompt: "Run a normal task.",
  });
  assert.equal(unscopedDanger.allowed, true);
  assert.equal(unscopedDanger.reviewNeeded, false);
});

test("safety gate ignores high-risk words inside bundled source context", () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-SOURCE-CONTEXT",
    risk: "medium",
    workspaceRoot: "/workspace/project",
    now: stableDate,
  });

  const result = evaluateRunnerSafety({
    policy,
    prompt: [
      "Execute this SpecDrive CLI skill invocation.",
      "Workspace Context Bundle:",
      "### docs/PRD.md",
      "MVP 不接入支付，不处理 auth token，不做 permission system.",
    ].join("\n"),
    taskText: "Generate EARS requirements from PRD.",
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reviewNeeded, false);
});

test("skill invocation prompt asks child CLI to write docs artifacts directly", () => {
  const prompt = buildSkillInvocationPrompt(
    skillInvocationContract(),
    "Context",
  );

  assert.match(prompt, /Prefer writing expected artifacts directly/);
  assert.doesNotMatch(prompt, /ARTIFACT: <relative-path>/);
  assert.doesNotMatch(prompt, /do not use file write tools/);
  assert.doesNotMatch(prompt, /parent scheduler will materialize/);
});

test("feature-level coding prompt requires Feature Spec execution instead of report-only completion", () => {
  const prompt = buildSkillInvocationPrompt(
    skillInvocationContract({
      operation: "feature_execution",
      skillSlug: "codex-coding-skill",
      requestedAction: "feature_execution",
      sourcePaths: [
        "docs/features/FEAT-001/requirements.md",
        "docs/features/FEAT-001/design.md",
        "docs/features/FEAT-001/tasks.md",
      ],
      expectedArtifacts: [{ path: ".autobuild/reports/feature-execution.json", kind: "json", required: true }],
      featureId: "FEAT-001",
      taskId: undefined,
    }),
    "Context",
  );

  assert.match(prompt, /Feature Spec directory/);
  assert.match(prompt, /requirements\.md, design\.md, and tasks\.md/);
  assert.match(prompt, /Do not satisfy feature_execution by only creating a report JSON file/);
  assert.match(prompt, /actual code, test, config, or documentation files/);
});

test("Codex CLI adapter captures JSON events, session id, output, and redacts logs", async () => {
  const workspaceRoot = makeWorkspacePath();
  const policy = resolveRunnerPolicy({
    runId: "RUN-004",
    risk: "low",
    workspaceRoot,
    model: "gpt-5.3-codex-spark",
    profile: "automation",
    resumeSessionId: "SESSION-OLD",
    now: stableDate,
  });
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  const result = await runCliAdapter({
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
  assert.deepEqual(calls[0].args.slice(0, 13), [
    "-a",
    "never",
    "--sandbox",
    "danger-full-access",
    "-c",
    'model_reasoning_effort="medium"',
    "--cd",
    workspaceRoot,
    "-p",
    "automation",
    "exec",
    "resume",
    "--ignore-user-config",
  ]);
  assert.equal(calls[0].args[13], "--json");
  assert.equal(calls[0].args[14], "-m");
  assert.equal(calls[0].args[15], "gpt-5.3-codex-spark");
  assert.equal(calls[0].args[16], "SESSION-OLD");
  assert.match(calls[0].args[17], /Implement bounded task token=abc123/);
  assert.match(calls[0].args[17], /matching this schema/);
  assert.equal(calls[0].cwd, workspaceRoot);
  assert.doesNotMatch(result.session.args.join(" "), /abc123/);
  assert.match(result.session.args.join(" "), /token=\[REDACTED\]/);
  assert.equal(result.session.sessionId, "SESSION-NEW");
  assert.equal(result.session.exitCode, 0);
  assert.deepEqual(result.rawLog.events.map((event) => event.type), ["session", "result"]);
  assert.equal(result.rawLog.events[1].message, "token=[REDACTED]");
  assert.match(result.rawLog.stdout, /token=\[REDACTED\]/);
  assert.match(result.rawLog.stderr, /password=\[REDACTED\]/);

  const expectedLogFiles = {
    input: join(workspaceRoot, ".autobuild", "runs", "RUN-004", "cli-input.json"),
    output: join(workspaceRoot, ".autobuild", "runs", "RUN-004", "cli-output.json"),
    stdout: join(workspaceRoot, ".autobuild", "runs", "RUN-004", "stdout.log"),
    stderr: join(workspaceRoot, ".autobuild", "runs", "RUN-004", "stderr.log"),
  };
  assert.deepEqual(result.rawLog.files, expectedLogFiles);
  assert.equal(existsSync(expectedLogFiles.input), true);
  assert.equal(existsSync(expectedLogFiles.output), true);
  assert.equal(existsSync(expectedLogFiles.stdout), true);
  assert.equal(existsSync(expectedLogFiles.stderr), true);

  const inputLog = JSON.parse(readFileSync(expectedLogFiles.input, "utf8"));
  assert.equal(inputLog.runId, "RUN-004");
  assert.equal(inputLog.workspaceRoot, workspaceRoot);
  assert.match(inputLog.prompt, /token=\[REDACTED\]/);
  assert.match(inputLog.args.join(" "), /token=\[REDACTED\]/);
  assert.doesNotMatch(readFileSync(expectedLogFiles.stdout, "utf8"), /abc123/);
  assert.match(readFileSync(expectedLogFiles.stdout, "utf8"), /token=\[REDACTED\]/);
  assert.match(readFileSync(expectedLogFiles.stderr, "utf8"), /password=\[REDACTED\]/);

  const outputLog = JSON.parse(readFileSync(expectedLogFiles.output, "utf8"));
  assert.equal(outputLog.status, 0);
  assert.equal(outputLog.sessionId, "SESSION-NEW");
  assert.equal(outputLog.eventCount, 2);

  const executionResult = buildExecutionResultInput(result.result);
  assert.equal(executionResult.kind, "cli_runner");
  assert.equal(executionResult.featureId, "FEAT-008");
  assert.match(executionResult.summary, /exit=0/);
  assert.deepEqual(executionResult.metadata.logFiles, expectedLogFiles);
  assert.equal(result.executionAdapterResult?.contractVersion, "execution-adapter/v1");
  assert.equal(result.executionAdapterResult?.providerSession.provider, "codex-cli");
  assert.equal(result.executionAdapterResult?.providerSession.transport, "process");
  assert.equal(result.executionAdapterResult?.providerSession.cwd, workspaceRoot);
});

test("Gemini CLI adapter extracts session, usage, and SkillOutputContract from stream-json response text", async () => {
  const workspaceRoot = makeWorkspacePath();
  const policy = resolveRunnerPolicy({
    runId: "RUN-GEMINI",
    risk: "low",
    workspaceRoot,
    model: "gemini-3-pro-preview",
    now: stableDate,
  });
  const invocation = skillInvocationContract({
    executionId: "RUN-GEMINI",
    workspaceRoot,
    expectedArtifacts: [{ path: "docs/requirements.md", kind: "markdown", required: false }],
  });
  const output = {
    contractVersion: "skill-contract/v1",
    executionId: "RUN-GEMINI",
    skillSlug: "pr-ears-requirement-decomposition-skill",
    requestedAction: "generate_ears",
    status: "completed",
    summary: "Gemini completed.",
    nextAction: "Continue.",
    producedArtifacts: [{ path: "docs/requirements.md", kind: "markdown", status: "created" }],
    traceability: { requirementIds: [], changeIds: ["CHG-016"] },
    result: {},
  };

  const result = await runCliAdapter({
    policy,
    adapterConfig: GEMINI_CLI_ADAPTER_CONFIG,
    prompt: buildSkillInvocationPrompt(invocation, "Context"),
    outputSchemaPath: "/tmp/runner-output.schema.json",
    skillInvocation: invocation,
    now: stableDate,
    runner: (command, args, cwd) => {
      assert.equal(command, "gemini");
      assert.deepEqual(args.slice(0, 5), ["--model", "gemini-3-pro-preview", "--output-format", "stream-json", "-p"]);
      assert.equal(cwd, workspaceRoot);
      return {
        status: 0,
        stdout: [
          JSON.stringify({ type: "init", session_id: "GEMINI-SESSION", model: "gemini-3-pro-preview" }),
          JSON.stringify({ type: "message", response: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\`` }),
          JSON.stringify({ type: "result", stats: { inputTokens: 11, outputTokens: 7 } }),
        ].join("\n"),
        stderr: "",
      };
    },
  });

  assert.equal(result.session.sessionId, "GEMINI-SESSION");
  assert.equal(result.result.skillOutput?.summary, "Gemini completed.");
  assert.equal(result.result.contractValidation?.valid, true);

  const outputLog = JSON.parse(readFileSync(result.rawLog.files?.output ?? "", "utf8"));
  assert.deepEqual(outputLog.usage, { inputTokens: 11, outputTokens: 7 });
});

test("Gemini CLI adapter routes successful runs with missing SkillOutputContract to review", async () => {
  const workspaceRoot = makeWorkspacePath();
  const policy = resolveRunnerPolicy({
    runId: "RUN-GEMINI-MISSING",
    risk: "low",
    workspaceRoot,
    model: "gemini-3-pro-preview",
    now: stableDate,
  });
  const invocation = skillInvocationContract({
    executionId: "RUN-GEMINI-MISSING",
    workspaceRoot,
    expectedArtifacts: [{ path: "docs/requirements.md", kind: "markdown", required: false }],
  });

  const result = await processRunnerQueueItem({
    runId: "RUN-GEMINI-MISSING",
    policy,
    prompt: buildSkillInvocationPrompt(invocation, "Context"),
    adapterConfig: GEMINI_CLI_ADAPTER_CONFIG,
    skillInvocation: invocation,
  }, () => ({
    status: 0,
    stdout: JSON.stringify({ type: "result", response: "Done, but not JSON." }),
    stderr: "",
  }));

  assert.equal(result.status, "review_needed");
  assert.match(result.summary, /Skill output contract review needed/);
});

test("Codex CLI adapter passes output schema for new exec runs", async () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-004B",
    risk: "low",
    workspaceRoot: makeWorkspacePath(),
    now: stableDate,
  });
  const calls: Array<{ args: string[] }> = [];

  await runCliAdapter({
    policy,
    prompt: "Implement bounded task",
    outputSchemaPath: "/tmp/runner-output.schema.json",
    runner: (_command, args) => {
      calls.push({ args });
      return { status: 0, stdout: '{"type":"result"}', stderr: "" };
    },
  });

  assert.deepEqual(calls[0].args.slice(0, 14), [
    "-a",
    "never",
    "-c",
    'model_reasoning_effort="medium"',
    "--cd",
    policy.workspaceRoot,
    "exec",
    "--ignore-user-config",
    "--json",
    "--sandbox",
    "danger-full-access",
    "--model",
    "gpt-5.3-codex-spark",
    "--output-schema",
  ]);
  assert.equal(calls[0].args[14], "/tmp/runner-output.schema.json");
});

test("Codex CLI adapter terminates variadic image arguments before prompt", () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-IMAGE-PROMPT",
    risk: "low",
    workspaceRoot: makeWorkspacePath(),
    now: stableDate,
  });

  const rendered = renderCliAdapterCommand({
    policy,
    prompt: "Generate UI Spec from the attached concept image",
    outputSchemaPath: "/tmp/runner-output.schema.json",
    imagePaths: ["docs/ui/spec-workspace-prd-flow-concept.png"],
  });

  const imageIndex = rendered.args.indexOf("-i");
  assert.equal(rendered.args[imageIndex + 1], "docs/ui/spec-workspace-prd-flow-concept.png");
  assert.equal(rendered.args[imageIndex + 2], "--");
  assert.equal(rendered.args[imageIndex + 3], "Generate UI Spec from the attached concept image");
});

test("Codex CLI adapter closes child stdin for non-interactive runner commands", { timeout: 5000 }, async () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-STDIN",
    risk: "low",
    workspaceRoot: makeWorkspacePath(),
    now: stableDate,
  });

  const result = await runCliAdapter({
    policy,
    prompt: "Run non-interactive command",
    outputSchemaPath: "/tmp/runner-stdin.schema.json",
    now: stableDate,
    adapterConfig: normalizeCliAdapterConfig({
      ...DEFAULT_CLI_ADAPTER_CONFIG,
      executable: process.execPath,
      argumentTemplate: [
        "-e",
        [
          "process.stdin.resume();",
          "process.stdin.on('end',()=>{",
          "console.log(JSON.stringify({type:'result',status:'completed',stdinClosed:true}));",
          "});",
        ].join(""),
        "{{prompt}}",
        "{{output_schema}}",
      ],
      resumeArgumentTemplate: [],
      defaults: { model: "node", sandbox: "workspace-write", approval: "never" },
    }),
  });

  assert.equal(result.session.exitCode, 0);
  assert.equal(result.rawLog.events[0].stdinClosed, true);
});

test("Codex CLI adapter removes generated output schema files after execution", async () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-004C",
    risk: "low",
    workspaceRoot: makeWorkspacePath(),
    now: stableDate,
  });
  let generatedSchemaPath = "";

  await runCliAdapter({
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
    workspaceRoot: makeWorkspacePath(),
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

  const missingArtifactRoot = makeWorkspacePath();
  const missingArtifactPolicy = resolveRunnerPolicy({
    runId: "RUN-006A",
    risk: "low",
    workspaceRoot: missingArtifactRoot,
    now: stableDate,
  });
  const missingArtifact = await processRunnerQueueItem(
    {
      runId: "RUN-006A",
      prompt: "Generate requirements",
      policy: missingArtifactPolicy,
      skillInvocation: skillInvocationContract({ executionId: "RUN-006A", workspaceRoot: missingArtifactRoot }),
    },
    () => ({ status: 0, stdout: skillOutputEvent({ executionId: "RUN-006A", producedArtifacts: [] }), stderr: "" }),
  );
  assert.equal(missingArtifact.status, "review_needed");

  const reviewNeeded = await processRunnerQueueItem(
    {
      runId: "RUN-006",
      prompt: "Run tests",
      policy: allowedPolicy,
    },
    () => ({ status: 0, stdout: '{"type":"result","status":"review_needed"}', stderr: "" }),
  );

  assert.equal(reviewNeeded.status, "review_needed");

  const nestedReviewNeeded = await processRunnerQueueItem(
    {
      runId: "RUN-006N",
      prompt: "Run tests",
      policy: allowedPolicy,
    },
    () => ({
      status: 0,
      stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":\\"write failed\\",\\"status\\":\\"review_needed\\"}"}}',
      stderr: "",
    }),
  );
  assert.equal(nestedReviewNeeded.status, "review_needed");

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
    workspaceRoot: makeWorkspacePath(),
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

test("runner queue worker records status check result after completed runs", async () => {
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
        testEnvironmentIsolation: {
          environmentId: "it-run-006s",
          environmentType: "integration",
          resourceRefs: ["database:006s"],
          workspacePath: root,
          cleanupStrategy: "remove temp sqlite database",
        },
      },
    },
    () => ({ status: 0, stdout: '{"type":"result","status":"completed"}\ntoken=abc123', stderr: "" }),
  );

  assert.equal(executed.status, "review_needed");
  assert.equal(executed.statusCheckResult?.status, "review_needed");
  assert.equal(executed.recoveryTask, undefined);
  assert.equal(executed.recoveryDispatch, undefined);
  assert.equal(JSON.stringify(executed.statusCheckResult?.executionResult).includes("abc123"), false);
  assert.equal(
    JSON.stringify(executed.statusCheckResult?.executionResult.runner.result).includes("it-run-006s"),
    true,
  );
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
  const dispatched: unknown[] = [];

  const result = await processRunnerQueueItem(
    {
      runId: "RUN-006F",
      prompt: "Run tests",
      policy,
      recoveryDispatcher: (dispatch) => {
        dispatched.push(dispatch);
      },
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
    () => ({
      status: 1,
      stdout: '{"type":"session","session_id":"SESSION-006F"}\n{"type":"result","status":"failed"}',
      stderr: "tests failed",
    }),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.statusCheckResult?.status, "blocked");
  assert.equal(result.recoveryTask?.taskId, "TASK-009");
  assert.equal(result.recoveryTask?.route, "automatic");
  assert.equal(result.recoveryDispatchInput?.requested_action, "auto_fix");
  assert.equal(result.recoveryDispatchInput?.failure.failed_command, "npm test");
  assert.equal(result.recoverySafety?.allowed, true);
  assert.notEqual(result.recoveryDispatch?.policy.runId, result.runId);
  assert.equal(result.recoveryDispatch?.policy.resumeSessionId, "SESSION-006F");
  assert.equal(result.recoveryDispatch?.scheduledAt, result.recoveryTask?.retrySchedule?.scheduledAt);
  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0], result.recoveryDispatch);
});

test("runner recovery preserves failed runner command context without command checks", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-failed-command-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010F",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });

  const result = await processRunnerQueueItem(
    {
      runId: "RUN-010F",
      prompt: "Run Codex task",
      policy,
      statusCheck: {
        dbPath,
        specAlignment: {
          taskId: "TASK-010",
          userStoryIds: ["REQ-043"],
          requirementIds: ["REQ-043"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-043"],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "codex failed before checks" }),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.statusCheckResult?.status, "blocked");
  assert.equal(result.recoveryTask?.failedCommand, "codex runner exit=1");
  assert.equal(result.recoveryTask?.fingerprint.failedCommandOrCheck, "codex runner exit=1");
  assert.equal(result.recoveryDispatchInput?.failure.failed_command, "codex runner exit=1");
});

test("runner recovery creates review task for spec-alignment failures without command failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-spec-review-recovery-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010S",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });

  const result = await processRunnerQueueItem(
    {
      runId: "RUN-010S",
      prompt: "Run Codex task",
      policy,
      statusCheck: {
        dbPath,
        commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "passed" as const, exitCode: 0 }],
        specAlignment: {
          taskId: "TASK-010",
          userStoryIds: ["REQ-043"],
          requirementIds: ["REQ-043"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: [],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 0, stdout: '{"type":"result","status":"completed"}', stderr: "" }),
  );

  assert.equal(result.statusCheckResult?.status, "review_needed");
  assert.equal(result.recoveryTask?.requestedAction, "read_only_analysis");
  assert.equal(result.recoveryTask?.route, "review_needed");
  assert.equal(result.recoveryDispatch, undefined);
});

test("runner recovery task preserves retry history and forbidden retry records", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-history-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010H",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const statusCheck = {
    dbPath,
    commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
    specAlignment: {
      taskId: "TASK-010",
      userStoryIds: ["REQ-043"],
      requirementIds: ["REQ-043"],
      acceptanceCriteriaIds: ["AC-001"],
      coveredRequirementIds: ["REQ-043"],
      testCoverage: true,
    },
  };
  const first = await processRunnerQueueItem(
    { runId: "RUN-010H", prompt: "Run tests", policy, statusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  assert.equal(first.recoveryTask?.retrySchedule?.attemptNumber, 1);
  const failedRecovery = handleRecoveryResult({
    recoveryTask: first.recoveryTask!,
    action: "auto_fix",
    status: "failed",
    strategy: "auto_fix",
    command: "node fix.js",
    fileScope: ["src/recovery.ts"],
    summary: "automatic fix failed",
    now: stableDate,
  });

  const second = await processRunnerQueueItem(
    {
      runId: "RUN-010H",
      prompt: "Run tests again",
      policy,
      statusCheck: {
        ...statusCheck,
        recoveryAttempts: [failedRecovery.attempt],
        forbiddenRetryItems: [failedRecovery.forbiddenRetryRecord!],
      },
    },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );

  assert.equal(second.recoveryTask?.historicalAttempts.length, 1);
  assert.equal(second.recoveryTask?.forbiddenRetryItems.length, 1);
  assert.equal(second.recoveryTask?.retrySchedule?.status, "blocked_by_forbidden_duplicate");
  assert.equal(second.recoveryTask?.route, "manual");
  assert.equal(second.recoveryDispatch, undefined);
});

test("runner recovery reloads persisted retry history across invocations", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-persisted-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010P",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const statusCheck = {
    dbPath,
    commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
    specAlignment: {
      taskId: "TASK-010",
      userStoryIds: ["REQ-043"],
      requirementIds: ["REQ-043"],
      acceptanceCriteriaIds: ["AC-001"],
      coveredRequirementIds: ["REQ-043"],
      testCoverage: true,
    },
  };

  const first = await processRunnerQueueItem(
    { runId: "RUN-010P", prompt: "Run tests", policy, statusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  const recoveryResult = handleRecoveryResult({
    recoveryTask: first.recoveryTask!,
    action: "auto_fix",
    status: "completed",
    strategy: "auto_fix",
    command: "npm test",
    fileScope: ["src/recovery.ts"],
    summary: "automatic fix completed but task failed again",
    now: stableDate,
  });
  const second = await processRunnerQueueItem(
    { runId: "RUN-010P", prompt: "Run tests again", policy, statusCheck: { ...statusCheck, recoveryResult } },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );

  assert.equal(first.recoveryTask?.retrySchedule?.attemptNumber, 1);
  assert.equal(second.recoveryTask?.historicalAttempts.length, 1);
  assert.equal(second.recoveryTask?.retrySchedule?.attemptNumber, 2);
  assert.equal(second.recoveryTask?.retrySchedule?.backoffMinutes, 4);
});

test("runner recovery does not dispatch duplicate scheduled retries", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-dedupe-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010D",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const statusCheck = {
    dbPath,
    commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
    specAlignment: {
      taskId: "TASK-010",
      userStoryIds: ["REQ-043"],
      requirementIds: ["REQ-043"],
      acceptanceCriteriaIds: ["AC-001"],
      coveredRequirementIds: ["REQ-043"],
      testCoverage: true,
    },
  };

  const first = await processRunnerQueueItem(
    { runId: "RUN-010D", prompt: "Run tests", policy, statusCheck, recoveryDispatcher: () => {} },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  const duplicate = await processRunnerQueueItem(
    { runId: "RUN-010D", prompt: "Run tests duplicate", policy, statusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );

  assert.equal(first.recoveryTask?.retrySchedule?.status, "scheduled");
  assert.equal(first.recoveryDispatch?.dispatchInput.requested_action, "auto_fix");
  assert.equal(duplicate.recoveryTask?.retrySchedule?.status, "already_scheduled");
  assert.equal(duplicate.recoveryDispatch, undefined);
});

test("runner recovery without custom dispatcher queues default recovery dispatch and marks scheduled history", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-no-dispatcher-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010ND",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const statusCheck = {
    dbPath,
    commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
    specAlignment: {
      taskId: "TASK-010",
      userStoryIds: ["REQ-043"],
      requirementIds: ["REQ-043"],
      acceptanceCriteriaIds: ["AC-001"],
      coveredRequirementIds: ["REQ-043"],
      testCoverage: true,
    },
  };

  const result = await processRunnerQueueItem(
    { runId: "RUN-010ND", prompt: "Run tests", policy, statusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  const rows = runSqlite(dbPath, [], [{ name: "attempts", sql: "SELECT * FROM recovery_attempts WHERE task_id = ?", params: ["TASK-010"] }])
    .queries.attempts;
  const dispatches = runSqlite(dbPath, [], [{ name: "runs", sql: "SELECT * FROM recovery_dispatches" }])
    .queries.runs;

  assert.equal(result.recoveryTask?.retrySchedule?.status, "scheduled");
  assert.equal(result.recoveryDispatch?.dispatchInput.requested_action, "auto_fix");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "scheduled");
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].status, "scheduled");
  assert.equal(dispatches[0].scheduled_at, result.recoveryDispatch?.scheduledAt);
  assert.equal(JSON.parse(String(dispatches[0].policy_json)).runId, result.recoveryDispatch?.policy.runId);
  assert.equal(JSON.parse(String(dispatches[0].dispatch_input_json)).recovery_task_id, result.recoveryTask?.id);
  assert.deepEqual(listDueRecoveryDispatches(dbPath, stableDate), []);
});

test("runner recovery keeps non-persistent status checks actionable", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-no-db-"));
  const policy = resolveRunnerPolicy({
    runId: "RUN-010NODB",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const dispatched: unknown[] = [];

  const result = await processRunnerQueueItem(
    {
      runId: "RUN-010NODB",
      prompt: "Run tests",
      policy,
      recoveryDispatcher: (dispatch) => {
        dispatched.push(dispatch);
      },
      statusCheck: {
        commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
        specAlignment: {
          taskId: "TASK-010",
          userStoryIds: ["REQ-043"],
          requirementIds: ["REQ-043"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-043"],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 0, stdout: '{"type":"result","status":"completed"}', stderr: "" }),
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.statusCheckResult?.status, "blocked");
  assert.match(result.statusCheckResult?.summary ?? "", /failed command checks/);
  assert.equal(result.recoveryTask?.route, "automatic");
  assert.equal(result.recoveryDispatch, undefined);
  assert.equal(dispatched.length, 0);
});

test("runner recovery default dispatcher updates stale scheduled recovery dispatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-stale-dispatch-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010ST",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const statusCheck = {
    dbPath,
    commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
    specAlignment: {
      taskId: "TASK-010",
      userStoryIds: ["REQ-043"],
      requirementIds: ["REQ-043"],
      acceptanceCriteriaIds: ["AC-001"],
      coveredRequirementIds: ["REQ-043"],
      testCoverage: true,
    },
  };

  const first = await processRunnerQueueItem(
    { runId: "RUN-010ST", prompt: "Run tests", policy, statusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  runSqlite(dbPath, [{
    sql: "UPDATE recovery_attempts SET attempted_at = ? WHERE id = ?",
    params: [new Date(stableDate.getTime() - 31 * 60_000).toISOString(), first.recoveryTask?.id],
  }]);
  await processRunnerQueueItem(
    { runId: "RUN-010ST", prompt: "Run tests again", policy, statusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  const dispatches = runSqlite(dbPath, [], [{ name: "runs", sql: "SELECT * FROM recovery_dispatches" }])
    .queries.runs;
  const due = listDueRecoveryDispatches(dbPath, new Date(Date.now() + 60_000));
  const duplicateDue = listDueRecoveryDispatches(dbPath, new Date(Date.now() + 60_000));

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].id, first.recoveryTask?.id);
  assert.equal(dispatches[0].status, "queued");
  assert.equal(due.length, 1);
  assert.equal(due[0].dispatchId, first.recoveryTask?.id);
  assert.equal(due[0].status, "running");
  assert.equal(due[0].dispatchInput.recovery_task_id, first.recoveryTask?.id);
  assert.equal(duplicateDue.length, 0);
  const ran: unknown[] = [];
  runSqlite(dbPath, [{ sql: "UPDATE recovery_dispatches SET status = ? WHERE id = ?", params: ["queued", first.recoveryTask?.id] }]);
  const executed = await runDueRecoveryDispatches(dbPath, (dispatch) => {
    ran.push(dispatch);
  }, new Date(Date.now() + 60_000));
  const completed = runSqlite(dbPath, [], [{ name: "runs", sql: "SELECT status FROM recovery_dispatches WHERE id = ?", params: [first.recoveryTask?.id] }])
    .queries.runs;
  assert.equal(executed.length, 1);
  assert.equal(ran.length, 1);
  assert.equal(completed[0].status, "completed");
});

test("runner recovery does not re-dispatch already scheduled retries", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-no-redispatch-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010RD",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const statusCheck = {
    dbPath,
    commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
    specAlignment: {
      taskId: "TASK-010",
      userStoryIds: ["REQ-043"],
      requirementIds: ["REQ-043"],
      acceptanceCriteriaIds: ["AC-001"],
      coveredRequirementIds: ["REQ-043"],
      testCoverage: true,
    },
  };

  const first = await processRunnerQueueItem(
    { runId: "RUN-010RD", prompt: "Run tests", policy, statusCheck, recoveryDispatcher: () => {} },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  const duplicate = await processRunnerQueueItem(
    { runId: "RUN-010RD", prompt: "Run tests duplicate", policy, statusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );

  assert.equal(duplicate.recoveryTask?.id, first.recoveryTask?.id);
  assert.equal(duplicate.recoveryTask?.retrySchedule?.status, "already_scheduled");
  assert.equal(duplicate.recoveryDispatch, undefined);
});

test("runner recovery routes high-risk file failures to review before scheduling", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-high-risk-file-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010SH",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const statusCheck = {
    dbPath,
    diff: { files: ["src/auth/login.ts"] },
    commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
    specAlignment: {
      taskId: "TASK-010",
      userStoryIds: ["REQ-043"],
      requirementIds: ["REQ-043"],
      acceptanceCriteriaIds: ["AC-001"],
      coveredRequirementIds: ["REQ-043"],
      testCoverage: true,
    },
  };

  const first = await processRunnerQueueItem(
    { runId: "RUN-010SH", prompt: "Run tests", policy, statusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  const rows = runSqlite(dbPath, [], [{ name: "attempts", sql: "SELECT * FROM recovery_attempts WHERE task_id = ?", params: ["TASK-010"] }])
    .queries.attempts;

  assert.equal(first.recoveryTask?.route, "review_needed");
  assert.equal(first.recoveryTask?.retrySchedule, undefined);
  assert.equal(first.recoveryDispatch, undefined);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "review_needed");
});

test("runner recovery dispatcher failures do not leave phantom scheduled attempts", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-dispatch-failure-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010DF",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const statusCheck = {
    dbPath,
    commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
    specAlignment: {
      taskId: "TASK-010",
      userStoryIds: ["REQ-043"],
      requirementIds: ["REQ-043"],
      acceptanceCriteriaIds: ["AC-001"],
      coveredRequirementIds: ["REQ-043"],
      testCoverage: true,
    },
  };

  const first = await processRunnerQueueItem(
    {
      runId: "RUN-010DF",
      prompt: "Run tests",
      policy,
      statusCheck,
      recoveryDispatcher: () => {
        throw new Error("scheduler offline");
      },
    },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  const rows = runSqlite(dbPath, [], [{ name: "attempts", sql: "SELECT * FROM recovery_attempts WHERE task_id = ?", params: ["TASK-010"] }])
    .queries.attempts;
  const second = await processRunnerQueueItem(
    { runId: "RUN-010DF", prompt: "Run tests again", policy, statusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );

  assert.equal(first.statusCheckResult?.status, "blocked");
  assert.equal(first.recoveryDispatch, undefined);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "blocked");
  assert.equal(second.statusCheckResult?.status, "blocked");
  assert.equal(second.recoveryTask, undefined);
  assert.equal(second.recoveryDispatch, undefined);
  runSqlite(dbPath, [{
    sql: "UPDATE recovery_attempts SET attempted_at = ? WHERE id = ?",
    params: [new Date(Date.now() - 31 * 60_000).toISOString(), first.recoveryTask?.id],
  }]);
  const recovered = await processRunnerQueueItem(
    { runId: "RUN-010DF", prompt: "Run tests after dispatcher recovers", policy, statusCheck, recoveryDispatcher: () => {} },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  assert.equal(recovered.recoveryTask?.retrySchedule?.status, "scheduled");
});

test("runner recovery does not auto-recover terminal status-check failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-terminal-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010T",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });

  const result = await processRunnerQueueItem(
    {
      runId: "RUN-010T",
      prompt: "Run repeatedly failing tests",
      policy,
      statusCheck: {
        dbPath,
        failureHistory: ["failed", "failed"],
        failureThreshold: 3,
        commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
        specAlignment: {
          taskId: "TASK-010",
          userStoryIds: ["REQ-043"],
          requirementIds: ["REQ-043"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-043"],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.statusCheckResult?.status, "failed");
  assert.equal(result.recoveryTask, undefined);
  assert.equal(result.recoveryDispatch, undefined);
});


test("runner recovery persistence failures return blocked status instead of throwing", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-persist-failure-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  const legacyDbPath = join(root, ".autobuild", "legacy.db");
  initializeSchema(dbPath);
  initializeSchema(legacyDbPath, MIGRATIONS.filter((migration) => migration.version < 9));
  const policy = resolveRunnerPolicy({
    runId: "RUN-010PF",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const statusCheck = {
    dbPath,
    commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
    specAlignment: {
      taskId: "TASK-010",
      userStoryIds: ["REQ-043"],
      requirementIds: ["REQ-043"],
      acceptanceCriteriaIds: ["AC-001"],
      coveredRequirementIds: ["REQ-043"],
      testCoverage: true,
    },
  };
  const first = await processRunnerQueueItem(
    { runId: "RUN-010PF", prompt: "Run tests", policy, statusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  const recoveryResult = handleRecoveryResult({
    recoveryTask: first.recoveryTask!,
    action: "auto_fix",
    status: "completed",
    strategy: "auto_fix",
    command: "npm test",
    fileScope: ["src/recovery.ts"],
    summary: "automatic fix completed",
    now: stableDate,
  });

  const result = await processRunnerQueueItem(
    { runId: "RUN-010PF", prompt: "Run tests again", policy, statusCheck: { ...statusCheck, dbPath: legacyDbPath, recoveryResult } },
    () => ({ status: 0, stdout: '{"type":"result","status":"completed"}', stderr: "" }),
  );
  const persisted = listStatusCheckResults(legacyDbPath, "RUN-010PF")[0];

  assert.equal(result.status, "blocked");
  assert.equal(result.statusCheckResult?.status, "blocked");
  assert.match(result.statusCheckResult?.summary ?? "", /recovery history persistence failed/);
  assert.equal(persisted.status, "blocked");
  assert.match(persisted.summary, /recovery history persistence failed/);
  assert.equal(result.recoveryTask, undefined);
  assert.equal(result.recoveryDispatch, undefined);
});

test("runner recovery does not load global history when task traceability is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-no-task-history-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010NT",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });
  const tracedStatusCheck = {
    dbPath,
    commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed" as const, exitCode: 1 }],
    specAlignment: {
      taskId: "TASK-OTHER",
      userStoryIds: ["REQ-043"],
      requirementIds: ["REQ-043"],
      acceptanceCriteriaIds: ["AC-001"],
      coveredRequirementIds: ["REQ-043"],
      testCoverage: true,
    },
  };
  const traced = await processRunnerQueueItem(
    { runId: "RUN-010NT", prompt: "Run tests", policy, statusCheck: tracedStatusCheck },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );
  persistRecoveryResultHandling(dbPath, handleRecoveryResult({
    recoveryTask: traced.recoveryTask!,
    action: "auto_fix",
    status: "completed",
    strategy: "auto_fix",
    command: "npm test",
    fileScope: ["src/recovery.ts"],
    summary: "unrelated task recovery completed",
    now: stableDate,
  }));
  runSqlite(dbPath, [{
    sql: `INSERT INTO recovery_attempts (
      id, fingerprint_id, task_id, action, strategy, command, file_scope_json,
      status, summary, execution_result_json, attempted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      "ATTEMPT-UNKNOWN-TASK",
      "FINGERPRINT-UNKNOWN-TASK",
      "unknown-task",
      "auto_fix",
      "auto_fix",
      "npm test",
      JSON.stringify(["src/unrelated.ts"]),
      "completed",
      "untraceable recovery completed elsewhere",
      null,
      stableDate.toISOString(),
    ],
  }]);

  const missingTraceability = await processRunnerQueueItem(
    {
      runId: "RUN-010NT",
      prompt: "Run tests without traceability",
      policy,
      statusCheck: {
        dbPath,
        commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed", exitCode: 1 }],
        specAlignment: {
          userStoryIds: ["REQ-043"],
          requirementIds: ["REQ-043"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-043"],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );

  assert.match(missingTraceability.recoveryTask?.taskId ?? "", /^untraceable:[a-f0-9]{16}$/);
  assert.equal(missingTraceability.recoveryTask?.route, "review_needed");
  assert.equal(missingTraceability.recoveryTask?.historicalAttempts.length, 0);
  assert.equal(missingTraceability.recoveryTask?.forbiddenRetryItems.length, 0);
  assert.equal(missingTraceability.recoveryTask?.retrySchedule, undefined);
  const repeatedMissingTraceability = await processRunnerQueueItem(
    {
      runId: "RUN-010NT",
      prompt: "Run tests without traceability again",
      policy,
      statusCheck: {
        dbPath,
        commandChecks: [{ kind: "unit_test" as const, command: "npm test", status: "failed", exitCode: 1 }],
        specAlignment: {
          userStoryIds: ["REQ-043"],
          requirementIds: ["REQ-043"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-043"],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );

  assert.equal(repeatedMissingTraceability.recoveryTask?.historicalAttempts.length, 0);
  assert.equal(repeatedMissingTraceability.recoveryTask?.route, "review_needed");
  assert.equal(repeatedMissingTraceability.recoveryTask?.retrySchedule, undefined);
});

test("runner recovery routes high-risk policies through review before write recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-high-risk-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010R",
    risk: "high",
    workspaceRoot: root,
    now: stableDate,
  });

  const result = await processRunnerQueueItem(
    {
      runId: "RUN-010R",
      prompt: "Run tests",
      policy,
      statusCheck: {
        dbPath,
        commandChecks: [{ kind: "unit_test", command: "npm test", status: "failed", exitCode: 1 }],
        specAlignment: {
          taskId: "TASK-010",
          userStoryIds: ["REQ-043"],
          requirementIds: ["REQ-043"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-043"],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "tests failed" }),
  );

  assert.equal(result.recoveryTask?.route, "review_needed");
  assert.equal(result.recoveryDispatch, undefined);
});

test("runner recovery safety reviews high-risk failed commands before dispatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-runner-recovery-command-safety-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-010C",
    risk: "low",
    workspaceRoot: root,
    now: stableDate,
  });

  const result = await processRunnerQueueItem(
    {
      runId: "RUN-010C",
      prompt: "Run check",
      policy,
      statusCheck: {
        dbPath,
        commandChecks: [{ kind: "custom", command: "npm run migrate", status: "failed", exitCode: 1 }],
        specAlignment: {
          taskId: "TASK-010",
          userStoryIds: ["REQ-043"],
          requirementIds: ["REQ-043"],
          acceptanceCriteriaIds: ["AC-001"],
          coveredRequirementIds: ["REQ-043"],
          testCoverage: true,
        },
      },
    },
    () => ({ status: 1, stdout: '{"type":"result","status":"failed"}', stderr: "check failed" }),
  );

  assert.equal(result.recoveryTask?.route, "review_needed");
  assert.equal(result.recoveryTask?.retrySchedule, undefined);
  assert.equal(result.recoveryDispatchInput?.failure.failed_command, "npm run migrate");
  assert.equal(result.recoveryDispatchInput?.recovery_plan.command, undefined);
  assert.equal(result.recoveryDispatch, undefined);
});


test("Codex adapter records spawn failures as failed result instead of throwing", async () => {
  const policy = resolveRunnerPolicy({
    runId: "RUN-009",
    risk: "low",
    workspaceRoot: makeWorkspacePath(),
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
    runnerModel: "codex 1.2.3",
    policy,
    heartbeats: [heartbeat],
    queue: [{ runId: "RUN-007", status: "running" }],
    logs: [{ id: "LOG-1", runId: "RUN-007", stdout: "ok", stderr: "", events: [], createdAt: stableDate.toISOString() }],
    now: new Date("2026-04-28T12:00:20.000Z"),
  });

  assert.equal(snapshot.online, true);
  assert.equal(snapshot.heartbeatStale, false);
  assert.equal(snapshot.sandboxMode, "danger-full-access");
  assert.equal(snapshot.approvalPolicy, "never");
  assert.equal(snapshot.queue[0].status, "running");
  assert.equal(snapshot.recentLogs[0].stdout, "ok");
});

test("runner artifacts persist for audit and console lookup", async () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const policy = resolveRunnerPolicy({
    runId: "RUN-008",
    risk: "low",
    workspaceRoot: makeWorkspacePath(),
    now: stableDate,
  });
  const heartbeat = recordRunnerHeartbeat({
    runId: policy.runId,
    runnerId: "runner-main",
    policy,
    queueStatus: "completed",
    now: stableDate,
  });
  const adapter = await runCliAdapter({
    policy,
    prompt: "Produce output",
    outputSchemaPath: "/tmp/runner-output.schema.json",
    now: stableDate,
    runner: () => ({ status: 0, stdout: '{"type":"session","session_id":"S-1"}', stderr: "" }),
  });

  persistCliRunnerArtifacts(dbPath, {
    policy,
    heartbeat,
    session: adapter.session,
    rawLog: adapter.rawLog,
  });

  const rows = runSqlite(dbPath, [], [
    { name: "policy", sql: "SELECT sandbox_mode, approval_policy, model, reasoning_effort FROM runner_policies WHERE id = ?", params: [policy.id] },
    { name: "heartbeat", sql: "SELECT queue_status FROM runner_heartbeats WHERE id = ?", params: [heartbeat.id] },
    { name: "session", sql: "SELECT session_id, exit_code FROM cli_session_records WHERE id = ?", params: [adapter.session.id] },
    { name: "log", sql: "SELECT events_json FROM raw_execution_logs WHERE id = ?", params: [adapter.rawLog.id] },
  ]);

  assert.equal(rows.queries.policy[0].sandbox_mode, "danger-full-access");
  assert.equal(rows.queries.policy[0].approval_policy, "never");
  assert.equal(rows.queries.policy[0].model, "gpt-5.3-codex-spark");
  assert.equal(rows.queries.policy[0].reasoning_effort, "medium");
  assert.equal(rows.queries.heartbeat[0].queue_status, "completed");
  assert.equal(rows.queries.session[0].session_id, "S-1");
  assert.equal(rows.queries.session[0].exit_code, 0);
  assert.equal(JSON.parse(String(rows.queries.log[0].events_json)).length, 1);
});

test("log redaction covers common secret formats", () => {
  assert.equal(redactLog("token=abc password: hunter2 api_key=xyz postgres://user:pass@host/db"), "token=[REDACTED] password: [REDACTED] api_key=[REDACTED] postgres://[REDACTED]");
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "specdrive-cli-adapter-")), "control-plane.sqlite");
}

function makeWorkspacePath(): string {
  return mkdtempSync(join(tmpdir(), "specdrive-codex-workspace-"));
}
