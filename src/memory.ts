import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { applyIdempotentOperation, listAuditEvents, listRecoverableWork, recordAuditEvent, sanitizeForOrdinaryLog } from "./persistence.ts";
import { runSqlite } from "./sqlite.ts";
import type { StateTransition } from "./orchestration.ts";
import type { RepositorySummary } from "./repository.ts";

export type ProjectMemory = {
  id: string;
  projectId: string;
  path: string;
  projectName: string;
  goal: string;
  defaultBranch: string;
  specVersion: string;
  currentTask?: string;
  boardSnapshot: Record<string, string>;
  lastRun?: RunMemorySummary;
  blockers: string[];
  prohibitedOperations: string[];
  pendingApprovals: string[];
  decisions: string[];
  failurePatterns: string[];
  evidenceSummaries: string[];
  completedTasks: string[];
  currentVersion: number;
  updatedAt: string;
};

export type RunMemorySummary = {
  runId: string;
  status: string;
  taskId?: string;
  featureId?: string;
  evidence?: string;
};

export type MemoryVersionRecord = {
  id: string;
  projectMemoryId: string;
  version: number;
  runId?: string;
  summary: string;
  checksum: string;
  content: string;
  restoredFromVersion?: number;
  createdAt: string;
};

export type MemoryCompactionEvent = {
  id: string;
  projectMemoryId: string;
  fromVersion: number;
  toVersion: number;
  runId?: string;
  tokenBudget: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  preservedSections: string[];
  createdAt: string;
};

export type InitializeProjectMemoryInput = {
  dbPath: string;
  artifactRoot: string;
  projectId: string;
  projectName: string;
  goal: string;
  defaultBranch: string;
  specVersion?: string;
  initialTasks?: Array<{ id: string; status: string }>;
  runId?: string;
  now?: Date;
};

export type UpdateProjectMemoryInput = {
  dbPath: string;
  artifactRoot: string;
  memory: ProjectMemory;
  run: RunMemorySummary;
  boardSnapshot?: Record<string, string>;
  blockers?: string[];
  prohibitedOperations?: string[];
  pendingApprovals?: string[];
  decisions?: string[];
  failurePatterns?: string[];
  evidenceSummaries?: string[];
  completedTasks?: string[];
  statusChecks?: Array<{ name: string; status: string; summary?: string }>;
  transitions?: StateTransition[];
  tokenBudget?: number;
  now?: Date;
};

export type RecoveryBootstrapInput = {
  dbPath: string;
  memory: ProjectMemory;
  repositorySummary?: RepositorySummary;
  filesystemChecks?: Array<{ label: string; path: string; exists: boolean }>;
  codexSessions?: Array<{ id: string; status: string; lastSeenAt: string }>;
  runnerHeartbeats?: Array<{ runnerId: string; status: string; heartbeatAt: string }>;
  recentEvidence?: string[];
};

export type RecoveryBootstrapResult = {
  projectId: string;
  status: "resumable" | "blocked";
  resumableRuns: string[];
  runningTasks: string[];
  scheduledTasks: string[];
  corrections: string[];
  evidence: string[];
  memoryInjection: string;
};

const DEFAULT_SPEC_VERSION = "v0.1";
const DEFAULT_TOKEN_BUDGET = 8000;
const MEMORY_FILE = "project.md";
const PRESERVED_COMPACTION_SECTIONS = [
  "currentTask",
  "boardSnapshot",
  "blockers",
  "prohibitedOperations",
  "pendingApprovals",
  "lastRun",
];

export function initializeProjectMemory(input: InitializeProjectMemoryInput): ProjectMemory {
  const path = join(input.artifactRoot, "memory", MEMORY_FILE);
  if (existsSync(path)) {
    const existing = readProjectMemory(input.artifactRoot);
    persistProjectMemory(input.dbPath, existing);
    return existing;
  }

  const latest = latestMemoryVersionRecord(input.dbPath, stableMemoryId(input.projectId));
  if (latest?.content) {
    const restored = parseMemoryContent(latest.content);
    persistProjectMemory(input.dbPath, restored);
    writeMemoryFile(input.artifactRoot, restored);
    return restored;
  }

  const now = (input.now ?? new Date()).toISOString();
  const memory: ProjectMemory = {
    id: stableMemoryId(input.projectId),
    projectId: input.projectId,
    path: relative(input.artifactRoot, path),
    projectName: input.projectName,
    goal: input.goal,
    defaultBranch: input.defaultBranch,
    specVersion: input.specVersion ?? DEFAULT_SPEC_VERSION,
    boardSnapshot: Object.fromEntries((input.initialTasks ?? []).map((task) => [task.id, task.status])),
    blockers: [],
    prohibitedOperations: [],
    pendingApprovals: [],
    decisions: [],
    failurePatterns: [],
    evidenceSummaries: [],
    completedTasks: [],
    currentVersion: 1,
    updatedAt: now,
  };

  writeMemoryFile(input.artifactRoot, memory);
  persistProjectMemory(input.dbPath, memory);
  recordMemoryVersion(input.dbPath, memory, {
    runId: input.runId,
    summary: "Initialized project memory.",
  });
  recordAuditEvent(input.dbPath, {
    entityType: "project_memory",
    entityId: memory.id,
    eventType: "memory_initialized",
    source: "project-memory",
    reason: "Project memory file initialized for recovery projection",
    payload: { projectId: input.projectId, path: memory.path },
  });

  return memory;
}

export function readProjectMemory(artifactRoot: string, path = join("memory", MEMORY_FILE)): ProjectMemory {
  const content = readFileSync(join(artifactRoot, path), "utf8");
  return parseMemoryContent(content);
}

export function buildProjectMemoryInjection(memory: ProjectMemory): string {
  return [
    "[PROJECT MEMORY]",
    `Project: ${memory.projectName}`,
    `Goal: ${memory.goal}`,
    `Default Branch: ${memory.defaultBranch}`,
    `Spec Version: ${memory.specVersion}`,
    `Current Task: ${memory.currentTask ?? "none"}`,
    `Board Snapshot: ${formatRecord(memory.boardSnapshot)}`,
    `Last Run: ${memory.lastRun ? `${memory.lastRun.runId} ${memory.lastRun.status}` : "none"}`,
    `Blockers: ${formatList(memory.blockers)}`,
    `Prohibited Operations: ${formatList(memory.prohibitedOperations)}`,
    `Pending Approvals: ${formatList(memory.pendingApprovals)}`,
    `Recent Decisions: ${formatList(memory.decisions.slice(-5))}`,
    `Failure Patterns: ${formatList(memory.failurePatterns.slice(-5))}`,
    "[/PROJECT MEMORY]",
  ].join("\n");
}

export function updateProjectMemory(input: UpdateProjectMemoryInput): ProjectMemory {
  const key = `memory:${input.memory.projectId}:${input.run.runId}:${input.run.status}`;
  const idempotent = applyIdempotentOperation(input.dbPath, {
    key,
    scope: "memory",
    operation: "update",
    entityType: "project_memory",
    entityId: input.memory.id,
    payload: {
      run: input.run,
      boardSnapshot: input.boardSnapshot,
      blockers: input.blockers,
      transitions: input.transitions?.map((transition) => transition.id),
    },
    result: { version: input.memory.currentVersion + 1 },
  });

  if (idempotent.replayed) {
    return input.memory;
  }

  const now = (input.now ?? new Date()).toISOString();
  const sanitizedRun = sanitizeRunSummary(input.run);
  const memory: ProjectMemory = {
    ...input.memory,
    lastRun: sanitizedRun,
    currentTask: sanitizedRun.taskId ?? input.memory.currentTask,
    boardSnapshot: { ...input.memory.boardSnapshot, ...(input.boardSnapshot ?? {}) },
    blockers: mergeUnique(input.memory.blockers, input.blockers ?? []),
    prohibitedOperations: mergeUnique(input.memory.prohibitedOperations, input.prohibitedOperations ?? []),
    pendingApprovals: mergeUnique(input.memory.pendingApprovals, input.pendingApprovals ?? []),
    decisions: mergeUnique(input.memory.decisions, input.decisions ?? []),
    failurePatterns: mergeUnique(input.memory.failurePatterns, [
      ...(input.failurePatterns ?? []),
      ...(sanitizedRun.status === "failed" ? [`${sanitizedRun.runId} failed`] : []),
    ]),
    evidenceSummaries: mergeUnique(input.memory.evidenceSummaries, [
      ...(input.evidenceSummaries ?? []),
      ...(sanitizedRun.evidence ? [sanitizedRun.evidence] : []),
      ...(input.statusChecks ?? []).map((check) => `${check.name}:${check.status}${check.summary ? ` ${check.summary}` : ""}`),
      ...(input.transitions ?? []).map((transition) => `${transition.entityType}:${transition.entityId} ${transition.from}->${transition.to}`),
    ]),
    completedTasks: mergeUnique(input.memory.completedTasks, input.completedTasks ?? []),
    currentVersion: input.memory.currentVersion + 1,
    updatedAt: now,
  };

  persistProjectMemory(input.dbPath, memory);
  writeMemoryFile(input.artifactRoot, memory);
  recordMemoryVersion(input.dbPath, memory, {
    runId: sanitizedRun.runId,
    summary: `Updated memory from run ${sanitizedRun.runId}.`,
  });
  recordAuditEvent(input.dbPath, {
    entityType: "project_memory",
    entityId: memory.id,
    eventType: "memory_updated",
    source: "project-memory",
    reason: "Run evidence, status checks, and state transitions updated memory projection",
    payload: { runId: sanitizedRun.runId, version: memory.currentVersion },
  });

  return compactProjectMemoryIfNeeded(input.dbPath, input.artifactRoot, memory, input.tokenBudget ?? DEFAULT_TOKEN_BUDGET, sanitizedRun.runId);
}

export function compactProjectMemoryIfNeeded(
  dbPath: string,
  artifactRoot: string,
  memory: ProjectMemory,
  tokenBudget = DEFAULT_TOKEN_BUDGET,
  runId?: string,
): ProjectMemory {
  const before = estimateTokens(renderMemoryContent(memory));
  if (before <= tokenBudget) {
    return memory;
  }

  const compacted: ProjectMemory = {
    ...memory,
    evidenceSummaries: compactList(memory.evidenceSummaries, "older evidence summaries compacted"),
    decisions: compactList(memory.decisions, "older decisions compacted"),
    completedTasks: compactList(memory.completedTasks, "completed tasks compacted"),
    currentVersion: memory.currentVersion + 1,
    updatedAt: new Date().toISOString(),
  };
  const after = estimateTokens(renderMemoryContent(compacted));

  persistProjectMemory(dbPath, compacted);
  writeMemoryFile(artifactRoot, compacted);
  recordMemoryVersion(dbPath, compacted, {
    runId,
    summary: "Compacted project memory to stay within token budget.",
  });
  recordCompactionEvent(dbPath, {
    memory: compacted,
    fromVersion: memory.currentVersion,
    runId,
    tokenBudget,
    estimatedTokensBefore: before,
    estimatedTokensAfter: after,
  });
  recordAuditEvent(dbPath, {
    entityType: "project_memory",
    entityId: compacted.id,
    eventType: "memory_compacted",
    source: "project-memory",
    reason: "Memory exceeded token budget and preserved active recovery fields",
    payload: {
      runId,
      tokenBudget,
      estimatedTokensBefore: before,
      estimatedTokensAfter: after,
      preservedSections: PRESERVED_COMPACTION_SECTIONS,
    },
  });

  return compacted;
}

export function listMemoryVersions(dbPath: string, projectMemoryId: string): MemoryVersionRecord[] {
  const rows = runSqlite(dbPath, [], [
    {
      name: "versions",
      sql: `SELECT * FROM memory_version_records
        WHERE project_memory_id = ?
        ORDER BY version, created_at, id`,
      params: [projectMemoryId],
    },
  ]).queries.versions;

  return rows.map(mapMemoryVersionRecord);
}

export function rollbackProjectMemoryVersion(
  dbPath: string,
  artifactRoot: string,
  projectMemoryId: string,
  version: number,
): ProjectMemory {
  const record = listMemoryVersions(dbPath, projectMemoryId).find((entry) => entry.version === version);
  if (!record) {
    throw new Error(`Memory version not found: ${projectMemoryId}@${version}`);
  }

  const restored = {
    ...parseMemoryContent(record.content),
    currentVersion: latestVersion(dbPath, projectMemoryId) + 1,
    updatedAt: new Date().toISOString(),
  };
  persistProjectMemory(dbPath, restored);
  writeMemoryFile(artifactRoot, restored);
  recordMemoryVersion(dbPath, restored, {
    summary: `Rolled back memory projection to version ${version}.`,
    restoredFromVersion: version,
  });
  recordAuditEvent(dbPath, {
    entityType: "project_memory",
    entityId: projectMemoryId,
    eventType: "memory_rolled_back",
    source: "project-memory",
    reason: "Rollback restored a prior memory projection without changing scheduling facts",
    payload: { restoredFromVersion: version, currentVersion: restored.currentVersion },
  });
  return restored;
}

export function runRecoveryBootstrap(input: RecoveryBootstrapInput): RecoveryBootstrapResult {
  const recoverable = listRecoverableWork(input.dbPath).filter((entry) => entry.projectId === input.memory.projectId);
  const runningTasks = queryTaskIds(input.dbPath, input.memory.projectId, ["running"]);
  const scheduledTasks = queryTaskIds(input.dbPath, input.memory.projectId, ["scheduled"]);
  const resumableRuns = recoverable.map((entry) => entry.runId).filter((entry): entry is string => Boolean(entry));
  const corrections = detectMemoryCorrections(input.memory, {
    runningTasks,
    scheduledTasks,
    repositorySummary: input.repositorySummary,
    filesystemChecks: input.filesystemChecks ?? [],
  });

  for (const correction of corrections) {
    recordAuditEvent(input.dbPath, {
      entityType: "project_memory",
      entityId: input.memory.id,
      eventType: "memory_conflict_corrected",
      source: "recovery-bootstrap",
      reason: correction,
      payload: { projectId: input.memory.projectId },
    });
  }

  const blockedReasons = [
    ...corrections.filter((entry) => entry.startsWith("blocked:")),
    ...(input.runnerHeartbeats ?? []).filter((entry) => entry.status !== "alive").map((entry) => `blocked:runner:${entry.runnerId}:${entry.status}`),
  ];
  const evidence = [
    ...recoverable.map((entry) => entry.reason),
    ...(input.recentEvidence ?? []),
    ...(input.codexSessions ?? []).map((session) => `codex-session:${session.id}:${session.status}:${session.lastSeenAt}`),
  ];

  return {
    projectId: input.memory.projectId,
    status: blockedReasons.length > 0 ? "blocked" : "resumable",
    resumableRuns,
    runningTasks,
    scheduledTasks,
    corrections,
    evidence,
    memoryInjection: buildProjectMemoryInjection(input.memory),
  };
}

export function listMemoryCompactionEvents(dbPath: string, projectMemoryId: string): MemoryCompactionEvent[] {
  const rows = runSqlite(dbPath, [], [
    {
      name: "events",
      sql: `SELECT * FROM memory_compaction_events
        WHERE project_memory_id = ?
        ORDER BY created_at, id`,
      params: [projectMemoryId],
    },
  ]).queries.events;

  return rows.map((row) => ({
    id: String(row.id),
    projectMemoryId: String(row.project_memory_id),
    fromVersion: Number(row.from_version),
    toVersion: Number(row.to_version),
    runId: nullableString(row.run_id),
    tokenBudget: Number(row.token_budget),
    estimatedTokensBefore: Number(row.estimated_tokens_before),
    estimatedTokensAfter: Number(row.estimated_tokens_after),
    preservedSections: parseJsonArray(row.preserved_sections_json),
    createdAt: String(row.created_at),
  }));
}

export function memoryAuditEvents(dbPath: string, projectMemoryId: string) {
  return listAuditEvents(dbPath, "project_memory", projectMemoryId);
}

function persistProjectMemory(dbPath: string, memory: ProjectMemory): void {
  runSqlite(dbPath, [
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
        memory.id,
        memory.projectId,
        memory.path,
        sanitizeForOrdinaryLog(buildProjectMemoryInjection(memory)),
        memory.currentVersion,
        memory.updatedAt,
      ],
    },
  ]);
}

function recordMemoryVersion(
  dbPath: string,
  memory: ProjectMemory,
  options: { runId?: string; summary: string; restoredFromVersion?: number },
): void {
  const content = renderMemoryContent(memory);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO memory_version_records (
        id, project_memory_id, version, run_id, summary, checksum, content, restored_from_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        randomUUID(),
        memory.id,
        memory.currentVersion,
        options.runId ?? null,
        options.summary,
        checksum(content),
        content,
        options.restoredFromVersion ?? null,
        memory.updatedAt,
      ],
    },
  ]);
}

function recordCompactionEvent(
  dbPath: string,
  input: {
    memory: ProjectMemory;
    fromVersion: number;
    runId?: string;
    tokenBudget: number;
    estimatedTokensBefore: number;
    estimatedTokensAfter: number;
  },
): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO memory_compaction_events (
        id, project_memory_id, from_version, to_version, run_id, token_budget,
        estimated_tokens_before, estimated_tokens_after, preserved_sections_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        randomUUID(),
        input.memory.id,
        input.fromVersion,
        input.memory.currentVersion,
        input.runId ?? null,
        input.tokenBudget,
        input.estimatedTokensBefore,
        input.estimatedTokensAfter,
        JSON.stringify(PRESERVED_COMPACTION_SECTIONS),
      ],
    },
  ]);
}

function writeMemoryFile(artifactRoot: string, memory: ProjectMemory): void {
  const path = join(artifactRoot, memory.path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, renderMemoryContent(memory), "utf8");
}

function renderMemoryContent(memory: ProjectMemory): string {
  return [
    "---",
    JSON.stringify(memory),
    "---",
    "",
    `# Project Memory: ${memory.projectName}`,
    "",
    `Goal: ${memory.goal}`,
    `Default Branch: ${memory.defaultBranch}`,
    `Spec Version: ${memory.specVersion}`,
    `Current Version: ${memory.currentVersion}`,
    `Updated At: ${memory.updatedAt}`,
    "",
    "## Recovery Snapshot",
    "",
    `Current Task: ${memory.currentTask ?? "none"}`,
    `Board Snapshot: ${formatRecord(memory.boardSnapshot)}`,
    `Last Run: ${memory.lastRun ? `${memory.lastRun.runId} ${memory.lastRun.status}` : "none"}`,
    `Blockers: ${formatList(memory.blockers)}`,
    `Prohibited Operations: ${formatList(memory.prohibitedOperations)}`,
    `Pending Approvals: ${formatList(memory.pendingApprovals)}`,
    "",
    "## History",
    "",
    `Decisions: ${formatList(memory.decisions)}`,
    `Failure Patterns: ${formatList(memory.failurePatterns)}`,
    `Evidence: ${formatList(memory.evidenceSummaries)}`,
    `Completed Tasks: ${formatList(memory.completedTasks)}`,
  ].join("\n");
}

function parseMemoryContent(content: string): ProjectMemory {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error("Project memory file is missing metadata frontmatter");
  }
  return JSON.parse(match[1]) as ProjectMemory;
}

function queryTaskIds(dbPath: string, projectId: string, statuses: string[]): string[] {
  if (statuses.length === 0) {
    return [];
  }
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = runSqlite(dbPath, [], [
    {
      name: "tasks",
      sql: `SELECT t.id
        FROM tasks t
        JOIN features f ON f.id = t.feature_id
        WHERE f.project_id = ? AND t.status IN (${placeholders})
        ORDER BY t.updated_at, t.id`,
      params: [projectId, ...statuses],
    },
  ]).queries.tasks;
  return rows.map((row) => String(row.id));
}

function detectMemoryCorrections(
  memory: ProjectMemory,
  facts: {
    runningTasks: string[];
    scheduledTasks: string[];
    repositorySummary?: RepositorySummary;
    filesystemChecks: Array<{ label: string; path: string; exists: boolean }>;
  },
): string[] {
  const corrections: string[] = [];
  const taskFacts = new Set([...facts.runningTasks, ...facts.scheduledTasks]);
  if (memory.currentTask && taskFacts.size > 0 && !taskFacts.has(memory.currentTask)) {
    corrections.push(`memory_current_task_stale:${memory.currentTask}`);
  }
  if (facts.repositorySummary?.errors.length) {
    corrections.push(`blocked:repository:${facts.repositorySummary.errors.join(",")}`);
  }
  for (const check of facts.filesystemChecks) {
    if (!check.exists || !existsSync(check.path)) {
      corrections.push(`blocked:filesystem:${check.label}`);
    }
  }
  return corrections;
}

function latestVersion(dbPath: string, projectMemoryId: string): number {
  const row = runSqlite(dbPath, [], [
    {
      name: "latest",
      sql: "SELECT MAX(version) AS version FROM memory_version_records WHERE project_memory_id = ?",
      params: [projectMemoryId],
    },
  ]).queries.latest[0];
  return Number(row?.version ?? 0);
}

function latestMemoryVersionRecord(dbPath: string, projectMemoryId: string): MemoryVersionRecord | undefined {
  const versions = listMemoryVersions(dbPath, projectMemoryId);
  return versions[versions.length - 1];
}

function mapMemoryVersionRecord(row: Record<string, unknown>): MemoryVersionRecord {
  return {
    id: String(row.id),
    projectMemoryId: String(row.project_memory_id),
    version: Number(row.version),
    runId: nullableString(row.run_id),
    summary: String(row.summary ?? ""),
    checksum: String(row.checksum ?? ""),
    content: String(row.content ?? ""),
    restoredFromVersion: row.restored_from_version === null ? undefined : Number(row.restored_from_version),
    createdAt: String(row.created_at),
  };
}

function stableMemoryId(projectId: string): string {
  return `memory-${checksum(projectId).slice(0, 16)}`;
}

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function compactList(entries: string[], summary: string): string[] {
  if (entries.length <= 4) {
    return entries;
  }
  return [`${entries.length - 3} ${summary}`, ...entries.slice(-3)];
}

function formatList(values: string[]): string {
  return values.length ? values.join("; ") : "none";
}

function formatRecord(values: Record<string, string>): string {
  const entries = Object.entries(values);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none";
}

function mergeUnique(current: string[], incoming: string[]): string[] {
  return [...new Set([...current, ...incoming].map((entry) => sanitizeForOrdinaryLog(entry)).filter(Boolean))];
}

function sanitizeRunSummary(run: RunMemorySummary): RunMemorySummary {
  return {
    ...run,
    evidence: run.evidence ? sanitizeForOrdinaryLog(run.evidence) : undefined,
  };
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

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
