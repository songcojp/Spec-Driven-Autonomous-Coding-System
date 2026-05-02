export type CommandAction =
  | "create_project"
  | "delete_project"
  | "connect_git_repository"
  | "create_feature"
  | "initialize_spec_protocol"
  | "import_or_create_constitution"
  | "initialize_project_memory"
  | "scan_prd_source"
  | "upload_prd_source"
  | "generate_ears"
  | "generate_hld"
  | "split_feature_specs"
  | "push_feature_spec_pool"
  | "pause_runner"
  | "resume_runner"
  | "approve_review"
  | "move_board_task"
  | "schedule_board_tasks"
  | "run_board_tasks"
  | "schedule_run"
  | "validate_cli_adapter_config"
  | "save_cli_adapter_config"
  | "activate_cli_adapter_config"
  | "disable_cli_adapter_config"
  | "generate_ui_spec"
  | "write_spec_evolution";

export type CommandReceipt = {
  id: string;
  action: CommandAction;
  status: "accepted" | "blocked";
  entityType: string;
  entityId: string;
  projectId?: string;
  acceptedAt: string;
  featureId?: string;
  schedulerJobId?: string;
  schedulerJobIds?: string[];
  executionId?: string;
  executionIds?: string[];
  runId?: string;
  runIds?: string[];
  blockedReasons?: string[];
};

export type ProjectSummary = {
  id: string;
  name?: string;
  repository: string;
  projectDirectory: string;
  defaultBranch: string;
  health: "ready" | "blocked" | "failed";
  lastActivityAt: string;
};

export type ProjectCreateMode = "import_existing" | "create_new";

export type ProjectCreateForm = {
  mode: ProjectCreateMode;
  name?: string;
  goal: string;
  projectType: string;
  techPreferences: string;
  existingProjectPath: string;
  workspaceSlug: string;
  repositoryUrl: string;
  defaultBranch: string;
  automationEnabled: boolean;
};

export type ProjectDirectoryScan = {
  targetRepoPath: string;
  name?: string;
  repository: string;
  defaultBranch: string;
  projectType: string;
  techPreferences: string[];
  isGitRepository: boolean;
  packageManager?: string;
  hasSpecProtocolDirectory: boolean;
  errors: string[];
};

export type DashboardModel = {
  projectHealth: { totalProjects: number; ready: number; blocked: number; failed: number };
  activeFeatures: Array<{ id: string; title: string; status: string; priority: number }>;
  boardCounts: Record<string, number>;
  activeRuns: number;
  todayAutomaticExecutions: number;
  failedTasks: Array<{ id: string; title: string; status: string; featureId?: string }>;
  pendingApprovals: number;
  cost: { totalUsd: number; tokensUsed: number };
  runner: { heartbeats: number; online: number; successRate: number; failureRate: number };
  recentPullRequests: Array<{ id: string; title: string; url?: string; createdAt?: string }>;
  risks: Array<{ level: string; message: string; source: string }>;
  performance: { loadMs: number; refreshMs?: number };
  factSources: string[];
};

export type ProjectOverviewModel = {
  summary: {
    totalProjects: number;
    healthyProjects: number;
    blockedProjects: number;
    failedTasks: number;
    pendingReviews: number;
    onlineRunners: number;
    totalCostUsd: number;
  };
  projects: Array<{
    id: string;
    name: string;
    health: "ready" | "blocked" | "failed";
    repository: string;
    projectDirectory: string;
    defaultBranch: string;
    activeFeature?: { id: string; title: string; status: string };
    taskCounts: Record<string, number>;
    failedTasks: number;
    pendingReviews: number;
    activeRuns: number;
    runnerSuccessRate: number;
    costUsd: number;
    latestRisk?: { level: string; message: string; source: string };
    lastActivityAt: string;
  }>;
  signals: Array<{ id: string; title: string; tone: "amber" | "red" | "blue"; message: string; updatedAt?: string }>;
  factSources: string[];
};

export type BoardTask = {
  id: string;
  featureId?: string;
  name: string;
  title: string;
  status: string;
  risk: string;
  dependencies: Array<{ id: string; status: string; satisfied: boolean }>;
  diff?: { files?: string[]; additions?: number; deletions?: number } | unknown;
  testResults?: { command?: string; passed?: boolean; total?: number } | unknown;
  approvalStatus: "approved" | "pending" | "not_required";
  recoveryHistory: Array<{ from?: string; to?: string; reason: string; evidence?: string; occurredAt: string }>;
  blockedReasons: string[];
};

export type BoardModel = {
  tasks: BoardTask[];
  commands: Array<{ action: CommandAction; entityType: string }>;
  factSources: string[];
};

export type SpecSourceItem = {
  type: "prd" | "ears" | "requirements" | "hld" | "design" | "feature_spec" | "tasks" | "readme" | string;
  label: string;
  path?: string;
  status: "found" | "missing" | "conflict" | "clarification";
  detail?: string;
};

export type SpecWorkspaceModel = {
  features: Array<{ id: string; title: string; folder?: string; status: string; primaryRequirements: string[] }>;
  prdWorkflow?: {
    targetRepoPath?: string;
    sourcePath: string;
    specSources?: SpecSourceItem[];
    resolvedSourcePath?: string;
    sourceName?: string;
    sourceVersion?: string;
    scanMode?: string;
    lastScanAt?: string;
    runtime?: string;
    blockedReasons: string[];
    phases: Array<{
      key: "project_initialization" | "requirement_intake" | "feature_execution" | "ui_spec";
      status: "pending" | "accepted" | "blocked" | "completed";
      updatedAt?: string;
      blockedReasons: string[];
      facts: Array<{ label: string; value: string }>;
      stages: Array<{
        key: string;
        action?: CommandAction;
        status: "pending" | "accepted" | "blocked" | "completed";
        updatedAt?: string;
        auditEventId?: string;
        evidencePath?: string;
        blockedReason?: string;
      }>;
    }>;
    stages: Array<{
      key: string;
      action: CommandAction;
      status: "pending" | "accepted" | "blocked" | "completed";
      updatedAt?: string;
      auditEventId?: string;
      evidencePath?: string;
    }>;
  };
  selectedFeature?: {
    id: string;
    title: string;
    requirements: Array<{ id: string; body: string; acceptanceCriteria?: string; priority?: string }>;
    taskGraph?: unknown;
    clarificationRecords: unknown[];
    qualityChecklist: Array<{ item: string; passed: boolean }>;
    technicalPlan?: unknown;
    dataModels: unknown[];
    contracts: unknown[];
    versionDiffs: unknown[];
  };
};

export type RunnerModel = {
  summary?: {
    onlineRunners: number;
    runningTasks: number;
    readyTasks: number;
    blockedTasks: number;
    successRate: number;
    failureRate: number;
  };
  lanes?: {
    ready: RunnerScheduleTask[];
    scheduled: RunnerScheduleTask[];
    running: RunnerScheduleTask[];
    blocked: RunnerScheduleTask[];
  };
  schedulerJobs?: RunnerSchedulerJob[];
  recentTriggers?: Array<{
    id: string;
    action: string;
    target: string;
    result: string;
    createdAt: string;
  }>;
  skillInvocations?: Array<{
    runId: string;
    schedulerJobId?: string;
    workspaceRoot?: string;
    skillSlug?: string;
    skillPhase?: string;
    blockedReason?: string;
    status: string;
    evidenceSummary?: string;
    updatedAt?: string;
  }>;
  factSources?: string[];
  adapterSummary?: CliAdapterSummary;
  runners: Array<{
    runnerId: string;
    online: boolean;
    codexVersion?: string;
    sandboxMode: string;
    approvalPolicy: string;
    queue: Array<{ runId: string; status: string }>;
    recentLogs: Array<{ runId: string; stdout: string; stderr: string; createdAt: string }>;
    lastHeartbeatAt?: string;
    heartbeatStale: boolean;
  }>;
};

export type RunnerSchedulerJob = {
  id: string;
  name?: string;
  bullmqJobId?: string;
  queueName: string;
  jobType: string;
  operation?: string;
  targetType: string;
  targetId?: string;
  status: string;
  attempts?: number;
  error?: string;
  updatedAt: string;
  executionId?: string;
  runId?: string;
  taskId?: string;
  featureId?: string;
  projectId?: string;
  workspaceRoot?: string;
  context?: Record<string, unknown>;
};

export type CliAdapterConfigModel = {
  id: string;
  displayName: string;
  schemaVersion: number;
  executable: string;
  argumentTemplate: string[];
  resumeArgumentTemplate?: string[];
  configSchema: Record<string, unknown>;
  formSchema: Record<string, unknown>;
  defaults: Record<string, unknown>;
  environmentAllowlist: string[];
  outputMapping: Record<string, unknown>;
  status: "active" | "draft" | "invalid" | "disabled";
  updatedAt: string;
};

export type CliAdapterSummary = {
  id: string;
  displayName: string;
  status: string;
  schemaVersion: number;
  executable: string;
  lastDryRunStatus?: string;
  lastDryRunAt?: string;
  lastDryRunErrors: string[];
  settingsPath: string;
};

export type SystemSettingsModel = {
  cliAdapter: {
    active: CliAdapterConfigModel;
    draft?: CliAdapterConfigModel;
    validation: { valid: boolean; errors: string[]; warnings?: string[]; command?: string; args?: string[] };
    lastDryRun?: { status: string; errors: string[]; command?: string; args?: string[]; at?: string };
  };
  commands: Array<{ action: CommandAction; entityType: string }>;
  factSources: string[];
};

export type RunnerScheduleTask = {
  id: string;
  featureId?: string;
  featureTitle?: string;
  name: string;
  title: string;
  description?: string;
  status: string;
  risk: string;
  sourceRequirementIds?: string[];
  acceptanceCriteriaIds?: string[];
  allowedFiles?: string[];
  dependencies: Array<{ id: string; status: string; satisfied: boolean }>;
  approvalStatus: "approved" | "pending" | "not_required";
  runnerId?: string;
  runId?: string;
  action: "schedule" | "run" | "review" | "observe";
  blockedReasons: string[];
  recentLog?: string;
  evidenceSummary?: string;
  lastUpdatedAt?: string;
};

export type ReviewModel = {
  items: Array<{
    id: string;
    featureId?: string;
    taskId?: string;
    status: string;
    severity: string;
    body: string;
    evidence: Array<{ id: string; summary: string; path?: string }>;
    approvals: Array<{ id: string; decision: string; actor: string; reason: string; decidedAt: string }>;
    diff?: unknown;
    testResults?: unknown;
    createdAt: string;
  }>;
  riskFilters: string[];
};

export type AuditModel = {
  summary: {
    totalEvents: number;
    acceptedCommands: number;
    blockedCommands: number;
    stateTransitions: number;
    evidenceCount: number;
    pendingApprovals: number;
  };
  timeline: Array<{
    id: string;
    occurredAt: string;
    status: "accepted" | "blocked" | "transition" | "evidence" | "approval" | "recorded";
    eventType: string;
    action: string;
    entityType: string;
    entityId: string;
    reason: string;
    requestedBy?: string;
    runId?: string;
    jobId?: string;
    featureId?: string;
    taskId?: string;
    evidenceId?: string;
    reviewId?: string;
    blockedReasons: string[];
    payload?: Record<string, unknown>;
  }>;
  selectedEvent?: AuditModel["timeline"][number] & {
    previousStatus?: string;
    currentStatus?: string;
    environment?: string;
  };
  linkedEvidence: Array<{ id: string; kind: string; summary: string; path?: string; runId?: string; createdAt: string }>;
  approvals: Array<{ id: string; reviewItemId: string; actor: string; decision: string; reason: string; decidedAt: string }>;
  filters: {
    eventTypes: string[];
    entityTypes: string[];
    statuses: string[];
  };
  factSources: string[];
};

export type ConsoleData = {
  projects: {
    currentProjectId: string;
    projects: ProjectSummary[];
  };
  overview: ProjectOverviewModel;
  dashboard: DashboardModel;
  board: BoardModel;
  spec: SpecWorkspaceModel;
  runner: RunnerModel;
  settings: SystemSettingsModel;
  reviews: ReviewModel;
  audit: AuditModel;
};

export type ChatIntentType =
  | "query_status"
  | "query_review"
  | "add_requirement"
  | "change_requirement"
  | "schedule_run"
  | "pause_runner"
  | "resume_runner"
  | "approve_review"
  | "reject_review"
  | "generate_ears"
  | "generate_hld"
  | "confirm"
  | "cancel"
  | "help"
  | "unknown";

export type ChatSession = {
  id: string;
  projectId?: string;
  title?: string;
  pendingCommandJson?: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  intentType?: ChatIntentType;
  commandAction?: string;
  commandStatus?: string;
  commandReceiptJson?: string;
  createdAt: string;
};

export type ChatAssistantResponse = {
  messageId: string;
  state: "answered" | "pending_confirmation" | "executed" | "cancelled" | "error";
  text: string;
  intent?: ChatIntentType;
  preview?: {
    action: string;
    entityType: string;
    entityId: string;
    payloadSummary: string;
  };
  receipt?: {
    action: string;
    status: string;
    runId?: string;
    schedulerJobId?: string;
    blockedReasons?: string[];
  };
};
