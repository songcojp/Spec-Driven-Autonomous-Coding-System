import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  buildWorktreeRecord,
  buildTestEnvironmentIsolationRecord,
  checkMergeReadiness,
  classifyWorkspaceConflicts,
  createRollbackBoundary,
  createWorktree,
  decideCleanup,
  evaluateParallelExecution,
  evaluateParallelFeature,
  persistWorktreeRecord,
  persistWorkspaceEvidence,
  type CommandRunner,
} from "../src/workspace.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

test("workspace schema owns worktree records, conflict checks, merge readiness, and rollback boundaries", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const tables = listTables(dbPath);
  for (const table of [
    "worktree_records",
    "conflict_check_results",
    "merge_readiness_results",
    "rollback_boundaries",
    "test_environment_isolation_records",
  ]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }
});

test("parallel execution policy allows reads and isolated writes but serializes same branch and high risk work", () => {
  const readOnly = evaluateParallelExecution({
    candidate: { featureId: "FEAT-007", mode: "read", files: ["src/workspace.ts"] },
    activeScopes: [{ featureId: "FEAT-004", mode: "write", files: ["src/workspace.ts"], branch: "feat/004" }],
  });
  assert.equal(readOnly.parallelAllowed, true);
  assert.equal(readOnly.conflictCheck.reasons.length, 0);
  assert.deepEqual(readOnly.conflictCheck.conflictingFiles, []);
  assert.match(readOnly.evidence, /Read-only/);

  const isolatedWrite = evaluateParallelExecution({
    candidate: { featureId: "FEAT-007", mode: "write", files: ["src/workspace.ts"], branch: "feat/007" },
    activeScopes: [{ featureId: "FEAT-006", mode: "write", files: ["src/memory.ts"], branch: "feat/006" }],
    completedFeatureIds: ["FEAT-004"],
  });
  assert.equal(isolatedWrite.parallelAllowed, true);

  const sameBranch = evaluateParallelExecution({
    candidate: { featureId: "FEAT-007", mode: "write", files: ["src/workspace.ts"], branch: "feat/shared" },
    activeScopes: [{ featureId: "FEAT-006", mode: "write", files: ["src/memory.ts"], branch: "feat/shared" }],
  });
  assert.equal(sameBranch.serialRequired, true);
  assert.equal(sameBranch.reasons.includes("same_branch"), true);

  const highRisk = evaluateParallelExecution({
    candidate: { featureId: "FEAT-007", mode: "write", files: ["src/workspace.ts"], highRisk: true },
    activeScopes: [],
  });
  assert.equal(highRisk.parallelAllowed, false);
  assert.equal(highRisk.reasons.includes("high_risk_task"), true);

  const incompleteDependency = evaluateParallelExecution({
    candidate: { featureId: "FEAT-007", mode: "write", files: ["src/workspace.ts"], dependencies: ["FEAT-004"] },
    activeScopes: [],
    completedFeatureIds: [],
  });
  assert.equal(incompleteDependency.parallelAllowed, false);
  assert.equal(incompleteDependency.reasons.includes("incomplete_dependency"), true);
});

test("worktree creation records path, branch, base commit, target branch, feature, task, runner, and cleanup state", () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const runner: CommandRunner = (command, args, cwd) => {
    calls.push({ command, args, cwd });
    if (args.join(" ") === "symbolic-ref --short refs/remotes/origin/HEAD") {
      return { status: 0, stdout: "origin/main\n", stderr: "" };
    }
    if (args.join(" ") === "rev-parse origin/main") {
      return { status: 0, stdout: "abc123\n", stderr: "" };
    }
    if (args[0] === "worktree") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected command" };
  };

  const record = createWorktree(
    {
      repositoryPath: "/repo",
      worktreePath: "/repo.worktrees/feat-007",
      featureId: "FEAT-007",
      taskId: "TASK-001",
      runnerId: "codex",
      now: stableDate,
    },
    runner,
  );

  assert.equal(record.path, "/repo.worktrees/feat-007");
  assert.equal(record.branch, "work/feat-007-task-001");
  assert.equal(record.baseCommit, "abc123");
  assert.equal(record.targetBranch, "main");
  assert.equal(record.featureId, "FEAT-007");
  assert.equal(record.taskId, "TASK-001");
  assert.equal(record.runnerId, "codex");
  assert.equal(record.cleanupStatus, "active");
  assert.deepEqual(calls.at(-1), {
    command: "git",
    args: ["worktree", "add", "-b", "work/feat-007-task-001", "/repo.worktrees/feat-007", "abc123"],
    cwd: "/repo",
  });
});

test("conflict classifier serializes same files, lock files, schema, shared config, and shared runtime resources", () => {
  const result = classifyWorkspaceConflicts(
    {
      featureId: "FEAT-007",
      files: ["src/schema.ts", "package-lock.json", "src/config.ts", "src/orchestration.ts"],
      sharedResources: ["database"],
    },
    [{ featureId: "FEAT-004", files: ["src/orchestration.ts"], sharedResources: ["database"] }],
    stableDate,
  );

  assert.equal(result.parallelAllowed, false);
  assert.equal(result.serialRequired, true);
  assert.equal(result.severity, "high");
  assert.deepEqual(result.reasons.sort(), ["lock_file", "same_file", "schema", "shared_config", "shared_runtime_resource"]);
  assert.deepEqual(result.conflictingFiles, ["package-lock.json", "src/config.ts", "src/orchestration.ts", "src/schema.ts"]);
  assert.deepEqual(result.conflictingResources, ["database"]);
});

test("parallel feature check blocks incomplete dependencies and otherwise allows isolated scopes", () => {
  const blocked = evaluateParallelFeature({
    candidate: { featureId: "FEAT-007", dependencies: ["FEAT-004"], files: ["src/workspace.ts"] },
    activeScopes: [],
    completedFeatureIds: [],
  });
  assert.equal(blocked.parallelAllowed, false);
  assert.equal(blocked.serialRequired, true);
  assert.match(blocked.evidence, /incomplete dependencies FEAT-004/);

  const allowed = evaluateParallelFeature({
    candidate: { featureId: "FEAT-007", dependencies: ["FEAT-004"], files: ["src/workspace.ts"] },
    activeScopes: [{ featureId: "FEAT-006", files: ["src/memory.ts"] }],
    completedFeatureIds: ["FEAT-004"],
  });
  assert.equal(allowed.parallelAllowed, true);
});

test("merge readiness requires conflict, spec alignment, and required test checks to pass", () => {
  const conflict = classifyWorkspaceConflicts({ featureId: "FEAT-007", files: ["src/workspace.ts"] }, [], stableDate);
  const ready = checkMergeReadiness({
    worktreeId: "WT-1",
    conflictCheck: conflict,
    specAlignmentPassed: true,
    requiredTests: [{ name: "test", passed: true, evidence: "npm test passed" }],
    now: stableDate,
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.blockedReasons, []);

  const blocked = checkMergeReadiness({
    worktreeId: "WT-1",
    conflictCheck: conflict,
    specAlignmentPassed: false,
    requiredTests: [{ name: "test", passed: false, evidence: "workspace.test.ts failed" }],
    now: stableDate,
  });
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockedReasons, [
    "spec_alignment: Spec Alignment Check failed or is missing.",
    "test: workspace.test.ts failed",
  ]);
});

test("rollback boundary is executable from base commit and task branch", () => {
  const record = buildWorktreeRecord({
    worktreePath: "/repo.worktrees/feat-007",
    featureId: "FEAT-007",
    taskId: "TASK-006",
    runnerId: "codex",
    branch: "work/feat-007-task-006",
    targetBranch: "main",
    baseCommit: "abc123",
    now: stableDate,
  });
  const rollback = createRollbackBoundary({ worktree: record, diffSummary: "src/workspace.ts | 50 +", now: stableDate });

  assert.equal(rollback.baseCommit, "abc123");
  assert.equal(rollback.branch, "work/feat-007-task-006");
  assert.equal(rollback.rollbackCommand, "git switch work/feat-007-task-006 && git reset --hard abc123");
});

test("cleanup decision refuses undelivered or dirty worktrees and allows delivered clean paths", () => {
  const record = buildWorktreeRecord({
    worktreePath: "/repo.worktrees/feat-007",
    featureId: "FEAT-007",
    runnerId: "codex",
    branch: "work/feat-007",
    targetBranch: "main",
    baseCommit: "abc123",
    now: stableDate,
  });

  assert.deepEqual(decideCleanup(record, { delivered: false, hasUncommittedChanges: false }), {
    allowed: false,
    nextStatus: "cleanup_blocked",
    reason: "Worktree is not delivered or rolled back.",
  });
  assert.deepEqual(decideCleanup({ ...record, cleanupStatus: "delivered" }, { delivered: true, hasUncommittedChanges: true }), {
    allowed: false,
    nextStatus: "cleanup_blocked",
    reason: "Worktree has uncommitted changes.",
  });
  assert.deepEqual(decideCleanup({ ...record, cleanupStatus: "delivered" }, { delivered: true, hasUncommittedChanges: false }), {
    allowed: true,
    nextStatus: "cleanup_ready",
    reason: "Worktree is safe to clean.",
  });
});

test("workspace records and evidence persist for audit and recovery", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const record = persistWorktreeRecord(
    dbPath,
    buildWorktreeRecord({
      projectId: "PROJECT-1",
      worktreePath: "/repo.worktrees/feat-007",
      featureId: "FEAT-007",
      taskId: "TASK-001",
      runnerId: "codex",
      branch: "work/feat-007-task-001",
      targetBranch: "main",
      baseCommit: "abc123",
      now: stableDate,
    }),
  );
  const conflict = classifyWorkspaceConflicts({ featureId: "FEAT-007", files: ["src/workspace.ts"] }, [], stableDate);
  const mergeReadiness = checkMergeReadiness({
    worktreeId: record.id,
    conflictCheck: conflict,
    specAlignmentPassed: true,
    requiredTests: [{ name: "test", passed: true, evidence: "npm test passed" }],
    now: stableDate,
  });
  const rollback = createRollbackBoundary({ worktree: record, diffSummary: "src/workspace.ts | 50 +", now: stableDate });
  persistWorkspaceEvidence(dbPath, { conflict, mergeReadiness, rollback });

  const result = runSqlite(dbPath, [], [
    { name: "worktree", sql: "SELECT feature_id, task_id, runner_id, base_commit, target_branch, cleanup_status FROM worktree_records WHERE id = ?", params: [record.id] },
    { name: "conflict", sql: "SELECT parallel_allowed FROM conflict_check_results WHERE id = ?", params: [conflict.id] },
    { name: "readiness", sql: "SELECT ready FROM merge_readiness_results WHERE id = ?", params: [mergeReadiness.id] },
    { name: "rollback", sql: "SELECT base_commit FROM rollback_boundaries WHERE id = ?", params: [rollback.id] },
  ]);

  assert.deepEqual(result.queries.worktree[0], {
    feature_id: "FEAT-007",
    task_id: "TASK-001",
    runner_id: "codex",
    base_commit: "abc123",
    target_branch: "main",
    cleanup_status: "active",
  });
  assert.equal(result.queries.conflict[0].parallel_allowed, 1);
  assert.equal(result.queries.readiness[0].ready, 1);
  assert.equal(result.queries.rollback[0].base_commit, "abc123");
});

test("test environment isolation is recorded for runner inputs and evidence metadata", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const worktree = buildWorktreeRecord({
    worktreePath: "/repo.worktrees/feat-007",
    featureId: "FEAT-007",
    taskId: "TASK-010",
    runnerId: "codex",
    branch: "work/feat-007-task-010",
    targetBranch: "main",
    baseCommit: "abc123",
    now: stableDate,
  });
  const isolation = buildTestEnvironmentIsolationRecord({
    runId: "RUN-010",
    featureId: "FEAT-007",
    taskId: "TASK-010",
    worktree,
    environmentId: "it-feat-007-run-010",
    environmentType: "integration",
    cleanupStrategy: "drop sqlite database and remove temp container namespace",
    resources: [
      {
        kind: "database",
        name: "autobuild-test",
        namespace: "it-feat-007-run-010",
        connectionRef: "TEST_DATABASE_URL",
        cleanupStrategy: "drop schema after run",
      },
      {
        kind: "container",
        name: "worker",
        namespace: "it-feat-007-run-010",
        cleanupStrategy: "remove container after run",
      },
    ],
    now: stableDate,
  });
  persistWorkspaceEvidence(dbPath, { testEnvironment: isolation });

  assert.equal(isolation.runnerInput.environmentId, "it-feat-007-run-010");
  assert.equal(isolation.runnerInput.resourceRefs.length, 2);
  assert.equal(String(JSON.stringify(isolation.executionResultMetadata)).includes("TEST_DATABASE_URL"), true);

  const rows = runSqlite(dbPath, [], [
    {
      name: "isolation",
      sql: `SELECT run_id, feature_id, environment_id, environment_type, runner_input_json
        FROM test_environment_isolation_records WHERE id = ?`,
      params: [isolation.id],
    },
  ]).queries.isolation;
  assert.deepEqual(rows[0], {
    run_id: "RUN-010",
    feature_id: "FEAT-007",
    environment_id: "it-feat-007-run-010",
    environment_type: "integration",
    runner_input_json: JSON.stringify(isolation.runnerInput),
  });
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "feat-007-db-")), ".autobuild", "autobuild.db");
}
