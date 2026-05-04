import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureArtifactDirectories } from "./artifacts.ts";
import { initializeProjectMemory } from "./memory.ts";
import { recordAuditEvent } from "./persistence.ts";
import { runSqlite } from "./sqlite.ts";
import { readRepositorySummary, type CommandRunner, type RepositorySummary } from "./repository.ts";

// ── Error types ────────────────────────────────────────────────────────────────

export class ProjectNotFoundError extends Error {
  readonly projectId: string;
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
    this.projectId = projectId;
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type ProjectTrustLevel = "trusted" | "standard" | "restricted";

export type ProjectInput = {
  name: string;
  goal: string;
  projectType: string;
  techPreferences?: string[];
  targetRepoPath?: string;
  repositoryUrl?: string;
  defaultBranch?: string;
  trustLevel?: ProjectTrustLevel;
  environment: string;
  automationEnabled?: boolean;
  creationMode?: "import_existing" | "create_new";
  constitution?: ProjectConstitutionInput;
};

export type ProjectRecord = {
  id: string;
  name: string;
  goal: string;
  projectType: string;
  techPreferences: string[];
  targetRepoPath?: string;
  repositoryUrl?: string;
  defaultBranch: string;
  trustLevel: ProjectTrustLevel;
  environment: string;
  automationEnabled: boolean;
  status: string;
};

export type ProjectDeleteResult = {
  project: ProjectRecord;
  deleted: boolean;
};

export type ProjectConstitutionInput = {
  source?: "created" | "imported";
  title?: string;
  projectGoal: string;
  engineeringPrinciples: string[];
  boundaryRules: string[];
  approvalRules: string[];
  defaultConstraints: string[];
};

export type ProjectConstitutionRecord = ProjectConstitutionInput & {
  id: string;
  projectId: string;
  version: number;
  source: "created" | "imported";
  title: string;
  status: string;
  createdAt?: string;
};

export type ConstitutionRevalidationInput = {
  projectId: string;
  constitutionId: string;
  entityType: "feature" | "task" | "run";
  entityId: string;
  reason: string;
};

export type ConstitutionRevalidationMark = ConstitutionRevalidationInput & {
  id: string;
  status: string;
  createdAt?: string;
};

// TASK-013: Project summary with lifecycle status + recent activity
export type ProjectSummary = ProjectRecord & {
  lastActivityAt?: string;
  recentHealthStatus?: ProjectHealthStatus;
};

// TASK-014: Project selection context
export type ProjectSwitchSource = "manual" | "auto" | "session_restore";

export type ProjectSelectionContext = {
  projectId: string;
  switchSource: ProjectSwitchSource;
  switchedAt: string;
};

// TASK-016: Workspace directory input variant
export type ProjectWorkspaceRoot = {
  workspaceRoot?: string;
};

// TASK-017: Phase 1 auto-initialization result
export type Phase1InitResult = {
  project: ProjectRecord;
  repositoryConnected: boolean;
  constitutionCreated: boolean;
  memoryInitialized: boolean;
  healthStatus: ProjectHealthStatus;
  blockingReasons: string[];
  success: boolean;
};

export type RepositoryConnectionRecord = {
  id: string;
  projectId: string;
  provider: string;
  remoteUrl?: string;
  localPath: string;
  defaultBranch: string;
};

export type ProjectHealthStatus = "ready" | "blocked" | "failed";

export type ProjectHealthCheck = {
  id: string;
  projectId: string;
  status: ProjectHealthStatus;
  reasons: string[];
  repositorySummaryKind: "snapshot";
  repositorySummary: RepositorySummary;
};

export class DuplicateProjectPathError extends Error {
  readonly targetRepoPath: string;
  readonly existingProjectId: string;

  constructor(targetRepoPath: string, existingProjectId: string) {
    super(`Project path already registered: ${targetRepoPath}`);
    this.name = "DuplicateProjectPathError";
    this.targetRepoPath = targetRepoPath;
    this.existingProjectId = existingProjectId;
  }
}

export type ProjectDirectoryScan = {
  targetRepoPath: string;
  name: string;
  repository: string;
  defaultBranch: string;
  projectType: string;
  techPreferences: string[];
  isGitRepository: boolean;
  packageManager?: string;
  hasSpecProtocolDirectory: boolean;
  errors: string[];
};

export function createProject(dbPath: string, input: ProjectInput): ProjectRecord {
  const id = randomUUID();
  const defaultBranch = input.defaultBranch ?? "main";
  const targetRepoPath = input.targetRepoPath ? normalizeProjectPath(input.targetRepoPath) : undefined;
  const repositoryUrl = input.repositoryUrl;
  const techPreferences = input.techPreferences ?? [];
  const trustLevel = input.trustLevel ?? "standard";

  if (targetRepoPath) {
    const existingProject = findProjectByRepositoryPath(dbPath, targetRepoPath);
    if (existingProject) {
      throw new DuplicateProjectPathError(targetRepoPath, existingProject.id);
    }
  }

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO projects (
        id, name, goal, project_type, tech_preferences_json, target_repo_path,
        default_branch, trust_level, environment, automation_enabled, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        input.name,
        input.goal,
        input.projectType,
        JSON.stringify(techPreferences),
        targetRepoPath ?? null,
        defaultBranch,
        trustLevel,
        input.environment,
        input.automationEnabled ? 1 : 0,
        "created",
      ],
    },
  ]);

  if (targetRepoPath && input.creationMode === "create_new") {
    mkdirSync(targetRepoPath, { recursive: true });
  }

  if (targetRepoPath && existsSync(targetRepoPath)) {
    try {
      connectProjectRepository(dbPath, id, { repositoryUrl });
    } catch {
      const summary = readRepositorySummary(targetRepoPath);
      upsertRepositoryConnection(dbPath, {
        id: randomUUID(),
        projectId: id,
        provider: detectProvider(repositoryUrl ?? summary.remoteUrl),
        remoteUrl: repositoryUrl ?? summary.remoteUrl,
        localPath: targetRepoPath,
        defaultBranch: summary.defaultBranch ?? summary.currentBranch ?? defaultBranch,
      });
    }
    try {
      initializeProjectSpecProtocol(dbPath, id);
      initializeProjectMemoryForProject(dbPath, id);
    } catch {
      // Memory init is best-effort; project record is already persisted.
    }
  }

  saveProjectConstitution(dbPath, id, input.constitution ?? createDefaultProjectConstitution(input));

  return {
    id,
    name: input.name,
    goal: input.goal,
    projectType: input.projectType,
    techPreferences,
    targetRepoPath,
    repositoryUrl,
    defaultBranch,
    trustLevel,
    environment: input.environment,
    automationEnabled: Boolean(input.automationEnabled),
    status: "created",
  };
}

export function scanProjectDirectory(input: { targetRepoPath?: string }): ProjectDirectoryScan {
  const targetRepoPath = input.targetRepoPath ? normalizeProjectPath(input.targetRepoPath) : "";
  if (!targetRepoPath) {
    return {
      targetRepoPath,
      name: "Imported Project",
      repository: targetRepoPath,
      defaultBranch: "main",
      projectType: "imported-project",
      techPreferences: [],
      isGitRepository: false,
      hasSpecProtocolDirectory: false,
      errors: ["repository_path_missing"],
    };
  }

  let summary: RepositorySummary;
  try {
    summary = readRepositorySummary(targetRepoPath);
  } catch {
    return {
      targetRepoPath,
      name: basename(targetRepoPath) || "Imported Project",
      repository: targetRepoPath,
      defaultBranch: "main",
      projectType: "imported-project",
      techPreferences: [],
      isGitRepository: false,
      hasSpecProtocolDirectory: false,
      errors: ["scan_failed"],
    };
  }
  const repository = summary.remoteUrl ?? targetRepoPath;
  const name = inferProjectName(targetRepoPath, summary);
  const packageManager = summary.packageManager;
  const techPreferences = [
    packageManager,
    summary.hasSpecProtocolDirectory ? "specdrive" : undefined,
    summary.hasAgentsFile ? "agents" : undefined,
  ].filter((item): item is string => Boolean(item));

  return {
    targetRepoPath,
    name,
    repository,
    defaultBranch: summary.defaultBranch ?? summary.currentBranch ?? "main",
    projectType: summary.hasSpecProtocolDirectory ? "specdrive-project" : "imported-project",
    techPreferences,
    isGitRepository: summary.isGitRepository,
    packageManager,
    hasSpecProtocolDirectory: summary.hasSpecProtocolDirectory,
    errors: summary.errors,
  };
}

export function getProject(dbPath: string, id: string): ProjectRecord | undefined {
  const result = runSqlite(dbPath, [], [
    {
      name: "project",
      sql: `SELECT p.*, rc.remote_url
        FROM projects p
        LEFT JOIN repository_connections rc ON rc.project_id = p.id
        WHERE p.id = ?
        ORDER BY rc.connected_at DESC
        LIMIT 1`,
      params: [id],
    },
  ]);
  const row = result.queries.project[0];
  return row ? mapProject(row) : undefined;
}

export function deleteProject(dbPath: string, id: string): ProjectDeleteResult | undefined {
  const project = getProject(dbPath, id);
  if (!project) {
    return undefined;
  }

  recordAuditEvent(dbPath, {
    entityType: "project",
    entityId: id,
    eventType: "project_deleted",
    source: "project-service",
    reason: "Project removed from control plane",
    payload: {
      name: project.name,
      targetRepoPath: project.targetRepoPath,
      repositoryUrl: project.repositoryUrl,
    },
  });

  runSqlite(dbPath, projectDeletionStatements(id));
  return { project, deleted: true };
}

export function findProjectByTargetRepoPath(dbPath: string, targetRepoPath: string): ProjectRecord | undefined {
  return findProjectByRepositoryPath(dbPath, targetRepoPath);
}

export function findProjectByRepositoryPath(dbPath: string, targetRepoPath: string): ProjectRecord | undefined {
  const normalizedPath = normalizeProjectPath(targetRepoPath);
  const result = runSqlite(dbPath, [], [
    {
      name: "project",
      sql: `SELECT p.*, rc.remote_url
        FROM projects p
        LEFT JOIN repository_connections rc ON rc.project_id = p.id
        WHERE p.target_repo_path = ? OR rc.local_path = ?
        ORDER BY p.created_at DESC, rc.connected_at DESC
        LIMIT 1`,
      params: [normalizedPath, normalizedPath],
    },
  ]);
  const row = result.queries.project[0];
  return row ? mapProject(row) : undefined;
}

function projectDeletionStatements(projectId: string) {
  const featureScope = "SELECT id FROM features WHERE project_id = ?";
  const taskScope = `SELECT id FROM tasks WHERE feature_id IN (${featureScope})`;
  const graphTaskScope = `SELECT id FROM task_graph_tasks WHERE feature_id IN (${featureScope})`;
  const runScope = `SELECT id FROM runs WHERE project_id = ? OR feature_id IN (${featureScope})`;
  const reviewScope = `SELECT id FROM review_items
    WHERE project_id = ?
      OR feature_id IN (${featureScope})
      OR task_id IN (${taskScope})
      OR task_id IN (${graphTaskScope})
      OR run_id IN (${runScope})`;
  const worktreeScope = `SELECT id FROM worktree_records WHERE project_id = ? OR feature_id IN (${featureScope})`;
  const memoryScope = "SELECT id FROM project_memories WHERE project_id = ?";
  const p = (count: number) => Array.from({ length: count }, () => projectId);

  return [
    { sql: `DELETE FROM approval_records WHERE review_item_id IN (${reviewScope})`, params: p(6) },
    { sql: `DELETE FROM review_items WHERE id IN (${reviewScope})`, params: p(6) },
    { sql: `DELETE FROM status_check_results WHERE project_id = ? OR feature_id IN (${featureScope}) OR run_id IN (${runScope})`, params: p(4) },
    { sql: `DELETE FROM spec_alignment_results WHERE feature_id IN (${featureScope}) OR run_id IN (${runScope})`, params: p(3) },
    { sql: `DELETE FROM runner_policies WHERE run_id IN (${runScope})`, params: p(2) },
    { sql: `DELETE FROM runner_heartbeats WHERE run_id IN (${runScope})`, params: p(2) },
    { sql: `DELETE FROM cli_session_records WHERE run_id IN (${runScope})`, params: p(2) },
    { sql: `DELETE FROM codex_session_records WHERE run_id IN (${runScope})`, params: p(2) },
    { sql: `DELETE FROM raw_execution_logs WHERE run_id IN (${runScope})`, params: p(2) },
    { sql: `DELETE FROM recovery_attempts WHERE task_id IN (${taskScope}) OR task_id IN (${graphTaskScope})`, params: p(2) },
    { sql: `DELETE FROM forbidden_retry_records WHERE task_id IN (${taskScope}) OR task_id IN (${graphTaskScope})`, params: p(2) },
    { sql: `DELETE FROM task_schedules WHERE task_id IN (${taskScope}) OR task_id IN (${graphTaskScope})`, params: p(2) },
    { sql: `DELETE FROM delivery_reports WHERE feature_id IN (${featureScope})`, params: p(1) },
    { sql: `DELETE FROM pull_request_records WHERE feature_id IN (${featureScope})`, params: p(1) },
    { sql: `DELETE FROM spec_evolution_suggestions WHERE feature_id IN (${featureScope})`, params: p(1) },
    { sql: `DELETE FROM schedule_triggers WHERE project_id = ? OR feature_id IN (${featureScope})`, params: p(2) },
    { sql: `DELETE FROM feature_selection_decisions WHERE project_id = ? OR selected_feature_id IN (${featureScope})`, params: p(2) },
    { sql: `DELETE FROM merge_readiness_results WHERE worktree_id IN (${worktreeScope})`, params: p(2) },
    { sql: `DELETE FROM rollback_boundaries WHERE worktree_id IN (${worktreeScope}) OR feature_id IN (${featureScope})`, params: p(3) },
    { sql: `DELETE FROM worktree_records WHERE id IN (${worktreeScope})`, params: p(2) },
    { sql: `DELETE FROM task_graph_tasks WHERE feature_id IN (${featureScope})`, params: p(1) },
    { sql: `DELETE FROM task_graphs WHERE feature_id IN (${featureScope})`, params: p(1) },
    { sql: `DELETE FROM requirements WHERE feature_id IN (${featureScope})`, params: p(1) },
    { sql: `DELETE FROM tasks WHERE feature_id IN (${featureScope})`, params: p(1) },
    { sql: `DELETE FROM runs WHERE project_id = ? OR feature_id IN (${featureScope})`, params: p(2) },
    { sql: `DELETE FROM features WHERE project_id = ?`, params: p(1) },
    { sql: `DELETE FROM memory_compaction_events WHERE project_memory_id IN (${memoryScope})`, params: p(1) },
    { sql: `DELETE FROM memory_version_records WHERE project_memory_id IN (${memoryScope})`, params: p(1) },
    { sql: "DELETE FROM project_memories WHERE project_id = ?", params: p(1) },
    { sql: "DELETE FROM constitution_revalidation_marks WHERE project_id = ?", params: p(1) },
    { sql: "DELETE FROM project_constitutions WHERE project_id = ?", params: p(1) },
    { sql: "DELETE FROM project_health_checks WHERE project_id = ?", params: p(1) },
    { sql: "DELETE FROM repository_connections WHERE project_id = ?", params: p(1) },
    { sql: "DELETE FROM projects WHERE id = ?", params: p(1) },
  ];
}

export function getRepositoryConnection(dbPath: string, projectId: string): RepositoryConnectionRecord | undefined {
  const result = runSqlite(dbPath, [], [
    {
      name: "connection",
      sql: `SELECT * FROM repository_connections WHERE project_id = ? ORDER BY connected_at DESC LIMIT 1`,
      params: [projectId],
    },
  ]);
  const row = result.queries.connection[0];
  if (!row) {
    return undefined;
  }
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    provider: String(row.provider),
    remoteUrl: nullableString(row.remote_url),
    localPath: String(row.local_path),
    defaultBranch: String(row.default_branch),
  };
}

export function readProjectRepository(
  dbPath: string,
  projectId: string,
  runner?: CommandRunner,
): RepositorySummary | undefined {
  const connection = getRepositoryConnection(dbPath, projectId);
  if (!connection) {
    return undefined;
  }

  const summary = readRepositorySummary(connection.localPath, runner);
  if (summary.remoteUrl && summary.remoteUrl !== connection.remoteUrl) {
    runSqlite(dbPath, [
      {
        sql: "UPDATE repository_connections SET provider = ?, remote_url = ?, default_branch = ? WHERE id = ?",
        params: [
          detectProvider(summary.remoteUrl),
          summary.remoteUrl,
          summary.defaultBranch ?? summary.currentBranch ?? connection.defaultBranch,
          connection.id,
        ],
      },
    ]);
  }
  runSqlite(dbPath, [
    {
      sql: "UPDATE repository_connections SET last_read_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [connection.id],
    },
  ]);
  return summary;
}

export function connectProjectRepository(
  dbPath: string,
  projectId: string,
  input: { repositoryUrl?: string } = {},
): RepositoryConnectionRecord {
  const project = assertProjectExists(dbPath, projectId);
  if (!project.targetRepoPath) {
    throw new Error("Project repository path is required before Git binding.");
  }
  if (!existsSync(project.targetRepoPath)) {
    throw new Error(`Project repository path does not exist: ${project.targetRepoPath}`);
  }

  const requestedRemoteUrl = normalizeOptionalString(input.repositoryUrl);
  let summary = readRepositorySummary(project.targetRepoPath);
  if (!summary.isGitRepository) {
    runGit(project.targetRepoPath, ["init"]);
    if (project.defaultBranch) {
      runGit(project.targetRepoPath, ["checkout", "-B", project.defaultBranch]);
    }
    summary = readRepositorySummary(project.targetRepoPath);
  }

  const remoteUrl = requestedRemoteUrl ?? summary.remoteUrl;
  if (requestedRemoteUrl) {
    const existingRemote = gitOptional(project.targetRepoPath, ["config", "--get", "remote.origin.url"]);
    runGit(project.targetRepoPath, existingRemote ? ["remote", "set-url", "origin", requestedRemoteUrl] : ["remote", "add", "origin", requestedRemoteUrl]);
    summary = readRepositorySummary(project.targetRepoPath);
  }

  const connection = {
    id: randomUUID(),
    projectId,
    provider: detectProvider(remoteUrl),
    remoteUrl,
    localPath: project.targetRepoPath,
    defaultBranch: summary.defaultBranch ?? summary.currentBranch ?? project.defaultBranch,
  };
  upsertRepositoryConnection(dbPath, connection);
  return connection;
}

export function initializeProjectSpecProtocol(dbPath: string, projectId: string): { artifactRoot: string } {
  const project = assertProjectExists(dbPath, projectId);
  if (!project.targetRepoPath) {
    throw new Error("Project repository path is required before Spec Protocol initialization.");
  }
  const artifactRoot = join(project.targetRepoPath, ".autobuild");
  ensureArtifactDirectories(artifactRoot);
  ensureProjectAgentRuntime(project.targetRepoPath);
  return { artifactRoot };
}

function ensureProjectAgentRuntime(projectPath: string): void {
  const agentsFile = join(projectPath, "AGENTS.md");
  if (!existsSync(agentsFile)) {
    writeFileSync(agentsFile, [
      "# Agent Guidelines",
      "",
      "This project is managed by SpecDrive AutoBuild.",
      "",
      "- Treat PRD, EARS requirements, HLD, and docs/features as the source of truth.",
      "- Feature Specs live under docs/features/<feature-id>/ and include requirements.md, design.md, and tasks.md.",
      "- Do not treat .autobuild/specs/FEAT-INTAKE-*.json as Feature Spec packages; those files are intake artifacts.",
      "- Preserve unrelated user changes and keep implementation traceable to requirements and Feature Specs.",
      "",
    ].join("\n"));
  }

  const sourceAgents = join(dirname(fileURLToPath(import.meta.url)), "..", ".agents");
  const targetAgents = join(projectPath, ".agents");
  mkdirSync(targetAgents, { recursive: true });
  if (!existsSync(sourceAgents)) return;
  copyMissingAgentRuntime(sourceAgents, targetAgents);
}

function copyMissingAgentRuntime(sourceDir: string, targetDir: string): void {
  if (resolve(sourceDir) === resolve(targetDir)) return;
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      if (existsSync(target) && !statSync(target).isDirectory()) continue;
      copyMissingAgentRuntime(source, target);
      continue;
    }
    if (!entry.isFile() || existsSync(target)) continue;
    cpSync(source, target, { recursive: true, force: false });
  }
}

export function initializeProjectMemoryForProject(dbPath: string, projectId: string) {
  const project = assertProjectExists(dbPath, projectId);
  const { artifactRoot } = initializeProjectSpecProtocol(dbPath, projectId);
  return initializeProjectMemory({
    dbPath,
    artifactRoot,
    projectId,
    projectName: project.name,
    goal: project.goal,
    defaultBranch: project.defaultBranch,
  });
}

export function saveProjectConstitution(
  dbPath: string,
  projectId: string,
  input: ProjectConstitutionInput,
): ProjectConstitutionRecord {
  const project = getProject(dbPath, projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  validateConstitution(input);

  const version = nextConstitutionVersion(dbPath, projectId);
  const id = randomUUID();
  const source = input.source ?? "created";
  const title = input.title ?? `${project.name} Constitution`;

  runSqlite(dbPath, [
    {
      sql: "UPDATE project_constitutions SET status = 'superseded' WHERE project_id = ? AND status = 'active'",
      params: [projectId],
    },
    {
      sql: `INSERT INTO project_constitutions (
        id, project_id, version, source, title, project_goal, engineering_principles_json,
        boundary_rules_json, approval_rules_json, default_constraints_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      params: [
        id,
        projectId,
        version,
        source,
        title,
        input.projectGoal,
        JSON.stringify(input.engineeringPrinciples),
        JSON.stringify(input.boundaryRules),
        JSON.stringify(input.approvalRules),
        JSON.stringify(input.defaultConstraints),
      ],
    },
  ]);

  recordAuditEvent(dbPath, {
    entityType: "project",
    entityId: projectId,
    eventType: version === 1 ? "project_constitution_created" : "project_constitution_versioned",
    source: "project-constitution",
    reason: `${source} project constitution version ${version}`,
    payload: { constitutionId: id, version, source, title },
  });

  return {
    id,
    projectId,
    version,
    source,
    title,
    projectGoal: input.projectGoal,
    engineeringPrinciples: [...input.engineeringPrinciples],
    boundaryRules: [...input.boundaryRules],
    approvalRules: [...input.approvalRules],
    defaultConstraints: [...input.defaultConstraints],
    status: "active",
  };
}

export function getCurrentProjectConstitution(
  dbPath: string,
  projectId: string,
): ProjectConstitutionRecord | undefined {
  return listProjectConstitutions(dbPath, projectId).find((constitution) => constitution.status === "active");
}

export function listProjectConstitutions(dbPath: string, projectId: string): ProjectConstitutionRecord[] {
  const result = runSqlite(dbPath, [], [
    {
      name: "constitutions",
      sql: `SELECT * FROM project_constitutions
        WHERE project_id = ?
        ORDER BY version DESC`,
      params: [projectId],
    },
  ]);
  return result.queries.constitutions.map(mapConstitution);
}

export function markConstitutionRevalidation(
  dbPath: string,
  input: ConstitutionRevalidationInput,
): ConstitutionRevalidationMark {
  const constitution = listProjectConstitutions(dbPath, input.projectId).find((item) => item.id === input.constitutionId);
  if (!constitution) {
    throw new Error(`Project constitution not found: ${input.constitutionId}`);
  }
  const id = randomUUID();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO constitution_revalidation_marks (
        id, project_id, constitution_id, entity_type, entity_id, reason, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      params: [
        id,
        input.projectId,
        input.constitutionId,
        input.entityType,
        input.entityId,
        input.reason,
      ],
    },
  ]);

  recordAuditEvent(dbPath, {
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: "constitution_revalidation_marked",
    source: "project-constitution",
    reason: input.reason,
    payload: {
      projectId: input.projectId,
      constitutionId: input.constitutionId,
      markId: id,
    },
  });

  return { ...input, id, status: "pending" };
}

export function listConstitutionRevalidationMarks(
  dbPath: string,
  projectId: string,
): ConstitutionRevalidationMark[] {
  const result = runSqlite(dbPath, [], [
    {
      name: "marks",
      sql: `SELECT * FROM constitution_revalidation_marks
        WHERE project_id = ?
        ORDER BY created_at, rowid`,
      params: [projectId],
    },
  ]);
  return result.queries.marks.map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    constitutionId: String(row.constitution_id),
    entityType: String(row.entity_type) as ConstitutionRevalidationMark["entityType"],
    entityId: String(row.entity_id),
    reason: String(row.reason),
    status: String(row.status),
    createdAt: nullableString(row.created_at),
  }));
}

export function runProjectHealthCheck(
  dbPath: string,
  projectId: string,
  runner?: CommandRunner,
): ProjectHealthCheck {
  const project = getProject(dbPath, projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const repositorySummary = readProjectRepository(dbPath, projectId, runner)
    ?? (project.targetRepoPath ? readRepositorySummary(project.targetRepoPath, runner) : emptyRepositorySummary(project));
  const reasons = classifyReasons(repositorySummary);
  const status: ProjectHealthStatus =
    repositorySummary.errors.includes("repository_path_missing") && !repositorySummary.isGitRepository
      ? "failed"
      : reasons.length > 0
        ? "blocked"
        : "ready";
  const id = randomUUID();

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO project_health_checks (id, project_id, status, reasons_json, repository_summary_json)
        VALUES (?, ?, ?, ?, ?)`,
      params: [id, projectId, status, JSON.stringify(reasons), JSON.stringify(repositorySummary)],
    },
    {
      sql: "UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [status, projectId],
    },
  ]);

  return { id, projectId, status, reasons, repositorySummaryKind: "snapshot", repositorySummary };
}

function upsertRepositoryConnection(dbPath: string, connection: RepositoryConnectionRecord): void {
  const normalizedPath = normalizeProjectPath(connection.localPath);
  const existingByPath = findProjectByRepositoryPath(dbPath, normalizedPath);
  if (existingByPath && existingByPath.id !== connection.projectId) {
    throw new DuplicateProjectPathError(normalizedPath, existingByPath.id);
  }

  const existingConnection = getRepositoryConnection(dbPath, connection.projectId);
  if (existingConnection) {
    runSqlite(dbPath, [
      {
        sql: "UPDATE repository_connections SET provider = ?, remote_url = ?, local_path = ?, default_branch = ?, connected_at = CURRENT_TIMESTAMP WHERE id = ?",
        params: [
          connection.provider,
          connection.remoteUrl ?? null,
          normalizedPath,
          connection.defaultBranch,
          existingConnection.id,
        ],
      },
    ]);
    return;
  }

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO repository_connections (
        id, project_id, provider, remote_url, local_path, default_branch
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        connection.id,
        connection.projectId,
        connection.provider,
        connection.remoteUrl ?? null,
        normalizedPath,
        connection.defaultBranch,
      ],
    },
  ]);
}

function classifyReasons(summary: RepositorySummary): string[] {
  const reasons: string[] = [];
  if (!summary.isGitRepository) reasons.push("git_repository_missing");
  if (!summary.packageManager) reasons.push("package_manager_missing");
  if (!summary.testCommand) reasons.push("test_command_missing");
  if (!summary.buildCommand) reasons.push("build_command_missing");
  if (!summary.hasCodexConfig) reasons.push("codex_config_missing");
  if (!summary.hasAgentsFile) reasons.push("agents_file_missing");
  if (!summary.hasSpecProtocolDirectory) reasons.push("spec_protocol_directory_missing");
  if (summary.hasUncommittedChanges) reasons.push("uncommitted_changes_present");
  if (summary.sensitiveFileRisks.length > 0) reasons.push("sensitive_file_risk");
  return reasons;
}

function emptyRepositorySummary(project: ProjectRecord): RepositorySummary {
  return {
    localPath: project.targetRepoPath ?? "",
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
    errors: ["git_repository_missing"],
  };
}

function mapProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    goal: String(row.goal),
    projectType: String(row.project_type),
    techPreferences: parseJsonArray(row.tech_preferences_json),
    targetRepoPath: nullableString(row.target_repo_path),
    repositoryUrl: nullableString(row.remote_url),
    defaultBranch: String(row.default_branch),
    trustLevel: normalizeTrustLevel(row.trust_level),
    environment: String(row.environment),
    automationEnabled: Number(row.automation_enabled) === 1,
    status: String(row.status),
  };
}

function mapConstitution(row: Record<string, unknown>): ProjectConstitutionRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    version: Number(row.version),
    source: String(row.source) === "imported" ? "imported" : "created",
    title: String(row.title),
    projectGoal: String(row.project_goal),
    engineeringPrinciples: parseJsonArray(row.engineering_principles_json),
    boundaryRules: parseJsonArray(row.boundary_rules_json),
    approvalRules: parseJsonArray(row.approval_rules_json),
    defaultConstraints: parseJsonArray(row.default_constraints_json),
    status: String(row.status),
    createdAt: nullableString(row.created_at),
  };
}

function validateConstitution(input: ProjectConstitutionInput): void {
  const requiredLists: Array<[keyof ProjectConstitutionInput, string[]]> = [
    ["engineeringPrinciples", input.engineeringPrinciples],
    ["boundaryRules", input.boundaryRules],
    ["approvalRules", input.approvalRules],
    ["defaultConstraints", input.defaultConstraints],
  ];
  if (typeof input.projectGoal !== "string" || !input.projectGoal.trim()) {
    throw new Error("Project constitution requires projectGoal");
  }
  for (const [field, values] of requiredLists) {
    if (!Array.isArray(values) || values.length === 0 || values.some((value) => !value.trim())) {
      throw new Error(`Project constitution requires ${String(field)}`);
    }
  }
}

function nextConstitutionVersion(dbPath: string, projectId: string): number {
  const result = runSqlite(dbPath, [], [
    {
      name: "version",
      sql: "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM project_constitutions WHERE project_id = ?",
      params: [projectId],
    },
  ]);
  return Number(result.queries.version[0]?.version ?? 1);
}

function normalizeTrustLevel(value: unknown): ProjectTrustLevel {
  return value === "trusted" || value === "restricted" ? value : "standard";
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function detectProvider(repositoryUrl?: string): string {
  if (!repositoryUrl) return "local";
  if (repositoryUrl.includes("github.com")) return "github";
  if (repositoryUrl.includes("gitlab.com")) return "gitlab";
  return "private";
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeProjectPath(path: string): string {
  const resolvedPath = resolve(path);
  return existsSync(resolvedPath) ? realpathSync.native(resolvedPath) : resolvedPath;
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || result.error?.message || "git_command_failed";
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function gitOptional(cwd: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : undefined;
}

function inferProjectName(targetRepoPath: string, summary: RepositorySummary): string {
  if (summary.remoteUrl) {
    const remoteName = summary.remoteUrl
      .split("/")
      .at(-1)
      ?.replace(/\.git$/, "");
    if (remoteName) {
      return remoteName;
    }
  }
  return basename(targetRepoPath) || "Imported Project";
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// ── FEAT-001 TASK-013: Project directory query ─────────────────────────────────

export function listProjects(dbPath: string): ProjectSummary[] {
  const result = runSqlite(dbPath, [], [
    {
      name: "projects",
      sql: `SELECT p.*,
          rc.remote_url,
          hc.status AS health_status,
          MAX(COALESCE(p.updated_at, p.created_at)) AS last_activity_at
        FROM projects p
        LEFT JOIN repository_connections rc ON rc.project_id = p.id
        LEFT JOIN project_health_checks hc ON hc.project_id = p.id
          AND hc.checked_at = (
            SELECT MAX(checked_at) FROM project_health_checks WHERE project_id = p.id
          )
        GROUP BY p.id
        ORDER BY last_activity_at DESC`,
    },
  ]);
  return result.queries.projects.map(mapProjectSummary);
}

// ── FEAT-001 TASK-014: ProjectSelectionContext persistence ─────────────────────

export function setCurrentProject(
  dbPath: string,
  projectId: string,
  switchSource: ProjectSwitchSource = "manual",
): ProjectSelectionContext {
  const project = getProject(dbPath, projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  const switchedAt = new Date().toISOString();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO project_selection_context (id, project_id, switch_source, switched_at)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          switch_source = excluded.switch_source,
          switched_at = excluded.switched_at`,
      params: [projectId, switchSource, switchedAt],
    },
  ]);
  recordAuditEvent(dbPath, {
    entityType: "project",
    entityId: projectId,
    eventType: "project_selected",
    source: "project-service",
    reason: `Project switched via ${switchSource}`,
    payload: { switchSource, switchedAt },
  });
  return { projectId, switchSource, switchedAt };
}

export function getCurrentProjectSelection(dbPath: string): ProjectSelectionContext | undefined {
  const result = runSqlite(dbPath, [], [
    {
      name: "ctx",
      sql: "SELECT * FROM project_selection_context WHERE id = 1",
    },
  ]);
  const row = result.queries.ctx[0];
  if (!row) return undefined;
  return {
    projectId: String(row.project_id),
    switchSource: normalizeProjectSwitchSource(row.switch_source),
    switchedAt: String(row.switched_at),
  };
}

// ── FEAT-001 TASK-015: project_id isolation ────────────────────────────────────

export function assertProjectExists(dbPath: string, projectId: string): ProjectRecord {
  const project = getProject(dbPath, projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }
  return project;
}

// ── FEAT-001 TASK-017: Phase 1 auto-initialization closure ────────────────────

export function initializeProjectPhase1(
  dbPath: string,
  input: ProjectInput & ProjectWorkspaceRoot,
  runner?: CommandRunner,
): Phase1InitResult {
  // TASK-016: derive workspace path for new projects
  const resolvedInput = resolveProjectDirectory(input);

  let project: ProjectRecord;
  try {
    project = createProject(dbPath, resolvedInput);
  } catch (error) {
    return {
      project: {
        id: "",
        name: resolvedInput.name,
        goal: resolvedInput.goal,
        projectType: resolvedInput.projectType,
        techPreferences: resolvedInput.techPreferences ?? [],
        targetRepoPath: resolvedInput.targetRepoPath,
        defaultBranch: resolvedInput.defaultBranch ?? "main",
        trustLevel: resolvedInput.trustLevel ?? "standard",
        environment: resolvedInput.environment,
        automationEnabled: Boolean(resolvedInput.automationEnabled),
        status: "failed",
      },
      repositoryConnected: false,
      constitutionCreated: false,
      memoryInitialized: false,
      healthStatus: "failed",
      blockingReasons: [error instanceof Error ? error.message : "project_creation_failed"],
      success: false,
    };
  }

  const blockingReasons: string[] = [];

  // Repository connection was established in createProject if targetRepoPath is set
  const repositoryConnected = Boolean(project.targetRepoPath);

  // Constitution
  const constitutionCreated = Boolean(getCurrentProjectConstitution(dbPath, project.id));

  // Project memory — check if initialization succeeded
  let memoryInitialized = false;
  if (project.targetRepoPath && existsSync(project.targetRepoPath)) {
    const autobuildPath = join(project.targetRepoPath, ".autobuild");
    memoryInitialized = existsSync(autobuildPath);
    if (!memoryInitialized) {
      blockingReasons.push("memory_initialization_failed");
    }
  }

  // Health check
  let healthStatus: ProjectHealthStatus = "ready";
  try {
    const healthCheck = runProjectHealthCheck(dbPath, project.id, runner);
    healthStatus = healthCheck.status;
    if (healthStatus !== "ready") {
      blockingReasons.push(...healthCheck.reasons);
    }
  } catch {
    healthStatus = "failed";
    blockingReasons.push("health_check_failed");
  }

  // Set current project context
  try {
    setCurrentProject(dbPath, project.id, "auto");
  } catch {
    blockingReasons.push("project_selection_failed");
  }

  return {
    project,
    repositoryConnected,
    constitutionCreated,
    memoryInitialized,
    healthStatus,
    blockingReasons,
    success: blockingReasons.length === 0,
  };
}

// ── Private helpers for FEAT-001 ───────────────────────────────────────────────

function mapProjectSummary(row: Record<string, unknown>): ProjectSummary {
  return {
    ...mapProject(row),
    lastActivityAt: nullableString(row.last_activity_at),
    recentHealthStatus: row.health_status
      ? (String(row.health_status) as ProjectHealthStatus)
      : undefined,
  };
}

export function createDefaultProjectConstitution(input: Pick<ProjectInput, "name" | "goal" | "defaultBranch" | "trustLevel" | "environment">): ProjectConstitutionInput {
  const defaultBranch = input.defaultBranch ?? "main";
  const trustLevel = input.trustLevel ?? "standard";
  return {
    source: "created",
    title: `${input.name} Project Constitution`,
    projectGoal: input.goal,
    engineeringPrinciples: [
      "Keep implementation traceable to approved specs.",
      "Prefer the repository's existing patterns before introducing new abstractions.",
    ],
    boundaryRules: [
      "Keep changes scoped to the active project.",
      "Preserve unrelated user changes.",
    ],
    approvalRules: [
      "Require review for high-risk, security, permission, architecture, or constitution changes.",
    ],
    defaultConstraints: [
      `Default branch: ${defaultBranch}`,
      `Trust level: ${trustLevel}`,
      `Environment: ${input.environment}`,
    ],
  };
}

function normalizeProjectSwitchSource(value: unknown): ProjectSwitchSource {
  if (value === "auto" || value === "session_restore") return value;
  return "manual";
}

// TASK-016: For create_new projects with no targetRepoPath, auto-derive path under workspace/<slug>.
function resolveProjectDirectory(input: ProjectInput & ProjectWorkspaceRoot): ProjectInput {
  if (input.creationMode !== "create_new" || input.targetRepoPath) {
    return input;
  }
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const workspaceRoot = input.workspaceRoot ?? process.cwd();
  const targetRepoPath = join(workspaceRoot, "workspace", slug);
  return { ...input, targetRepoPath };
}
