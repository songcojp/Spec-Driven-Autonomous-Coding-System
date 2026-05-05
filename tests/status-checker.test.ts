import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables, SCHEMA_VERSION } from "../src/schema.ts";
import { listAuditEvents, listMetricSamples } from "../src/persistence.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  listSpecAlignmentResults,
  listStatusCheckResults,
  runStatusCheck,
  type StatusCheckerInput,
} from "../src/status-checker.ts";
import { listReviewCenterItems } from "../src/review-center.ts";

test("current schema keeps status checker and removes standalone evidence tables", () => {
  const dbPath = makeDbPath();
  const state = initializeSchema(dbPath);

  assert.equal(SCHEMA_VERSION, 29);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  const tables = listTables(dbPath);
  for (const table of ["status_check_results", "spec_alignment_results", "recovery_attempts", "forbidden_retry_records"]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }
  assert.equal(tables.includes("evidence_packs"), false);
  assert.equal(tables.includes("evidence_attachment_refs"), false);
});

test("status checker persists execution result and marks aligned successful run done", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-done-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const result = runStatusCheck(baseInput(root, dbPath));

  assert.equal(result.status, "done");
  assert.equal(result.executionResult.runId, "RUN-009");
  assert.equal(result.executionResult.runner.stdout, "runner ok");
  assert.equal(listStatusCheckResults(dbPath, "RUN-009")[0].status, "done");
  assert.equal(listStatusCheckResults(dbPath, "RUN-009")[0].executionResult.runner.stdout, "runner ok");
  assert.equal(listSpecAlignmentResults(dbPath, "RUN-009")[0].aligned, true);
  assert.equal(listAuditEvents(dbPath, "run", "RUN-009")[0].eventType, "status_checked");
  assert.equal(listMetricSamples(dbPath).some((metric) => metric.name === "status_check_completed"), true);
});

test("execution result is sanitized for synchronous and persisted consumers", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-sanitized-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    runner: {
      status: "completed",
      exitCode: 0,
      stdout: "token=abc123",
      stderr: "password=hunter2",
    },
  });

  const serialized = JSON.stringify(result.executionResult);
  assert.equal(serialized.includes("abc123"), false);
  assert.equal(serialized.includes("hunter2"), false);
  assert.match(serialized, /\[REDACTED\]/);

  const persisted = JSON.stringify(listStatusCheckResults(dbPath, "RUN-009")[0].executionResult);
  assert.equal(persisted.includes("abc123"), false);
  assert.equal(persisted.includes("hunter2"), false);
});

test("status history returns execution results and alignment for each check", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-history-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  runStatusCheck({ ...baseInput(root, dbPath), runner: { status: "completed", exitCode: 0, stdout: "first", stderr: "" } });
  runStatusCheck({
    ...baseInput(root, dbPath),
    runner: { status: "completed", exitCode: 0, stdout: "second", stderr: "" },
    specAlignment: {
      ...baseInput(root).specAlignment,
      testCoverage: false,
      changedFiles: ["src/status-checker.ts"],
    },
  });

  const history = listStatusCheckResults(dbPath, "RUN-009");
  assert.equal(history.length, 2);
  assert.equal(history[0].executionResult.runner.stdout, "second");
  assert.equal(history[0].specAlignment.aligned, false);
  assert.equal(history[1].executionResult.runner.stdout, "first");
  assert.equal(history[1].specAlignment.aligned, true);
});

test("spec alignment failures and risky files route to Review Center", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-review-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    allowedFiles: ["src/status-checker.ts"],
    forbiddenFiles: ["secrets/**"],
    diff: {
      files: ["src/status-checker.ts", "secrets/prod.env"],
      patch: "password=hunter2",
    },
    specAlignment: {
      taskId: "TASK-009",
      requirementIds: ["REQ-040"],
      acceptanceCriteriaIds: [],
      coveredRequirementIds: [],
      testCoverage: false,
      changedFiles: ["src/status-checker.ts", "secrets/prod.env"],
    },
  });

  assert.equal(result.status, "review_needed");
  assert.equal(result.executionResult.diff.forbiddenFiles.includes("secrets/prod.env"), true);
  assert.deepEqual(result.executionResult.diff.secretFindings, ["password"]);
  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(items.length, 1);
  assert.equal(items[0].triggerReasons.includes("forbidden_file"), true);
  assert.equal(items[0].referenceRefs.length, 0);
  assert.deepEqual(items[0].body.diff, result.executionResult.diff);
});

test("repeated failures past threshold mark active task and feature failed", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-threshold-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, environment, status)
        VALUES ('project-1', 'SpecDrive', 'Automate specs', 'typescript-service', '[]', 'local', 'ready')`,
    },
    {
      sql: `INSERT INTO features (id, project_id, title, status, priority, folder, primary_requirements_json)
        VALUES ('FEAT-009', 'project-1', 'Status Checker', 'implementing', 10, 'feat-009-status-checker', '["REQ-040"]')`,
    },
    {
      sql: `INSERT INTO tasks (id, feature_id, title, status, recovery_state, allowed_files_json)
        VALUES ('TASK-009', 'FEAT-009', 'Run checks', 'running', 'pending', '[]')`,
    },
  ]);

  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    runner: { status: "failed", exitCode: 1, stderr: "test failed" },
    failureHistory: ["failed", "failed"],
    failureThreshold: 3,
  });

  assert.equal(result.status, "failed");
  const persisted = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-009'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-009'" },
  ]);
  assert.equal(persisted.queries.task[0].status, "failed");
  assert.equal(persisted.queries.feature[0].status, "failed");
});

test("missing command results prevent Done", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-no-command-results-"));
  const result = runStatusCheck({
    ...baseInput(root),
    commandChecks: undefined,
    requiredCommandChecks: undefined,
  });

  assert.equal(result.status, "review_needed");
  assert.equal(result.reasons.includes("Command check results are missing."), true);
});

test("persistence failure returns blocked diagnostic result instead of throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-persist-fail-"));
  const result = runStatusCheck({
    ...baseInput(root),
    dbPath: join(root, "uninitialized.db"),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.summary, "Status check blocked because persistence failed.");
  assert.equal(result.reasons.some((reason) => reason.includes("Status check persistence failed")), true);
  assert.equal(result.executionResult.status, "blocked");
});

function baseInput(root: string, dbPath?: string): StatusCheckerInput {
  return {
    runId: "RUN-009",
    taskId: "TASK-009",
    featureId: "FEAT-009",
    projectId: "project-1",
    agentType: "codex",
    workspaceRoot: root,
    dbPath,
    runner: {
      status: "completed",
      exitCode: 0,
      summary: "runner completed",
      stdout: "runner ok",
      stderr: "",
    },
    diff: {
      files: ["src/status-checker.ts", "tests/status-checker.test.ts"],
      summary: "Implemented status checker",
    },
    allowedFiles: ["src/status-checker.ts", "tests/status-checker.test.ts"],
    commandChecks: [
      { kind: "build", command: "npm test", status: "passed", exitCode: 0 },
      { kind: "unit_test", command: "npm test", status: "passed", exitCode: 0 },
      { kind: "integration_test", command: "npm test", status: "passed", exitCode: 0 },
      { kind: "typecheck", command: "node --test", status: "passed", exitCode: 0 },
      { kind: "lint", command: "node --test", status: "passed", exitCode: 0 },
      { kind: "security_scan", command: "secret scan", status: "passed", exitCode: 0 },
    ],
    requiredCommandChecks: ["build", "unit_test", "integration_test", "typecheck", "lint", "security_scan"],
    specAlignment: {
      taskId: "TASK-009",
      userStoryIds: ["REQ-040"],
      requirementIds: ["REQ-040", "REQ-041", "REQ-042"],
      acceptanceCriteriaIds: ["AC-001", "AC-002", "AC-003"],
      coveredRequirementIds: ["REQ-040", "REQ-041", "REQ-042"],
      testCoverage: true,
      changedFiles: ["src/status-checker.ts", "tests/status-checker.test.ts"],
    },
  };
}

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "feat-009-db-")), ".autobuild", "autobuild.db");
}
