import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { get, request as httpRequest } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.ts";
import { ARTIFACT_DIRECTORIES } from "../src/artifacts.ts";
import { runBootstrap, initialReadyState } from "../src/bootstrap.ts";
import { createControlPlaneServer, listen } from "../src/server.ts";
import { listTables, initializeSchema, getCurrentSchemaVersion, SCHEMA_VERSION } from "../src/schema.ts";
import { countProjectSkills } from "../src/skills.ts";
import { listAuditEvents } from "../src/persistence.ts";
import { readRepositorySummary } from "../src/repository.ts";
import {
  createProject,
  getCurrentProjectConstitution,
  getProject,
  listConstitutionRevalidationMarks,
  listProjectConstitutions,
  markConstitutionRevalidation,
  readProjectRepository,
  runProjectHealthCheck,
  saveProjectConstitution,
  scanProjectDirectory,
} from "../src/projects.ts";

test("config loader merges file, environment, and CLI with normalized defaults", () => {
  const root = makeTempDir();
  const config = loadConfig({
    cwd: root,
    env: {
      AUTOBUILD_PORT: "5000",
      AUTOBUILD_LOG_LEVEL: "debug",
      AUTOBUILD_RUNNER_COMMAND: "codex",
    },
    argv: ["--port", "5001", "--artifact-root", ".custom-autobuild"],
  });

  assert.equal(config.port, 5001);
  assert.equal(config.logLevel, "debug");
  assert.equal(config.artifactRoot, join(root, ".custom-autobuild"));
  assert.equal(config.dbPath, join(root, ".custom-autobuild", "autobuild.db"));
});

test("config loader rejects invalid required values", () => {
  assert.throws(
    () =>
      loadConfig({
        cwd: makeTempDir(),
        env: {},
        argv: ["--port", "not-a-number"],
      }),
    /Invalid or missing required config: port/,
  );
});

test("bootstrap creates artifact tree, schema, health state, and discovers project skills", async () => {
  const root = makeTempDir();
  createProjectSkill(root);
  const config = loadConfig({ cwd: root, env: {}, argv: [] });

  const first = await runBootstrap(config);
  assert.equal(first.readyState.status, "ready");

  for (const dir of ARTIFACT_DIRECTORIES) {
    assert.equal(existsSync(join(config.artifactRoot, dir)), true);
  }
  assert.equal(existsSync(config.dbPath), true);

  const tables = listTables(config.dbPath);
  for (const table of [
    "projects",
    "repository_connections",
    "project_health_checks",
    "features",
    "requirements",
    "tasks",
    "runs",
    "evidence_packs",
    "project_memories",
    "recovery_dispatches",
    "worktree_records",
    "review_items",
    "approval_records",
    "delivery_reports",
    "audit_timeline_events",
    "metric_samples",
    "schema_migrations",
    "task_graphs",
    "task_graph_tasks",
    "feature_selection_decisions",
    "state_transitions",
    "task_schedules",
    "planning_pipeline_runs",
    "project_constitutions",
    "constitution_revalidation_marks",
  ]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }

  for (const removedTable of ["agent_run_contracts", "skills", "skill_versions", "skill_runs"]) {
    assert.equal(tables.includes(removedTable), false, `${removedTable} should not exist`);
  }

  assert.equal(countProjectSkills({ root }), 1);
  assert.equal(first.readyState.status === "ready" ? first.readyState.projectSkills : 0, 1);

  const second = await runBootstrap(config);
  assert.equal(second.readyState.status, "ready");
  assert.equal(second.readyState.status === "ready" ? second.readyState.projectSkills : 0, 1);
  assert.equal(getCurrentSchemaVersion(config.dbPath), SCHEMA_VERSION);
});

test("project service creates queryable project and repository connection records", async () => {
  const root = makeTempDir();
  createProjectSkill(root);
  const repo = createReadyGitRepo(join(root, "repo"));
  const config = loadConfig({ cwd: root, env: {}, argv: [] });
  await runBootstrap(config);

  const project = createProject(config.dbPath, {
    name: "SpecDrive",
    goal: "Automate spec-driven delivery",
    projectType: "typescript-service",
    techPreferences: ["node", "sqlite"],
    targetRepoPath: repo,
    repositoryUrl: "https://github.com/songcojp/Spec-Driven-Autonomous-Coding-System.git",
    defaultBranch: "main",
    trustLevel: "trusted",
    environment: "local",
    automationEnabled: false,
    constitution: {
      source: "created",
      projectGoal: "Automate spec-driven delivery",
      engineeringPrinciples: ["Keep specs traceable"],
      boundaryRules: ["Do not write outside allowed files"],
      approvalRules: ["Require review for high risk changes"],
      defaultConstraints: ["Use isolated worktrees"],
    },
  });

  const saved = getProject(config.dbPath, project.id);
  assert.equal(saved?.name, "SpecDrive");
  assert.deepEqual(saved?.techPreferences, ["node", "sqlite"]);
  assert.equal(saved?.trustLevel, "trusted");
  assert.equal(saved?.automationEnabled, false);
  assert.equal(getCurrentProjectConstitution(config.dbPath, project.id)?.version, 1);

  const summary = readProjectRepository(config.dbPath, project.id);
  assert.equal(summary?.isGitRepository, true);
  assert.equal(summary?.currentBranch, "main");
  assert.equal(summary?.hasUncommittedChanges, false);
});

test("project health checker classifies ready, blocked, and failed states with reasons", async () => {
  const root = makeTempDir();
  createProjectSkill(root);
  const config = loadConfig({ cwd: root, env: {}, argv: [] });
  await runBootstrap(config);

  const readyProject = createProject(config.dbPath, {
    name: "Ready",
    goal: "Ready repo",
    projectType: "typescript-service",
    targetRepoPath: createReadyGitRepo(join(root, "ready")),
    defaultBranch: "main",
    environment: "local",
  });
  const ready = runProjectHealthCheck(config.dbPath, readyProject.id);
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.reasons, []);

  const missingGitPath = join(root, "missing-git");
  mkdirSync(missingGitPath);
  const blockedProject = createProject(config.dbPath, {
    name: "Blocked",
    goal: "No git repo",
    projectType: "typescript-service",
    targetRepoPath: missingGitPath,
    defaultBranch: "main",
    environment: "local",
  });
  const blocked = runProjectHealthCheck(config.dbPath, blockedProject.id);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reasons.includes("git_repository_missing"), true);

  const failedProject = createProject(config.dbPath, {
    name: "Failed",
    goal: "Missing path",
    projectType: "typescript-service",
    targetRepoPath: join(root, "does-not-exist"),
    defaultBranch: "main",
    environment: "local",
  });
  const failed = runProjectHealthCheck(config.dbPath, failedProject.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.reasons.includes("git_repository_missing"), true);
});

test("project directory scan does not treat an unborn HEAD as a commit", () => {
  const root = makeTempDir();
  const repo = join(root, "docs-only");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "PRD.md"), "# PRD\n", "utf8");
  execFileSync("git", ["init", "-b", "main"], { cwd: repo });

  const scan = scanProjectDirectory({ targetRepoPath: repo });
  const summary = readRepositorySummary(repo);

  assert.equal(scan.isGitRepository, true);
  assert.equal(scan.defaultBranch, "main");
  assert.equal(scan.errors.length, 0);
  assert.equal(summary.latestCommit, undefined);
});

test("project constitution versions are auditable and mark downstream revalidation", async () => {
  const root = makeTempDir();
  createProjectSkill(root);
  const config = loadConfig({ cwd: root, env: {}, argv: [] });
  await runBootstrap(config);

  const project = createProject(config.dbPath, {
    name: "Governed",
    goal: "Govern feature execution",
    projectType: "typescript-service",
    trustLevel: "restricted",
    environment: "local",
  });

  const first = saveProjectConstitution(config.dbPath, project.id, {
    source: "imported",
    title: "Initial Constitution",
    projectGoal: "Govern feature execution",
    engineeringPrinciples: ["Trace every requirement"],
    boundaryRules: ["Keep feature worktree isolated"],
    approvalRules: ["Approval is required for security risk"],
    defaultConstraints: ["Run targeted tests"],
  });
  const second = saveProjectConstitution(config.dbPath, project.id, {
    title: "Updated Constitution",
    projectGoal: "Govern feature execution safely",
    engineeringPrinciples: ["Trace every requirement", "Preserve auditability"],
    boundaryRules: ["Keep feature worktree isolated"],
    approvalRules: ["Approval is required for security risk"],
    defaultConstraints: ["Run targeted tests"],
  });

  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal(getCurrentProjectConstitution(config.dbPath, project.id)?.id, second.id);
  assert.deepEqual(listProjectConstitutions(config.dbPath, project.id).map((item) => item.status), [
    "active",
    "superseded",
  ]);

  const mark = markConstitutionRevalidation(config.dbPath, {
    projectId: project.id,
    constitutionId: second.id,
    entityType: "feature",
    entityId: "FEAT-001",
    reason: "constitution updated",
  });

  assert.equal(mark.status, "pending");
  assert.equal(listConstitutionRevalidationMarks(config.dbPath, project.id)[0].entityId, "FEAT-001");
  assert.equal(
    listAuditEvents(config.dbPath, "project", project.id).some((event) => event.eventType === "project_constitution_versioned"),
    true,
  );
  assert.equal(
    listAuditEvents(config.dbPath, "feature", "FEAT-001").some((event) => event.eventType === "constitution_revalidation_marked"),
    true,
  );
});

test("project API exposes project creation, repository summary, and health checks", async () => {
  const root = makeTempDir();
  createProjectSkill(root);
  const repo = createReadyGitRepo(join(root, "api-repo"));
  const config = loadConfig({ cwd: root, env: {}, argv: ["--port", "0"] });
  await runBootstrap(config);
  const controlPlane = createControlPlaneServer(config, initialReadyState(config));

  await listen(controlPlane.server, config);
  const address = controlPlane.server.address();
  assert.equal(typeof address, "object");
  const port = address && typeof address === "object" ? address.port : 0;

  try {
    const project = await postJson(`http://127.0.0.1:${port}/projects`, {
      name: "API Project",
      goal: "Expose dashboard query model",
      projectType: "typescript-service",
      targetRepoPath: repo,
      defaultBranch: "main",
      trustLevel: "trusted",
      environment: "local",
    });
    assert.equal(project.name, "API Project");
    assert.equal(project.trustLevel, "trusted");

    const repository = await getJson(`http://127.0.0.1:${port}/projects/${project.id}/repository`);
    assert.equal(repository.isGitRepository, true);

    const scanned = await postJson(`http://127.0.0.1:${port}/projects/scan`, {
      targetRepoPath: repo,
    });
    assert.equal(scanned.name, "api-repo");
    assert.equal(scanned.isGitRepository, true);
    assert.equal(scanned.defaultBranch, "main");
    assert.equal(scanned.packageManager, "npm");
    assert.equal(scanned.hasSpecProtocolDirectory, true);

    const health = await postJson(`http://127.0.0.1:${port}/projects/${project.id}/health`, {});
    assert.equal(health.status, "ready");

    const constitution = await postJson(`http://127.0.0.1:${port}/projects/${project.id}/constitution`, {
      source: "created",
      projectGoal: "Expose governed project initialization",
      engineeringPrinciples: ["Keep user decisions traceable"],
      boundaryRules: ["Use controlled commands"],
      approvalRules: ["Route high risk changes to Review Center"],
      defaultConstraints: ["Run targeted tests"],
    });
    assert.equal(constitution.version, 1);

    const mark = await postJson(`http://127.0.0.1:${port}/projects/${project.id}/constitution/revalidations`, {
      constitutionId: constitution.id,
      entityType: "task",
      entityId: "TASK-001",
      reason: "constitution changed",
    });
    assert.equal(mark.status, "pending");
  } finally {
    await new Promise<void>((resolve) => controlPlane.server.close(() => resolve()));
  }
});

test("schema migration executor applies later versions once", () => {
  const root = makeTempDir();
  const dbPath = join(root, ".autobuild", "autobuild.db");
  const state = initializeSchema(dbPath, [
    {
      version: 1,
      description: "first",
      statements: ["CREATE TABLE IF NOT EXISTS first_table (id TEXT PRIMARY KEY)"],
    },
    {
      version: 2,
      description: "second",
      statements: ["CREATE TABLE IF NOT EXISTS second_table (id TEXT PRIMARY KEY)"],
    },
  ]);

  assert.deepEqual(state.appliedMigrations, [1, 2]);
  assert.equal(getCurrentSchemaVersion(dbPath), 2);

  const repeated = initializeSchema(dbPath, [
    {
      version: 1,
      description: "first",
      statements: ["CREATE TABLE IF NOT EXISTS first_table (id TEXT PRIMARY KEY)"],
    },
    {
      version: 2,
      description: "second",
      statements: ["CREATE TABLE IF NOT EXISTS second_table (id TEXT PRIMARY KEY)"],
    },
  ]);
  assert.deepEqual(repeated.appliedMigrations, []);
});

test("health endpoint reports initializing and ready states", async () => {
  const root = makeTempDir();
  createProjectSkill(root);
  const config = loadConfig({ cwd: root, env: {}, argv: ["--port", "0"] });
  const controlPlane = createControlPlaneServer(config, initialReadyState(config));

  await listen(controlPlane.server, config);
  const address = controlPlane.server.address();
  assert.equal(typeof address, "object");
  const port = address && typeof address === "object" ? address.port : 0;

  const initializing = await getJson(`http://127.0.0.1:${port}/health`);
  assert.equal(initializing.status, "initializing");

  const result = await runBootstrap(config);
  controlPlane.setReadyState(result.readyState);
  const ready = await getJson(`http://127.0.0.1:${port}/health`);
  assert.equal(ready.status, "ready");
  assert.equal(ready.schemaVersion, SCHEMA_VERSION);

  await new Promise<void>((resolve) => controlPlane.server.close(() => resolve()));
});

test("bootstrap failure returns observable error state", async () => {
  if (process.getuid?.() === 0) {
    return;
  }

  const root = makeTempDir();
  const locked = join(root, "locked");
  const config = loadConfig({
    cwd: root,
    env: {},
    argv: ["--artifact-root", join(locked, ".autobuild")],
  });
  chmodSync(root, 0o500);

  try {
    const result = await runBootstrap(config);
    assert.equal(result.readyState.status, "error");
  } finally {
    chmodSync(root, 0o700);
  }
});

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "autobuild-test-"));
}

function createProjectSkill(root: string): void {
  const skillDir = join(root, ".agents", "skills", "bootstrap-skill");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: bootstrap-skill\ndescription: Bootstrap test skill.\n---\n", "utf8");
}

function createReadyGitRepo(path: string): string {
  mkdirSync(path, { recursive: true });
  mkdirSync(join(path, ".codex"));
  mkdirSync(join(path, "docs", "features"), { recursive: true });
  writeFileSync(join(path, "AGENTS.md"), "# Agent Instructions\n");
  writeFileSync(
    join(path, "package.json"),
    JSON.stringify({ scripts: { test: "node --test", build: "node --check src/index.js" } }),
  );
  mkdirSync(join(path, "src"));
  writeFileSync(join(path, "src", "index.js"), "console.log('ready');\n");
  execFileSync("git", ["init", "-b", "main"], { cwd: path });
  execFileSync("git", ["add", "."], { cwd: path });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], {
    cwd: path,
    stdio: "ignore",
  });
  return path;
}

function getJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

function postJson(url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = new URL(url);
    const outgoing = httpRequest(
      {
        hostname: request.hostname,
        port: request.port,
        path: request.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(responseBody));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}
