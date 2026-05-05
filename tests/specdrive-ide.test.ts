import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import { readFileSpecState } from "../src/spec-protocol.ts";
import {
  buildSpecDriveIdeExecutionDetail,
  buildSpecDriveIdeView,
  hashSpecSourceText,
  parseFeatureTasksMarkdown,
  submitIdeQueueCommand,
  submitIdeSpecChangeRequest,
} from "../src/specdrive-ide.ts";
import { submitConsoleCommand } from "../src/product-console.ts";
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
  assert.equal(view.specRoot, "docs");
  assert.equal(view.language, undefined);
  assert.equal(view.project?.id, "project-ide");
  assert.equal(view.activeAdapter?.id, "codex-rpc");
  assert.equal(view.automation.status, "idle");
  assert.equal(view.automation.source, "project");
  assert.equal(view.projectInitialization.ready, true);
  assert.equal(view.documents.find((document) => document.kind === "prd")?.exists, true);
  assert.equal(view.documents.find((document) => document.kind === "hld")?.path, "docs/hld.md");
  assert.equal(view.documents.find((document) => document.kind === "ui-spec")?.path, "docs/ui/ui-spec.md");
  assert.equal(view.documents.find((document) => document.kind === "ui-spec")?.exists, true);
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "copy_skill_runtime")?.status, "Ready");
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "copy_skill_runtime")?.label, ".agents skill runtime initialized");

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

test("SpecDrive IDE prefers root docs over localized specs unless multilingual is explicit", () => {
  const workspaceRoot = makeWorkspace();
  mkdirSync(join(workspaceRoot, "docs", "zh-CN"), { recursive: true });
  writeFileSync(join(workspaceRoot, "docs", "zh-CN", "PRD.md"), "# Localized PRD\n");
  writeFileSync(join(workspaceRoot, "docs", "zh-CN", "requirements.md"), "# Localized Requirements\n");
  writeFileSync(join(workspaceRoot, "docs", "zh-CN", "hld.md"), "# Localized HLD\n");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.specRoot, "docs");
  assert.equal(view.language, undefined);
  assert.equal(view.documents.find((document) => document.kind === "prd")?.path, "docs/PRD.md");
});

test("SpecDrive IDE uses localized docs only for explicit multilingual projects", () => {
  const workspaceRoot = makeWorkspace();
  rmRootProjectDocs(workspaceRoot);
  mkdirSync(join(workspaceRoot, "docs", "en"), { recursive: true });
  mkdirSync(join(workspaceRoot, "docs", "zh-CN"), { recursive: true });
  writeFileSync(join(workspaceRoot, "docs", "README.md"), "Default language: English\n\nLanguages: English | 中文\n");
  writeFileSync(join(workspaceRoot, "docs", "en", "PRD.md"), "# English PRD\n");
  writeFileSync(join(workspaceRoot, "docs", "en", "requirements.md"), "# English Requirements\n");
  writeFileSync(join(workspaceRoot, "docs", "en", "hld.md"), "# English HLD\n");
  writeFileSync(join(workspaceRoot, "docs", "zh-CN", "PRD.md"), "# Chinese PRD\n");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.specRoot, "docs/en");
  assert.equal(view.language, "en");
  assert.equal(view.documents.find((document) => document.kind === "prd")?.path, "docs/en/PRD.md");
});

test("SpecDrive IDE automation state follows latest auto-run audit event", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO audit_timeline_events (id, entity_type, entity_id, event_type, source, reason, payload_json, created_at)
        VALUES ('AUDIT-PAUSE-AUTO', 'runner', 'runner-main', 'console_command_pause_runner', 'product_console', 'Pause auto run.', '{}', '2026-05-04T10:00:00.000Z')`,
    },
  ]);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.automation.status, "paused");
  assert.equal(view.automation.updatedAt, "2026-05-04T10:00:00.000Z");
  assert.equal(view.automation.source, "audit");
});

test("SpecDrive IDE automation state changes after start and pause commands", () => {
  const workspaceRoot = makeWorkspace();
  writeFileSync(join(workspaceRoot, "docs/features/feature-pool-queue.json"), JSON.stringify({
    schemaVersion: 1,
    features: [
      { id: "FEAT-016", priority: "P1", dependencies: [] },
    ],
  }));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  const scheduler = createMemoryScheduler(dbPath);

  submitConsoleCommand(dbPath, {
    action: "start_auto_run",
    entityType: "project",
    entityId: "project-ide",
    requestedBy: "vscode-extension",
    reason: "Start auto run from test.",
    now: new Date("2026-05-04T10:01:00.000Z"),
  }, { scheduler });
  const started = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  submitConsoleCommand(dbPath, {
    action: "pause_runner",
    entityType: "runner",
    entityId: "runner-main",
    requestedBy: "vscode-extension",
    reason: "Pause auto run from test.",
    payload: { projectId: "project-ide" },
    now: new Date("2026-05-04T10:02:00.000Z"),
  }, { scheduler });
  const paused = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(started.automation.status, "running");
  assert.equal(paused.automation.status, "paused");
});

test("SpecDrive IDE automation state changes through HTTP workbench commands", async () => {
  const workspaceRoot = makeWorkspace();
  writeFileSync(join(workspaceRoot, "docs/features/feature-pool-queue.json"), JSON.stringify({
    schemaVersion: 1,
    features: [
      { id: "FEAT-016", priority: "P1", dependencies: [] },
    ],
  }));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  const scheduler = createMemoryScheduler(dbPath);
  const config = makeConfig(workspaceRoot, dbPath);
  const controlPlane = createControlPlaneServer(config, {
    status: "ready",
    version: "test",
    schemaVersion: 23,
    artifactRoot: join(workspaceRoot, ".autobuild"),
  }, { scheduler });

  await listen(controlPlane.server, config);
  const address = controlPlane.server.address();
  const port = address && typeof address === "object" ? address.port : 0;

  try {
    const initial = await getJson(`http://127.0.0.1:${port}/ide/spec-tree?workspaceRoot=${encodeURIComponent(workspaceRoot)}`);
    assert.equal(initial.automation.status, "idle");

    const startReceipt = await postJson(`http://127.0.0.1:${port}/ide/commands`, {
      action: "start_auto_run",
      entityType: "project",
      entityId: "project-ide",
      requestedBy: "vscode-extension",
      reason: "Start auto run from Execution Workbench.",
    });
    assert.equal(startReceipt.status, "accepted");

    const started = await getJson(`http://127.0.0.1:${port}/ide/spec-tree?workspaceRoot=${encodeURIComponent(workspaceRoot)}`);
    assert.equal(started.automation.status, "running");

    const pauseReceipt = await postJson(`http://127.0.0.1:${port}/ide/commands`, {
      action: "pause_runner",
      entityType: "runner",
      entityId: "runner-main",
      requestedBy: "vscode-extension",
      reason: "Pause auto run from Execution Workbench.",
      payload: { projectId: "project-ide" },
    });
    assert.equal(pauseReceipt.status, "accepted");

    const paused = await getJson(`http://127.0.0.1:${port}/ide/spec-tree?workspaceRoot=${encodeURIComponent(workspaceRoot)}`);
    assert.equal(paused.automation.status, "paused");
  } finally {
    await new Promise<void>((resolve, reject) => {
      controlPlane.server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("SpecDrive IDE automation state switches on even when no feature can be selected", async () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  const scheduler = createMemoryScheduler(dbPath);
  const config = makeConfig(workspaceRoot, dbPath);
  const controlPlane = createControlPlaneServer(config, {
    status: "ready",
    version: "test",
    schemaVersion: 23,
    artifactRoot: join(workspaceRoot, ".autobuild"),
  }, { scheduler });

  await listen(controlPlane.server, config);
  const address = controlPlane.server.address();
  const port = address && typeof address === "object" ? address.port : 0;

  try {
    const startReceipt = await postJson(`http://127.0.0.1:${port}/ide/commands`, {
      action: "start_auto_run",
      entityType: "project",
      entityId: "project-ide",
      requestedBy: "vscode-extension",
      reason: "Start auto run from Execution Workbench.",
    });
    assert.equal(startReceipt.status, "accepted");

    const afterStart = await getJson(`http://127.0.0.1:${port}/ide/spec-tree?workspaceRoot=${encodeURIComponent(workspaceRoot)}`);
    assert.equal(afterStart.automation.status, "running");
    assert.equal(afterStart.queue.groups.queued?.length ?? 0, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      controlPlane.server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("SpecDrive IDE automation state uses latest audit write when timestamps tie", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  runSqlite(dbPath, [
    { sql: "UPDATE projects SET automation_enabled = 1 WHERE id = 'project-ide'" },
    {
      sql: `INSERT INTO audit_timeline_events (id, entity_type, entity_id, event_type, source, reason, payload_json, created_at)
        VALUES ('AUDIT-PAUSE-TIE', 'runner', 'runner-main', 'console_command_pause_runner', 'product_console', 'Pause auto run.', '{}', '2026-05-04 10:00:00')`,
    },
    {
      sql: `INSERT INTO audit_timeline_events (id, entity_type, entity_id, event_type, source, reason, payload_json, created_at)
        VALUES ('AUDIT-START-TIE', 'project', 'project-ide', 'console_command_start_auto_run', 'product_console', 'Start auto run.', '{}', '2026-05-04 10:00:00')`,
    },
  ]);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.automation.status, "running");
});

test("SpecDrive IDE keeps unregistered PRD-only workspace active for project initialization", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "specdrive-ide-prd-only-"));
  mkdirSync(join(workspaceRoot, "docs"), { recursive: true });
  writeFileSync(join(workspaceRoot, "docs/PRD.md"), "# PRD\n");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.project?.id, undefined);
  assert.equal(view.projectInitialization.ready, false);
  assert.equal(view.projectInitialization.blocked, false);
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "create_or_import_project")?.status, "Draft");
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "connect_git_repository")?.status, "Draft");
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "initialize_spec_protocol")?.status, "Draft");
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "copy_skill_runtime")?.status, "Draft");
  assert.equal(view.projectInitialization.steps.find((step) => step.key === "current_project_context")?.status, "Draft");
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

test("SpecDrive IDE view promotes draft index status when task slices are complete", () => {
  const workspaceRoot = makeWorkspace();
  writeFileSync(join(workspaceRoot, "docs/features/README.md"), [
    "# Feature Spec Index",
    "",
    "| Feature ID | Feature | Folder | Status | Primary Requirements | Suggested Milestone | Dependencies |",
    "|---|---|---|---|---|---|---|",
    "| FEAT-016 | SpecDrive IDE Foundation | `feat-016-specdrive-ide-foundation` | draft | REQ-074、REQ-075 | M8 | FEAT-013 |",
    "",
  ].join("\n"));
  rmSync(join(workspaceRoot, "docs/features/feat-016-specdrive-ide-foundation/spec-state.json"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });
  const feature = view.features.find((entry) => entry.id === "FEAT-016");

  assert.equal(feature?.status, "ready");
});

test("SpecDrive IDE view supports legacy feature index without Folder column", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "specdrive-ide-legacy-index-"));
  mkdirSync(join(workspaceRoot, ".autobuild"), { recursive: true });
  mkdirSync(join(workspaceRoot, "docs/features/FEAT-001"), { recursive: true });
  writeFileSync(join(workspaceRoot, "docs/PRD.md"), "# PRD\n");
  writeFileSync(join(workspaceRoot, "docs/features/README.md"), [
    "# Feature Specs",
    "",
    "| Feature ID | Status | Name | Milestone | Dependencies |",
    "| --- | --- | --- | --- | --- |",
    "| FEAT-001 | planned | Android Project Foundation | V1.0 Foundation | - |",
    "",
  ].join("\n"));
  writeFileSync(join(workspaceRoot, "docs/features/feature-pool-queue.json"), JSON.stringify({
    version: 1,
    features: [
      { id: "FEAT-001", priority: "P1", status: "planned", dependencies: [] },
    ],
  }));
  writeFileSync(join(workspaceRoot, "docs/features/FEAT-001/requirements.md"), "# FEAT-001 requirements\n");
  writeFileSync(join(workspaceRoot, "docs/features/FEAT-001/design.md"), "# FEAT-001 design\n");
  writeFileSync(join(workspaceRoot, "docs/features/FEAT-001/tasks.md"), [
    "# FEAT-001 tasks",
    "",
    "- [ ] T001 Create Android project foundation.",
    "",
  ].join("\n"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });
  const feature = view.features.find((entry) => entry.id === "FEAT-001");

  assert.equal(feature?.folder, "FEAT-001");
  assert.equal(feature?.title, "Android Project Foundation");
  assert.equal(feature?.status, "ready");
  assert.deepEqual(feature?.blockedReasons, []);
  assert.equal(feature?.documents.find((document) => document.kind === "feature-tasks")?.path, "docs/features/FEAT-001/tasks.md");
});

test("SpecDrive IDE keeps completed Feature projection after later cancelled scheduling noise", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "specdrive-ide-completed-feature-"));
  mkdirSync(join(workspaceRoot, ".autobuild"), { recursive: true });
  mkdirSync(join(workspaceRoot, "docs/features/FEAT-001"), { recursive: true });
  writeFileSync(join(workspaceRoot, "docs/PRD.md"), "# PRD\n");
  writeFileSync(join(workspaceRoot, "docs/features/README.md"), [
    "# Feature Specs",
    "",
    "| Feature ID | Status | Name | Milestone | Dependencies |",
    "| --- | --- | --- | --- | --- |",
    "| FEAT-001 | done | Android Project Foundation | V1.0 Foundation | - |",
    "",
  ].join("\n"));
  writeFileSync(join(workspaceRoot, "docs/features/feature-pool-queue.json"), JSON.stringify({
    version: 1,
    features: [
      { id: "FEAT-001", priority: "P1", status: "done", dependencies: [] },
    ],
  }));
  writeFileSync(join(workspaceRoot, "docs/features/FEAT-001/requirements.md"), "# FEAT-001 requirements\n");
  writeFileSync(join(workspaceRoot, "docs/features/FEAT-001/design.md"), "# FEAT-001 design\n");
  writeFileSync(join(workspaceRoot, "docs/features/FEAT-001/tasks.md"), "- [x] T001 Create Android project foundation.\n");
  writeFileSync(join(workspaceRoot, "docs/features/FEAT-001/spec-state.json"), JSON.stringify({
    schemaVersion: 1,
    featureId: "FEAT-001",
    status: "completed",
    currentJob: { executionId: "RUN-DONE", schedulerJobId: "JOB-DONE" },
    blockedReasons: [],
    dependencies: [],
    nextAction: "Run verification outside sandbox.",
  }));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, updated_at)
        VALUES ('JOB-DONE', 'bull-done', 'specdrive:execution-adapter', 'rpc.run', 'completed', '{}', '2026-05-05T10:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, started_at, completed_at, summary, metadata_json)
        VALUES ('RUN-DONE', 'JOB-DONE', 'codex.rpc', 'feature_execution', 'project-ide', ?, 'completed', '2026-05-05T10:00:00.000Z', '2026-05-05T10:05:00.000Z', 'Completed.', '{}')`,
      params: [JSON.stringify({ featureId: "FEAT-001" })],
    },
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, updated_at)
        VALUES ('JOB-CANCELLED', 'bull-cancelled', 'specdrive:execution-adapter', 'rpc.run', 'cancelled', '{}', '2026-05-05T11:00:00.000Z')`,
    },
    {
      sql: `INSERT INTO execution_records (id, scheduler_job_id, executor_type, operation, project_id, context_json, status, started_at, completed_at, summary, metadata_json)
        VALUES ('RUN-CANCELLED', 'JOB-CANCELLED', 'codex.rpc', 'feature_execution', 'project-ide', ?, 'cancelled', '2026-05-05T11:00:00.000Z', '2026-05-05T11:01:00.000Z', 'Cancelled duplicate schedule.', '{}')`,
      params: [JSON.stringify({ featureId: "FEAT-001" })],
    },
  ]);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });
  const feature = view.features.find((entry) => entry.id === "FEAT-001");

  assert.equal(feature?.status, "completed");
  assert.equal(feature?.latestExecutionId, "RUN-DONE");
  assert.equal(feature?.latestExecutionStatus, "completed");
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

test("SpecDrive IDE queue actions operate on schedule-only jobs", async () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "JOB-SCHEDULE-ONLY",
        "bull-schedule-only",
        "specdrive:execution-adapter",
        "cli.run",
        "queued",
        JSON.stringify({
          projectId: "project-ide",
          operation: "feature_execution",
          requestedAction: "feature_execution",
          context: { projectId: "project-ide", featureId: "FEAT-016", taskId: "TASK-SCHEDULE-ONLY", skillSlug: "codex-coding-skill" },
        }),
        "2026-05-02T12:07:00.000Z",
      ],
    },
  ]);
  const scheduler = createMemoryScheduler(dbPath);

  const runNow = await submitIdeQueueCommand(dbPath, {
    schemaVersion: 1,
    ideCommandType: "queue_action",
    projectId: "project-ide",
    workspaceRoot,
    queueAction: "run_now",
    entityType: "job",
    entityId: "JOB-SCHEDULE-ONLY",
    requestedBy: "vscode-extension",
    reason: "Run selected schedule-only job now.",
  }, { scheduler, now: new Date("2026-05-02T12:08:00.000Z") });
  const cancel = await submitIdeQueueCommand(dbPath, {
    schemaVersion: 1,
    ideCommandType: "queue_action",
    projectId: "project-ide",
    workspaceRoot,
    queueAction: "cancel",
    entityType: "job",
    entityId: "JOB-SCHEDULE-ONLY",
    requestedBy: "vscode-extension",
    reason: "Cancel selected schedule-only job.",
  }, { now: new Date("2026-05-02T12:09:00.000Z") });

  assert.equal(runNow.status, "accepted");
  assert.equal(runNow.schedulerJobId, scheduler.jobs[0].schedulerJobId);
  const queuedPayload = JSON.parse(String(runSqlite(dbPath, [], [
    { name: "job", sql: "SELECT payload_json FROM scheduler_job_records WHERE id = ?", params: [runNow.schedulerJobId] },
  ]).queries.job[0].payload_json));
  assert.equal(queuedPayload.context.featureId, "FEAT-016");
  assert.equal(queuedPayload.context.taskId, "TASK-SCHEDULE-ONLY");
  assert.equal(cancel.status, "accepted");
  assert.equal(runSqlite(dbPath, [], [
    { name: "job", sql: "SELECT status FROM scheduler_job_records WHERE id = 'JOB-SCHEDULE-ONLY'" },
  ]).queries.job[0].status, "cancelled");
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

test("SpecDrive IDE diagnostics suppress stale failed executions after a newer success", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  seedFailedRuntimeState(dbPath);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO scheduler_job_records (id, bullmq_job_id, queue_name, job_type, status, payload_json, updated_at)
        VALUES ('JOB-LATEST-SUCCESS', 'bull-latest-success', 'specdrive:execution-adapter', 'rpc.run', 'completed', '{}', '2026-05-02T12:03:00.000Z')`,
    },
    {
      sql: `INSERT INTO execution_records (
        id, scheduler_job_id, executor_type, operation, project_id, context_json,
        status, started_at, completed_at, summary, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "RUN-LATEST-SUCCESS",
        "JOB-LATEST-SUCCESS",
        "codex.rpc",
        "feature_execution",
        "project-ide",
        JSON.stringify({ featureId: "FEAT-016" }),
        "completed",
        "2026-05-02T12:02:00.000Z",
        "2026-05-02T12:03:00.000Z",
        "Latest execution completed.",
        "{}",
      ],
    },
  ]);

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });

  assert.equal(view.features.find((entry) => entry.id === "FEAT-016")?.latestExecutionId, "RUN-LATEST-SUCCESS");
  assert.equal(view.diagnostics.some((diagnostic) => diagnostic.executionId === "RUN-FAILED"), false);
  assert.equal(view.queue.groups.failed?.some((item) => item.executionId === "RUN-FAILED"), true);
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
      payload: { sourcePath: "docs/PRD.md" },
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
      file: "docs/PRD.md",
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
      file: "docs/PRD.md",
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
      file: "docs/requirements.md",
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

test("SpecDrive IDE clarification requests enqueue ambiguity clarification skill", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  const scheduler = createMemoryScheduler(dbPath);
  const sourceText = "# FEAT-016 requirements";

  const receipt = submitIdeSpecChangeRequest(dbPath, {
    schemaVersion: 1,
    projectId: "project-ide",
    workspaceRoot,
    source: {
      file: "docs/features/feat-016-specdrive-ide-foundation/requirements.md",
      range: { startLine: 0, endLine: 0 },
      textHash: hashSpecSourceText(sourceText),
    },
    intent: "clarification",
    comment: "Clarify whether the review gate should block scheduling.",
    targetRequirementId: "REQ-074",
    traceability: ["VSCode Feature Spec Webview", "Feature Review", "FEAT-016"],
  }, { scheduler, now: new Date("2026-05-02T12:14:00.000Z") });

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.routedIntent, "clarification");
  assert.equal(receipt.action, "resolve_clarification");
  assert.equal(receipt.schedulerJobId, scheduler.jobs[0].schedulerJobId);
  const payload = JSON.parse(String(runSqlite(dbPath, [], [
    { name: "jobs", sql: "SELECT payload_json FROM scheduler_job_records WHERE id = ?", params: [scheduler.jobs[0].schedulerJobId] },
  ]).queries.jobs[0].payload_json));
  assert.equal(payload.operation, "resolve_clarification");
  assert.equal(payload.context.skillSlug, "ambiguity-clarification-skill");
  assert.equal(payload.context.skillPhase, "resolve_clarification");
  assert.equal(payload.context.clarificationText, "Clarify whether the review gate should block scheduling.");
  assert.equal(payload.context.featureId, "FEAT-016");
  assert.equal(payload.context.targetRequirementId, "REQ-074");
});

test("SpecDrive IDE pass review command marks review-needed Feature completed", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  writeFileSync(join(workspaceRoot, "docs/features/feat-016-specdrive-ide-foundation/spec-state.json"), JSON.stringify({
    schemaVersion: 1,
    featureId: "FEAT-016",
    status: "review_needed",
    updatedAt: "2026-05-02T12:00:00.000Z",
    blockedReasons: [],
    dependencies: ["FEAT-013"],
    lastResult: {
      status: "review_needed",
      summary: "Implementation needs operator review.",
      producedArtifacts: [],
      completedAt: "2026-05-02T12:00:00.000Z",
    },
    nextAction: "Review Skill output and resolve the open decision.",
    history: [],
  }));
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO features (id, project_id, title, status, priority, folder, primary_requirements_json)
        VALUES ('FEAT-016', 'project-ide', 'SpecDrive IDE Foundation', 'review_needed', 10, 'feat-016-specdrive-ide-foundation', '["REQ-074"]')`,
    },
  ]);

  const receipt = submitConsoleCommand(dbPath, {
    action: "mark_feature_complete",
    entityType: "feature",
    entityId: "FEAT-016",
    requestedBy: "vscode-extension",
    reason: "Approve FEAT-016 review from Feature Spec Webview.",
    payload: { projectId: "project-ide" },
    now: new Date("2026-05-02T12:15:00.000Z"),
  });

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.featureId, "FEAT-016");
  const state = readFileSpecState(workspaceRoot, "feat-016-specdrive-ide-foundation", "FEAT-016");
  assert.equal(state.status, "completed");
  assert.equal(state.lastResult?.status, "completed");
  assert.equal(state.history.at(-1)?.source, "feature-review");
  const row = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-016'" },
  ]).queries.feature[0];
  assert.equal(row.status, "completed");
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

  const view = buildSpecDriveIdeView(dbPath, { workspaceRoot });
  const queueItems = Object.values(view.queue.groups).flat();
  assert.equal(queueItems.some((item) => item.executionId === "RUN-FAILED"), false);
  assert.equal(queueItems.some((item) => item.executionId === receipt.executionId), true);
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
  seedApprovalRuntimeState(dbPath, workspaceRoot);

  const detail = buildSpecDriveIdeExecutionDetail(dbPath, "RUN-APPROVAL");

  assert.equal(detail?.status, "approval_needed");
  assert.equal(detail?.threadId, "thread-approval");
  assert.equal(detail?.turnId, "turn-approval");
  assert.equal(detail?.producedArtifacts.length, 1);
  assert.deepEqual(detail?.rawLogRefs, [
    join(workspaceRoot, ".autobuild", "runs", "RUN-APPROVAL", "cli-input.json"),
    join(workspaceRoot, ".autobuild", "runs", "RUN-APPROVAL", "stdout.log"),
  ]);
  assert.equal(detail?.rawLogs[0].stdout, "approval requested");
  assert.equal(detail?.approvalRequests.length, 1);
  assert.deepEqual(detail?.tokenConsumption, {
    runId: "RUN-APPROVAL",
    schedulerJobId: "JOB-APPROVAL",
    projectId: "project-ide",
    featureId: "FEAT-016",
    taskId: "TASK-001",
    operation: "feature_execution",
    model: "gpt-5.5",
    inputTokens: 1200,
    cachedInputTokens: 200,
    outputTokens: 320,
    reasoningOutputTokens: 80,
    totalTokens: 1600,
    costUsd: 0.00524,
    currency: "USD",
    pricingStatus: "priced",
    usage: { inputTokens: 1200, cachedInputTokens: 200, outputTokens: 320, reasoningOutputTokens: 80, totalTokens: 1600 },
    pricing: { model: "gpt-5.5", inputUsdPer1M: 1.25, cachedInputUsdPer1M: 0.125, outputUsdPer1M: 10, reasoningOutputUsdPer1M: 10 },
    sourcePath: join(workspaceRoot, ".autobuild", "runs", "RUN-APPROVAL", "stdout.log"),
    recordedAt: "2026-05-02T12:00:06.000Z",
  });
  assert.deepEqual(detail?.skillOutputContract, {
    contractVersion: "skill-contract/v1",
    executionId: "RUN-APPROVAL",
    skillSlug: "codex-coding-skill",
    requestedAction: "feature_execution",
    status: "completed",
    summary: "Approval requested.",
    nextAction: "Resolve approval request.",
    producedArtifacts: [{ path: "src/example.ts", kind: "typescript", status: "updated" }],
    traceability: { featureId: "FEAT-016", taskId: "TASK-001", requirementIds: ["REQ-084"], changeIds: [] },
    result: { blockers: ["approval_requested"] },
  });
  assert.deepEqual(detail?.contractValidation, { valid: true });
});

test("SpecDrive IDE execution detail can read incremental raw logs", () => {
  const workspaceRoot = makeWorkspace();
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedProject(dbPath, workspaceRoot);
  seedApprovalRuntimeState(dbPath, workspaceRoot);
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
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "docs/ui"), { recursive: true });
  mkdirSync(join(root, "docs/features/feat-016-specdrive-ide-foundation"), { recursive: true });
  writeFileSync(join(root, "docs/PRD.md"), "# PRD\n");
  writeFileSync(join(root, "docs/requirements.md"), "# Requirements\n");
  writeFileSync(join(root, "docs/hld.md"), "# HLD\n");
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

function rmRootProjectDocs(root: string): void {
  for (const fileName of ["PRD.md", "requirements.md", "hld.md"]) {
    rmSync(join(root, "docs", fileName), { force: true });
  }
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
        0,
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

function seedApprovalRuntimeState(dbPath: string, workspaceRoot: string): void {
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
          rawLogRefs: [
            join(workspaceRoot, ".autobuild", "runs", "RUN-APPROVAL", "cli-input.json"),
            join(workspaceRoot, ".autobuild", "runs", "RUN-APPROVAL", "stdout.log"),
          ],
          skillOutputContract: {
            contractVersion: "skill-contract/v1",
            executionId: "RUN-APPROVAL",
            skillSlug: "codex-coding-skill",
            requestedAction: "feature_execution",
            status: "completed",
            summary: "Approval requested.",
            nextAction: "Resolve approval request.",
            producedArtifacts: [{ path: "src/example.ts", kind: "typescript", status: "updated" }],
            traceability: { featureId: "FEAT-016", taskId: "TASK-001", requirementIds: ["REQ-084"], changeIds: [] },
            result: { blockers: ["approval_requested"] },
          },
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
    {
      sql: `INSERT INTO token_consumption_records (
          id, run_id, scheduler_job_id, project_id, feature_id, task_id, operation, model,
          input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
          cost_usd, currency, pricing_status, usage_json, pricing_json, source_path, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "TOKEN-APPROVAL",
        "RUN-APPROVAL",
        "JOB-APPROVAL",
        "project-ide",
        "FEAT-016",
        "TASK-001",
        "feature_execution",
        "gpt-5.5",
        1200,
        200,
        320,
        80,
        1600,
        0.00524,
        "USD",
        "priced",
        JSON.stringify({ inputTokens: 1200, cachedInputTokens: 200, outputTokens: 320, reasoningOutputTokens: 80, totalTokens: 1600 }),
        JSON.stringify({ model: "gpt-5.5", inputUsdPer1M: 1.25, cachedInputUsdPer1M: 0.125, outputUsdPer1M: 10, reasoningOutputUsdPer1M: 10 }),
        join(workspaceRoot, ".autobuild", "runs", "RUN-APPROVAL", "stdout.log"),
        "2026-05-02T12:00:06.000Z",
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
