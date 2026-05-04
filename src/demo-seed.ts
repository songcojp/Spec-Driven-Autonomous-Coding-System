import { join, resolve } from "node:path";
import { DuplicateProjectPathError, findProjectByRepositoryPath, getProject, type ProjectRecord } from "./projects.ts";
import { recordAuditEvent } from "./persistence.ts";
import { runSqlite } from "./sqlite.ts";

export type DemoSeedResult = {
  project: ProjectRecord;
  imported: boolean;
};

const DEMO_PROJECT_ID = "demo-acme-returns-portal";
const DEMO_FEATURE_ID = "DEMO-FEAT-204";
const DEMO_TASK_READY_ID = "DEMO-TASK-229";
const DEMO_TASK_REVIEW_ID = "DEMO-TASK-230";
const DEMO_RUN_ID = "DEMO-RUN-709";

export function seedDemoProject(dbPath: string, projectRoot: string): DemoSeedResult {
  const targetRepoPath = resolve(projectRoot, "workspace", "demo-acme-returns-portal");
  const existingProject = getProject(dbPath, DEMO_PROJECT_ID);
  if (existingProject) {
    return { project: existingProject, imported: false };
  }

  const existingByPath = findProjectByRepositoryPath(dbPath, targetRepoPath);
  if (existingByPath && existingByPath.id !== DEMO_PROJECT_ID) {
    throw new DuplicateProjectPathError(targetRepoPath, existingByPath.id);
  }

  runSqlite(dbPath, demoSeedStatements(targetRepoPath));
  recordAuditEvent(dbPath, {
    entityType: "project",
    entityId: DEMO_PROJECT_ID,
    eventType: "demo_seed_imported",
    source: "project-service",
    reason: "Operator imported Demo seed data",
    payload: {
      seedKey: "demo-acme-returns-portal",
      targetRepoPath,
    },
  });

  const project = getProject(dbPath, DEMO_PROJECT_ID);
  if (!project) {
    throw new Error("Demo seed import did not create a project record");
  }
  return { project, imported: true };
}

function demoSeedStatements(targetRepoPath: string) {
  const now = "2026-04-29T03:45:00.000Z";
  return [
    {
      sql: `INSERT INTO projects (
          id, name, goal, project_type, tech_preferences_json, target_repo_path,
          default_branch, trust_level, environment, automation_enabled, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        DEMO_PROJECT_ID,
        "Demo Acme Returns Portal",
        "Demonstrate SpecDrive project scheduling and review flow",
        "demo-project",
        JSON.stringify(["typescript", "react", "specdrive"]),
        targetRepoPath,
        "main",
        "standard",
        "demo",
        0,
        "ready",
        now,
        now,
      ],
    },
    {
      sql: `INSERT INTO repository_connections (
          id, project_id, provider, remote_url, local_path, default_branch, connected_at, last_read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "DEMO-RC-1",
        DEMO_PROJECT_ID,
        "github",
        "git@github.com:acme/returns-portal.git",
        targetRepoPath,
        "main",
        now,
        now,
      ],
    },
    {
      sql: `INSERT INTO project_health_checks (id, project_id, status, reasons_json, repository_summary_json, checked_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        "DEMO-HC-1",
        DEMO_PROJECT_ID,
        "ready",
        "[]",
        JSON.stringify({ localPath: targetRepoPath, isGitRepository: true, currentBranch: "main", errors: [] }),
        now,
      ],
    },
    {
      sql: `INSERT INTO project_constitutions (
          id, project_id, version, source, title, project_goal,
          engineering_principles_json, boundary_rules_json, approval_rules_json,
          default_constraints_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "DEMO-CONST-1",
        DEMO_PROJECT_ID,
        1,
        "imported",
        "Demo Acme Returns Portal Constitution",
        "Demonstrate governed autonomous delivery",
        JSON.stringify(["Keep demo work traceable to specs"]),
        JSON.stringify(["Seed data is isolated to the demo project"]),
        JSON.stringify(["Review high-risk tasks before execution"]),
        JSON.stringify(["Default branch: main", "Environment: demo"]),
        "active",
        now,
      ],
    },
    {
      sql: `INSERT INTO project_memories (id, project_id, path, current_version, summary, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        "DEMO-MEMORY",
        DEMO_PROJECT_ID,
        join(targetRepoPath, ".autobuild", "memory", "project.md"),
        1,
        "Demo project memory initialized from seed data.",
        now,
      ],
    },
    {
      sql: `INSERT INTO memory_version_records (id, project_memory_id, version, summary, created_at)
        VALUES (?, ?, ?, ?, ?)`,
      params: ["DEMO-MEMORY-V1", "DEMO-MEMORY", 1, "Initial demo project memory.", now],
    },
    {
      sql: `INSERT INTO features (
          id, project_id, title, status, priority, folder, primary_requirements_json,
          milestone, dependencies_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        DEMO_FEATURE_ID,
        DEMO_PROJECT_ID,
        "Mobile Returns Portal",
        "implementing",
        9,
        "demo-feat-204-mobile-returns",
        JSON.stringify(["DEMO-REQ-204"]),
        "Demo",
        "[]",
        now,
      ],
    },
    {
      sql: `INSERT INTO requirements (id, feature_id, source_id, body, acceptance_criteria, priority, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "DEMO-REQ-204",
        DEMO_FEATURE_ID,
        "demo-seed",
        "Operators can review and schedule a mobile returns workflow.",
        "Demo dashboard, task board, runner, and review center show project-scoped facts.",
        "must",
        "active",
      ],
    },
    {
      sql: `INSERT INTO task_graphs (id, feature_id, graph_json)
        VALUES (?, ?, ?)`,
      params: ["DEMO-TG-204", DEMO_FEATURE_ID, JSON.stringify({ tasks: [{ taskId: DEMO_TASK_READY_ID }, { taskId: DEMO_TASK_REVIEW_ID }] })],
    },
    {
      sql: `INSERT INTO task_graph_tasks (
          id, graph_id, feature_id, title, status, source_requirements_json,
          acceptance_criteria_json, allowed_files_json, dependencies_json, risk, estimated_effort
        ) VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        DEMO_TASK_READY_ID,
        "DEMO-TG-204",
        DEMO_FEATURE_ID,
        "Connect carrier label quote mock",
        "running",
        JSON.stringify(["DEMO-REQ-204"]),
        "[]",
        JSON.stringify(["apps/web/src/returns/labels.ts"]),
        "[]",
        "medium",
        2,
        DEMO_TASK_REVIEW_ID,
        "DEMO-TG-204",
        DEMO_FEATURE_ID,
        "Approve refund decision copy",
        "review_needed",
        JSON.stringify(["DEMO-REQ-204"]),
        "[]",
        JSON.stringify(["docs/features/demo-feat-204-mobile-returns/tasks.md"]),
        JSON.stringify([DEMO_TASK_READY_ID]),
        "high",
        1,
      ],
    },
    {
      sql: `INSERT INTO tasks (id, feature_id, title, status, recovery_state, allowed_files_json)
        VALUES
          (?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?)`,
      params: [
        DEMO_TASK_READY_ID,
        DEMO_FEATURE_ID,
        "Connect carrier label quote mock",
        "running",
        "pending",
        JSON.stringify(["apps/web/src/returns/labels.ts"]),
        DEMO_TASK_REVIEW_ID,
        DEMO_FEATURE_ID,
        "Approve refund decision copy",
        "review_needed",
        "pending",
        JSON.stringify(["docs/features/demo-feat-204-mobile-returns/tasks.md"]),
      ],
    },
    {
      sql: `INSERT INTO execution_records (
          id, executor_type, operation, project_id, context_json, status,
          started_at, summary, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        DEMO_RUN_ID,
        "cli",
        "feature_execution",
        DEMO_PROJECT_ID,
        JSON.stringify({ taskId: DEMO_TASK_READY_ID, featureId: DEMO_FEATURE_ID, workspaceRoot: targetRepoPath }),
        "running",
        "2026-04-29T03:42:00.000Z",
        "Demo carrier quote task is running.",
        JSON.stringify({ automatic: true }),
        "2026-04-29T03:42:00.000Z",
        now,
      ],
    },
    {
      sql: `INSERT INTO runner_heartbeats (
          id, run_id, runner_id, status, sandbox_mode, approval_policy, queue_status, beat_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: ["DEMO-HB-1", DEMO_RUN_ID, "demo-runner", "online", "workspace-write", "on-request", "running", now],
    },
    {
      sql: `INSERT INTO raw_execution_logs (id, run_id, stdout, stderr, events_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      params: ["DEMO-LOG-1", DEMO_RUN_ID, "Demo run accepted by CLI adapter.", "", "[]", now],
    },
    {
      sql: `INSERT INTO status_check_results (
          id, run_id, task_id, feature_id, project_id, status, summary, reasons_json,
          recommended_actions_json, path, kind, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "DEMO-STATUS-1",
        DEMO_RUN_ID,
        DEMO_TASK_READY_ID,
        DEMO_FEATURE_ID,
        DEMO_PROJECT_ID,
        "checking",
        "Demo status checker is observing the run.",
        "[]",
        "[]",
        ".autobuild/reports/demo-run-709.json",
        "test",
        JSON.stringify({ pullRequest: { id: "DEMO-PR-42", title: "Demo returns portal", url: "https://example.test/demo/pr/42", createdAt: now } }),
        now,
      ],
    },
    {
      sql: `INSERT INTO review_items (
          id, project_id, feature_id, task_id, run_id, status, severity,
          body, reference_refs_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "DEMO-REV-318",
        DEMO_PROJECT_ID,
        DEMO_FEATURE_ID,
        DEMO_TASK_REVIEW_ID,
        DEMO_RUN_ID,
        "review_needed",
        "medium",
        JSON.stringify({ message: "Refund decision copy needs product approval before customer demo." }),
        JSON.stringify(["DEMO-STATUS-1"]),
        "2026-04-29T03:43:00.000Z",
        now,
      ],
    },
    {
      sql: `INSERT INTO metric_samples (id, metric_name, metric_value, unit, labels_json, sampled_at)
        VALUES
          (?, ?, ?, ?, ?, ?),
          (?, ?, ?, ?, ?, ?)`,
      params: [
        "DEMO-METRIC-SUCCESS",
        "success_rate",
        0.95,
        "ratio",
        JSON.stringify({ projectId: DEMO_PROJECT_ID }),
        now,
        "DEMO-METRIC-FAILURE",
        "failure_rate",
        0.05,
        "ratio",
        JSON.stringify({ projectId: DEMO_PROJECT_ID }),
        now,
      ],
    },
    {
      sql: `INSERT INTO token_consumption_records (
          id, run_id, project_id, feature_id, task_id, operation, model,
          input_tokens, output_tokens, total_tokens, cost_usd, currency,
          pricing_status, usage_json, pricing_json, source_path, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        "DEMO-TOKEN-1",
        DEMO_RUN_ID,
        DEMO_PROJECT_ID,
        DEMO_FEATURE_ID,
        DEMO_TASK_READY_ID,
        "feature_execution",
        "gpt-5.5",
        4200,
        800,
        5000,
        0.84,
        "USD",
        "priced",
        "{}",
        "{}",
        join(targetRepoPath, ".autobuild", "runs", DEMO_RUN_ID, "stdout.log"),
        now,
      ],
    },
  ];
}
