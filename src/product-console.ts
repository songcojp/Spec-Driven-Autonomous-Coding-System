import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { recordAuditEvent, recordMetricSample } from "./persistence.ts";
import { runSqlite } from "./sqlite.ts";
import {
  createFeatureSpec,
  extractVersion,
  mergeFileSpecState,
  projectSpecArtifact,
  readFileSpecState,
  scanSpecSources,
  specStateRelativePath,
  writeFileSpecState,
  type FeatureSpec,
  type FileSpecState,
  type SpecSourceScanSummary,
} from "./spec-protocol.ts";
import {
  createScheduleTrigger,
  persistScheduleTrigger,
  persistStateTransition,
  transitionTask,
  type BoardColumn,
  type FeatureLifecycleStatus,
  type RiskLevel,
  type ScheduleTriggerMode,
} from "./orchestration.ts";
import {
  DEFAULT_CLI_ADAPTER_CONFIG,
  GEMINI_CLI_ADAPTER_CONFIG,
  dryRunCliAdapterConfig,
  normalizeCliAdapterConfig,
  validateCliAdapterConfig,
  type CliAdapterConfig,
  type CliAdapterValidationResult,
  type RunnerApprovalPolicy,
  type RunnerQueueStatus,
  type RunnerSandboxMode,
  type TokenCostRate,
} from "./cli-adapter.ts";
import {
  createUnavailableScheduler,
  type SchedulerClient,
} from "./scheduler.ts";
import { DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG } from "./codex-rpc-adapter.ts";
import { DEFAULT_GEMINI_ACP_ADAPTER_CONFIG, type GeminiAcpAdapterConfig } from "./gemini-rpc-adapter.ts";
import { dryRunRpcAdapterConfig, type RpcAdapterConfig, type RpcAdapterValidationResult } from "./rpc-adapter.ts";
import { assertApprovalPresentForTerminalStatus, listReviewCenterItems, recordApprovalDecision, type RecordApprovalInput, type ReviewDecision, type ReviewTrigger } from "./review-center.ts";
import {
  connectProjectRepository,
  createDefaultProjectConstitution,
  getCurrentProjectConstitution,
  getProject,
  initializeProjectPhase1,
  initializeProjectMemoryForProject,
  initializeProjectSpecProtocol,
  runProjectHealthCheck,
  saveProjectConstitution,
} from "./projects.ts";

export type ConsoleCommandAction =
  | "create_feature"
  | "register_project"
  | "connect_git_repository"
  | "initialize_spec_protocol"
  | "import_or_create_constitution"
  | "initialize_project_memory"
  | "check_project_health"
  | "scan_spec_sources"
  | "scan_prd_source"
  | "upload_prd_source"
  | "intake_requirement"
  | "resolve_clarification"
  | "generate_ears"
  | "generate_hld"
  | "generate_ui_spec"
  | "split_feature_specs"
  | "start_auto_run"
  | "pause_runner"
  | "resume_runner"
  | "mark_feature_complete"
  | "approve_review"
  | "reject_review"
  | "request_review_changes"
  | "rollback_review"
  | "split_review_task"
  | "update_spec"
  | "mark_review_complete"
  | "schedule_run"
  | "validate_cli_adapter_config"
  | "save_cli_adapter_config"
  | "activate_cli_adapter_config"
  | "disable_cli_adapter_config"
  | "validate_rpc_adapter_config"
  | "save_rpc_adapter_config"
  | "activate_rpc_adapter_config"
  | "disable_rpc_adapter_config"
  | "save_project_execution_preference"
  | "write_project_rule"
  | "write_spec_evolution"
  | "move_board_task"
  | "schedule_board_tasks"
  | "run_board_tasks";

const CONSOLE_COMMAND_ACTIONS = new Set<ConsoleCommandAction>([
  "create_feature",
  "register_project",
  "connect_git_repository",
  "initialize_spec_protocol",
  "import_or_create_constitution",
  "initialize_project_memory",
  "check_project_health",
  "scan_spec_sources",
  "scan_prd_source",
  "upload_prd_source",
  "intake_requirement",
  "resolve_clarification",
  "generate_ears",
  "generate_hld",
  "generate_ui_spec",
  "split_feature_specs",
  "start_auto_run",
  "pause_runner",
  "resume_runner",
  "mark_feature_complete",
  "approve_review",
  "reject_review",
  "request_review_changes",
  "rollback_review",
  "split_review_task",
  "update_spec",
  "mark_review_complete",
  "schedule_run",
  "validate_cli_adapter_config",
  "save_cli_adapter_config",
  "activate_cli_adapter_config",
  "disable_cli_adapter_config",
  "validate_rpc_adapter_config",
  "save_rpc_adapter_config",
  "activate_rpc_adapter_config",
  "disable_rpc_adapter_config",
  "save_project_execution_preference",
  "write_project_rule",
  "write_spec_evolution",
  "move_board_task",
  "schedule_board_tasks",
  "run_board_tasks",
]);

export type ConsoleCommandStatus = "accepted" | "blocked";

export type ConsoleCommandInput = {
  action: ConsoleCommandAction;
  entityType: "project" | "feature" | "task" | "run" | "runner" | "review_item" | "rule" | "spec" | "cli_adapter" | "rpc_adapter" | "settings";
  entityId: string;
  requestedBy: string;
  reason: string;
  payload?: Record<string, unknown>;
  now?: Date;
};

export type ConsoleCommandReceipt = {
  id: string;
  action: ConsoleCommandAction;
  status: ConsoleCommandStatus;
  entityType: ConsoleCommandInput["entityType"];
  entityId: string;
  auditEventId: string;
  acceptedAt: string;
  approvalRecordId?: string;
  featureId?: string;
  scheduleTriggerId?: string;
  schedulerJobId?: string;
  schedulerJobIds?: string[];
  executionId?: string;
  executionIds?: string[];
  runId?: string;
  runIds?: string[];
  selectionDecisionId?: string;
  blockedReasons?: string[];
};

export type ExecutionRunMode = "cli" | "rpc";

export type ExecutionPreferenceV1 = {
  runMode: ExecutionRunMode;
  adapterId: string;
  source: "job" | "project" | "default";
};

export type DashboardQueryOptions = {
  projectId?: string;
  now?: Date;
  refresh?: boolean;
};

export type DashboardQueryModel = {
  projectHealth: {
    totalProjects: number;
    ready: number;
    blocked: number;
    failed: number;
  };
  activeFeatures: Array<{ id: string; title: string; status: string; priority: number }>;
  boardCounts: Record<BoardColumn | "unknown", number>;
  activeRuns: number;
  todayAutomaticExecutions: number;
  failedTasks: Array<{ id: string; title: string; status: string; featureId?: string }>;
  pendingApprovals: number;
  cost: {
    totalUsd: number;
    tokensUsed: number;
  };
  runner: {
    heartbeats: number;
    online: number;
    successRate: number;
    failureRate: number;
  };
  recentPullRequests: Array<{ id: string; title: string; url?: string; createdAt?: string }>;
  risks: Array<{ level: RiskLevel | "unknown"; message: string; source: string }>;
  performance: {
    loadMs: number;
    refreshMs?: number;
  };
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
    taskCounts: Record<BoardColumn | "unknown", number>;
    failedTasks: number;
    pendingReviews: number;
    activeRuns: number;
    runnerSuccessRate: number;
    costUsd: number;
    latestRisk?: { level: RiskLevel | "unknown"; message: string; source: string };
    lastActivityAt: string;
  }>;
  signals: Array<{ id: string; title: string; tone: "amber" | "red" | "blue"; message: string; updatedAt?: string }>;
  factSources: string[];
};

export type DashboardBoardViewModel = {
  tasks: Array<{
    id: string;
    featureId?: string;
    name: string;
    title: string;
    status: BoardColumn | "unknown";
    risk: RiskLevel | "unknown";
    dependencies: Array<{ id: string; status: BoardColumn | "unknown"; satisfied: boolean }>;
    diff?: unknown;
    testResults?: unknown;
    approvalStatus: "approved" | "pending" | "not_required";
    recoveryHistory: Array<{ from?: string; to?: string; reason: string; evidence?: string; occurredAt: string }>;
    blockedReasons: string[];
  }>;
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
  factSources: string[];
};

const pendingReviewStatuses = new Set(["pending", "review_needed", "changes_requested", "rejected"]);

export type SpecWorkspaceViewModel = {
  features: Array<{
    id: string;
    title: string;
    folder?: string;
    status: string;
    primaryRequirements: string[];
  }>;
  prdWorkflow: {
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
      key: "project_initialization" | "requirement_intake" | "feature_execution" | "ui_spec";
      status: "pending" | "accepted" | "blocked" | "completed";
      updatedAt?: string;
      blockedReasons: string[];
      facts: Array<{ label: string; value: string }>;
      stages: Array<{
        key: string;
        action?: ConsoleCommandAction;
        status: "pending" | "accepted" | "blocked" | "completed";
        updatedAt?: string;
        auditEventId?: string;
        resultPath?: string;
        blockedReason?: string;
      }>;
    }>;
    stages: Array<{
      key: string;
      action: ConsoleCommandAction;
      status: "pending" | "accepted" | "blocked" | "completed";
      updatedAt?: string;
      auditEventId?: string;
      resultPath?: string;
    }>;
  };
  selectedFeature?: {
    id: string;
    title: string;
    requirements: Array<{ id: string; body: string; acceptanceCriteria?: string; priority?: string }>;
    taskGraph?: unknown;
    documents: FeatureSpecDocumentsViewModel;
    clarificationRecords: unknown[];
    qualityChecklist: Array<{ item: string; passed: boolean }>;
    technicalPlan?: unknown;
    dataModels: unknown[];
    contracts: unknown[];
    versionDiffs: unknown[];
    skillOutput?: SkillOutputViewModel;
  };
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
};

export type FeatureSpecDocumentsViewModel = {
  requirements?: FeatureSpecDocumentViewModel;
  design?: FeatureSpecDocumentViewModel;
  tasks?: FeatureSpecDocumentViewModel;
  specState?: FeatureSpecDocumentViewModel;
};

export type FeatureSpecDocumentViewModel = {
  path: string;
  exists: boolean;
  title?: string;
  sections: Array<{ heading: string; level: number; body: string }>;
  raw?: string;
  error?: string;
};

export type SkillOutputViewModel = {
  parseStatus: "found" | "missing" | "invalid";
  stdoutLogPath?: string;
  error?: string;
  status?: string;
  summary?: string;
  nextAction?: string;
  tokenUsage?: unknown;
  tokenConsumption?: TokenConsumptionViewModel;
  inputContract?: unknown;
  producedArtifacts: unknown[];
  traceability?: unknown;
  result?: unknown;
  recordCount?: number;
};

export type TokenConsumptionViewModel = {
  runId: string;
  model?: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUsd: number;
  currency: string;
  pricingStatus: string;
  sourcePath: string;
  recordedAt: string;
};

type SpecWorkspaceFeatureListItem = SpecWorkspaceViewModel["features"][number];
type FeaturePoolQueuePlanEntry = {
  id: string;
  priority: number;
  dependencies: string[];
};

type FeaturePoolSelectionInput = {
  dbPath: string;
  entries: FeaturePoolQueuePlanEntry[];
  projectId: string;
  projectPath: string;
  docsById: Map<string, SpecWorkspaceFeatureListItem>;
  resumeFeatureId?: string;
  skipFeatureIds: string[];
  payload?: Record<string, unknown>;
  now: Date;
};

type FeaturePoolSelectionResult = {
  selected?: FeaturePoolQueuePlanEntry;
  blockedReasons: string[];
  decision?: FeatureSelectionDecision;
};

type FeatureSelectionDecision = {
  decision: "selected" | "none" | "blocked";
  featureId?: string;
  reason: string;
  blockedReasons: string[];
  dependencyFindings: string[];
  resumeRequiredFeatures: string[];
  skippedFeatures: string[];
  source: "feature-selection-skill" | "deterministic-fallback";
};

function listFeatureSpecsFromDocs(
  projectPath: string,
  dbFeatures: SpecWorkspaceFeatureListItem[] = [],
): SpecWorkspaceFeatureListItem[] {
  const featuresDir = join(projectPath, "docs", "features");
  if (!existsSync(featuresDir)) return [];

  const dbById = new Map(dbFeatures.map((feature) => [feature.id, feature]));
  return readdirSync(featuresDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^feat-\d+/i.test(entry.name))
    .map((entry) => {
      const folder = entry.name;
      const id = featureIdFromFolder(folder);
      const requirementsPath = join(featuresDir, folder, "requirements.md");
      const requirementsContent = existsSync(requirementsPath) ? readFileSync(requirementsPath, "utf8") : "";
      const dbFeature = dbById.get(id);
      const statePath = join(projectPath, specStateRelativePath(folder));
      const fileState = existsSync(statePath) ? readFileSpecState(projectPath, folder, id) : undefined;
      return {
        id,
        title: featureTitleFromRequirements(requirementsContent, id, folder) ?? dbFeature?.title ?? humanizeFeatureFolder(folder),
        folder,
        status: fileState?.status ?? resolveFeatureStatusFromDocsAndRuntime(projectPath, folder, dbFeature?.status),
        primaryRequirements: dbFeature?.primaryRequirements?.length
          ? dbFeature.primaryRequirements
          : requirementIdsFromText(requirementsContent),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
}

function readFeatureSpecDocuments(projectPath: string, folder: string): FeatureSpecDocumentsViewModel {
  const safeFolder = basename(folder);
  return {
    requirements: readFeatureSpecDocument(projectPath, safeFolder, "requirements.md"),
    design: readFeatureSpecDocument(projectPath, safeFolder, "design.md"),
    tasks: readFeatureSpecDocument(projectPath, safeFolder, "tasks.md"),
    specState: readFeatureSpecDocument(projectPath, safeFolder, "spec-state.json"),
  };
}

function readFeatureSpecDocument(projectPath: string, folder: string, filename: string): FeatureSpecDocumentViewModel {
  const path = `docs/features/${folder}/${filename}`;
  const fullPath = join(projectPath, "docs", "features", folder, filename);
  if (!existsSync(fullPath)) {
    return { path, exists: false, sections: [] };
  }

  try {
    const raw = readFileSync(fullPath, "utf8");
    const sections = parseMarkdownSections(raw);
    return {
      path,
      exists: true,
      title: sections[0]?.level === 1 ? sections[0].heading : undefined,
      sections,
      raw,
    };
  } catch (error) {
    return {
      path,
      exists: false,
      sections: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseMarkdownSections(markdown: string): FeatureSpecDocumentViewModel["sections"] {
  const sections: FeatureSpecDocumentViewModel["sections"] = [];
  let current: { heading: string; level: number; bodyLines: string[] } | undefined;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current) {
        sections.push({
          heading: current.heading,
          level: current.level,
          body: current.bodyLines.join("\n").trim(),
        });
      }
      current = { heading: heading[2].trim(), level: heading[1].length, bodyLines: [] };
      continue;
    }
    if (!current && line.trim()) {
      current = { heading: "Overview", level: 1, bodyLines: [] };
    }
    current?.bodyLines.push(line);
  }

  if (current) {
    sections.push({
      heading: current.heading,
      level: current.level,
      body: current.bodyLines.join("\n").trim(),
    });
  }

  return sections;
}

function featureIdFromFolder(folder: string): string {
  const match = folder.match(/^feat-(\d+)/i);
  return match ? `FEAT-${match[1]}` : folder.toUpperCase();
}

function featureTitleFromRequirements(content: string, id: string, folder: string): string | undefined {
  const firstHeading = content.split(/\r?\n/).find((line) => line.trim().startsWith("#"));
  if (!firstHeading) return undefined;
  const title = firstHeading
    .replace(/^#+\s*/, "")
    .replace(/^Feature Spec:\s*/i, "")
    .replace(new RegExp(`^${id}\\s*[-:]?\\s*`, "i"), "")
    .trim();
  return title || humanizeFeatureFolder(folder);
}

function humanizeFeatureFolder(folder: string): string {
  return folder
    .replace(/^feat-\d+-?/i, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || folder;
}

function requirementIdsFromText(content: string): string[] {
  return [...new Set(content.match(/\b(?:REQ|NFR|EDGE)(?:-[A-Z0-9]+)+\b/g) ?? [])].slice(0, 8);
}

function featureStatusFromDocs(projectPath: string, folder: string): string {
  const featureDir = join(projectPath, "docs", "features", folder);
  if (existsSync(join(featureDir, "tasks.md"))) return "ready";
  if (existsSync(join(featureDir, "design.md"))) return "planning";
  return "draft";
}

function resolveFeatureStatusFromDocsAndRuntime(
  projectPath: string,
  folder: string,
  dbStatus?: string,
): string {
  const docsStatus = featureStatusFromDocs(projectPath, folder);
  if (!dbStatus) return docsStatus;
  if (dbStatus === "draft" && docsStatus !== "draft") return docsStatus;
  if (dbStatus === "planning" && docsStatus === "ready") return docsStatus;
  return dbStatus;
}

function normalizeFeaturePoolPriority(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  const label = String(value).trim().toUpperCase();
  const numeric = Number(label);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const pLevel = label.match(/^P(\d+)$/);
  if (pLevel) {
    return 1000 - Number(pLevel[1]);
  }

  const namedPriorities: Record<string, number> = {
    CRITICAL: 900,
    HIGH: 800,
    MUST: 800,
    MVP: 700,
    MEDIUM: 500,
    SHOULD: 500,
    LOW: 200,
    COULD: 200,
    WONT: 0,
  };
  return namedPriorities[label] ?? Number.NaN;
}

function readFeaturePoolQueuePlan(projectPath: string): { path: string; entries: FeaturePoolQueuePlanEntry[]; blockedReasons: string[] } {
  const relativePath = "docs/features/feature-pool-queue.json";
  const fullPath = join(projectPath, relativePath);
  if (!existsSync(fullPath)) {
    return {
      path: relativePath,
      entries: [],
      blockedReasons: [`Feature Pool Queue plan is required before autonomous Feature scheduling: ${relativePath}`],
    };
  }

  try {
    const parsed = parseJsonObject(readFileSync(fullPath, "utf8"));
    const rawEntries = arrayValue(parsed.features).length > 0 ? arrayValue(parsed.features) : arrayValue(parsed.queue);
    const entries = rawEntries.map((entry, index) => {
      const record = parseJsonObject(entry);
      const id = optionalString(record.id)?.toUpperCase() ?? "";
      return {
        id,
        priority: normalizeFeaturePoolPriority(record.priority, rawEntries.length - index),
        dependencies: optionalStringArray(record.dependencies).map((dependency) => dependency.toUpperCase()),
      };
    });
    const blockedReasons = entries.flatMap((entry, index) => {
      const reasons: string[] = [];
      if (!/^FEAT-[A-Z0-9-]+$/.test(entry.id)) reasons.push(`Queue plan entry ${index + 1} is missing a valid FEAT-* id.`);
      if (!Number.isFinite(entry.priority)) reasons.push(`Queue plan entry ${entry.id || index + 1} has an invalid priority.`);
      return reasons;
    });
    if (entries.length === 0) {
      blockedReasons.push(`Feature Pool Queue plan has no features: ${relativePath}`);
    }
    return { path: relativePath, entries, blockedReasons };
  } catch (error) {
    return {
      path: relativePath,
      entries: [],
      blockedReasons: [`Feature Pool Queue plan is invalid: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function selectFeaturePoolQueueEntry(input: FeaturePoolSelectionInput): FeaturePoolSelectionResult {
  const active = activeFeatureExecution(input.dbPath, input.projectId);
  if (active) {
    const reason = `Project already has an active feature_execution (${active.executionId}); autonomous selection is single-project serial.`;
    return {
      blockedReasons: [reason],
      decision: {
        decision: "blocked",
        reason,
        blockedReasons: [reason],
        dependencyFindings: [],
        resumeRequiredFeatures: [],
        skippedFeatures: input.skipFeatureIds,
        source: "deterministic-fallback",
      },
    };
  }
  const externalDecision = featureSelectionDecisionFromPayload(input.payload ?? {});
  if (externalDecision) {
    return validateFeatureSelectionDecision(input, externalDecision);
  }
  return deterministicFeaturePoolSelection(input);
}

function activeFeatureExecution(dbPath: string, projectId: string): { executionId: string; status: string } | undefined {
  const rows = runSqlite(dbPath, [], [
    {
      name: "active",
      sql: `SELECT id, status FROM execution_records
        WHERE project_id = ?
          AND operation = 'feature_execution'
          AND status IN ('queued', 'running', 'approval_needed')
        ORDER BY updated_at DESC
        LIMIT 1`,
      params: [projectId],
    },
  ]).queries.active;
  const row = rows[0];
  return row ? { executionId: String(row.id), status: String(row.status) } : undefined;
}

function deterministicFeaturePoolSelection(input: FeaturePoolSelectionInput): FeaturePoolSelectionResult {
  const completed = new Set(runSqlite(input.dbPath, [], [
    {
      name: "features",
      sql: "SELECT id FROM features WHERE project_id = ? AND status IN ('done', 'delivered')",
      params: [input.projectId],
    },
  ]).queries.features.map((row) => String(row.id)));
  for (const entry of input.entries) {
    const feature = input.docsById.get(entry.id);
    const state = feature?.folder ? readFileSpecState(input.projectPath, feature.folder, entry.id, input.now) : undefined;
    if (state?.status === "completed" || state?.status === "delivered") {
      completed.add(entry.id);
    }
  }

  const blockedReasons: string[] = [];
  for (const entry of [...input.entries].sort((left, right) => right.priority - left.priority)) {
    const feature = input.docsById.get(entry.id);
    if (!feature?.folder) {
      blockedReasons.push(`${entry.id} is not available as a Feature Spec directory.`);
      continue;
    }
    const state = readFileSpecState(input.projectPath, feature.folder, entry.id, input.now);
    if (input.skipFeatureIds.includes(entry.id)) {
      writeFileSpecState(input.projectPath, feature.folder, mergeFileSpecState(state, {
        status: "skipped",
        executionStatus: "skipped",
        blockedReasons: [],
        nextAction: "Skipped by operator; scheduler can select the next ready Feature.",
      }, {
        now: input.now,
        source: "scheduler",
        summary: "Feature skipped by operator.",
      }));
      completed.add(entry.id);
      continue;
    }
    if (completed.has(entry.id)) continue;

    const dependencyMissing = entry.dependencies.filter((dependency) => !completed.has(dependency));
    if (dependencyMissing.length > 0) {
      const reason = `${entry.id} is blocked by incomplete dependencies: ${dependencyMissing.join(", ")}.`;
      blockedReasons.push(reason);
      writeFileSpecState(input.projectPath, feature.folder, mergeFileSpecState(state, {
        status: "blocked",
        executionStatus: "blocked",
        dependencies: entry.dependencies,
        blockedReasons: [reason],
        nextAction: "Wait for dependency completion or skip to the next Feature.",
      }, { now: input.now, source: "scheduler", summary: reason }));
      continue;
    }

    const readiness = validateFeatureSpecDirectory(input.projectPath, `docs/features/${feature.folder}`);
    if (readiness.length > 0) {
      const reason = `${entry.id} cannot run: ${readiness.join(" ")}`;
      blockedReasons.push(reason);
      writeFileSpecState(input.projectPath, feature.folder, mergeFileSpecState(state, {
        status: "blocked",
        executionStatus: "blocked",
        dependencies: entry.dependencies,
        blockedReasons: [reason],
        nextAction: "Complete the Feature Spec documents, then resume this Feature.",
      }, { now: input.now, source: "scheduler", summary: reason }));
      continue;
    }

    if (["blocked", "failed", "review_needed"].includes(state.status) && input.resumeFeatureId !== entry.id) {
      const reason = `${entry.id} is ${state.status} and requires resume before it can run.`;
      blockedReasons.push(reason);
      continue;
    }
    if (state.status !== "ready" && input.resumeFeatureId !== entry.id) {
      const reason = `${entry.id} is ${state.status}; scheduler only runs ready or explicitly resumed Features.`;
      blockedReasons.push(reason);
      continue;
    }
    return {
      selected: entry,
      blockedReasons,
      decision: {
        decision: "selected",
        featureId: entry.id,
        reason: `${entry.id} is the highest-priority runnable Feature after deterministic safety checks.`,
        blockedReasons,
        dependencyFindings: entry.dependencies.map((dependency) => `${dependency}:completed`),
        resumeRequiredFeatures: [],
        skippedFeatures: input.skipFeatureIds,
        source: "deterministic-fallback",
      },
    };
  }
  return {
    blockedReasons,
    decision: {
      decision: blockedReasons.length > 0 ? "blocked" : "none",
      reason: blockedReasons.length > 0 ? "No Feature passed scheduler safety checks." : "No Feature entries were available for selection.",
      blockedReasons,
      dependencyFindings: [],
      resumeRequiredFeatures: [],
      skippedFeatures: input.skipFeatureIds,
      source: "deterministic-fallback",
    },
  };
}

function featureSelectionDecisionFromPayload(payload: Record<string, unknown>): FeatureSelectionDecision | undefined {
  const candidate = parseJsonObject(payload.featureSelectionResult ?? payload.selectionResult);
  const result = isRecord(candidate.result) ? parseJsonObject(candidate.result) : candidate;
  const decision = optionalString(result.decision);
  if (decision !== "selected" && decision !== "none" && decision !== "blocked") return undefined;
  return {
    decision,
    featureId: optionalString(result.featureId)?.toUpperCase(),
    reason: optionalString(result.reason) ?? "Feature selection skill returned a decision.",
    blockedReasons: optionalStringArray(result.blockedReasons),
    dependencyFindings: optionalStringArray(result.dependencyFindings),
    resumeRequiredFeatures: optionalStringArray(result.resumeRequiredFeatures).map((id) => id.toUpperCase()),
    skippedFeatures: optionalStringArray(result.skippedFeatures).map((id) => id.toUpperCase()),
    source: "feature-selection-skill",
  };
}

function validateFeatureSelectionDecision(input: FeaturePoolSelectionInput, decision: FeatureSelectionDecision): FeaturePoolSelectionResult {
  if (decision.decision !== "selected") {
    return { blockedReasons: decision.blockedReasons.length > 0 ? decision.blockedReasons : [decision.reason], decision };
  }
  const featureId = decision.featureId;
  const entry = input.entries.find((candidate) => candidate.id === featureId);
  if (!featureId || !entry) {
    return { blockedReasons: [`Feature selection skill returned an unknown Feature: ${featureId ?? "none"}.`], decision };
  }
  const feature = input.docsById.get(entry.id);
  if (!feature?.folder) {
    return { blockedReasons: [`Feature selection skill selected ${entry.id}, but it is not available as a Feature Spec directory.`], decision };
  }
  const completed = completedFeatureIds(input);
  const dependencyMissing = entry.dependencies.filter((dependency) => !completed.has(dependency));
  const state = readFileSpecState(input.projectPath, feature.folder, entry.id, input.now);
  const readiness = validateFeatureSpecDirectory(input.projectPath, `docs/features/${feature.folder}`);
  const blockedReasons = [
    ...dependencyMissing.map((dependency) => `${entry.id} is blocked by incomplete dependency: ${dependency}.`),
    ...readiness.map((reason) => `${entry.id} cannot run: ${reason}`),
  ];
  if (["blocked", "failed", "review_needed", "approval_needed"].includes(state.status) && input.resumeFeatureId !== entry.id) {
    blockedReasons.push(`${entry.id} is ${state.status} and requires resume before it can run.`);
  } else if (state.status !== "ready" && input.resumeFeatureId !== entry.id) {
    blockedReasons.push(`${entry.id} is ${state.status}; scheduler only runs ready or explicitly resumed Features.`);
  }
  if (blockedReasons.length > 0) {
    writeFileSpecState(input.projectPath, feature.folder, mergeFileSpecState(state, {
      status: "blocked",
      executionStatus: "blocked",
      dependencies: entry.dependencies,
      blockedReasons,
      nextAction: "Feature selection skill chose this Feature, but code safety checks blocked execution.",
    }, { now: input.now, source: "feature-selection-skill", summary: blockedReasons.join(" ") }));
    return { blockedReasons, decision };
  }
  return { selected: entry, blockedReasons: [], decision };
}

function completedFeatureIds(input: FeaturePoolSelectionInput): Set<string> {
  const completed = new Set(runSqlite(input.dbPath, [], [
    {
      name: "features",
      sql: "SELECT id FROM features WHERE project_id = ? AND status IN ('done', 'delivered')",
      params: [input.projectId],
    },
  ]).queries.features.map((row) => String(row.id)));
  for (const entry of input.entries) {
    const feature = input.docsById.get(entry.id);
    const state = feature?.folder ? readFileSpecState(input.projectPath, feature.folder, entry.id, input.now) : undefined;
    if (state?.status === "completed" || state?.status === "delivered") {
      completed.add(entry.id);
    }
  }
  return completed;
}

function persistExecutionRecord(dbPath: string, input: {
  executionId: string;
  schedulerJobId?: string;
  executorType: string;
  operation: string;
  projectId?: string;
  context: Record<string, unknown>;
  status: string;
  acceptedAt: string;
  metadata?: Record<string, unknown>;
}): void {
  const metadata = input.metadata ?? {
    scheduler: "bullmq",
    executorType: input.executorType,
    operation: input.operation,
  };
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO execution_records (
        id, scheduler_job_id, executor_type, operation, project_id, context_json,
        status, started_at, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scheduler_job_id = excluded.scheduler_job_id,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`,
      params: [
        input.executionId,
        input.schedulerJobId ?? null,
        input.executorType,
        input.operation,
        input.projectId ?? null,
        JSON.stringify(input.context),
        input.status,
        input.acceptedAt,
        JSON.stringify(metadata),
        input.acceptedAt,
        input.acceptedAt,
      ],
    },
  ]);
}

export type RunnerConsoleViewModel = {
  summary: {
    onlineRunners: number;
    runningTasks: number;
    readyTasks: number;
    blockedTasks: number;
    successRate: number;
    failureRate: number;
  };
  lanes: {
    ready: RunnerScheduleTaskViewModel[];
    scheduled: RunnerScheduleTaskViewModel[];
    running: RunnerScheduleTaskViewModel[];
    blocked: RunnerScheduleTaskViewModel[];
  };
  schedulerJobs: Array<{
    id: string;
    name: string;
    bullmqJobId?: string;
    queueName: string;
    jobType: string;
    targetType: string;
    targetId?: string;
    status: string;
    error?: string;
    updatedAt: string;
    runId?: string;
    taskId?: string;
    featureId?: string;
    projectId?: string;
    workspaceRoot?: string;
    context?: Record<string, unknown>;
    skillOutput?: SkillOutputViewModel;
  }>;
  recentTriggers: Array<{
    id: string;
    action: string;
    target: string;
    result: string;
    createdAt: string;
  }>;
  skillInvocations: Array<{
    runId: string;
    schedulerJobId?: string;
    workspaceRoot?: string;
    skillSlug?: string;
    skillPhase?: string;
    blockedReason?: string;
    status: string;
    resultSummary?: string;
    output?: SkillOutputViewModel;
    updatedAt?: string;
  }>;
  factSources: string[];
  runners: Array<{
    runnerId: string;
    online: boolean;
    runnerModel?: string;
    sandboxMode: RunnerSandboxMode;
    approvalPolicy: RunnerApprovalPolicy;
    queue: Array<{ runId: string; status: RunnerQueueStatus }>;
    recentLogs: Array<{ runId: string; stdout: string; stderr: string; createdAt: string }>;
    lastHeartbeatAt?: string;
    heartbeatStale: boolean;
  }>;
  adapterSummary: CliAdapterSummary;
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
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

export type SystemSettingsViewModel = {
  projectExecutionPreference?: {
    projectId?: string;
    active: ExecutionPreferenceV1;
    cliAdapters: CliAdapterConfig[];
    rpcAdapters: RpcAdapterConfig[];
    validation: { valid: boolean; errors: string[] };
  };
  cliAdapter: {
    active: CliAdapterConfig;
    draft?: CliAdapterConfig;
    presets: CliAdapterConfig[];
    validation: CliAdapterValidationResult;
    lastDryRun?: {
      status: string;
      errors: string[];
      command?: string;
      args?: string[];
      at?: string;
    };
  };
  rpcAdapter: {
    active: RpcAdapterConfig;
    draft?: RpcAdapterConfig;
    presets: RpcAdapterConfig[];
    validation: RpcAdapterValidationResult;
    lastProbe?: {
      status: string;
      errors: string[];
      command?: string;
      args?: string[];
      at?: string;
    };
  };
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
  factSources: string[];
};

export type RunnerScheduleTaskViewModel = {
  id: string;
  featureId?: string;
  featureTitle?: string;
  name: string;
  title: string;
  description?: string;
  status: BoardColumn | "unknown";
  risk: RiskLevel | "unknown";
  sourceRequirementIds: string[];
  acceptanceCriteriaIds: string[];
  allowedFiles: string[];
  dependencies: Array<{ id: string; status: BoardColumn | "unknown"; satisfied: boolean }>;
  approvalStatus: "approved" | "pending" | "not_required";
  runnerId?: string;
  runId?: string;
  action: "schedule" | "run" | "review" | "observe";
  blockedReasons: string[];
  recentLog?: string;
  resultSummary?: string;
  lastUpdatedAt?: string;
};

export type ReviewCenterViewModel = {
  items: Array<{
    id: string;
    featureId?: string;
    taskId?: string;
    status: string;
    severity: string;
    body: string;
    evidence: Array<{ id: string; summary: string; path?: string }>;
    goal?: string;
    specRef?: string;
    runContract?: unknown;
    reviewNeededReason: string;
    triggerReasons: ReviewTrigger[];
    recommendedActions: ReviewDecision[];
    approvals: Array<{ id: string; decision: ReviewDecision; actor: string; reason: string; decidedAt: string }>;
    diff?: unknown;
    testResults?: unknown;
    riskExplanation?: string;
    createdAt: string;
  }>;
  riskFilters: string[];
  commands: Array<{ action: ConsoleCommandAction; entityType: ConsoleCommandInput["entityType"] }>;
};

export type AuditCenterViewModel = {
  summary: {
    totalEvents: number;
    acceptedCommands: number;
    blockedCommands: number;
    stateTransitions: number;
    activityCount: number;
    pendingApprovals: number;
  };
  timeline: Array<{
    id: string;
    occurredAt: string;
    status: "accepted" | "blocked" | "transition" | "approval" | "recorded";
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
    executionResultId?: string;
    reviewId?: string;
    blockedReasons: string[];
    payload?: Record<string, unknown>;
  }>;
  selectedEvent?: AuditCenterViewModel["timeline"][number] & {
    previousStatus?: string;
    currentStatus?: string;
    environment?: string;
  };
  executionResults: Array<{ id: string; kind: string; summary: string; path?: string; runId?: string; createdAt: string }>;
  approvals: Array<{ id: string; reviewItemId: string; actor: string; decision: string; reason: string; decidedAt: string }>;
  filters: {
    eventTypes: string[];
    entityTypes: string[];
    statuses: string[];
  };
  factSources: string[];
};

const BOARD_COLUMNS = new Set([
  "backlog",
  "ready",
  "scheduled",
  "running",
  "checking",
  "review_needed",
  "blocked",
  "failed",
  "done",
  "delivered",
]);

export function buildProjectOverview(dbPath: string): ProjectOverviewModel {
  ensureTokenConsumptionRecords(dbPath);
  const result = runSqlite(dbPath, [], [
    {
      name: "projects",
      sql: `SELECT p.id, p.name, p.status, p.target_repo_path, p.default_branch, p.updated_at,
          rc.remote_url, rc.local_path
        FROM projects p
        LEFT JOIN repository_connections rc ON rc.project_id = p.id
          AND rc.connected_at = (
            SELECT MAX(connected_at) FROM repository_connections latest WHERE latest.project_id = p.id
          )
        ORDER BY COALESCE(p.updated_at, p.created_at, '') DESC, p.name`,
    },
    {
      name: "features",
      sql: `SELECT id, project_id, title, status, COALESCE(priority, 0) AS priority, COALESCE(updated_at, created_at) AS activity_at
        FROM features
        ORDER BY priority DESC, COALESCE(updated_at, created_at, '') DESC`,
    },
    {
      name: "graphTasks",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, t.status, t.risk, COALESCE(t.updated_at, t.created_at) AS activity_at
        FROM task_graph_tasks t
        LEFT JOIN features f ON f.id = t.feature_id`,
    },
    {
      name: "tasks",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, t.status, 'unknown' AS risk, t.created_at AS activity_at
        FROM tasks t
        LEFT JOIN features f ON f.id = t.feature_id`,
    },
    {
      name: "runs",
      sql: `SELECT r.id,
          json_extract(r.context_json, '$.taskId') AS task_id,
          json_extract(r.context_json, '$.featureId') AS feature_id,
          COALESCE(r.project_id, f.project_id) AS project_id,
          r.status, r.started_at
        FROM execution_records r
        LEFT JOIN features f ON f.id = json_extract(r.context_json, '$.featureId')
        ORDER BY COALESCE(r.started_at, '') DESC`,
    },
    {
      name: "heartbeats",
      sql: `SELECT hb.runner_id, hb.status, hb.beat_at, r.project_id AS project_id
        FROM runner_heartbeats hb
        LEFT JOIN execution_records r ON r.id = hb.run_id
        ORDER BY hb.beat_at DESC`,
    },
    {
      name: "reviews",
      sql: `SELECT ri.id, ri.status, ri.severity, ri.body, ri.created_at,
          COALESCE(ri.project_id, f.project_id, tf.project_id, gtf.project_id, r.project_id) AS project_id
        FROM review_items ri
        LEFT JOIN features f ON f.id = ri.feature_id
        LEFT JOIN tasks t ON t.id = ri.task_id
        LEFT JOIN features tf ON tf.id = t.feature_id
        LEFT JOIN task_graph_tasks gt ON gt.id = ri.task_id
        LEFT JOIN features gtf ON gtf.id = gt.feature_id
        LEFT JOIN execution_records r ON r.id = ri.run_id
        ORDER BY ri.created_at DESC`,
    },
    { name: "metrics", sql: "SELECT metric_name, metric_value, labels_json FROM metric_samples ORDER BY sampled_at, rowid" },
    { name: "tokenConsumption", sql: "SELECT project_id, total_tokens, cost_usd FROM token_consumption_records ORDER BY recorded_at, rowid" },
  ]);

  const projectRows = result.queries.projects;
  const graphTasksByProject = groupByProject(result.queries.graphTasks);
  const fallbackTasksByProject = groupByProject(result.queries.tasks);
  const featuresByProject = groupByProject(result.queries.features);
  const runsByProject = groupByProject(result.queries.runs);
  const reviewsByProject = groupByProject(result.queries.reviews);
  const metricsByProject = groupMetricsByProject(result.queries.metrics);
  const tokenConsumptionByProject = groupByProject(result.queries.tokenConsumption);
  const latestHeartbeats = latestRunnerStatuses(result.queries.heartbeats);
  const heartbeatsByProject = groupByProject(latestHeartbeats);

  const projects = projectRows.map((project) => {
    const projectId = String(project.id);
    const featureRows = featuresByProject.get(projectId) ?? [];
    const taskRows = graphTasksByProject.get(projectId)?.length
      ? graphTasksByProject.get(projectId) ?? []
      : fallbackTasksByProject.get(projectId) ?? [];
    const reviewRows = reviewsByProject.get(projectId) ?? [];
    const runRows = runsByProject.get(projectId) ?? [];
    const metricRows = metricsByProject.get(projectId) ?? [];
    const tokenRows = tokenConsumptionByProject.get(projectId) ?? [];
    const riskRows = overviewRisks(reviewRows, runRows);
    const activeFeature = featureRows.find((row) => !["done", "delivered"].includes(String(row.status)));
    const health = normalizeProjectHealth(project.status);
    return {
      id: projectId,
      name: String(project.name),
      health,
      repository: optionalString(project.remote_url) ?? optionalString(project.target_repo_path) ?? "",
      projectDirectory: optionalString(project.local_path) ?? optionalString(project.target_repo_path) ?? "",
      defaultBranch: String(project.default_branch ?? "main"),
      activeFeature: activeFeature
        ? { id: String(activeFeature.id), title: String(activeFeature.title), status: String(activeFeature.status) }
        : undefined,
      taskCounts: buildBoardCounts(taskRows),
      failedTasks: countBy(taskRows, "status", "failed"),
      pendingReviews: reviewRows.filter((row) => pendingReviewStatuses.has(String(row.status))).length,
      activeRuns: countBy(runRows, "status", "running"),
      runnerSuccessRate: latestMetric(metricRows, "success_rate"),
      costUsd: sumColumn(tokenRows, "cost_usd"),
      latestRisk: riskRows[0],
      lastActivityAt: latestActivityAt([
        project.updated_at,
        ...featureRows.map((row) => row.activity_at),
        ...taskRows.map((row) => row.activity_at),
        ...runRows.map((row) => row.started_at),
        ...reviewRows.map((row) => row.created_at),
      ]),
    };
  });

  const pendingReviews = projects.reduce((sum, project) => sum + project.pendingReviews, 0);
  const failedTasks = projects.reduce((sum, project) => sum + project.failedTasks, 0);
  const onlineRunners = latestHeartbeats.filter((row) => String(row.status) === "online").length;
  return {
    summary: {
      totalProjects: projects.length,
      healthyProjects: projects.filter((project) => project.health === "ready").length,
      blockedProjects: projects.filter((project) => project.health === "blocked").length,
      failedTasks,
      pendingReviews,
      onlineRunners,
      totalCostUsd: projects.reduce((sum, project) => sum + project.costUsd, 0),
    },
    projects,
    signals: [
      {
        id: "pending-reviews",
        title: "pending_reviews",
        tone: "amber",
        message: `${pendingReviews} unresolved review item${pendingReviews === 1 ? "" : "s"} across ${projects.filter((project) => project.pendingReviews > 0).length} project${projects.filter((project) => project.pendingReviews > 0).length === 1 ? "" : "s"}.`,
      },
      {
        id: "blocked-tasks",
        title: "blocked_tasks",
        tone: failedTasks > 0 ? "red" : "amber",
        message: `${projects.reduce((sum, project) => sum + (project.taskCounts.blocked ?? 0), 0)} blocked and ${failedTasks} failed task${failedTasks === 1 ? "" : "s"} across active projects.`,
      },
      {
        id: "runner-health",
        title: "runner_health",
        tone: "blue",
        message: `${onlineRunners}/${latestHeartbeats.length} runner${latestHeartbeats.length === 1 ? "" : "s"} online.`,
      },
    ],
    factSources: ["projects", "features", "task_graph_tasks", "tasks", "execution_records", "runner_heartbeats", "review_items", "metric_samples", "token_consumption_records"],
  };
}

export function buildDashboardQuery(dbPath: string, options: DashboardQueryOptions = {}): DashboardQueryModel {
  ensureTokenConsumptionRecords(dbPath, options.projectId);
  const started = process.hrtime.bigint();
  const now = options.now ?? new Date();
  const todayPrefix = now.toISOString().slice(0, 10);
  const projectFilter = options.projectId ? "WHERE project_id = ?" : "";
  const projectParams = options.projectId ? [options.projectId] : [];
  const projectIdFilter = options.projectId ? "WHERE id = ?" : "";
  const featureProjectFilter = options.projectId ? "WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?)" : "";
  const runProjectFilter = options.projectId ? "WHERE run_id IN (SELECT id FROM execution_records WHERE project_id = ?)" : "";
  const statusCheckProjectFilter = options.projectId
    ? `WHERE (
        project_id = ?
        OR feature_id IN (SELECT id FROM features WHERE project_id = ?)
        OR task_id IN (SELECT id FROM tasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?))
        OR task_id IN (SELECT id FROM task_graph_tasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?))
        OR run_id IN (SELECT id FROM execution_records WHERE project_id = ?)
      )`
    : "";
  const statusCheckProjectParams = options.projectId
    ? [options.projectId, options.projectId, options.projectId, options.projectId, options.projectId]
    : [];
  const reviewProjectFilter = options.projectId
    ? `WHERE (
        project_id = ?
        OR feature_id IN (SELECT id FROM features WHERE project_id = ?)
        OR task_id IN (SELECT id FROM tasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?))
        OR task_id IN (SELECT id FROM task_graph_tasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?))
        OR run_id IN (SELECT id FROM execution_records WHERE project_id = ?)
      )`
    : "";
  const reviewParams = options.projectId ? [options.projectId, options.projectId, options.projectId, options.projectId, options.projectId] : [];
  const metricProjectFilter = options.projectId ? "WHERE labels_json LIKE ?" : "";
  const metricParams = options.projectId ? [`%"projectId":"${escapeLike(options.projectId)}"%`] : [];
  const result = runSqlite(dbPath, [], [
    { name: "projects", sql: `SELECT status FROM projects ${projectIdFilter}`, params: projectParams },
    {
      name: "features",
      sql: `SELECT id, title, status, COALESCE(priority, 0) AS priority FROM features ${projectFilter} ORDER BY priority DESC, created_at DESC`,
      params: projectParams,
    },
    {
      name: "tasks",
      sql: `SELECT id, feature_id, title, status FROM tasks ${featureProjectFilter}`,
      params: projectParams,
    },
    {
      name: "graphTasks",
      sql: `SELECT id, feature_id, title, status FROM task_graph_tasks ${featureProjectFilter}`,
      params: projectParams,
    },
    {
      name: "runs",
      sql: `SELECT id,
          json_extract(context_json, '$.taskId') AS task_id,
          json_extract(context_json, '$.featureId') AS feature_id,
          status, started_at, metadata_json
        FROM execution_records ${projectFilter} ORDER BY COALESCE(started_at, '') DESC`,
      params: projectParams,
    },
    {
      name: "heartbeats",
      sql: `SELECT runner_id, status, queue_status, beat_at FROM runner_heartbeats ${runProjectFilter} ORDER BY beat_at DESC`,
      params: projectParams,
    },
    {
      name: "metrics",
      sql: `SELECT metric_name, metric_value, unit, labels_json FROM metric_samples ${metricProjectFilter} ORDER BY sampled_at, rowid`,
      params: metricParams,
    },
    {
      name: "tokenConsumption",
      sql: `SELECT total_tokens, cost_usd FROM token_consumption_records ${projectFilter} ORDER BY recorded_at, rowid`,
      params: projectParams,
    },
    {
      name: "reviews",
      sql: `SELECT id, severity, status, body, feature_id FROM review_items ${reviewProjectFilter} ORDER BY created_at DESC`,
      params: reviewParams,
    },
    {
      name: "evidence",
      sql: `SELECT id, summary, COALESCE(NULLIF(metadata_json, '{}'), execution_result_json, '{}') AS metadata_json, created_at
        FROM status_check_results ${statusCheckProjectFilter}
        ORDER BY created_at DESC LIMIT 10`,
      params: statusCheckProjectParams,
    },
    {
      name: "pullRequests",
      sql: `SELECT id, title, url, created_at FROM pull_request_records ORDER BY created_at DESC LIMIT 5`,
    },
  ]);

  const projects = result.queries.projects;
  const tasks = result.queries.graphTasks.length > 0 ? result.queries.graphTasks : result.queries.tasks;
  const runs = result.queries.runs;
  const metrics = result.queries.metrics;
  const tokenConsumption = result.queries.tokenConsumption;
  const reviews = result.queries.reviews;
  const heartbeats = result.queries.heartbeats;
  const loadMs = elapsedMs(started);

  recordMetricSample(dbPath, {
    name: options.refresh ? "status_refresh_ms" : "dashboard_load_ms",
    value: loadMs,
    unit: "ms",
    labels: { projectId: options.projectId ?? "all", surface: "product_console" },
  });

  return {
    projectHealth: {
      totalProjects: projects.length,
      ready: countBy(projects, "status", "ready"),
      blocked: countBy(projects, "status", "blocked"),
      failed: countBy(projects, "status", "failed"),
    },
    activeFeatures: result.queries.features
      .filter((row) => !["done", "delivered"].includes(String(row.status)))
      .slice(0, 10)
      .map((row) => ({ id: String(row.id), title: String(row.title), status: String(row.status), priority: Number(row.priority) })),
    boardCounts: buildBoardCounts(tasks),
    activeRuns: countBy(runs, "status", "running"),
    todayAutomaticExecutions: runs.filter((row) => String(row.started_at ?? "").startsWith(todayPrefix) && parseJsonObject(row.metadata_json).automatic === true).length,
    failedTasks: tasks
      .filter((row) => String(row.status) === "failed")
      .map((row) => ({ id: String(row.id), title: String(row.title), status: String(row.status), featureId: optionalString(row.feature_id) })),
    pendingApprovals: reviews.filter((row) => pendingReviewStatuses.has(String(row.status))).length,
    cost: {
      totalUsd: sumColumn(tokenConsumption, "cost_usd"),
      tokensUsed: sumColumn(tokenConsumption, "total_tokens"),
    },
    runner: {
      heartbeats: heartbeats.length,
      online: latestRunnerStatuses(heartbeats).filter((row) => String(row.status) === "online").length,
      successRate: latestMetric(metrics, "success_rate"),
      failureRate: latestMetric(metrics, "failure_rate"),
    },
    recentPullRequests: extractRecentPullRequests([...result.queries.pullRequests, ...result.queries.evidence]),
    risks: extractRisks(reviews, runs),
    performance: options.refresh ? { loadMs: latestMetric(metrics, "dashboard_load_ms"), refreshMs: loadMs } : { loadMs },
    factSources: [
      "projects",
      "features",
      "tasks",
      "execution_records",
      "runner_heartbeats",
      "metric_samples",
      "token_consumption_records",
      "review_items",
      "status_check_results",
    ],
  };
}

export function buildDashboardBoardView(dbPath: string, projectId?: string): DashboardBoardViewModel {
  const graphProjectFilter = projectId ? "WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?)" : "";
  const taskProjectFilter = projectId ? "WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?)" : "";
  const params = projectId ? [projectId] : [];
  const result = runSqlite(dbPath, [], [
    {
      name: "graphTasks",
      sql: `SELECT id, feature_id, title, status, dependencies_json, risk FROM task_graph_tasks ${graphProjectFilter} ORDER BY feature_id, created_at, id`,
      params,
    },
    {
      name: "tasks",
      sql: `SELECT id, feature_id, title, status, depends_on_json AS dependencies_json, 'unknown' AS risk FROM tasks ${taskProjectFilter} ORDER BY feature_id, created_at, id`,
      params,
    },
    {
      name: "evidence",
      sql: `SELECT id, task_id, feature_id, COALESCE(kind, 'status_check') AS kind, summary, path,
          CASE WHEN length(COALESCE(NULLIF(metadata_json, '{}'), execution_result_json, '{}')) > 1048576
            THEN '{}'
            ELSE COALESCE(NULLIF(metadata_json, '{}'), execution_result_json, '{}')
          END AS metadata_json, created_at
        FROM status_check_results
        ORDER BY created_at DESC`,
    },
    {
      name: "reviews",
      sql: `SELECT id, task_id, feature_id, status, severity, body, created_at FROM review_items ORDER BY created_at DESC`,
    },
    {
      name: "approvals",
      sql: `SELECT ar.*, ri.task_id, ri.feature_id FROM approval_records ar JOIN review_items ri ON ri.id = ar.review_item_id ORDER BY COALESCE(ar.decided_at, ar.created_at) DESC`,
    },
    {
      name: "transitions",
      sql: `SELECT entity_id, from_status, to_status, reason, evidence, occurred_at FROM state_transitions WHERE entity_type = 'task' ORDER BY occurred_at DESC`,
    },
    {
      name: "recoveryAttempts",
      sql: `SELECT task_id, action, strategy, command, status, summary, execution_result_json, attempted_at FROM recovery_attempts ORDER BY attempted_at DESC`,
    },
    {
      name: "forbiddenRetries",
      sql: `SELECT task_id, failed_strategy, failed_command, reason, execution_result_id, created_at FROM forbidden_retry_records ORDER BY created_at DESC`,
    },
  ]);
  const rows = result.queries.graphTasks.length > 0 ? result.queries.graphTasks : result.queries.tasks;
  const taskById = new Map(rows.map((row) => [String(row.id), row]));

  return {
    tasks: rows.map((row) => {
      const taskId = String(row.id);
      const dependencies = parseJsonArray(row.dependencies_json).map((dependency) => {
        const id = String(dependency);
        const dependencyStatus = normalizeBoardStatus(taskById.get(id)?.status);
        return {
          id,
          status: dependencyStatus,
          satisfied: dependencyStatus === "done" || dependencyStatus === "delivered",
        };
      });
      const evidence = result.queries.evidence.filter((entry) => entry.task_id === row.id || (!entry.task_id && entry.feature_id === row.feature_id));
      const reviews = result.queries.reviews.filter((entry) => entry.task_id === row.id || (!entry.task_id && entry.feature_id === row.feature_id));
      const approvals = result.queries.approvals.filter((entry) => entry.task_id === row.id || (!entry.task_id && entry.feature_id === row.feature_id));
      const latestReviewBody = parseJsonObject(reviews[0]?.body);
      const latestEvidenceMetadata = evidence.map((entry) => parseJsonObject(entry.metadata_json)).find((entry) => Object.keys(entry).length > 0) ?? {};
      return {
        id: taskId,
        featureId: optionalString(row.feature_id),
        name: taskName(row),
        title: String(row.title),
        status: normalizeBoardStatus(row.status),
        risk: normalizeRisk(row.risk),
        dependencies,
        diff: latestReviewBody.diff ?? latestEvidenceMetadata.diff,
        testResults: latestReviewBody.testResults ?? latestEvidenceMetadata.testResults,
        approvalStatus: approvalStatusForTask(row, reviews, approvals),
        recoveryHistory: recoveryHistoryForTask(taskId, result.queries.transitions, result.queries.recoveryAttempts, result.queries.forbiddenRetries),
        blockedReasons: boardBlockedReasons(row, taskById, reviews, approvals),
      };
    }),
    commands: [
      { action: "move_board_task", entityType: "task" },
      { action: "schedule_board_tasks", entityType: "feature" },
      { action: "run_board_tasks", entityType: "feature" },
    ],
    factSources: [
      "task_graph_tasks",
      "tasks",
      "review_items",
      "approval_records",
      "status_check_results",
      "state_transitions",
    ],
  };
}

export function buildSpecWorkspaceView(dbPath: string, featureId?: string, projectId?: string): SpecWorkspaceViewModel {
  ensureTokenConsumptionRecords(dbPath, projectId);
  const eligibleFeatureWhere = "id NOT LIKE 'FEAT-INTAKE-%'";
  const featureFilter = projectId ? `WHERE project_id = ? AND ${eligibleFeatureWhere}` : `WHERE ${eligibleFeatureWhere}`;
  const featureParams = projectId ? [projectId] : [];
  const featureOrder = "datetime(COALESCE(updated_at, created_at)) DESC, datetime(created_at) DESC, id DESC";
  const selectedFeatureSql = projectId
    ? `(SELECT id FROM features WHERE project_id = ? AND ${eligibleFeatureWhere} ORDER BY ${featureOrder} LIMIT 1)`
    : `(SELECT id FROM features WHERE ${eligibleFeatureWhere} ORDER BY ${featureOrder} LIMIT 1)`;
  const selectedFeatureExpr = `COALESCE(NULLIF(?, ''), ${selectedFeatureSql})`;
  const selectedFeatureParams = projectId ? [featureId ?? "", projectId] : [featureId ?? ""];
  const result = runSqlite(dbPath, [], [
    {
      name: "projects",
      sql: `SELECT * FROM projects ${projectId ? "WHERE id = ?" : ""} ORDER BY created_at DESC LIMIT 1`,
      params: projectId ? [projectId] : [],
    },
    {
      name: "repositoryConnections",
      sql: `SELECT * FROM repository_connections ${projectId ? "WHERE project_id = ?" : ""} ORDER BY connected_at DESC LIMIT 1`,
      params: projectId ? [projectId] : [],
    },
    {
      name: "constitutions",
      sql: `SELECT * FROM project_constitutions ${projectId ? "WHERE project_id = ? AND status = 'active'" : "WHERE status = 'active'"} ORDER BY version DESC LIMIT 1`,
      params: projectId ? [projectId] : [],
    },
    {
      name: "memoryVersions",
      sql: "SELECT * FROM memory_version_records WHERE content LIKE ? ORDER BY created_at DESC LIMIT 1",
      params: projectId ? [`%${escapeLike(projectId)}%`] : ["%"],
    },
    {
      name: "healthChecks",
      sql: `SELECT * FROM project_health_checks ${projectId ? "WHERE project_id = ?" : ""} ORDER BY checked_at DESC LIMIT 1`,
      params: projectId ? [projectId] : [],
    },
    { name: "features", sql: `SELECT * FROM features ${featureFilter} ORDER BY ${featureOrder}`, params: featureParams },
    {
      name: "requirements",
      sql: `SELECT * FROM requirements WHERE feature_id = ${selectedFeatureExpr} ORDER BY created_at, id`,
      params: selectedFeatureParams,
    },
    {
      name: "taskGraphs",
      sql: `SELECT graph_json FROM task_graphs WHERE feature_id = ${selectedFeatureExpr} ORDER BY created_at DESC LIMIT 1`,
      params: selectedFeatureParams,
    },
    {
      name: "featureEvidence",
      sql: `SELECT id, COALESCE(kind, 'status_check') AS kind, summary, path, COALESCE(NULLIF(metadata_json, '{}'), execution_result_json, '{}') AS metadata_json FROM status_check_results WHERE feature_id = ${selectedFeatureExpr} ORDER BY created_at DESC`,
      params: selectedFeatureParams,
    },
    {
      name: "deliveryReports",
      sql: `SELECT id, path, summary, created_at FROM delivery_reports WHERE feature_id = ${selectedFeatureExpr} ORDER BY created_at DESC`,
      params: selectedFeatureParams,
    },
    {
      name: "featureExecutions",
      sql: `SELECT id, project_id, context_json, metadata_json, status, started_at, completed_at, updated_at
        FROM execution_records ${projectId ? "WHERE project_id = ?" : ""}
        ORDER BY COALESCE(updated_at, completed_at, started_at, '') DESC, rowid DESC
        LIMIT 50`,
      params: projectId ? [projectId] : [],
    },
    {
      name: "tokenConsumption",
      sql: `SELECT * FROM token_consumption_records ${projectId ? "WHERE project_id = ?" : ""} ORDER BY recorded_at DESC, rowid DESC`,
      params: projectId ? [projectId] : [],
    },
    {
      name: "workflowAudit",
      sql: `SELECT id, entity_type, entity_id, event_type, reason, payload_json, created_at
        FROM audit_timeline_events
        WHERE event_type IN (
          'console_command_connect_git_repository',
          'console_command_initialize_spec_protocol',
          'console_command_import_or_create_constitution',
          'console_command_initialize_project_memory',
          'console_command_scan_prd_source',
          'console_command_upload_prd_source',
          'console_command_generate_ears',
          'console_command_generate_hld',
          'console_command_generate_ui_spec',
          'console_command_split_feature_specs',
          'console_command_start_auto_run',
          'console_command_schedule_run'
        )
        AND (
          (entity_type = 'project' AND entity_id = ?)
          OR (entity_type = 'feature' AND entity_id = ?)
          OR (entity_type = 'spec' AND entity_id = ?)
        )
        ORDER BY created_at DESC, rowid DESC
        LIMIT 30`,
      params: [projectId ?? "", featureId ?? "", featureId ?? ""],
    },
  ]);
  const dbFeatures = result.queries.features.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    folder: optionalString(row.folder),
    status: String(row.status),
    primaryRequirements: parseJsonArray(row.primary_requirements_json),
  }));
  const projectPath = optionalString(result.queries.repositoryConnections[0]?.local_path)
    ?? optionalString(result.queries.projects[0]?.target_repo_path);
  const tokenConsumptionByRun = tokenConsumptionByRunId(result.queries.tokenConsumption);
  const docsFeatures = projectPath ? listFeatureSpecsFromDocs(projectPath, dbFeatures) : [];
  const features = docsFeatures.length > 0 ? docsFeatures : dbFeatures;
  const selectedFeatureId = featureId && features.some((entry) => entry.id === featureId)
    ? featureId
    : features[0]?.id;
  const feature = selectedFeatureId ? features.find((entry) => entry.id === selectedFeatureId) : undefined;
  const featureSkillOutput = selectedFeatureId
    ? latestSkillOutputForFeature(result.queries.featureExecutions, selectedFeatureId, projectPath, tokenConsumptionByRun)
    : undefined;
  const featureDocuments = projectPath && feature?.folder
    ? readFeatureSpecDocuments(projectPath, feature.folder)
    : {};
  const evidence = result.queries.featureEvidence.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    summary: String(row.summary ?? ""),
    path: optionalString(row.path),
    metadata: parseJson(row.metadata_json),
  }));

  return {
    features,
    prdWorkflow: buildPrdWorkflow({
      auditRows: result.queries.workflowAudit,
      project: result.queries.projects[0],
      repositoryConnection: result.queries.repositoryConnections[0],
      constitution: result.queries.constitutions[0],
      memoryVersion: result.queries.memoryVersions[0],
      healthCheck: result.queries.healthChecks[0],
      features,
      selectedFeatureId: feature?.id,
      selectedFeatureStatus: feature?.status,
      selectedRequirementCount: result.queries.requirements.length,
    }),
    selectedFeature: feature
      ? {
          ...feature,
          requirements: result.queries.requirements.map((row) => ({
            id: String(row.id),
            body: String(row.body),
            acceptanceCriteria: optionalString(row.acceptance_criteria),
            priority: optionalString(row.priority),
          })),
          taskGraph: parseJson(result.queries.taskGraphs[0]?.graph_json),
          documents: featureDocuments,
          clarificationRecords: evidence.filter((entry) => entry.kind === "clarification"),
          qualityChecklist: [
            { item: "requirements_present", passed: result.queries.requirements.length > 0 || featureDocuments.requirements?.exists === true },
            { item: "requirements_md_present", passed: featureDocuments.requirements?.exists === true },
            { item: "design_md_present", passed: featureDocuments.design?.exists === true },
            { item: "tasks_md_present", passed: featureDocuments.tasks?.exists === true },
            { item: "status_ready_for_scheduling", passed: Boolean(feature.status) && featureDocuments.requirements?.exists === true && featureDocuments.design?.exists === true && featureDocuments.tasks?.exists === true },
          ],
          dataModels: evidence.filter((entry) => entry.kind === "data_model"),
          contracts: evidence.filter((entry) => entry.kind === "contract"),
          versionDiffs: [
            ...evidence.filter((entry) => entry.kind === "spec_evolution"),
            ...result.queries.deliveryReports.map((row) => ({
              id: String(row.id),
              path: String(row.path),
              summary: String(row.summary ?? ""),
              createdAt: String(row.created_at),
            })),
          ],
          skillOutput: featureSkillOutput,
        }
      : undefined,
    commands: [
      { action: "create_feature", entityType: "project" },
      { action: "scan_prd_source", entityType: "project" },
      { action: "upload_prd_source", entityType: "project" },
      { action: "generate_ears", entityType: "project" },
      { action: "update_spec", entityType: "spec" },
      { action: "start_auto_run", entityType: "project" },
      { action: "schedule_run", entityType: "project" },
      { action: "schedule_run", entityType: "feature" },
    ],
  };
}

function buildPrdWorkflow(input: {
  auditRows: Record<string, unknown>[];
  project?: Record<string, unknown>;
  repositoryConnection?: Record<string, unknown>;
  constitution?: Record<string, unknown>;
  memoryVersion?: Record<string, unknown>;
  healthCheck?: Record<string, unknown>;
  features: SpecWorkspaceViewModel["features"];
  selectedFeatureId?: string;
  selectedFeatureStatus?: string;
  selectedRequirementCount: number;
}): SpecWorkspaceViewModel["prdWorkflow"] {
  const stages: SpecWorkspaceViewModel["prdWorkflow"]["stages"] = [
    { key: "scan_prd", action: "scan_prd_source", status: "pending" },
    { key: "upload_prd", action: "upload_prd_source", status: "pending" },
    { key: "generate_ears", action: "generate_ears", status: "pending" },
  ];
  const latestByAction = new Map<ConsoleCommandAction, Record<string, unknown>>();
  for (const row of input.auditRows) {
    const action = String(row.event_type).replace(/^console_command_/, "") as ConsoleCommandAction;
    if (!latestByAction.has(action)) {
      latestByAction.set(action, row);
    }
  }

  const decoratedStages = stages.map((stage) => {
    const row = latestByAction.get(stage.action);
    if (!row) {
      return stage;
    }
    const payload = parseJsonObject(row.payload_json);
    const boardValidation = parseJsonObject(payload.boardValidation);
    const blockedReasons = arrayValue(boardValidation.blockedReasons).map(String);
    const commandPayload = parseJsonObject(payload.payload);
    return {
      ...stage,
      status: blockedReasons.length > 0 ? "blocked" as const : "accepted" as const,
      updatedAt: optionalString(row.created_at),
      auditEventId: optionalString(row.id),
      resultPath: optionalString(commandPayload.resultPath),
    };
  });

  const rawSourcePayload = [...latestByAction.values()]
    .map(extractWorkflowSourcePayload)
    .find((payload) => optionalString(payload.sourcePath) || optionalString(payload.resolvedSourcePath) || optionalString(payload.fileName)) ?? {};
  const allBlockedReasons = [...latestByAction.values()]
    .flatMap((row) => arrayValue(parseJsonObject(parseJsonObject(row.payload_json).boardValidation).blockedReasons).map(String));
  const project = input.project;
  const repositoryConnection = input.repositoryConnection;
  const constitution = input.constitution;
  const memoryVersion = input.memoryVersion;
  const healthCheck = input.healthCheck;
  const projectStatus = optionalString(project?.status);
  const projectPath = optionalString(repositoryConnection?.local_path) ?? optionalString(project?.target_repo_path);
  const sourcePayload = resolveWorkflowSourcePayload(projectPath, rawSourcePayload);
  const healthReasons = parseJsonArray(healthCheck?.reasons_json).map(String);
  const isSpecProtocolMissing = healthReasons.includes("spec_protocol_directory_missing");
  const projectBlockedReasons = [
    ...(!project ? ["Create or import a project before Spec intake."] : []),
    ...(project && !repositoryConnection ? ["Connect a Git repository before Spec intake."] : []),
  ];
  const commandStatus = (action: ConsoleCommandAction): "accepted" | "blocked" | undefined => {
    const row = latestByAction.get(action);
    if (!row) {
      return undefined;
    }
    const payload = parseJsonObject(row.payload_json);
    const boardValidation = parseJsonObject(payload.boardValidation);
    const blockedReasons = arrayValue(boardValidation.blockedReasons);
    return blockedReasons.length > 0 ? "blocked" : "accepted";
  };
  const commandUpdatedAt = (action: ConsoleCommandAction): string | undefined => optionalString(latestByAction.get(action)?.created_at);
  const projectStageStatus = (
    done: boolean,
    blockedReason?: string,
    action?: ConsoleCommandAction,
  ): "pending" | "accepted" | "blocked" | "completed" => {
    if (done) {
      return "completed";
    }
    if (action) {
      const status = commandStatus(action);
      if (status) {
        return status;
      }
    }
    return blockedReason ? "blocked" : "pending";
  };
  const latestProjectUpdatedAt = optionalString(healthCheck?.checked_at)
    ?? optionalString(memoryVersion?.created_at)
    ?? optionalString(constitution?.created_at)
    ?? optionalString(repositoryConnection?.connected_at)
    ?? optionalString(project?.updated_at);
  const projectStages = [
    {
      key: "create_or_import_project",
      status: projectStageStatus(Boolean(project), "Create or import a project before Spec intake."),
      updatedAt: optionalString(project?.created_at),
      blockedReason: project ? undefined : "Create or import a project before Spec intake.",
    },
    {
      key: "connect_git_repository",
      action: "connect_git_repository",
      status: projectStageStatus(Boolean(repositoryConnection), project ? "Connect a Git repository before Spec intake." : undefined, "connect_git_repository"),
      updatedAt: optionalString(repositoryConnection?.connected_at) ?? commandUpdatedAt("connect_git_repository"),
      blockedReason: project && !repositoryConnection ? "Connect a Git repository before Spec intake." : undefined,
    },
    {
      key: "initialize_spec_protocol",
      action: "initialize_spec_protocol",
      status: projectStageStatus(Boolean(projectPath) && !isSpecProtocolMissing, project ? "Initialize .autobuild / Spec Protocol before Spec intake." : undefined, "initialize_spec_protocol"),
      updatedAt: optionalString(healthCheck?.checked_at) ?? commandUpdatedAt("initialize_spec_protocol"),
      blockedReason: project && (!projectPath || isSpecProtocolMissing) ? "Initialize .autobuild / Spec Protocol before Spec intake." : undefined,
    },
    {
      key: "import_or_create_constitution",
      action: "import_or_create_constitution",
      status: projectStageStatus(Boolean(constitution), undefined, "import_or_create_constitution"),
      updatedAt: optionalString(constitution?.created_at) ?? commandUpdatedAt("import_or_create_constitution"),
    },
    {
      key: "initialize_project_memory",
      action: "initialize_project_memory",
      status: projectStageStatus(Boolean(memoryVersion), undefined, "initialize_project_memory"),
      updatedAt: optionalString(memoryVersion?.created_at) ?? commandUpdatedAt("initialize_project_memory"),
    },
  ] satisfies SpecWorkspaceViewModel["prdWorkflow"]["phases"][number]["stages"];
  const projectStageBlockedReasons = [
    ...projectBlockedReasons,
    ...projectStages.map((stage) => stage.blockedReason).filter((reason): reason is string => Boolean(reason)),
  ];
  const stageStatusByKey = new Map(decoratedStages.map((stage) => [stage.key, stage.status]));
  const scanStage = decoratedStages.find((stage) => stage.key === "scan_prd");
  const uploadStage = decoratedStages.find((stage) => stage.key === "upload_prd");
  const specSourceIntakeStatus = [scanStage?.status, uploadStage?.status].includes("blocked")
    ? "blocked"
    : [scanStage?.status, uploadStage?.status].some((status) => status === "accepted" || status === "completed")
      ? "accepted"
      : "pending";
  const specSourceIntakeUpdatedAt = [scanStage?.updatedAt, uploadStage?.updatedAt]
    .filter(Boolean)
    .sort()
    .at(-1);
  const requirementIntakeStages = [
    {
      key: "spec_source_intake",
      status: specSourceIntakeStatus,
      updatedAt: specSourceIntakeUpdatedAt,
    },
    {
      key: "recognize_requirement_format",
      status: stageStatusByKey.get("scan_prd") === "completed" || stageStatusByKey.get("scan_prd") === "accepted" ? "completed" as const : "pending" as const,
      updatedAt: scanStage?.updatedAt,
    },
    ...decoratedStages.filter((stage) => stage.key !== "scan_prd" && stage.key !== "upload_prd"),
    {
      key: "complete_clarifications",
      status: input.features.length > 0 ? "completed" as const : "pending" as const,
    },
    {
      key: "run_requirement_quality_check",
      status: input.selectedRequirementCount > 0 ? "completed" as const : "pending" as const,
    },
  ] satisfies SpecWorkspaceViewModel["prdWorkflow"]["phases"][number]["stages"];
  const projectPhaseStatus = projectStageBlockedReasons.length > 0 || projectStages.some((stage) => stage.status === "blocked")
    ? "blocked"
    : projectStages.every((stage) => stage.status === "completed")
      ? "completed"
      : "accepted";
  const intakeBlockedReasons = projectPhaseStatus === "blocked" ? ["Complete Stage 1 before requirement intake."] : [...new Set(allBlockedReasons)];
  const intakePhaseStatus = intakeBlockedReasons.length > 0
    ? "blocked"
    : requirementIntakeStages.some((stage) => stage.status === "accepted" || stage.status === "completed")
      ? "accepted"
      : "pending";
  const planningActionStages = [
    {
      key: "generate_hld",
      action: "generate_hld",
      status: latestByAction.has("generate_hld") ? "accepted" as const : "pending" as const,
      updatedAt: optionalString(latestByAction.get("generate_hld")?.created_at),
    },
    {
      key: "generate_ui_spec",
      action: "generate_ui_spec",
      status: latestByAction.has("generate_ui_spec") ? "accepted" as const : "pending" as const,
      updatedAt: optionalString(latestByAction.get("generate_ui_spec")?.created_at),
    },
    {
      key: "split_feature_specs",
      action: "split_feature_specs",
      status: latestByAction.has("split_feature_specs") ? "accepted" as const : "pending" as const,
      updatedAt: optionalString(latestByAction.get("split_feature_specs")?.created_at),
    },
    {
      key: "status_check",
      action: "schedule_run",
      status: "pending" as const,
    },
    {
      key: "task_scheduling",
      action: "start_auto_run",
      status: latestByAction.has("start_auto_run")
        ? "accepted" as const
        : input.features.some((feature) => feature.status === "ready")
          ? "completed" as const
          : input.features.length > 0
            ? "accepted" as const
            : "pending" as const,
      updatedAt: optionalString(latestByAction.get("start_auto_run")?.created_at),
    },
  ] satisfies SpecWorkspaceViewModel["prdWorkflow"]["phases"][number]["stages"];
  const planningBlockedReasons = intakePhaseStatus === "blocked"
    ? ["Complete Stage 2 before planning execution."]
    : [];
  const planningPhaseStatus = planningBlockedReasons.length > 0
    ? "blocked"
    : planningActionStages.some((stage) => stage.status === "accepted" || stage.status === "completed")
      ? "accepted"
      : "pending";

  return {
    targetRepoPath: optionalString(sourcePayload.targetRepoPath),
    sourcePath: optionalString(sourcePayload.sourcePath) ?? "No Spec source selected",
    resolvedSourcePath: optionalString(sourcePayload.resolvedSourcePath),
    sourceName: optionalString(sourcePayload.fileName),
    sourceVersion: optionalString(sourcePayload.sourceVersion) ?? "v1.3.0",
    scanMode: optionalString(sourcePayload.scanMode) ?? "smart",
    lastScanAt: decoratedStages.find((stage) => stage.updatedAt)?.updatedAt,
    runtime: optionalString(sourcePayload.runtime) ?? "10m 24s",
    blockedReasons: [...new Set([...projectStageBlockedReasons, ...allBlockedReasons])],
    phases: [
      {
        key: "project_initialization",
        status: projectPhaseStatus,
        updatedAt: latestProjectUpdatedAt,
        blockedReasons: [...new Set(projectStageBlockedReasons)],
        facts: [
          { label: "Project", value: optionalString(project?.name) ?? "Not created" },
          { label: "Repository", value: projectPath ?? "Not connected" },
          { label: "Health", value: projectStatus ?? "unknown" },
        ],
        stages: projectStages,
      },
      {
        key: "requirement_intake",
        status: intakePhaseStatus,
        updatedAt: decoratedStages.find((stage) => stage.updatedAt)?.updatedAt,
        blockedReasons: intakeBlockedReasons,
        facts: [
          { label: "PRD", value: optionalString(sourcePayload.resolvedSourcePath) ?? optionalString(sourcePayload.sourcePath) ?? "No Spec source selected" },
          { label: "Features", value: String(input.features.length) },
          { label: "Requirements", value: String(input.selectedRequirementCount) },
        ],
        stages: requirementIntakeStages,
      },
      {
        key: "feature_execution",
        status: planningPhaseStatus,
        updatedAt: planningActionStages.find((stage) => stage.updatedAt)?.updatedAt,
        blockedReasons: planningBlockedReasons,
        facts: [
          { label: "Feature", value: input.selectedFeatureId ?? "Not selected" },
          { label: "Status", value: input.selectedFeatureStatus ?? "unknown" },
          { label: "Command", value: "schedule_run" },
          { label: "UI outputs", value: "docs/ui/ui-spec.md + docs/ui/concepts/*.svg" },
        ],
        stages: planningActionStages,
      },
    ],
    stages: decoratedStages,
  };
}

function extractWorkflowSourcePayload(row: Record<string, unknown>): Record<string, unknown> {
  const payload = parseJsonObject(row.payload_json);
  const commandPayload = parseJsonObject(payload.payload);
  const specIntake = parseJsonObject(payload.specIntake);
  return {
    ...commandPayload,
    fileName: optionalString(specIntake.fileName) ?? optionalString(commandPayload.fileName),
    sourcePath: optionalString(specIntake.sourcePath) ?? optionalString(commandPayload.sourcePath),
    resolvedSourcePath: optionalString(specIntake.resolvedSourcePath) ?? optionalString(commandPayload.resolvedSourcePath),
    sourceVersion: optionalString(specIntake.sourceVersion) ?? optionalString(commandPayload.sourceVersion),
    scanMode: optionalString(commandPayload.scanMode),
  };
}

function resolveWorkflowSourcePayload(projectPath: string | undefined, payload: Record<string, unknown>): Record<string, unknown> {
  const existing = resolveExistingSourcePath(projectPath, optionalString(payload.sourcePath), optionalString(payload.resolvedSourcePath));
  if (existing) {
    return {
      ...payload,
      sourcePath: existing.sourcePath,
      resolvedSourcePath: existing.resolvedSourcePath,
    };
  }

  if (projectPath) {
    try {
      const fallback = selectSpecSource(projectPath, {}, scanSpecSources(projectPath));
      if (fallback) {
        return {
          ...payload,
          sourcePath: fallback.sourcePath,
          resolvedSourcePath: fallback.resolvedSourcePath,
        };
      }
    } catch {
      // The workflow view must not trust or surface stale source paths when the project path is unreadable.
    }
  }

  return {
    ...payload,
    sourcePath: undefined,
    resolvedSourcePath: undefined,
  };
}

function resolveExistingSourcePath(
  projectPath: string | undefined,
  sourcePath: string | undefined,
  resolvedSourcePath: string | undefined,
): { sourcePath: string; resolvedSourcePath: string } | undefined {
  if (resolvedSourcePath && existsSync(resolvedSourcePath)) {
    return {
      sourcePath: sourcePath ?? resolvedSourcePath,
      resolvedSourcePath,
    };
  }
  if (!sourcePath) {
    return undefined;
  }
  const candidate = isAbsolute(sourcePath) ? sourcePath : projectPath ? join(projectPath, sourcePath) : undefined;
  if (!candidate || !existsSync(candidate)) {
    return undefined;
  }
  return {
    sourcePath,
    resolvedSourcePath: candidate,
  };
}

export function buildRunnerConsoleView(dbPath: string, now: Date = new Date(), projectId?: string): RunnerConsoleViewModel {
  ensureTokenConsumptionRecords(dbPath, projectId);
  const runProjectFilter = projectId ? "WHERE run_id IN (SELECT id FROM execution_records WHERE project_id = ?)" : "";
  const runProjectParams = projectId ? [projectId] : [];
  const featureProjectFilter = projectId ? "WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?)" : "";
  const taskProjectFilter = projectId ? "WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?)" : "";
  const projectParams = projectId ? [projectId] : [];
  const metricProjectFilter = projectId ? "WHERE labels_json LIKE ?" : "";
  const metricParams = projectId ? [`%"projectId":"${escapeLike(projectId)}"%`] : [];
  const triggerProjectFilter = projectId ? "WHERE project_id = ?" : "";
  const triggerParams = projectId ? [projectId] : [];
  const schedulerProjectFilter = projectId ? "WHERE payload_json LIKE ?" : "";
  const schedulerProjectParams = projectId ? [`%"projectId":"${escapeLike(projectId)}"%`] : [];
  const reviewProjectFilter = projectId
    ? `WHERE (
        project_id = ?
        OR feature_id IN (SELECT id FROM features WHERE project_id = ?)
        OR task_id IN (SELECT id FROM tasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?))
        OR task_id IN (SELECT id FROM task_graph_tasks WHERE feature_id IN (SELECT id FROM features WHERE project_id = ?))
        OR run_id IN (SELECT id FROM execution_records WHERE project_id = ?)
      )`
    : "";
  const reviewParams = projectId ? [projectId, projectId, projectId, projectId, projectId] : [];
  const result = runSqlite(dbPath, [], [
    {
      name: "policies",
      sql: `SELECT id, run_id, risk, sandbox_mode, approval_policy, model, workspace_root, heartbeat_interval_seconds, created_at, reasoning_effort
        FROM runner_policies ${runProjectFilter} ORDER BY created_at DESC`,
      params: runProjectParams,
    },
    { name: "heartbeats", sql: `SELECT * FROM runner_heartbeats ${runProjectFilter} ORDER BY beat_at DESC`, params: runProjectParams },
    {
      name: "logs",
      sql: `SELECT id, run_id, SUBSTR(stdout, 1, 4000) AS stdout, SUBSTR(stderr, 1, 4000) AS stderr, created_at
        FROM raw_execution_logs ${runProjectFilter} ORDER BY created_at DESC LIMIT 25`,
      params: runProjectParams,
    },
    {
      name: "graphTasks",
      sql: `SELECT t.id, t.feature_id, f.title AS feature_title, t.title, t.status, t.dependencies_json, t.risk,
          t.source_requirements_json, t.acceptance_criteria_json, t.allowed_files_json, t.updated_at, g.graph_json
        FROM task_graph_tasks t
        LEFT JOIN features f ON f.id = t.feature_id
        LEFT JOIN task_graphs g ON g.id = t.graph_id
        ${featureProjectFilter ? `WHERE t.feature_id IN (SELECT id FROM features WHERE project_id = ?)` : ""}
        ORDER BY t.updated_at DESC, t.created_at DESC, t.id`,
      params: projectParams,
    },
    {
      name: "tasks",
      sql: `SELECT t.id, t.feature_id, f.title AS feature_title, t.title, t.description, t.status,
          COALESCE(t.depends_on_json, '[]') AS dependencies_json, COALESCE(t.allowed_files_json, '[]') AS allowed_files_json,
          'unknown' AS risk, '[]' AS source_requirements_json, '[]' AS acceptance_criteria_json, t.updated_at
        FROM tasks t
        LEFT JOIN features f ON f.id = t.feature_id
        ${taskProjectFilter ? `WHERE t.feature_id IN (SELECT id FROM features WHERE project_id = ?)` : ""}
        ORDER BY t.created_at DESC, t.id`,
      params: projectParams,
    },
    {
      name: "executionRecords",
      sql: `SELECT id,
          json_extract(context_json, '$.taskId') AS task_id,
          json_extract(context_json, '$.featureId') AS feature_id,
          scheduler_job_id, executor_type, operation, project_id, context_json, status, started_at, completed_at, summary, metadata_json, updated_at
        FROM execution_records ${projectId ? "WHERE project_id = ?" : ""}
        ORDER BY COALESCE(updated_at, completed_at, started_at, '') DESC, id`,
      params: projectParams,
    },
    {
      name: "evidence",
      sql: `SELECT id, run_id, summary, COALESCE(NULLIF(metadata_json, '{}'), execution_result_json, '{}') AS metadata_json, created_at FROM status_check_results ${runProjectFilter} ORDER BY created_at DESC LIMIT 25`,
      params: runProjectParams,
    },
    { name: "reviews", sql: `SELECT id, task_id, feature_id, status, severity FROM review_items ${reviewProjectFilter} ORDER BY created_at DESC`, params: reviewParams },
    {
      name: "approvals",
      sql: `SELECT ar.*, ri.task_id, ri.feature_id FROM approval_records ar JOIN review_items ri ON ri.id = ar.review_item_id ORDER BY COALESCE(ar.decided_at, ar.created_at) DESC`,
    },
    { name: "metrics", sql: `SELECT metric_name, metric_value, labels_json FROM metric_samples ${metricProjectFilter} ORDER BY sampled_at, rowid`, params: metricParams },
    {
      name: "tokenConsumption",
      sql: `SELECT * FROM token_consumption_records ${projectId ? "WHERE project_id = ?" : ""} ORDER BY recorded_at DESC, rowid DESC`,
      params: projectParams,
    },
    {
      name: "triggers",
      sql: `SELECT id, mode, target_type, target_id, result, created_at FROM schedule_triggers ${triggerProjectFilter} ORDER BY created_at DESC, rowid DESC LIMIT 8`,
      params: triggerParams,
    },
    {
      name: "schedulerJobs",
      sql: `SELECT id, bullmq_job_id, queue_name, job_type, status, attempts, error, payload_json, updated_at
        FROM scheduler_job_records ${schedulerProjectFilter}
        ORDER BY updated_at DESC, rowid DESC LIMIT 12`,
      params: schedulerProjectParams,
    },
    {
      name: "repositoryConnections",
      sql: `SELECT project_id, local_path FROM repository_connections ${projectId ? "WHERE project_id = ?" : ""} ORDER BY connected_at DESC`,
      params: projectParams,
    },
    {
      name: "audit",
      sql: "SELECT id, entity_type, entity_id, event_type, payload_json, created_at FROM audit_timeline_events ORDER BY created_at DESC, rowid DESC LIMIT 20",
    },
    { name: "adapters", sql: "SELECT * FROM cli_adapter_configs ORDER BY updated_at DESC" },
  ]);
  const latestHeartbeats = latestRunnerStatuses(result.queries.heartbeats);
  const taskRows = result.queries.graphTasks.length > 0 ? result.queries.graphTasks : result.queries.tasks;
  const taskById = new Map(taskRows.map((row) => [String(row.id), row]));
  const latestRunsByTask = latestRunsForTasks(result.queries.executionRecords);
  const latestHeartbeatsByRun = latestHeartbeatByRun(result.queries.heartbeats);
  const workspaceRootByProject = latestWorkspaceRootByProject(result.queries.repositoryConnections);
  const tokenConsumptionByRun = tokenConsumptionByRunId(result.queries.tokenConsumption);
  const laneTasks = buildRunnerScheduleLanes({
    taskRows,
    taskById,
    runsByTask: latestRunsByTask,
    heartbeatsByRun: latestHeartbeatsByRun,
    logs: result.queries.logs,
    reviews: result.queries.reviews,
    approvals: result.queries.approvals,
    evidence: result.queries.evidence,
  });
  const runners = latestHeartbeats.map((heartbeat) => {
    const policy = result.queries.policies.find((row) => row.run_id === heartbeat.run_id);
    const lastHeartbeatAt = String(heartbeat.beat_at);
    const heartbeatIntervalSeconds = Number(policy?.heartbeat_interval_seconds ?? 20);
    const heartbeatStale = now.getTime() - new Date(lastHeartbeatAt).getTime() > heartbeatIntervalSeconds * 2 * 1000;
    return {
      runnerId: String(heartbeat.runner_id),
      online: String(heartbeat.status) === "online" && !heartbeatStale,
      runnerModel: optionalString(policy?.model),
      sandboxMode: String(policy?.sandbox_mode ?? "workspace-write") as RunnerSandboxMode,
      approvalPolicy: String(policy?.approval_policy ?? "on-request") as RunnerApprovalPolicy,
      queue: latestRunQueueStatuses(result.queries.heartbeats.filter((row) => row.runner_id === heartbeat.runner_id))
        .map((row) => ({ runId: String(row.run_id), status: String(row.queue_status) as RunnerQueueStatus })),
      recentLogs: result.queries.logs
        .filter((row) => row.run_id === heartbeat.run_id)
        .slice(0, 5)
        .map((row) => ({ runId: String(row.run_id), stdout: String(row.stdout ?? ""), stderr: String(row.stderr ?? ""), createdAt: String(row.created_at) })),
      lastHeartbeatAt,
      heartbeatStale,
    };
  });
  const activeAdapter = adapterFromRows(result.queries.adapters, "active");
  const adapterSummary = buildCliAdapterSummary(activeAdapter, result.queries.adapters);

  return {
    summary: {
      onlineRunners: runners.filter((runner) => runner.online).length,
      runningTasks: laneTasks.running.length,
      readyTasks: laneTasks.ready.length,
      blockedTasks: laneTasks.blocked.length,
      successRate: latestMetric(result.queries.metrics, "success_rate"),
      failureRate: latestMetric(result.queries.metrics, "failure_rate"),
    },
    lanes: laneTasks,
    schedulerJobs: buildRunnerSchedulerJobs(result.queries.schedulerJobs, result.queries.executionRecords, taskRows, workspaceRootByProject, tokenConsumptionByRun),
    recentTriggers: [
      ...result.queries.schedulerJobs.map((row) => ({
        id: String(row.id),
        action: String(row.job_type),
        target: schedulerJobTargetLabel(row),
        result: String(row.status),
        createdAt: String(row.updated_at),
      })),
      ...result.queries.triggers.map((row) => ({
        id: String(row.id),
        action: String(row.mode),
        target: `${String(row.target_type)}:${String(row.target_id ?? "")}`,
        result: String(row.result),
        createdAt: String(row.created_at),
      })),
      ...filterRunnerAuditEvents(result.queries.audit, taskRows, projectId).map((row) => ({
        id: String(row.id),
        action: String(row.event_type).replace(/^console_command_/, ""),
        target: `${String(row.entity_type)}:${String(row.entity_id)}`,
        result: optionalString(parseJsonObject(row.payload_json).status) ?? "recorded",
        createdAt: String(row.created_at),
      })),
    ].slice(0, 8),
    factSources: [
      "execution_records",
      "scheduler_job_records",
      "runner_heartbeats",
      "raw_execution_logs",
      "status_check_results",
      "token_consumption_records",
    ],
    runners,
    adapterSummary,
    commands: [
      { action: "pause_runner", entityType: "runner" },
      { action: "resume_runner", entityType: "runner" },
      { action: "schedule_run", entityType: "feature" },
      { action: "schedule_board_tasks", entityType: "feature" },
      { action: "run_board_tasks", entityType: "feature" },
    ],
    skillInvocations: buildSkillInvocationFeedback(result.queries.executionRecords, result.queries.schedulerJobs, result.queries.evidence, workspaceRootByProject, tokenConsumptionByRun),
  };
}

export function buildSystemSettingsView(dbPath: string): SystemSettingsViewModel {
  const result = runSqlite(dbPath, [], [
    { name: "adapters", sql: "SELECT * FROM cli_adapter_configs ORDER BY updated_at DESC" },
    { name: "rpcAdapters", sql: "SELECT * FROM rpc_adapter_configs ORDER BY updated_at DESC" },
  ]);
  const active = adapterFromRows(result.queries.adapters, "active") ?? DEFAULT_CLI_ADAPTER_CONFIG;
  const draft = adapterFromRows(result.queries.adapters, "draft", false);
  const dryRun = latestAdapterDryRun(result.queries.adapters, draft?.id ?? active.id);
  const activeRpc = rpcAdapterFromRows(result.queries.rpcAdapters, "active") ?? DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG;
  const draftRpc = rpcAdapterFromRows(result.queries.rpcAdapters, "draft", false);
  const rpcProbe = latestRpcAdapterProbe(result.queries.rpcAdapters, draftRpc?.id ?? activeRpc.id);
  const projectId = currentSettingsProjectId(dbPath);
  const projectExecutionPreference = buildProjectExecutionPreferenceSettings(
    dbPath,
    projectId,
    result.queries.adapters,
    result.queries.rpcAdapters,
  );
  return {
    projectExecutionPreference,
    cliAdapter: {
      active,
      draft,
      presets: [DEFAULT_CLI_ADAPTER_CONFIG, GEMINI_CLI_ADAPTER_CONFIG],
      validation: validateCliAdapterConfig(draft ?? active),
      lastDryRun: dryRun,
    },
    rpcAdapter: {
      active: activeRpc,
      draft: draftRpc,
      presets: [DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG, DEFAULT_GEMINI_ACP_ADAPTER_CONFIG],
      validation: dryRunRpcAdapterConfig(draftRpc ?? activeRpc),
      lastProbe: rpcProbe,
    },
    commands: [
      { action: "validate_cli_adapter_config", entityType: "cli_adapter" },
      { action: "save_cli_adapter_config", entityType: "cli_adapter" },
      { action: "activate_cli_adapter_config", entityType: "cli_adapter" },
      { action: "disable_cli_adapter_config", entityType: "cli_adapter" },
      { action: "validate_rpc_adapter_config", entityType: "rpc_adapter" },
      { action: "save_rpc_adapter_config", entityType: "rpc_adapter" },
      { action: "activate_rpc_adapter_config", entityType: "rpc_adapter" },
      { action: "disable_rpc_adapter_config", entityType: "rpc_adapter" },
      { action: "save_project_execution_preference", entityType: "settings" },
    ],
    factSources: ["project_execution_preferences", "cli_adapter_configs", "rpc_adapter_configs", "audit_timeline_events"],
  };
}

function currentSettingsProjectId(dbPath: string): string | undefined {
  const result = runSqlite(dbPath, [], [
    {
      name: "selection",
      sql: "SELECT project_id FROM project_selection_context WHERE id = 1 LIMIT 1",
    },
    {
      name: "project",
      sql: "SELECT id FROM projects ORDER BY updated_at DESC, created_at DESC LIMIT 1",
    },
  ]);
  return optionalString(result.queries.selection[0]?.project_id) ?? optionalString(result.queries.project[0]?.id);
}

function buildProjectExecutionPreferenceSettings(
  dbPath: string,
  projectId: string | undefined,
  cliRows: Record<string, unknown>[],
  rpcRows: Record<string, unknown>[],
): NonNullable<SystemSettingsViewModel["projectExecutionPreference"]> {
  const cliAdapters = uniqueCliAdapters(cliRows);
  const rpcAdapters = uniqueRpcAdapters(rpcRows);
  const activeCli = adapterFromRows(cliRows, "active") ?? DEFAULT_CLI_ADAPTER_CONFIG;
  const result = projectId
    ? runSqlite(dbPath, [], [
      { name: "preference", sql: "SELECT * FROM project_execution_preferences WHERE project_id = ? LIMIT 1", params: [projectId] },
    ])
    : { queries: { preference: [] as Record<string, unknown>[] } };
  const row = result.queries.preference[0];
  const active: ExecutionPreferenceV1 = row
    ? executionPreferenceForAdapterId(String(row.adapter_id), cliRows, rpcRows, "project").preference ?? {
        runMode: String(row.run_mode) === "rpc" ? "rpc" : "cli",
        adapterId: String(row.adapter_id),
        source: "project",
      }
    : {
        runMode: "cli",
        adapterId: activeCli.id,
        source: "default",
      };
  return {
    projectId,
    active,
    cliAdapters,
    rpcAdapters,
    validation: validateExecutionPreference(active, cliRows, rpcRows),
  };
}

export function buildReviewCenterView(dbPath: string, projectId?: string): ReviewCenterViewModel {
  const items = listReviewCenterItems(dbPath, { projectId });

  return {
    items: items.map((item) => ({
      id: item.id,
      featureId: item.featureId,
      taskId: item.taskId,
      status: item.status,
      severity: item.severity,
      body: item.body.message,
      evidence: item.evidence.map((entry) => ({ id: entry.id, summary: entry.summary, path: entry.path })),
      goal: item.body.goal,
      specRef: item.body.specRef,
      runContract: item.body.runContract,
      reviewNeededReason: item.reviewNeededReason,
      triggerReasons: item.triggerReasons,
      recommendedActions: item.recommendedActions,
      approvals: item.approvals.map((approval) => ({
        id: approval.id,
        decision: approval.decision,
        actor: approval.actor,
        reason: approval.reason,
        decidedAt: approval.decidedAt,
      })),
      diff: item.body.diff,
      testResults: item.body.testResults,
      riskExplanation: item.body.riskExplanation,
      createdAt: item.createdAt,
    })),
    riskFilters: [...new Set(items.map((item) => item.severity))].sort(),
    commands: [
      { action: "approve_review", entityType: "review_item" },
      { action: "reject_review", entityType: "review_item" },
      { action: "request_review_changes", entityType: "review_item" },
      { action: "rollback_review", entityType: "review_item" },
      { action: "split_review_task", entityType: "review_item" },
      { action: "update_spec", entityType: "review_item" },
      { action: "mark_review_complete", entityType: "review_item" },
      { action: "write_project_rule", entityType: "rule" },
      { action: "write_spec_evolution", entityType: "spec" },
    ],
  };
}

export function buildAuditCenterView(dbPath: string, projectId?: string): AuditCenterViewModel {
  const featureFilter = projectId ? "WHERE project_id = ?" : "";
  const runFilter = projectId ? "WHERE project_id = ?" : "";
  const result = runSqlite(dbPath, [], [
    { name: "features", sql: `SELECT id, project_id FROM features ${featureFilter}`, params: projectId ? [projectId] : [] },
    { name: "tasks", sql: "SELECT id, feature_id FROM tasks" },
    { name: "graphTasks", sql: "SELECT id, feature_id FROM task_graph_tasks" },
    {
      name: "runs",
      sql: `SELECT id,
          json_extract(context_json, '$.taskId') AS task_id,
          json_extract(context_json, '$.featureId') AS feature_id,
          project_id, status, '{}' AS metadata_json, started_at, completed_at
        FROM execution_records
        ${runFilter}
        ORDER BY COALESCE(completed_at, started_at, '') DESC, id`,
      params: projectId ? [projectId] : [],
    },
    { name: "reviews", sql: "SELECT id, project_id, feature_id, task_id, status, severity, body, created_at FROM review_items ORDER BY created_at DESC, rowid DESC" },
    {
      name: "audit",
      sql: `SELECT rowid AS rowid, id, entity_type, entity_id, event_type, source, reason, payload_json, created_at
        FROM audit_timeline_events
        ORDER BY created_at DESC, rowid DESC
        LIMIT 200`,
    },
    {
      name: "transitions",
      sql: `SELECT id, entity_type, entity_id, from_status, to_status, reason, evidence, triggered_by, occurred_at
        FROM state_transitions
        ORDER BY occurred_at DESC, rowid DESC
        LIMIT 120`,
    },
    {
      name: "evidence",
      sql: `SELECT id, run_id, task_id, feature_id, COALESCE(kind, 'status_check') AS kind, summary, path,
          CASE WHEN length(COALESCE(NULLIF(metadata_json, '{}'), execution_result_json, '{}')) > 1048576
            THEN '{}'
            ELSE COALESCE(NULLIF(metadata_json, '{}'), execution_result_json, '{}')
          END AS metadata_json, created_at
        FROM status_check_results
        ORDER BY created_at DESC, rowid DESC
        LIMIT 80`,
    },
    {
      name: "approvals",
      sql: `SELECT ar.id, ar.review_item_id, ar.decision, ar.actor, ar.reason, ar.decided_at, ar.created_at, ri.project_id, ri.feature_id, ri.task_id
        FROM approval_records ar
        JOIN review_items ri ON ri.id = ar.review_item_id
        ORDER BY COALESCE(ar.decided_at, ar.created_at) DESC, ar.rowid DESC
        LIMIT 80`,
    },
    {
      name: "schedulerJobs",
      sql: `SELECT id, bullmq_job_id, queue_name, job_type, status, payload_json, error, updated_at
        FROM scheduler_job_records
        ORDER BY updated_at DESC, rowid DESC
        LIMIT 80`,
    },
  ]);

  const scopedFeatureIds = new Set(result.queries.features.map((row) => String(row.id)));
  const taskRows = [...result.queries.tasks, ...result.queries.graphTasks];
  const taskFeatureById = new Map(taskRows.map((row) => [String(row.id), optionalString(row.feature_id)]));
  const scopedTaskIds = new Set(taskRows
    .filter((row) => !projectId || scopedFeatureIds.has(String(row.feature_id)))
    .map((row) => String(row.id)));
  const scopedRunIds = new Set(result.queries.runs
    .filter((row) => auditRowBelongsToProject({
      entityType: "execution",
      entityId: String(row.id),
      projectId,
      payload: parseJsonObject(row.metadata_json),
      featureIds: scopedFeatureIds,
      taskIds: scopedTaskIds,
      runRows: result.queries.runs,
      reviewRows: result.queries.reviews,
      taskFeatureById,
    }))
    .map((row) => String(row.id)));

  const scope = {
    projectId,
    featureIds: scopedFeatureIds,
    taskIds: scopedTaskIds,
    runRows: result.queries.runs,
    reviewRows: result.queries.reviews,
    taskFeatureById,
  };
  const auditRows = result.queries.audit.filter((row) => auditRowBelongsToProject({
    ...scope,
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    payload: parseJsonObject(row.payload_json),
  }));
  const transitionRows = result.queries.transitions.filter((row) => auditRowBelongsToProject({
    ...scope,
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    payload: {},
  }));
  const executionResultRows = result.queries.evidence.filter((row) =>
    (!projectId && true)
    || scopedFeatureIds.has(String(row.feature_id))
    || scopedTaskIds.has(String(row.task_id))
    || scopedRunIds.has(String(row.run_id))
  );
  const approvalRows = result.queries.approvals.filter((row) =>
    (!projectId && true)
    || optionalString(row.project_id) === projectId
    || scopedFeatureIds.has(String(row.feature_id))
    || scopedTaskIds.has(String(row.task_id))
  );
  const schedulerRows = result.queries.schedulerJobs.filter((row) => auditRowBelongsToProject({
    ...scope,
    entityType: "execution",
    entityId: optionalString(parseJsonObject(row.payload_json).executionId) ?? String(row.id),
    payload: parseJsonObject(row.payload_json),
  }));

  const commandEvents = auditRows.map((row) => auditEventToTimeline(row));
  const transitionEvents = transitionRows.map((row) => ({
    id: String(row.id),
    occurredAt: String(row.occurred_at),
    status: "transition" as const,
    eventType: "state_transition",
    action: `${String(row.from_status)} -> ${String(row.to_status)}`,
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    reason: String(row.reason),
    requestedBy: optionalString(row.triggered_by),
    runId: String(row.evidence).startsWith("RUN-") ? String(row.evidence) : undefined,
    jobId: undefined,
    featureId: String(row.entity_type) === "feature" ? String(row.entity_id) : taskFeatureById.get(String(row.entity_id)),
    taskId: String(row.entity_type) === "task" ? String(row.entity_id) : undefined,
    executionResultId: optionalString(row.evidence),
    reviewId: undefined,
    blockedReasons: [],
    payload: { fromStatus: row.from_status, toStatus: row.to_status, evidence: row.evidence },
  }));
  const executionResultEvents = executionResultRows.map((row) => ({
    id: String(row.id),
    occurredAt: String(row.created_at),
    status: "recorded" as const,
    eventType: "execution_result_recorded",
    action: String(row.kind),
    entityType: "execution_result",
    entityId: String(row.id),
    reason: String(row.summary ?? ""),
    requestedBy: undefined,
    runId: optionalString(row.run_id),
    jobId: undefined,
    featureId: optionalString(row.feature_id),
    taskId: optionalString(row.task_id),
    executionResultId: String(row.id),
    reviewId: undefined,
    blockedReasons: [],
    payload: parseJsonObject(row.metadata_json),
  }));
  const approvalEvents = approvalRows.map((row) => ({
    id: String(row.id),
    occurredAt: String(row.decided_at ?? row.created_at),
    status: "approval" as const,
    eventType: "approval_recorded",
    action: String(row.decision),
    entityType: "review_item",
    entityId: String(row.review_item_id),
    reason: String(row.reason ?? ""),
    requestedBy: optionalString(row.actor),
    runId: undefined,
    jobId: undefined,
    featureId: optionalString(row.feature_id),
    taskId: optionalString(row.task_id),
    executionResultId: undefined,
    reviewId: String(row.review_item_id),
    blockedReasons: [],
    payload: { decision: row.decision },
  }));
  const schedulerEvents = schedulerRows.map((row) => ({
    id: String(row.id),
    occurredAt: String(row.updated_at),
    status: String(row.status) === "failed" || optionalString(row.error) ? "blocked" as const : "recorded" as const,
    eventType: "scheduler_job",
    action: String(row.job_type),
    entityType: "execution",
    entityId: optionalString(parseJsonObject(row.payload_json).executionId) ?? String(row.id),
    reason: optionalString(row.error) ?? String(row.status),
    requestedBy: undefined,
    runId: optionalString(parseJsonObject(row.payload_json).executionId),
    jobId: String(row.id),
    featureId: optionalString(parseJsonObject(parseJsonObject(row.payload_json).context).featureId),
    taskId: optionalString(parseJsonObject(parseJsonObject(row.payload_json).context).taskId),
    executionResultId: undefined,
    reviewId: undefined,
    blockedReasons: optionalString(row.error) ? [String(row.error)] : [],
    payload: parseJsonObject(row.payload_json),
  }));

  const timeline = [...commandEvents, ...transitionEvents, ...executionResultEvents, ...approvalEvents, ...schedulerEvents]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))
    .slice(0, 80);
  const selectedEvent = timeline.find((event) => event.status === "blocked") ?? timeline[0];

  return {
    summary: {
      totalEvents: timeline.length,
      acceptedCommands: commandEvents.filter((event) => event.status === "accepted").length,
      blockedCommands: commandEvents.filter((event) => event.status === "blocked").length,
      stateTransitions: transitionEvents.length,
      activityCount: executionResultRows.length,
      pendingApprovals: result.queries.reviews.filter((row) =>
        String(row.status) === "review_needed"
        && auditRowBelongsToProject({
          ...scope,
          entityType: "review_item",
          entityId: String(row.id),
          payload: {},
        })
      ).length,
    },
    timeline,
    selectedEvent: selectedEvent ? {
      ...selectedEvent,
      previousStatus: optionalString(selectedEvent.payload?.fromStatus),
      currentStatus: optionalString(selectedEvent.payload?.toStatus),
      environment: optionalString(selectedEvent.payload?.environment) ?? "local",
    } : undefined,
    executionResults: executionResultRows.slice(0, 12).map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      summary: String(row.summary ?? ""),
      path: optionalString(row.path),
      runId: optionalString(row.run_id),
      createdAt: String(row.created_at),
    })),
    approvals: approvalRows.slice(0, 12).map((row) => ({
      id: String(row.id),
      reviewItemId: String(row.review_item_id),
      actor: String(row.actor ?? "system"),
      decision: String(row.decision),
      reason: String(row.reason ?? ""),
      decidedAt: String(row.decided_at ?? row.created_at),
    })),
    filters: {
      eventTypes: [...new Set(timeline.map((event) => event.eventType))].sort(),
      entityTypes: [...new Set(timeline.map((event) => event.entityType))].sort(),
      statuses: [...new Set(timeline.map((event) => event.status))].sort(),
    },
    factSources: [
      "audit_timeline_events",
      "state_transitions",
      "status_check_results",
      "approval_records",
      "scheduler_job_records",
      "execution_records",
    ],
  };
}

export function submitConsoleCommand(dbPath: string, input: ConsoleCommandInput, options: { scheduler?: SchedulerClient } = {}): ConsoleCommandReceipt {
  const action = requireCommandString(input, "action") as ConsoleCommandAction;
  if (!CONSOLE_COMMAND_ACTIONS.has(action)) {
    throw new Error(`Console command action is not supported: ${action}`);
  }
  const entityType = requireCommandString(input, "entityType") as ConsoleCommandInput["entityType"];
  const entityId = requireCommandString(input, "entityId");
  const requestedBy = requireCommandString(input, "requestedBy");
  const reason = requireCommandString(input, "reason");

  const acceptedAt = normalizeCommandTime(input.now).toISOString();
  const id = randomUUID();
  const scheduler = options.scheduler ?? createUnavailableScheduler(dbPath, "Scheduler is not connected to Redis.");
  const boardValidation = validateBoardCommand(dbPath, input);
  const boardResult = boardValidation.blockedReasons.length === 0 ? executeBoardCommand(dbPath, input, acceptedAt, scheduler) : undefined;
  const settingsValidation = executeCliAdapterCommand(dbPath, input, acceptedAt);
  const rpcSettingsValidation = executeRpcAdapterCommand(dbPath, input, acceptedAt);
  const projectExecutionPreferenceValidation = executeProjectExecutionPreferenceCommand(dbPath, input, acceptedAt);
  const approvalRecord = executeReviewCommand(dbPath, input, acceptedAt);
  const scheduleResult = executeScheduleCommand(dbPath, input, acceptedAt, scheduler);
  const autoRunResult = executeAutoRunCommand(dbPath, input, acceptedAt, scheduler);
  const featureReviewResult = executeFeatureReviewCommand(dbPath, input, acceptedAt);
  const writeArtifactId = executeConsoleWriteCommand(dbPath, input, acceptedAt);
  const projectInitializationResult = executeProjectInitializationCommand(dbPath, input);
  const specIntakeResult = executeSpecIntakeCommand(dbPath, input, acceptedAt);
  const specSkillResult = executeSpecSkillCommand(dbPath, input, acceptedAt, scheduler, specIntakeResult);
  const blockedReasons = [
    ...boardValidation.blockedReasons,
    ...(settingsValidation?.blockedReasons ?? []),
    ...(rpcSettingsValidation?.blockedReasons ?? []),
    ...(projectExecutionPreferenceValidation?.blockedReasons ?? []),
    ...(scheduleResult?.blockedReasons ?? []),
    ...(autoRunResult?.blockedReasons ?? []),
    ...(featureReviewResult?.blockedReasons ?? []),
    ...(boardResult?.blockedReasons ?? []),
    ...(projectInitializationResult?.blockedReasons ?? []),
    ...(specIntakeResult?.blockedReasons ?? []),
  ];
  const auditEventId = recordAuditEvent(dbPath, {
    entityType,
    entityId,
    eventType: `console_command_${action}`,
    source: "product_console",
    reason,
    payload: {
      commandId: id,
      requestedBy,
      acceptedAt,
      writeArtifactId,
      projectInitialization: projectInitializationResult,
      specIntake: specIntakeResult,
      specSkill: specSkillResult,
      featureReview: featureReviewResult,
      autoRun: autoRunResult,
      scheduleTriggerId: scheduleResult?.triggerId,
      schedulerJobId: scheduleResult?.schedulerJobId ?? autoRunResult?.schedulerJobId,
      schedulerJobIds: boardResult?.schedulerJobIds,
      boardValidation,
      boardResult,
      settingsValidation,
      rpcSettingsValidation,
      projectExecutionPreferenceValidation,
      payload: input.payload ?? {},
    },
  });

  return {
    id,
    action,
    status: blockedReasons.length > 0 ? "blocked" : "accepted",
    entityType,
    entityId,
    auditEventId,
    acceptedAt,
    approvalRecordId: approvalRecord?.id,
    featureId: optionalString(specIntakeResult?.featureId) ?? optionalString(featureReviewResult?.featureId),
    scheduleTriggerId: scheduleResult?.triggerId ?? autoRunResult?.scheduleTriggerId,
    schedulerJobId: scheduleResult?.schedulerJobId ?? specSkillResult?.schedulerJobId ?? autoRunResult?.schedulerJobId,
    schedulerJobIds: boardResult?.schedulerJobIds,
    executionId: specSkillResult?.executionId ?? scheduleResult?.executionId ?? autoRunResult?.executionId,
    executionIds: boardResult?.runIds,
    runId: specSkillResult?.executionId,
    runIds: boardResult?.runIds,
    blockedReasons: blockedReasons.length > 0 ? blockedReasons : undefined,
  };
}

function executeProjectInitializationCommand(
  dbPath: string,
  input: ConsoleCommandInput,
): ({ blockedReasons: string[] } & Record<string, unknown>) | undefined {
  if (!["register_project", "connect_git_repository", "initialize_spec_protocol", "import_or_create_constitution", "initialize_project_memory", "check_project_health"].includes(input.action)) {
    return undefined;
  }
  if (input.entityType !== "project") {
    return { blockedReasons: ["Project initialization commands require a project entity."] };
  }

  const payload = parseJsonObject(input.payload);
  const project = getProject(dbPath, input.entityId);
  if (!project) {
    if (input.action === "register_project") {
      const workspaceRoot = optionalString(payload.workspaceRoot) ?? optionalString(payload.targetRepoPath);
      if (workspaceRoot && existsSync(workspaceRoot)) {
        const projectName = optionalString(payload.projectName) ?? basename(workspaceRoot);
        const result = initializeProjectPhase1(dbPath, {
          name: projectName,
          goal: `Imported from VSCode workspace ${workspaceRoot}.`,
          projectType: "tooling",
          techPreferences: [],
          targetRepoPath: workspaceRoot,
          defaultBranch: "main",
          trustLevel: "standard",
          environment: "local",
          automationEnabled: true,
          creationMode: "import_existing",
          repositoryUrl: optionalString(payload.repositoryUrl),
        });
        return {
          projectId: result.project.id,
          repositoryConnected: result.repositoryConnected,
          constitutionCreated: result.constitutionCreated,
          memoryInitialized: result.memoryInitialized,
          healthStatus: result.healthStatus,
          initializationBlockingReasons: result.blockingReasons,
          blockedReasons: result.project.id ? [] : result.blockingReasons,
        };
      }
    }
    return { blockedReasons: [`Project not found: ${input.entityId}`] };
  }

  try {
    if (input.action === "register_project") {
      const connection = connectProjectRepository(dbPath, project.id, {
        repositoryUrl: optionalString(payload.repositoryUrl),
      });
      const specProtocol = initializeProjectSpecProtocol(dbPath, project.id);
      const memory = initializeProjectMemoryForProject(dbPath, project.id);
      return {
        projectId: project.id,
        repositoryConnectionId: connection.id,
        repositoryUrl: connection.remoteUrl,
        artifactRoot: specProtocol.artifactRoot,
        projectMemoryId: memory.id,
        path: memory.path,
        blockedReasons: [],
      };
    }

    if (input.action === "connect_git_repository") {
      const connection = connectProjectRepository(dbPath, project.id, {
        repositoryUrl: optionalString(payload.repositoryUrl),
      });
      return { repositoryConnectionId: connection.id, repositoryUrl: connection.remoteUrl, blockedReasons: [] };
    }

    if (input.action === "initialize_spec_protocol") {
      return { ...initializeProjectSpecProtocol(dbPath, project.id), blockedReasons: [] };
    }

    if (input.action === "initialize_project_memory") {
      const memory = initializeProjectMemoryForProject(dbPath, project.id);
      return { projectMemoryId: memory.id, path: memory.path, blockedReasons: [] };
    }

    if (input.action === "check_project_health") {
      const healthCheck = runProjectHealthCheck(dbPath, project.id);
      return {
        healthCheckId: healthCheck.id,
        healthStatus: healthCheck.status,
        reasons: healthCheck.reasons,
        repositorySummaryKind: healthCheck.repositorySummaryKind,
        blockedReasons: healthCheck.status === "ready" ? [] : healthCheck.reasons,
      };
    }

    const existing = getCurrentProjectConstitution(dbPath, project.id);
    if (existing) {
      return { constitutionId: existing.id, blockedReasons: [] };
    }

    const constitution = saveProjectConstitution(dbPath, project.id, createDefaultProjectConstitution(project));
    return { constitutionId: constitution.id, blockedReasons: [] };
  } catch (error) {
    return { blockedReasons: [error instanceof Error ? error.message : String(error)] };
  }
}

function executeSpecIntakeCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
): ({ blockedReasons: string[] } & Record<string, unknown>) | undefined {
  if (!["scan_spec_sources", "scan_prd_source", "upload_prd_source"].includes(input.action)) {
    return undefined;
  }
  if (input.entityType !== "project") {
    return { blockedReasons: ["Spec intake commands require a project entity."] };
  }

  const project = getProject(dbPath, input.entityId);
  if (!project) {
    return { blockedReasons: [`Project not found: ${input.entityId}`] };
  }
  if (!project.targetRepoPath) {
    return { blockedReasons: ["Project repository path is required before Spec intake."] };
  }

  try {
    const payload = parseJsonObject(input.payload);
    if (input.action === "scan_spec_sources" || input.action === "scan_prd_source") {
      const scan = scanSpecSources(project.targetRepoPath, new Date(acceptedAt));
      const source = selectSpecSource(project.targetRepoPath, payload, scan);
      const resultPath = writeSpecIntakeArtifact(project.targetRepoPath, "reports", `spec-source-scan-${Date.parse(acceptedAt)}.json`, scan);
      const evidenceId = recordSpecIntakeEvidence(dbPath, {
        path: resultPath,
        kind: "spec_source_scan",
        summary: `Scanned ${scan.sources.length} Spec Sources; ${scan.missingItems.length} missing items; ${scan.conflicts.length} conflicts.`,
        metadata: scan,
      });
      return {
        evidenceId,
        resultPath,
        sourceCount: scan.sources.length,
        missingCount: scan.missingItems.length,
        conflictCount: scan.conflicts.length,
        clarificationCount: scan.clarificationItems.length,
        sourcePath: source?.sourcePath,
        resolvedSourcePath: source?.resolvedSourcePath,
        sourceVersion: source?.sourceVersion,
        blockedReasons: [],
      };
    }

    if (input.action === "upload_prd_source") {
      const fileName = sanitizeArtifactName(optionalString(payload.fileName) ?? basename(optionalString(payload.sourcePath) ?? "uploaded-spec.md"));
      const content = optionalString(payload.contentPreview) ?? "";
      const sourceVersion = extractVersion(content);
      const uploadPath = writeSpecTextArtifact(project.targetRepoPath, "specs/uploads", fileName, content);
      const evidenceId = recordSpecIntakeEvidence(dbPath, {
        path: uploadPath,
        kind: "spec_source_upload",
        summary: `Uploaded Spec source ${fileName}.`,
        metadata: {
          fileName,
          contentLength: Number(payload.contentLength ?? content.length),
          sourceVersion,
        },
      });
      return {
        evidenceId,
        resultPath: uploadPath,
        fileName,
        sourcePath: uploadPath,
        resolvedSourcePath: join(project.targetRepoPath, uploadPath),
        sourceVersion,
        blockedReasons: [],
      };
    }

  } catch (error) {
    return { blockedReasons: [error instanceof Error ? error.message : String(error)] };
  }
}

function executeScheduleCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
  scheduler: SchedulerClient,
): { triggerId: string; schedulerJobId?: string; executionId?: string; blockedReasons?: string[] } | undefined {
  if (input.action !== "schedule_run") {
    return undefined;
  }
  if (input.entityType !== "project" && input.entityType !== "feature" && input.entityType !== "task") {
    throw new Error("schedule_run supports only project, feature, or task entities.");
  }
  const payload = isRecord(input.payload) ? input.payload : {};
  const mode = requirePayloadString(payload, "mode") as ScheduleTriggerMode;
  const requestedFor = optionalString(payload.requestedFor);
  if (mode === "scheduled_at" && !requestedFor) {
    throw new Error("schedule_run with mode scheduled_at requires payload.requestedFor.");
  }
  const trigger = persistScheduleTrigger(
    dbPath,
    createScheduleTrigger({
      projectId: optionalString(payload.projectId) ?? (input.entityType === "project" ? input.entityId : undefined),
      featureId: optionalString(payload.featureId) ?? (input.entityType === "feature" ? input.entityId : undefined),
      mode,
      requestedFor: requestedFor ?? acceptedAt,
      source: "product_console",
      target: { type: input.entityType, id: input.entityId },
      boundaryEvidence: optionalStringArray(payload.boundaryEvidence),
      now: new Date(acceptedAt),
    }),
  );
  if (trigger.result !== "accepted") {
    return { triggerId: trigger.id };
  }
  const featureId = trigger.featureId ?? optionalString(payload.featureId);
  const taskId = optionalString(payload.taskId) ?? (input.entityType === "task" ? input.entityId : undefined);
  const operation = optionalString(payload.operation) ?? "feature_execution";
  if (input.entityType === "project" && operation === "feature_execution" && !featureId && !taskId) {
    const result = enqueueNextFeatureExecutionFromQueue(dbPath, {
      projectId: input.entityId,
      payload,
      acceptedAt,
      scheduler,
      triggerId: trigger.id,
      triggerAccepted: true,
      commandSource: "schedule_run",
    });
    return {
      triggerId: result.scheduleTriggerId ?? trigger.id,
      schedulerJobId: result.schedulerJobId,
      executionId: result.executionId,
      blockedReasons: result.blockedReasons,
    };
  }
  const executionId = randomUUID();
  const skillSlug = optionalString(payload.skillSlug) ?? (operation === "feature_execution" ? "feat-implement-skill" : undefined);
  const projectId = trigger.projectId ?? optionalString(payload.projectId);
  const project = projectId ? getProject(dbPath, projectId) : undefined;
  const workspaceRoot = scheduleRunWorkspaceRoot(dbPath, projectId, project?.targetRepoPath);
  const featureSpecPath = featureSpecPathForScheduleRun(dbPath, workspaceRoot, featureId);
  const featureFolder = featureSpecPath?.replace(/^docs\/features\//, "");
  const specState = workspaceRoot && featureFolder && featureId
    ? readFileSpecState(workspaceRoot, featureFolder, featureId, new Date(acceptedAt))
    : undefined;
  if (operation === "feature_execution" && skillSlug === "feat-implement-skill") {
    const conflict = activeManualScheduleConflict(dbPath, {
      projectId,
      featureId,
      taskId,
      operation,
      specStateStatus: specState?.status,
      specStateExecutionId: specState?.currentJob?.executionId,
      specStateSchedulerJobId: specState?.currentJob?.schedulerJobId,
      sourceExecutionId: optionalString(payload.sourceExecutionId),
      sourceSchedulerJobId: optionalString(payload.sourceSchedulerJobId),
    });
    if (conflict.length > 0) {
      return { triggerId: trigger.id, blockedReasons: conflict };
    }
    if (isCompletedFeatureExecutionTarget(dbPath, projectId, featureId, specState?.status)) {
      return { triggerId: trigger.id, blockedReasons: [`${featureId ?? input.entityId} is already completed and cannot be scheduled again.`] };
    }
    const readiness = validateFeatureSpecExecutionInput(workspaceRoot, featureSpecPath);
    if (readiness.length > 0) {
      if (workspaceRoot && featureFolder && featureId) {
        writeFileSpecState(workspaceRoot, featureFolder, mergeFileSpecState(specState ?? readFileSpecState(workspaceRoot, featureFolder, featureId, new Date(acceptedAt)), {
          status: "blocked",
          executionStatus: "blocked",
          blockedReasons: readiness,
          nextAction: "Complete the Feature Spec documents, then resume this Feature.",
        }, { now: new Date(acceptedAt), source: "schedule_run", summary: readiness.join(" ") }));
      }
      return { triggerId: trigger.id, blockedReasons: readiness };
    }
  }
  const context = {
    featureId,
    taskId,
    featureSpecPath,
    specStatePath: featureFolder ? specStateRelativePath(featureFolder) : undefined,
    specState,
    sourcePaths: scheduleRunSourcePaths(payload, featureSpecPath, project.targetRepoPath),
    expectedArtifacts: scheduleRunExpectedArtifacts(payload),
    workspaceRoot,
    skillSlug,
    skillPhase: optionalString(payload.skillPhase) ?? operation,
  };
  const preferenceResolution = resolveExecutionPreference(dbPath, projectId, payload);
  if (preferenceResolution.blockedReasons.length > 0) {
    return { triggerId: trigger.id, blockedReasons: preferenceResolution.blockedReasons };
  }
  const executionPreference = preferenceResolution.preference;
  const runPayload = {
    executionId,
    operation,
    projectId,
    context: {
      ...context,
      executionPreference,
    },
    requestedAction: optionalString(payload.requestedAction) ?? operation,
    executionPreference,
  };
  const job = enqueueWithExecutionPreference(scheduler, runPayload, executionPreference);
  if (!job) {
    return { triggerId: trigger.id, blockedReasons: [`Scheduler does not support ${executionPreference.runMode}.run jobs.`] };
  }
  persistExecutionRecord(dbPath, {
    executionId,
    schedulerJobId: job.schedulerJobId,
    executorType: executionPreference.runMode,
    operation,
    projectId,
    context: runPayload.context,
    status: "queued",
    acceptedAt,
  });
  if (workspaceRoot && featureFolder && featureId) {
    writeFileSpecState(workspaceRoot, featureFolder, mergeFileSpecState(specState ?? readFileSpecState(workspaceRoot, featureFolder, featureId, new Date(acceptedAt)), {
      status: "queued",
      executionStatus: "queued",
      blockedReasons: [],
      currentJob: {
        schedulerJobId: job.schedulerJobId,
        executionId,
        operation,
        queuedAt: acceptedAt,
      },
      nextAction: "Waiting for Runner to start this Feature.",
    }, {
      now: new Date(acceptedAt),
      source: "schedule_run",
      summary: "Feature execution queued.",
      schedulerJobId: job.schedulerJobId,
      executionId,
    }));
  }
  return { triggerId: trigger.id, schedulerJobId: job.schedulerJobId, executionId };
}

function activeManualScheduleConflict(
  dbPath: string,
  input: {
    projectId?: string;
    featureId?: string;
    taskId?: string;
    operation: string;
    specStateStatus?: string;
    specStateExecutionId?: string;
    specStateSchedulerJobId?: string;
    sourceExecutionId?: string;
    sourceSchedulerJobId?: string;
  },
): string[] {
  const activeSpecState = normalizeScheduleStatus(input.specStateStatus);
  const sameSpecStateJob = Boolean(
    (input.sourceExecutionId && input.sourceExecutionId === input.specStateExecutionId)
    || (input.sourceSchedulerJobId && input.sourceSchedulerJobId === input.specStateSchedulerJobId),
  );
  if (!sameSpecStateJob && (activeSpecState === "queued" || activeSpecState === "running" || activeSpecState === "approval needed")) {
    const id = input.specStateExecutionId ?? input.specStateSchedulerJobId;
    return [`${input.taskId ?? input.featureId ?? "Target"} is already ${activeSpecState}${id ? ` (${id})` : ""}; cancel, finish, or retry the active run before scheduling again.`];
  }
  if (!input.projectId || (!input.featureId && !input.taskId)) return [];
  const activeStatuses = ["queued", "running", "approval_needed"];
  const executionRows = runSqlite(dbPath, [], [
    {
      name: "executions",
      sql: `SELECT id, status, context_json
        FROM execution_records
        WHERE project_id = ?
          AND operation = ?
          AND status IN ('queued', 'running', 'approval_needed')
        ORDER BY COALESCE(updated_at, started_at, created_at) DESC`,
      params: [input.projectId, input.operation],
    },
  ]).queries.executions;
  for (const row of executionRows) {
    if (input.sourceExecutionId && String(row.id) === input.sourceExecutionId) continue;
    const context = parseJsonObject(row.context_json);
    if (!scheduleTargetMatches(input, optionalString(context.featureId), optionalString(context.taskId))) {
      return [`Project already has active feature_execution ${String(row.id)} with status ${String(row.status)}. Finish, cancel, or review it before scheduling another Feature.`];
    }
    if (scheduleTargetMatches(input, optionalString(context.featureId), optionalString(context.taskId))) {
      return [`${input.taskId ?? input.featureId} already has active execution ${String(row.id)} with status ${String(row.status)}. Cancel, finish, or retry it before scheduling again.`];
    }
  }

  const jobRows = runSqlite(dbPath, [], [
    {
      name: "jobs",
      sql: `SELECT sj.id, sj.status, sj.payload_json
        FROM scheduler_job_records sj
        LEFT JOIN execution_records er ON er.scheduler_job_id = sj.id
        WHERE sj.status IN ('queued', 'running', 'approval_needed')
          AND er.id IS NULL
        ORDER BY COALESCE(sj.updated_at, sj.created_at) DESC`,
    },
  ]).queries.jobs;
  for (const row of jobRows) {
    if (input.sourceSchedulerJobId && String(row.id) === input.sourceSchedulerJobId) continue;
    if (!activeStatuses.includes(String(row.status))) continue;
    const payload = parseJsonObject(row.payload_json);
    const payloadContext = parseJsonObject(payload.context);
    const projectId = optionalString(payload.projectId) ?? optionalString(payloadContext.projectId);
    const operation = optionalString(payload.operation) ?? optionalString(payload.requestedAction) ?? optionalString(payloadContext.operation) ?? input.operation;
    if (projectId !== input.projectId || operation !== input.operation) continue;
    const featureId = optionalString(payload.featureId) ?? optionalString(payloadContext.featureId);
    const taskId = optionalString(payload.taskId) ?? optionalString(payloadContext.taskId);
    if (!scheduleTargetMatches(input, featureId, taskId)) {
      return [`Project already has active scheduler job ${String(row.id)} with status ${String(row.status)}. Finish, cancel, or review it before scheduling another Feature.`];
    }
    if (scheduleTargetMatches(input, featureId, taskId)) {
      return [`${input.taskId ?? input.featureId} already has active scheduler job ${String(row.id)} with status ${String(row.status)}. Cancel, finish, or retry it before scheduling again.`];
    }
  }
  return [];
}

function scheduleTargetMatches(input: { featureId?: string; taskId?: string }, activeFeatureId?: string, activeTaskId?: string): boolean {
  if (input.taskId) return activeTaskId === input.taskId || (!activeTaskId && activeFeatureId === input.featureId);
  return Boolean(input.featureId && activeFeatureId === input.featureId);
}

function normalizeScheduleStatus(status: string | undefined): string {
  return (status ?? "").toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
}

function isCompletedFeatureExecutionTarget(
  dbPath: string,
  projectId: string | undefined,
  featureId: string | undefined,
  specStateStatus: string | undefined,
): boolean {
  if (isCompletedFeatureStatusValue(specStateStatus)) return true;
  if (!projectId || !featureId) return false;
  const rows = runSqlite(dbPath, [], [
    {
      name: "feature",
      sql: "SELECT status FROM features WHERE project_id = ? AND id = ? LIMIT 1",
      params: [projectId, featureId],
    },
  ]).queries.feature;
  return isCompletedFeatureStatusValue(optionalString(rows[0]?.status));
}

function isCompletedFeatureStatusValue(status: string | undefined): boolean {
  const normalized = (status ?? "").toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
  return normalized === "done" || normalized === "completed" || normalized === "delivered";
}

function validateFeatureSpecExecutionInput(workspaceRoot?: string, featureSpecPath?: string): string[] {
  if (!workspaceRoot) return ["Feature execution requires a project workspace root."];
  if (!featureSpecPath) return ["Feature execution requires a Feature Spec directory."];
  const normalized = featureSpecPath.replaceAll("\\", "/");
  if (isAbsolute(normalized) || normalized.startsWith("..") || normalized.includes("/../")) {
    return [`Feature Spec path must stay inside the workspace: ${featureSpecPath}`];
  }
  return validateFeatureSpecDirectory(workspaceRoot, normalized);
}

function validateFeatureSpecDirectory(workspaceRoot: string, featureSpecPath: string): string[] {
  const normalized = featureSpecPath.replaceAll("\\", "/");
  if (isAbsolute(normalized) || normalized.startsWith("..") || normalized.includes("/../")) {
    return [`Feature Spec path must stay inside the workspace: ${featureSpecPath}`];
  }
  const required = ["requirements.md", "design.md", "tasks.md"];
  const missing = required.filter((file) => !existsSync(join(workspaceRoot, normalized, file)));
  return missing.length > 0
    ? [`Feature execution requires a complete Feature Spec directory: ${normalized} is missing ${missing.join(", ")}.`]
    : [];
}

function scheduleRunWorkspaceRoot(dbPath: string, projectId?: string, targetRepoPath?: string): string | undefined {
  if (targetRepoPath) return targetRepoPath;
  if (!projectId) return undefined;
  const result = runSqlite(dbPath, [], [
    {
      name: "repository",
      sql: `SELECT local_path FROM repository_connections
        WHERE project_id = ?
        ORDER BY connected_at DESC
        LIMIT 1`,
      params: [projectId],
    },
  ]);
  return optionalString(result.queries.repository[0]?.local_path);
}

function featureSpecPathForScheduleRun(dbPath: string, targetRepoPath?: string, featureId?: string): string | undefined {
  if (!featureId) return undefined;
  const docsFeature = targetRepoPath
    ? listFeatureSpecsFromDocs(targetRepoPath, []).find((feature) => feature.id === featureId)
    : undefined;
  if (docsFeature?.folder) return `docs/features/${docsFeature.folder}`;
  const result = runSqlite(dbPath, [], [
    { name: "features", sql: "SELECT folder FROM features WHERE id = ? LIMIT 1", params: [featureId] },
  ]);
  const folder = optionalString(result.queries.features[0]?.folder);
  return `docs/features/${folder ?? featureId}`;
}

function scheduleRunSourcePaths(payload: Record<string, unknown>, featureSpecPath?: string, workspaceRoot?: string): string[] {
  const requested = optionalStringArray(payload.sourcePaths);
  if (requested.length > 0) return requested;
  const projectDocs = projectSpecPaths(workspaceRoot);
  return [
    projectDocs.prd,
    projectDocs.requirements,
    projectDocs.hld,
    ...(featureSpecPath ? [
      `${featureSpecPath}/requirements.md`,
      `${featureSpecPath}/design.md`,
      `${featureSpecPath}/tasks.md`,
    ] : []),
  ];
}

function scheduleRunExpectedArtifacts(payload: Record<string, unknown>): string[] {
  const requested = optionalStringArray(payload.expectedArtifacts);
  return requested.length > 0 ? requested : [".autobuild/reports/feature-execution.json"];
}

type EnqueueNextFeatureExecutionResult = {
  featureIds: string[];
  scheduleTriggerId?: string;
  schedulerJobId?: string;
  executionId?: string;
  blockedReasons: string[];
  selectionBlockedReasons?: string[];
  automationEnabled?: boolean;
};

function executeAutoRunCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
  scheduler: SchedulerClient,
): EnqueueNextFeatureExecutionResult | undefined {
  if (!["start_auto_run", "pause_runner", "resume_runner"].includes(input.action)) {
    return undefined;
  }
  if (input.action === "pause_runner" || input.action === "resume_runner") {
    const payload = parseJsonObject(input.payload);
    const projectId = optionalString(payload.projectId);
    if (projectId) {
      runSqlite(dbPath, [
        {
          sql: "UPDATE projects SET automation_enabled = ?, updated_at = ? WHERE id = ?",
          params: [input.action === "resume_runner" ? 1 : 0, acceptedAt, projectId],
        },
      ]);
    }
    return {
      featureIds: [],
      blockedReasons: [],
      automationEnabled: input.action === "resume_runner",
    };
  }
  if (input.entityType !== "project") {
    return { featureIds: [], blockedReasons: ["Auto Run commands require a project entity."] };
  }
  const project = getProject(dbPath, input.entityId);
  if (!project) {
    return { featureIds: [], blockedReasons: [`Project not found: ${input.entityId}`] };
  }
  runSqlite(dbPath, [
    {
      sql: "UPDATE projects SET automation_enabled = 1, updated_at = ? WHERE id = ?",
      params: [acceptedAt, input.entityId],
    },
  ]);
  const selection = enqueueNextFeatureExecutionFromQueue(dbPath, {
    projectId: input.entityId,
    payload: parseJsonObject(input.payload),
    acceptedAt,
    scheduler,
    commandSource: "start_auto_run",
  });
  return {
    ...selection,
    blockedReasons: [],
    selectionBlockedReasons: selection.blockedReasons,
    automationEnabled: true,
  };
}

function executeFeatureReviewCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
): ({ blockedReasons: string[]; featureId?: string; specStatePath?: string } & Record<string, unknown>) | undefined {
  if (input.action !== "mark_feature_complete") {
    return undefined;
  }
  if (input.entityType !== "feature") {
    return { blockedReasons: ["Feature review completion requires a feature entity."] };
  }
  const payload = parseJsonObject(input.payload);
  const featureId = input.entityId.toUpperCase();
  const projectId = optionalString(payload.projectId);
  const project = projectId ? getProject(dbPath, projectId) : undefined;
  const workspaceRoot = scheduleRunWorkspaceRoot(dbPath, projectId, project?.targetRepoPath);
  if (!workspaceRoot) {
    return { blockedReasons: ["Feature review completion requires a project workspace root."], featureId };
  }
  const featureSpecPath = featureSpecPathForScheduleRun(dbPath, workspaceRoot, featureId);
  const featureFolder = featureSpecPath?.replace(/^docs\/features\//, "");
  if (!featureFolder) {
    return { blockedReasons: [`Feature Spec directory not found for ${featureId}.`], featureId };
  }
  const now = new Date(acceptedAt);
  const current = readFileSpecState(workspaceRoot, featureFolder, featureId, now);
  if (current.status !== "review_needed") {
    return {
      blockedReasons: [`${featureId} is ${current.status}; only review_needed Features can be passed from Review.`],
      featureId,
      specStatePath: specStateRelativePath(featureFolder),
    };
  }
  const summary = optionalString(payload.summary) ?? "Operator passed Review Needed Feature; status marked completed.";
  const lastResult = current.lastResult
    ? {
      ...current.lastResult,
      status: "completed" as const,
      summary: current.lastResult.summary,
      completedAt: acceptedAt,
    }
    : {
      status: "completed" as const,
      summary,
      producedArtifacts: [],
      completedAt: acceptedAt,
    };
  const nextState = mergeFileSpecState(current, {
    status: "completed",
    executionStatus: "completed",
    blockedReasons: [],
    lastResult,
    nextAction: "Feature review passed; ready for downstream dependency selection or delivery.",
    currentJob: current.currentJob ? { ...current.currentJob, completedAt: current.currentJob.completedAt ?? acceptedAt } : undefined,
  }, {
    now,
    source: "feature-review",
    summary,
    schedulerJobId: current.currentJob?.schedulerJobId,
    executionId: current.currentJob?.executionId,
  });
  const specStatePath = writeFileSpecState(workspaceRoot, featureFolder, nextState);
  runSqlite(dbPath, [
    {
      sql: "UPDATE features SET status = ?, updated_at = ? WHERE id = ? AND (? IS NULL OR project_id = ?)",
      params: ["completed", acceptedAt, featureId, projectId ?? null, projectId ?? null],
    },
    {
      sql: `UPDATE review_items
        SET status = 'approved', updated_at = ?
        WHERE feature_id = ? AND status IN ('review_needed', 'changes_requested', 'rejected')`,
      params: [acceptedAt, featureId],
    },
  ]);
  return { blockedReasons: [], featureId, specStatePath, status: "completed" };
}

function resolveExecutionPreference(
  dbPath: string,
  projectId: string | undefined,
  payload: Record<string, unknown>,
): { preference: ExecutionPreferenceV1; blockedReasons: string[] } {
  const cliRows = readCliAdapterRows(dbPath);
  const rpcRows = readRpcAdapterRows(dbPath);
  const payloadPreference = isRecord(payload.executionPreference) ? payload.executionPreference : undefined;
  if (payloadPreference) {
    const resolved = executionPreferenceForAdapterId(optionalString(payloadPreference.adapterId), cliRows, rpcRows, "job");
    return resolved.preference
      ? { preference: resolved.preference, blockedReasons: resolved.errors }
      : { preference: { runMode: "cli", adapterId: optionalString(payloadPreference.adapterId) ?? "", source: "job" }, blockedReasons: resolved.errors };
  }
  const row = projectId
    ? runSqlite(dbPath, [], [
      { name: "preference", sql: "SELECT run_mode, adapter_id FROM project_execution_preferences WHERE project_id = ? LIMIT 1", params: [projectId] },
    ]).queries.preference[0]
    : undefined;
  if (row) {
    const preference: ExecutionPreferenceV1 = {
      runMode: String(row.run_mode) === "rpc" ? "rpc" : "cli",
      adapterId: String(row.adapter_id),
      source: "project",
    };
    const validation = validateExecutionPreference(preference, cliRows, rpcRows);
    return { preference, blockedReasons: validation.errors };
  }
  const activeCli = adapterFromRows(cliRows, "active") ?? DEFAULT_CLI_ADAPTER_CONFIG;
  const preference: ExecutionPreferenceV1 = {
    runMode: "cli",
    adapterId: activeCli.id,
    source: "default",
  };
  const validation = validateExecutionPreference(preference, cliRows, rpcRows);
  return { preference, blockedReasons: validation.errors };
}

function enqueueWithExecutionPreference(
  scheduler: SchedulerClient,
  payload: Parameters<SchedulerClient["enqueueCliRun"]>[0] & { executionPreference: ExecutionPreferenceV1 },
  preference: ExecutionPreferenceV1,
) {
  if (preference.runMode === "rpc") {
    return scheduler.enqueueRpcRun?.(payload);
  }
  return scheduler.enqueueCliRun(payload);
}

function enqueueNextFeatureExecutionFromQueue(
  dbPath: string,
  input: {
    projectId: string;
    payload: Record<string, unknown>;
    acceptedAt: string;
    scheduler: SchedulerClient;
    triggerId?: string;
    triggerAccepted?: boolean;
    commandSource: "schedule_run" | "start_auto_run";
  },
): EnqueueNextFeatureExecutionResult {
  const { acceptedAt, scheduler } = input;
  const project = getProject(dbPath, input.projectId);
  if (!project) {
    return { featureIds: [], blockedReasons: [`Project not found: ${input.projectId}`] };
  }
  if (!project.targetRepoPath) {
    return { featureIds: [], blockedReasons: ["Project repository path is required before scheduling autonomous Feature execution."] };
  }
  const payload = input.payload;
  const resumeFeatureId = optionalString(payload.resumeFeatureId)?.toUpperCase();
  const skipFeatureIds = [
    ...optionalStringArray(payload.skipFeatureIds),
    ...(optionalString(payload.skipFeatureId) ? [optionalString(payload.skipFeatureId)!] : []),
  ].map((value) => value.toUpperCase());

  const docsFeatures = listFeatureSpecsFromDocs(project.targetRepoPath, []);
  if (docsFeatures.length === 0) {
    return { featureIds: [], blockedReasons: ["No completed Feature Spec packages found under docs/features."] };
  }

  const queuePlan = readFeaturePoolQueuePlan(project.targetRepoPath);
  if (queuePlan.blockedReasons.length > 0) {
    return { featureIds: [], blockedReasons: queuePlan.blockedReasons };
  }
  const docsById = new Map(docsFeatures.map((feature) => [feature.id, feature]));
  const featureIds = queuePlan.entries.map((entry) => entry.id);
  const missingPlannedFeatures = featureIds.filter((featureId) => !docsById.has(featureId));
  if (missingPlannedFeatures.length > 0) {
    return {
      featureIds: [],
      blockedReasons: [`Feature Pool Queue plan references missing Feature Specs: ${missingPlannedFeatures.join(", ")}.`],
    };
  }
  const missingDependencies = queuePlan.entries
    .flatMap((entry) => entry.dependencies.filter((dependency) => !featureIds.includes(dependency)).map((dependency) => `${entry.id}->${dependency}`));
  if (missingDependencies.length > 0) {
    return {
      featureIds: [],
      blockedReasons: [`Feature Pool Queue plan references missing dependencies: ${missingDependencies.join(", ")}.`],
    };
  }
  runSqlite(dbPath, queuePlan.entries.map((entry) => {
    const feature = docsById.get(entry.id)!;
    const state = readFileSpecState(project.targetRepoPath, feature.folder ?? feature.id.toLowerCase(), feature.id, new Date(acceptedAt));
    writeFileSpecState(project.targetRepoPath, feature.folder ?? feature.id.toLowerCase(), mergeFileSpecState(state, {
      dependencies: entry.dependencies,
    }, {
      now: new Date(acceptedAt),
      source: "feature-pool-queue",
      summary: "Feature queue metadata synchronized from feature-pool-queue.json.",
    }));
    return {
    sql: `INSERT INTO features (
        id, project_id, title, status, priority, folder, primary_requirements_json, dependencies_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        status = excluded.status,
        priority = excluded.priority,
        folder = excluded.folder,
        primary_requirements_json = excluded.primary_requirements_json,
        dependencies_json = excluded.dependencies_json,
        updated_at = excluded.updated_at`,
    params: [
      feature.id,
      project.id,
      feature.title,
      feature.status === "draft" ? "draft" : "ready",
      entry.priority,
      feature.folder ?? feature.id.toLowerCase(),
      JSON.stringify(feature.primaryRequirements),
      JSON.stringify(entry.dependencies),
      acceptedAt,
    ],
    };
  }));

  const trigger = input.triggerId
    ? { id: input.triggerId, result: input.triggerAccepted === false ? "blocked" : "accepted" }
    : persistScheduleTrigger(
      dbPath,
      createScheduleTrigger({
        projectId: project.id,
        mode: "manual",
        requestedFor: acceptedAt,
        source: "product_console",
        target: { type: "project", id: project.id },
        boundaryEvidence: [queuePlan.path],
        now: new Date(acceptedAt),
      }),
    );
  if (trigger.result !== "accepted") {
    return { featureIds, scheduleTriggerId: trigger.id, blockedReasons: [] };
  }
  const selection = selectFeaturePoolQueueEntry({
    dbPath,
    entries: queuePlan.entries,
    projectId: project.id,
    projectPath: project.targetRepoPath,
    docsById,
    resumeFeatureId,
    skipFeatureIds,
    payload,
    now: new Date(acceptedAt),
  });
  const selected = selection.selected;
  if (!selected) {
    return {
      featureIds,
      scheduleTriggerId: trigger.id,
      blockedReasons: selection.blockedReasons.length > 0
        ? selection.blockedReasons
        : ["No executable Feature Spec found in feature-pool-queue.json."],
    };
  }
  const selectedFeature = docsById.get(selected.id)!;
  const featureSpecPath = `docs/features/${selectedFeature.folder ?? selected.id.toLowerCase()}`;
  const selectedFolder = selectedFeature.folder ?? selected.id.toLowerCase();
  const specState = readFileSpecState(project.targetRepoPath, selectedFolder, selected.id, new Date(acceptedAt));
  const executionId = randomUUID();
  const projectDocs = projectSpecPaths(project.targetRepoPath);
  const context = {
    featureId: selected.id,
    featureSpecPath,
    specStatePath: specStateRelativePath(selectedFolder),
    specState,
    sourcePaths: [
      projectDocs.prd,
      projectDocs.requirements,
      projectDocs.hld,
      `${featureSpecPath}/requirements.md`,
      `${featureSpecPath}/design.md`,
      `${featureSpecPath}/tasks.md`,
    ],
    expectedArtifacts: [".autobuild/reports/feature-execution.json"],
    workspaceRoot: project.targetRepoPath,
    skillSlug: "feat-implement-skill",
    skillPhase: "feature_execution",
    selection: selection.decision ? {
      skillSlug: "feature-selection-skill",
      requestedAction: "select_next_feature",
      source: selection.decision.source,
      reason: selection.decision.reason,
      blockedReasons: selection.decision.blockedReasons,
      dependencyFindings: selection.decision.dependencyFindings,
    } : undefined,
  };
  const preferenceResolution = resolveExecutionPreference(dbPath, project.id, payload);
  if (preferenceResolution.blockedReasons.length > 0) {
    return { featureIds, scheduleTriggerId: trigger.id, blockedReasons: preferenceResolution.blockedReasons };
  }
  const executionPreference = preferenceResolution.preference;
  const runPayload = {
    executionId,
    operation: "feature_execution",
    projectId: project.id,
    context: {
      ...context,
      executionPreference,
    },
    executionPreference,
  };
  const job = enqueueWithExecutionPreference(scheduler, runPayload, executionPreference);
  if (!job) {
    return { featureIds, scheduleTriggerId: trigger.id, blockedReasons: [`Scheduler does not support ${executionPreference.runMode}.run jobs.`] };
  }
  persistExecutionRecord(dbPath, {
    executionId,
    schedulerJobId: job.schedulerJobId,
    executorType: executionPreference.runMode,
    operation: "feature_execution",
    projectId: project.id,
    context: runPayload.context,
    status: "queued",
    acceptedAt,
  });
  writeFileSpecState(project.targetRepoPath, selectedFolder, mergeFileSpecState(specState, {
    status: "queued",
    executionStatus: "queued",
    blockedReasons: [],
    currentJob: {
      schedulerJobId: job.schedulerJobId,
      executionId,
      operation: "feature_execution",
      queuedAt: acceptedAt,
    },
    nextAction: "Waiting for Runner to start this Feature.",
  }, {
    now: new Date(acceptedAt),
      source: input.commandSource,
      summary: selection.decision?.reason ?? (resumeFeatureId === selected.id ? "Blocked Feature resumed and queued." : "Next ready Feature queued."),
    schedulerJobId: job.schedulerJobId,
    executionId,
  }));
  return { featureIds, scheduleTriggerId: trigger.id, schedulerJobId: job.schedulerJobId, executionId, blockedReasons: [] };
}

function executeSpecSkillCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
  scheduler: SchedulerClient,
  specIntakeResult?: ({ blockedReasons: string[] } & Record<string, unknown>),
): { executionId: string; schedulerJobId: string; skillSlug: string; workspaceRoot?: string } | undefined {
  if (!["intake_requirement", "resolve_clarification", "generate_ears", "generate_hld", "generate_ui_spec", "split_feature_specs"].includes(input.action)) {
    return undefined;
  }
  const payload = parseJsonObject(input.payload);
  const projectId = input.entityType === "project"
    ? input.entityId
    : optionalString(payload.projectId);
  if (!projectId) {
    return undefined;
  }
  const project = getProject(dbPath, projectId);
  if (!project) {
    return undefined;
  }
  const featureId = input.action === "generate_hld"
    ? undefined
    : optionalString(specIntakeResult?.featureId)
      ?? optionalString(payload.featureId)
      ?? (input.entityType === "feature" ? input.entityId : undefined);
  const executionId = randomUUID();
  const skillSlug = skillSlugForSpecAction(input.action);
  const sourcePaths = sourcePathsForSpecAction(input.action, payload, featureId, project.targetRepoPath);
  const imagePaths = imagePathsForSpecAction(input.action, payload);
  const expectedArtifacts = expectedArtifactsForSpecAction(input.action, featureId, sourcePaths, project.targetRepoPath);
  const context = {
    featureId,
    sourcePaths,
    imagePaths,
    expectedArtifacts,
    workspaceRoot: project.targetRepoPath,
    skillSlug,
    skillPhase: input.action,
    clarificationText: optionalString(payload.clarificationText),
    requirementText: optionalString(payload.requirementText),
    comment: optionalString(payload.comment),
    targetRequirementId: optionalString(payload.targetRequirementId),
    traceability: optionalStringArray(payload.traceability),
    specChangeIntent: isRecord(payload.specChangeRequest) ? optionalString(payload.specChangeRequest.intent) : undefined,
  };
  const job = scheduler.enqueueCliRun({
    executionId,
    operation: input.action,
    projectId,
    context,
    requestedAction: input.action,
    traceability: {
      requirementIds: optionalStringArray(payload.requirementIds),
    },
  });
  persistExecutionRecord(dbPath, {
    executionId,
    schedulerJobId: job.schedulerJobId,
    executorType: "cli",
    operation: input.action,
    projectId,
    context,
    status: "queued",
    acceptedAt,
    metadata: {
      commandAction: input.action,
      scheduler: "bullmq",
      workspaceRoot: project.targetRepoPath,
      skillSlug,
      skillPhase: input.action,
    },
  });
  return { executionId, schedulerJobId: job.schedulerJobId, skillSlug, workspaceRoot: project.targetRepoPath };
}

function skillSlugForSpecAction(action: ConsoleCommandAction): string {
  if (action === "intake_requirement") return "requirement-intake-skill";
  if (action === "resolve_clarification") return "ambiguity-clarification-skill";
  if (action === "generate_ears") return "pr-ears-requirement-decomposition-skill";
  if (action === "generate_hld") return "create-project-hld";
  if (action === "generate_ui_spec") return "ui-spec-skill";
  return "task-slicing-skill";
}

function sourcePathsForSpecAction(
  action: ConsoleCommandAction,
  payload: Record<string, unknown>,
  featureId?: string,
  workspaceRoot?: string,
): string[] {
  const requested = optionalStringArray(payload.sourcePaths);
  if (requested.length > 0) return requested;
  const payloadSourcePath = workspaceRelativeSourcePath(
    optionalString(payload.sourcePath),
    optionalString(payload.resolvedSourcePath),
    workspaceRoot,
  );
  if (action === "intake_requirement" || action === "resolve_clarification" || action === "generate_ears") {
    return [payloadSourcePath ?? projectSpecPaths(workspaceRoot).prd];
  }
  if (action === "split_feature_specs") {
    const projectDocs = projectSpecPaths(workspaceRoot);
    return uniqueSourcePaths([
      ...(payloadSourcePath ? [payloadSourcePath, requirementsArtifactForSource(payloadSourcePath, workspaceRoot)] : []),
      projectDocs.prd,
      projectDocs.requirements,
      projectDocs.hld,
      "docs/features/README.md",
    ]);
  }
  if (action === "generate_ui_spec") {
    const projectDocs = projectSpecPaths(workspaceRoot);
    return [
      projectDocs.prd,
      projectDocs.requirements,
      projectDocs.hld,
      "docs/features/README.md",
      ...(featureId ? [`docs/features/${featureId}/requirements.md`] : []),
    ];
  }
  const projectDocs = projectSpecPaths(workspaceRoot);
  return [
    projectDocs.prd,
    projectDocs.requirements,
    projectDocs.hld,
    ...(featureId ? [`docs/features/${featureId}/requirements.md`] : []),
  ];
}

function uniqueSourcePaths(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function workspaceRelativeSourcePath(sourcePath?: string, resolvedSourcePath?: string, workspaceRoot?: string): string | undefined {
  const candidates = [sourcePath, resolvedSourcePath];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const relativeSource = isAbsolute(candidate) && workspaceRoot
      ? relative(workspaceRoot, candidate)
      : candidate;
    if (!relativeSource || relativeSource.startsWith("..") || isAbsolute(relativeSource)) {
      continue;
    }
    return relativeSource.replaceAll("\\", "/");
  }
  return undefined;
}

type ProjectSpecPaths = {
  prd: string;
  requirements: string;
  hld: string;
};

function projectSpecPaths(workspaceRoot?: string): ProjectSpecPaths {
  if (!workspaceRoot) return rootProjectSpecPaths();
  if (hasAnyProjectSpecFile(workspaceRoot, "docs")) return rootProjectSpecPaths();
  if (hasMultilingualSpecSupport(workspaceRoot)) {
    for (const language of preferredSpecLanguages(workspaceRoot)) {
      const root = `docs/${language}`;
      if (hasAnyProjectSpecFile(workspaceRoot, root)) {
        return {
          prd: `${root}/PRD.md`,
          requirements: `${root}/requirements.md`,
          hld: `${root}/hld.md`,
        };
      }
    }
  }
  return rootProjectSpecPaths();
}

function rootProjectSpecPaths(): ProjectSpecPaths {
  return {
    prd: "docs/PRD.md",
    requirements: "docs/requirements.md",
    hld: "docs/hld.md",
  };
}

function hasAnyProjectSpecFile(workspaceRoot: string, root: string): boolean {
  return existsSync(join(workspaceRoot, root, "PRD.md"))
    || existsSync(join(workspaceRoot, root, "requirements.md"))
    || existsSync(join(workspaceRoot, root, "hld.md"));
}

function hasMultilingualSpecSupport(workspaceRoot: string): boolean {
  const docsReadme = join(workspaceRoot, "docs", "README.md");
  if (existsSync(docsReadme)) {
    const content = readFileSafe(docsReadme).toLowerCase();
    if (content.includes("default language") || content.includes("languages:") || content.includes("multilingual")) {
      return true;
    }
  }
  return ["en", "zh-CN", "ja"].filter((language) => hasAnyProjectSpecFile(workspaceRoot, `docs/${language}`)).length > 1;
}

function preferredSpecLanguages(workspaceRoot: string): string[] {
  const docsReadme = join(workspaceRoot, "docs", "README.md");
  if (existsSync(docsReadme)) {
    const content = readFileSafe(docsReadme).toLowerCase();
    if (content.includes("default language: english")) return ["en", "zh-CN", "ja"];
    if (content.includes("default language: 中文") || content.includes("default language: chinese")) return ["zh-CN", "en", "ja"];
    if (content.includes("default language: japanese") || content.includes("default language: 日本")) return ["ja", "en", "zh-CN"];
  }
  return ["en", "zh-CN", "ja"];
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function imagePathsForSpecAction(action: ConsoleCommandAction, payload: Record<string, unknown>): string[] | undefined {
  const requested = optionalStringArray(payload.imagePaths);
  if (requested.length > 0) return requested;
  return undefined;
}

function expectedArtifactsForSpecAction(
  action: ConsoleCommandAction,
  featureId?: string,
  sourcePaths: string[] = [],
  workspaceRoot?: string,
): string[] {
  if (action === "intake_requirement" || action === "generate_ears") {
    return [requirementsArtifactForSource(sourcePaths[0], workspaceRoot)];
  }
  if (action === "resolve_clarification") {
    return featureId
      ? [`docs/features/${featureId}/requirements.md`, `docs/features/${featureId}/design.md`]
      : [requirementsArtifactForSource(sourcePaths[0], workspaceRoot)];
  }
  if (action === "split_feature_specs") {
    return [
      "docs/features/README.md",
      "docs/features/<feature-id>/requirements.md",
      "docs/features/<feature-id>/design.md",
      "docs/features/<feature-id>/tasks.md",
      "docs/features/feature-pool-queue.json",
    ];
  }
  if (action === "generate_hld") {
    return [projectSpecPaths(workspaceRoot).hld];
  }
  if (action === "generate_ui_spec") {
    return [
      ...(featureId ? [`docs/features/${featureId}/ui-spec.md`] : ["docs/ui/ui-spec.md"]),
      "docs/ui/concepts/<page-id>.svg",
    ];
  }
  return featureId ? [`docs/features/${featureId}/tasks.md`] : ["docs/features/README.md"];
}

function requirementsArtifactForSource(sourcePath?: string, workspaceRoot?: string): string {
  const fallback = projectSpecPaths(workspaceRoot).requirements;
  if (!sourcePath) return fallback;
  const relativeSource = isAbsolute(sourcePath) && workspaceRoot
    ? relative(workspaceRoot, sourcePath)
    : sourcePath;
  if (!relativeSource || relativeSource.startsWith("..") || isAbsolute(relativeSource)) {
    return fallback;
  }
  if (basename(relativeSource) === "PRD.md") {
    if (workspaceRoot && isLocalizedProjectSpecPath(relativeSource) && !hasMultilingualSpecSupport(workspaceRoot)) {
      return rootProjectSpecPaths().requirements;
    }
    const folder = dirname(relativeSource);
    return (folder === "." ? "requirements.md" : join(folder, "requirements.md")).replaceAll("\\", "/");
  }
  const folder = dirname(relativeSource);
  const artifact = folder === "." ? "requirements.md" : join(folder, "requirements.md");
  return artifact.replaceAll("\\", "/");
}

function isLocalizedProjectSpecPath(relativeSource: string): boolean {
  return /^docs\/(en|zh-CN|ja)\/PRD\.md$/.test(relativeSource.replaceAll("\\", "/"));
}

function writeSpecIntakeArtifact(projectPath: string, directory: string, fileName: string, value: unknown): string {
  return writeSpecTextArtifact(projectPath, directory, fileName, `${JSON.stringify(value, null, 2)}\n`);
}

function writeSpecTextArtifact(projectPath: string, directory: string, fileName: string, content: string): string {
  const relativePath = join(".autobuild", directory, sanitizeArtifactName(fileName));
  const fullPath = join(projectPath, relativePath);
  mkdirSync(join(projectPath, ".autobuild", directory), { recursive: true, mode: 0o700 });
  writeFileSync(fullPath, content, { encoding: "utf8", mode: 0o600 });
  return relativePath;
}

function recordSpecIntakeEvidence(
  dbPath: string,
  input: { featureId?: string; path: string; kind: string; summary: string; metadata: unknown },
): string {
  const id = randomUUID();
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO status_check_results (
        id, run_id, task_id, feature_id, status, summary, reasons_json, recommended_actions_json,
        kind, path, metadata_json, execution_result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        `SPEC-INTAKE-${id}`,
        null,
        input.featureId ?? null,
        "done",
        input.summary,
        "[]",
        "[]",
        input.kind,
        input.path,
        JSON.stringify(input.metadata),
        "{}",
      ],
    },
  ]);
  return id;
}

function selectSpecSource(
  projectPath: string,
  payload: Record<string, unknown>,
  scan: SpecSourceScanSummary,
): { sourcePath: string; resolvedSourcePath: string; sourceVersion?: string } | undefined {
  const requestedSourcePath = optionalString(payload.sourcePath);
  const requestedSource = scan.sources.find((source) => source.relativePath === requestedSourcePath);
  const source = requestedSource
    ?? scan.sources.find((entry) => entry.fileType === "PRD")
    ?? scan.sources.find((entry) => entry.fileType === "EARS")
    ?? scan.sources.find((entry) => entry.fileType === "README")
    ?? scan.sources[0];
  if (!source) {
    return undefined;
  }
  return {
    sourcePath: source.relativePath,
    resolvedSourcePath: join(projectPath, source.relativePath),
    sourceVersion: source.version,
  };
}

function resolveSpecInput(
  projectPath: string,
  payload: Record<string, unknown>,
  scan: SpecSourceScanSummary,
): { content: string; sourcePath?: string; resolvedSourcePath?: string } {
  const uploadedContent = optionalString(payload.contentPreview);
  if (uploadedContent) {
    const sourcePath = optionalString(payload.sourcePath) ?? optionalString(payload.fileName);
    return {
      content: uploadedContent,
      sourcePath,
      resolvedSourcePath: sourcePath ? join(projectPath, sourcePath) : undefined,
    };
  }

  const requestedSourcePath = optionalString(payload.sourcePath);
  const candidates = [
    requestedSourcePath,
    scan.sources.find((source) => source.fileType === "PRD")?.relativePath,
    scan.sources.find((source) => source.fileType === "EARS")?.relativePath,
    scan.sources[0]?.relativePath,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      return {
        content: readFileSync(join(projectPath, candidate), "utf8"),
        sourcePath: candidate,
        resolvedSourcePath: join(projectPath, candidate),
      };
    } catch {
      continue;
    }
  }
  return { content: "" };
}

function persistGeneratedFeatureSpec(dbPath: string, projectId: string, spec: FeatureSpec): void {
  const requirementIds = spec.requirements.map((requirement) => `${spec.id}-${requirement.id}`);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO features (id, project_id, title, folder, primary_requirements_json, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          folder = excluded.folder,
          primary_requirements_json = excluded.primary_requirements_json,
          status = excluded.status,
          updated_at = excluded.updated_at`,
      params: [
        spec.id,
        projectId,
        spec.name,
        spec.id.toLowerCase(),
        JSON.stringify(requirementIds),
        spec.status,
      ],
    },
    ...spec.requirements.map((requirement, index) => {
      const id = `${spec.id}-${requirement.id}`;
      const criteria = spec.acceptanceCriteria.find((item) => item.requirementId === requirement.id);
      return {
        sql: `INSERT INTO requirements (id, feature_id, source_id, body, acceptance_criteria, priority, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            feature_id = excluded.feature_id,
            source_id = excluded.source_id,
            body = excluded.body,
            acceptance_criteria = excluded.acceptance_criteria,
            priority = excluded.priority,
            status = excluded.status,
            updated_at = excluded.updated_at`,
        params: [
          id,
          spec.id,
          `${requirement.source.label}${requirement.source.lineNumber ? `:${requirement.source.lineNumber}` : ""}`,
          requirement.statement,
          criteria?.description ?? "",
          index === 0 ? "must" : "should",
        ],
      };
    }),
  ]);
}

function nextGeneratedFeatureId(dbPath: string): string {
  const result = runSqlite(dbPath, [], [
    { name: "features", sql: "SELECT id FROM features WHERE id LIKE 'FEAT-INTAKE-%' ORDER BY id DESC LIMIT 1" },
  ]);
  const latest = optionalString(result.queries.features[0]?.id);
  const nextNumber = latest ? Number(latest.replace(/^FEAT-INTAKE-/, "")) + 1 : 1;
  return `FEAT-INTAKE-${String(Number.isFinite(nextNumber) ? nextNumber : 1).padStart(3, "0")}`;
}

function detectSpecSourceType(sourcePath?: string): "PRD" | "EARS" | "mixed" {
  const normalized = sourcePath?.toLowerCase() ?? "";
  if (normalized.includes("requirements") || normalized.includes("ears")) {
    return "EARS";
  }
  if (normalized.includes("prd") || normalized.includes("pr.md") || normalized.includes("rp.md")) {
    return "PRD";
  }
  return "mixed";
}

function sanitizeArtifactName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "spec-source.md";
}

function validateBoardCommand(dbPath: string, input: ConsoleCommandInput): { blockedReasons: string[] } {
  if (!["move_board_task", "schedule_board_tasks", "run_board_tasks"].includes(input.action)) {
    return { blockedReasons: [] };
  }
  const taskIds = boardCommandTaskIds(input);
  if (taskIds.length === 0) {
    return { blockedReasons: ["No board tasks selected."] };
  }
  if (taskScopedTaskIdsMismatch(input)) {
    return { blockedReasons: [`Task-scoped board command payload must match entity ${input.entityId}.`] };
  }
  const targetStatus = boardCommandTargetStatus(input);
  if (!targetStatus) {
    return { blockedReasons: ["Board command requires a valid targetStatus."] };
  }
  const result = runSqlite(dbPath, [], [
    {
      name: "graphTasks",
      sql: `SELECT id, feature_id, title, status, dependencies_json, risk FROM task_graph_tasks
        WHERE feature_id IN (SELECT feature_id FROM task_graph_tasks WHERE id IN (${placeholders(taskIds.length)}))
          OR id IN (${placeholders(taskIds.length)})`,
      params: [...taskIds, ...taskIds],
    },
    {
      name: "tasks",
      sql: `SELECT id, feature_id, title, status, depends_on_json AS dependencies_json, 'unknown' AS risk FROM tasks
        WHERE feature_id IN (SELECT feature_id FROM tasks WHERE id IN (${placeholders(taskIds.length)}))
          OR id IN (${placeholders(taskIds.length)})`,
      params: [...taskIds, ...taskIds],
    },
    { name: "reviews", sql: `SELECT id, task_id, feature_id, status, severity FROM review_items WHERE task_id IN (${placeholders(taskIds.length)})`, params: taskIds },
    {
      name: "approvals",
      sql: `SELECT ar.*, ri.task_id, ri.feature_id FROM approval_records ar JOIN review_items ri ON ri.id = ar.review_item_id
        WHERE ri.task_id IN (${placeholders(taskIds.length)})
          OR (
            ri.task_id IS NULL
            AND ri.feature_id IN (
              SELECT feature_id FROM task_graph_tasks WHERE id IN (${placeholders(taskIds.length)})
              UNION
              SELECT feature_id FROM tasks WHERE id IN (${placeholders(taskIds.length)})
            )
          )`,
      params: [...taskIds, ...taskIds, ...taskIds],
    },
    {
      name: "featureReviews",
      sql: `SELECT id, feature_id, status, severity FROM review_items
        WHERE task_id IS NULL
          AND feature_id IN (
            SELECT feature_id FROM task_graph_tasks WHERE id IN (${placeholders(taskIds.length)})
            UNION
            SELECT feature_id FROM tasks WHERE id IN (${placeholders(taskIds.length)})
          )`,
      params: [...taskIds, ...taskIds],
    },
  ]);
  const rows = result.queries.graphTasks.length > 0 ? result.queries.graphTasks : result.queries.tasks;
  const taskById = new Map(rows.map((row) => [String(row.id), row]));
  const blockedReasons: string[] = [];

  for (const taskId of taskIds) {
    const task = taskById.get(taskId);
    if (!task) {
      blockedReasons.push(`Task ${taskId} was not found.`);
      continue;
    }
    if (input.entityType === "feature" && task.feature_id !== input.entityId) {
      blockedReasons.push(`Task ${taskId} does not belong to feature ${input.entityId}.`);
      continue;
    }
    const from = normalizeBoardStatus(task.status);
    if (from === "unknown") {
      blockedReasons.push(`Task ${taskId} has unknown board status.`);
      continue;
    }
    try {
      transitionTask(taskId, from, targetStatus, {
        reason: input.reason,
        evidence: "product_console_board_command",
        triggeredBy: "product_console",
        occurredAt: normalizeCommandTime(input.now).toISOString(),
      });
    } catch (error) {
      blockedReasons.push(error instanceof Error ? error.message : String(error));
    }
    try {
      assertApprovalPresentForTerminalStatus(dbPath, { taskId, targetStatus });
    } catch (error) {
      blockedReasons.push(error instanceof Error ? error.message : String(error));
    }
    blockedReasons.push(...boardBlockedReasons(
      task,
      taskById,
      [...result.queries.reviews, ...result.queries.featureReviews],
      result.queries.approvals,
      targetStatus,
    ));
  }

  return { blockedReasons: [...new Set(blockedReasons)] };
}

function executeBoardCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
  scheduler: SchedulerClient,
): { schedulerJobIds: string[]; runIds: string[]; blockedReasons: string[] } | undefined {
  if (!["move_board_task", "schedule_board_tasks", "run_board_tasks"].includes(input.action)) {
    return undefined;
  }
  const taskIds = boardCommandTaskIds(input);
  const targetStatus = boardCommandTargetStatus(input);
  if (!targetStatus || taskIds.length === 0) {
    return { schedulerJobIds: [], runIds: [], blockedReasons: [] };
  }
  const rows = loadBoardCommandTasks(dbPath, taskIds);
  const blockedReasons: string[] = [];
  const schedulerJobIds: string[] = [];
  const runIds: string[] = [];

  for (const taskId of taskIds) {
    const task = rows.find((entry) => entry.id === taskId);
    if (!task) {
      blockedReasons.push(`Task ${taskId} was not found.`);
      continue;
    }
    const from = normalizeBoardStatus(task.status);
    if (input.action === "run_board_tasks") {
      if (from !== "scheduled") {
        blockedReasons.push(`Task ${taskId} must be scheduled before CLI execution.`);
        continue;
      }
      const runId = randomUUID();
      runSqlite(dbPath, [
        {
          sql: `INSERT INTO execution_records (id, executor_type, operation, project_id, context_json, status, started_at, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            runId,
            "cli",
            "feature_execution",
            task.projectId ?? null,
            JSON.stringify({
              featureId: task.featureId,
              taskId,
              taskName: task.name,
              skillSlug: "feat-implement-skill",
              skillPhase: "task_execution",
            }),
            "queued",
            acceptedAt,
            JSON.stringify({ commandAction: input.action, scheduler: "bullmq" }),
          ],
        },
      ]);
      const job = scheduler.enqueueCliRun({
        executionId: runId,
        operation: "feature_execution",
        projectId: task.projectId,
        context: {
          featureId: task.featureId,
          taskId,
          taskName: task.name,
          skillSlug: "feat-implement-skill",
          skillPhase: "task_execution",
        },
        requestedAction: "task_execution",
      });
      schedulerJobIds.push(job.schedulerJobId);
      runIds.push(runId);
      continue;
    }

    persistStateTransition(dbPath, transitionTask(taskId, from, targetStatus, {
      reason: input.reason,
      evidence: `console_command:${input.action}`,
      triggeredBy: "product_console",
      occurredAt: acceptedAt,
    }));
    updateTaskStatus(dbPath, taskId, targetStatus);
  }

  return { schedulerJobIds, runIds, blockedReasons: [...new Set(blockedReasons)] };
}

function loadBoardCommandTasks(dbPath: string, taskIds: string[]): Array<{
  id: string;
  name: string;
  featureId?: string;
  projectId?: string;
  status: BoardColumn | "unknown";
}> {
  const result = runSqlite(dbPath, [], [
    {
      name: "graphTasks",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, t.status
        FROM task_graph_tasks t LEFT JOIN features f ON f.id = t.feature_id
        WHERE t.id IN (${placeholders(taskIds.length)})`,
      params: taskIds,
    },
    {
      name: "tasks",
      sql: `SELECT t.id, t.feature_id, f.project_id, t.title, t.status
        FROM tasks t LEFT JOIN features f ON f.id = t.feature_id
        WHERE t.id IN (${placeholders(taskIds.length)})`,
      params: taskIds,
    },
  ]);
  const byId = new Map<string, { id: string; name: string; featureId?: string; projectId?: string; status: BoardColumn | "unknown" }>();
  for (const row of [...result.queries.tasks, ...result.queries.graphTasks]) {
    byId.set(String(row.id), {
      id: String(row.id),
      name: taskName(row),
      featureId: optionalString(row.feature_id),
      projectId: optionalString(row.project_id),
      status: normalizeBoardStatus(row.status),
    });
  }
  return [...byId.values()];
}

function updateTaskStatus(dbPath: string, taskId: string, status: BoardColumn): void {
  runSqlite(dbPath, [
    { sql: "UPDATE task_graph_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params: [status, taskId] },
    { sql: "UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params: [status, taskId] },
  ]);
}

function executeCliAdapterCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
): { blockedReasons: string[]; dryRun?: CliAdapterValidationResult } | undefined {
  if (!["validate_cli_adapter_config", "save_cli_adapter_config", "activate_cli_adapter_config", "disable_cli_adapter_config"].includes(input.action)) {
    return undefined;
  }
  const payload = isRecord(input.payload) ? input.payload : {};
  const adapterPayload = isRecord(payload.config) ? payload.config : {};
  const adapterId = optionalString(payload.adapterId) ?? optionalString(adapterPayload.id) ?? input.entityId;
  const current = adapterId ? adapterFromRows(readCliAdapterRows(dbPath), undefined, false, adapterId) : undefined;
  const config = normalizeCliAdapterConfig({ ...(current ?? DEFAULT_CLI_ADAPTER_CONFIG), ...adapterPayload, id: adapterId || DEFAULT_CLI_ADAPTER_CONFIG.id });
  const dryRun = dryRunCliAdapterConfig({ config });
  const blockedReasons = dryRun.valid ? [] : dryRun.errors;

  if (input.action === "validate_cli_adapter_config") {
    persistCliAdapterConfig(dbPath, { ...config, status: dryRun.valid ? config.status : "invalid", updatedAt: acceptedAt }, dryRun, false);
    return { blockedReasons, dryRun };
  }

  if (input.action === "save_cli_adapter_config") {
    persistCliAdapterConfig(dbPath, { ...config, status: dryRun.valid ? "draft" : "invalid", updatedAt: acceptedAt }, dryRun, false);
    return { blockedReasons, dryRun };
  }

  if (input.action === "activate_cli_adapter_config") {
    if (blockedReasons.length > 0) {
      persistCliAdapterConfig(dbPath, { ...config, status: "invalid", updatedAt: acceptedAt }, dryRun, false);
      return { blockedReasons, dryRun };
    }
    runSqlite(dbPath, [
      { sql: "UPDATE cli_adapter_configs SET status = 'disabled', updated_at = ? WHERE status = 'active' AND id <> ?", params: [acceptedAt, config.id] },
    ]);
    persistCliAdapterConfig(dbPath, { ...config, status: "active", updatedAt: acceptedAt }, dryRun, true);
    return { blockedReasons: [], dryRun };
  }

  if (input.action === "disable_cli_adapter_config") {
    const target = current ?? config;
    if (target.status === "active") {
      return { blockedReasons: ["Active CLI Adapter cannot be disabled until another adapter is active."] };
    }
    persistCliAdapterConfig(dbPath, { ...target, status: "disabled", updatedAt: acceptedAt }, undefined, false);
    return { blockedReasons: [] };
  }

  return undefined;
}

function executeRpcAdapterCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
): { blockedReasons: string[]; probe?: RpcAdapterValidationResult } | undefined {
  if (!["validate_rpc_adapter_config", "save_rpc_adapter_config", "activate_rpc_adapter_config", "disable_rpc_adapter_config"].includes(input.action)) {
    return undefined;
  }
  const payload = isRecord(input.payload) ? input.payload : {};
  const adapterPayload = isRecord(payload.config) ? payload.config : {};
  const adapterId = optionalString(payload.adapterId) ?? optionalString(adapterPayload.id) ?? input.entityId;
  const current = adapterId ? rpcAdapterFromRows(readRpcAdapterRows(dbPath), undefined, false, adapterId) : undefined;
  const base = current ?? rpcAdapterPreset(adapterId) ?? DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG;
  const normalizedConfig = normalizeRpcAdapterConfig({ ...base, ...adapterPayload, id: adapterId || base.id });
  const config = input.action === "activate_rpc_adapter_config"
    ? { ...normalizedConfig, status: "active" as const }
    : normalizedConfig;
  const probe = dryRunRpcAdapterConfig(config);
  const blockedReasons = probe.valid ? [] : probe.errors;

  if (input.action === "validate_rpc_adapter_config") {
    persistRpcAdapterConfig(dbPath, { ...config, status: probe.valid ? config.status : "disabled", updatedAt: acceptedAt }, probe, false);
    return { blockedReasons, probe };
  }

  if (input.action === "save_rpc_adapter_config") {
    persistRpcAdapterConfig(dbPath, { ...config, status: "disabled", updatedAt: acceptedAt }, probe, false);
    return { blockedReasons, probe };
  }

  if (input.action === "activate_rpc_adapter_config") {
    if (blockedReasons.length > 0) {
      persistRpcAdapterConfig(dbPath, { ...config, status: "disabled", updatedAt: acceptedAt }, probe, false);
      return { blockedReasons, probe };
    }
    runSqlite(dbPath, [
      { sql: "UPDATE rpc_adapter_configs SET status = 'disabled', updated_at = ? WHERE status = 'active' AND id <> ?", params: [acceptedAt, config.id] },
    ]);
    persistRpcAdapterConfig(dbPath, { ...config, status: "active", updatedAt: acceptedAt }, probe, true);
    return { blockedReasons: [], probe };
  }

  if (input.action === "disable_rpc_adapter_config") {
    const target = current ?? config;
    if (target.status === "active") {
      return { blockedReasons: ["Active RPC Adapter cannot be disabled until another adapter is active."] };
    }
    persistRpcAdapterConfig(dbPath, { ...target, status: "disabled", updatedAt: acceptedAt }, undefined, false);
    return { blockedReasons: [] };
  }

  return undefined;
}

function executeProjectExecutionPreferenceCommand(
  dbPath: string,
  input: ConsoleCommandInput,
  acceptedAt: string,
): { blockedReasons: string[]; preference?: ExecutionPreferenceV1 } | undefined {
  if (input.action !== "save_project_execution_preference") {
    return undefined;
  }
  if (input.entityType !== "settings" && input.entityType !== "project") {
    return { blockedReasons: ["Project execution preference can only be saved from settings or project scope."] };
  }
  const payload = isRecord(input.payload) ? input.payload : {};
  const config = isRecord(payload.config) ? payload.config : payload;
  const projectId = optionalString(config.projectId)
    ?? optionalString(payload.projectId)
    ?? (input.entityType === "project" ? input.entityId : undefined)
    ?? currentSettingsProjectId(dbPath);
  if (!projectId) {
    return { blockedReasons: ["Project execution preference requires a projectId."] };
  }
  const cliRows = readCliAdapterRows(dbPath);
  const rpcRows = readRpcAdapterRows(dbPath);
  const resolved = executionPreferenceForAdapterId(optionalString(config.adapterId), cliRows, rpcRows, "project");
  const preference = resolved.preference ?? {
    runMode: "cli" as const,
    adapterId: optionalString(config.adapterId) ?? "",
    source: "project" as const,
  };
  if (resolved.errors.length > 0) {
    return { blockedReasons: resolved.errors, preference };
  }
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO project_execution_preferences (project_id, run_mode, adapter_id, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          run_mode = excluded.run_mode,
          adapter_id = excluded.adapter_id,
          updated_at = excluded.updated_at`,
      params: [projectId, preference.runMode, preference.adapterId, acceptedAt],
    },
  ]);
  return { blockedReasons: [], preference };
}

function executeConsoleWriteCommand(dbPath: string, input: ConsoleCommandInput, acceptedAt: string): string | undefined {
  if (input.action !== "write_project_rule" && input.action !== "write_spec_evolution" && input.action !== "update_spec") {
    return undefined;
  }
  const id = randomUUID();
  const payload = isRecord(input.payload) ? input.payload : {};
  const projectId = optionalString(payload.projectId);
  const project = projectId ? getProject(dbPath, projectId) : undefined;
  const featureId = input.action === "write_spec_evolution"
    ? optionalString(payload.featureId) ?? (input.entityType === "feature" ? input.entityId : undefined)
    : undefined;
  const kind = input.action === "write_project_rule"
    ? "project_rule"
    : input.action === "update_spec"
      ? "spec_document_update"
      : "spec_evolution";
  const path = optionalString(payload.path)
    ?? (input.action === "update_spec"
      ? `.autobuild/spec-updates/${input.entityId}.json`
      : input.action === "write_project_rule"
      ? `.autobuild/rules/${input.entityId}.json`
      : `.autobuild/spec-evolution/${input.entityId}.json`);
  const summary = optionalString(payload.summary) ?? optionalString(payload.body) ?? input.reason;
  if (input.action === "update_spec" && (optionalString(payload.path) || optionalString(payload.content))) {
    if (!project?.targetRepoPath) {
      throw new Error("update_spec requires a project workspace.");
    }
    if (!path) {
      throw new Error("update_spec requires payload.path.");
    }
    const safePath = safeSpecDocumentWritePath(path);
    const content = optionalString(payload.content);
    if (content === undefined) {
      throw new Error("update_spec requires payload.content.");
    }
    const fullPath = join(project.targetRepoPath, safePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, { encoding: "utf8", mode: 0o600 });
  }
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO status_check_results (
        id, run_id, task_id, feature_id, status, summary, reasons_json, recommended_actions_json,
        kind, path, metadata_json, execution_result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        `CONSOLE-WRITE-${id}`,
        null,
        featureId ?? null,
        "done",
        summary,
        "[]",
        "[]",
        kind,
        path,
        JSON.stringify({ commandAction: input.action, entityType: input.entityType, entityId: input.entityId, payload }),
        "{}",
      ],
    },
  ]);
  return id;
}

function safeSpecDocumentWritePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").split("/").filter(Boolean).join("/");
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../") || isAbsolute(normalized)) {
    throw new Error(`Spec document path must stay inside the workspace: ${path}`);
  }
  const allowed = normalized.startsWith("docs/") || normalized.startsWith(".agents/skills/");
  if (!allowed) {
    throw new Error(`Spec document updates are limited to docs/ or .agents/skills/: ${path}`);
  }
  return normalized;
}

function executeReviewCommand(dbPath: string, input: ConsoleCommandInput, acceptedAt: string): ReturnType<typeof recordApprovalDecision> | undefined {
  if (input.entityType !== "review_item") {
    return undefined;
  }
  const item = listReviewCenterItems(dbPath).find((entry) => entry.id === input.entityId);
  const decisionInput = reviewDecisionInputForCommand(input, item);
  if (!decisionInput) {
    return undefined;
  }
  return recordApprovalDecision(dbPath, {
    reviewItemId: input.entityId,
    decision: decisionInput.decision,
    actor: input.requestedBy,
    reason: input.reason,
    targetStatus: decisionInput.targetStatus,
    evidence: optionalString(input.payload?.evidence),
    now: new Date(acceptedAt),
    metadata: input.payload,
  });
}

function reviewDecisionInputForCommand(input: ConsoleCommandInput, item?: ReturnType<typeof listReviewCenterItems>[number]): Pick<RecordApprovalInput, "decision" | "targetStatus"> | undefined {
  const payloadTargetStatus = optionalString(input.payload?.targetStatus) as RecordApprovalInput["targetStatus"] | undefined;
  switch (input.action) {
    case "approve_review":
      return { decision: "approve_continue", targetStatus: payloadTargetStatus ?? defaultApproveStatus(item) };
    case "mark_review_complete":
      return { decision: "mark_complete", targetStatus: payloadTargetStatus ?? defaultCompleteStatus(item) };
    case "reject_review":
      return { decision: "reject", targetStatus: payloadTargetStatus };
    case "request_review_changes":
      return { decision: "request_changes", targetStatus: payloadTargetStatus ?? defaultChangesRequestedStatus(item) };
    case "rollback_review":
      return { decision: "rollback", targetStatus: payloadTargetStatus ?? "failed" };
    case "split_review_task":
      return { decision: "split_task", targetStatus: payloadTargetStatus ?? "blocked" };
    case "update_spec":
      return { decision: "update_spec", targetStatus: payloadTargetStatus ?? defaultChangesRequestedStatus(item) };
    default:
      return undefined;
  }
}

function defaultApproveStatus(item: ReturnType<typeof listReviewCenterItems>[number] | undefined): RecordApprovalInput["targetStatus"] | undefined {
  if (item?.taskId) {
    const pausedStatus = item.body.pausedTaskStatus;
    return pausedStatus && ["backlog", "ready", "scheduled", "running", "checking"].includes(pausedStatus)
      ? pausedStatus
      : pausedStatus === "failed" || pausedStatus === "blocked" || pausedStatus === "done" || pausedStatus === "delivered"
        ? undefined
        : "ready";
  }
  if (item?.featureId) {
    const pausedStatus = item.body.pausedFeatureStatus;
    return pausedStatus && !["draft", "review_needed", "failed", "blocked", "done", "delivered"].includes(pausedStatus)
      ? pausedStatus
      : pausedStatus === "failed" || pausedStatus === "blocked" || pausedStatus === "done" || pausedStatus === "delivered"
        ? undefined
        : "ready";
  }
  return "ready";
}

function defaultCompleteStatus(item: ReturnType<typeof listReviewCenterItems>[number] | undefined): RecordApprovalInput["targetStatus"] | undefined {
  const pausedStatus = item?.taskId ? item.body.pausedTaskStatus : item?.featureId ? item.body.pausedFeatureStatus : undefined;
  if (pausedStatus === "done" || pausedStatus === "delivered") {
    return pausedStatus;
  }
  return undefined;
}

function defaultChangesRequestedStatus(item: ReturnType<typeof listReviewCenterItems>[number] | undefined): RecordApprovalInput["targetStatus"] | undefined {
  if (item?.taskId) {
    const pausedStatus = item.body.pausedTaskStatus;
    return pausedStatus && ["backlog", "ready", "scheduled", "running", "checking"].includes(pausedStatus)
      ? pausedStatus
      : pausedStatus === "failed" || pausedStatus === "blocked" || pausedStatus === "done" || pausedStatus === "delivered"
        ? undefined
        : "ready";
  }
  if (item?.featureId) {
    const pausedStatus = item.body.pausedFeatureStatus;
    return pausedStatus && !["draft", "review_needed", "ready", "failed", "blocked", "done", "delivered"].includes(pausedStatus)
      ? pausedStatus
      : pausedStatus === "failed" || pausedStatus === "blocked" || pausedStatus === "done" || pausedStatus === "delivered"
        ? undefined
        : "planning";
  }
  return "ready";
}

function buildBoardCounts(rows: Record<string, unknown>[]): DashboardQueryModel["boardCounts"] {
  const counts = Object.fromEntries([...BOARD_COLUMNS, "unknown"].map((column) => [column, 0])) as DashboardQueryModel["boardCounts"];
  for (const row of rows) {
    const status = String(row.status);
    const key = BOARD_COLUMNS.has(status) ? status : "unknown";
    counts[key as BoardColumn | "unknown"] += 1;
  }
  return counts;
}

function groupByProject(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const projectId = optionalString(row.project_id);
    if (!projectId) {
      continue;
    }
    groups.set(projectId, [...groups.get(projectId) ?? [], row]);
  }
  return groups;
}

function groupMetricsByProject(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const projectId = optionalString(parseJsonObject(row.labels_json).projectId);
    if (!projectId) {
      continue;
    }
    groups.set(projectId, [...groups.get(projectId) ?? [], row]);
  }
  return groups;
}

function normalizeProjectHealth(value: unknown): ProjectOverviewModel["projects"][number]["health"] {
  const status = String(value);
  if (status === "ready" || status === "failed") {
    return status;
  }
  return "blocked";
}

function latestActivityAt(values: unknown[]): string {
  return values
    .map((value) => optionalString(value))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? "";
}

function overviewRisks(reviewRows: Record<string, unknown>[], runRows: Record<string, unknown>[]): ProjectOverviewModel["projects"][number]["latestRisk"][] {
  const reviewRisks = reviewRows
    .filter((row) => pendingReviewStatuses.has(String(row.status)))
    .map((row) => {
      const body = parseJsonObject(row.body);
      return {
        level: normalizeRisk(row.severity),
        message: typeof body.message === "string" ? body.message : String(row.body),
        source: String(row.id),
      };
    });
  const failedRuns = latestExecutionRowsByTarget(runRows)
    .filter((row) => String(row.status) === "failed")
    .map((row) => ({ level: "medium" as const, message: `Run ${String(row.id)} failed.`, source: String(row.id) }));
  return [...reviewRisks, ...failedRuns].filter((risk) => Boolean(risk.message));
}

function latestExecutionRowsByTarget(runRows: Record<string, unknown>[]): Record<string, unknown>[] {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of [...runRows].sort(compareExecutionRowsDesc)) {
    const key = executionTargetKey(row);
    if (!latest.has(key)) {
      latest.set(key, row);
    }
  }
  return Array.from(latest.values());
}

function compareExecutionRowsDesc(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const rightStartedAt = optionalString(right.started_at) ?? "";
  const leftStartedAt = optionalString(left.started_at) ?? "";
  return rightStartedAt.localeCompare(leftStartedAt);
}

function executionTargetKey(row: Record<string, unknown>): string {
  const taskId = optionalString(row.task_id);
  if (taskId) return `task:${taskId}`;
  const featureId = optionalString(row.feature_id);
  if (featureId) return `feature:${featureId}`;
  const projectId = optionalString(row.project_id);
  if (projectId) return `project:${projectId}`;
  return `run:${String(row.id)}`;
}

function boardBlockedReasons(
  task: Record<string, unknown>,
  taskById: Map<string, Record<string, unknown>>,
  reviewRows: Record<string, unknown>[],
  approvalRows: Record<string, unknown>[],
  targetStatus?: BoardColumn,
): string[] {
  const taskId = String(task.id);
  const reasons: string[] = [];
  const dependencyStatuses = parseJsonArray(task.dependencies_json).map((dependency) => {
    const dependencyId = String(dependency);
    const dependencyStatus = normalizeBoardStatus(taskById.get(dependencyId)?.status);
    return { dependencyId, dependencyStatus };
  });
  const unsatisfied = dependencyStatuses.filter((entry) => entry.dependencyStatus !== "done" && entry.dependencyStatus !== "delivered");
  if (targetStatus && dependencyGateApplies(targetStatus) && unsatisfied.length > 0) {
    reasons.push(`Dependencies are not done: ${unsatisfied.map((entry) => entry.dependencyId).join(", ")}.`);
  }
  const scopedReviews = reviewRows.filter((entry) => entry.task_id === task.id || (!entry.task_id && entry.feature_id === task.feature_id));
  const scopedApprovals = approvalRows.filter((entry) => entry.task_id === task.id || (!entry.task_id && entry.feature_id === task.feature_id));
  if (scopedReviews.some((entry) => pendingReviewStatuses.has(String(entry.status)))) {
    reasons.push(`Task ${taskId} has unresolved review approvals.`);
  }
  if (normalizeRisk(task.risk) === "high" && !hasPositiveApproval(scopedApprovals)) {
    reasons.push(`Task ${taskId} is high risk and requires approval.`);
  }
  return [...new Set(reasons)];
}

function recoveryHistoryForTask(
  taskId: string,
  transitionRows: Record<string, unknown>[],
  attemptRows: Record<string, unknown>[],
  forbiddenRows: Record<string, unknown>[],
): DashboardBoardViewModel["tasks"][number]["recoveryHistory"] {
  const transitions = transitionRows
    .filter((entry) => entry.entity_id === taskId)
    .map((entry) => ({
      from: optionalString(entry.from_status),
      to: optionalString(entry.to_status),
      reason: String(entry.reason ?? ""),
      evidence: optionalString(entry.evidence),
      occurredAt: String(entry.occurred_at),
    }));
  const attempts = attemptRows
    .filter((entry) => entry.task_id === taskId)
    .map((entry) => {
      return {
        from: optionalString(entry.action),
        to: optionalString(entry.status),
        reason: `${String(entry.strategy)}: ${String(entry.summary)}`,
        evidence: optionalString(entry.command) ?? optionalString(entry.id),
        occurredAt: String(entry.attempted_at),
      };
    });
  const forbidden = forbiddenRows
    .filter((entry) => entry.task_id === taskId)
    .map((entry) => ({
      from: optionalString(entry.failed_strategy),
      to: "forbidden_retry",
      reason: String(entry.reason),
      evidence: optionalString(entry.execution_result_id) ?? optionalString(entry.failed_command),
      occurredAt: String(entry.created_at),
    }));
  return [...attempts, ...forbidden, ...transitions].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function approvalStatusForTask(
  task: Record<string, unknown>,
  reviewRows: Record<string, unknown>[],
  approvalRows: Record<string, unknown>[],
): DashboardBoardViewModel["tasks"][number]["approvalStatus"] {
  if (reviewRows.some((entry) => pendingReviewStatuses.has(String(entry.status)))) {
    return "pending";
  }
  if (normalizeRisk(task.risk) === "high" && !hasPositiveApproval(approvalRows)) {
    return "pending";
  }
  return hasPositiveApproval(approvalRows) ? "approved" : "not_required";
}

function hasPositiveApproval(approvalRows: Record<string, unknown>[]): boolean {
  return approvalRows.some((entry) => ["approve_continue", "mark_complete"].includes(String(entry.decision)) && String(entry.status) === "recorded");
}

function boardCommandTaskIds(input: ConsoleCommandInput): string[] {
  const payload = isRecord(input.payload) ? input.payload : {};
  if (input.entityType === "task") {
    return [input.entityId];
  }
  const fromPayload = arrayValue(payload.taskIds).map(String);
  if (fromPayload.length > 0) {
    return fromPayload;
  }
  return input.entityType === "task" ? [input.entityId] : [];
}

function taskScopedTaskIdsMismatch(input: ConsoleCommandInput): boolean {
  if (input.entityType !== "task") {
    return false;
  }
  const payload = isRecord(input.payload) ? input.payload : {};
  const taskIds = arrayValue(payload.taskIds).map(String);
  return taskIds.length > 0 && taskIds.some((taskId) => taskId !== input.entityId);
}

function boardCommandTargetStatus(input: ConsoleCommandInput): BoardColumn | undefined {
  const payload = isRecord(input.payload) ? input.payload : {};
  const requested = input.action === "schedule_board_tasks"
    ? "scheduled"
    : input.action === "run_board_tasks"
      ? "running"
      : optionalString(payload.targetStatus);
  return normalizeBoardStatus(requested) === "unknown" ? undefined : normalizeBoardStatus(requested) as BoardColumn;
}

function normalizeBoardStatus(value: unknown): BoardColumn | "unknown" {
  const status = String(value ?? "");
  return BOARD_COLUMNS.has(status) ? status as BoardColumn : "unknown";
}

function normalizeRisk(value: unknown): RiskLevel | "unknown" {
  const risk = String(value ?? "");
  return risk === "low" || risk === "medium" || risk === "high" ? risk : "unknown";
}

function dependencyGateApplies(targetStatus: BoardColumn): boolean {
  return !["backlog", "blocked", "failed"].includes(targetStatus);
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

function countBy(rows: Record<string, unknown>[], column: string, value: string): number {
  return rows.filter((row) => String(row[column]) === value).length;
}

function sumMetrics(rows: Record<string, unknown>[], name: string): number {
  return rows.filter((row) => row.metric_name === name).reduce((sum, row) => sum + Number(row.metric_value), 0);
}

function sumColumn(rows: Record<string, unknown>[], column: string): number {
  return rows.reduce((sum, row) => sum + Number(row[column] ?? 0), 0);
}

function latestMetric(rows: Record<string, unknown>[], name: string): number {
  const row = [...rows].reverse().find((entry) => entry.metric_name === name);
  return row ? Number(row.metric_value) : 0;
}

function latestRunsForTasks(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const taskId = optionalString(row.task_id);
    if (!taskId) {
      continue;
    }
    const existing = latest.get(taskId);
    if (!existing || runnerRunPriority(row) > runnerRunPriority(existing)) {
      latest.set(taskId, row);
    }
  }
  return latest;
}

function runnerRunPriority(row: Record<string, unknown>): number {
  const status = String(row.status);
  if (status === "running") {
    return 4;
  }
  if (status === "queued" || status === "scheduled") {
    return 3;
  }
  if (status === "failed" || status === "blocked") {
    return 2;
  }
  return 1;
}

function latestHeartbeatByRun(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const runId = optionalString(row.run_id);
    if (runId && !latest.has(runId)) {
      latest.set(runId, row);
    }
  }
  return latest;
}

function buildRunnerScheduleLanes(input: {
  taskRows: Record<string, unknown>[];
  taskById: Map<string, Record<string, unknown>>;
  runsByTask: Map<string, Record<string, unknown>>;
  heartbeatsByRun: Map<string, Record<string, unknown>>;
  logs: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  evidence: Record<string, unknown>[];
}): RunnerConsoleViewModel["lanes"] {
  const lanes: RunnerConsoleViewModel["lanes"] = { ready: [], scheduled: [], running: [], blocked: [] };
  for (const row of input.taskRows) {
    const taskId = String(row.id);
    const status = normalizeBoardStatus(row.status);
    const targetStatus = status === "ready" ? "scheduled" : status === "scheduled" ? "running" : undefined;
    const reviews = input.reviews.filter((entry) => entry.task_id === row.id || (!entry.task_id && entry.feature_id === row.feature_id));
    const approvals = input.approvals.filter((entry) => entry.task_id === row.id || (!entry.task_id && entry.feature_id === row.feature_id));
    const blockedReasons = boardBlockedReasons(row, input.taskById, input.reviews, input.approvals, targetStatus);
    const run = input.runsByTask.get(taskId);
    const heartbeat = run ? input.heartbeatsByRun.get(String(run.id)) : undefined;
    const log = run ? input.logs.find((entry) => entry.run_id === run.id) : undefined;
    const evidence = input.evidence.find((entry) =>
      entry.task_id === row.id || (run && entry.run_id === run.id) || (!entry.task_id && entry.feature_id === row.feature_id)
    );
    const task = {
      id: taskId,
      featureId: optionalString(row.feature_id),
      featureTitle: optionalString(row.feature_title),
      name: taskName(row),
      title: String(row.title),
      description: taskDescription(row),
      status,
      risk: normalizeRisk(row.risk),
      sourceRequirementIds: optionalStringArray(parseJsonArray(row.source_requirements_json)),
      acceptanceCriteriaIds: optionalStringArray(parseJsonArray(row.acceptance_criteria_json)),
      allowedFiles: optionalStringArray(parseJsonArray(row.allowed_files_json)),
      dependencies: parseJsonArray(row.dependencies_json).map((dependency) => {
        const id = String(dependency);
        const dependencyStatus = normalizeBoardStatus(input.taskById.get(id)?.status);
        return {
          id,
          status: dependencyStatus,
          satisfied: dependencyStatus === "done" || dependencyStatus === "delivered",
        };
      }),
      approvalStatus: approvalStatusForTask(row, reviews, approvals),
      runnerId: optionalString(heartbeat?.runner_id),
      runId: optionalString(run?.id),
      action: runnerTaskAction(status, blockedReasons),
      blockedReasons,
      recentLog: optionalString(log?.stderr) ?? optionalString(log?.stdout),
      resultSummary: optionalString(evidence?.summary),
      lastUpdatedAt: optionalString(row.updated_at) ?? optionalString(run?.started_at),
    } satisfies RunnerScheduleTaskViewModel;

    if (["blocked", "failed", "review_needed"].includes(String(status)) || blockedReasons.length > 0) {
      lanes.blocked.push(task);
    } else if (status === "running" || status === "checking") {
      lanes.running.push(task);
    } else if (status === "scheduled") {
      lanes.scheduled.push(task);
    } else if (status === "ready" || status === "backlog") {
      lanes.ready.push(task);
    }
  }
  return {
    ready: lanes.ready.slice(0, 8),
    scheduled: lanes.scheduled.slice(0, 8),
    running: lanes.running.slice(0, 8),
    blocked: lanes.blocked.slice(0, 8),
  };
}

function taskDescription(row: Record<string, unknown>): string | undefined {
  const explicit = optionalString(row.description);
  if (explicit) {
    return explicit;
  }
  const graph = parseJsonObject(row.graph_json);
  const tasks = arrayValue(graph.tasks);
  const match = tasks
    .map((entry) => parseJsonObject(entry))
    .find((entry) => optionalString(entry.taskId) === row.id || optionalString(entry.id) === row.id);
  return optionalString(match?.description);
}

function runnerTaskAction(status: BoardColumn | "unknown", blockedReasons: string[]): RunnerScheduleTaskViewModel["action"] {
  if (blockedReasons.length > 0 || status === "review_needed" || status === "blocked" || status === "failed") {
    return "review";
  }
  if (status === "ready" || status === "backlog") {
    return "schedule";
  }
  if (status === "scheduled") {
    return "run";
  }
  return "observe";
}

function buildSkillInvocationFeedback(
  executionRows: Record<string, unknown>[],
  schedulerRows: Record<string, unknown>[],
  evidenceRows: Record<string, unknown>[],
  workspaceRootByProject = new Map<string, string>(),
  tokenConsumptionByRun = new Map<string, TokenConsumptionViewModel>(),
): RunnerConsoleViewModel["skillInvocations"] {
  const evidenceByRun = new Map<string, Record<string, unknown>>();
  for (const row of evidenceRows) {
    const runId = optionalString(row.run_id);
    if (runId && !evidenceByRun.has(runId)) {
      evidenceByRun.set(runId, row);
    }
  }
  return executionRows
    .map((execution) => {
      const metadata = parseJsonObject(execution.metadata_json);
      const context = parseJsonObject(execution.context_json);
      const skillSlug = optionalString(metadata.skillSlug);
      const skillPhase = optionalString(metadata.skillPhase) ?? optionalString(context.skillPhase) ?? optionalString(execution.operation);
      if (!skillSlug && !skillPhase) {
        return undefined;
      }
      const executionId = String(execution.id);
      const schedulerJob = schedulerRows.find((row) => row.id === execution.scheduler_job_id || optionalString(parseJsonObject(row.payload_json).executionId) === executionId);
      const evidence = evidenceByRun.get(executionId);
      const workspaceRoot = optionalString(metadata.workspaceRoot)
        ?? optionalString(context.workspaceRoot)
        ?? workspaceRootByProject.get(String(execution.project_id));
      const output = readSkillOutputViewModel(workspaceRoot, executionId, metadata);
      if (output && tokenConsumptionByRun.has(executionId)) {
        output.tokenConsumption = tokenConsumptionByRun.get(executionId);
      }
      return {
        runId: executionId,
        schedulerJobId: optionalString(schedulerJob?.id),
        workspaceRoot,
        skillSlug: skillSlug ?? optionalString(context.skillSlug),
        skillPhase,
        blockedReason: optionalString(metadata.blockedReason) ?? (String(execution.status) === "blocked" ? optionalString(execution.summary) : undefined),
        status: String(execution.status),
        resultSummary: optionalString(evidence?.summary),
        output,
        updatedAt: optionalString(execution.completed_at) ?? optionalString(execution.started_at) ?? optionalString(execution.updated_at),
      };
    })
    .filter((entry): entry is RunnerConsoleViewModel["skillInvocations"][number] => Boolean(entry))
    .slice(0, 12);
}

function latestSkillOutputForFeature(
  executionRows: Record<string, unknown>[],
  featureId: string,
  projectWorkspaceRoot: string | undefined,
  tokenConsumptionByRun = new Map<string, TokenConsumptionViewModel>(),
): SkillOutputViewModel | undefined {
  const execution = executionRows.find((row) => {
    const context = parseJsonObject(row.context_json);
    const metadata = parseJsonObject(row.metadata_json);
    return optionalString(context.featureId) === featureId || optionalString(metadata.featureId) === featureId;
  });
  if (!execution) return undefined;
  const context = parseJsonObject(execution.context_json);
  const metadata = parseJsonObject(execution.metadata_json);
  const output = readSkillOutputViewModel(
    optionalString(metadata.workspaceRoot) ?? optionalString(context.workspaceRoot) ?? projectWorkspaceRoot,
    String(execution.id),
    metadata,
  );
  if (output && tokenConsumptionByRun.has(String(execution.id))) {
    output.tokenConsumption = tokenConsumptionByRun.get(String(execution.id));
  }
  return output;
}

function latestWorkspaceRootByProject(rows: Record<string, unknown>[]): Map<string, string> {
  const byProject = new Map<string, string>();
  for (const row of rows) {
    const projectId = optionalString(row.project_id);
    const workspaceRoot = optionalString(row.local_path);
    if (projectId && workspaceRoot && !byProject.has(projectId)) {
      byProject.set(projectId, workspaceRoot);
    }
  }
  return byProject;
}

function buildRunnerSchedulerJobs(
  schedulerRows: Record<string, unknown>[],
  executionRows: Record<string, unknown>[],
  taskRows: Record<string, unknown>[],
  workspaceRootByProject = new Map<string, string>(),
  tokenConsumptionByRun = new Map<string, TokenConsumptionViewModel>(),
): RunnerConsoleViewModel["schedulerJobs"] {
  const executionsByJob = new Map<string, Record<string, unknown>>();
  const executionsById = new Map<string, Record<string, unknown>>();
  const tasksById = new Map(taskRows.map((row) => [String(row.id), row]));
  for (const execution of executionRows) {
    executionsById.set(String(execution.id), execution);
    const schedulerJobId = optionalString(execution.scheduler_job_id);
    if (schedulerJobId) executionsByJob.set(schedulerJobId, execution);
  }
  return schedulerRows.map((row) => {
    const payload = parseJsonObject(row.payload_json);
    const payloadContext = parseJsonObject(payload.context);
    const executionId = optionalString(payload.executionId);
    const execution = executionsByJob.get(String(row.id)) ?? (executionId ? executionsById.get(executionId) : undefined);
    const metadata = parseJsonObject(execution?.metadata_json);
    const context = parseJsonObject(execution?.context_json);
    const mergedContext = { ...payloadContext, ...context };
    const taskId = optionalString(mergedContext.taskId);
    const featureId = optionalString(mergedContext.featureId);
    const projectId = optionalString(payload.projectId) ?? optionalString(execution?.project_id);
    const workspaceRoot = optionalString(metadata.workspaceRoot)
      ?? optionalString(mergedContext.workspaceRoot)
      ?? (projectId ? workspaceRootByProject.get(projectId) : undefined);
    const skillOutput = readSkillOutputViewModel(workspaceRoot, executionId, metadata);
    if (skillOutput && executionId && tokenConsumptionByRun.has(executionId)) {
      skillOutput.tokenConsumption = tokenConsumptionByRun.get(executionId);
    }
    return {
      id: String(row.id),
      name: schedulerJobName(row, payload, mergedContext, tasksById),
      bullmqJobId: optionalString(row.bullmq_job_id),
      queueName: String(row.queue_name),
      jobType: String(row.job_type),
      operation: optionalString(payload.operation),
      targetType: "execution",
      targetId: executionId,
      status: String(row.status),
      attempts: Number(row.attempts ?? 0),
      error: optionalString(row.error),
      updatedAt: String(row.updated_at),
      executionId,
      runId: executionId,
      taskId,
      featureId,
      projectId,
      workspaceRoot,
      context: mergedContext,
      skillOutput,
    };
  });
}

function taskName(row: Record<string, unknown>): string {
  return optionalString(row.name) ?? optionalString(row.title) ?? String(row.id);
}

function schedulerJobName(
  row: Record<string, unknown>,
  payload: Record<string, unknown>,
  context: Record<string, unknown>,
  tasksById: Map<string, Record<string, unknown>>,
): string {
  const taskId = optionalString(context.taskId);
  if (taskId) {
    return optionalString(context.taskName) ?? optionalString(context.name) ?? taskName(tasksById.get(taskId) ?? { id: taskId });
  }
  return optionalString(context.featureTitle)
    ?? optionalString(context.name)
    ?? schedulerOperationName(optionalString(payload.operation), optionalString(context.skillSlug), optionalString(context.skillPhase))
    ?? String(row.job_type);
}

function schedulerOperationName(operation?: string, skillSlug?: string, skillPhase?: string): string | undefined {
  if (skillSlug === "feat-implement-skill" || skillPhase === "task_execution") return "Execute task";
  if (skillSlug === "create-project-hld" || operation === "generate_hld") return "Generate project HLD";
  if (skillSlug === "requirement-intake-skill" || operation === "intake_requirement") return "Intake requirement";
  if (skillSlug === "ambiguity-clarification-skill" || operation === "resolve_clarification") return "Resolve clarification";
  if (skillSlug === "pr-ears-requirement-decomposition-skill" || operation === "generate_ears") return "Generate EARS requirements";
  if (skillSlug === "task-slicing-skill" || operation === "split_feature_specs") return "Split Feature Specs";
  if (skillSlug === "ui-spec-skill" || operation === "generate_ui_spec") return "Generate UI Spec";
  if (skillSlug === "technical-context-skill") return "Collect technical context";
  if (operation === "feature_execution") return "Execute feature work";
  return undefined;
}

function schedulerJobTargetLabel(row: Record<string, unknown>): string {
  const payload = parseJsonObject(row.payload_json);
  const context = parseJsonObject(payload.context);
  return optionalString(context.taskId)
    ?? optionalString(context.featureId)
    ?? optionalString(payload.projectId)
    ?? optionalString(payload.executionId)
    ?? "execution";
}

function filterRunnerAuditEvents(
  rows: Record<string, unknown>[],
  taskRows: Record<string, unknown>[],
  projectId?: string,
): Record<string, unknown>[] {
  const featureIds = new Set(taskRows.map((row) => optionalString(row.feature_id)).filter((value): value is string => Boolean(value)));
  const taskIds = new Set(taskRows.map((row) => String(row.id)));
  return rows.filter((row) => {
    const eventType = String(row.event_type);
    if (!eventType.startsWith("console_command_")) {
      return false;
    }
    const entityType = String(row.entity_type);
    const entityId = String(row.entity_id);
    const payload = parseJsonObject(row.payload_json);
    return (
      entityType === "runner"
      || (entityType === "task" && taskIds.has(entityId))
      || (entityType === "feature" && featureIds.has(entityId))
      || (projectId !== undefined && optionalString(payload.projectId) === projectId)
    );
  });
}

function auditEventToTimeline(row: Record<string, unknown>): AuditCenterViewModel["timeline"][number] {
  const payload = parseJsonObject(row.payload_json);
  const boardValidation = parseJsonObject(payload.boardValidation);
  const boardResult = parseJsonObject(payload.boardResult);
  const status = auditStatusFromPayload(payload, boardValidation);
  const commandPayload = parseJsonObject(payload.payload);
  return {
    id: String(row.id),
    occurredAt: String(row.created_at),
    status,
    eventType: String(row.event_type),
    action: String(row.event_type).replace(/^console_command_/, ""),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    reason: String(row.reason ?? ""),
    requestedBy: optionalString(payload.requestedBy),
    runId: optionalString(payload.runId) ?? arrayValue(boardResult.runIds)[0]?.toString() ?? optionalString(commandPayload.runId),
    jobId: optionalString(payload.schedulerJobId) ?? arrayValue(payload.schedulerJobIds)[0]?.toString() ?? arrayValue(boardResult.schedulerJobIds)[0]?.toString(),
    featureId: optionalString(payload.featureId) ?? optionalString(commandPayload.featureId),
    taskId: arrayValue(commandPayload.taskIds)[0]?.toString() ?? optionalString(commandPayload.taskId),
    executionResultId: optionalString(payload.executionResultId) ?? optionalString(commandPayload.executionResultId),
    reviewId: optionalString(payload.approvalRecordId) ?? optionalString(commandPayload.reviewItemId),
    blockedReasons: [
      ...arrayValue(boardValidation.blockedReasons).map(String),
      ...arrayValue(boardResult.blockedReasons).map(String),
    ],
    payload,
  };
}

function auditStatusFromPayload(
  payload: Record<string, unknown>,
  boardValidation: Record<string, unknown>,
): AuditCenterViewModel["timeline"][number]["status"] {
  const explicit = optionalString(payload.status);
  if (explicit === "accepted" || explicit === "blocked") {
    return explicit;
  }
  const blockedReasons = [
    ...arrayValue(boardValidation.blockedReasons),
    ...arrayValue(parseJsonObject(payload.boardResult).blockedReasons),
    ...arrayValue(parseJsonObject(payload.specIntake).blockedReasons),
    ...arrayValue(parseJsonObject(payload.projectInitialization).blockedReasons),
  ];
  if (blockedReasons.length > 0) {
    return "blocked";
  }
  return String(payload.eventType ?? "").includes("approval") ? "approval" : "accepted";
}

function auditRowBelongsToProject(input: {
  entityType: string;
  entityId: string;
  projectId?: string;
  payload: Record<string, unknown>;
  featureIds: Set<string>;
  taskIds: Set<string>;
  runRows: Record<string, unknown>[];
  reviewRows: Record<string, unknown>[];
  taskFeatureById: Map<string, string | undefined>;
}): boolean {
  if (!input.projectId) {
    return true;
  }
  if (input.entityType === "project") {
    return input.entityId === input.projectId;
  }
  if (optionalString(input.payload.projectId) === input.projectId) {
    return true;
  }
  const payloadFeatureId = optionalString(input.payload.featureId);
  if (payloadFeatureId && input.featureIds.has(payloadFeatureId)) {
    return true;
  }
  const payloadTaskId = optionalString(input.payload.taskId) ?? arrayValue(input.payload.taskIds)[0]?.toString();
  if (payloadTaskId && input.taskIds.has(payloadTaskId)) {
    return true;
  }
  const payloadRunId = optionalString(input.payload.runId) ?? arrayValue(input.payload.runIds)[0]?.toString();
  if (payloadRunId && runBelongsToProject(input.runRows, payloadRunId, input.projectId, input.featureIds, input.taskIds)) {
    return true;
  }
  if (input.entityType === "feature") {
    return input.featureIds.has(input.entityId);
  }
  if (input.entityType === "task") {
    return input.taskIds.has(input.entityId) || input.featureIds.has(input.taskFeatureById.get(input.entityId) ?? "");
  }
  if (input.entityType === "run") {
    return runBelongsToProject(input.runRows, input.entityId, input.projectId, input.featureIds, input.taskIds);
  }
  if (input.entityType === "review_item") {
    const review = input.reviewRows.find((row) => String(row.id) === input.entityId);
    return optionalString(review?.project_id) === input.projectId
      || input.featureIds.has(String(review?.feature_id ?? ""))
      || input.taskIds.has(String(review?.task_id ?? ""));
  }
  return false;
}

function runBelongsToProject(
  rows: Record<string, unknown>[],
  runId: string,
  projectId: string,
  featureIds: Set<string>,
  taskIds: Set<string>,
): boolean {
  const row = rows.find((entry) => String(entry.id) === runId);
  return optionalString(row?.project_id) === projectId
    || featureIds.has(String(row?.feature_id ?? ""))
    || taskIds.has(String(row?.task_id ?? ""));
}

function latestRunnerStatuses(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const latest: Record<string, unknown>[] = [];
  for (const row of rows) {
    const runnerId = String(row.runner_id);
    if (!seen.has(runnerId)) {
      seen.add(runnerId);
      latest.push(row);
    }
  }
  return latest;
}

function latestRunQueueStatuses(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const latest: Record<string, unknown>[] = [];
  for (const row of rows) {
    const runId = String(row.run_id);
    if (!seen.has(runId)) {
      seen.add(runId);
      latest.push(row);
    }
  }
  return latest.slice(0, 10);
}

function extractRecentPullRequests(rows: Record<string, unknown>[]): DashboardQueryModel["recentPullRequests"] {
  return rows
    .map((row) => optionalString(row.url)
      ? row
      : parseJsonObject(row.metadata_json).pullRequest as Record<string, unknown> | undefined)
    .filter((pullRequest): pullRequest is Record<string, unknown> => Boolean(pullRequest))
    .map((pullRequest) => ({
      id: String(pullRequest.id ?? pullRequest.number ?? ""),
      title: String(pullRequest.title ?? ""),
      url: optionalString(pullRequest.url),
      createdAt: optionalString(pullRequest.createdAt),
    }))
    .filter((pullRequest) => pullRequest.id || pullRequest.title)
    .slice(0, 5);
}

function extractRisks(reviewRows: Record<string, unknown>[], runRows: Record<string, unknown>[]): DashboardQueryModel["risks"] {
  const reviewRisks = reviewRows
    .filter((row) => ["high", "critical"].includes(String(row.severity)))
    .map((row) => {
      const body = parseJsonObject(row.body);
      return {
        level: String(row.severity) as RiskLevel | "unknown",
        message: typeof body.message === "string" ? body.message : String(row.body),
        source: String(row.id),
      };
    });
  const failedRuns = latestExecutionRowsByTarget(runRows)
    .filter((row) => String(row.status) === "failed")
    .map((row) => ({ level: "medium" as const, message: `Run ${String(row.id)} failed.`, source: String(row.id) }));
  return [...reviewRisks, ...failedRuns].slice(0, 10);
}

function ensureTokenConsumptionRecords(dbPath: string, projectId?: string): void {
  const projectFilter = projectId ? "WHERE er.project_id = ?" : "";
  const projectParams = projectId ? [projectId] : [];
  const result = runSqlite(dbPath, [], [
    {
      name: "executions",
      sql: `SELECT er.id, er.scheduler_job_id, er.operation, er.project_id, er.context_json, er.metadata_json,
          json_extract(er.context_json, '$.featureId') AS feature_id,
          json_extract(er.context_json, '$.taskId') AS task_id,
          rp.model AS policy_model
        FROM execution_records er
        LEFT JOIN runner_policies rp ON rp.run_id = er.id
        ${projectFilter}
        ORDER BY COALESCE(er.completed_at, er.updated_at, er.started_at, '') DESC`,
      params: projectParams,
    },
    {
      name: "projects",
      sql: `SELECT p.id, p.target_repo_path, rc.local_path
        FROM projects p
        LEFT JOIN repository_connections rc ON rc.project_id = p.id
          AND rc.connected_at = (
            SELECT MAX(connected_at) FROM repository_connections latest WHERE latest.project_id = p.id
          )
        ${projectId ? "WHERE p.id = ?" : ""}`,
      params: projectParams,
    },
    { name: "adapters", sql: "SELECT * FROM cli_adapter_configs ORDER BY updated_at DESC" },
  ]);
  const activeAdapter = adapterFromRows(result.queries.adapters, "active");
  const workspaceRootByProject = new Map(
    result.queries.projects
      .map((row) => [String(row.id), optionalString(row.local_path) ?? optionalString(row.target_repo_path)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );

  for (const execution of result.queries.executions) {
    const runId = String(execution.id);
    const context = parseJsonObject(execution.context_json);
    const metadata = parseJsonObject(execution.metadata_json);
    const project = optionalString(execution.project_id);
    const workspaceRoot = optionalString(metadata.workspaceRoot)
      ?? optionalString(context.workspaceRoot)
      ?? (project ? workspaceRootByProject.get(project) : undefined);
    if (!workspaceRoot) continue;
    const stdoutLogPath = join(workspaceRoot, ".autobuild", "runs", sanitizeRunPathSegment(runId), "stdout.log");
    const stdoutLog = readStdoutLogEvents(stdoutLogPath);
    if (!stdoutLog.exists || stdoutLog.error) continue;
    const usage = tokenUsageFromValue(stdoutLog.events);
    if (!usage) continue;
    const normalized = normalizeTokenUsage(usage);
    if (normalized.totalTokens <= 0) continue;
    const model = optionalString(execution.policy_model)
      ?? optionalString(metadata.model)
      ?? optionalString(context.model)
      ?? activeAdapter?.defaults.model;
    const pricing = calculateTokenCost(normalized, model, activeAdapter?.defaults.costRates ?? {});
    runSqlite(dbPath, [
      {
        sql: `INSERT OR IGNORE INTO token_consumption_records (
            id, run_id, scheduler_job_id, project_id, feature_id, task_id, operation, model,
            input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
            cost_usd, currency, pricing_status, usage_json, pricing_json, source_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          randomUUID(),
          runId,
          optionalString(execution.scheduler_job_id) ?? null,
          project ?? null,
          optionalString(execution.feature_id) ?? optionalString(context.featureId) ?? null,
          optionalString(execution.task_id) ?? optionalString(context.taskId) ?? null,
          optionalString(execution.operation) ?? null,
          model ?? null,
          normalized.inputTokens,
          normalized.cachedInputTokens,
          normalized.outputTokens,
          normalized.reasoningOutputTokens,
          normalized.totalTokens,
          pricing.costUsd,
          "USD",
          pricing.pricingStatus,
          JSON.stringify(usage),
          JSON.stringify(pricing.pricingSnapshot),
          stdoutLogPath,
        ],
      },
    ]);
  }
}

function normalizeTokenUsage(value: unknown): Omit<TokenConsumptionViewModel, "runId" | "model" | "costUsd" | "currency" | "pricingStatus" | "sourcePath" | "recordedAt"> {
  const record = parseJsonObject(value);
  const inputTokens = nonNegativeInteger(record.inputTokens ?? record.input_tokens ?? record.promptTokens ?? record.prompt_tokens);
  const cachedInputTokens = nonNegativeInteger(record.cachedInputTokens ?? record.cached_input_tokens ?? record.cacheReadInputTokens ?? record.cache_read_input_tokens);
  const outputTokens = nonNegativeInteger(record.outputTokens ?? record.output_tokens ?? record.completionTokens ?? record.completion_tokens);
  const reasoningOutputTokens = nonNegativeInteger(record.reasoningOutputTokens ?? record.reasoning_output_tokens);
  const explicitTotal = nonNegativeInteger(record.totalTokens ?? record.total_tokens);
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: explicitTotal > 0 ? explicitTotal : inputTokens + outputTokens + reasoningOutputTokens,
  };
}

function calculateTokenCost(
  usage: ReturnType<typeof normalizeTokenUsage>,
  model: string | undefined,
  costRates: Record<string, TokenCostRate>,
): { costUsd: number; pricingStatus: "priced" | "missing_rate"; pricingSnapshot: Record<string, unknown> } {
  const rate = model ? costRates[model] : undefined;
  if (!rate) {
    return { costUsd: 0, pricingStatus: "missing_rate", pricingSnapshot: { model, reason: "missing_rate" } };
  }
  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const billableInputTokens = Math.max(usage.inputTokens - cachedInputTokens, 0);
  const costUsd = (
    billableInputTokens * rate.inputUsdPer1M
    + cachedInputTokens * (rate.cachedInputUsdPer1M ?? rate.inputUsdPer1M)
    + usage.outputTokens * rate.outputUsdPer1M
    + usage.reasoningOutputTokens * (rate.reasoningOutputUsdPer1M ?? rate.outputUsdPer1M)
  ) / 1_000_000;
  return { costUsd, pricingStatus: "priced", pricingSnapshot: { model, ...rate } };
}

function tokenConsumptionByRunId(rows: Record<string, unknown>[]): Map<string, TokenConsumptionViewModel> {
  const entries = rows.map((row) => [String(row.run_id), tokenConsumptionFromRow(row)] as const);
  return new Map(entries);
}

function tokenConsumptionFromRow(row: Record<string, unknown>): TokenConsumptionViewModel {
  return {
    runId: String(row.run_id),
    model: optionalString(row.model),
    inputTokens: Number(row.input_tokens ?? 0),
    cachedInputTokens: Number(row.cached_input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    reasoningOutputTokens: Number(row.reasoning_output_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    currency: String(row.currency ?? "USD"),
    pricingStatus: String(row.pricing_status),
    sourcePath: String(row.source_path ?? ""),
    recordedAt: String(row.recorded_at ?? ""),
  };
}

function readCliAdapterRows(dbPath: string): Record<string, unknown>[] {
  return runSqlite(dbPath, [], [
    { name: "adapters", sql: "SELECT * FROM cli_adapter_configs ORDER BY updated_at DESC" },
  ]).queries.adapters;
}

function readRpcAdapterRows(dbPath: string): Record<string, unknown>[] {
  return runSqlite(dbPath, [], [
    { name: "adapters", sql: "SELECT * FROM rpc_adapter_configs ORDER BY updated_at DESC" },
  ]).queries.adapters;
}

function uniqueCliAdapters(rows: Record<string, unknown>[]): CliAdapterConfig[] {
  const byId = new Map<string, CliAdapterConfig>();
  for (const adapter of [DEFAULT_CLI_ADAPTER_CONFIG, GEMINI_CLI_ADAPTER_CONFIG, ...rows.map(cliAdapterFromRow)]) {
    byId.set(adapter.id, adapter);
  }
  return [...byId.values()];
}

function uniqueRpcAdapters(rows: Record<string, unknown>[]): RpcAdapterConfig[] {
  const byId = new Map<string, RpcAdapterConfig>();
  for (const adapter of [DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG, DEFAULT_GEMINI_ACP_ADAPTER_CONFIG, ...rows.map(rpcAdapterFromRow)]) {
    byId.set(adapter.id, adapter);
  }
  return [...byId.values()];
}

function validateExecutionPreference(
  preference: Pick<ExecutionPreferenceV1, "runMode" | "adapterId">,
  cliRows: Record<string, unknown>[],
  rpcRows: Record<string, unknown>[],
): { valid: boolean; errors: string[] } {
  const resolved = executionPreferenceForAdapterId(preference.adapterId, cliRows, rpcRows, "job");
  return { valid: resolved.errors.length === 0, errors: resolved.errors };
}

function executionPreferenceForAdapterId(
  adapterId: string | undefined,
  cliRows: Record<string, unknown>[],
  rpcRows: Record<string, unknown>[],
  source: ExecutionPreferenceV1["source"],
): { preference?: ExecutionPreferenceV1; errors: string[] } {
  const errors: string[] = [];
  if (!adapterId) {
    return { errors: ["adapterId is required"] };
  }
  const cliAdapter = uniqueCliAdapters(cliRows).find((entry) => entry.id === adapterId);
  const rpcAdapter = uniqueRpcAdapters(rpcRows).find((entry) => entry.id === adapterId);
  if (cliAdapter && rpcAdapter) {
    errors.push(`Adapter id is ambiguous across CLI and RPC adapters: ${adapterId}`);
    return { errors };
  }
  if (cliAdapter) {
    if (cliAdapter.status === "disabled" || cliAdapter.status === "invalid") errors.push(`CLI adapter is not available: ${adapterId}`);
    return { preference: { runMode: "cli", adapterId, source }, errors };
  }
  if (rpcAdapter) {
    if (rpcAdapter.status === "disabled" || rpcAdapter.status === "invalid") errors.push(`RPC adapter is not available: ${adapterId}`);
    return { preference: { runMode: "rpc", adapterId, source }, errors };
  }
  return { errors: [`Adapter not found: ${adapterId}`] };
}

function adapterFromRows(
  rows: Record<string, unknown>[],
  status: string | undefined = "active",
  fallbackToDefault = true,
  id?: string,
): CliAdapterConfig | undefined {
  const row = rows.find((entry) => {
    const statusMatches = status ? String(entry.status) === status : true;
    const idMatches = id ? String(entry.id) === id : true;
    return statusMatches && idMatches;
  });
  if (!row) {
    if (fallbackToDefault) return DEFAULT_CLI_ADAPTER_CONFIG;
    return undefined;
  }
  return cliAdapterFromRow(row);
}

function cliAdapterFromRow(row: Record<string, unknown>): CliAdapterConfig {
  return normalizeCliAdapterConfig({
    id: row.id,
    displayName: row.display_name,
    schemaVersion: row.schema_version,
    executable: row.executable,
    argumentTemplate: parseJsonArray(row.argument_template_json),
    resumeArgumentTemplate: parseJsonArray(row.resume_argument_template_json),
    configSchema: parseJsonObject(row.config_schema_json),
    formSchema: parseJsonObject(row.form_schema_json),
    defaults: parseJsonObject(row.defaults_json),
    environmentAllowlist: parseJsonArray(row.environment_allowlist_json),
    outputMapping: parseJsonObject(row.output_mapping_json),
    status: row.status,
    updatedAt: row.updated_at,
  });
}

function rpcAdapterFromRows(
  rows: Record<string, unknown>[],
  status: string | undefined = "active",
  fallbackToDefault = true,
  id?: string,
): RpcAdapterConfig | undefined {
  const row = rows.find((entry) => {
    const statusMatches = status ? String(entry.status) === status : true;
    const idMatches = id ? String(entry.id) === id : true;
    return statusMatches && idMatches;
  });
  if (!row) {
    if (fallbackToDefault) return DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG;
    return undefined;
  }
  return rpcAdapterFromRow(row);
}

function rpcAdapterFromRow(row: Record<string, unknown>): RpcAdapterConfig {
  return normalizeRpcAdapterConfig({
    id: row.id,
    displayName: row.display_name,
    provider: row.provider,
    executable: row.executable,
    args: parseJsonArray(row.args_json),
    transport: row.transport,
    endpoint: row.endpoint,
    requestTimeoutMs: row.request_timeout_ms,
    status: row.status,
    updatedAt: row.updated_at,
  });
}

function rpcAdapterPreset(id?: string): RpcAdapterConfig | undefined {
  if (id === DEFAULT_GEMINI_ACP_ADAPTER_CONFIG.id || id === "gemini-acp") return DEFAULT_GEMINI_ACP_ADAPTER_CONFIG;
  if (
    id === DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG.id
    || id === "codex-rpc"
    || id === "codex-app-server"
    || id === "codex-app-server-default"
  ) return DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG;
  return undefined;
}

function normalizeRpcAdapterConfig(input: Record<string, unknown> | Partial<RpcAdapterConfig>): RpcAdapterConfig {
  const base = optionalString(input.provider) === "gemini-acp" || optionalString(input.id) === DEFAULT_GEMINI_ACP_ADAPTER_CONFIG.id
    ? DEFAULT_GEMINI_ACP_ADAPTER_CONFIG
    : DEFAULT_CODEX_APP_SERVER_ADAPTER_CONFIG;
  const provider = optionalString(input.provider);
  const transport = input.transport === "unix" || input.transport === "http" || input.transport === "jsonrpc" || input.transport === "websocket"
    ? input.transport
    : "stdio";
  const status = input.status === "disabled" ? "disabled" : "active";
  return {
    ...base,
    id: optionalString(input.id) ?? base.id,
    displayName: optionalString(input.displayName) ?? optionalString(input.display_name) ?? base.displayName,
    provider: provider === "codex-app-server" ? "codex-rpc" : provider ?? base.provider,
    executable: optionalString(input.executable) ?? base.executable,
    args: parseJsonArray(input.args ?? input.args_json).map(String).length ? parseJsonArray(input.args ?? input.args_json).map(String) : base.args,
    transport,
    endpoint: optionalString(input.endpoint) ?? base.endpoint,
    requestTimeoutMs: Number(input.requestTimeoutMs ?? input.request_timeout_ms ?? base.requestTimeoutMs),
    status,
    updatedAt: optionalString(input.updatedAt) ?? optionalString(input.updated_at) ?? new Date().toISOString(),
  };
}

function persistCliAdapterConfig(
  dbPath: string,
  config: CliAdapterConfig,
  dryRun?: CliAdapterValidationResult,
  active = false,
): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO cli_adapter_configs (
          id, display_name, schema_version, executable, argument_template_json, resume_argument_template_json,
          config_schema_json, form_schema_json, defaults_json, environment_allowlist_json, output_mapping_json,
          status, last_dry_run_status, last_dry_run_errors_json, last_dry_run_command_json, last_dry_run_at, activated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          schema_version = excluded.schema_version,
          executable = excluded.executable,
          argument_template_json = excluded.argument_template_json,
          resume_argument_template_json = excluded.resume_argument_template_json,
          config_schema_json = excluded.config_schema_json,
          form_schema_json = excluded.form_schema_json,
          defaults_json = excluded.defaults_json,
          environment_allowlist_json = excluded.environment_allowlist_json,
          output_mapping_json = excluded.output_mapping_json,
          status = excluded.status,
          last_dry_run_status = COALESCE(excluded.last_dry_run_status, cli_adapter_configs.last_dry_run_status),
          last_dry_run_errors_json = excluded.last_dry_run_errors_json,
          last_dry_run_command_json = COALESCE(excluded.last_dry_run_command_json, cli_adapter_configs.last_dry_run_command_json),
          last_dry_run_at = COALESCE(excluded.last_dry_run_at, cli_adapter_configs.last_dry_run_at),
          activated_at = COALESCE(excluded.activated_at, cli_adapter_configs.activated_at),
          updated_at = excluded.updated_at`,
      params: [
        config.id,
        config.displayName,
        config.schemaVersion,
        config.executable,
        JSON.stringify(config.argumentTemplate),
        JSON.stringify(config.resumeArgumentTemplate ?? []),
        JSON.stringify(config.configSchema),
        JSON.stringify(config.formSchema),
        JSON.stringify(config.defaults),
        JSON.stringify(config.environmentAllowlist),
        JSON.stringify(config.outputMapping),
        config.status,
        dryRun ? (dryRun.valid ? "passed" : "failed") : null,
        JSON.stringify(dryRun?.errors ?? []),
        dryRun?.command ? JSON.stringify({ command: dryRun.command, args: dryRun.args ?? [] }) : null,
        dryRun ? config.updatedAt : null,
        active ? config.updatedAt : null,
        config.updatedAt,
      ],
    },
  ]);
}

function persistRpcAdapterConfig(
  dbPath: string,
  config: RpcAdapterConfig,
  probe?: RpcAdapterValidationResult,
  active = false,
): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO rpc_adapter_configs (
          id, display_name, provider, schema_version, executable, args_json, transport, endpoint,
          request_timeout_ms, config_schema_json, form_schema_json, defaults_json,
          status, last_probe_status, last_probe_errors_json, last_probe_command_json, last_probe_at, activated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          provider = excluded.provider,
          schema_version = excluded.schema_version,
          executable = excluded.executable,
          args_json = excluded.args_json,
          transport = excluded.transport,
          endpoint = excluded.endpoint,
          request_timeout_ms = excluded.request_timeout_ms,
          config_schema_json = excluded.config_schema_json,
          form_schema_json = excluded.form_schema_json,
          defaults_json = excluded.defaults_json,
          status = excluded.status,
          last_probe_status = COALESCE(excluded.last_probe_status, rpc_adapter_configs.last_probe_status),
          last_probe_errors_json = excluded.last_probe_errors_json,
          last_probe_command_json = COALESCE(excluded.last_probe_command_json, rpc_adapter_configs.last_probe_command_json),
          last_probe_at = COALESCE(excluded.last_probe_at, rpc_adapter_configs.last_probe_at),
          activated_at = COALESCE(excluded.activated_at, rpc_adapter_configs.activated_at),
          updated_at = excluded.updated_at`,
      params: [
        config.id,
        config.displayName,
        config.provider ?? config.id,
        1,
        config.executable,
        JSON.stringify(config.args),
        config.transport,
        config.endpoint ?? null,
        config.requestTimeoutMs,
        JSON.stringify({ type: "object", required: ["id", "provider", "executable", "args", "transport"] }),
        JSON.stringify({ fields: [
          { path: "executable", label: "Executable", type: "text" },
          { path: "args", label: "Arguments", type: "list" },
          { path: "transport", label: "Transport", type: "select" },
        ] }),
        JSON.stringify({}),
        config.status,
        probe ? (probe.valid ? "passed" : "failed") : null,
        JSON.stringify(probe?.errors ?? []),
        probe?.command ? JSON.stringify({ command: probe.command, args: probe.args ?? [] }) : null,
        probe ? config.updatedAt : null,
        active ? config.updatedAt : null,
        config.updatedAt,
      ],
    },
  ]);
}

function buildCliAdapterSummary(active: CliAdapterConfig | undefined, rows: Record<string, unknown>[]): CliAdapterSummary {
  const adapter = active ?? DEFAULT_CLI_ADAPTER_CONFIG;
  const row = rows.find((entry) => String(entry.id) === adapter.id) ?? {};
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    status: adapter.status,
    schemaVersion: adapter.schemaVersion,
    executable: adapter.executable,
    lastDryRunStatus: optionalString(row.last_dry_run_status),
    lastDryRunAt: optionalString(row.last_dry_run_at),
    lastDryRunErrors: parseJsonArray(row.last_dry_run_errors_json).map(String),
    settingsPath: "/settings/cli",
  };
}

function latestAdapterDryRun(rows: Record<string, unknown>[], adapterId: string): SystemSettingsViewModel["cliAdapter"]["lastDryRun"] {
  const row = rows.find((entry) => String(entry.id) === adapterId);
  if (!row) return undefined;
  const command = parseJsonObject(row.last_dry_run_command_json);
  const status = optionalString(row.last_dry_run_status);
  if (!status) return undefined;
  return {
    status,
    errors: parseJsonArray(row.last_dry_run_errors_json).map(String),
    command: optionalString(command.command),
    args: parseJsonArray(command.args).map(String),
    at: optionalString(row.last_dry_run_at),
  };
}

function latestRpcAdapterProbe(rows: Record<string, unknown>[], adapterId: string): SystemSettingsViewModel["rpcAdapter"]["lastProbe"] {
  const row = rows.find((entry) => String(entry.id) === adapterId);
  if (!row) return undefined;
  const command = parseJsonObject(row.last_probe_command_json);
  const status = optionalString(row.last_probe_status);
  if (!status) return undefined;
  return {
    status,
    errors: parseJsonArray(row.last_probe_errors_json).map(String),
    command: optionalString(command.command),
    args: parseJsonArray(command.args).map(String),
    at: optionalString(row.last_probe_at),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function readSkillOutputViewModel(
  workspaceRoot: string | undefined,
  executionId: string | undefined,
  metadata: Record<string, unknown> = {},
): SkillOutputViewModel | undefined {
  if (!executionId) return undefined;
  const persistedOutput = parseJsonObject(metadata.skillOutputContract);
  const persistedInputContract = metadata.skillInvocationContract;
  const persistedArtifacts = Array.isArray(metadata.producedArtifacts) ? metadata.producedArtifacts : undefined;
  if (!workspaceRoot) {
    if (Object.keys(persistedOutput).length > 0) {
      return skillOutputViewModelFromRecord(persistedOutput, undefined, {
        inputContract: persistedInputContract,
        producedArtifacts: persistedArtifacts,
      });
    }
    return {
      parseStatus: "missing",
      error: "workspace_root_missing",
      producedArtifacts: [],
    };
  }

  const runDir = join(workspaceRoot, ".autobuild", "runs", sanitizeRunPathSegment(executionId));
  const stdoutLogPath = join(runDir, "stdout.log");
  const stdoutLog = readStdoutLogEvents(stdoutLogPath);
  if (!stdoutLog.exists) {
    if (Object.keys(persistedOutput).length > 0) {
      return skillOutputViewModelFromRecord(persistedOutput, undefined, {
        stdoutLogPath,
        inputContract: persistedInputContract,
        producedArtifacts: persistedArtifacts,
      });
    }
    return {
      parseStatus: "missing",
      stdoutLogPath,
      error: "stdout_log_not_found",
      producedArtifacts: [],
    };
  }
  if (stdoutLog.error) {
    return {
      parseStatus: "invalid",
      stdoutLogPath,
      error: stdoutLog.error,
      producedArtifacts: [],
    };
  }

  const raw = stdoutLog.events;
  const output = findSkillOutputRecord(raw) ?? (Object.keys(persistedOutput).length > 0 ? persistedOutput : undefined);
  return skillOutputViewModelFromRecord(output, raw, {
    stdoutLogPath,
    inputContract: persistedInputContract,
    producedArtifacts: persistedArtifacts,
  });
}

function skillOutputViewModelFromRecord(
  output: Record<string, unknown> | undefined,
  raw: unknown,
  options: {
    stdoutLogPath?: string;
    inputContract?: unknown;
    producedArtifacts?: unknown[];
  } = {},
): SkillOutputViewModel {
  const tokenUsage = skillOutputTokenUsage(output, raw);
  return {
    parseStatus: "found",
    stdoutLogPath: options.stdoutLogPath,
    status: optionalString(output?.status),
    summary: optionalString(output?.summary),
    nextAction: optionalString(output?.nextAction),
    tokenUsage,
    inputContract: compactSkillOutputValue(skillInputContract(output, raw) ?? options.inputContract),
    producedArtifacts: arrayValue(output?.producedArtifacts ?? options.producedArtifacts).map(compactSkillOutputValue),
    traceability: compactSkillOutputValue(output?.traceability),
    result: compactSkillOutputValue(output?.result),
    recordCount: Array.isArray(raw) ? raw.length : undefined,
  };
}

function compactSkillOutputValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.length <= 4000) return value;
    return `${value.slice(0, 4000)}\n...[truncated ${value.length - 4000} chars]`;
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (depth >= 8) {
    return "[truncated nested value]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => compactSkillOutputValue(entry, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, compactSkillOutputValue(entry, depth + 1)]),
  );
}

function readStdoutLogEvents(stdoutLogPath: string): { exists: boolean; events: unknown[]; error?: string } {
  if (!existsSync(stdoutLogPath)) {
    return { exists: false, events: [] };
  }
  const events: unknown[] = [];
  const lines = readFileSync(stdoutLogPath, "utf8").split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      return {
        exists: true,
        events,
        error: `stdout_log_invalid_json_line_${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { exists: true, events };
}

function skillInputContract(output: Record<string, unknown> | undefined, raw: unknown): unknown {
  const rawRecord = isRecord(raw) ? raw : undefined;
  return output?.inputContract
    ?? output?.input
    ?? output?.request
    ?? rawRecord?.inputContract
    ?? rawRecord?.input
    ?? rawRecord?.request;
}

function skillOutputTokenUsage(output: Record<string, unknown> | undefined, raw: unknown): unknown {
  return tokenUsageFromRecord(output) ?? tokenUsageFromValue(raw);
}

function tokenUsageFromValue(value: unknown): unknown {
  const direct = tokenUsageFromRecord(isRecord(value) ? value : undefined);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const usage = tokenUsageFromValue(item);
      if (usage) return usage;
    }
  }
  return undefined;
}

function tokenUsageFromRecord(record: Record<string, unknown> | undefined): unknown {
  if (!record) return undefined;
  return record.tokenUsage
    ?? record.usage
    ?? record.tokens
    ?? tokenUsageFromValue(record.output)
    ?? tokenUsageFromValue(record.item);
}

function findSkillOutputRecord(value: unknown): Record<string, unknown> | undefined {
  const record = isRecord(value) ? value : undefined;
  if (record?.contractVersion === "skill-contract/v1") return record;
  if (record && ("summary" in record || "producedArtifacts" in record || "traceability" in record || "result" in record)) return record;
  if (!Array.isArray(value)) return record;

  for (const item of value) {
    const direct = findSkillOutputRecordFromEvent(item);
    if (direct) return direct;
  }
  return undefined;
}

function findSkillOutputRecordFromEvent(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.contractVersion === "skill-contract/v1") return value;
  const output = findSkillOutputRecord(value.output);
  if (output) return output;
  const item = isRecord(value.item) ? value.item : undefined;
  if (typeof item?.text === "string") {
    const parsed = parseJson(item.text);
    const fromText = findSkillOutputRecord(parsed);
    if (fromText) return fromText;
  }
  return undefined;
}

function sanitizeRunPathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-") || "run";
}

function elapsedMs(started: bigint): number {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : parseJsonArray(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : String(value);
}

function nonNegativeInteger(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function requirePayloadString(payload: Record<string, unknown>, key: string): string {
  const value = optionalString(payload[key]);
  if (!value) {
    throw new Error(`Missing payload.${key}`);
  }
  return value;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function normalizeFeatureStatus(value: unknown): FeatureLifecycleStatus {
  const status = String(value);
  return [
    "draft",
    "ready",
    "planning",
    "tasked",
    "implementing",
    "done",
    "delivered",
    "review_needed",
    "blocked",
    "failed",
  ].includes(status)
    ? status as FeatureLifecycleStatus
    : "draft";
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireCommandString(input: Record<string, unknown>, key: keyof ConsoleCommandInput): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Console command requires ${String(key)}.`);
  }
  return value.trim();
}

function normalizeCommandTime(value: ConsoleCommandInput["now"]): Date {
  if (value === undefined) {
    return new Date();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Console command requires a valid now timestamp.");
  }
  return date;
}
