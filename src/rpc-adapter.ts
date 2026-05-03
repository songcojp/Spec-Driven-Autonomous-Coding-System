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
  executable: string;
  args: string[];
  transport: "stdio" | "unix" | "http" | "jsonrpc" | "websocket";
  endpoint?: string;
  requestTimeoutMs: number;
  status: "active" | "disabled";
  updatedAt?: string;
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
