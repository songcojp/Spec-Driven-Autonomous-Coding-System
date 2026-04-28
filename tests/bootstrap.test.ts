import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, chmodSync } from "node:fs";
import { get } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.ts";
import { ARTIFACT_DIRECTORIES } from "../src/artifacts.ts";
import { runBootstrap, initialReadyState } from "../src/bootstrap.ts";
import { createControlPlaneServer, listen } from "../src/server.ts";
import { listTables, initializeSchema, getCurrentSchemaVersion } from "../src/schema.ts";
import { BUILT_IN_SKILLS, countBuiltInSkills } from "../src/skills.ts";

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

test("bootstrap creates artifact tree, schema, health state, and idempotent skills", async () => {
  const root = makeTempDir();
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
    "features",
    "requirements",
    "tasks",
    "runs",
    "agent_run_contracts",
    "evidence_packs",
    "project_memories",
    "skills",
    "skill_versions",
    "skill_runs",
    "worktree_records",
    "review_items",
    "approval_records",
    "delivery_reports",
    "audit_timeline_events",
    "metric_samples",
    "schema_migrations",
  ]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }

  assert.equal(countBuiltInSkills(config.dbPath), BUILT_IN_SKILLS.length);

  const second = await runBootstrap(config);
  assert.equal(second.readyState.status, "ready");
  assert.equal(countBuiltInSkills(config.dbPath), BUILT_IN_SKILLS.length);
  assert.equal(getCurrentSchemaVersion(config.dbPath), 1);
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
  assert.equal(ready.schemaVersion, 1);

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
