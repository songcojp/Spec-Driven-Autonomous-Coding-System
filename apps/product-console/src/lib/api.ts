import type { CommandAction, CommandReceipt, ConsoleData, ProjectCreateForm, ProjectDirectoryScan, ProjectOverviewModel, ProjectSummary } from "../types";

function endpoints(projectId: string) {
  const encodedProjectId = encodeURIComponent(projectId);
  return {
    overview: "/console/project-overview",
    dashboard: `/console/dashboard?projectId=${encodedProjectId}`,
    board: `/console/dashboard-board?projectId=${encodedProjectId}`,
    spec: `/console/spec-workspace?projectId=${encodedProjectId}`,
    runner: `/console/runner?projectId=${encodedProjectId}`,
    settings: "/console/system-settings",
    reviews: `/console/reviews?projectId=${encodedProjectId}`,
    audit: `/console/audit?projectId=${encodedProjectId}`,
  } as const;
}

export async function fetchConsoleData(projectId: string): Promise<Omit<ConsoleData, "projects">> {
  const entries = await Promise.all(
    Object.entries(endpoints(projectId)).map(async ([key, path]) => {
      const response = await fetch(path, { headers: { accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`${path} returned ${response.status}`);
      }
      return [key, await response.json()] as const;
    }),
  );
  return Object.fromEntries(entries) as ConsoleData;
}

export async function fetchProjectOverview(): Promise<ProjectOverviewModel> {
  const response = await fetch("/console/project-overview", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`/console/project-overview returned ${response.status}`);
  }
  return await response.json() as ProjectOverviewModel;
}

export async function fetchProjectSummaries(): Promise<ProjectSummary[]> {
  const overview = await fetchProjectOverview();
  return overview.projects.map((project) => ({
    id: project.id,
    name: project.name,
    repository: project.repository,
    projectDirectory: project.projectDirectory,
    defaultBranch: project.defaultBranch,
    health: project.health,
    lastActivityAt: project.lastActivityAt,
  }));
}

export async function submitCommand(input: {
  action: CommandAction;
  entityType: string;
  entityId: string;
  projectId: string;
  reason: string;
  payload?: Record<string, unknown>;
}): Promise<CommandReceipt> {
  const response = await fetch("/console/commands", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      requestedBy: "operator",
      ...input,
    }),
  });
  if (!response.ok) {
    throw new Error(`/console/commands returned ${response.status}`);
  }
  return await response.json() as CommandReceipt;
}

export async function createConsoleProject(input: ProjectCreateForm): Promise<ProjectSummary> {
  const techPreferences = input.techPreferences.split(",").map((item) => item.trim()).filter(Boolean);
  const targetRepoPath = input.mode === "create_new"
    ? `workspace/${input.workspaceSlug}`
    : input.existingProjectPath;
  const response = await fetch("/projects", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      name: input.name,
      goal: input.goal,
      projectType: input.projectType,
      techPreferences,
      environment: "local",
      automationEnabled: input.automationEnabled,
      defaultBranch: input.defaultBranch,
      targetRepoPath,
      repositoryUrl: input.repositoryUrl.trim() || undefined,
      creationMode: input.mode,
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => undefined) as { error?: string; targetRepoPath?: string; existingProjectId?: string } | undefined;
    if (response.status === 409 && detail?.error === "project_path_already_registered") {
      throw new Error(`project_path_already_registered:${detail.targetRepoPath ?? targetRepoPath}`);
    }
    throw new Error(detail?.error ?? `/projects returned ${response.status}`);
  }
  const project = await response.json() as { id: string; name: string; repositoryUrl?: string; targetRepoPath?: string; defaultBranch?: string; status?: string };
  const health = await fetchProjectHealth(project.id);
  const projectDirectory = project.targetRepoPath ?? targetRepoPath;
  return {
    id: project.id,
    name: project.name,
    repository: project.repositoryUrl ?? projectDirectory,
    projectDirectory,
    defaultBranch: project.defaultBranch ?? "main",
    health: health ?? (project.status === "failed" ? "failed" : project.status === "ready" ? "ready" : "blocked"),
    lastActivityAt: new Date().toISOString(),
  };
}

export async function deleteConsoleProject(projectId: string): Promise<void> {
  const response = await fetch(`/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => undefined) as { error?: string } | undefined;
    if (response.status === 404) {
      return;
    }
    throw new Error(detail?.error ?? `/projects/${projectId} returned ${response.status}`);
  }
}

async function fetchProjectHealth(projectId: string): Promise<ProjectSummary["health"] | undefined> {
  const response = await fetch(`/projects/${encodeURIComponent(projectId)}/health`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    return undefined;
  }
  const health = await response.json() as { status?: string };
  return health.status === "ready" || health.status === "blocked" || health.status === "failed"
    ? health.status
    : undefined;
}

export async function scanProjectDirectory(targetRepoPath: string): Promise<ProjectDirectoryScan> {
  const response = await fetch("/projects/scan", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ targetRepoPath }),
  });
  if (!response.ok) {
    throw new Error(`/projects/scan returned ${response.status}`);
  }
  return await response.json() as ProjectDirectoryScan;
}
