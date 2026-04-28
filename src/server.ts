import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AppConfig } from "./config.ts";
import type { ReadyState } from "./bootstrap.ts";
import { createProject, getProject, readProjectRepository, runProjectHealthCheck } from "./projects.ts";
import {
  buildDashboardQuery,
  buildReviewCenterView,
  buildRunnerConsoleView,
  buildSkillCenterView,
  buildSpecWorkspaceView,
  buildSubagentConsoleView,
  submitConsoleCommand,
  type ConsoleCommandInput,
} from "./product-console.ts";

export type ControlPlaneServer = {
  server: Server;
  getReadyState: () => ReadyState;
  setReadyState: (state: ReadyState) => void;
};

export function createControlPlaneServer(config: AppConfig, initialState: ReadyState): ControlPlaneServer {
  let readyState = initialState;

  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      const statusCode = readyState.status === "error" ? 503 : 200;
      response.writeHead(statusCode, { "content-type": "application/json" });
      response.end(JSON.stringify(readyState));
      return;
    }

    void routeRequest(config, request, response);
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
): Promise<void> {
  try {
    if (request.method === "POST" && request.url === "/projects") {
      const project = createProject(config.dbPath, await readJsonBody(request));
      writeJson(response, 201, project);
      return;
    }

    const projectMatch = request.url?.match(/^\/projects\/([^/]+)(?:\/(repository|health))?$/);
    if (request.method === "GET" && projectMatch && !projectMatch[2]) {
      const project = getProject(config.dbPath, projectMatch[1]);
      writeJson(response, project ? 200 : 404, project ?? { error: "project_not_found" });
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

    const url = new URL(request.url ?? "/", "http://control-plane.local");
    if (request.method === "GET" && url.pathname === "/console/dashboard") {
      writeJson(response, 200, buildDashboardQuery(config.dbPath, {
        projectId: url.searchParams.get("projectId") ?? undefined,
        refresh: url.searchParams.get("refresh") === "true",
      }));
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

    if (request.method === "GET" && url.pathname === "/console/skills") {
      writeJson(response, 200, buildSkillCenterView(config.dbPath, url.searchParams.get("projectId") ?? undefined));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/subagents") {
      writeJson(response, 200, buildSubagentConsoleView(config.dbPath, url.searchParams.get("projectId") ?? undefined));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/runner") {
      writeJson(response, 200, buildRunnerConsoleView(config.dbPath, new Date(), url.searchParams.get("projectId") ?? undefined));
      return;
    }

    if (request.method === "GET" && url.pathname === "/console/reviews") {
      writeJson(response, 200, buildReviewCenterView(config.dbPath, url.searchParams.get("projectId") ?? undefined));
      return;
    }

    if (request.method === "POST" && url.pathname === "/console/commands") {
      writeJson(response, 202, submitConsoleCommand(config.dbPath, await readJsonBody(request) as ConsoleCommandInput));
      return;
    }

    writeJson(response, 404, { error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
