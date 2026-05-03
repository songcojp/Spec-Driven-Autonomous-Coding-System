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
  threadId?: string;
  turnId?: string;
  updatedAt?: string;
  summary?: string;
};

export type SpecDriveIdeExecutionDetail = SpecDriveIdeQueueItem & {
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  rawLogs: Array<{ stdout: string; stderr: string; events: unknown[]; createdAt?: string }>;
  producedArtifacts: unknown[];
  diffSummary?: unknown;
  contractValidation?: unknown;
  outputSchema?: unknown;
  approvalRequests: unknown[];
};

export type SpecDriveIdeDiagnostic = {
  path: string;
  severity: "error" | "warning" | "info";
  message: string;
  source: "workspace" | "spec-state" | "execution";
  featureId?: string;
  executionId?: string;
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
