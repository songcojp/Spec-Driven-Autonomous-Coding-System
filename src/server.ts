import { createServer, type Server } from "node:http";
import type { AppConfig } from "./config.ts";
import type { ReadyState } from "./bootstrap.ts";

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

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
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

export function listen(server: Server, config: AppConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, () => {
      server.off("error", reject);
      resolve();
    });
  });
}
