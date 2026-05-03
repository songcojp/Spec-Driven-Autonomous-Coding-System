import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeliveryPackage, evaluateDeliveryGate, type GhRunner } from "../src/delivery.ts";
import { listAuditEvents, listMetricSamples } from "../src/persistence.ts";
import { initializeSchema, listTables, SCHEMA_VERSION } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";

const stableDate = new Date("2026-04-28T16:00:00.000Z");

test("current schema includes delivery manager records", () => {
  const dbPath = makeDbPath();
  const state = initializeSchema(dbPath);

  assert.equal(SCHEMA_VERSION, 27);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  const tables = listTables(dbPath);
  assert.equal(tables.includes("pull_request_records"), true);
  assert.equal(tables.includes("delivery_reports"), true);
  assert.equal(tables.includes("spec_evolution_suggestions"), true);
});

test("delivery gate requires traceable evidence, approval, tests, merge readiness, and rollback", () => {
  const gate = evaluateDeliveryGate({
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    featureStatus: "done",
    requirements: [{ id: "REQ-048" }],
    tasks: [{ id: "TASK-001", title: "Create PR", status: "done" }],
    evidence: [{ id: "EVID-012", kind: "test", summary: "Evidence exists." }],
    approvals: [],
    tests: [{ status: "passed", summary: "Targeted tests passed." }],
    mergeReady: false,
  });

  assert.equal(gate.status, "review_needed");
  assert.deepEqual(gate.missing.sort(), ["approval", "merge_readiness", "rollback_plan"].sort());
});

test("delivery gate ignores stale approval after review is reopened", () => {
  const gate = evaluateDeliveryGate({
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    featureStatus: "done",
    requirements: [{ id: "REQ-048" }],
    tasks: [{ id: "TASK-001", title: "Create PR", status: "done" }],
    evidence: [{ id: "EVID-012", kind: "test", summary: "Evidence exists." }],
    approvals: [
      { id: "APPROVAL-OLD", reviewItemId: "REV-012", decision: "approve_continue", reviewStatus: "changes_requested" },
      { id: "APPROVAL-NEW", reviewItemId: "REV-012", decision: "request_changes", reviewStatus: "changes_requested" },
    ],
    tests: [{ status: "passed", summary: "Targeted tests passed." }],
    mergeReady: true,
    rollbackPlan: {
      branch: "feat/feat-012-delivery-spec-evolution",
      baseCommit: "abc123",
      rollbackCommand: "git reset --hard abc123",
      summary: "rollback ready",
    },
  });

  assert.equal(gate.status, "review_needed");
  assert.equal(gate.missing.includes("approval"), true);
});

test("delivery gate requires unresolved review items to be cleared", () => {
  const gate = evaluateDeliveryGate({
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    featureStatus: "done",
    requirements: [{ id: "REQ-048" }],
    tasks: [{ id: "TASK-001", title: "Create PR", status: "done" }],
    evidence: [{ id: "EVID-012", kind: "test", summary: "Evidence exists." }],
    approvals: [{ id: "APPROVAL-OLD", reviewItemId: "REV-012", decision: "approve_continue", reviewStatus: "approved" }],
    openReviewItems: [{ id: "REV-012-LATE", status: "review_needed", reviewNeededReason: "risk_review_needed" }],
    tests: [{ status: "passed", summary: "Targeted tests passed." }],
    mergeReady: true,
    rollbackPlan: {
      branch: "feat/feat-012-delivery-spec-evolution",
      baseCommit: "abc123",
      rollbackCommand: "git reset --hard abc123",
      summary: "rollback ready",
    },
  });

  assert.equal(gate.status, "review_needed");
  assert.equal(gate.missing.includes("approval"), true);
});

test("delivery package creates PR record, report artifact, spec evolution suggestion, and delivered transition", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-012-delivery-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedReadyDelivery(dbPath);

  const ghCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const runner: GhRunner = (command, args, cwd) => {
    ghCalls.push({ command, args, cwd });
    return { status: 0, stdout: "https://github.com/songcojp/specdrive/pull/12\n", stderr: "" };
  };

  const delivery = createDeliveryPackage({
    dbPath,
    artifactRoot: join(root, ".autobuild"),
    repositoryPath: root,
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    baseBranch: "main",
    headBranch: "feat/feat-012-delivery-spec-evolution",
    changedFiles: ["src/delivery.ts", "tests/delivery.test.ts"],
    risks: ["GitHub permission matrix is out of MVP scope."],
    nextSteps: ["Review the generated PR."],
    specEvolution: [
      {
        reason: "Implementation found PR body should include rollback command.",
        suggestion: "Keep rollback command as mandatory delivery report content.",
        sourceEvidenceRefs: ["EVID-012"],
        impactScope: ["REQ-048", "REQ-049"],
      },
    ],
    now: stableDate,
    ghRunner: runner,
  });

  assert.equal(delivery.gate.status, "ready");
  assert.equal(delivery.pullRequest?.status, "created");
  assert.equal(delivery.pullRequest?.url, "https://github.com/songcojp/specdrive/pull/12");
  assert.equal(ghCalls[0].command, "gh");
  assert.deepEqual(ghCalls[0].args.slice(0, 3), ["pr", "create", "--title"]);
  assert.equal(ghCalls[0].cwd, root);

  const reportPath = join(root, delivery.report.path);
  assert.equal(existsSync(reportPath), true);
  const body = readFileSync(reportPath, "utf8");
  assert.match(body, /Delivery Report: FEAT-012/);
  assert.match(body, /Rollback:/);
  assert.match(body, /Spec Evolution Suggestions/);

  const rows = runSqlite(dbPath, [], [
    { name: "prs", sql: "SELECT status, url, requirements_json, rollback_plan_json FROM pull_request_records" },
    { name: "reports", sql: "SELECT status, path, spec_evolution_suggestion_ids_json FROM delivery_reports" },
    { name: "suggestions", sql: "SELECT reason, source_refs_json, impact_scope_json FROM spec_evolution_suggestions" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-012'" },
    { name: "transitions", sql: "SELECT to_status, evidence FROM state_transitions WHERE entity_id = 'FEAT-012'" },
  ]).queries;

  assert.equal(rows.prs[0].status, "created");
  assert.match(String(rows.prs[0].requirements_json), /REQ-048/);
  assert.match(String(rows.prs[0].rollback_plan_json), /git switch feat\/feat-012/);
  assert.equal(rows.reports[0].status, "created");
  assert.match(String(rows.reports[0].path), /feat-012-delivery-report\.md/);
  assert.match(String(rows.reports[0].spec_evolution_suggestion_ids_json), /[a-f0-9-]{36}/);
  assert.match(String(rows.suggestions[0].source_refs_json), /EVID-012/);
  assert.match(String(rows.suggestions[0].impact_scope_json), /REQ-049/);
  assert.equal(rows.feature[0].status, "delivered");
  assert.equal(rows.transitions[0].to_status, "delivered");
  assert.equal(rows.transitions[0].evidence, delivery.report.path);
  assert.equal(listAuditEvents(dbPath, "feature", "FEAT-012").some((event) => event.eventType === "delivery_report_created"), true);
  assert.equal(listMetricSamples(dbPath).some((metric) => metric.name === "pr_delivery_report_generation_rate"), true);
});

test("delivery package blocks unresolved review items without approval records", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-012-open-review-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedReadyDelivery(dbPath);
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO review_items (
          id, project_id, feature_id, task_id, run_id, status, severity, review_needed_reason,
          trigger_reasons_json, recommended_actions_json, reference_refs_json, body, created_at, updated_at
        ) VALUES (
          'REV-012-LATE', 'project-1', 'FEAT-012', 'TASK-002', 'RUN-012-RERUN', 'review_needed', 'high',
          'risk_review_needed', '["status_check"]', '["approve_continue","request_changes"]',
          '["EVID-012"]', '{"message":"Late review is still open."}', '2026-04-28T15:04:00.000Z',
          '2026-04-28T15:04:00.000Z'
        )`,
    },
  ]);

  const delivery = createDeliveryPackage({
    dbPath,
    artifactRoot: join(root, ".autobuild"),
    repositoryPath: root,
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    baseBranch: "main",
    headBranch: "feat/feat-012-delivery-spec-evolution",
    changedFiles: ["src/delivery.ts"],
    now: stableDate,
    ghRunner: () => ({ status: 0, stdout: "https://github.com/songcojp/specdrive/pull/12\n", stderr: "" }),
  });

  assert.equal(delivery.gate.status, "review_needed");
  assert.equal(delivery.gate.missing.includes("approval"), true);
  assert.equal(delivery.pullRequest, undefined);
});

test("delivery package ignores superseded failed status checks after a successful rerun", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-012-status-rerun-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedReadyDelivery(dbPath);
  runSqlite(dbPath, [
    {
      sql: `UPDATE status_check_results
        SET id = 'STATUS-012-OLD', run_id = 'RUN-012-OLD', status = 'failed',
          summary = 'Historical failure.', created_at = '2026-04-28T15:01:00.000Z'
        WHERE id = 'STATUS-012'`,
    },
    {
      sql: `INSERT INTO runs (id, task_id, feature_id, project_id, status, metadata_json)
        VALUES ('RUN-012-RERUN', 'TASK-002', 'FEAT-012', 'project-1', 'completed', '{}')`,
    },
    {
      sql: `INSERT INTO status_check_results (
          id, run_id, task_id, feature_id, project_id, status, summary, reasons_json, recommended_actions_json,
          path, metadata_json, created_at
        ) VALUES (
          'STATUS-012-RERUN', 'RUN-012-RERUN', 'TASK-002', 'FEAT-012', 'project-1', 'done', 'Rerun passed.',
          '[]', '[]', '.autobuild/reports/RUN-012-RERUN.json', '{"statusCheckCompleted":true}', '2026-04-28T15:05:00.000Z'
        )`,
    },
  ]);

  const delivery = createDeliveryPackage({
    dbPath,
    artifactRoot: join(root, ".autobuild"),
    repositoryPath: root,
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    baseBranch: "main",
    headBranch: "feat/feat-012-delivery-spec-evolution",
    changedFiles: ["src/delivery.ts"],
    now: stableDate,
    ghRunner: () => ({ status: 0, stdout: "https://github.com/songcojp/specdrive/pull/12\n", stderr: "" }),
  });

  assert.equal(delivery.gate.status, "ready");
  assert.equal(delivery.report.testSummary.some((summary) => summary.includes("Historical failure.")), false);
  assert.equal(delivery.pullRequest?.status, "created");
});

test("prepare-request creates evidence but does not transition feature to delivered", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-012-request-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedReadyDelivery(dbPath);

  const delivery = createDeliveryPackage({
    dbPath,
    artifactRoot: join(root, ".autobuild"),
    repositoryPath: root,
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    baseBranch: "main",
    headBranch: "feat/feat-012-delivery-spec-evolution",
    changedFiles: ["src/delivery.ts"],
    mode: "prepare-request",
    now: stableDate,
  });

  assert.equal(delivery.gate.status, "ready");
  assert.equal(delivery.pullRequest?.status, "request_prepared");
  assert.equal(delivery.transition, undefined);
  assert.equal(delivery.report.status, "blocked");

  const rows = runSqlite(dbPath, [], [
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-012'" },
    { name: "prs", sql: "SELECT status FROM pull_request_records" },
    { name: "transitions", sql: "SELECT COUNT(*) AS count FROM state_transitions WHERE entity_id = 'FEAT-012'" },
  ]).queries;
  assert.equal(rows.feature[0].status, "done");
  assert.equal(rows.prs[0].status, "request_prepared");
  assert.equal(rows.transitions[0].count, 0);
});

test("delivery reports are written under configured artifact root", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-012-external-artifacts-"));
  const artifactRoot = join(root, "external-artifacts", ".autobuild");
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedReadyDelivery(dbPath);

  const delivery = createDeliveryPackage({
    dbPath,
    artifactRoot,
    repositoryPath: root,
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    baseBranch: "main",
    headBranch: "feat/feat-012-delivery-spec-evolution",
    changedFiles: ["src/delivery.ts"],
    now: stableDate,
    ghRunner: () => ({ status: 0, stdout: "https://github.com/songcojp/specdrive/pull/12\n", stderr: "" }),
  });

  assert.equal(delivery.report.path, ".autobuild/reports/feat-012-delivery-report.md");
  assert.equal(existsSync(join(artifactRoot, "reports", "feat-012-delivery-report.md")), true);
  assert.equal(existsSync(join(root, delivery.report.path)), false);
});

test("PR creation failure keeps delivery evidence and blocks PR record without dropping report", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-012-gh-fail-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedReadyDelivery(dbPath);

  const delivery = createDeliveryPackage({
    dbPath,
    artifactRoot: join(root, ".autobuild"),
    repositoryPath: root,
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    baseBranch: "main",
    headBranch: "feat/feat-012-delivery-spec-evolution",
    changedFiles: ["src/delivery.ts"],
    now: stableDate,
    ghRunner: () => ({ status: 1, stdout: "", stderr: "authentication required" }),
  });

  assert.equal(delivery.gate.status, "ready");
  assert.equal(delivery.pullRequest?.status, "blocked");
  assert.equal(delivery.report.status, "blocked");
  assert.equal(delivery.transition?.to, "review_needed");
  assert.equal(existsSync(join(root, delivery.report.path)), true);

  const rows = runSqlite(dbPath, [], [
    { name: "prs", sql: "SELECT status FROM pull_request_records" },
    { name: "reports", sql: "SELECT status FROM delivery_reports" },
    { name: "feature", sql: "SELECT status FROM features WHERE id = 'FEAT-012'" },
    { name: "transitions", sql: "SELECT to_status, review_needed_reason FROM state_transitions WHERE entity_id = 'FEAT-012'" },
  ]).queries;
  assert.equal(rows.prs[0].status, "blocked");
  assert.equal(rows.reports[0].status, "blocked");
  assert.equal(rows.feature[0].status, "review_needed");
  assert.equal(rows.transitions[0].to_status, "review_needed");
  assert.equal(rows.transitions[0].review_needed_reason, "risk_review_needed");
});

test("fallback rollback plan is non-destructive when boundary metadata is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-012-fallback-rollback-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedReadyDelivery(dbPath);
  runSqlite(dbPath, [{ sql: "DELETE FROM rollback_boundaries WHERE feature_id = 'FEAT-012'" }]);

  const delivery = createDeliveryPackage({
    dbPath,
    artifactRoot: join(root, ".autobuild"),
    repositoryPath: root,
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    baseBranch: "main",
    headBranch: "feat/feat-012-delivery-spec-evolution",
    changedFiles: ["src/delivery.ts"],
    now: stableDate,
    ghRunner: () => ({ status: 0, stdout: "https://github.com/songcojp/specdrive/pull/12\n", stderr: "" }),
  });

  assert.equal(delivery.pullRequest?.rollbackPlan.baseCommit, "unknown");
  assert.match(delivery.pullRequest?.rollbackPlan.rollbackCommand ?? "", /manual review required/);
  assert.doesNotMatch(delivery.pullRequest?.rollbackPlan.rollbackCommand ?? "", /reset --hard main/);
});

test("blocked delivery does not create spec evolution suggestions without source evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-012-no-evidence-"));
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedReadyDelivery(dbPath);
  runSqlite(dbPath, [{ sql: "DELETE FROM status_check_results WHERE feature_id = 'FEAT-012'" }]);

  const delivery = createDeliveryPackage({
    dbPath,
    artifactRoot: join(root, ".autobuild"),
    repositoryPath: root,
    featureId: "FEAT-012",
    featureTitle: "Delivery and Spec Evolution",
    baseBranch: "main",
    headBranch: "feat/feat-012-delivery-spec-evolution",
    changedFiles: ["src/delivery.ts"],
    now: stableDate,
    ghRunner: () => ({ status: 0, stdout: "https://github.com/songcojp/specdrive/pull/12\n", stderr: "" }),
  });

  assert.equal(delivery.gate.status, "blocked");
  assert.equal(delivery.specEvolutionSuggestions.length, 0);

  const rows = runSqlite(dbPath, [], [
    { name: "suggestions", sql: "SELECT COUNT(*) AS count FROM spec_evolution_suggestions WHERE feature_id = 'FEAT-012'" },
  ]).queries;
  assert.equal(rows.suggestions[0].count, 0);
});

function seedReadyDelivery(dbPath: string): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO projects (id, name, goal, project_type, tech_preferences_json, environment, status)
        VALUES ('project-1', 'SpecDrive', 'Automate spec delivery', 'typescript-service', '[]', 'local', 'ready')`,
    },
    {
      sql: `INSERT INTO features (
          id, project_id, title, status, priority, folder, primary_requirements_json, milestone, dependencies_json, updated_at
        ) VALUES (
          'FEAT-012', 'project-1', 'Delivery and Spec Evolution', 'done', 10,
          'feat-012-delivery-spec-evolution', '["REQ-048","REQ-049","REQ-050"]', 'M6', '["FEAT-009","FEAT-011"]',
          '2026-04-28T15:00:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO requirements (id, feature_id, source_id, body, acceptance_criteria, priority, status)
        VALUES
          ('REQ-048', 'FEAT-012', 'docs/zh-CN/requirements.md#REQ-048', 'Create Pull Request.', 'PR body is traceable.', 'must', 'active'),
          ('REQ-049', 'FEAT-012', 'docs/zh-CN/requirements.md#REQ-049', 'Generate delivery report.', 'Report references evidence.', 'must', 'active'),
          ('REQ-050', 'FEAT-012', 'docs/zh-CN/requirements.md#REQ-050', 'Suggest Spec Evolution.', 'Suggestion has source evidence.', 'must', 'active')`,
    },
    {
      sql: `INSERT INTO tasks (id, feature_id, title, status, recovery_state, allowed_files_json)
        VALUES
          ('TASK-001', 'FEAT-012', 'Define delivery models', 'done', 'complete', '[]'),
          ('TASK-002', 'FEAT-012', 'Create PR generator', 'done', 'complete', '[]')`,
    },
    {
      sql: `INSERT INTO runs (id, task_id, feature_id, project_id, status, metadata_json)
        VALUES ('RUN-012', 'TASK-002', 'FEAT-012', 'project-1', 'completed', '{}')`,
    },
    {
      sql: `INSERT INTO status_check_results (id, run_id, task_id, feature_id, path, kind, summary, metadata_json)
        VALUES ('EVID-012', 'RUN-012', 'TASK-002', 'FEAT-012', '.autobuild/reports/RUN-012.json', 'test', 'Delivery tests passed.', '{}')`,
    },
    {
      sql: `INSERT INTO status_check_results (
          id, run_id, task_id, feature_id, project_id, status, summary, reasons_json, recommended_actions_json,
          path, metadata_json
        ) VALUES (
          'STATUS-012', 'RUN-012', 'TASK-002', 'FEAT-012', 'project-1', 'done', 'Delivery tests passed.',
          '[]', '[]', '.autobuild/reports/RUN-012.json', '{"statusCheckCompleted":true}'
        )`,
    },
    {
      sql: `INSERT INTO review_items (
          id, project_id, feature_id, task_id, run_id, status, severity, review_needed_reason,
          trigger_reasons_json, recommended_actions_json, reference_refs_json, body, created_at, updated_at
        ) VALUES (
          'REV-012', 'project-1', 'FEAT-012', 'TASK-002', 'RUN-012', 'approved', 'medium',
          'approval_needed', '["permission_escalation"]', '["approve_continue","mark_complete"]',
          '["EVID-012"]', '{"message":"Delivery approved."}', '2026-04-28T15:01:00.000Z',
          '2026-04-28T15:02:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO approval_records (
          id, review_item_id, status, decision, actor, reason, metadata_json, decided_at, created_at
        ) VALUES (
          'APPROVAL-012', 'REV-012', 'recorded', 'approve_continue', 'reviewer',
          'Approved delivery.', '{}', '2026-04-28T15:02:00.000Z', '2026-04-28T15:02:00.000Z'
        )`,
    },
    {
      sql: `INSERT INTO worktree_records (
          id, project_id, feature_id, runner_id, path, branch, status, base_commit, target_branch, cleanup_status
        ) VALUES (
          'WT-012', 'project-1', 'FEAT-012', 'runner-main', '/workspace/feat-012',
          'feat/feat-012-delivery-spec-evolution', 'active', 'abc123', 'main', 'active'
        )`,
    },
    {
      sql: `INSERT INTO merge_readiness_results (id, worktree_id, ready, blocked_reasons_json, checks_json)
        VALUES ('MERGE-012', 'WT-012', 1, '[]', '[{"name":"test","passed":true,"reports":"node --test tests/delivery.test.ts"}]')`,
    },
    {
      sql: `INSERT INTO rollback_boundaries (
          id, worktree_id, feature_id, branch, base_commit, diff_summary, rollback_command
        ) VALUES (
          'ROLLBACK-012', 'WT-012', 'FEAT-012', 'feat/feat-012-delivery-spec-evolution',
          'abc123', 'src/delivery.ts | 240 +', 'git switch feat/feat-012-delivery-spec-evolution && git reset --hard abc123'
        )`,
    },
  ]);
}

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "specdrive-delivery-db-")), "control-plane.sqlite");
}
