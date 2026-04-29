import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import { createFeatureSpec } from "../src/spec-protocol.ts";
import {
  aggregateFeatureStatus,
  buildTaskGraph,
  createScheduleTrigger,
  persistScheduleTrigger,
  persistSelectionDecision,
  persistTaskSchedules,
  persistStateTransition,
  persistTaskGraph,
  scheduleFeatureTasks,
  selectNextFeature,
  transitionFeature,
  transitionTask,
  type FeatureCandidate,
  type TaskGraph,
} from "../src/orchestration.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

test("scheduler schema owns task graphs, decisions, schedules, triggers, and transitions", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const tables = listTables(dbPath);
  for (const table of [
    "task_graphs",
    "task_graph_tasks",
    "feature_selection_decisions",
    "state_transitions",
    "task_schedules",
    "schedule_triggers",
  ]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }
});

test("task graph builder creates traceable tasks with requirements and acceptance criteria", () => {
  const spec = createOrchestrationSpec();
  const graph = buildTaskGraph({
    featureId: spec.id,
    requirements: spec.requirements,
    acceptanceCriteria: spec.acceptanceCriteria,
    relatedFiles: ["src/orchestration.ts", "tests/orchestration.test.ts"],
    now: stableDate,
  });

  assert.equal(graph.featureId, "FEAT-004");
  assert.equal(graph.tasks.length, spec.requirements.length);
  for (const task of graph.tasks) {
    assert.match(task.taskId, /^FEAT-004-TASK-/);
    assert.equal(task.status, "backlog");
    assert.equal(task.sourceRequirementIds.length, 1);
    assert.equal(task.acceptanceCriteriaIds.length, 1);
    assert.deepEqual(task.allowedFiles, ["src/orchestration.ts", "tests/orchestration.test.ts"]);
  }
});

test("board and feature state machines allow required outcomes and reject illegal transitions", () => {
  const done = transitionTask("TASK-1", "running", "done", {
    reason: "Status checker passed",
    evidence: "RUN-1/evidence.json",
    triggeredBy: "status-checker",
    occurredAt: stableDate.toISOString(),
  });
  assert.equal(done.to, "done");

  for (const to of ["review_needed", "blocked", "failed"] as const) {
    assert.equal(
      transitionTask("TASK-1", "running", to, {
        reason: `${to} outcome`,
        evidence: "RUN-1/evidence.json",
        triggeredBy: "status-checker",
      }).to,
      to,
    );
  }

  assert.throws(
    () =>
      transitionTask("TASK-1", "ready", "done", {
        reason: "Skip execution",
        evidence: "none",
        triggeredBy: "test",
      }),
    /Illegal task transition/,
  );
  assert.throws(
    () =>
      transitionTask("TASK-1", "review_needed", "delivered", {
        reason: "Skip Done after review",
        evidence: "none",
        triggeredBy: "test",
      }),
    /Illegal task transition/,
  );
  assert.throws(
    () =>
      transitionFeature("FEAT-1", "review_needed", "delivered", {
        reason: "Skip Done after review",
        evidence: "none",
        triggeredBy: "test",
      }),
    /Illegal feature transition/,
  );
  assert.equal(
    transitionTask("TASK-1", "review_needed", "scheduled", {
      reason: "Resume queued task",
      evidence: "review:approved",
      triggeredBy: "review_center",
    }).to,
    "scheduled",
  );
  assert.throws(
    () =>
      transitionFeature("FEAT-004", "planning", "review_needed", {
        reason: "Planning failed",
        evidence: "scheduling failed",
        triggeredBy: "scheduler",
      }),
    /reviewNeededReason/,
  );

  const reviewNeeded = transitionFeature("FEAT-004", "planning", "review_needed", {
    reason: "Architecture decision needs approval",
    evidence: "ADR missing",
    triggeredBy: "scheduler",
    reviewNeededReason: "approval_needed",
  });
  assert.equal(reviewNeeded.reviewNeededReason, "approval_needed");
});

test("project scheduler selects from live feature candidates and only records memory as context", () => {
  const decision = selectNextFeature(
    [
      candidate("FEAT-004", "ready", 10, ["FEAT-001", "FEAT-002"], "medium", "2026-04-25T00:00:00.000Z"),
      candidate("FEAT-005", "ready", 99, ["FEAT-999"], "low", "2026-04-20T00:00:00.000Z"),
      candidate("FEAT-006", "draft", 50, [], "low", "2026-04-18T00:00:00.000Z"),
    ],
    ["FEAT-001", "FEAT-002"],
    "Project Memory says FEAT-005 is next, but it is not a source-of-truth candidate.",
    stableDate,
  );

  assert.equal(decision.selectedFeatureId, "FEAT-004");
  assert.equal(decision.memorySummary.includes("FEAT-005"), true);
  assert.equal(decision.candidates.find((entry) => entry.id === "FEAT-005")?.dependenciesSatisfied, false);
});

test("feature scheduler gates tasks on dependencies, boundaries, runner, worktree, budget, window, and approval", () => {
  const graph: TaskGraph = {
    id: "TG-FEAT-004",
    featureId: "FEAT-004",
    createdAt: stableDate.toISOString(),
    tasks: [
      task("TASK-001", "done", [], ["src/orchestration.ts"], "low", 1),
      task("TASK-002", "ready", ["TASK-001"], ["src/orchestration.ts"], "medium", 2),
      task("TASK-003", "ready", ["TASK-999"], ["src/other.ts"], "low", 1),
      task("TASK-004", "ready", ["TASK-001"], ["src/busy.ts"], "low", 1),
      task("TASK-005", "ready", ["TASK-001"], ["src/risky.ts"], "high", 1),
    ],
  };

  const schedules = scheduleFeatureTasks(graph, {
    runnerAvailable: true,
    worktreeAvailable: true,
    budgetRemaining: 2,
    executionWindowOpen: true,
    approvedRiskLevels: ["low", "medium"],
    filesInUse: ["src/busy.ts"],
  });

  assert.deepEqual(
    schedules.map((schedule) => [schedule.taskId, schedule.status, schedule.reason]),
    [
      ["TASK-001", "skipped", "Task is done."],
      ["TASK-002", "scheduled", "Dependencies, boundaries, runner, worktree, budget, window, and approval gates passed."],
      ["TASK-003", "skipped", "Dependencies are not done."],
      ["TASK-004", "skipped", "Allowed file boundary conflicts with active work."],
      ["TASK-005", "skipped", "Risk approval required."],
    ],
  );
});

test("schedule triggers accept manual and time modes while recording event modes behind boundaries", () => {
  const manual = createScheduleTrigger({
    projectId: "PROJECT-1",
    mode: "manual",
    source: "product-console",
    target: { type: "project", id: "PROJECT-1" },
    now: stableDate,
  });
  assert.equal(manual.result, "accepted");
  assert.equal(manual.requestedFor, stableDate.toISOString());

  const scheduled = createScheduleTrigger({
    projectId: "PROJECT-1",
    featureId: "FEAT-004",
    mode: "scheduled_at",
    requestedFor: "2026-04-29T02:00:00.000Z",
    source: "project-scheduler",
    target: { type: "feature", id: "FEAT-004" },
    now: stableDate,
  });
  assert.equal(scheduled.result, "accepted");

  const past = createScheduleTrigger({
    projectId: "PROJECT-1",
    mode: "scheduled_at",
    requestedFor: "2026-04-27T02:00:00.000Z",
    source: "project-scheduler",
    target: { type: "project", id: "PROJECT-1" },
    now: stableDate,
  });
  assert.equal(past.result, "blocked");
  assert.equal(past.reason, "Scheduled trigger is in the past.");

  const ciFailed = createScheduleTrigger({
    projectId: "PROJECT-1",
    featureId: "FEAT-004",
    mode: "ci_failed",
    source: "ci",
    target: { type: "feature", id: "FEAT-004" },
    now: stableDate,
  });
  assert.equal(ciFailed.result, "recorded");
  assert.match(ciFailed.reason, /boundary evidence/);

  const approval = createScheduleTrigger({
    projectId: "PROJECT-1",
    featureId: "FEAT-004",
    mode: "approval_granted",
    source: "review_center",
    target: { type: "feature", id: "FEAT-004" },
    boundaryEvidence: ["approval_records:APPROVAL-1"],
    now: stableDate,
  });
  assert.equal(approval.result, "recorded");
  assert.deepEqual(approval.boundaryEvidence, ["approval_records:APPROVAL-1"]);

  const recurring = createScheduleTrigger({
    projectId: "PROJECT-1",
    mode: "daily",
    requestedFor: "2026-04-27T02:00:00.000Z",
    source: "project-scheduler",
    target: { type: "project", id: "PROJECT-1" },
    now: stableDate,
  });
  assert.equal(recurring.result, "accepted");

  assert.throws(
    () =>
      createScheduleTrigger({
        mode: "manual",
        source: "product-console",
        target: { type: "task" },
        now: stableDate,
      }),
    /requires an id/,
  );
});

test("feature aggregation requires tasks, acceptance, spec alignment, and required tests for done", () => {
  assert.deepEqual(
    aggregateFeatureStatus({
      featureId: "FEAT-004",
      tasks: [],
      acceptancePassed: true,
      specAlignmentPassed: true,
      requiredTestsPassed: true,
    }),
    {
      status: "review_needed",
      reason: "Done cannot be evaluated without tasks.",
      reviewNeededReason: "clarification_needed",
    },
  );

  assert.deepEqual(
    aggregateFeatureStatus({
      featureId: "FEAT-004",
      tasks: [{ taskId: "TASK-001", status: "done" }],
      acceptancePassed: true,
      specAlignmentPassed: true,
      requiredTestsPassed: true,
    }),
    { status: "done", reason: "Tasks, acceptance, spec alignment, and required tests are complete." },
  );

  assert.deepEqual(
    aggregateFeatureStatus({
      featureId: "FEAT-004",
      tasks: [{ taskId: "TASK-001", status: "done" }],
      acceptancePassed: true,
      specAlignmentPassed: false,
      requiredTestsPassed: true,
    }),
    {
      status: "review_needed",
      reason: "Done is gated by acceptance, Spec Alignment Check, and required tests.",
      reviewNeededReason: "clarification_needed",
    },
  );
});

test("scheduler artifacts persist task graph, decisions, schedules, triggers, and audit transitions", async () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const spec = createOrchestrationSpec();
  const graph = persistTaskGraph(
    dbPath,
    buildTaskGraph({
      featureId: spec.id,
      requirements: spec.requirements,
      acceptanceCriteria: spec.acceptanceCriteria,
      now: stableDate,
    }),
  );
  const decision = persistSelectionDecision(
    dbPath,
    selectNextFeature([candidate("FEAT-004", "ready", 1, [], "low", stableDate.toISOString())], [], "memory context", stableDate),
    "PROJECT-1",
  );
  const schedules = persistTaskSchedules(
    dbPath,
    scheduleFeatureTasks(
      {
        ...graph,
        tasks: graph.tasks.map((entry, index) => ({
          ...entry,
          dependencies: [],
          status: index === 0 ? "ready" : "backlog",
        })),
      },
      {
        runnerAvailable: true,
        worktreeAvailable: true,
        budgetRemaining: 1,
        executionWindowOpen: true,
      },
    ),
    stableDate,
  );
  const trigger = persistScheduleTrigger(
    dbPath,
    createScheduleTrigger({
      projectId: "PROJECT-1",
      featureId: "FEAT-004",
      mode: "manual",
      source: "product-console",
      target: { type: "feature", id: "FEAT-004" },
      now: stableDate,
    }),
  );
  const featureScopedTrigger = persistScheduleTrigger(
    dbPath,
    createScheduleTrigger({
      projectId: "PROJECT-1",
      featureId: "FEAT-004",
      mode: "manual",
      source: "product-console",
      target: { type: "feature", id: "FEAT-004" },
      now: stableDate,
    }),
  );
  const transition = persistStateTransition(
    dbPath,
    transitionFeature("FEAT-004", "ready", "planning", {
      reason: "Feature selected",
      evidence: decision.id,
      triggeredBy: "project-scheduler",
      occurredAt: stableDate.toISOString(),
    }),
  );

  const result = runSqlite(dbPath, [], [
    { name: "graphs", sql: "SELECT COUNT(*) AS count FROM task_graphs WHERE id = ?", params: [graph.id] },
    { name: "tasks", sql: "SELECT COUNT(*) AS count FROM task_graph_tasks WHERE graph_id = ?", params: [graph.id] },
    { name: "decisions", sql: "SELECT selected_feature_id FROM feature_selection_decisions WHERE id = ?", params: [decision.id] },
    { name: "schedules", sql: "SELECT COUNT(*) AS count FROM task_schedules" },
    { name: "triggers", sql: "SELECT mode, result FROM schedule_triggers WHERE id = ?", params: [trigger.id] },
    { name: "featureAudit", sql: "SELECT entity_id FROM audit_timeline_events WHERE event_type = 'schedule_triggered' AND entity_id = ?", params: [featureScopedTrigger.featureId] },
    { name: "transitions", sql: "SELECT to_status FROM state_transitions WHERE id = ?", params: [transition.id] },
    { name: "audit", sql: "SELECT event_type FROM audit_timeline_events WHERE entity_id = 'FEAT-004'" },
  ]);

  assert.equal(result.queries.graphs[0].count, 1);
  assert.equal(result.queries.tasks[0].count, spec.requirements.length);
  assert.equal(result.queries.decisions[0].selected_feature_id, "FEAT-004");
  assert.equal(result.queries.schedules[0].count, schedules.length);
  assert.deepEqual(result.queries.triggers[0], { mode: "manual", result: "accepted" });
  assert.equal(result.queries.featureAudit[0].entity_id, "FEAT-004");
  assert.equal(result.queries.transitions[0].to_status, "planning");
  assert.deepEqual(result.queries.audit.map((row) => row.event_type).sort(), ["schedule_triggered", "schedule_triggered", "state_changed"]);
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "feat-004-db-")), ".autobuild", "autobuild.db");
}

function createOrchestrationSpec() {
  return createFeatureSpec({
    featureId: "FEAT-004",
    name: "Orchestration and State Machine",
    now: stableDate,
    rawInput: `
Goal: Turn ready specs into task graphs and auditable state transitions.
Roles: orchestrator, developer
Assumptions: Feature Spec Pool is available.
Related Files: src/orchestration.ts, tests/orchestration.test.ts
PRD: When a feature is ready, the system shall build tasks traceable to requirements.
EARS: When a task runs, the system shall restrict state to known board columns.
PR: When planning fails, the system shall put the feature into review needed with evidence.
RP: When all work is complete, the system shall require acceptance, spec alignment, and tests before done.
`,
  });
}

function candidate(
  id: string,
  status: FeatureCandidate["status"],
  priority: number,
  dependencies: string[],
  risk: FeatureCandidate["acceptanceRisk"],
  readySince: string,
): FeatureCandidate {
  return {
    id,
    title: id,
    status,
    priority,
    dependencies,
    requirementIds: [`REQ-${id}`],
    acceptanceRisk: risk,
    readySince,
  };
}

function task(
  taskId: string,
  status: TaskGraph["tasks"][number]["status"],
  dependencies: string[],
  allowedFiles: string[],
  risk: TaskGraph["tasks"][number]["risk"],
  estimatedEffort: number,
): TaskGraph["tasks"][number] {
  return {
    taskId,
    title: taskId,
    description: taskId,
    sourceRequirementIds: ["REQ-001"],
    acceptanceCriteriaIds: ["AC-001"],
    allowedFiles,
    dependencies,
    parallelism: "parallel-safe",
    risk,
    estimatedEffort,
    status,
  };
}
