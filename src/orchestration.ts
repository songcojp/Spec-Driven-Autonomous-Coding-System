import { randomUUID } from "node:crypto";
import { runSqlite } from "./sqlite.ts";
import { recordAuditEvent } from "./persistence.ts";
import type { AcceptanceCriteria, Requirement } from "./spec-protocol.ts";

export type BoardColumn =
  | "backlog"
  | "ready"
  | "scheduled"
  | "running"
  | "checking"
  | "review_needed"
  | "blocked"
  | "failed"
  | "done"
  | "delivered";

export type FeatureLifecycleStatus =
  | "draft"
  | "ready"
  | "planning"
  | "tasked"
  | "implementing"
  | "done"
  | "delivered"
  | "review_needed"
  | "blocked"
  | "failed";

export type ReviewNeededReason = "approval_needed" | "clarification_needed" | "risk_review_needed";
export type RiskLevel = "low" | "medium" | "high";
export type Parallelism = "sequential" | "parallel-safe" | "exclusive";

export type StateTransition = {
  id: string;
  entityType: "feature" | "task";
  entityId: string;
  from: FeatureLifecycleStatus | BoardColumn;
  to: FeatureLifecycleStatus | BoardColumn;
  reason: string;
  evidence: string;
  triggeredBy: string;
  occurredAt: string;
  reviewNeededReason?: ReviewNeededReason;
};

export type TaskGraphTask = {
  taskId: string;
  title: string;
  description: string;
  sourceRequirementIds: string[];
  acceptanceCriteriaIds: string[];
  allowedFiles: string[];
  dependencies: string[];
  parallelism: Parallelism;
  risk: RiskLevel;
  requiredSkill: string;
  subagent: string;
  estimatedEffort: number;
  status: BoardColumn;
};

export type TaskGraph = {
  id: string;
  featureId: string;
  createdAt: string;
  tasks: TaskGraphTask[];
};

export type BuildTaskGraphInput = {
  featureId: string;
  requirements: Requirement[];
  acceptanceCriteria: AcceptanceCriteria[];
  relatedFiles?: string[];
  defaultSkill?: string;
  defaultSubagent?: string;
  now?: Date;
};

export type FeatureCandidate = {
  id: string;
  title: string;
  status: FeatureLifecycleStatus;
  priority: number;
  dependencies: string[];
  requirementIds: string[];
  acceptanceRisk: RiskLevel;
  readySince: string;
};

export type FeatureSelectionDecision = {
  id: string;
  selectedFeatureId?: string;
  candidates: Array<{
    id: string;
    title: string;
    priority: number;
    dependenciesSatisfied: boolean;
    acceptanceRisk: RiskLevel;
    readySince: string;
  }>;
  reason: string;
  memorySummary: string;
  createdAt: string;
};

export type PlanningStageSlug =
  | "technical-context-skill"
  | "research-decision-skill"
  | "architecture-plan-skill"
  | "data-model-skill"
  | "contract-design-skill"
  | "task-slicing-skill";

export type PlanningPipelineResult = {
  featureId: string;
  status: "completed" | "review_needed";
  stages: Array<{
    slug: PlanningStageSlug;
    status: "completed" | "failed";
    output?: unknown;
    evidence: string;
  }>;
  failureEvidence?: string;
};

export type TaskSchedule = {
  taskId: string;
  status: "scheduled" | "skipped";
  reason: string;
};

export type SchedulerAvailability = {
  runnerAvailable: boolean;
  worktreeAvailable: boolean;
  budgetRemaining: number;
  executionWindowOpen: boolean;
  approvedRiskLevels?: RiskLevel[];
  filesInUse?: string[];
};

export type FeatureAggregationInput = {
  featureId: string;
  tasks: Pick<TaskGraphTask, "taskId" | "status">[];
  acceptancePassed: boolean;
  specAlignmentPassed: boolean;
  requiredTestsPassed: boolean;
  reviewNeededReason?: ReviewNeededReason;
};

export const BOARD_COLUMNS: BoardColumn[] = [
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
];

export const FEATURE_STATUSES: FeatureLifecycleStatus[] = [
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
];

export const REVIEW_NEEDED_REASONS: ReviewNeededReason[] = [
  "approval_needed",
  "clarification_needed",
  "risk_review_needed",
];

export const PLANNING_PIPELINE_ORDER: PlanningStageSlug[] = [
  "technical-context-skill",
  "research-decision-skill",
  "architecture-plan-skill",
  "data-model-skill",
  "contract-design-skill",
  "task-slicing-skill",
];

const BOARD_TRANSITIONS: Record<BoardColumn, BoardColumn[]> = {
  backlog: ["ready", "blocked"],
  ready: ["scheduled", "blocked"],
  scheduled: ["running", "blocked"],
  running: ["checking", "done", "review_needed", "blocked", "failed"],
  checking: ["done", "review_needed", "blocked", "failed"],
  review_needed: ["ready", "blocked", "failed"],
  blocked: ["ready", "failed"],
  failed: ["ready", "blocked"],
  done: ["delivered", "review_needed"],
  delivered: [],
};

const FEATURE_TRANSITIONS: Record<FeatureLifecycleStatus, FeatureLifecycleStatus[]> = {
  draft: ["ready", "review_needed", "blocked"],
  ready: ["planning", "blocked"],
  planning: ["tasked", "review_needed", "blocked", "failed"],
  tasked: ["implementing", "review_needed", "blocked", "failed"],
  implementing: ["done", "review_needed", "blocked", "failed"],
  done: ["delivered", "review_needed"],
  delivered: [],
  review_needed: ["planning", "tasked", "blocked", "failed"],
  blocked: ["ready", "planning", "failed"],
  failed: ["ready", "blocked"],
};

export function transitionTask(
  taskId: string,
  from: BoardColumn,
  to: BoardColumn,
  metadata: Omit<StateTransition, "id" | "entityType" | "entityId" | "from" | "to" | "occurredAt"> & { occurredAt?: string },
): StateTransition {
  assertAllowed("task", taskId, from, to, BOARD_TRANSITIONS[from]);
  return createTransition("task", taskId, from, to, metadata);
}

export function transitionFeature(
  featureId: string,
  from: FeatureLifecycleStatus,
  to: FeatureLifecycleStatus,
  metadata: Omit<StateTransition, "id" | "entityType" | "entityId" | "from" | "to" | "occurredAt"> & { occurredAt?: string },
): StateTransition {
  assertAllowed("feature", featureId, from, to, FEATURE_TRANSITIONS[from]);
  if (to === "review_needed" && !metadata.reviewNeededReason) {
    throw new Error("review_needed transition requires a reviewNeededReason");
  }
  return createTransition("feature", featureId, from, to, metadata);
}

export function buildTaskGraph(input: BuildTaskGraphInput): TaskGraph {
  const now = input.now ?? new Date();
  const acceptanceByRequirement = new Map<string, AcceptanceCriteria[]>();
  for (const criteria of input.acceptanceCriteria) {
    const entries = acceptanceByRequirement.get(criteria.requirementId) ?? [];
    entries.push(criteria);
    acceptanceByRequirement.set(criteria.requirementId, entries);
  }

  const tasks = input.requirements.map((requirement, index) => {
    const acceptance = acceptanceByRequirement.get(requirement.id) ?? [];
    return {
      taskId: `${input.featureId}-TASK-${String(index + 1).padStart(3, "0")}`,
      title: `Implement ${requirement.id}`,
      description: requirement.behavior || requirement.statement,
      sourceRequirementIds: [requirement.id],
      acceptanceCriteriaIds: acceptance.map((criteria) => criteria.id),
      allowedFiles: input.relatedFiles ?? [],
      dependencies: index === 0 ? [] : [`${input.featureId}-TASK-${String(index).padStart(3, "0")}`],
      parallelism: index === 0 ? "sequential" : "parallel-safe",
      risk: requirement.observable && requirement.atomic ? "low" : "medium",
      requiredSkill: input.defaultSkill ?? "codex-coding-skill",
      subagent: input.defaultSubagent ?? "implementer-subagent",
      estimatedEffort: Math.max(1, acceptance.length),
      status: "backlog" as const,
    };
  });

  return {
    id: `TG-${input.featureId}-${now.getTime()}`,
    featureId: input.featureId,
    createdAt: now.toISOString(),
    tasks,
  };
}

export function selectNextFeature(
  candidates: FeatureCandidate[],
  completedFeatureIds: string[],
  memorySummary = "",
  now: Date = new Date(),
): FeatureSelectionDecision {
  const completed = new Set(completedFeatureIds);
  const summarized = candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    priority: candidate.priority,
    dependenciesSatisfied: candidate.dependencies.every((dependency) => completed.has(dependency)),
    acceptanceRisk: candidate.acceptanceRisk,
    readySince: candidate.readySince,
  }));
  const eligible = candidates.filter(
    (candidate) =>
      candidate.status === "ready" && candidate.dependencies.every((dependency) => completed.has(dependency)),
  );
  const selected = [...eligible].sort(compareCandidates)[0];

  return {
    id: randomUUID(),
    selectedFeatureId: selected?.id,
    candidates: summarized,
    reason: selected
      ? `Selected ${selected.id}: ready, dependencies satisfied, priority ${selected.priority}, risk ${selected.acceptanceRisk}.`
      : "No ready feature has all dependencies satisfied.",
    memorySummary,
    createdAt: now.toISOString(),
  };
}

export async function runPlanningPipeline(
  featureId: string,
  runStage: (slug: PlanningStageSlug) => Promise<{ output?: unknown; evidence: string }>,
): Promise<PlanningPipelineResult> {
  const stages: PlanningPipelineResult["stages"] = [];

  for (const slug of PLANNING_PIPELINE_ORDER) {
    try {
      const result = await runStage(slug);
      stages.push({ slug, status: "completed", output: result.output, evidence: result.evidence });
    } catch (error) {
      const evidence = error instanceof Error ? error.message : String(error);
      stages.push({ slug, status: "failed", evidence });
      return {
        featureId,
        status: "review_needed",
        stages,
        failureEvidence: evidence,
      };
    }
  }

  return { featureId, status: "completed", stages };
}

export function scheduleFeatureTasks(graph: TaskGraph, availability: SchedulerAvailability): TaskSchedule[] {
  const done = new Set(graph.tasks.filter((task) => task.status === "done" || task.status === "delivered").map((task) => task.taskId));
  const approvedRiskLevels = new Set(availability.approvedRiskLevels ?? ["low", "medium"]);
  const filesInUse = new Set(availability.filesInUse ?? []);
  let budget = availability.budgetRemaining;

  return graph.tasks.map((task) => {
    if (task.status !== "ready") {
      return { taskId: task.taskId, status: "skipped", reason: `Task is ${task.status}.` };
    }
    if (!task.dependencies.every((dependency) => done.has(dependency))) {
      return { taskId: task.taskId, status: "skipped", reason: "Dependencies are not done." };
    }
    if (!availability.runnerAvailable) {
      return { taskId: task.taskId, status: "skipped", reason: "Runner unavailable." };
    }
    if (!availability.worktreeAvailable) {
      return { taskId: task.taskId, status: "skipped", reason: "Worktree unavailable." };
    }
    if (!availability.executionWindowOpen) {
      return { taskId: task.taskId, status: "skipped", reason: "Execution window closed." };
    }
    if (!approvedRiskLevels.has(task.risk)) {
      return { taskId: task.taskId, status: "skipped", reason: "Risk approval required." };
    }
    if (task.allowedFiles.some((file) => filesInUse.has(file))) {
      return { taskId: task.taskId, status: "skipped", reason: "Allowed file boundary conflicts with active work." };
    }
    if (budget < task.estimatedEffort) {
      return { taskId: task.taskId, status: "skipped", reason: "Budget exhausted." };
    }

    budget -= task.estimatedEffort;
    return { taskId: task.taskId, status: "scheduled", reason: "Dependencies, boundaries, runner, worktree, budget, window, and approval gates passed." };
  });
}

export function aggregateFeatureStatus(input: FeatureAggregationInput): { status: FeatureLifecycleStatus; reason: string; reviewNeededReason?: ReviewNeededReason } {
  if (input.tasks.length === 0) {
    return {
      status: "review_needed",
      reason: "Done cannot be evaluated without tasks.",
      reviewNeededReason: input.reviewNeededReason ?? "clarification_needed",
    };
  }
  if (input.tasks.some((task) => task.status === "failed")) {
    return { status: "failed", reason: "At least one task failed." };
  }
  if (input.tasks.some((task) => task.status === "blocked")) {
    return { status: "blocked", reason: "At least one task is blocked." };
  }
  if (input.tasks.some((task) => task.status === "review_needed")) {
    return {
      status: "review_needed",
      reason: "At least one task requires review.",
      reviewNeededReason: input.reviewNeededReason ?? "risk_review_needed",
    };
  }
  if (input.tasks.every((task) => task.status === "done" || task.status === "delivered")) {
    if (input.acceptancePassed && input.specAlignmentPassed && input.requiredTestsPassed) {
      return { status: "done", reason: "Tasks, acceptance, spec alignment, and required tests are complete." };
    }
    return {
      status: "review_needed",
      reason: "Done is gated by acceptance, Spec Alignment Check, and required tests.",
      reviewNeededReason: input.reviewNeededReason ?? "clarification_needed",
    };
  }

  return { status: "implementing", reason: "Feature has runnable or in-flight tasks." };
}

export function persistTaskGraph(dbPath: string, graph: TaskGraph): TaskGraph {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO task_graphs (id, feature_id, graph_json, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET graph_json = excluded.graph_json`,
      params: [graph.id, graph.featureId, JSON.stringify(graph), graph.createdAt],
    },
    ...graph.tasks.map((task) => ({
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json,
          acceptance_criteria_json, allowed_files_json, dependencies_json,
          risk, required_skill_slug, subagent, estimated_effort
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          status = excluded.status,
          source_requirements_json = excluded.source_requirements_json,
          acceptance_criteria_json = excluded.acceptance_criteria_json,
          allowed_files_json = excluded.allowed_files_json,
          dependencies_json = excluded.dependencies_json,
          risk = excluded.risk,
          required_skill_slug = excluded.required_skill_slug,
          subagent = excluded.subagent,
          estimated_effort = excluded.estimated_effort`,
      params: [
        task.taskId,
        graph.id,
        graph.featureId,
        task.title,
        task.status,
        JSON.stringify(task.sourceRequirementIds),
        JSON.stringify(task.acceptanceCriteriaIds),
        JSON.stringify(task.allowedFiles),
        JSON.stringify(task.dependencies),
        task.risk,
        task.requiredSkill,
        task.subagent,
        task.estimatedEffort,
      ],
    })),
  ]);
  return graph;
}

export function persistSelectionDecision(dbPath: string, decision: FeatureSelectionDecision, projectId?: string): FeatureSelectionDecision {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO feature_selection_decisions (
        id, project_id, selected_feature_id, candidates_json, reason, memory_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        decision.id,
        projectId ?? null,
        decision.selectedFeatureId ?? null,
        JSON.stringify(decision.candidates),
        decision.reason,
        decision.memorySummary,
        decision.createdAt,
      ],
    },
  ]);
  return decision;
}

export function persistTaskSchedules(dbPath: string, schedules: TaskSchedule[], now: Date = new Date()): TaskSchedule[] {
  runSqlite(
    dbPath,
    schedules.map((schedule) => ({
      sql: `INSERT INTO task_schedules (id, task_id, status, reason, created_at)
        VALUES (?, ?, ?, ?, ?)`,
      params: [randomUUID(), schedule.taskId, schedule.status, schedule.reason, now.toISOString()],
    })),
  );
  return schedules;
}

export function persistPlanningPipelineResult(
  dbPath: string,
  result: PlanningPipelineResult,
  now: Date = new Date(),
): PlanningPipelineResult {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO planning_pipeline_runs (id, feature_id, status, stages_json, failure_evidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        randomUUID(),
        result.featureId,
        result.status,
        JSON.stringify(result.stages),
        result.failureEvidence ?? null,
        now.toISOString(),
      ],
    },
  ]);
  return result;
}

export function persistStateTransition(dbPath: string, transition: StateTransition): StateTransition {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO state_transitions (
        id, entity_type, entity_id, from_status, to_status, reason, evidence,
        triggered_by, review_needed_reason, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        transition.id,
        transition.entityType,
        transition.entityId,
        transition.from,
        transition.to,
        transition.reason,
        transition.evidence,
        transition.triggeredBy,
        transition.reviewNeededReason ?? null,
        transition.occurredAt,
      ],
    },
  ]);
  recordAuditEvent(dbPath, {
    entityType: transition.entityType,
    entityId: transition.entityId,
    eventType: "state_changed",
    source: transition.triggeredBy,
    reason: transition.reason,
    payload: {
      from: transition.from,
      to: transition.to,
      evidence: transition.evidence,
      reviewNeededReason: transition.reviewNeededReason,
    },
  });
  return transition;
}

function assertAllowed(
  entityType: "feature" | "task",
  entityId: string,
  from: string,
  to: string,
  allowed: string[],
): void {
  if (!allowed.includes(to)) {
    throw new Error(`Illegal ${entityType} transition for ${entityId}: ${from} -> ${to}`);
  }
}

function createTransition(
  entityType: "feature" | "task",
  entityId: string,
  from: FeatureLifecycleStatus | BoardColumn,
  to: FeatureLifecycleStatus | BoardColumn,
  metadata: Omit<StateTransition, "id" | "entityType" | "entityId" | "from" | "to" | "occurredAt"> & { occurredAt?: string },
): StateTransition {
  return {
    id: randomUUID(),
    entityType,
    entityId,
    from,
    to,
    reason: metadata.reason,
    evidence: metadata.evidence,
    triggeredBy: metadata.triggeredBy,
    reviewNeededReason: metadata.reviewNeededReason,
    occurredAt: metadata.occurredAt ?? new Date().toISOString(),
  };
}

function compareCandidates(a: FeatureCandidate, b: FeatureCandidate): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  const riskRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
  if (riskRank[a.acceptanceRisk] !== riskRank[b.acceptanceRisk]) {
    return riskRank[a.acceptanceRisk] - riskRank[b.acceptanceRisk];
  }
  return new Date(a.readySince).getTime() - new Date(b.readySince).getTime();
}
