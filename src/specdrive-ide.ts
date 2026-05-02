import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { runSqlite } from "./sqlite.ts";

export type SpecDriveIdeDocument = {
  kind: "prd" | "requirements" | "hld" | "feature-index" | "feature-requirements" | "feature-design" | "feature-tasks" | "spec-state" | "queue";
  label: string;
  path: string;
  exists: boolean;
};

export type SpecDriveIdeFeatureNode = {
  id: string;
  folder: string;
  title: string;
  status: string;
  priority?: string;
  dependencies: string[];
  blockedReasons: string[];
  nextAction?: string;
  documents: SpecDriveIdeDocument[];
  latestExecutionId?: string;
  latestExecutionStatus?: string;
};

export type SpecDriveIdeQueueItem = {
  schedulerJobId?: string;
  executionId?: string;
  status: string;
  operation?: string;
  jobType?: string;
  featureId?: string;
  taskId?: string;
  adapter?: string;
  threadId?: string;
  turnId?: string;
  updatedAt?: string;
  summary?: string;
};

export type SpecDriveIdeDiagnostic = {
  path: string;
  severity: "error" | "warning" | "info";
  message: string;
  source: "workspace" | "spec-state" | "execution";
  featureId?: string;
  executionId?: string;
};

export type SpecDriveIdeView = {
  recognized: boolean;
  workspaceRoot?: string;
  specRoot?: string;
  language?: string;
  project?: {
    id: string;
    name: string;
    targetRepoPath?: string;
  };
  activeAdapter?: {
    id: string;
    displayName: string;
    status: string;
  };
  documents: SpecDriveIdeDocument[];
  features: SpecDriveIdeFeatureNode[];
  queue: {
    groups: Record<string, SpecDriveIdeQueueItem[]>;
  };
  diagnostics: SpecDriveIdeDiagnostic[];
  missing: string[];
  factSources: string[];
};

type BuildSpecDriveIdeViewOptions = {
  workspaceRoot?: string;
  projectId?: string;
};

type ProjectRow = {
  id?: unknown;
  name?: unknown;
  target_repo_path?: unknown;
};

type FeatureQueueEntry = {
  id: string;
  priority?: string;
  dependencies?: string[];
};

type FeatureQueuePlan = {
  features?: FeatureQueueEntry[];
};

export function buildSpecDriveIdeView(dbPath: string, options: BuildSpecDriveIdeViewOptions = {}): SpecDriveIdeView {
  const project = resolveProject(dbPath, options);
  const workspaceRoot = options.workspaceRoot ? resolve(options.workspaceRoot) : optionalString(project?.target_repo_path);
  const language = workspaceRoot ? detectSpecLanguage(workspaceRoot) : undefined;
  const specRoot = workspaceRoot && language ? `docs/${language}` : workspaceRoot && hasRootSpec(workspaceRoot) ? "docs" : undefined;
  const documents = workspaceRoot ? buildTopLevelDocuments(workspaceRoot, specRoot) : [];
  const features = workspaceRoot ? buildFeatureNodes(dbPath, workspaceRoot) : [];
  const queue = buildQueueGroups(dbPath, options.projectId ?? optionalString(project?.id));
  const activeAdapter = readActiveAdapter(dbPath);
  const missing = [
    ...documents.filter((document) => !document.exists).map((document) => document.path),
    ...(workspaceRoot && !existsSync(join(workspaceRoot, "docs/features")) ? ["docs/features"] : []),
  ];
  const diagnostics = buildDiagnostics(documents, features, queue.groups, workspaceRoot);

  return {
    recognized: Boolean(workspaceRoot && specRoot && existsSync(join(workspaceRoot, "docs/features"))),
    workspaceRoot,
    specRoot,
    language,
    project: project?.id ? {
      id: String(project.id),
      name: String(project.name ?? project.id),
      targetRepoPath: optionalString(project.target_repo_path),
    } : undefined,
    activeAdapter,
    documents,
    features,
    queue,
    diagnostics,
    missing,
    factSources: [
      "workspace_files",
      "docs/features/feature-pool-queue.json",
      "docs/features/*/spec-state.json",
      "scheduler_job_records",
      "execution_records",
      "cli_adapter_configs",
    ],
  };
}

function resolveProject(dbPath: string, options: BuildSpecDriveIdeViewOptions): ProjectRow | undefined {
  if (options.projectId) {
    const result = runSqlite(dbPath, [], [
      { name: "project", sql: "SELECT id, name, target_repo_path FROM projects WHERE id = ? LIMIT 1", params: [options.projectId] },
    ]);
    return result.queries.project[0] as ProjectRow | undefined;
  }
  if (options.workspaceRoot) {
    const workspaceRoot = resolve(options.workspaceRoot);
    const result = runSqlite(dbPath, [], [
      { name: "project", sql: "SELECT id, name, target_repo_path FROM projects WHERE target_repo_path = ? LIMIT 1", params: [workspaceRoot] },
      {
        name: "repositoryProject",
        sql: `SELECT p.id, p.name, COALESCE(p.target_repo_path, r.local_path) AS target_repo_path
          FROM repository_connections r
          JOIN projects p ON p.id = r.project_id
          WHERE r.local_path = ?
          ORDER BY r.connected_at DESC
          LIMIT 1`,
        params: [workspaceRoot],
      },
    ]);
    return (result.queries.project[0] ?? result.queries.repositoryProject[0]) as ProjectRow | undefined;
  }
  const result = runSqlite(dbPath, [], [
    {
      name: "selected",
      sql: `SELECT p.id, p.name, p.target_repo_path
        FROM project_selection_context s
        JOIN projects p ON p.id = s.project_id
        LIMIT 1`,
    },
    { name: "first", sql: "SELECT id, name, target_repo_path FROM projects ORDER BY rowid LIMIT 1" },
  ]);
  return (result.queries.selected[0] ?? result.queries.first[0]) as ProjectRow | undefined;
}

function detectSpecLanguage(workspaceRoot: string): string | undefined {
  for (const language of ["zh-CN", "en", "ja"]) {
    const root = join(workspaceRoot, "docs", language);
    if (existsSync(join(root, "PRD.md")) || existsSync(join(root, "requirements.md")) || existsSync(join(root, "hld.md"))) {
      return language;
    }
  }
  return undefined;
}

function hasRootSpec(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, "docs", "PRD.md"))
    || existsSync(join(workspaceRoot, "docs", "requirements.md"))
    || existsSync(join(workspaceRoot, "docs", "hld.md"));
}

function buildTopLevelDocuments(workspaceRoot: string, specRoot?: string): SpecDriveIdeDocument[] {
  const root = specRoot ?? "docs";
  const docs = [
    document("prd", "PRD", `${root}/PRD.md`, workspaceRoot),
    document("requirements", "EARS Requirements", `${root}/requirements.md`, workspaceRoot),
    document("hld", "HLD", `${root}/hld.md`, workspaceRoot),
    document("feature-index", "Feature Spec Index", "docs/features/README.md", workspaceRoot),
    document("queue", "Feature Pool Queue", "docs/features/feature-pool-queue.json", workspaceRoot),
  ] satisfies SpecDriveIdeDocument[];
  return docs;
}

function buildFeatureNodes(dbPath: string, workspaceRoot: string): SpecDriveIdeFeatureNode[] {
  const featureRoot = join(workspaceRoot, "docs/features");
  if (!existsSync(featureRoot)) return [];
  const queuePlan = readFeatureQueuePlan(workspaceRoot);
  const queueById = new Map((queuePlan.features ?? []).map((entry) => [entry.id, entry]));
  const latestExecutions = readLatestExecutionsByFeature(dbPath);

  return readdirSync(featureRoot)
    .filter((entry) => {
      const fullPath = join(featureRoot, entry);
      return statSync(fullPath).isDirectory();
    })
    .sort()
    .map((folder) => {
      const state = readJson(join(featureRoot, folder, "spec-state.json"));
      const featureId = optionalString(state.featureId) ?? folderToFeatureId(folder);
      const queueEntry = queueById.get(featureId);
      const latestExecution = latestExecutions.get(featureId);
      return {
        id: featureId,
        folder,
        title: titleFromFolder(folder),
        status: optionalString(state.status) ?? "unknown",
        priority: optionalString(queueEntry?.priority),
        dependencies: stringArray(state.dependencies).length > 0 ? stringArray(state.dependencies) : stringArray(queueEntry?.dependencies),
        blockedReasons: stringArray(state.blockedReasons),
        nextAction: optionalString(state.nextAction),
        latestExecutionId: latestExecution?.executionId,
        latestExecutionStatus: latestExecution?.status,
        documents: [
          document("feature-requirements", "requirements.md", `docs/features/${folder}/requirements.md`, workspaceRoot),
          document("feature-design", "design.md", `docs/features/${folder}/design.md`, workspaceRoot),
          document("feature-tasks", "tasks.md", `docs/features/${folder}/tasks.md`, workspaceRoot),
          document("spec-state", "spec-state.json", `docs/features/${folder}/spec-state.json`, workspaceRoot),
        ],
      };
    });
}

function readFeatureQueuePlan(workspaceRoot: string): FeatureQueuePlan {
  return readJson(join(workspaceRoot, "docs/features/feature-pool-queue.json")) as FeatureQueuePlan;
}

function readLatestExecutionsByFeature(dbPath: string): Map<string, { executionId: string; status: string }> {
  const result = runSqlite(dbPath, [], [
    {
      name: "executions",
      sql: `SELECT id, status, context_json
        FROM execution_records
        ORDER BY COALESCE(started_at, created_at) DESC`,
    },
  ]);
  const latest = new Map<string, { executionId: string; status: string }>();
  for (const row of result.queries.executions) {
    const context = parseJsonObject(optionalString(row.context_json));
    const featureId = optionalString(context.featureId);
    if (featureId && !latest.has(featureId)) {
      latest.set(featureId, { executionId: String(row.id), status: String(row.status) });
    }
  }
  return latest;
}

function buildQueueGroups(dbPath: string, projectId?: string): { groups: Record<string, SpecDriveIdeQueueItem[]> } {
  const projectFilter = projectId ? "WHERE er.project_id = ?" : "";
  const result = runSqlite(dbPath, [], [
    {
      name: "queue",
      sql: `SELECT
          sj.id AS scheduler_job_id,
          sj.job_type,
          sj.status AS job_status,
          sj.updated_at AS job_updated_at,
          er.id AS execution_id,
          er.operation,
          er.status AS execution_status,
          er.summary,
          er.context_json,
          er.metadata_json,
          er.updated_at AS execution_updated_at
        FROM scheduler_job_records sj
        LEFT JOIN execution_records er ON er.scheduler_job_id = sj.id
        ${projectFilter}
        ORDER BY COALESCE(er.updated_at, sj.updated_at) DESC
        LIMIT 100`,
      params: projectId ? [projectId] : [],
    },
  ]);
  const groups: Record<string, SpecDriveIdeQueueItem[]> = {};
  for (const row of result.queries.queue) {
    const context = parseJsonObject(optionalString(row.context_json));
    const metadata = parseJsonObject(optionalString(row.metadata_json));
    const status = optionalString(row.execution_status) ?? optionalString(row.job_status) ?? "unknown";
    const item: SpecDriveIdeQueueItem = {
      schedulerJobId: optionalString(row.scheduler_job_id),
      executionId: optionalString(row.execution_id),
      status,
      operation: optionalString(row.operation),
      jobType: optionalString(row.job_type),
      featureId: optionalString(context.featureId),
      taskId: optionalString(context.taskId),
      adapter: optionalString(metadata.skillSlug) ?? optionalString(metadata.adapterId),
      threadId: optionalString(metadata.threadId),
      turnId: optionalString(metadata.turnId),
      updatedAt: optionalString(row.execution_updated_at) ?? optionalString(row.job_updated_at),
      summary: optionalString(row.summary),
    };
    groups[status] = [...(groups[status] ?? []), item];
  }
  return { groups };
}

function buildDiagnostics(
  documents: SpecDriveIdeDocument[],
  features: SpecDriveIdeFeatureNode[],
  queueGroups: Record<string, SpecDriveIdeQueueItem[]>,
  workspaceRoot?: string,
): SpecDriveIdeDiagnostic[] {
  const diagnostics: SpecDriveIdeDiagnostic[] = [];
  const fallbackPath = documents.find((document) => document.kind === "feature-index" && document.exists)?.path
    ?? documents.find((document) => document.exists)?.path;
  for (const document of documents) {
    if (!document.exists && fallbackPath) {
      diagnostics.push({
        path: fallbackPath,
        severity: "warning",
        message: `SpecDrive source is missing: ${document.path}`,
        source: "workspace",
      });
    }
  }
  for (const feature of features) {
    const diagnosticPath = firstExistingFeatureDocument(feature)?.path ?? fallbackPath;
    if (!diagnosticPath) continue;
    const missingDocs = feature.documents.filter((document) => !document.exists).map((document) => document.path);
    if (missingDocs.length > 0) {
      diagnostics.push({
        path: diagnosticPath,
        severity: "warning",
        message: `Feature ${feature.id} is missing required Spec files: ${missingDocs.join(", ")}`,
        source: "workspace",
        featureId: feature.id,
      });
    }
    if (feature.blockedReasons.length > 0 || feature.status === "blocked" || feature.status === "failed") {
      diagnostics.push({
        path: diagnosticPath,
        severity: feature.status === "failed" ? "error" : "warning",
        message: feature.blockedReasons.length > 0
          ? `Feature ${feature.id} is ${feature.status}: ${feature.blockedReasons.join("; ")}`
          : `Feature ${feature.id} is ${feature.status}.`,
        source: "spec-state",
        featureId: feature.id,
        executionId: feature.latestExecutionId,
      });
    }
  }
  for (const item of [...(queueGroups.failed ?? []), ...(queueGroups.blocked ?? [])]) {
    const feature = item.featureId ? features.find((entry) => entry.id === item.featureId) : undefined;
    const path = firstExistingFeatureDocument(feature)?.path ?? fallbackPath;
    if (!path) continue;
    diagnostics.push({
      path,
      severity: item.status === "failed" ? "error" : "warning",
      message: item.summary ?? `Execution ${item.executionId ?? item.schedulerJobId ?? "unknown"} is ${item.status}.`,
      source: "execution",
      featureId: item.featureId,
      executionId: item.executionId,
    });
  }
  return workspaceRoot ? diagnostics : [];
}

function firstExistingFeatureDocument(feature?: SpecDriveIdeFeatureNode): SpecDriveIdeDocument | undefined {
  return feature?.documents.find((document) => document.exists && document.kind !== "spec-state")
    ?? feature?.documents.find((document) => document.exists);
}

function readActiveAdapter(dbPath: string): SpecDriveIdeView["activeAdapter"] {
  const result = runSqlite(dbPath, [], [
    { name: "adapter", sql: "SELECT id, display_name, status FROM cli_adapter_configs WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1" },
  ]);
  const row = result.queries.adapter[0];
  if (!row) return undefined;
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    status: String(row.status),
  };
}

function document(kind: SpecDriveIdeDocument["kind"], label: string, path: string, workspaceRoot: string): SpecDriveIdeDocument {
  return {
    kind,
    label,
    path,
    exists: existsSync(join(workspaceRoot, path)),
  };
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseJsonObject(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function folderToFeatureId(folder: string): string {
  const match = folder.match(/^feat-(\d+)/i);
  return match ? `FEAT-${match[1]}` : folder.toUpperCase();
}

function titleFromFolder(folder: string): string {
  return basename(folder)
    .replace(/^feat-\d+-/i, "")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
