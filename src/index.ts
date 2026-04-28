import { loadConfig } from "./config.ts";
import { initialReadyState, runBootstrap } from "./bootstrap.ts";
import { createControlPlaneServer, listen } from "./server.ts";

async function main(): Promise<void> {
  const bootstrapOnly = process.argv.includes("--bootstrap-only");
  const config = loadConfig();

  if (bootstrapOnly) {
    const result = await runBootstrap(config);
    console.log(JSON.stringify(result.readyState));
    process.exit(result.readyState.status === "ready" ? 0 : 1);
  }

  const controlPlane = createControlPlaneServer(config, initialReadyState(config));
  await listen(controlPlane.server, config);

  const result = await runBootstrap(config);
  controlPlane.setReadyState(result.readyState);

  if (result.readyState.status !== "ready") {
    console.error(JSON.stringify(result.readyState));
    controlPlane.server.close();
    process.exit(1);
  }

  console.log(JSON.stringify({ status: "listening", port: config.port, health: "/health" }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
