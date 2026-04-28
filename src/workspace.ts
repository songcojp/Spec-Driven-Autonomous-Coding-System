import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { runSqlite } from "./sqlite.ts";
import type { SqlStatement } from "./sqlite.ts";

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (command: string, args: string[], cwd: string) => CommandResult;

export type CleanupStatus = "active" | "delivered" | "rolled_back" | "cleanup_ready" | "cleaned" | "cleanup_blocked";
export type ConflictSeverity = "none" | "medium" | "high";
export type ConflictReason =
  | "same_file"
  | "high_conflict_directory"
  | "schema"
  | "lock_file"
  | "shared_config"
  | "shared_runtime_resource";

export type WorktreeRecord = {
  id: string;
  projectId?: string;
  featureId: string;
  taskId?: string;
  runnerId: string;
  path: string;
  branch: string;
  baseCommit: string;
  targetBranch: string;
  cleanupStatus: CleanupStatus;
  createdAt: string;
};

export type WorkspaceScope = {
  featureId: string;
  taskId?: string;
  files: string[];
  dependencies?: string[];
  sharedResources?: string[];
};

export type ConflictCheckResult = {
  id: string;
  severity: ConflictSeverity;
  parallelAllowed: boolean;
  reasons: ConflictReason[];
  conflictingFiles: string[];
  conflictingResources: string[];
  serialRequired: boolean;
  evidence: string;
  createdAt: string;
};

export type StatusCheckResult = {
  name: "conflict" | "spec_alignment" | "test";
  passed: boolean;
  evidence: string;
};

export type MergeReadinessResult = {
  id: string;
  worktreeId: string;
  ready: boolean;
  blockedReasons: string[];
  checks: StatusCheckResult[];
  createdAt: string;
};

export type RollbackBoundary = {
  id: string;
  worktreeId: string;
  featureId: string;
  taskId?: string;
  branch: string;
  baseCommit: string;
  diffSummary: string;
  rollbackCommand: string;
  createdAt: string;
};

export type CleanupDecision = {
  allowed: boolean;
  nextStatus: CleanupStatus;
  reason: string;
};

export type CreateWorktreeInput = {
  repositoryPath: string;
  worktreePath: string;
  featureId: string;
  taskId?: string;
  runnerId: string;
  targetBranch?: string;
  branch?: string;
  projectId?: string;
  now?: Date;
};

export type ParallelFeatureInput = {
  candidate: WorkspaceScope;
  activeScopes: WorkspaceScope[];
  completedFeatureIds: string[];
};

const HIGH_CONFLICT_DIRS = ["src/schema", "migrations", "database", "db", "prisma"];
const LOCK_FILE_PATTERNS = [/package-lock\.json$/, /pnpm-lock\.yaml$/, /yarn\.lock$/, /bun\.lockb$/, /Cargo\.lock$/, /poetry\.lock$/];
const SCHEMA_PATTERNS = [/schema\.(ts|sql|prisma)$/i, /migration/i, /migrations\//i, /database\//i, /db\//i];
const SHARED_CONFIG_PATTERNS = [
  /(^|\/)package\.json$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)vite\.config\./,
  /(^|\/)next\.config\./,
  /(^|\/)eslint\.config\./,
  /(^|\/)\.env/,
  /(^|\/)AGENTS\.md$/,
];

export function createWorktree(input: CreateWorktreeInput, runner: CommandRunner = runCommand): WorktreeRecord {
  const targetBranch = input.targetBranch ?? readDefaultBranch(input.repositoryPath, runner);
  const baseCommit = readBaseCommit(input.repositoryPath, targetBranch, runner);
  const branch = input.branch ?? buildWorkspaceBranch(input.featureId, input.taskId);

  ensureGitSuccess(
    runner("git", ["worktree", "add", "-b", branch, input.worktreePath, baseCommit], input.repositoryPath),
    `create worktree ${input.worktreePath}`,
  );

  return buildWorktreeRecord({
    ...input,
    branch,
    targetBranch,
    baseCommit,
  });
}

export function buildWorktreeRecord(
  input: Omit<CreateWorktreeInput, "repositoryPath" | "worktreePath"> & {
    worktreePath: string;
    branch: string;
    targetBranch: string;
    baseCommit: string;
  },
): WorktreeRecord {
  return {
    id: randomUUID(),
    projectId: input.projectId,
    featureId: input.featureId,
    taskId: input.taskId,
    runnerId: input.runnerId,
    path: input.worktreePath,
    branch: input.branch,
    baseCommit: input.baseCommit,
    targetBranch: input.targetBranch,
    cleanupStatus: "active",
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export function classifyWorkspaceConflicts(candidate: WorkspaceScope, activeScopes: WorkspaceScope[], now: Date = new Date()): ConflictCheckResult {
  const reasons = new Set<ConflictReason>();
  const conflictingFiles = new Set<string>();
  const conflictingResources = new Set<string>();
  const activeFiles = new Set(activeScopes.flatMap((scope) => scope.files.map(normalizePath)));
  const candidateFiles = candidate.files.map(normalizePath);
  const activeResources = new Set(activeScopes.flatMap((scope) => scope.sharedResources ?? []));

  for (const file of candidateFiles) {
    if (activeFiles.has(file)) {
      reasons.add("same_file");
      conflictingFiles.add(file);
    }
    for (const reason of classifySerialFile(file)) {
      reasons.add(reason);
      conflictingFiles.add(file);
    }
  }

  for (const resource of candidate.sharedResources ?? []) {
    if (activeResources.has(resource) || isSharedRuntimeResource(resource)) {
      reasons.add("shared_runtime_resource");
      conflictingResources.add(resource);
    }
  }

  const reasonList = [...reasons];
  const severity: ConflictSeverity = reasonList.length === 0 ? "none" : reasonList.includes("same_file") ? "high" : "medium";

  return {
    id: randomUUID(),
    severity,
    parallelAllowed: reasonList.length === 0,
    reasons: reasonList,
    conflictingFiles: [...conflictingFiles].sort(),
    conflictingResources: [...conflictingResources].sort(),
    serialRequired: reasonList.length > 0,
    evidence:
      reasonList.length === 0
        ? "No serial-only files, shared runtime resources, or active file overlaps were detected."
        : `Serial execution required: ${reasonList.join(", ")}.`,
    createdAt: now.toISOString(),
  };
}

export function evaluateParallelFeature(input: ParallelFeatureInput): ConflictCheckResult {
  const incompleteDependencies = input.candidate.dependencies?.filter(
    (dependency) => !input.completedFeatureIds.includes(dependency),
  ) ?? [];
  const result = classifyWorkspaceConflicts(input.candidate, input.activeScopes);

  if (incompleteDependencies.length === 0) {
    return result;
  }

  return {
    ...result,
    severity: "high",
    parallelAllowed: false,
    serialRequired: true,
    evidence: `Serial execution required: incomplete dependencies ${incompleteDependencies.join(", ")}.`,
  };
}

export function checkMergeReadiness(input: {
  worktreeId: string;
  conflictCheck: ConflictCheckResult;
  specAlignmentPassed: boolean;
  requiredTests: StatusCheckResult[];
  now?: Date;
}): MergeReadinessResult {
  const checks: StatusCheckResult[] = [
    {
      name: "conflict",
      passed: input.conflictCheck.parallelAllowed || input.conflictCheck.severity === "none",
      evidence: input.conflictCheck.evidence,
    },
    {
      name: "spec_alignment",
      passed: input.specAlignmentPassed,
      evidence: input.specAlignmentPassed ? "Spec Alignment Check passed." : "Spec Alignment Check failed or is missing.",
    },
    ...input.requiredTests.map((check) => ({ ...check, name: "test" as const })),
  ];
  const blockedReasons = checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.evidence}`);

  return {
    id: randomUUID(),
    worktreeId: input.worktreeId,
    ready: blockedReasons.length === 0,
    blockedReasons,
    checks,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export function createRollbackBoundary(input: {
  worktree: Pick<WorktreeRecord, "id" | "featureId" | "taskId" | "branch" | "baseCommit">;
  diffSummary: string;
  now?: Date;
}): RollbackBoundary {
  return {
    id: randomUUID(),
    worktreeId: input.worktree.id,
    featureId: input.worktree.featureId,
    taskId: input.worktree.taskId,
    branch: input.worktree.branch,
    baseCommit: input.worktree.baseCommit,
    diffSummary: input.diffSummary,
    rollbackCommand: `git switch ${input.worktree.branch} && git reset --hard ${input.worktree.baseCommit}`,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export function decideCleanup(record: WorktreeRecord, repositoryStatus: { delivered: boolean; hasUncommittedChanges: boolean }): CleanupDecision {
  if (record.cleanupStatus === "cleaned") {
    return { allowed: false, nextStatus: "cleaned", reason: "Worktree is already cleaned." };
  }
  if (!repositoryStatus.delivered && record.cleanupStatus !== "rolled_back") {
    return { allowed: false, nextStatus: "cleanup_blocked", reason: "Worktree is not delivered or rolled back." };
  }
  if (repositoryStatus.hasUncommittedChanges) {
    return { allowed: false, nextStatus: "cleanup_blocked", reason: "Worktree has uncommitted changes." };
  }
  return { allowed: true, nextStatus: "cleanup_ready", reason: "Worktree is safe to clean." };
}

export function persistWorktreeRecord(dbPath: string, record: WorktreeRecord): WorktreeRecord {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO worktree_records (
        id, project_id, feature_id, task_id, runner_id, path, branch, status,
        base_commit, target_branch, cleanup_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        cleanup_status = excluded.cleanup_status`,
      params: [
        record.id,
        record.projectId ?? null,
        record.featureId,
        record.taskId ?? null,
        record.runnerId,
        record.path,
        record.branch,
        record.cleanupStatus,
        record.baseCommit,
        record.targetBranch,
        record.cleanupStatus,
        record.createdAt,
      ],
    },
  ]);
  return record;
}

export function persistWorkspaceEvidence(
  dbPath: string,
  input: {
    conflict?: ConflictCheckResult;
    mergeReadiness?: MergeReadinessResult;
    rollback?: RollbackBoundary;
  },
): void {
  const statements: SqlStatement[] = [];
  if (input.conflict) {
    statements.push({
      sql: `INSERT INTO conflict_check_results (
        id, severity, parallel_allowed, reasons_json, conflicting_files_json,
        conflicting_resources_json, serial_required, evidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.conflict.id,
        input.conflict.severity,
        input.conflict.parallelAllowed ? 1 : 0,
        JSON.stringify(input.conflict.reasons),
        JSON.stringify(input.conflict.conflictingFiles),
        JSON.stringify(input.conflict.conflictingResources),
        input.conflict.serialRequired ? 1 : 0,
        input.conflict.evidence,
        input.conflict.createdAt,
      ],
    });
  }
  if (input.mergeReadiness) {
    statements.push({
      sql: `INSERT INTO merge_readiness_results (
        id, worktree_id, ready, blocked_reasons_json, checks_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        input.mergeReadiness.id,
        input.mergeReadiness.worktreeId,
        input.mergeReadiness.ready ? 1 : 0,
        JSON.stringify(input.mergeReadiness.blockedReasons),
        JSON.stringify(input.mergeReadiness.checks),
        input.mergeReadiness.createdAt,
      ],
    });
  }
  if (input.rollback) {
    statements.push({
      sql: `INSERT INTO rollback_boundaries (
        id, worktree_id, feature_id, task_id, branch, base_commit, diff_summary,
        rollback_command, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.rollback.id,
        input.rollback.worktreeId,
        input.rollback.featureId,
        input.rollback.taskId ?? null,
        input.rollback.branch,
        input.rollback.baseCommit,
        input.rollback.diffSummary,
        input.rollback.rollbackCommand,
        input.rollback.createdAt,
      ],
    });
  }
  runSqlite(dbPath, statements);
}

function buildWorkspaceBranch(featureId: string, taskId?: string): string {
  return `work/${featureId.toLowerCase()}${taskId ? `-${taskId.toLowerCase()}` : ""}`;
}

function readDefaultBranch(repositoryPath: string, runner: CommandRunner): string {
  const originHead = runner("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repositoryPath);
  const branch = originHead.stdout.trim().replace(/^origin\//, "");
  return branch || "main";
}

function readBaseCommit(repositoryPath: string, targetBranch: string, runner: CommandRunner): string {
  const result = runner("git", ["rev-parse", `origin/${targetBranch}`], repositoryPath);
  ensureGitSuccess(result, `read origin/${targetBranch}`);
  return result.stdout.trim();
}

function runCommand(command: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function ensureGitSuccess(result: CommandResult, action: string): void {
  if (result.status !== 0) {
    throw new Error(`${action} failed: ${result.stderr || result.stdout}`);
  }
}

function classifySerialFile(file: string): ConflictReason[] {
  const reasons: ConflictReason[] = [];
  if (LOCK_FILE_PATTERNS.some((pattern) => pattern.test(file))) reasons.push("lock_file");
  if (SCHEMA_PATTERNS.some((pattern) => pattern.test(file)) || HIGH_CONFLICT_DIRS.some((dir) => file.startsWith(`${dir}/`))) {
    reasons.push("schema");
  }
  if (SHARED_CONFIG_PATTERNS.some((pattern) => pattern.test(file)) || basename(file) === "config.ts") {
    reasons.push("shared_config");
  }
  if (basename(file) === "schema.ts" || basename(file) === "schema.sql") reasons.push("schema");
  return [...new Set(reasons)];
}

function isSharedRuntimeResource(resource: string): boolean {
  return ["database", "cache", "external-api", "port", "container", "shared-runtime"].includes(resource);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
