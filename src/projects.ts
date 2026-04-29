import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { initializeProjectMemory } from "./memory.ts";
import { recordAuditEvent } from "./persistence.ts";
import { runSqlite } from "./sqlite.ts";
import { readRepositorySummary, type CommandRunner, type RepositorySummary } from "./repository.ts";

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
  const trustLevel = input.trustLevel ?? "standard";

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

  if (input.constitution) {
    saveProjectConstitution(dbPath, id, input.constitution);
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
    trustLevel,
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
    source: "project-constitution-skill",
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
    source: "project-constitution-skill",
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

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
