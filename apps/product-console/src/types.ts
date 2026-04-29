export type CommandAction =
  | "create_project"
  | "delete_project"
  | "create_feature"
  | "scan_prd_source"
  | "upload_prd_source"
  | "generate_ears"
  | "generate_hld"
  | "split_feature_specs"
  | "terminate_subagent"
  | "retry_subagent"
  | "pause_runner"
  | "resume_runner"
  | "approve_review"
  | "move_board_task"
  | "schedule_board_tasks"
  | "run_board_tasks"
  | "schedule_run"
  | "write_spec_evolution";

export type CommandReceipt = {
  id: string;
  action: CommandAction;
  status: "accepted" | "blocked";
  entityType: string;
  entityId: string;
  projectId?: string;
  acceptedAt: string;
  blockedReasons?: string[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  repository: string;
  projectDirectory: string;
  defaultBranch: string;
  health: "ready" | "blocked" | "failed";
  lastActivityAt: string;
};

export type ProjectCreateMode = "import_existing" | "create_new";

export type ProjectCreateForm = {
  mode: ProjectCreateMode;
  name: string;
  goal: string;
  projectType: string;
  techPreferences: string;
  existingProjectPath: string;
  workspaceSlug: string;
  defaultBranch: string;
  automationEnabled: boolean;
};

export type ProjectDirectoryScan = {
  targetRepoPath: string;
  name: string;
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
  runningSubagents: number;
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
    runningSubagents: number;
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

export type SpecWorkspaceModel = {
  features: Array<{ id: string; title: string; folder?: string; status: string; primaryRequirements: string[] }>;
  prdWorkflow?: {
    targetRepoPath?: string;
    sourcePath: string;
    resolvedSourcePath?: string;
    sourceName?: string;
    sourceVersion?: string;
    scanMode?: string;
    lastScanAt?: string;
    runtime?: string;
    blockedReasons: string[];
    phases: Array<{
      key: "project_initialization" | "requirement_intake";
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

export type SkillCenterModel = {
  skills: Array<{
    slug: string;
    name: string;
    version: string;
    enabled: boolean;
    phase: string;
    riskLevel: string;
    schema: { input: unknown; output: unknown };
    recentRuns: Array<{ id: string; status: string; createdAt: string }>;
    successRate: number;
  }>;
};

export type SubagentModel = {
  runs: Array<{
    id: string;
    featureId?: string;
    taskId?: string;
    status: string;
    runContract?: unknown;
    contextSlice?: unknown;
    evidence: Array<{ id: string; summary: string; path?: string }>;
    tokenUsage?: unknown;
  }>;
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
  recentTriggers?: Array<{
    id: string;
    action: string;
    target: string;
    result: string;
    createdAt: string;
  }>;
  factSources?: string[];
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

export type RunnerScheduleTask = {
  id: string;
  featureId?: string;
  featureTitle?: string;
  title: string;
  status: string;
  risk: string;
  dependencies: Array<{ id: string; status: string; satisfied: boolean }>;
  approvalStatus: "approved" | "pending" | "not_required";
  runnerId?: string;
  runId?: string;
  action: "schedule" | "run" | "review" | "observe";
  blockedReasons: string[];
  recentLog?: string;
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

export type ConsoleData = {
  projects: {
    currentProjectId: string;
    projects: ProjectSummary[];
  };
  overview: ProjectOverviewModel;
  dashboard: DashboardModel;
  board: BoardModel;
  spec: SpecWorkspaceModel;
  skills: SkillCenterModel;
  subagents: SubagentModel;
  runner: RunnerModel;
  reviews: ReviewModel;
};
