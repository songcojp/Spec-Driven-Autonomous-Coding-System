import { randomUUID, createHash } from "node:crypto";
import { join, relative } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { ARTIFACT_DIRECTORIES } from "./artifacts.ts";
import { runSqlite } from "./sqlite.ts";

export type CoreEntitySnapshot = {
  project: {
    id: string;
    name: string;
    goal: string;
    projectType: string;
    environment: string;
    status: string;
  };
  feature: {
    id: string;
    projectId: string;
    title: string;
    folder: string;
    status: string;
    primaryRequirements: string[];
  };
  requirement: {
    id: string;
    featureId: string;
    sourceId: string;
    body: string;
    acceptanceCriteria: string;
    priority: string;
  };
  task: {
    id: string;
    featureId: string;
    title: string;
    status: string;
    recoveryState: string;
  };
  run: {
    id: string;
    taskId: string;
    featureId: string;
    projectId: string;
    status: string;
    metadata: Record<string, unknown>;
  };
  projectMemory: {
    id: string;
    projectId: string;
    path: string;
    summary: string;
    currentVersion: number;
  };
  evidencePack: {
    id: string;
    runId: string;
    taskId: string;
    featureId: string;
    path: string;
    kind: string;
    summary: string;
  };
};

export type CoreEntityInput = {
  project: CoreEntitySnapshot["project"] & { techPreferences?: string[] };
  feature: CoreEntitySnapshot["feature"];
  requirement: CoreEntitySnapshot["requirement"];
  task: Omit<CoreEntitySnapshot["task"], "recoveryState"> & { recoveryState?: string };
  run: CoreEntitySnapshot["run"] & { idempotencyKey?: string };
  projectMemory: CoreEntitySnapshot["projectMemory"];
  evidencePack: CoreEntitySnapshot["evidencePack"];
};

export type IdempotencyInput = {
  key: string;
  scope: string;
  operation: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  result?: unknown;
};

export type IdempotencyResult = {
  replayed: boolean;
  key: string;
  result: Record<string, unknown>;
};

export type AuditEventInput = {
  entityType: string;
  entityId: string;
  eventType: string;
  source: string;
  reason: string;
  payload?: Record<string, unknown>;
};

export type MetricInput = {
  name: string;
  value: number;
  unit?: string;
  labels?: Record<string, unknown>;
};

export type RecoveryEntryInput = {
  projectId?: string;
  featureId?: string;
  taskId?: string;
  runId?: string;
  evidencePackId?: string;
  projectMemoryId?: string;
  recoveryState: string;
  reason: string;
};

export const ORDINARY_LOG_SECRET_PATTERNS = [
  /(token\s*[:=]\s*)[^,\s]+/gi,
  /(password\s*[:=]\s*)[^,\s]+/gi,
  /(secret\s*[:=]\s*)[^,\s]+/gi,
  /(api[_-]?key\s*[:=]\s*)[^,\s]+/gi,
  /((?:postgres|mysql|sqlite):\/\/)[^\s]+/gi,
] as const;

export function persistCoreEntitySnapshot(dbPath: string, input: CoreEntityInput): CoreEntitySnapshot {
  const projectPreferences = JSON.stringify(input.project.techPreferences ?? []);
  const now = new Date().toISOString();

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO projects (
        id, name, goal, project_type, tech_preferences_json, environment, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        goal = excluded.goal,
        project_type = excluded.project_type,
        tech_preferences_json = excluded.tech_preferences_json,
        environment = excluded.environment,
        status = excluded.status,
        updated_at = excluded.updated_at`,
      params: [
        input.project.id,
        input.project.name,
        input.project.goal,
        input.project.projectType,
        projectPreferences,
        input.project.environment,
        input.project.status,
        now,
      ],
    },
    {
      sql: `INSERT INTO features (
        id, project_id, title, folder, primary_requirements_json, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        folder = excluded.folder,
        primary_requirements_json = excluded.primary_requirements_json,
        status = excluded.status,
        updated_at = excluded.updated_at`,
      params: [
        input.feature.id,
        input.feature.projectId,
        input.feature.title,
        input.feature.folder,
        JSON.stringify(input.feature.primaryRequirements),
        input.feature.status,
        now,
      ],
    },
    {
      sql: `INSERT INTO requirements (
        id, feature_id, source_id, body, acceptance_criteria, priority, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        feature_id = excluded.feature_id,
        source_id = excluded.source_id,
        body = excluded.body,
        acceptance_criteria = excluded.acceptance_criteria,
        priority = excluded.priority,
        updated_at = excluded.updated_at`,
      params: [
        input.requirement.id,
        input.requirement.featureId,
        input.requirement.sourceId,
        input.requirement.body,
        input.requirement.acceptanceCriteria,
        input.requirement.priority,
        now,
      ],
    },
    {
      sql: `INSERT INTO tasks (
        id, feature_id, title, status, recovery_state, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        feature_id = excluded.feature_id,
        title = excluded.title,
        status = excluded.status,
        recovery_state = excluded.recovery_state,
        updated_at = excluded.updated_at`,
      params: [
        input.task.id,
        input.task.featureId,
        input.task.title,
        input.task.status,
        input.task.recoveryState ?? "pending",
        now,
      ],
    },
    {
      sql: `INSERT INTO runs (
        id, task_id, feature_id, project_id, idempotency_key, status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        feature_id = excluded.feature_id,
        project_id = excluded.project_id,
        idempotency_key = excluded.idempotency_key,
        status = excluded.status,
        metadata_json = excluded.metadata_json`,
      params: [
        input.run.id,
        input.run.taskId,
        input.run.featureId,
        input.run.projectId,
        input.run.idempotencyKey ?? null,
        input.run.status,
        JSON.stringify(input.run.metadata),
      ],
    },
    {
      sql: `INSERT INTO project_memories (
        id, project_id, path, summary, current_version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        path = excluded.path,
        summary = excluded.summary,
        current_version = excluded.current_version,
        updated_at = excluded.updated_at`,
      params: [
        input.projectMemory.id,
        input.projectMemory.projectId,
        input.projectMemory.path,
        sanitizeForOrdinaryLog(input.projectMemory.summary),
        input.projectMemory.currentVersion,
        now,
      ],
    },
    {
      sql: `INSERT INTO evidence_packs (
        id, run_id, task_id, feature_id, path, kind, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        run_id = excluded.run_id,
        task_id = excluded.task_id,
        feature_id = excluded.feature_id,
        path = excluded.path,
        kind = excluded.kind,
        summary = excluded.summary`,
      params: [
        input.evidencePack.id,
        input.evidencePack.runId,
        input.evidencePack.taskId,
        input.evidencePack.featureId,
        input.evidencePack.path,
        input.evidencePack.kind,
        sanitizeForOrdinaryLog(input.evidencePack.summary),
      ],
    },
  ]);

  recordAuditEvent(dbPath, {
    entityType: "project",
    entityId: input.project.id,
    eventType: "core_entities_persisted",
    source: "persistence",
    reason: "state recovery snapshot updated",
    payload: { featureId: input.feature.id, taskId: input.task.id, runId: input.run.id },
  });

  if (input.task.status !== "done" || input.run.status !== "completed") {
    recordRecoveryEntry(dbPath, {
      projectId: input.project.id,
      featureId: input.feature.id,
      taskId: input.task.id,
      runId: input.run.id,
      evidencePackId: input.evidencePack.id,
      projectMemoryId: input.projectMemory.id,
      recoveryState: input.run.status === "failed" ? "failed" : "incomplete",
      reason: "snapshot contains unfinished task or run",
    });
  }

  return getCoreEntitySnapshot(dbPath, input.project.id, input.feature.id, input.task.id, input.run.id);
}

export function getCoreEntitySnapshot(
  dbPath: string,
  projectId: string,
  featureId: string,
  taskId: string,
  runId: string,
): CoreEntitySnapshot {
  const result = runSqlite(dbPath, [], [
    { name: "project", sql: "SELECT * FROM projects WHERE id = ?", params: [projectId] },
    { name: "feature", sql: "SELECT * FROM features WHERE id = ?", params: [featureId] },
    { name: "requirement", sql: "SELECT * FROM requirements WHERE feature_id = ? ORDER BY id LIMIT 1", params: [featureId] },
    { name: "task", sql: "SELECT * FROM tasks WHERE id = ?", params: [taskId] },
    { name: "run", sql: "SELECT * FROM runs WHERE id = ?", params: [runId] },
    { name: "projectMemory", sql: "SELECT * FROM project_memories WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1", params: [projectId] },
    { name: "evidencePack", sql: "SELECT * FROM evidence_packs WHERE run_id = ? ORDER BY created_at DESC LIMIT 1", params: [runId] },
  ]);

  const project = requiredRow(result.queries.project, "project");
  const feature = requiredRow(result.queries.feature, "feature");
  const requirement = requiredRow(result.queries.requirement, "requirement");
  const task = requiredRow(result.queries.task, "task");
  const run = requiredRow(result.queries.run, "run");
  const projectMemory = requiredRow(result.queries.projectMemory, "projectMemory");
  const evidencePack = requiredRow(result.queries.evidencePack, "evidencePack");

  return {
    project: {
      id: String(project.id),
      name: String(project.name),
      goal: String(project.goal),
      projectType: String(project.project_type),
      environment: String(project.environment),
      status: String(project.status),
    },
    feature: {
      id: String(feature.id),
      projectId: String(feature.project_id),
      title: String(feature.title),
      folder: String(feature.folder),
      status: String(feature.status),
      primaryRequirements: parseJsonArray(feature.primary_requirements_json),
    },
    requirement: {
      id: String(requirement.id),
      featureId: String(requirement.feature_id),
      sourceId: String(requirement.source_id),
      body: String(requirement.body),
      acceptanceCriteria: String(requirement.acceptance_criteria),
      priority: String(requirement.priority),
    },
    task: {
      id: String(task.id),
      featureId: String(task.feature_id),
      title: String(task.title),
      status: String(task.status),
      recoveryState: String(task.recovery_state),
    },
    run: {
      id: String(run.id),
      taskId: String(run.task_id),
      featureId: String(run.feature_id),
      projectId: String(run.project_id),
      status: String(run.status),
      metadata: parseJsonObject(run.metadata_json),
    },
    projectMemory: {
      id: String(projectMemory.id),
      projectId: String(projectMemory.project_id),
      path: String(projectMemory.path),
      summary: String(projectMemory.summary),
      currentVersion: Number(projectMemory.current_version),
    },
    evidencePack: {
      id: String(evidencePack.id),
      runId: String(evidencePack.run_id),
      taskId: String(evidencePack.task_id),
      featureId: String(evidencePack.feature_id),
      path: String(evidencePack.path),
      kind: String(evidencePack.kind),
      summary: String(evidencePack.summary),
    },
  };
}

export function applyIdempotentOperation(dbPath: string, input: IdempotencyInput): IdempotencyResult {
  const requestHash = stableHash(input.payload);
  const existing = runSqlite(dbPath, [], [
    { name: "key", sql: "SELECT * FROM idempotency_keys WHERE key = ?", params: [input.key] },
  ]).queries.key[0];

  if (existing) {
    runSqlite(dbPath, [
      { sql: "UPDATE idempotency_keys SET last_seen_at = CURRENT_TIMESTAMP WHERE key = ?", params: [input.key] },
    ]);
    return {
      replayed: true,
      key: input.key,
      result: parseJsonObject(existing.result_json),
    };
  }

  const result = asJsonObject(input.result ?? { status: "applied", requestHash });
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO idempotency_keys (
        key, scope, operation, entity_type, entity_id, request_hash, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.key,
        input.scope,
        input.operation,
        input.entityType,
        input.entityId,
        requestHash,
        JSON.stringify(result),
      ],
    },
  ]);

  recordAuditEvent(dbPath, {
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: `${input.operation}_idempotency_recorded`,
    source: "idempotency",
    reason: `${input.scope} operation accepted once`,
    payload: { key: input.key, requestHash },
  });

  return { replayed: false, key: input.key, result };
}

export function recordAuditEvent(dbPath: string, input: AuditEventInput): string {
  const id = randomUUID();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO audit_timeline_events (
        id, entity_type, entity_id, event_type, source, reason, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        input.entityType,
        input.entityId,
        input.eventType,
        input.source,
        input.reason,
        JSON.stringify(sanitizePayload(input.payload ?? {})),
      ],
    },
  ]);
  return id;
}

export function listAuditEvents(dbPath: string, entityType: string, entityId: string): AuditEventInput[] {
  const rows = runSqlite(dbPath, [], [
    {
      name: "events",
      sql: `SELECT * FROM audit_timeline_events
        WHERE entity_type = ? AND entity_id = ?
        ORDER BY created_at, rowid`,
      params: [entityType, entityId],
    },
  ]).queries.events;

  return rows.map((row) => ({
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    eventType: String(row.event_type),
    source: String(row.source),
    reason: String(row.reason),
    payload: parseJsonObject(row.payload_json),
  }));
}

export function recordMetricSample(dbPath: string, input: MetricInput): string {
  const id = randomUUID();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO metric_samples (
        id, metric_name, metric_value, unit, labels_json
      ) VALUES (?, ?, ?, ?, ?)`,
      params: [
        id,
        input.name,
        input.value,
        input.unit ?? "count",
        JSON.stringify(sanitizePayload(input.labels ?? {})),
      ],
    },
  ]);
  return id;
}

export function listMetricSamples(dbPath: string): MetricInput[] {
  const rows = runSqlite(dbPath, [], [
    { name: "metrics", sql: "SELECT * FROM metric_samples ORDER BY sampled_at, rowid" },
  ]).queries.metrics;

  return rows.map((row) => ({
    name: String(row.metric_name),
    value: Number(row.metric_value),
    unit: String(row.unit),
    labels: parseJsonObject(row.labels_json),
  }));
}

export function ensureAutobuildArtifactLayout(artifactRoot: string): Record<(typeof ARTIFACT_DIRECTORIES)[number], string> {
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  return Object.fromEntries(
    ARTIFACT_DIRECTORIES.map((dir) => {
      const path = join(artifactRoot, dir);
      mkdirSync(path, { recursive: true, mode: 0o700 });
      return [dir, path];
    }),
  ) as Record<(typeof ARTIFACT_DIRECTORIES)[number], string>;
}

export function writeSanitizedArtifact(artifactRoot: string, directory: (typeof ARTIFACT_DIRECTORIES)[number], name: string, content: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(`Invalid artifact name: ${name}`);
  }
  const layout = ensureAutobuildArtifactLayout(artifactRoot);
  const path = join(layout[directory], name);
  writeFileSync(path, sanitizeForOrdinaryLog(content), "utf8");
  return relative(artifactRoot, path);
}

export function recordRecoveryEntry(dbPath: string, input: RecoveryEntryInput): string {
  const id = randomUUID();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO recovery_index_entries (
        id, project_id, feature_id, task_id, run_id, evidence_pack_id,
        project_memory_id, recovery_state, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        input.projectId ?? null,
        input.featureId ?? null,
        input.taskId ?? null,
        input.runId ?? null,
        input.evidencePackId ?? null,
        input.projectMemoryId ?? null,
        input.recoveryState,
        input.reason,
      ],
    },
  ]);
  return id;
}

export function listRecoverableWork(dbPath: string): RecoveryEntryInput[] {
  const rows = runSqlite(dbPath, [], [
    {
      name: "recoverable",
      sql: `SELECT * FROM recovery_index_entries
        WHERE recovery_state IN ('incomplete', 'failed', 'needs_replay')
        ORDER BY updated_at, id`,
    },
  ]).queries.recoverable;

  return rows.map((row) => ({
    projectId: nullableString(row.project_id),
    featureId: nullableString(row.feature_id),
    taskId: nullableString(row.task_id),
    runId: nullableString(row.run_id),
    evidencePackId: nullableString(row.evidence_pack_id),
    projectMemoryId: nullableString(row.project_memory_id),
    recoveryState: String(row.recovery_state),
    reason: String(row.reason),
  }));
}

export function sanitizeForOrdinaryLog(value: string): string {
  return ORDINARY_LOG_SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, "$1[REDACTED]"), value);
}

function sanitizePayload(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === "string" ? sanitizeForOrdinaryLog(entry) : entry,
    ]),
  );
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requiredRow(rows: Record<string, unknown>[], label: string): Record<string, unknown> {
  const row = rows[0];
  if (!row) {
    throw new Error(`Missing persisted ${label}`);
  }
  return row;
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    return asJsonObject(JSON.parse(value));
  } catch {
    return {};
  }
}

function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
