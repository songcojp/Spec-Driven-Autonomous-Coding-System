import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  buildSpecDriveIdeExecutionDetail,
  buildSpecDriveIdeView,
  hashSpecSourceText,
  parseFeatureTasksMarkdown,
  submitIdeQueueCommand,
  submitIdeSpecChangeRequest,
} from "../src/specdrive-ide.ts";
import { createControlPlaneServer, listen } from "../src/server.ts";
import { createMemoryScheduler } from "../src/scheduler.ts";
import type { AppConfig } from "../src/config.ts";

test("SpecDrive IDE view recognizes workspace specs, features, queue state, and active adapter", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  seedRuntimeState(dbPath);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.recognized, true);
  assert.equal(view.workspaceRoot, workspaceRoot);
  assert.equal(view.specRoot, "docs/zh-CN");
  assert.equal(view.language, "zh-CN");
  assert.equal(view.project?.id, "project-ide");
  assert.equal(view.activeAdapter?.id, "codex-rpc");
  assert.equal(view.projectInitialization.ready, true);
  assert.equal(view.documents.find((document) => document.kind === "prd")?.exists, true);
  assert.equal(view.documents.find((document) => document.kind === "hld")?.path, "docs/zh-CN/hld.md");
  assert.equal(view.documents.find((document) => document.kind === "ui-spec")?.path, "docs/ui/ui-spec.md");
  assert.equal(view.documents.find((document) => document.kind === "ui-spec")?.exists, true);
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "copy_skill_runtime")?.status, "Ready");

  const feature = view.features.find((entry) => entry.id === "FEAT-016");
  assert.equal(feature?.status, "ready");
  assert.equal(feature?.priority, "P1");
  assert.deepEqual(feature?.dependencies, ["FEAT-013"]);
  assert.equal(feature?.latestExecutionId, "RUN-IDE");
  assert.equal(feature?.latestExecutionStatus, "running");
  assert.equal(feature?.documents.every((document) => document.exists), true);
  assert.equal(feature?.indexStatus, "indexed");
  assert.deepEqual(feature?.tasks.map((task) => [task.id, task.status]), [["TASK-016-01", "done"], ["TASK-016-02", "todo"]]);

  assert.equal(view.queue.groups.running[0].executionId, "RUN-IDE");
  assert.equal(view.queue.groups.running[0].featureId, "FEAT-016");
  assert.deepEqual(view.diagnostics, []);
  assert.equal(view.factSources.includes("execution_records"), true);
});

test("SpecDrive IDE keeps project initialization blocked for an unregistered PRD-only workspace", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "specdrive-ide-prd-only-"));
  mkdirSync(join(workspaceRoot, "docs"), { recursive: true });
  writeFileSync(join(workspaceRoot, "docs/PRD.md"), "# PRD\n");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.project?.id, undefined);
  assert.equal(view.projectInitialization.ready, false);
  assert.equal(view.projectInitialization.blocked, true);
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "create_or_import_project")?.status, "Blocked");
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "connect_git_repository")?.status, "Blocked");
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "initialize_spec_protocol")?.status, "Blocked");
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "copy_skill_runtime")?.status, "Blocked");
});

test("SpecDrive IDE register project command imports an unregistered workspace before continuing initialization", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "specdrive-ide-import-"));
  mkdirSync(join(workspaceRoot, "docs"), { recursive: true });
  writeFileSync(join(workspaceRoot, "docs/PRD.md"), "# PRD\n");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const config = makeConfig(workspaceRoot, dbPath);
  const controlPlane = createControlPlaneServer(config, {
    status: "ready",
    version: "test",
    schemaVersion: 23,
    artifactRoot: join(workspaceRoot, ".autobuild"),
  });

  await listen(controlPlane.server, config);
  const address = controlPlane.server.address();
  const port = address && typeof address === "object" ? address.port : 0;

  try {
    const receipt = await postJson(`http://127.0.0.1:${port}/ide/commands`, {
      action: "register_project",
      entityType: "project",
      entityId: "workspace",
      requestedBy: "vscode-extension",
      reason: "Register current VSCode workspace as a SpecDrive project.",
      payload: { workspaceRoot, projectName: "lottery2" },
    });

    assert.equal(receipt.status, "accepted");
    assert.equal(existsSync(join(workspaceRoot, ".git")), true);
    const view = await getJson(`http://127.0.0.1:${port}/ide/spec-tree?workspaceRoot=${encodeURIComponent(workspaceRoot)}`);
    assert.equal(typeof view.project?.id, "string");
    assert.equal(view.project?.name, "lottery2");
    assert.equal(view.projectInitialization.steps.find((step: { key: string }) => step.key === "connect_git_repository")?.status, "Ready");
  } finally {
    await new Promise<void>((resolve, reject) => {
      controlPlane.server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("SpecDrive IDE connect Git command does not register an unknown workspace", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "specdrive-ide-connect-no-register-"));
  mkdirSync(join(workspaceRoot, "docs"), { recursive: true });
  writeFileSync(join(workspaceRoot, "docs/PRD.md"), "# PRD\n");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const config = makeConfig(workspaceRoot, dbPath);
  const controlPlane = createControlPlaneServer(config, {
    status: "ready",
    version: "test",
    schemaVersion: 23,
    artifactRoot: join(workspaceRoot, ".autobuild"),
  });

  await listen(controlPlane.server, config);
  const address = controlPlane.server.address();
  const port = address && typeof address === "object" ? address.port : 0;

  try {
    const receipt = await postJson(`http://127.0.0.1:${port}/ide/commands`, {
      action: "connect_git_repository",
      entityType: "project",
      entityId: "workspace",
      requestedBy: "vscode-extension",
      reason: "Connect Git repository from Project Initialization lifecycle.",
      payload: { workspaceRoot, projectName: "lottery2" },
    });

    assert.equal(receipt.status, "blocked");
    assert.deepEqual(receipt.blockedReasons, ["Project not found: workspace"]);
    assert.equal(existsSync(join(workspaceRoot, ".git")), false);
    const view = await getJson(`http://127.0.0.1:${port}/ide/spec-tree?workspaceRoot=${encodeURIComponent(workspaceRoot)}`);
    assert.equal(view.project?.id, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => {
      controlPlane.server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("SpecDrive IDE view uses Feature index as identity source and projects tasks.md status", () => {
  const workspaceRoot = makeWorkspace();
  mkdirSync(join(workspaceRoot, "docs/features/feat-099-orphan-feature"), { recursive: true });
  writeFileSync(join(workspaceRoot, "docs/features/feat-099-orphan-feature/requirements.md"), "# FEAT-099\n\nREQ-099\n\n## Acceptance Criteria\n");
  writeFileSync(join(workspaceRoot, "docs/features/feat-099-orphan-feature/design.md"), "# Design\n");
  writeFileSync(join(workspaceRoot, "docs/features/feat-099-orphan-feature/tasks.md"), [
    "# Tasks",
    "",
    "### TASK-099-01 Implement orphan sync",
    "状态: in-progress",
    "描述: Parse from folder even when index is stale.",
    "验证: npm test -- tests/specdrive-ide.test.ts",
    "",
  ].join("\n"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });
  const feature = view.features.find((entry) => entry.id === "FEAT-016");

  assert.equal(view.features.some((entry) => entry.id === "FEAT-099"), false);
  assert.equal(feature?.indexStatus, "indexed");
  assert.equal(feature?.tasks[0].id, "TASK-016-01");
  assert.equal(feature?.tasks[0].status, "done");
  assert.equal(feature?.tasks[1].id, "TASK-016-02");
  assert.equal(feature?.tasks[1].status, "todo");
});

test("parseFeatureTasksMarkdown supports checkbox and status block task formats", () => {
  const tasks = parseFeatureTasksMarkdown([
    "- [x] TASK-001: Completed checkbox task",
    "- [ ] TASK-002: Pending checkbox task",
    "",
    "### T-021-12 Feature 详情 tasks.md 任务解析",
    "状态: todo",
    "描述: 展示任务状态。",
    "验证: npm run ide:build",
  ].join("\n"));

  assert.deepEqual(tasks.map((task) => [task.id, task.status]), [
    ["TASK-001", "done"],
    ["TASK-002", "todo"],
    ["T-021-12", "todo"],
  ]);
  assert.equal(tasks[2].description, "展示任务状态。");
  assert.equal(tasks[2].verification, "npm run ide:build");
});

test("SpecDrive IDE view scopes queue and latest executions to the current workspace project", () => {
  const workspaceRoot = makeWorkspace();
  const otherWorkspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  seedRuntimeState(dbPath);
  seedOtherProjectRuntimeState(dbPath, otherWorkspaceRoot);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "JOB-CURRENT-ONLY",
        "bull-current-only",
        "specdrive:execution-adapter",
        "cli.run",
        "queued",
        JSON.stringify({
          executionId: "RUN-CURRENT-ONLY",
          operation: "feature_execution",
          projectId: "project-ide",
          context: { featureId: "FEAT-016", taskId: "TASK-CURRENT", skillSlug: "codex-coding-skill" },
        }),
        "2026-05-02T12:02:00.000Z",
      ],
    },
  ]);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.project?.id, "project-ide");
  assert.equal(view.features.find((entry) => entry.id === "FEAT-016")?.latestExecutionId, "RUN-IDE");
  assert.equal(view.queue.groups.running.length, 1);
  assert.equal(view.queue.groups.running[0].executionId, "RUN-IDE");
  assert.equal(view.queue.groups.queued.length, 1);
  assert.equal(view.queue.groups.queued[0].schedulerJobId, "JOB-CURRENT-ONLY");
  assert.equal(view.queue.groups.queued[0].featureId, "FEAT-016");
  assert.equal(view.queue.groups.queued[0].taskId, "TASK-CURRENT");
  assert.equal(view.queue.groups.queued[0].adapter, "codex-coding-skill");
  assert.equal(JSON.stringify(view.queue.groups).includes("RUN-OTHER"), false);
  assert.equal(JSON.stringify(view.queue.groups).includes("JOB-OTHER-ONLY"), false);
});

test("SpecDrive IDE view hides completed schedule-only rows from execution queue", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "JOB-SCHEDULE-COMPLETED",
        "bull-schedule-completed",
        "specdrive:execution-adapter",
        "cli.run",
        "completed",
        JSON.stringify({ projectId: "project-ide", requestedAction: "split_feature_specs" }),
        "2026-05-02T12:05:00.000Z",
      ],
    },
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "JOB-SCHEDULE-QUEUED",
        "bull-schedule-queued",
        "specdrive:execution-adapter",
        "cli.run",
        "queued",
        JSON.stringify({ projectId: "project-ide", requestedAction: "generate_ears" }),
        "2026-05-02T12:06:00.000Z",
      ],
    },
  ]);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(JSON.stringify(view.queue.groups).includes("JOB-SCHEDULE-COMPLETED"), false);
  assert.equal(view.queue.groups.queued[0].schedulerJobId, "JOB-SCHEDULE-QUEUED");
  assert.equal(view.queue.groups.queued[0].operation, "generate_ears");
});

test("SpecDrive IDE view exposes diagnostics for blocked spec state and failed executions", () => {
  const workspaceRoot = makeWorkspace();
  writeFileSync(join(workspaceRoot, "docs/features/feat-016-specdrive-ide-foundation/spec-state.json"), JSON.stringify({
    schemaVersion: 1,
    featureId: "FEAT-016",
    status: "blocked",
    updatedAt: "2026-05-02T12:00:00.000Z",
    blockedReasons: ["Missing approval."],
    dependencies: ["FEAT-013"],
    history: [],
  }));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  seedFailedRuntimeState(dbPath);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.diagnostics.length, 2);
  assert.equal(view.diagnostics.some((diagnostic) => diagnostic.source === "spec-state" && diagnostic.message.includes("Missing approval")), true);
  assert.equal(view.diagnostics.some((diagnostic) => diagnostic.source === "execution" && diagnostic.severity === "error"), true);
  assert.equal(view.diagnostics.every((diagnostic) => diagnostic.path === "docs/features/feat-016-specdrive-ide-foundation/requirements.md"), true);
});

test("SpecDrive IDE view warns when feature requirements miss traceability or acceptance criteria", () => {
  const workspaceRoot = makeWorkspace();
  writeFileSync(join(workspaceRoot, "docs/features/feat-016-specdrive-ide-foundation/requirements.md"), "# Feature requirements\n\nNo stable ids yet.\n");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.diagnostics.length, 2);
  assert.equal(view.diagnostics.some((diagnostic) => diagnostic.message.includes("stable requirement id")), true);
  assert.equal(view.diagnostics.some((diagnostic) => diagnostic.message.includes("acceptance criteria")), true);
  assert.equal(view.diagnostics.every((diagnostic) => diagnostic.source === "workspace"), true);
});

test("SpecDrive IDE view reports unrecognized workspace without mutating state", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "specdrive-plain-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.recognized, false);
  assert.deepEqual(view.features, []);
  assert.equal(view.missing.includes("docs/features"), true);
});

test("SpecDrive IDE HTTP routes expose spec tree and controlled command receipts", async () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  const scheduler = createMemoryScheduler(dbPath);
  const config = makeConfig(workspaceRoot, dbPath);
  const controlPlane = createControlPlaneServer(config, {
    status: "ready",
    version: "test",
    schemaVersion: 21,
    artifactRoot: join(workspaceRoot, ".autobuild"),
  }, { scheduler });

  await listen(controlPlane.server, config);
  const address = controlPlane.server.address();
  const port = address && typeof address === "object" ? address.port : 0;

  try {
    const specTree = await getJson(`http://127.0.0.1:${port}/ide/spec-tree?workspaceRoot=${encodeURIComponent(workspaceRoot)}`);
    assert.equal(specTree.recognized, true);
    assert.equal(specTree.features[0].id, "FEAT-016");

    const receipt = await postJson(`http://127.0.0.1:${port}/ide/commands`, {
      action: "generate_ears",
      entityType: "project",
      entityId: "project-ide",
      requestedBy: "vscode-extension",
      reason: "Generate EARS from VSCode CodeLens.",
      payload: { sourcePath: "docs/zh-CN/PRD.md" },
    });

    assert.equal(receipt.status, "accepted");
    assert.equal(typeof receipt.executionId, "string");
    assert.equal(receipt.schedulerJobId, scheduler.jobs[0].schedulerJobId);
    assert.equal(scheduler.jobs[0].jobType, "cli.run");
  } finally {
    await new Promise<void>((resolve, reject) => {
      controlPlane.server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("SpecDrive IDE system settings route exposes shared adapter settings and governed commands", async () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  const config = makeConfig(workspaceRoot, dbPath);
  const controlPlane = createControlPlaneServer(config, {
    status: "ready",
    version: "test",
    schemaVersion: 23,
    artifactRoot: join(workspaceRoot, ".autobuild"),
  });

  await listen(controlPlane.server, config);
  const address = controlPlane.server.address();
  const port = address && typeof address === "object" ? address.port : 0;

  try {
    const settings = await getJson(`http://127.0.0.1:${port}/ide/system-settings`);
    assert.equal((settings.cliAdapter as { active?: { id?: string } }).active?.id, "codex-cli");
    assert.equal((settings.rpcAdapter as { active?: { id?: string } }).active?.id, "codex-rpc-default");

    const invalidReceipt = await postJson(`http://127.0.0.1:${port}/ide/commands`, {
      action: "activate_cli_adapter_config",
      entityType: "cli_adapter",
      entityId: "codex-cli",
      requestedBy: "vscode-extension",
      reason: "Reject invalid CLI adapter from VSCode settings.",
      payload: { config: { id: "codex-cli", status: "disabled" } },
    });
    assert.equal(invalidReceipt.status, "blocked");

    const afterInvalid = await getJson(`http://127.0.0.1:${port}/ide/system-settings`);
    assert.equal((afterInvalid.cliAdapter as { active?: { id?: string } }).active?.id, "codex-cli");

    const receipt = await postJson(`http://127.0.0.1:${port}/ide/commands`, {
      action: "activate_rpc_adapter_config",
      entityType: "rpc_adapter",
      entityId: "gemini-acp-default",
      requestedBy: "vscode-extension",
      reason: "Switch RPC adapter from VSCode settings.",
      payload: {
        config: {
          id: "gemini-acp-default",
          displayName: "Built-in Gemini ACP",
          provider: "gemini-acp",
          executable: "gemini",
          args: ["--acp", "--skip-trust"],
          transport: "stdio",
          endpoint: "stdio://",
          requestTimeoutMs: 120000,
          status: "active",
        },
      },
    });
    assert.equal(receipt.status, "accepted");

    const rpcSettings = await getJson(`http://127.0.0.1:${port}/ide/system-settings`);
    assert.equal((rpcSettings.rpcAdapter as { active?: { id?: string; provider?: string } }).active?.id, "gemini-acp-default");
    assert.equal((rpcSettings.rpcAdapter as { active?: { id?: string; provider?: string } }).active?.provider, "gemini-acp");
  } finally {
    await new Promise<void>((resolve, reject) => {
      controlPlane.server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("SpecDrive IDE SpecChangeRequest validates textHash and routes requirement intake", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  const scheduler = createMemoryScheduler(dbPath);
  const sourceText = "# PRD";

  const receipt = submitIdeSpecChangeRequest(dbPath, {
    schemaVersion: 1,
    projectId: "project-ide",
    workspaceRoot,
    source: {
      file: "docs/zh-CN/PRD.md",
      range: { startLine: 0, endLine: 0 },
      textHash: hashSpecSourceText(sourceText),
    },
    intent: "requirement_intake",
    comment: "Add a new IDE requirement from a comment draft.",
    traceability: ["PRD-IDE"],
  }, { scheduler, now: new Date("2026-05-02T12:10:00.000Z") });

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.routedIntent, "requirement_intake");
  assert.equal(receipt.action, "intake_requirement");
  assert.equal(receipt.schedulerJobId, scheduler.jobs[0].schedulerJobId);
  const result = runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT payload_json FROM scheduler_job_records WHERE id = ?", params: [scheduler.jobs[0].schedulerJobId] },
  ]);
  assert.equal(JSON.parse(String(result.queries.jobs[0].payload_json)).operation, "intake_requirement");

  const staleReceipt = submitIdeSpecChangeRequest(dbPath, {
    schemaVersion: 1,
    projectId: "project-ide",
    workspaceRoot,
    source: {
      file: "docs/zh-CN/PRD.md",
      range: { startLine: 0, endLine: 0 },
      textHash: hashSpecSourceText("old text"),
    },
    intent: "requirement_intake",
    comment: "This should be stale.",
  }, { scheduler, now: new Date("2026-05-02T12:11:00.000Z") });

  assert.equal(staleReceipt.status, "blocked");
  assert.equal("error" in staleReceipt ? staleReceipt.error : undefined, "stale_source");
  assert.equal(staleReceipt.currentTextHash, hashSpecSourceText(sourceText));
  assert.equal(scheduler.jobs.length, 1);
});

test("SpecDrive IDE SpecChangeRequest routes existing requirement changes to spec evolution", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  const scheduler = createMemoryScheduler(dbPath);
  const sourceText = "# Requirements";

  const receipt = submitIdeSpecChangeRequest(dbPath, {
    schemaVersion: 1,
    projectId: "project-ide",
    workspaceRoot,
    source: {
      file: "docs/zh-CN/requirements.md",
      range: { startLine: 0, endLine: 0 },
      textHash: hashSpecSourceText(sourceText),
    },
    intent: "requirement_intake",
    comment: "Change REQ-076 wording.",
    targetRequirementId: "REQ-076",
    traceability: ["FEAT-017"],
  }, { scheduler, now: new Date("2026-05-02T12:12:00.000Z") });

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.routedIntent, "spec_evolution");
  assert.equal(receipt.action, "write_spec_evolution");
  assert.equal(receipt.schedulerJobId, undefined);
});

test("SpecDrive IDE New Feature intent lets model-facing intake handle unknown add-or-change routing", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  const scheduler = createMemoryScheduler(dbPath);
  const sourceText = "# Feature Spec Index";

  const receipt = submitIdeSpecChangeRequest(dbPath, {
    schemaVersion: 1,
    projectId: "project-ide",
    workspaceRoot,
    source: {
      file: "docs/features/README.md",
      range: { startLine: 0, endLine: 0 },
      textHash: hashSpecSourceText(sourceText),
    },
    intent: "requirement_change_or_intake",
    comment: "Top New Feature request that may add or change existing scope.",
    traceability: ["VSCode Feature Spec Webview", "New Feature"],
  }, { scheduler, now: new Date("2026-05-02T12:13:00.000Z") });

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.routedIntent, "requirement_intake");
  assert.equal(receipt.action, "intake_requirement");
  assert.equal(scheduler.jobs[0].jobType, "cli.run");
  const payload = JSON.parse(String(runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT payload_json FROM scheduler_job_records WHERE id = ?", params: [scheduler.jobs[0].schedulerJobId] },
  ]).queries.jobs[0].payload_json));
  assert.equal(payload.operation, "intake_requirement");
  assert.equal(payload.context.requirementText, "Top New Feature request that may add or change existing scope.");
});

test("SpecDrive IDE queue actions retry failed executions and preserve previous execution linkage", async () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  seedFailedRuntimeState(dbPath);
  const scheduler = createMemoryScheduler(dbPath);

  const receipt = await submitIdeQueueCommand(dbPath, {
    schemaVersion: 1,
    ideCommandType: "queue_action",
    projectId: "project-ide",
    workspaceRoot,
    queueAction: "retry",
    entityType: "run",
    entityId: "RUN-FAILED",
    requestedBy: "vscode-extension",
    reason: "Retry failed app-server turn from VSCode.",
  }, { scheduler, now: new Date("2026-05-02T12:20:00.000Z") });

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.previousExecutionId, "RUN-FAILED");
  assert.equal(typeof receipt.executionId, "string");
  assert.equal(scheduler.jobs[0].jobType, "rpc.run");
  const rows = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT scheduler_job_id, status, context_json, metadata_json FROM execution_records WHERE id = ?", params: [receipt.executionId] },
  ]).queries.run;
  assert.equal(rows[0].scheduler_job_id, receipt.schedulerJobId);
  assert.equal(rows[0].status, "queued");
  assert.equal(JSON.parse(String(rows[0].context_json)).previousExecutionId, "RUN-FAILED");
  assert.equal(JSON.parse(String(rows[0].metadata_json)).previousExecutionId, "RUN-FAILED");
});

test("SpecDrive IDE running cancel calls app-server turn interrupt before marking cancelled", async () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  seedRuntimeState(dbPath);
  const interrupts: Array<{ threadId: string; turnId: string; executionId: string }> = [];

  const receipt = await submitIdeQueueCommand(dbPath, {
    schemaVersion: 1,
    ideCommandType: "queue_action",
    projectId: "project-ide",
    workspaceRoot,
    queueAction: "cancel",
    entityType: "run",
    entityId: "RUN-IDE",
    requestedBy: "vscode-extension",
    reason: "Cancel running turn.",
  }, {
    now: new Date("2026-05-02T12:21:00.000Z"),
    interruptTurn: async (input) => {
      interrupts.push(input);
      return { interrupted: true };
    },
  });

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.interruptResult?.interrupted, true);
  assert.deepEqual(interrupts.map((entry) => [entry.executionId, entry.threadId, entry.turnId]), [["RUN-IDE", "thread-1", "turn-1"]]);
  const rows = runSqlite(dbPath, [], [
    { name: "job", sql: "SELECT status FROM scheduler_job_records WHERE id = 'JOB-IDE'" },
    { name: "run", sql: "SELECT status, completed_at, metadata_json FROM execution_records WHERE id = 'RUN-IDE'" },
  ]).queries;
  assert.equal(rows.job[0].status, "cancelled");
  assert.equal(rows.run[0].status, "cancelled");
  assert.equal(typeof rows.run[0].completed_at, "string");
  assert.equal(JSON.parse(String(rows.run[0].metadata_json)).interruptResult.interrupted, true);
});

test("SpecDrive IDE execution detail includes projection logs, artifacts, contract validation, and approval requests", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  seedApprovalRuntimeState(dbPath);

  const detail = buildSpecDriveIdeExecutionDetail(dbPath, "RUN-APPROVAL");

  assert.equal(detail?.status, "approval_needed");
  assert.equal(detail?.threadId, "thread-approval");
  assert.equal(detail?.turnId, "turn-approval");
  assert.equal(detail?.producedArtifacts.length, 1);
  assert.equal(detail?.rawLogs[0].stdout, "approval requested");
  assert.equal(detail?.approvalRequests.length, 1);
  assert.deepEqual(detail?.contractValidation, { valid: true });
});

test("SpecDrive IDE execution detail can read incremental raw logs", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  seedApprovalRuntimeState(dbPath);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO raw_execution_logs (id, run_id, stdout, stderr, events_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        "LOG-APPROVAL-2",
        "RUN-APPROVAL",
        "second chunk",
        "",
        "[]",
        "2026-05-02T12:00:10.000Z",
      ],
    },
  ]);

  const detail = buildSpecDriveIdeExecutionDetail(dbPath, "RUN-APPROVAL", {
    logsAfter: "2026-05-02T12:00:05.000Z",
    logLimit: 1,
  });

  assert.equal(detail?.rawLogs.length, 1);
  assert.equal(detail?.rawLogs[0].stdout, "second chunk");
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "specdrive-ide-db-")), "autobuild.db");
}

function makeConfig(workspaceRoot: string, dbPath: string): AppConfig {
  return {
    projectRoot: workspaceRoot,
    port: 0,
    artifactRoot: join(workspaceRoot, ".autobuild"),
    dbPath,
    logLevel: "error",
    runnerConfig: {
      command: "codex",
      args: ["exec"],
      sandboxMode: "danger-full-access",
    },
    schedulerConfig: {
      redisUrl: "redis://127.0.0.1:6379",
      workerMode: "off",
    },
  };
}

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "specdrive-ide-workspace-"));
  mkdirSync(join(root, ".autobuild"), { recursive: true });
  mkdirSync(join(root, ".agents/skills/requirement-intake-skill"), { recursive: true });
  mkdirSync(join(root, "docs/zh-CN"), { recursive: true });
  mkdirSync(join(root, "docs/ui"), { recursive: true });
  mkdirSync(join(root, "docs/features/feat-016-specdrive-ide-foundation"), { recursive: true });
  writeFileSync(join(root, "docs/zh-CN/PRD.md"), "# PRD\n");
  writeFileSync(join(root, "docs/zh-CN/requirements.md"), "# Requirements\n");
  writeFileSync(join(root, "docs/zh-CN/hld.md"), "# HLD\n");
  writeFileSync(join(root, "docs/ui/ui-spec.md"), "# UI Spec\n");
  writeFileSync(join(root, ".agents/skills/requirement-intake-skill/SKILL.md"), "# Requirement intake\n");
  writeFileSync(join(root, "docs/features/README.md"), [
    "# Feature Spec Index",
    "",
    "| Feature ID | Feature | Folder | Status | Primary Requirements | Suggested Milestone | Dependencies |",
    "|---|---|---|---|---|---|---|",
    "| FEAT-016 | SpecDrive IDE Foundation | `feat-016-specdrive-ide-foundation` | ready | REQ-074、REQ-075 | M8 | FEAT-013 |",
    "",
  ].join("\n"));
  writeFileSync(join(root, "docs/features/feature-pool-queue.json"), JSON.stringify({
    schemaVersion: 1,
    features: [
      { id: "FEAT-016", priority: "P1", dependencies: ["FEAT-013"] },
    ],
  }));
  writeFileSync(join(root, "docs/features/feat-016-specdrive-ide-foundation/design.md"), "# design.md\n");
  writeFileSync(join(root, "docs/features/feat-016-specdrive-ide-foundation/tasks.md"), [
    "# FEAT-016 tasks",
    "",
    "- [x] TASK-016-01: Build IDE foundation",
    "- [ ] TASK-016-02: Verify IDE foundation",
    "",
  ].join("\n"));
  writeFileSync(join(root, "docs/features/feat-016-specdrive-ide-foundation/requirements.md"), [
    "# FEAT-016 requirements",
    "",
    "REQ-074 supports a VSCode IDE foundation.",
    "",
    "## Acceptance Criteria",
    "",
    "- Spec Explorer renders workspace facts.",
    "",
  ].join("\n"));
  writeFileSync(join(root, "docs/features/feat-016-specdrive-ide-foundation/spec-state.json"), JSON.stringify({
    schemaVersion: 1,
    featureId: "FEAT-016",
    status: "ready",
    updatedAt: "2026-05-02T12:00:00.000Z",
    blockedReasons: [],
    dependencies: ["FEAT-013"],
    nextAction: "Implement IDE foundation.",
    history: [],
  }));
  return root;
}

function seedProject(dbPath: string, workspaceRoot: string): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO projects (
        id, name, goal, project_type, tech_preferences_json, target_repo_path,
        default_branch, trust_level, environment, automation_enabled, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "project-ide",
        "SpecDrive IDE",
        "Build VSCode-native SpecDrive workspace.",
        "tooling",
        "[]",
        workspaceRoot,
        "main",
        "standard",
        "local",
        1,
        "created",
      ],
    },
    {
      sql: `INSERT INTO repository_connections (id, project_id, provider, local_path, default_branch)
        VALUES ('repo-ide', 'project-ide', 'local', ?, 'main')`,
      params: [workspaceRoot],
    },
  ]);
}

function seedOtherProjectRuntimeState(dbPath: string, workspaceRoot: string): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO projects (
        id, name, goal, project_type, tech_preferences_json, target_repo_path,
        default_branch, trust_level, environment, automation_enabled, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "project-other",
        "Other SpecDrive Workspace",
        "Keep another workspace isolated.",
        "tooling",
        "[]",
        workspaceRoot,
        "main",
        "standard",
        "local",
        1,
        "created",
      ],
    },
    {
      sql: `INSERT INTO repository_connections (id, project_id, provider, local_path, default_branch)
        VALUES ('repo-other', 'project-other', 'local', ?, 'main')`,
      params: [workspaceRoot],
    },
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "JOB-OTHER",
        "bull-other",
        "specdrive:execution-adapter",
        "rpc.run",
        "running",
        JSON.stringify({ executionId: "RUN-OTHER", operation: "feature_execution", projectId: "project-other", context: { featureId: "FEAT-016" } }),
        "2026-05-02T12:03:00.000Z",
      ],
    },
    {
      sql: `INSERT INTO execution_records (
        id, scheduler_job_id, executor_type, operation, project_id, context_json,
        status, started_at, summary, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "RUN-OTHER",
        "JOB-OTHER",
        "codex.rpc",
        "feature_execution",
        "project-other",
        JSON.stringify({ featureId: "FEAT-016", taskId: "TASK-OTHER" }),
        "running",
        "2026-05-02T12:03:00.000Z",
        "Running in another workspace.",
        JSON.stringify({ threadId: "thread-other", turnId: "turn-other" }),
      ],
    },
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "JOB-OTHER-ONLY",
        "bull-other-only",
        "specdrive:execution-adapter",
        "cli.run",
        "queued",
        JSON.stringify({ executionId: "RUN-OTHER-ONLY", operation: "feature_execution", projectId: "project-other", context: { featureId: "FEAT-016" } }),
        "2026-05-02T12:04:00.000Z",
      ],
    },
  ]);
}

function seedRuntimeState(dbPath: string): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO cli_adapter_configs (
        id, display_name, schema_version, executable, argument_template_json,
        config_schema_json, form_schema_json, defaults_json, environment_allowlist_json,
        output_mapping_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "codex-rpc",
        "Codex RPC",
        1,
        "codex",
        "[]",
        "{}",
        "{}",
        "{}",
        "[]",
        "{}",
        "active",
      ],
    },
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json)
        VALUES ('JOB-IDE', 'bull-ide', 'specdrive:execution-adapter', 'rpc.run', 'running', '{}')`,
    },
    {
      sql: `INSERT INTO execution_records (
        id, scheduler_job_id, executor_type, operation, project_id, context_json,
        status, started_at, summary, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "RUN-IDE",
        "JOB-IDE",
        "codex.rpc",
        "feature_execution",
        "project-ide",
        JSON.stringify({ featureId: "FEAT-016", taskId: "TASK-001" }),
        "running",
        "2026-05-02T12:00:00.000Z",
        "Running IDE foundation.",
        JSON.stringify({ threadId: "thread-1", turnId: "turn-1", skillSlug: "codex-coding-skill" }),
      ],
    },
  ]);
}

function seedFailedRuntimeState(dbPath: string): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json)
        VALUES ('JOB-FAILED', 'bull-failed', 'specdrive:execution-adapter', 'rpc.run', 'failed', '{}')`,
    },
    {
      sql: `INSERT INTO execution_records (
        id, scheduler_job_id, executor_type, operation, project_id, context_json,
        status, started_at, completed_at, summary, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "RUN-FAILED",
        "JOB-FAILED",
        "codex.rpc",
        "feature_execution",
        "project-ide",
        JSON.stringify({ featureId: "FEAT-016" }),
        "failed",
        "2026-05-02T12:00:00.000Z",
        "2026-05-02T12:01:00.000Z",
        "Codex RPC turn failed.",
        JSON.stringify({ threadId: "thread-1", turnId: "turn-1" }),
      ],
    },
  ]);
}

function seedApprovalRuntimeState(dbPath: string): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json)
        VALUES ('JOB-APPROVAL', 'bull-approval', 'specdrive:execution-adapter', 'rpc.run', 'running', '{}')`,
    },
    {
      sql: `INSERT INTO execution_records (
        id, scheduler_job_id, executor_type, operation, project_id, context_json,
        status, started_at, summary, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "RUN-APPROVAL",
        "JOB-APPROVAL",
        "codex.rpc",
        "feature_execution",
        "project-ide",
        JSON.stringify({ featureId: "FEAT-016", taskId: "TASK-001" }),
        "approval_needed",
        "2026-05-02T12:00:00.000Z",
        "Approval requested.",
        JSON.stringify({
          threadId: "thread-approval",
          turnId: "turn-approval",
          skillSlug: "codex-coding-skill",
          approvalState: "pending",
          producedArtifacts: [{ path: "src/example.ts", kind: "typescript", status: "updated" }],
          contractValidation: { valid: true },
        }),
      ],
    },
    {
      sql: `INSERT INTO raw_execution_logs (id, run_id, stdout, stderr, events_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        "LOG-APPROVAL",
        "RUN-APPROVAL",
        "approval requested",
        "",
        JSON.stringify([{ type: "approval/request", threadId: "thread-approval", turnId: "turn-approval", requestId: "approval-1" }]),
        "2026-05-02T12:00:05.000Z",
      ],
    },
  ]);
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return await response.json() as Record<string, unknown>;
}

async function postJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true);
  return await response.json() as Record<string, unknown>;
}
