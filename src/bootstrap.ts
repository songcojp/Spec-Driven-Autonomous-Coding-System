import { existsSync } from "node:fs";
import { ensureArtifactDirectories } from "./artifacts.ts";
import { type AppConfig, loadConfig } from "./config.ts";
import { BootstrapError, formatBootstrapError, type StepLog } from "./errors.ts";
import { getCurrentSchemaVersion, initializeSchema } from "./schema.ts";
import { countBuiltInSkills, seedBuiltInSkills } from "./skills.ts";

export type ReadyState =
  | {
      status: "initializing";
      version: string;
      schemaVersion: number;
      artifactRoot: string;
    }
  | {
      status: "ready";
      version: string;
      schemaVersion: number;
      artifactRoot: string;
      builtInSkills: number;
    }
  | {
      status: "error";
      error: string;
      step: string;
      detail?: unknown;
    };

export type BootstrapResult = {
  config: AppConfig;
  readyState: ReadyState;
  logs: StepLog[];
};

export const APP_VERSION = "0.1.0";

export async function runBootstrap(config: AppConfig = loadConfig()): Promise<BootstrapResult> {
  const logs: StepLog[] = [];

  try {
    await step(logs, "artifact-directories", () => ensureArtifactDirectories(config.artifactRoot));
    const schemaState = await step(logs, "schema", () => initializeSchema(config.dbPath));
    await step(logs, "skill-seed", () => seedBuiltInSkills(config.dbPath));

    const builtInSkills = countBuiltInSkills(config.dbPath);
    if (builtInSkills === 0) {
      throw new BootstrapError("skill-seed", "No built-in skills are available after seeding");
    }

    return {
      config,
      readyState: {
        status: "ready",
        version: APP_VERSION,
        schemaVersion: schemaState.schemaVersion,
        artifactRoot: config.artifactRoot,
        builtInSkills,
      },
      logs,
    };
  } catch (error) {
    const readyState = formatBootstrapError(error);
    logs.push({
      step: readyState.step,
      status: "error",
      durationMs: 0,
      detail: readyState,
    });
    return {
      config,
      readyState,
      logs,
    };
  }
}

export function initialReadyState(config: AppConfig): ReadyState {
  return {
    status: "initializing",
    version: APP_VERSION,
    schemaVersion: existsSync(config.dbPath) ? getCurrentSchemaVersion(config.dbPath) : 0,
    artifactRoot: config.artifactRoot,
  };
}

async function step<T>(logs: StepLog[], stepName: string, action: () => T): Promise<T> {
  const startedAt = performance.now();
  try {
    const detail = action();
    logs.push({
      step: stepName,
      status: "ok",
      durationMs: Math.round(performance.now() - startedAt),
      detail,
    });
    return detail;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    logs.push({
      step: stepName,
      status: "error",
      durationMs,
      detail: formatBootstrapError(error),
    });
    throw error;
  }
}
