import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BootstrapError } from "./errors.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type RunnerConfig = {
  command: string;
  args: string[];
  sandboxMode: string;
};

export type AppConfig = {
  port: number;
  artifactRoot: string;
  dbPath: string;
  logLevel: LogLevel;
  runnerConfig: RunnerConfig;
};

type ConfigInput = Partial<Omit<AppConfig, "runnerConfig">> & {
  runnerConfig?: Partial<RunnerConfig>;
};

type LoadConfigOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  configPath?: string;
};

const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  command: "codex",
  args: ["exec"],
  sandboxMode: "workspace-write",
};

const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const configPath = options.configPath ?? resolve(cwd, ".autobuild.config.json");

  const fileConfig = readConfigFile(configPath);
  const envConfig = readEnvConfig(env);
  const cliConfig = readCliConfig(argv);

  const artifactRoot = toAbsolutePath(
    cwd,
    cliConfig.artifactRoot ?? envConfig.artifactRoot ?? fileConfig.artifactRoot ?? ".autobuild",
  );
  const dbPath = toAbsolutePath(
    cwd,
    cliConfig.dbPath ?? envConfig.dbPath ?? fileConfig.dbPath ?? `${artifactRoot}/autobuild.db`,
  );

  const merged: AppConfig = {
    port: Number(cliConfig.port ?? envConfig.port ?? fileConfig.port ?? 4731),
    artifactRoot,
    dbPath,
    logLevel: validateLogLevel(cliConfig.logLevel ?? envConfig.logLevel ?? fileConfig.logLevel ?? "info"),
    runnerConfig: {
      ...DEFAULT_RUNNER_CONFIG,
      ...definedValues(fileConfig.runnerConfig ?? {}),
      ...definedValues(envConfig.runnerConfig ?? {}),
      ...definedValues(cliConfig.runnerConfig ?? {}),
    },
  };

  validateConfig(merged);
  return merged;
}

function readConfigFile(configPath: string): ConfigInput {
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as ConfigInput;
  } catch (error) {
    throw new BootstrapError("config", `Failed to read ${configPath}`, errorMessage(error));
  }
}

function readEnvConfig(env: NodeJS.ProcessEnv): ConfigInput {
  return {
    port: env.AUTOBUILD_PORT ? Number(env.AUTOBUILD_PORT) : undefined,
    artifactRoot: env.AUTOBUILD_ARTIFACT_ROOT,
    dbPath: env.AUTOBUILD_DB_PATH,
    logLevel: env.AUTOBUILD_LOG_LEVEL as LogLevel | undefined,
    runnerConfig: {
      command: env.AUTOBUILD_RUNNER_COMMAND,
      args: env.AUTOBUILD_RUNNER_ARGS ? env.AUTOBUILD_RUNNER_ARGS.split(" ").filter(Boolean) : undefined,
      sandboxMode: env.AUTOBUILD_RUNNER_SANDBOX_MODE,
    },
  };
}

function readCliConfig(argv: string[]): ConfigInput {
  const config: ConfigInput = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--port" && next) {
      config.port = Number(next);
      index += 1;
    } else if (arg === "--artifact-root" && next) {
      config.artifactRoot = next;
      index += 1;
    } else if (arg === "--db-path" && next) {
      config.dbPath = next;
      index += 1;
    } else if (arg === "--log-level" && next) {
      config.logLevel = next as LogLevel;
      index += 1;
    } else if (arg === "--runner-config-json" && next) {
      try {
        config.runnerConfig = JSON.parse(next) as RunnerConfig;
      } catch (error) {
        throw new BootstrapError("config", "Invalid --runner-config-json", errorMessage(error));
      }
      index += 1;
    }
  }

  return config;
}

function validateConfig(config: AppConfig): void {
  const missing: string[] = [];

  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    missing.push("port");
  }
  if (!config.artifactRoot) {
    missing.push("artifactRoot");
  }
  if (!config.dbPath) {
    missing.push("dbPath");
  }
  if (!config.runnerConfig.command) {
    missing.push("runnerConfig.command");
  }

  if (missing.length > 0) {
    throw new BootstrapError("config", `Invalid or missing required config: ${missing.join(", ")}`, { missing });
  }
}

function validateLogLevel(value: unknown): LogLevel {
  if (typeof value === "string" && LOG_LEVELS.has(value)) {
    return value as LogLevel;
  }
  throw new BootstrapError("config", `Invalid logLevel: ${String(value)}`);
}

function toAbsolutePath(cwd: string, path: string): string {
  return resolve(cwd, path);
}

function definedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
