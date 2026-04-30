import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AppConfig } from "./config.ts";
import type { ReadyState } from "./bootstrap.ts";
import {
  createProject,
  deleteProject,
  DuplicateProjectPathError,
  getCurrentProjectConstitution,
  getProject,
  listConstitutionRevalidationMarks,
  listProjectConstitutions,
  markConstitutionRevalidation,
  readProjectRepository,
  runProjectHealthCheck,
  saveProjectConstitution,
  scanProjectDirectory,
  type ProjectConstitutionInput,
} from "./projects.ts";
import {
  buildAuditCenterView,
  buildProjectOverview,
  buildDashboardBoardView,
  buildDashboardQuery,
  buildReviewCenterView,
  buildRunnerConsoleView,
  buildSpecWorkspaceView,
  buildSystemSettingsView,
  submitConsoleCommand,
  type ConsoleCommandInput,
} from "./product-console.ts";
import type { SchedulerClient } from "./scheduler.ts";
import { getOrCreateSession, processChatMessage, getChatHistory } from "./chat.ts";

export type ControlPlaneServer = {
  server: Server;
  getReadyState: () => ReadyState;
  setReadyState: (state: ReadyState) => void;
};

export function createControlPlaneServer(config: AppConfig, initialState: ReadyState, options: { scheduler?: SchedulerClient } = {}): ControlPlaneServer {
  let readyState = initialState;

  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      const statusCode = readyState.status === "error" ? 503 : 200;
      response.writeHead(statusCode, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ...readyState,
        scheduler: options.scheduler?.health?.(),
      }));
      return;
    }

    void routeRequest(config, request, response, options);
  });

  server.on("error", (error) => {
    readyState = {
      status: "error",
      step: "http",
      error: error.message,
    };
  });

  return {
    server,
    getReadyState: () => readyState,
    setReadyState: (state: ReadyState) => {
      readyState = state;
    },
  };
}

async function routeRequest(
  config: AppConfig,
  request: IncomingMessage,
  response: ServerResponse,
  options: { scheduler?: SchedulerClient } = {},
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://control-plane.local");

    if (request.method === "POST" && request.url === "/projects") {
      const project = createProject(config.dbPath, await readJsonBody(request));
      writeJson(response, 201, project);
      return;
    }

    if (request.method === "POST" && request.url === "/projects/scan") {
      const scan = scanProjectDirectory(await readJsonBody(request));
      writeJson(response, 200, scan);
      return;
    }

    const projectMatch = url.pathname.match(/^\/projects\/([^/]+)(?:\/(repository|health))?$/);
    if (request.method === "GET" && projectMatch && !projectMatch[2]) {
      const project = getProject(config.dbPath, projectMatch[1]);
      writeJson(response, project ? 200 : 404, project ?? { error: "project_not_found" });
      return;
    }

    if (request.method === "DELETE" && projectMatch && !projectMatch[2]) {
      const result = deleteProject(config.dbPath, projectMatch[1]);
      writeJson(response, result ? 200 : 404, result ?? { error: "project_not_found" });
      return;
    }

    if (request.method === "GET" && projectMatch?.[2] === "repository") {
      const summary = readProjectRepository(config.dbPath, projectMatch[1]);
      writeJson(response, summary ? 200 : 404, summary ?? { error: "repository_connection_not_found" });
      return;
    }

    if (request.method === "POST" && projectMatch?.[2] === "health") {
      writeJson(response, 200, runProjectHealthCheck(config.dbPath, projectMatch[1]));
      return;
    }

    const constitutionMatch = url.pathname.match(/^\/projects\/([^/]+)\/constitution$/);
    if (constitutionMatch && request.method === "POST") {
      writeJson(response, 201, saveProjectConstitution(
        config.dbPath,
        constitutionMatch[1],
        await readJsonBody(request) as ProjectConstitutionInput,
      ));
      return;
    }

    if (constitutionMatch && request.method === "GET") {
      const constitution = getCurrentProjectConstitution(config.dbPath, constitutionMatch[1]);
      writeJson(response, constitution ? 200 : 404, constitution ?? { error: "constitution_not_found" });
      return;
    }

    const constitutionsMatch = url.pathname.match(/^\/projects\/([^/]+)\/constitutions$/);
    if (constitutionsMatch && request.method === "GET") {
      writeJson(response, 200, listProjectConstitutions(config.dbPath, constitutionsMatch[1]));
      return;
    }

    const revalidationMatch = url.pathname.match(/^\/projects\/([^/]+)\/constitution\/revalidations$/);
    if (revalidationMatch && request.method === "POST") {
      const body = await readJsonBody(request);
      const entityType = String(body.entityType);
      if (entityType !== "feature" && entityType !== "task" && entityType !== "run") {
        writeJson(response, 400, { error: "invalid_revalidation_entity_type" });
        return;
      }
      writeJson(response, 201, markConstitutionRevalidation(config.dbPath, {
        projectId: revalidationMatch[1],
        constitutionId: String(body.constitutionId),
        entityType,
        entityId: String(body.entityId),
        reason: String(body.reason),
      }));
      return;
    }

    if (revalidationMatch && request.method === "GET") {
      writeJson(response, 200, listConstitutionRevalidationMarks(config.dbPath, revalidationMatch[1]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/dashboard") {
      writeJson(response, 200, buildDashboardQuery(config.dbPath, {
        projectId: url.searchParams.get("projectId") ?? undefined,
        refresh: url.searchParams.get("refresh") === "true",
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/project-overview") {
      writeJson(response, 200, buildProjectOverview(config.dbPath));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/dashboard-board") {
      writeJson(response, 200, buildDashboardBoardView(config.dbPath, url.searchParams.get("projectId") ?? undefined));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/spec-workspace") {
      writeJson(response, 200, buildSpecWorkspaceView(
        config.dbPath,
        url.searchParams.get("featureId") ?? undefined,
        url.searchParams.get("projectId") ?? undefined,
      ));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/runner") {
      writeJson(response, 200, buildRunnerConsoleView(config.dbPath, new Date(), url.searchParams.get("projectId") ?? undefined));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/system-settings") {
      writeJson(response, 200, buildSystemSettingsView(config.dbPath));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/reviews") {
      writeJson(response, 200, buildReviewCenterView(config.dbPath, url.searchParams.get("projectId") ?? undefined));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/audit") {
      writeJson(response, 200, buildAuditCenterView(config.dbPath, url.searchParams.get("projectId") ?? undefined));
      return;
    }

    if (request.method === "POST" && url.pathname === "/console/commands") {
      writeJson(response, 202, submitConsoleCommand(config.dbPath, await readJsonBody(request) as ConsoleCommandInput, { scheduler: options.scheduler }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/chat/sessions") {
      const body = await readJsonBody(request);
      const projectId = body.projectId ? String(body.projectId) : undefined;
      const session = getOrCreateSession(config.dbPath, projectId);
      writeJson(response, 200, session);
      return;
    }

    const chatMessagesMatch = url.pathname.match(/^\/chat\/sessions\/([^/]+)\/messages$/);
    if (chatMessagesMatch && request.method === "POST") {
      const sessionId = chatMessagesMatch[1];
      const body = await readJsonBody(request);
      const content = String(body.content ?? "");
      if (!content.trim()) {
        writeJson(response, 400, { error: "content is required" });
        return;
      }
      const chatResponse = await processChatMessage(config.dbPath, sessionId, content, { scheduler: options.scheduler });
      writeJson(response, 200, chatResponse);
      return;
    }

    if (chatMessagesMatch && request.method === "GET") {
      const sessionId = chatMessagesMatch[1];
      const limit = Number(url.searchParams.get("limit") ?? "50");
      writeJson(response, 200, getChatHistory(config.dbPath, sessionId, limit > 0 ? limit : 50));
      return;
    }

    writeJson(response, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DuplicateProjectPathError) {
      writeJson(response, 409, {
        error: "project_path_already_registered",
        targetRepoPath: error.targetRepoPath,
        existingProjectId: error.existingProjectId,
      });
      return;
    }
    writeJson(response, message.startsWith("Console command") ? 400 : 500, { error: message });
  }
}

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function listen(server: Server, config: AppConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, () => {
      server.off("error", reject);
      resolve();
    });
  });
}
