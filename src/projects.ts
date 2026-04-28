import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { initializeProjectMemory } from "./memory.ts";
import { runSqlite } from "./sqlite.ts";
import { readRepositorySummary, type CommandRunner, type RepositorySummary } from "./repository.ts";

export type ProjectInput = {
  name: string;
  goal: string;
  projectType: string;
  techPreferences?: string[];
  targetRepoPath?: string;
  repositoryUrl?: string;
  defaultBranch?: string;
  environment: string;
  automationEnabled?: boolean;
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
  environment: string;
  automationEnabled: boolean;
  status: string;
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
  repositorySummary: RepositorySummary;
};

export function createProject(dbPath: string, input: ProjectInput): ProjectRecord {
  const id = randomUUID();
  const defaultBranch = input.defaultBranch ?? "main";
  const targetRepoPath = input.targetRepoPath ? resolve(input.targetRepoPath) : undefined;
  const repositoryUrl = input.repositoryUrl;
  const techPreferences = input.techPreferences ?? [];

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO projects (
        id, name, goal, project_type, tech_preferences_json, target_repo_path,
        default_branch, environment, automation_enabled, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        input.name,
        input.goal,
        input.projectType,
        JSON.stringify(techPreferences),
        targetRepoPath ?? null,
        defaultBranch,
        input.environment,
        input.automationEnabled ? 1 : 0,
        "created",
      ],
    },
  ]);

  if (targetRepoPath) {
    upsertRepositoryConnection(dbPath, {
      id: randomUUID(),
      projectId: id,
      provider: detectProvider(repositoryUrl),
      remoteUrl: repositoryUrl,
      localPath: targetRepoPath,
      defaultBranch,
    });
    if (existsSync(targetRepoPath)) {
      initializeProjectMemory({
        dbPath,
        artifactRoot: join(targetRepoPath, ".autobuild"),
        projectId: id,
        projectName: input.name,
        goal: input.goal,
        defaultBranch,
      });
    }
  }

  return {
    id,
    name: input.name,
    goal: input.goal,
    projectType: input.projectType,
    techPreferences,
    targetRepoPath,
    repositoryUrl,
    defaultBranch,
    environment: input.environment,
    automationEnabled: Boolean(input.automationEnabled),
    status: "created",
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
  runSqlite(dbPath, [
    {
      sql: "UPDATE repository_connections SET last_read_at = CURRENT_TIMESTAMP WHERE id = ?",
      params: [connection.id],
    },
  ]);
  return summary;
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

  const repositorySummary = readProjectRepository(dbPath, projectId, runner) ?? emptyRepositorySummary(project);
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

  return { id, projectId, status, reasons, repositorySummary };
}

function upsertRepositoryConnection(dbPath: string, connection: RepositoryConnectionRecord): void {
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
        connection.localPath,
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
    environment: String(row.environment),
    automationEnabled: Number(row.automation_enabled) === 1,
    status: String(row.status),
  };
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

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
