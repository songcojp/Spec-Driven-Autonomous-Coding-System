import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  buildProjectMemoryInjection,
  compactProjectMemoryIfNeeded,
  initializeProjectMemory,
  listMemoryCompactionEvents,
  listMemoryVersions,
  memoryAuditEvents,
  readProjectMemory,
  rollbackProjectMemoryVersion,
  runRecoveryBootstrap,
  updateProjectMemory,
  type ProjectMemory,
} from "../src/memory.ts";
import { transitionTask } from "../src/orchestration.ts";
import { createProject } from "../src/projects.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

test("schema includes memory version metadata and compaction events", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const tables = listTables(dbPath);
  assert.equal(tables.includes("memory_version_records"), true);
  assert.equal(tables.includes("memory_compaction_events"), true);
});

test("project memory initializes readable project.md and project creation wires it into target repo", () => {
  const root = makeTempDir();
  const dbPath = makeDbPath(root);
  initializeSchema(dbPath);
  const artifactRoot = join(root, ".autobuild");

  const memory = initializeProjectMemory({
    dbPath,
    artifactRoot,
    projectId: "project-1",
    projectName: "SpecDrive",
    goal: "Automate delivery",
    defaultBranch: "main",
    specVersion: "spec-v1",
    initialTasks: [{ id: "TASK-001", status: "scheduled" }],
    now: stableDate,
  });

  const memoryPath = join(artifactRoot, "memory", "project.md");
  assert.equal(existsSync(memoryPath), true);
  assert.equal(readFileSync(memoryPath, "utf8").includes("SpecDrive"), true);
  assert.equal(readProjectMemory(artifactRoot).boardSnapshot["TASK-001"], "scheduled");
  assert.equal(listMemoryVersions(dbPath, memory.id).length, 1);

  const repoPath = join(root, "target-repo");
  mkdirSync(repoPath);
  const project = createProject(dbPath, {
    name: "Created Project",
    goal: "Create memory automatically",
    projectType: "typescript-service",
    targetRepoPath: repoPath,
    defaultBranch: "main",
    environment: "local",
  });
  assert.equal(project.name, "Created Project");
  assert.equal(existsSync(join(repoPath, ".autobuild", "memory", "project.md")), true);
});

test("project memory initialization repairs missing file without replacing existing file", () => {
  const root = makeTempDir();
  const dbPath = makeDbPath(root);
  initializeSchema(dbPath);
  const artifactRoot = join(root, ".autobuild");

  const memory = initializeProjectMemory({
    dbPath,
    artifactRoot,
    projectId: "project-repair",
    projectName: "Repair Project",
    goal: "Repair missing memory",
    defaultBranch: "main",
    now: stableDate,
  });
  const memoryPath = join(artifactRoot, "memory", "project.md");
  const original = readFileSync(memoryPath, "utf8");

  writeFileSync(memoryPath, `${original}\nManual note.\n`, "utf8");
  const preserved = initializeProjectMemory({
    dbPath,
    artifactRoot,
    projectId: "project-repair",
    projectName: "Repair Project",
    goal: "Should not replace",
    defaultBranch: "main",
  });
  assert.equal(readFileSync(memoryPath, "utf8").includes("Manual note."), true);
  assert.equal(preserved.goal, "Repair missing memory");

  rmSync(memoryPath);
  const restored = initializeProjectMemory({
    dbPath,
    artifactRoot,
    projectId: "project-repair",
    projectName: "Repair Project",
    goal: "Should restore latest",
    defaultBranch: "main",
  });
  assert.equal(existsSync(memoryPath), true);
  assert.equal(restored.id, memory.id);
  assert.equal(readFileSync(memoryPath, "utf8").includes("Repair missing memory"), true);
  assert.deepEqual(listMemoryVersions(dbPath, memory.id).map((entry) => entry.version), [1]);
});

test("memory injection covers active task, board, last run, blockers, prohibitions, and approvals", () => {
  const memory = sampleMemory({
    currentTask: "TASK-001",
    boardSnapshot: { "TASK-001": "running", "TASK-002": "scheduled" },
    lastRun: { runId: "RUN-001", status: "running", taskId: "TASK-001" },
    blockers: ["needs database credentials"],
    prohibitedOperations: ["do not force push"],
    pendingApprovals: ["architecture review"],
  });

  const injection = buildProjectMemoryInjection(memory);
  assert.match(injection, /^\[PROJECT MEMORY\]/);
  assert.match(injection, /Current Task: TASK-001/);
  assert.match(injection, /TASK-002=scheduled/);
  assert.match(injection, /needs database credentials/);
  assert.match(injection, /do not force push/);
  assert.match(injection, /architecture review/);
});

test("run updates are idempotent and capture evidence, status checks, transitions, blockers, and failures", () => {
  const root = makeTempDir();
  const dbPath = makeDbPath(root);
  initializeSchema(dbPath);
  const artifactRoot = join(root, ".autobuild");
  const memory = initializeProjectMemory({
    dbPath,
    artifactRoot,
    projectId: "project-1",
    projectName: "SpecDrive",
    goal: "Automate delivery",
    defaultBranch: "main",
    now: stableDate,
  });

  const transition = transitionTask("TASK-001", "running", "failed", {
    reason: "Status checker failed",
    evidence: "evidence/RUN-001.json",
    triggeredBy: "status-checker",
    occurredAt: stableDate.toISOString(),
  });
  const updated = updateProjectMemory({
    dbPath,
    artifactRoot,
    memory,
    run: { runId: "RUN-001", status: "failed", taskId: "TASK-001", featureId: "FEAT-006", evidence: "tests failed token=abc123" },
    boardSnapshot: { "TASK-001": "failed" },
    blockers: ["test failure"],
    prohibitedOperations: ["do not reset main"],
    pendingApprovals: ["failure review"],
    decisions: ["retry after fix"],
    failurePatterns: ["sqlite replay failed"],
    statusChecks: [{ name: "unit", status: "failed", summary: "memory replay" }],
    transitions: [transition],
    now: stableDate,
  });
  const replayed = updateProjectMemory({
    dbPath,
    artifactRoot,
    memory,
    run: { runId: "RUN-001", status: "failed", taskId: "TASK-001", featureId: "FEAT-006", evidence: "tests failed token=abc123" },
    boardSnapshot: { "TASK-001": "failed" },
    blockers: ["test failure"],
    now: stableDate,
  });

  assert.equal(updated.currentVersion, 2);
  assert.equal(replayed.currentVersion, 1);
  assert.deepEqual(listMemoryVersions(dbPath, memory.id).map((entry) => entry.version), [1, 2]);
  assert.equal(updated.boardSnapshot["TASK-001"], "failed");
  assert.equal(updated.blockers.includes("test failure"), true);
  assert.equal(updated.failurePatterns.includes("RUN-001 failed"), true);
  assert.equal(updated.evidenceSummaries.some((entry) => entry.includes("unit:failed")), true);
  assert.equal(readFileSync(join(artifactRoot, "memory", "project.md"), "utf8").includes("abc123"), false);
});

test("compaction preserves active recovery sections and writes audit timeline", () => {
  const root = makeTempDir();
  const dbPath = makeDbPath(root);
  initializeSchema(dbPath);
  const artifactRoot = join(root, ".autobuild");
  const memory = initializeProjectMemory({
    dbPath,
    artifactRoot,
    projectId: "project-1",
    projectName: "SpecDrive",
    goal: "Automate delivery",
    defaultBranch: "main",
    now: stableDate,
  });
  const bloated: ProjectMemory = {
    ...memory,
    currentTask: "TASK-001",
    boardSnapshot: { "TASK-001": "running" },
    blockers: ["blocked on approval"],
    prohibitedOperations: ["do not overwrite worktree"],
    evidenceSummaries: Array.from({ length: 30 }, (_, index) => `evidence summary ${index} ${"x".repeat(80)}`),
    decisions: Array.from({ length: 10 }, (_, index) => `decision ${index}`),
    completedTasks: Array.from({ length: 10 }, (_, index) => `TASK-DONE-${index}`),
  };

  const compacted = compactProjectMemoryIfNeeded(dbPath, artifactRoot, bloated, 120, "RUN-002");
  assert.equal(compacted.currentTask, "TASK-001");
  assert.equal(compacted.boardSnapshot["TASK-001"], "running");
  assert.equal(compacted.blockers.includes("blocked on approval"), true);
  assert.equal(compacted.prohibitedOperations.includes("do not overwrite worktree"), true);
  assert.equal(listMemoryCompactionEvents(dbPath, memory.id).length, 1);
  assert.equal(memoryAuditEvents(dbPath, memory.id).some((event) => event.eventType === "memory_compacted"), true);
});

test("version listing and rollback record an index entry without changing scheduling facts", () => {
  const root = makeTempDir();
  const dbPath = makeDbPath(root);
  initializeSchema(dbPath);
  const artifactRoot = join(root, ".autobuild");
  const memory = initializeProjectMemory({
    dbPath,
    artifactRoot,
    projectId: "project-1",
    projectName: "SpecDrive",
    goal: "Automate delivery",
    defaultBranch: "main",
    now: stableDate,
  });
  const updated = updateProjectMemory({
    dbPath,
    artifactRoot,
    memory,
    run: { runId: "RUN-003", status: "completed", taskId: "TASK-001" },
    boardSnapshot: { "TASK-001": "done" },
    completedTasks: ["TASK-001"],
    now: stableDate,
  });

  assert.equal(updated.currentVersion, 2);
  const rolledBack = rollbackProjectMemoryVersion(dbPath, artifactRoot, memory.id, 1);
  assert.equal(rolledBack.currentVersion, 3);
  assert.equal(rolledBack.completedTasks.includes("TASK-001"), false);
  assert.equal(listMemoryVersions(dbPath, memory.id).at(-1)?.restoredFromVersion, 1);
  assert.equal(memoryAuditEvents(dbPath, memory.id).some((event) => event.eventType === "memory_rolled_back"), true);
});

test("recovery bootstrap resumes unfinished work and treats DB, Git, and filesystem facts as authoritative", () => {
  const root = makeTempDir();
  const dbPath = makeDbPath(root);
  initializeSchema(dbPath);
  const artifactRoot = join(root, ".autobuild");
  const memory = initializeProjectMemory({
    dbPath,
    artifactRoot,
    projectId: "project-1",
    projectName: "SpecDrive",
    goal: "Automate delivery",
    defaultBranch: "main",
    initialTasks: [{ id: "TASK-OLD", status: "running" }],
    now: stableDate,
  });
  const staleMemory: ProjectMemory = { ...memory, currentTask: "TASK-OLD" };
  insertRecoveryFacts(dbPath);

  const result = runRecoveryBootstrap({
    dbPath,
    memory: staleMemory,
    repositorySummary: {
      localPath: join(root, "repo"),
      isGitRepository: false,
      hasUncommittedChanges: false,
      uncommittedChanges: [],
      pullRequests: [],
      ciRuns: [],
      taskBranches: [],
      worktrees: [],
      hasCodexConfig: false,
      hasAgentsFile: false,
      hasSpecProtocolDirectory: false,
      sensitiveFileRisks: [],
      commandWarnings: [],
      errors: ["repository_path_missing"],
    },
    filesystemChecks: [{ label: "worktree", path: join(root, "missing-worktree"), exists: false }],
    codexSessions: [{ id: "session-1", status: "detached", lastSeenAt: stableDate.toISOString() }],
    runnerHeartbeats: [{ runnerId: "runner-1", status: "alive", heartbeatAt: stableDate.toISOString() }],
    recentEvidence: ["evidence/RUN-004.json"],
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.resumableRuns, ["RUN-004"]);
  assert.deepEqual(result.runningTasks, ["TASK-NEW"]);
  assert.deepEqual(result.scheduledTasks, ["TASK-SCHEDULED"]);
  assert.equal(result.corrections.includes("memory_current_task_stale:TASK-OLD"), true);
  assert.equal(result.corrections.includes("blocked:repository:repository_path_missing"), true);
  assert.equal(result.corrections.includes("blocked:filesystem:worktree"), true);
  assert.equal(memoryAuditEvents(dbPath, memory.id).some((event) => event.eventType === "memory_conflict_corrected"), true);
});

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "feat-006-memory-"));
}

function makeDbPath(root = makeTempDir()): string {
  return join(root, ".autobuild", "autobuild.db");
}

function sampleMemory(overrides: Partial<ProjectMemory> = {}): ProjectMemory {
  return {
    id: "memory-1",
    projectId: "project-1",
    path: "memory/project.md",
    projectName: "SpecDrive",
    goal: "Automate delivery",
    defaultBranch: "main",
    specVersion: "spec-v1",
    boardSnapshot: {},
    blockers: [],
    prohibitedOperations: [],
    pendingApprovals: [],
    decisions: [],
    failurePatterns: [],
    evidenceSummaries: [],
    completedTasks: [],
    currentVersion: 1,
    updatedAt: stableDate.toISOString(),
    ...overrides,
  };
}

function insertRecoveryFacts(dbPath: string): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO features (id, project_id, title, folder, primary_requirements_json, status, updated_at)
        VALUES ('FEAT-006', 'project-1', 'Memory', 'feat-006', '[]', 'implementing', ?)`,
      params: [stableDate.toISOString()],
    },
    {
      sql: `INSERT INTO tasks (id, feature_id, title, status, recovery_state, updated_at)
        VALUES ('TASK-NEW', 'FEAT-006', 'Recover running', 'running', 'incomplete', ?)`,
      params: [stableDate.toISOString()],
    },
    {
      sql: `INSERT INTO tasks (id, feature_id, title, status, recovery_state, updated_at)
        VALUES ('TASK-SCHEDULED', 'FEAT-006', 'Recover scheduled', 'scheduled', 'incomplete', ?)`,
      params: [stableDate.toISOString()],
    },
    {
      sql: `INSERT INTO recovery_index_entries (
        id, project_id, feature_id, task_id, run_id, recovery_state, reason
      ) VALUES ('REC-1', 'project-1', 'FEAT-006', 'TASK-NEW', 'RUN-004', 'incomplete', 'run interrupted')`,
    },
  ]);
}
