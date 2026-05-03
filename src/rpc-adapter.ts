import type { CliJsonEvent } from "./cli-adapter.ts";
import type { ExecutionAdapterConfigV1 } from "./execution-adapter-contracts.ts";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: Record<string, unknown>;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

export type RpcAdapterTransport = {
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  notify(method: string, params?: Record<string, unknown>): Promise<void> | void;
  events(): AsyncIterable<CliJsonEvent>;
  close?(): Promise<void> | void;
};

export type RpcAdapterConfig = {
  id: string;
  displayName: string;
  provider?: string;
  executable: string;
  args: string[];
  transport: "stdio" | "unix" | "http" | "jsonrpc" | "websocket";
  endpoint?: string;
  requestTimeoutMs: number;
  status: "active" | "disabled";
  updatedAt?: string;
};

export type RpcAdapterValidationResult = {
  valid: boolean;
  errors: string[];
  command?: string;
  args?: string[];
};

export type RpcAdapterConfigV1 = ExecutionAdapterConfigV1 & {
  kind: "rpc";
  provider: string;
};

export function rpcAdapterConfigToExecutionAdapterConfig(input: {
  config: RpcAdapterConfig;
  provider: string;
  capabilities?: string[];
  outputMapping?: Record<string, unknown>;
}): RpcAdapterConfigV1 {
  return {
    id: input.config.id,
    kind: "rpc",
    displayName: input.config.displayName,
    provider: input.provider,
    schemaVersion: 1,
    transport: input.config.transport,
    capabilities: input.capabilities ?? ["json-rpc", "event-stream", "skill-output-contract"],
    defaults: {},
    inputMapping: {
      executable: input.config.executable,
      args: input.config.args,
      endpoint: input.config.endpoint,
      requestTimeoutMs: input.config.requestTimeoutMs,
    },
    outputMapping: input.outputMapping ?? {
      eventStream: "json-rpc",
      outputSchema: "skill-output.schema.json",
    },
    security: {},
    status: input.config.status === "active" ? "active" : "disabled",
    updatedAt: input.config.updatedAt ?? new Date(0).toISOString(),
  };
}

export function validateRpcAdapterConfig(config: RpcAdapterConfig): RpcAdapterValidationResult {
  const errors: string[] = [];
  if (!config.id.trim()) errors.push("id is required");
  if (!config.executable.trim()) errors.push("executable is required");
  if (config.status === "disabled") errors.push("adapter is disabled");
  if (!Number.isFinite(config.requestTimeoutMs) || config.requestTimeoutMs < 1000) errors.push("requestTimeoutMs must be at least 1000");
  if (!["stdio", "unix", "http", "jsonrpc", "websocket"].includes(config.transport)) errors.push("transport is invalid");
  if ((config.transport === "http" || config.transport === "jsonrpc" || config.transport === "websocket") && !config.endpoint?.trim()) {
    errors.push("endpoint is required for network transports");
  }
  return { valid: errors.length === 0, errors };
}

export function dryRunRpcAdapterConfig(config: RpcAdapterConfig): RpcAdapterValidationResult {
  const validation = validateRpcAdapterConfig(config);
  if (!validation.valid) return validation;
  return { valid: true, errors: [], command: config.executable, args: config.args };
}
