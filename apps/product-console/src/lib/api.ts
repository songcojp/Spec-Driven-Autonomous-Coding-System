import type { CommandAction, CommandReceipt, ConsoleData } from "../types";

const endpoints = {
  dashboard: "/console/dashboard?projectId=project-1",
  board: "/console/dashboard-board?projectId=project-1",
  spec: "/console/spec-workspace?projectId=project-1&featureId=FEAT-013",
  skills: "/console/skills?projectId=project-1",
  subagents: "/console/subagents?projectId=project-1",
  runner: "/console/runner?projectId=project-1",
  reviews: "/console/reviews?projectId=project-1",
} as const;

export async function fetchConsoleData(): Promise<ConsoleData> {
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key, path]) => {
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
