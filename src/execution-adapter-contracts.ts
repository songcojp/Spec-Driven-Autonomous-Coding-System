import type {
  RunnerApprovalPolicy,
  RunnerQueueStatus,
  RunnerReasoningEffort,
  RunnerSandboxMode,
  SkillArtifactContract,
  SkillInvocationConstraints,
  SkillOperatorInputContract,
  SkillOutputArtifact,
  SkillOutputContract,
  SkillTraceabilityContract,
} from "./cli-adapter.ts";

export type ExecutionAdapterKind = "cli" | "rpc";
export type ExecutionAdapterStatus = "draft" | "active" | "disabled" | "invalid";
export type ExecutionAdapterTransport = "process" | "stdio" | "http" | "jsonrpc" | "websocket" | "unix";
export type ExecutionAdapterResultStatus = RunnerQueueStatus | "cancelled";

export type ExecutionAdapterConfigV1 = {
  id: string;
  kind: ExecutionAdapterKind;
  displayName: string;
  provider: string;
  schemaVersion: number;
  transport: ExecutionAdapterTransport;
  capabilities: string[];
  defaults: {
    model?: string;
    reasoningEffort?: RunnerReasoningEffort;
    profile?: string;
    sandbox?: RunnerSandboxMode;
    approval?: RunnerApprovalPolicy;
    [key: string]: unknown;
  };
  inputMapping: Record<string, unknown>;
  outputMapping: Record<string, unknown>;
  security: {
    environmentAllowlist?: string[];
    headersAllowlist?: string[];
    authRef?: string;
    [key: string]: unknown;
  };
  status: ExecutionAdapterStatus;
  updatedAt: string;
};

export type ExecutionAdapterResumeV1 = {
  sessionId?: string;
  threadId?: string;
  turnId?: string;
};

export type ExecutionAdapterSkillInstructionV1 = {
  skillSlug: string;
  requestedAction: string;
  sourcePaths: string[];
  imagePaths?: string[];
  expectedArtifacts: SkillArtifactContract[];
  operatorInput?: SkillOperatorInputContract;
};

export type ExecutionAdapterInvocationV1 = {
  contractVersion: "execution-adapter/v1";
  executionId: string;
  jobId?: string;
  projectId?: string;
  workspaceRoot: string;
  operation: string;
  featureId?: string;
  specState?: Record<string, unknown>;
  traceability: SkillTraceabilityContract;
  constraints: SkillInvocationConstraints;
  outputSchema: Record<string, unknown>;
  resume?: ExecutionAdapterResumeV1;
  skillInstruction: ExecutionAdapterSkillInstructionV1;
};

export type ExecutionAdapterApprovalRequestV1 = {
  id?: string;
  threadId?: string;
  turnId?: string;
  summary?: string;
  command?: string;
  payload?: Record<string, unknown>;
};

export type ExecutionAdapterTokenUsageV1 = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
};

export type ExecutionAdapterEventV1 = {
  contractVersion: "execution-adapter/v1";
  executionId: string;
  provider: string;
  sequence: number;
  timestamp: string;
  type: string;
  severity: "debug" | "info" | "warning" | "error";
  message?: string;
  payloadRef?: string;
  approvalRequest?: ExecutionAdapterApprovalRequestV1;
  tokenUsage?: ExecutionAdapterTokenUsageV1;
};

export type ExecutionAdapterProviderSessionV1 = {
  provider: string;
  transport: ExecutionAdapterTransport;
  command?: string;
  args?: string[];
  endpoint?: string;
  cwd?: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  model?: string;
  capabilities?: string[];
  exitCode?: number | null;
  startedAt?: string;
  completedAt?: string;
  eventRefs?: Array<{
    index: number;
    type?: string;
    threadId?: string;
    turnId?: string;
  }>;
  approvalState?: "none" | "pending" | "approved" | "declined" | "cancelled";
};

export type ExecutionAdapterResultV1 = {
  contractVersion: "execution-adapter/v1";
  executionId: string;
  status: ExecutionAdapterResultStatus;
  providerSession: ExecutionAdapterProviderSessionV1;
  summary: string;
  skillOutput?: SkillOutputContract;
  producedArtifacts: SkillOutputArtifact[];
  traceability: SkillTraceabilityContract;
  nextAction?: string;
  rawLogRefs: string[];
  error?: string;
};
