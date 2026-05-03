import type {
  RunnerApprovalPolicy,
  RunnerQueueStatus,
  RunnerReasoningEffort,
  RunnerSandboxMode,
  SkillArtifactContract,
  SkillInvocationConstraints,
  SkillInvocationContract,
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

export type ExecutionAdapterInvocationV1 = {
  contractVersion: "execution-adapter/v1";
  executionId: string;
  jobId?: string;
  projectId?: string;
  workspaceRoot: string;
  operation: string;
  featureId?: string;
  taskId?: string;
  skillSlug?: string;
  requestedAction: string;
  sourcePaths: string[];
  imagePaths?: string[];
  expectedArtifacts: SkillArtifactContract[];
  specState?: Record<string, unknown>;
  traceability: SkillTraceabilityContract;
  constraints: SkillInvocationConstraints;
  outputSchema: Record<string, unknown>;
  resume?: ExecutionAdapterResumeV1;
  skillInvocation?: SkillInvocationContract;
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

export function executionInvocationFromSkillContract(input: {
  skillInvocation: SkillInvocationContract;
  outputSchema: Record<string, unknown>;
  jobId?: string;
  resume?: ExecutionAdapterResumeV1;
}): ExecutionAdapterInvocationV1 {
  return {
    contractVersion: "execution-adapter/v1",
    executionId: input.skillInvocation.executionId,
    jobId: input.jobId,
    projectId: input.skillInvocation.projectId,
    workspaceRoot: input.skillInvocation.workspaceRoot,
    operation: input.skillInvocation.operation,
    featureId: input.skillInvocation.traceability.featureId,
    taskId: input.skillInvocation.traceability.taskId,
    skillSlug: input.skillInvocation.skillSlug,
    requestedAction: input.skillInvocation.requestedAction,
    sourcePaths: input.skillInvocation.sourcePaths,
    imagePaths: input.skillInvocation.imagePaths,
    expectedArtifacts: input.skillInvocation.expectedArtifacts,
    specState: input.skillInvocation.specState,
    traceability: input.skillInvocation.traceability,
    constraints: input.skillInvocation.constraints,
    outputSchema: input.outputSchema,
    resume: input.resume,
    skillInvocation: input.skillInvocation,
  };
}
