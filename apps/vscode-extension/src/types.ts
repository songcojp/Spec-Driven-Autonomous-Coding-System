export type SpecDriveIdeDocument = {
  kind: string;
  label: string;
  path: string;
  exists: boolean;
};

export type SpecDriveIdeFeatureNode = {
  id: string;
  folder: string;
  title: string;
  status: string;
  priority?: string;
  dependencies: string[];
  blockedReasons: string[];
  nextAction?: string;
  documents: SpecDriveIdeDocument[];
  latestExecutionId?: string;
  latestExecutionStatus?: string;
  latestReviewItemId?: string;
  latestReviewStatus?: string;
  latestReviewNeededReason?: "approval_needed" | "clarification_needed" | "risk_review_needed";
  tokenConsumption?: SpecDriveIdeTokenConsumption;
  indexStatus?: "indexed" | "missing_from_index" | "missing_folder";
  tasks?: SpecDriveIdeTaskProjection[];
  taskParseBlockedReasons?: string[];
};

export type SpecDriveIdeTaskProjection = {
  id: string;
  title: string;
  status: string;
  description?: string;
  verification?: string;
  line?: number;
};

export type SpecDriveIdeQueueItem = {
  schedulerJobId?: string;
  executionId?: string;
  status: string;
  operation?: string;
  jobType?: string;
  featureId?: string;
  taskId?: string;
  adapter?: string;
  runMode?: "cli" | "rpc";
  adapterId?: string;
  preferenceSource?: string;
  threadId?: string;
  turnId?: string;
  updatedAt?: string;
  summary?: string;
};

export type SpecDriveIdeExecutionDetail = SpecDriveIdeQueueItem & {
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  rawLogs: Array<{ stdout: string; stderr: string; events: unknown[]; createdAt?: string }>;
  rawLogRefs: string[];
  tokenConsumption?: SpecDriveIdeTokenConsumption;
  producedArtifacts: unknown[];
  diffSummary?: unknown;
  skillOutputContract?: unknown;
  contractValidation?: unknown;
  outputSchema?: unknown;
  approvalRequests: unknown[];
};

export type SpecDriveIdeTokenConsumption = {
  runId: string;
  schedulerJobId?: string;
  projectId?: string;
  featureId?: string;
  taskId?: string;
  operation?: string;
  model?: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUsd: number;
  currency: string;
  pricingStatus: string;
  usage: Record<string, unknown>;
  pricing: Record<string, unknown>;
  sourcePath: string;
  recordedAt: string;
};

export type SpecDriveIdeProjectCostSummary = {
  totalUsd: number;
  tokensUsed: number;
  currency: string;
};

export type SpecDriveIdeDiagnostic = {
  path: string;
  severity: "error" | "warning" | "info";
  message: string;
  source: "workspace" | "spec-state" | "execution";
  featureId?: string;
  executionId?: string;
};

export type SpecDriveIdeInitializationStep = {
  key: string;
  label: string;
  status: "Ready" | "Blocked" | "Draft" | "Active";
  updatedAt?: string;
  blockedReason?: string;
};

export type SpecDriveIdeAutomationState = {
  status: "idle" | "running" | "paused";
  updatedAt?: string;
  source: "project" | "audit";
};

export type SpecDriveIdeView = {
  recognized: boolean;
  workspaceRoot?: string;
  specRoot?: string;
  language?: string;
  project?: {
    id: string;
    name: string;
    targetRepoPath?: string;
  };
  activeAdapter?: {
    id: string;
    displayName: string;
    status: string;
  };
  executionPreferenceOptions?: {
    active: { runMode?: "cli" | "rpc"; adapterId?: string; source?: string };
    cliAdapters: Array<{ id: string; displayName: string; status: string }>;
    rpcAdapters: Array<{ id: string; displayName: string; status: string; provider?: string }>;
  };
  projectCost?: SpecDriveIdeProjectCostSummary;
  automation?: SpecDriveIdeAutomationState;
  projectInitialization?: {
    ready: boolean;
    blocked: boolean;
    steps: SpecDriveIdeInitializationStep[];
  };
  documents: SpecDriveIdeDocument[];
  features: SpecDriveIdeFeatureNode[];
  queue: {
    groups: Record<string, SpecDriveIdeQueueItem[]>;
  };
  diagnostics: SpecDriveIdeDiagnostic[];
  missing: string[];
  factSources: string[];
  productConsole?: {
    defaultUrl: string;
    links: {
      workspace: string;
      queue: string;
    };
  };
};

export type UiConceptImage = {
  label: string;
  path: string;
  uri: string;
};

export type ControlledCommandInput = {
  action: string;
  entityType: "project" | "feature" | "task" | "run" | "runner" | "review_item" | "rule" | "spec" | "cli_adapter" | "rpc_adapter" | "settings";
  entityId: string;
  payload?: Record<string, unknown>;
  reason: string;
};

export type AdapterSettingsSection = {
  active: Record<string, unknown>;
  draft?: Record<string, unknown>;
  presets: Array<Record<string, unknown>>;
  validation: {
    valid: boolean;
    errors?: string[];
  };
  lastDryRun?: {
    status: string;
    errors: string[];
    command?: string;
    args?: string[];
    at?: string;
  };
  lastProbe?: {
    status: string;
    errors: string[];
    command?: string;
    args?: string[];
    at?: string;
  };
};

export type SystemSettingsViewModel = {
  projectExecutionPreference?: {
    projectId?: string;
    active: Record<string, unknown>;
    cliAdapters: Record<string, unknown>[];
    rpcAdapters: Record<string, unknown>[];
    validation: { valid: boolean; errors: string[] };
  };
  cliAdapter?: AdapterSettingsSection;
  rpcAdapter?: AdapterSettingsSection;
  commands: Array<{ action: string; entityType: ControlledCommandInput["entityType"] }>;
  factSources: string[];
};

export type QueueAction = "enqueue" | "run_now" | "pause" | "resume" | "retry" | "cancel" | "skip" | "reprioritize" | "refresh" | "approve";
export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type IdeQueueCommandV1 = {
  schemaVersion: 1;
  ideCommandType: "queue_action";
  projectId?: string;
  workspaceRoot?: string;
  queueAction: QueueAction;
  entityType: "run" | "job";
  entityId: string;
  requestedBy: string;
  reason: string;
  payload?: Record<string, unknown>;
  approvalDecision?: ApprovalDecision;
};

export type SpecChangeRequestIntent =
  | "clarification"
  | "requirement_intake"
  | "requirement_change_or_intake"
  | "spec_evolution"
  | "generate_ears"
  | "update_design"
  | "split_feature";

export type SpecChangeRequestV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceRoot: string;
  source: {
    file: string;
    range: {
      startLine: number;
      endLine: number;
      startCharacter?: number;
      endCharacter?: number;
    };
    textHash: string;
  };
  intent: SpecChangeRequestIntent;
  comment: string;
  targetRequirementId?: string;
  traceability?: string[];
};

export type SpecChangeCommandInput = {
  intent: SpecChangeRequestIntent;
  comment: string;
  targetRequirementId?: string;
  traceability?: string[];
  line?: number;
};

export type SpecExplorerItem =
  | { type: "root"; id: string; label: string; description?: string; children: SpecExplorerItem[] }
  | { type: "document"; id: string; label: string; description?: string; path: string; exists: boolean }
  | { type: "feature"; id: string; label: string; description?: string; feature: SpecDriveIdeFeatureNode }
  | { type: "queue-item"; id: string; label: string; description?: string; item: SpecDriveIdeQueueItem };
