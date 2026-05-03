import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureArtifactDirectories } from "../src/artifacts.ts";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import {
  applyIdempotentOperation,
  ensureAutobuildArtifactLayout,
  getCoreEntitySnapshot,
  listAuditEvents,
  listMetricSamples,
  listRecoverableWork,
  persistCoreEntitySnapshot,
  recordAuditEvent,
  recordMetricSample,
  sanitizeForOrdinaryLog,
  writeSanitizedArtifact,
  type CoreEntityInput,
} from "../src/persistence.ts";
import { createReviewItem, recordApprovalDecision } from "../src/review-center.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

test("schema includes persistence, audit, metrics, idempotency, and recovery tables", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const tables = listTables(dbPath);
  for (const table of [
    "projects",
    "features",
    "requirements",
    "tasks",
    "runs",
    "project_memories",
    "status_check_results",
    "audit_timeline_events",
    "metric_samples",
    "token_consumption_records",
    "idempotency_keys",
    "recovery_index_entries",
  ]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }
});

test("core entity required fields persist and recover as one state snapshot", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const snapshot = persistCoreEntitySnapshot(dbPath, sampleCoreEntityInput());

  assert.equal(snapshot.project.name, "SpecDrive");
  assert.equal(snapshot.feature.folder, "feat-014-persistence-auditability");
  assert.deepEqual(snapshot.feature.primaryRequirements, ["REQ-058", "NFR-003"]);
  assert.equal(snapshot.requirement.acceptanceCriteria, "Core entities can be read after restart.");
  assert.equal(snapshot.task.recoveryState, "incomplete");
  assert.equal(snapshot.run.metadata.runner, "codex");
  assert.equal(snapshot.projectMemory.summary.includes("secret=topsecret"), false);
  assert.equal(snapshot.executionResult.summary.includes("token=abc123"), false);

  const recovered = getCoreEntitySnapshot(dbPath, "project-1", "FEAT-014", "TASK-001", "RUN-001");
  assert.equal(recovered.executionResult.path, ".autobuild/reports/RUN-001.json");
});

test("core entity persistence enforces review approval before terminal task state", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  persistCoreEntitySnapshot(dbPath, sampleCoreEntityInput());
  createReviewItem(dbPath, {
    id: "REV-PERSISTENCE-GATE",
    taskId: "TASK-001",
    message: "Task completion requires reviewer approval.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });

  assert.throws(
    () =>
      persistCoreEntitySnapshot(dbPath, {
        ...sampleCoreEntityInput(),
        task: { ...sampleCoreEntityInput().task, status: "done" },
        run: { ...sampleCoreEntityInput().run, status: "completed" },
      }),
    /Positive approval required/,
  );
});

test("core entity persistence accepts approved post-completion reviews", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const doneInput = {
    ...sampleCoreEntityInput(),
    feature: { ...sampleCoreEntityInput().feature, status: "done" },
    task: { ...sampleCoreEntityInput().task, status: "done" },
    run: { ...sampleCoreEntityInput().run, status: "completed" },
  };
  persistCoreEntitySnapshot(dbPath, doneInput);
  createReviewItem(dbPath, {
    id: "REV-POST-COMPLETION",
    taskId: "TASK-001",
    message: "Post-completion review should not require another terminal transition.",
    reviewNeededReason: "approval_needed",
    triggerReasons: ["permission_escalation"],
    now: stableDate,
  });
  recordApprovalDecision(dbPath, {
    reviewItemId: "REV-POST-COMPLETION",
    decision: "approve_continue",
    actor: "reviewer",
    reason: "Review approved after completion.",
    now: stableDate,
  });

  assert.doesNotThrow(() => persistCoreEntitySnapshot(dbPath, doneInput));
});

test("idempotency manager replays run, state, memory, execution result, and recovery keys once", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  for (const scope of ["run", "state", "memory", "reports", "recovery"]) {
    const key = `FEAT-014:${scope}:RUN-001`;
    const first = applyIdempotentOperation(dbPath, {
      key,
      scope,
      operation: "upsert",
      entityType: scope,
      entityId: "RUN-001",
      payload: { nested: { status: "running", scope } },
      result: { stored: true, scope },
    });
    const second = applyIdempotentOperation(dbPath, {
      key,
      scope,
      operation: "upsert",
      entityType: scope,
      entityId: "RUN-001",
      payload: { nested: { scope, status: "running" } },
      result: { stored: false },
    });

    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.deepEqual(second.result, { stored: true, scope });
  }
});

test("audit timeline records source, reason, and sanitized payload for required event classes", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  for (const eventType of [
    "state_changed",
    "run_started",
    "approval_recorded",
    "recovery_requested",
    "memory_compacted",
    "worktree_created",
    "delivery_completed",
  ]) {
    recordAuditEvent(dbPath, {
      entityType: "feature",
      entityId: "FEAT-014",
      eventType,
      source: "test",
      reason: `${eventType} acceptance coverage`,
      payload: { detail: "password=hunter2" },
    });
  }

  const events = listAuditEvents(dbPath, "feature", "FEAT-014");
  assert.deepEqual(events.map((event) => event.eventType), [
    "state_changed",
    "run_started",
    "approval_recorded",
    "recovery_requested",
    "memory_compacted",
    "worktree_created",
    "delivery_completed",
  ]);
  assert.equal(JSON.stringify(events).includes("hunter2"), false);
});

test("metrics collector records success, failure, performance, execution result, and heartbeat samples", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  for (const metric of [
    { name: "success_rate", value: 0.9, unit: "ratio" },
    { name: "failure_rate", value: 0.1, unit: "ratio" },
    { name: "dashboard_load_ms", value: 120, unit: "ms" },
    { name: "status_refresh_ms", value: 50, unit: "ms" },
    { name: "status_check_completed", value: 25, unit: "ms" },
    { name: "runner_heartbeat", value: 1, unit: "count" },
  ]) {
    recordMetricSample(dbPath, { ...metric, labels: { featureId: "FEAT-014" } });
  }

  const metrics = listMetricSamples(dbPath);
  assert.deepEqual(metrics.map((metric) => metric.name), [
    "success_rate",
    "failure_rate",
    "dashboard_load_ms",
    "status_refresh_ms",
    "status_check_completed",
    "runner_heartbeat",
  ]);
});

test("token consumption records store run-level token and cost facts outside metrics", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO token_consumption_records (
          id, run_id, scheduler_job_id, project_id, feature_id, task_id, operation, model,
          input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
          cost_usd, currency, pricing_status, usage_json, pricing_json, source_path
        ) VALUES (
          'TOKEN-001', 'RUN-001', 'JOB-001', 'project-1', 'FEAT-014', 'TASK-001', 'feature_execution', 'gpt-5.5',
          1000, 100, 200, 50, 1250, 0.42, 'USD', 'priced',
          '{"inputTokens":1000,"outputTokens":200}', '{"model":"gpt-5.5"}', '.autobuild/runs/RUN-001/stdout.log'
        )`,
    },
  ]);

  const result = runSqlite(dbPath, [], [
    { name: "tokens", sql: "SELECT run_id, total_tokens, cost_usd FROM token_consumption_records" },
    { name: "metrics", sql: "SELECT metric_name FROM metric_samples WHERE metric_name IN ('tokens_used', 'cost_usd')" },
  ]);
  assert.deepEqual(result.queries.tokens.map((row) => [row.run_id, row.total_tokens, row.cost_usd]), [["RUN-001", 1250, 0.42]]);
  assert.deepEqual(result.queries.metrics, []);
});

test("artifact layout covers memory, specs, reports, and runs with sanitized writes", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-014-artifacts-"));
  const artifactRoot = join(root, ".autobuild");

  ensureArtifactDirectories(artifactRoot);
  const layout = ensureAutobuildArtifactLayout(artifactRoot);
  for (const dir of ["memory", "specs", "reports", "runs"] as const) {
    assert.equal(existsSync(layout[dir]), true);
  }

  const relativePath = writeSanitizedArtifact(
    artifactRoot,
    "reports",
    "RUN-001.json",
    "token=abc123 password=hunter2 postgres://user:pass@localhost/db",
  );
  const written = readFileSync(join(artifactRoot, relativePath), "utf8");
  assert.equal(written.includes("abc123"), false);
  assert.equal(written.includes("hunter2"), false);
  assert.equal(written.includes("user:pass"), false);
});

test("recovery index exposes unfinished tasks after crash-like replay", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  persistCoreEntitySnapshot(dbPath, sampleCoreEntityInput());

  const recoverable = listRecoverableWork(dbPath);
  assert.equal(recoverable.length, 1);
  assert.equal(recoverable[0].taskId, "TASK-001");
  assert.equal(recoverable[0].runId, "RUN-001");
  assert.equal(recoverable[0].recoveryState, "incomplete");
});

test("ordinary log sanitizer redacts token, password, secret, key, and connection strings", () => {
  const sanitized = sanitizeForOrdinaryLog(
    "token=abc password=hunter2 secret=sauce api_key=key123 postgres://user:pass@localhost/db",
  );

  for (const sensitive of ["abc", "hunter2", "sauce", "key123", "user:pass"]) {
    assert.equal(sanitized.includes(sensitive), false);
  }
  assert.match(sanitized, /\[REDACTED\]/);
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "feat-014-db-")), ".autobuild", "autobuild.db");
}

function sampleCoreEntityInput(): CoreEntityInput {
  return {
    project: {
      id: "project-1",
      name: "SpecDrive",
      goal: "Automate spec driven delivery",
      projectType: "typescript-service",
      trustLevel: "standard",
      environment: "local",
      status: "ready",
      techPreferences: ["node", "sqlite"],
    },
    feature: {
      id: "FEAT-014",
      projectId: "project-1",
      title: "Persistence and Auditability",
      folder: "feat-014-persistence-auditability",
      status: "in-progress",
      primaryRequirements: ["REQ-058", "NFR-003"],
    },
    requirement: {
      id: "REQ-058",
      featureId: "FEAT-014",
      sourceId: "docs/zh-CN/requirements.md#REQ-058",
      body: "Persistent control-plane state is recoverable.",
      acceptanceCriteria: "Core entities can be read after restart.",
      priority: "must",
    },
    task: {
      id: "TASK-001",
      featureId: "FEAT-014",
      title: "Persist core entities",
      status: "running",
      recoveryState: "incomplete",
    },
    run: {
      id: "RUN-001",
      taskId: "TASK-001",
      featureId: "FEAT-014",
      projectId: "project-1",
      status: "running",
      metadata: { runner: "codex" },
      idempotencyKey: "run:RUN-001",
    },
    projectMemory: {
      id: "memory-1",
      projectId: "project-1",
      path: ".autobuild/memory/project.md",
      summary: "Recovered state without secret=topsecret",
      currentVersion: 3,
    },
    executionResult: {
      id: "evidence-1",
      runId: "RUN-001",
      taskId: "TASK-001",
      featureId: "FEAT-014",
      path: ".autobuild/reports/RUN-001.json",
      kind: "test",
      summary: "Evidence collected with token=abc123",
    },
  };
}
