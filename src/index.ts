import { loadConfig } from "./config.ts";
import { initialReadyState, runBootstrap } from "./bootstrap.ts";
import { createControlPlaneServer, listen } from "./server.ts";
import { createBullMqScheduler, createSchedulerWorkers, createUnavailableScheduler, type SchedulerWorkers } from "./scheduler.ts";

async function main(): Promise<void> {
  const bootstrapOnly = process.argv.includes("--bootstrap-only");
  const config = loadConfig();
  let workers: SchedulerWorkers | undefined;

  if (bootstrapOnly) {
    const result = await runBootstrap(config);
    console.log(JSON.stringify(result.readyState));
    process.exit(result.readyState.status === "ready" ? 0 : 1);
  }

  const scheduler = config.schedulerConfig.workerMode === "off"
    ? createUnavailableScheduler(config.dbPath, "Scheduler worker mode is off.")
    : createBullMqScheduler(config.dbPath, config.schedulerConfig.redisUrl);

  const result = await runBootstrap(config);
  if (result.readyState.status !== "ready") {
    console.error(JSON.stringify(result.readyState));
    process.exit(1);
  }

  if (config.schedulerConfig.workerMode === "worker-only") {
    workers = await createSchedulerWorkers({
      dbPath: config.dbPath,
      redisUrl: config.schedulerConfig.redisUrl,
      scheduler,
    });
    console.log(JSON.stringify({ status: "worker-only", queues: ["specdrive:feature-scheduler", "specdrive:cli-runner"] }));
    await waitForShutdown(async () => {
      await workers?.close();
      await scheduler.close?.();
    });
    return;
  }

  const controlPlane = createControlPlaneServer(config, initialReadyState(config), { scheduler });
  await listen(controlPlane.server, config);

  controlPlane.setReadyState(result.readyState);
  if (config.schedulerConfig.workerMode === "embedded") {
    workers = await createSchedulerWorkers({
      dbPath: config.dbPath,
      redisUrl: config.schedulerConfig.redisUrl,
      scheduler,
    });
  }

  process.on("SIGINT", () => {
    void shutdown(controlPlane.server, workers, scheduler.close);
  });
  process.on("SIGTERM", () => {
    void shutdown(controlPlane.server, workers, scheduler.close);
  });

  console.log(JSON.stringify({ status: "listening", port: config.port, health: "/health", workerMode: config.schedulerConfig.workerMode }));
}

async function shutdown(server: { close: (callback?: (error?: Error) => void) => void }, workers?: SchedulerWorkers, closeScheduler?: () => Promise<void>): Promise<void> {
  await workers?.close();
  await closeScheduler?.();
  server.close(() => process.exit(0));
}

function waitForShutdown(onShutdown: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      void onShutdown().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
