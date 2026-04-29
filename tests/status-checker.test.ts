import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables, SCHEMA_VERSION } from "../src/schema.ts";
import { listAuditEvents, listMetricSamples } from "../src/persistence.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  listEvidencePacks,
  listSpecAlignmentResults,
  listStatusCheckResults,
  runStatusCheck,
  type StatusCheckerInput,
} from "../src/status-checker.ts";
import { listReviewCenterItems } from "../src/review-center.ts";

test("schema version 12 includes status checker, recovery history, and attachment tables", () => {
  const dbPath = makeDbPath();
  const state = initializeSchema(dbPath);

  assert.equal(SCHEMA_VERSION, 12);
  assert.equal(state.schemaVersion, 12);
  const tables = listTables(dbPath);
  for (const table of ["status_check_results", "spec_alignment_results", "evidence_attachment_refs", "recovery_attempts", "forbidden_retry_records"]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }
});

test("status checker writes deterministic evidence and marks aligned successful run done", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-done-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    attachments: [{ kind: "log", path: ".autobuild/runs/RUN-009.log", description: "runner log" }],
  });

  assert.equal(result.status, "done");
  assert.match(result.evidencePath ?? "", /^\.autobuild\/evidence\/RUN-009-.+\.json$/);
  assert.equal(result.evidencePack.evidenceWriteMs >= 0, true);
  assert.equal(existsSync(join(root, result.evidencePath ?? "")), true);

  const evidence = JSON.parse(readFileSync(join(root, result.evidencePath ?? ""), "utf8"));
  assert.equal(evidence.runId, "RUN-009");
  assert.equal(evidence.status, "done");
  assert.equal(evidence.runner.stdout, "runner ok");

  assert.equal(listEvidencePacks(dbPath, { runId: "RUN-009" }).length, 1);
  assert.equal(listStatusCheckResults(dbPath, "RUN-009")[0].status, "done");
  assert.equal(listSpecAlignmentResults(dbPath, "RUN-009")[0].aligned, true);
  assert.equal(listAuditEvents(dbPath, "run", "RUN-009")[0].eventType, "status_checked");
  assert.equal(listMetricSamples(dbPath).some((metric) => metric.name === "evidence_write_ms"), true);
});

test("persisted evidence metadata is sanitized for query reuse", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-sanitized-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  runStatusCheck({
    ...baseInput(root, dbPath),
    runner: {
      status: "completed",
      exitCode: 0,
      stdout: "token=abc123",
      stderr: "password=hunter2",
    },
  });

  const evidence = listEvidencePacks(dbPath, { runId: "RUN-009" })[0];
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes("abc123"), false);
  assert.equal(serialized.includes("hunter2"), false);
  assert.match(serialized, /\[REDACTED\]/);
});

test("returned evidence pack is sanitized for synchronous consumers", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-return-sanitized-"));
  const result = runStatusCheck({
    ...baseInput(root),
    runner: {
      status: "completed",
      exitCode: 0,
      stdout: "token=abc123",
      stderr: "password=hunter2",
    },
  });

  const serialized = JSON.stringify(result.evidencePack);
  assert.equal(serialized.includes("abc123"), false);
  assert.equal(serialized.includes("hunter2"), false);
  assert.match(serialized, /\[REDACTED\]/);
});

test("evidence checksum matches sanitized artifact content", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-checksum-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    runner: {
      status: "completed",
      exitCode: 0,
      stdout: "token=abc123",
      stderr: "",
    },
  });

  const artifact = readFileSync(join(root, result.evidencePath ?? ""));
  const rows = runSqlite(dbPath, [], [
    { name: "evidence", sql: "SELECT checksum FROM evidence_packs WHERE id = ?", params: [result.evidencePack.id] },
  ]).queries.evidence;
  assert.equal(rows[0].checksum, createHash("sha256").update(artifact).digest("hex"));
});

test("status history returns the evidence and alignment for each check", () => {
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
  assert.notEqual(history[0].evidencePath, history[1].evidencePath);
  assert.equal(existsSync(join(root, history[0].evidencePath ?? "")), true);
  assert.equal(existsSync(join(root, history[1].evidencePath ?? "")), true);
  assert.equal(history[0].evidencePack.runner.stdout, "second");
  assert.equal(history[0].specAlignment.aligned, false);
  assert.equal(history[1].evidencePack.runner.stdout, "first");
  assert.equal(history[1].specAlignment.aligned, true);
});

test("spec alignment fails closed and blocks Done when traceability or tests are missing", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-alignment-"));
  const result = runStatusCheck({
    ...baseInput(root),
    specAlignment: {
      taskId: "TASK-009",
      requirementIds: ["REQ-040"],
      acceptanceCriteriaIds: [],
      coveredRequirementIds: [],
      testCoverage: false,
      changedFiles: ["src/status-checker.ts"],
    },
  });

  assert.equal(result.status, "review_needed");
  assert.equal(result.specAlignment.aligned, false);
  assert.equal(result.specAlignment.missingTraceability.includes("user_story"), true);
  assert.equal(result.specAlignment.missingTraceability.includes("acceptance_criteria"), true);
  assert.equal(result.reasons.some((reason) => reason.includes("Spec alignment") || reason.includes("Missing")), true);
});

test("secret findings remain visible when spec alignment also fails", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-secret-alignment-"));
  const result = runStatusCheck({
    ...baseInput(root),
    diff: {
      files: ["src/status-checker.ts"],
      patch: "password=hunter2",
    },
    specAlignment: {
      ...baseInput(root).specAlignment,
      testCoverage: false,
      changedFiles: ["src/status-checker.ts"],
    },
  });

  assert.equal(result.status, "review_needed");
  assert.equal(result.reasons.some((reason) => reason.includes("Sensitive value pattern detected: password")), true);
});

test("repeated failures past threshold become failed", () => {
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
        VALUES ('FEAT-009', 'project-1', 'Status Checker', 'failed', 10, 'feat-009-status-checker', '["REQ-040"]')`,
    },
    {
      sql: `INSERT INTO tasks (id, feature_id, title, status, recovery_state, allowed_files_json)
        VALUES ('TASK-009', 'FEAT-009', 'Run checks', 'failed', 'failed', '[]')`,
    },
  ]);
  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    runner: { status: "failed", exitCode: 1, stderr: "test failed" },
    failureHistory: ["failed", "failed"],
    failureThreshold: 3,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.reasons.some((reason) => reason.includes("Failure threshold")), true);
  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(items.length, 1);
  assert.equal(items[0].triggerReasons.includes("repeated_failure"), true);
  const persisted = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-009'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-009'" },
  ]);
  assert.equal(persisted.queries.task[0].status, "failed");
  assert.equal(persisted.queries.feature[0].status, "failed");
});

test("repeated failures mark active task and feature failed", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-active-threshold-"));
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
    {
      sql: `INSERT INTO task_graphs (id, feature_id, graph_json)
        VALUES ('TG-FEAT-009', 'FEAT-009', '{"tasks":[{"taskId":"GRAPH-TASK-009"}]}')`,
    },
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json, acceptance_criteria_json,
          allowed_files_json, dependencies_json, risk, required_skill_slug, subagent, estimated_effort
        ) VALUES (
          'GRAPH-TASK-009', 'TG-FEAT-009', 'FEAT-009', 'Run checks', 'running',
          '[]', '[]', '[]', '[]', 'medium', 'feature-spec-execution', 'coding', 1
        )`,
    },
  ]);

  runStatusCheck({
    ...baseInput(root, dbPath),
    runner: { status: "failed", exitCode: 1, stderr: "test failed" },
    failureHistory: ["failed", "failed"],
    failureThreshold: 3,
  });

  const persisted = runSqlite(dbPath, [], [
    { name: "task", sql: "SELECT status FROM tasks WHERE id = 'TASK-009'" },
    { name: "graphTask", sql: "SELECT status FROM task_graph_tasks WHERE id = 'GRAPH-TASK-009'" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-009'" },
  ]);
  assert.equal(persisted.queries.task[0].status, "failed");
  assert.equal(persisted.queries.graphTask[0].status, "failed");
  assert.equal(persisted.queries.feature[0].status, "failed");
});

test("repeated blocked status check failures count toward the failure threshold", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-blocked-threshold-"));
  const result = runStatusCheck({
    ...baseInput(root),
    runner: { status: "failed", exitCode: 1, stderr: "test failed" },
    failureHistory: ["blocked", "blocked"],
    failureThreshold: 3,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.reasons.some((reason) => reason.includes("Failure threshold")), true);
});

test("non-consecutive failures do not trip the repeated failure threshold", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-threshold-gap-"));
  const result = runStatusCheck({
    ...baseInput(root),
    runner: { status: "failed", exitCode: 1, stderr: "test failed" },
    failureHistory: ["failed", "done"],
    failureThreshold: 2,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reasons.some((reason) => reason.includes("Failure threshold")), false);
});

test("forbidden files, unauthorized files, and sensitive patterns route to review", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-files-"));
  const result = runStatusCheck({
    ...baseInput(root),
    allowedFiles: ["src/status-checker.ts"],
    forbiddenFiles: ["secrets/**"],
    diff: {
      files: ["src/status-checker.ts", "secrets/prod.env"],
      patch: "password=hunter2",
    },
  });

  assert.equal(result.status, "review_needed");
  assert.deepEqual(result.evidencePack.diff.secretFindings, ["password"]);
  assert.equal(result.evidencePack.diff.forbiddenFiles.includes("secrets/prod.env"), true);
  assert.equal(result.evidencePack.diff.unauthorizedFiles.includes("secrets/prod.env"), true);
});

test("forbidden files route to review even when command checks fail", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-files-failed-checks-"));
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
    commandChecks: [
      { kind: "unit_test", command: "node --test tests/status-checker.test.ts", status: "failed", exitCode: 1 },
    ],
  });

  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(result.status, "review_needed");
  assert.equal(items.length, 1);
  assert.equal(items[0].triggerReasons.includes("forbidden_file"), true);
});

test("high-risk files route to review even when command checks fail", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-risk-files-failed-checks-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    diff: {
      files: ["src/schema.ts"],
      summary: "Changed schema code.",
    },
    commandChecks: [
      { kind: "unit_test", command: "node --test tests/status-checker.test.ts", status: "failed", exitCode: 1 },
    ],
  });

  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(result.status, "review_needed");
  assert.equal(items.length, 1);
  assert.equal(items[0].triggerReasons.includes("high_risk_file"), true);
});

test("forbidden files route to review even when runner is blocked", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-files-blocked-runner-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    runner: {
      status: "blocked",
      exitCode: 0,
      summary: "Runner blocked on external dependency.",
      stdout: "",
      stderr: "blocked",
    },
    allowedFiles: ["src/status-checker.ts"],
    forbiddenFiles: ["secrets/**"],
    diff: {
      files: ["src/status-checker.ts", "secrets/prod.env"],
      patch: "password=hunter2",
    },
  });

  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(result.status, "review_needed");
  assert.equal(items.length, 1);
  assert.equal(items[0].triggerReasons.includes("forbidden_file"), true);
});

test("large diffs route to Review Center with diff threshold trigger", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-large-diff-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    diff: {
      files: ["src/status-checker.ts"],
      patch: Array.from({ length: 401 }, (_, index) => `+line ${index}`).join("\n"),
    },
  });

  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(result.status, "review_needed");
  assert.equal(items[0].triggerReasons.includes("diff_threshold_exceeded"), true);
});

test("secret-only findings route to blocking security review actions", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-secret-only-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    allowedFiles: ["src/status-checker.ts"],
    forbiddenFiles: undefined,
    diff: {
      files: ["src/status-checker.ts"],
      patch: "password=secret-value",
    },
  });

  assert.equal(result.status, "review_needed");
  assert.deepEqual(result.evidencePack.diff.secretFindings, ["password"]);
  assert.deepEqual(result.evidencePack.diff.forbiddenFiles, []);
  assert.deepEqual(result.evidencePack.diff.unauthorizedFiles, []);
  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(items[0].triggerReasons.includes("forbidden_file"), true);
  assert.deepEqual(items[0].recommendedActions, ["reject", "rollback", "request_changes"]);
});

test("review-needed status checks create review center items", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-review-router-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    diff: { files: [".env"], summary: "Changed environment file." },
  });

  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(result.status, "review_needed");
  assert.equal(items.length, 1);
  assert.equal(items[0].runId, "RUN-009");
  assert.equal(items[0].taskId, "TASK-009");
  assert.equal(items[0].evidence[0].id, result.evidencePack.id);
  assert.equal(items[0].triggerReasons.includes("forbidden_file"), true);
});

test("repeated status checks reuse the open review gate instead of duplicating blockers", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-review-dedupe-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const input = {
    ...baseInput(root, dbPath),
    diff: { files: [".env"], summary: "Changed environment file." },
  };

  runStatusCheck(input);
  runStatusCheck(input);
  const rerun = runStatusCheck({ ...input, runId: "RUN-009-RERUN", diff: { files: [".env"], summary: "Changed environment file again." } });

  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(items.length, 1);
  assert.equal(items[0].runId, "RUN-009-RERUN");
  assert.equal(items[0].taskId, "TASK-009");
  assert.deepEqual(items[0].evidenceRefs, [rerun.evidencePack.id]);
  assert.deepEqual(items[0].body.diff, rerun.evidencePack.diff);
});

test("status review dedupe preserves distinct risk triggers", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-review-distinct-risks-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const input = {
    ...baseInput(root, dbPath),
    diff: { files: [".env"], summary: "Changed environment file." },
  };

  runStatusCheck(input);
  runStatusCheck({
    ...input,
    runId: "RUN-009-REPEATED",
    diff: { files: ["src/status-checker.ts"], summary: "No boundary diff." },
    runner: { status: "failed", exitCode: 1, stderr: "test failed" },
    failureHistory: ["failed", "failed"],
    failureThreshold: 3,
  });

  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(items.length, 2);
  assert.equal(items.some((item) => item.triggerReasons.includes("forbidden_file")), true);
  assert.equal(items.some((item) => item.triggerReasons.includes("repeated_failure")), true);
});

test("status reruns reuse decided review threads for remediation", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-review-rerun-after-decision-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const input = {
    ...baseInput(root, dbPath),
    diff: { files: [".env"], summary: "Changed environment file." },
  };

  runStatusCheck(input);
  const initial = listReviewCenterItems(dbPath, { status: "review_needed" })[0];
  runSqlite(dbPath, [
    { sql: "UPDATE review_items SET status = 'rejected' WHERE id = ?", params: [initial.id] },
  ]);
  runStatusCheck({ ...input, runId: "RUN-009-RERUN" });

  const rows = runSqlite(dbPath, [], [
    { name: "reviews", sql: "SELECT id, status FROM review_items ORDER BY created_at, id" },
  ]).queries.reviews;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, initial.id);
  assert.equal(rows[0].status, "review_needed");
});

test("clean reruns close remediated status-review blockers", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-review-clean-rerun-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const input = {
    ...baseInput(root, dbPath),
    diff: { files: [".env"], summary: "Changed environment file." },
  };

  runStatusCheck(input);
  const initial = listReviewCenterItems(dbPath, { status: "review_needed" })[0];
  runSqlite(dbPath, [
    { sql: "UPDATE review_items SET status = 'changes_requested' WHERE id = ?", params: [initial.id] },
  ]);
  runStatusCheck({
    ...input,
    runId: "RUN-009-CLEAN",
    diff: { files: ["src/status-checker.ts"], summary: "Remediated risky diff." },
  });

  const rows = runSqlite(dbPath, [], [
    { name: "reviews", sql: "SELECT id, status FROM review_items ORDER BY created_at, id" },
  ]).queries.reviews;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, initial.id);
  assert.equal(rows[0].status, "closed");
});

test("clean reruns keep approval-needed status reviews open", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-approval-review-clean-rerun-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const input = {
    ...baseInput(root, dbPath),
    runner: {
      status: "review_needed" as const,
      exitCode: 0,
      summary: "Runner stopped for a safety review.",
      stdout: "runner requested review",
      stderr: "",
    },
  };

  runStatusCheck(input);
  const initial = listReviewCenterItems(dbPath, { status: "review_needed" })[0];
  runStatusCheck({
    ...input,
    runId: "RUN-009-APPROVAL-CLEAN",
    runner: {
      status: "completed",
      exitCode: 0,
      summary: "Clean rerun after review request.",
      stdout: "runner ok",
      stderr: "",
    },
  });

  const rows = runSqlite(dbPath, [], [
    { name: "reviews", sql: "SELECT id, status, review_needed_reason FROM review_items ORDER BY created_at, id" },
  ]).queries.reviews;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, initial.id);
  assert.equal(rows[0].status, "review_needed");
  assert.equal(rows[0].review_needed_reason, "approval_needed");
});

test("runner review-needed status checks create approval-needed reviews", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-runner-review-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  runStatusCheck({
    ...baseInput(root, dbPath),
    runner: {
      status: "review_needed",
      exitCode: 0,
      summary: "Runner stopped for a safety review.",
      stdout: "runner requested review",
      stderr: "",
    },
  });

  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(items.length, 1);
  assert.equal(items[0].reviewNeededReason, "approval_needed");
  assert.equal(items[0].triggerReasons.includes("permission_escalation"), true);
  assert.equal(items[0].recommendedActions.includes("approve_continue"), true);
});

test("runner review-needed can route failed command continuation to review", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-failed-command-review-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    runner: {
      status: "review_needed",
      exitCode: 0,
      summary: "Runner requests approval to continue after a failed check.",
      stdout: "runner requested review",
      stderr: "",
    },
    commandChecks: [
      { kind: "unit_test", command: "node --test tests/status-checker.test.ts", status: "failed", exitCode: 1 },
    ],
  });

  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(result.status, "review_needed");
  assert.equal(items.length, 1);
  assert.equal(items[0].triggerReasons.includes("failed_tests_continue"), true);
});

test("spec alignment file boundary rules participate in diff inspection", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-spec-files-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const result = runStatusCheck({
    ...baseInput(root, dbPath),
    allowedFiles: undefined,
    forbiddenFiles: undefined,
    diff: {
      files: ["src/status-checker.ts", "secrets/prod.env"],
    },
    specAlignment: {
      ...baseInput(root).specAlignment,
      allowedFiles: ["src/status-checker.ts"],
      forbiddenFiles: ["secrets/**"],
      changedFiles: ["src/status-checker.ts", "secrets/prod.env"],
    },
  });

  assert.equal(result.status, "review_needed");
  assert.equal(result.evidencePack.diff.forbiddenFiles.includes("secrets/prod.env"), true);
  assert.equal(result.evidencePack.diff.unauthorizedFiles.includes("secrets/prod.env"), true);
  const items = listReviewCenterItems(dbPath, { status: "review_needed" });
  assert.equal(items[0].reviewNeededReason, "risk_review_needed");
  assert.deepEqual(items[0].recommendedActions, ["reject", "rollback", "request_changes"]);
});

test("attachment checksums resolve relative to the workspace root", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-attachments-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  writeFileSync(join(root, "artifact.log"), "attachment evidence", "utf8");

  runStatusCheck({
    ...baseInput(root, dbPath),
    attachments: [{ kind: "log", path: "artifact.log" }],
  });

  const rows = runSqlite(dbPath, [], [
    { name: "attachments", sql: "SELECT path, checksum FROM evidence_attachment_refs" },
  ]).queries.attachments;
  assert.equal(rows[0].path, "artifact.log");
  assert.equal(typeof rows[0].checksum, "string");
  assert.equal(rows[0].checksum, createHash("sha256").update(readFileSync(join(root, "artifact.log"))).digest("hex"));
  assert.equal(listEvidencePacks(dbPath, { runId: "RUN-009" })[0].attachments[0].checksum, rows[0].checksum);
});

test("attachment checksums resolve relative to the artifact root when workspace root is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-artifact-root-"));
  const artifactRoot = join(root, ".autobuild");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, "artifact.log"), "artifact-root evidence", "utf8");

  runStatusCheck({
    ...baseInput(root, dbPath),
    workspaceRoot: undefined,
    artifactRoot,
    attachments: [{ kind: "log", path: "artifact.log" }],
  });

  const rows = runSqlite(dbPath, [], [
    { name: "attachments", sql: "SELECT path, checksum FROM evidence_attachment_refs" },
  ]).queries.attachments;
  assert.equal(rows[0].path, "artifact.log");
  assert.equal(rows[0].checksum, createHash("sha256").update(readFileSync(join(artifactRoot, "artifact.log"))).digest("hex"));
});

test("artifact-root evidence paths can be reused as later attachment references", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-reusable-evidence-"));
  const artifactRoot = join(root, ".autobuild");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const first = runStatusCheck({
    ...baseInput(root, dbPath),
    workspaceRoot: undefined,
    artifactRoot,
  });
  runStatusCheck({
    ...baseInput(root, dbPath),
    runId: "RUN-010",
    workspaceRoot: undefined,
    artifactRoot,
    attachments: [{ kind: "evidence", path: first.evidencePath ?? "" }],
  });

  assert.match(first.evidencePath ?? "", /^\.autobuild\/evidence\/RUN-009-.+\.json$/);
  const rows = runSqlite(dbPath, [], [
    { name: "attachments", sql: "SELECT path, checksum FROM evidence_attachment_refs WHERE run_id = ?", params: ["RUN-010"] },
  ]).queries.attachments;
  assert.equal(rows[0].path, first.evidencePath);
  assert.equal(rows[0].checksum, createHash("sha256").update(readFileSync(join(root, first.evidencePath ?? ""))).digest("hex"));
});

test("attachments prefer artifact root for generated evidence when workspace root is also set", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-mixed-roots-"));
  const artifactRoot = join(root, "external-artifacts", ".autobuild");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  mkdirSync(join(artifactRoot, "evidence"), { recursive: true });
  writeFileSync(join(artifactRoot, "evidence", "status.json"), "artifact evidence", "utf8");

  runStatusCheck({
    ...baseInput(root, dbPath),
    artifactRoot,
    attachments: [{ kind: "evidence", path: ".autobuild/evidence/status.json" }],
  });

  const rows = runSqlite(dbPath, [], [
    { name: "attachments", sql: "SELECT path, checksum FROM evidence_attachment_refs" },
  ]).queries.attachments;
  assert.equal(rows[0].path, ".autobuild/evidence/status.json");
  assert.equal(rows[0].checksum, createHash("sha256").update(readFileSync(join(artifactRoot, "evidence", "status.json"))).digest("hex"));
});

test("task linkage is preserved when supplied by spec alignment input", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-spec-task-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const input = baseInput(root, dbPath);

  const result = runStatusCheck({
    ...input,
    taskId: undefined,
    specAlignment: {
      ...input.specAlignment,
      taskId: "TASK-FROM-SPEC",
    },
  });

  assert.equal(result.taskId, "TASK-FROM-SPEC");
  assert.equal(result.evidencePack.taskId, "TASK-FROM-SPEC");
  assert.equal(listEvidencePacks(dbPath, { taskId: "TASK-FROM-SPEC" }).length, 1);
  assert.equal(listStatusCheckResults(dbPath, "RUN-009")[0].taskId, "TASK-FROM-SPEC");
  assert.equal(listSpecAlignmentResults(dbPath, "RUN-009")[0].taskId, "TASK-FROM-SPEC");
});

test("skipped required command checks prevent Done", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-skipped-"));
  const result = runStatusCheck({
    ...baseInput(root),
    commandChecks: [
      { kind: "build", command: "npm test", status: "passed", exitCode: 0 },
      { kind: "integration_test", command: "npm test", status: "skipped" },
    ],
    requiredCommandChecks: ["build", "unit_test", "integration_test", "typecheck", "lint", "security_scan"],
  });

  assert.equal(result.status, "review_needed");
  assert.equal(result.reasons.some((reason) => reason.includes("integration_test was skipped")), true);
});

test("missing required command checks prevent Done", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-missing-command-"));
  const result = runStatusCheck({
    ...baseInput(root),
    commandChecks: [
      { kind: "build", command: "npm run build", status: "passed", exitCode: 0 },
      { kind: "unit_test", command: "npm test", status: "passed", exitCode: 0 },
    ],
    requiredCommandChecks: ["build", "unit_test", "integration_test", "typecheck", "lint", "security_scan"],
  });

  assert.equal(result.status, "review_needed");
  assert.equal(result.reasons.some((reason) => reason.includes("integration_test result is missing")), true);
  assert.equal(result.reasons.some((reason) => reason.includes("security_scan result is missing")), true);
});

test("projects can reach Done with a discovered subset of checks when no required check list is supplied", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-discovered-subset-"));
  const result = runStatusCheck({
    ...baseInput(root),
    commandChecks: [
      { kind: "build", command: "npm run build", status: "passed", exitCode: 0 },
      { kind: "unit_test", command: "npm test", status: "passed", exitCode: 0 },
    ],
    requiredCommandChecks: [],
  });

  assert.equal(result.status, "done");
});

test("missing all command evidence prevents Done", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-no-command-evidence-"));
  const result = runStatusCheck({
    ...baseInput(root),
    commandChecks: undefined,
    requiredCommandChecks: undefined,
  });

  assert.equal(result.status, "review_needed");
  assert.equal(result.reasons.includes("Command check evidence is missing."), true);
});

test("missing runner output blocks status completion", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-missing-runner-"));
  const result = runStatusCheck({
    ...baseInput(root),
    runner: undefined,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reasons.includes("Runner output is missing."), true);
});

test("evidence write failure returns blocked diagnostic result", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-write-fail-"));
  const result = runStatusCheck({
    ...baseInput(root),
    writeEvidence: () => {
      throw new Error("disk full");
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.summary, "Status check blocked because evidence could not be written.");
  assert.match(result.evidenceWriteError ?? "", /disk full/);
  assert.equal(result.reasons.some((reason) => reason.includes("Evidence write failed")), true);
  assert.equal(result.evidencePack.status, "blocked");
  assert.equal(result.evidencePack.summary, "Status check blocked because evidence could not be written.");
});

test("persistence failure returns blocked diagnostic result instead of throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-persist-fail-"));
  const result = runStatusCheck({
    ...baseInput(root),
    dbPath: join(root, "uninitialized.db"),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.summary, "Status check blocked because evidence persistence failed.");
  assert.match(result.evidenceWriteError ?? "", /Persistence failed/);
  assert.equal(result.reasons.some((reason) => reason.includes("Evidence persistence failed")), true);
  assert.equal(result.evidencePack.status, "blocked");
});

test("custom evidence writer is invoked once on successful checks", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-009-custom-writer-"));
  const writes: string[] = [];
  const result = runStatusCheck({
    ...baseInput(root),
    writeEvidence: (path, content) => {
      writes.push(`${path}\n${content}`);
    },
  });

  assert.equal(result.status, "done");
  assert.equal(writes.length, 1);
  const content = writes[0].slice(writes[0].indexOf("\n") + 1);
  assert.deepEqual(JSON.parse(content), JSON.parse(JSON.stringify(result.evidencePack)));
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
      requirementIds: ["REQ-040", "REQ-041", "REQ-042", "REQ-051"],
      acceptanceCriteriaIds: ["AC-001", "AC-002", "AC-003", "AC-004"],
      coveredRequirementIds: ["REQ-040", "REQ-041", "REQ-042", "REQ-051"],
      testCoverage: true,
      changedFiles: ["src/status-checker.ts", "tests/status-checker.test.ts"],
    },
  };
}

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "feat-009-db-")), ".autobuild", "autobuild.db");
}
