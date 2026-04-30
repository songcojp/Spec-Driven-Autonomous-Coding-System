// FEAT-001 TASK-018: Unit / integration tests for new project management functions.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initializeSchema } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  assertProjectExists,
  createProject,
  getCurrentProjectSelection,
  readProjectRepository,
  initializeProjectPhase1,
  listProjects,
  ProjectNotFoundError,
  runProjectHealthCheck,
  setCurrentProject,
} from "../src/projects.ts";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "specdrive-projects-db-")), "control-plane.sqlite");
}

function freshDb(): string {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  return dbPath;
}

function baseInput(overrides: Partial<Parameters<typeof createProject>[1]> = {}) {
  return {
    name: "Test Project",
    goal: "Automate tests",
    projectType: "typescript",
    environment: "development",
    ...overrides,
  };
}

// ── TASK-013: listProjects ────────────────────────────────────────────────────

test("listProjects returns empty array for a fresh database", () => {
  const dbPath = freshDb();
  const projects = listProjects(dbPath);
  assert.deepEqual(projects, []);
});

test("listProjects returns all created projects as ProjectSummary records", () => {
  const dbPath = freshDb();
  createProject(dbPath, baseInput({ name: "Alpha" }));
  createProject(dbPath, baseInput({ name: "Beta" }));

  const projects = listProjects(dbPath);
  assert.equal(projects.length, 2);
  const names = projects.map((p) => p.name);
  assert.ok(names.includes("Alpha"), "Alpha should be listed");
  assert.ok(names.includes("Beta"), "Beta should be listed");
});

test("listProjects includes recentHealthStatus when a health check has been run", () => {
  const root = mkdtempSync(join(tmpdir(), "proj-health-"));
  // Initialize a real git repo so the health check can run
  execFileSync("git", ["init", root], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "commit", "--allow-empty", "-m", "init"], {
    stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "t@test.com", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "t@test.com" },
  });

  const dbPath = freshDb();
  const project = createProject(dbPath, baseInput({ targetRepoPath: root, creationMode: "import_existing" }));
  runProjectHealthCheck(dbPath, project.id);

  const projects = listProjects(dbPath);
  const found = projects.find((p) => p.id === project.id);
  assert.ok(found, "Project should appear in list");
  assert.ok(found?.recentHealthStatus !== undefined, "recentHealthStatus should be set after health check");
});

// ── TASK-014: setCurrentProject / getCurrentProjectSelection ─────────────────

test("getCurrentProjectSelection returns undefined when no project has been selected", () => {
  const dbPath = freshDb();
  const ctx = getCurrentProjectSelection(dbPath);
  assert.equal(ctx, undefined);
});

test("setCurrentProject persists and getCurrentProjectSelection retrieves the context", () => {
  const dbPath = freshDb();
  const project = createProject(dbPath, baseInput());

  const ctx = setCurrentProject(dbPath, project.id);
  assert.equal(ctx.projectId, project.id);
  assert.equal(ctx.switchSource, "manual");
  assert.ok(ctx.switchedAt.length > 0, "switchedAt should be a non-empty timestamp string");

  const retrieved = getCurrentProjectSelection(dbPath);
  assert.ok(retrieved, "Context should be retrievable");
  assert.equal(retrieved?.projectId, project.id);
  assert.equal(retrieved?.switchSource, "manual");
});

test("setCurrentProject accepts explicit switchSource values", () => {
  const dbPath = freshDb();
  const project = createProject(dbPath, baseInput());

  setCurrentProject(dbPath, project.id, "session_restore");
  const ctx = getCurrentProjectSelection(dbPath);
  assert.equal(ctx?.switchSource, "session_restore");
});

test("setCurrentProject overwrites previous selection (singleton context)", () => {
  const dbPath = freshDb();
  const p1 = createProject(dbPath, baseInput({ name: "First" }));
  const p2 = createProject(dbPath, baseInput({ name: "Second" }));

  setCurrentProject(dbPath, p1.id);
  setCurrentProject(dbPath, p2.id);

  const ctx = getCurrentProjectSelection(dbPath);
  assert.equal(ctx?.projectId, p2.id, "Second project should be the current selection");
});

test("setCurrentProject throws ProjectNotFoundError for an unknown projectId", () => {
  const dbPath = freshDb();
  assert.throws(
    () => setCurrentProject(dbPath, "unknown-project-id"),
    (err: unknown) => {
      assert.ok(err instanceof ProjectNotFoundError);
      assert.equal((err as ProjectNotFoundError).projectId, "unknown-project-id");
      return true;
    },
  );
});

// ── TASK-015: assertProjectExists ─────────────────────────────────────────────

test("assertProjectExists returns the project record when found", () => {
  const dbPath = freshDb();
  const project = createProject(dbPath, baseInput());

  const found = assertProjectExists(dbPath, project.id);
  assert.equal(found.id, project.id);
  assert.equal(found.name, project.name);
});

test("assertProjectExists throws ProjectNotFoundError when project does not exist", () => {
  const dbPath = freshDb();
  assert.throws(
    () => assertProjectExists(dbPath, "does-not-exist"),
    (err: unknown) => {
      assert.ok(err instanceof ProjectNotFoundError);
      assert.equal((err as ProjectNotFoundError).projectId, "does-not-exist");
      return true;
    },
  );
});

// ── TASK-016 / TASK-017: initializeProjectPhase1 ─────────────────────────────

test("initializeProjectPhase1 creates a project and returns Phase1InitResult", () => {
  const dbPath = freshDb();
  const result = initializeProjectPhase1(dbPath, baseInput());

  assert.ok(result.project.id.length > 0, "project.id should be set");
  assert.equal(result.project.name, "Test Project");
  assert.equal(typeof result.repositoryConnected, "boolean");
  assert.equal(typeof result.constitutionCreated, "boolean");
  assert.equal(typeof result.memoryInitialized, "boolean");
  assert.ok(["ready", "blocked", "failed"].includes(result.healthStatus));
  assert.ok(Array.isArray(result.blockingReasons));
  assert.equal(typeof result.success, "boolean");
});

test("initializeProjectPhase1 sets the new project as current project", () => {
  const dbPath = freshDb();
  const result = initializeProjectPhase1(dbPath, baseInput({ name: "AutoCurrent" }));

  const ctx = getCurrentProjectSelection(dbPath);
  assert.ok(ctx, "A current project context should be set");
  assert.equal(ctx?.projectId, result.project.id);
  assert.equal(ctx?.switchSource, "auto");
});

test("initializeProjectPhase1 derives workspace path for create_new when no targetRepoPath given", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "proj-ws-"));
  const dbPath = freshDb();

  const result = initializeProjectPhase1(dbPath, {
    ...baseInput({ name: "My New Project", creationMode: "create_new" }),
    workspaceRoot,
  });

  assert.ok(result.project.targetRepoPath, "targetRepoPath should be auto-derived");
  assert.ok(
    result.project.targetRepoPath?.includes("my-new-project"),
    `targetRepoPath should contain slug 'my-new-project', got: ${result.project.targetRepoPath}`,
  );
  assert.ok(
    result.project.targetRepoPath?.startsWith(workspaceRoot),
    "targetRepoPath should be under workspaceRoot",
  );
});

test("initializeProjectPhase1 returns success:false with blockingReasons when project path is not a git repo", () => {
  const root = mkdtempSync(join(tmpdir(), "proj-nogit-"));
  mkdirSync(join(root, "workspace"), { recursive: true });

  const dbPath = freshDb();
  const result = initializeProjectPhase1(dbPath, {
    ...baseInput({ name: "NoGit", creationMode: "import_existing", targetRepoPath: root }),
  });

  assert.equal(result.success, false, "Non-git repo should not succeed");
  assert.ok(result.blockingReasons.length > 0, "Should have blocking reasons");
  assert.ok(
    result.blockingReasons.some((r) => r.includes("git")),
    `Expected git-related blocking reason, got: ${JSON.stringify(result.blockingReasons)}`,
  );
});

test("initializeProjectPhase1 returns success:false on duplicate targetRepoPath", () => {
  const root = mkdtempSync(join(tmpdir(), "proj-dup-"));
  const dbPath = freshDb();

  // First project creation should succeed (with blocked status due to no git)
  initializeProjectPhase1(dbPath, baseInput({ name: "First", creationMode: "import_existing", targetRepoPath: root }));

  // Second project with same path should fail at createProject
  const result = initializeProjectPhase1(dbPath, baseInput({ name: "Second", creationMode: "import_existing", targetRepoPath: root }));
  assert.equal(result.project.status, "failed", "Duplicate path project should have failed status");
  assert.equal(result.success, false);
});

test("readProjectRepository reads realtime git facts and only updates last_read_at", () => {
  const root = mkdtempSync(join(tmpdir(), "proj-realtime-git-"));
  const dbPath = freshDb();
  const project = createProject(dbPath, baseInput({ targetRepoPath: root, creationMode: "import_existing" }));

  const first = readProjectRepository(dbPath, project.id, (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    if (key === "git rev-parse --show-toplevel") return { status: 0, stdout: `${root}\n`, stderr: "" };
    if (key === "git config --get remote.origin.url") return { status: 0, stdout: "git@example.com:repo.git\n", stderr: "" };
    if (key === "git symbolic-ref --short refs/remotes/origin/HEAD") return { status: 0, stdout: "origin/main\n", stderr: "" };
    if (key === "git branch --show-current") return { status: 0, stdout: "feature/one\n", stderr: "" };
    if (key === "git rev-parse HEAD") return { status: 0, stdout: "1111111\n", stderr: "" };
    if (key === "git status --short") return { status: 0, stdout: " M src/one.ts\n", stderr: "" };
    if (key === "git branch --format=%(refname:short)") return { status: 0, stdout: "main\nfeature/one\n", stderr: "" };
    if (key === "git worktree list --porcelain") return { status: 0, stdout: `worktree ${root}\nHEAD 1111111\nbranch refs/heads/feature/one\n`, stderr: "" };
    if (command === "gh") return { status: 1, stdout: "", stderr: "authentication required" };
    return { status: 1, stdout: "", stderr: `unexpected command: ${key}` };
  });
  const second = readProjectRepository(dbPath, project.id, (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    if (key === "git rev-parse --show-toplevel") return { status: 0, stdout: `${root}\n`, stderr: "" };
    if (key === "git config --get remote.origin.url") return { status: 0, stdout: "git@example.com:repo.git\n", stderr: "" };
    if (key === "git symbolic-ref --short refs/remotes/origin/HEAD") return { status: 0, stdout: "origin/main\n", stderr: "" };
    if (key === "git branch --show-current") return { status: 0, stdout: "feature/two\n", stderr: "" };
    if (key === "git rev-parse HEAD") return { status: 0, stdout: "2222222\n", stderr: "" };
    if (key === "git status --short") return { status: 0, stdout: "", stderr: "" };
    if (key === "git branch --format=%(refname:short)") return { status: 0, stdout: "main\nfeature/two\n", stderr: "" };
    if (key === "git worktree list --porcelain") return { status: 0, stdout: `worktree ${root}\nHEAD 2222222\nbranch refs/heads/feature/two\n`, stderr: "" };
    if (command === "gh") return { status: 1, stdout: "", stderr: "authentication required" };
    return { status: 1, stdout: "", stderr: `unexpected command: ${key}` };
  });

  assert.equal(first?.currentBranch, "feature/one");
  assert.equal(first?.latestCommit, "1111111");
  assert.equal(second?.currentBranch, "feature/two");
  assert.equal(second?.latestCommit, "2222222");

  const result = runSqlite(dbPath, [], [
    {
      name: "connection",
      sql: `SELECT remote_url, local_path, default_branch, last_read_at
        FROM repository_connections
        WHERE project_id = ?`,
      params: [project.id],
    },
  ]);
  assert.equal(result.queries.connection.length, 1);
  assert.equal(result.queries.connection[0].local_path, root);
  assert.equal(result.queries.connection[0].default_branch, "main");
  assert.ok(result.queries.connection[0].last_read_at, "last_read_at should be refreshed by realtime reads");
  assert.equal(Object.hasOwn(result.queries.connection[0], "current_branch"), false);
  assert.equal(Object.hasOwn(result.queries.connection[0], "latest_commit"), false);
});

test("health check stores repository summary as a snapshot and realtime reads do not use it", () => {
  const root = mkdtempSync(join(tmpdir(), "proj-health-snapshot-"));
  const dbPath = freshDb();
  const project = createProject(dbPath, baseInput({ targetRepoPath: root, creationMode: "import_existing" }));
  const firstRunner = fixedRepositoryRunner(root, "feature/snapshot", "aaaaaaa");
  const secondRunner = fixedRepositoryRunner(root, "feature/live", "bbbbbbb");

  const healthCheck = runProjectHealthCheck(dbPath, project.id, firstRunner);
  const realtime = readProjectRepository(dbPath, project.id, secondRunner);
  const stored = runSqlite(dbPath, [], [
    {
      name: "health",
      sql: "SELECT repository_summary_json FROM project_health_checks WHERE id = ?",
      params: [healthCheck.id],
    },
  ]).queries.health[0];
  const snapshot = JSON.parse(String(stored.repository_summary_json));

  assert.equal(healthCheck.repositorySummaryKind, "snapshot");
  assert.equal(snapshot.currentBranch, "feature/snapshot");
  assert.equal(snapshot.latestCommit, "aaaaaaa");
  assert.equal(realtime?.currentBranch, "feature/live");
  assert.equal(realtime?.latestCommit, "bbbbbbb");
});

function fixedRepositoryRunner(root: string, branch: string, commit: string) {
  return (command: string, args: string[]) => {
    const key = `${command} ${args.join(" ")}`;
    if (key === "git rev-parse --show-toplevel") return { status: 0, stdout: `${root}\n`, stderr: "" };
    if (key === "git config --get remote.origin.url") return { status: 0, stdout: "git@example.com:repo.git\n", stderr: "" };
    if (key === "git symbolic-ref --short refs/remotes/origin/HEAD") return { status: 0, stdout: "origin/main\n", stderr: "" };
    if (key === "git branch --show-current") return { status: 0, stdout: `${branch}\n`, stderr: "" };
    if (key === "git rev-parse HEAD") return { status: 0, stdout: `${commit}\n`, stderr: "" };
    if (key === "git status --short") return { status: 0, stdout: "", stderr: "" };
    if (key === "git branch --format=%(refname:short)") return { status: 0, stdout: `main\n${branch}\n`, stderr: "" };
    if (key === "git worktree list --porcelain") return { status: 0, stdout: `worktree ${root}\nHEAD ${commit}\nbranch refs/heads/${branch}\n`, stderr: "" };
    if (command === "gh") return { status: 1, stdout: "", stderr: "authentication required" };
    return { status: 1, stdout: "", stderr: `unexpected command: ${key}` };
  };
}
