import type { CommandAction, CommandReceipt, ConsoleData, ProjectCreateForm, ProjectDirectoryScan, ProjectSummary } from "../types";

function endpoints(projectId: string) {
  const encodedProjectId = encodeURIComponent(projectId);
  return {
    dashboard: `/console/dashboard?projectId=${encodedProjectId}`,
    board: `/console/dashboard-board?projectId=${encodedProjectId}`,
    spec: `/console/spec-workspace?projectId=${encodedProjectId}&featureId=FEAT-013`,
    skills: `/console/skills?projectId=${encodedProjectId}`,
    subagents: `/console/subagents?projectId=${encodedProjectId}`,
    runner: `/console/runner?projectId=${encodedProjectId}`,
    reviews: `/console/reviews?projectId=${encodedProjectId}`,
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
      creationMode: input.mode,
    }),
  });
  if (!response.ok) {
    throw new Error(`/projects returned ${response.status}`);
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
