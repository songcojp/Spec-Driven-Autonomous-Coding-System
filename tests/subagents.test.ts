import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { runSqlite } from "../src/sqlite.ts";
import { buildTestEnvironmentIsolationRecord, buildWorktreeRecord } from "../src/workspace.ts";
import {
  buildContextSlice,
  createSubagentRun,
  ensureReadOnlyConcurrency,
  evaluateContractBoundary,
  mergeSubagentResults,
  persistSubagentRunArtifacts,
  recordSubagentEvent,
  selectAgentType,
  type ContextItem,
  type FileFragment,
} from "../src/subagents.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

test("schema includes subagent contracts, context slices, events, and result merges", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const tables = listTables(dbPath);
  for (const table of ["agent_run_contracts", "context_slice_refs", "subagent_events", "result_merges"]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }
});

test("agent type selection covers supported subagent responsibilities", () => {
  assert.equal(selectAgentType({ title: "Parse EARS requirements", mode: "read" }), "spec");
  assert.equal(selectAgentType({ title: "Clarify missing business rule", mode: "read" }), "clarification");
  assert.equal(selectAgentType({ title: "Inspect repository files", mode: "read" }), "repo_probe");
  assert.equal(selectAgentType({ title: "Draft architecture decision", mode: "read" }), "architecture");
  assert.equal(selectAgentType({ title: "Slice implementation tasks", mode: "read" }), "task");
  assert.equal(selectAgentType({ title: "Implement feature", mode: "write" }), "coding");
  assert.equal(selectAgentType({ title: "Run acceptance tests", mode: "write" }), "test");
  assert.equal(selectAgentType({ title: "Review diff", mode: "read" }), "review");
  assert.equal(selectAgentType({ title: "Recover failed run", mode: "write" }), "recovery");
  assert.equal(selectAgentType({ title: "Update board state", mode: "write" }), "state");
});

test("run contract freezes execution boundary and requires workspace for write runs", () => {
  assert.throws(
    () =>
      createSubagentRun({
        featureId: "FEAT-005",
        taskId: "TASK-003",
        title: "Implement context broker",
        goal: "Create runtime module",
        mode: "write",
        allowedFiles: ["src/subagents.ts"],
      }),
    /requires an allocated workspace/,
  );

  const workspace = sampleWorktree();
  const run = createSubagentRun({
    featureId: "FEAT-005",
    taskId: "TASK-003",
    title: "Implement context broker",
    goal: "Create runtime module",
    mode: "write",
    allowedFiles: ["src/subagents.ts", "tests/subagents.test.ts"],
    readOnlyFiles: ["docs/features/feat-005-subagent-runtime-context-broker/requirements.md"],
    acceptanceCriteria: ["Agent Run Contract can describe execution boundaries."],
    workspace,
    now: stableDate,
  });

  assert.equal(run.agentType, "coding");
  assert.equal(run.contract.immutable, true);
  assert.equal(run.contract.workspace?.id, workspace.id);
  assert.deepEqual(run.contract.allowedFiles, ["src/subagents.ts", "tests/subagents.test.ts"]);
  assert.equal(run.contract.prohibitedActions.includes("read_full_main_context"), true);
  assert.equal(run.contract.prohibitedActions.includes("write_outside_allowed_files"), true);
});

test("run contract carries test environment isolation for integration and e2e runs", () => {
  const workspace = sampleWorktree();
  const isolation = buildTestEnvironmentIsolationRecord({
    runId: "RUN-ISO",
    featureId: "FEAT-005",
    taskId: "TASK-TEST",
    worktree: workspace,
    environmentId: "e2e-run-iso",
    environmentType: "e2e",
    cleanupStrategy: "remove temp database and cache namespace",
    resources: [
      {
        kind: "cache",
        name: "redis",
        namespace: "e2e-run-iso",
        connectionRef: "TEST_REDIS_URL",
        cleanupStrategy: "flush namespace",
      },
    ],
    now: stableDate,
  });
  const run = createSubagentRun({
    featureId: "FEAT-005",
    taskId: "TASK-TEST",
    title: "Run e2e tests",
    goal: "Validate isolated resources",
    mode: "write",
    workspace,
    testEnvironmentIsolation: isolation,
    now: stableDate,
  });

  assert.equal(run.contract.testEnvironmentIsolation?.environmentId, "e2e-run-iso");
  assert.equal(run.contract.testEnvironmentIsolation?.runnerInput.resourceRefs.length, 1);
  assert.equal(JSON.stringify(run.contract.testEnvironmentIsolation).includes("TEST_REDIS_URL"), true);
});

test("context broker returns only traceable spec, memory, allowed files, and evidence slices", () => {
  const run = createSubagentRun({
    featureId: "FEAT-005",
    taskId: "TASK-004",
    title: "Inspect repository context",
    goal: "Build context slice",
    mode: "read",
    allowedFiles: ["src/subagents.ts"],
    readOnlyFiles: ["docs/features/feat-005-subagent-runtime-context-broker/design.md"],
    now: stableDate,
  });
  const specSlices: ContextItem[] = [{ id: "SPEC-REQ-014", title: "REQ-014", content: "Subagent type must match responsibility." }];
  const memorySummaries: ContextItem[] = [{ id: "MEM-1", title: "Memory summary", content: "Use isolated worktrees for writes." }];
  const evidence: ContextItem[] = [{ id: "EVID-1", title: "Prior run", content: "FEAT-007 provided worktree records." }];
  const fileFragments: FileFragment[] = [
    { id: "FILE-1", title: "subagents", path: "src/subagents.ts", content: "export type AgentType", access: "allowed" },
    {
      id: "FILE-2",
      title: "design",
      path: "docs/features/feat-005-subagent-runtime-context-broker/design.md",
      content: "Context Broker",
      access: "read_only",
    },
    { id: "FILE-3", title: "unlisted", path: "src/index.ts", content: "main", access: "read_only" },
  ];

  const slice = buildContextSlice({ contract: run.contract, specSlices, memorySummaries, fileFragments, evidence, now: stableDate });

  assert.equal(slice.specSlices.length, 1);
  assert.equal(slice.memorySummaries.length, 1);
  assert.deepEqual(slice.fileFragments.map((fragment) => [fragment.path, fragment.access]).sort(), [
    ["docs/features/feat-005-subagent-runtime-context-broker/design.md", "read_only"],
    ["src/subagents.ts", "allowed"],
  ]);
  assert.equal(slice.refs.some((ref) => ref.kind === "spec_slice" && ref.sourceId === "SPEC-REQ-014"), true);
  assert.equal(slice.refs.some((ref) => ref.kind === "memory_summary" && ref.sourceId === "MEM-1"), true);
  assert.equal(slice.refs.some((ref) => ref.kind === "evidence" && ref.sourceId === "EVID-1"), true);
});

test("read-only concurrency cannot write shared workspace and write-capable runs need isolation", () => {
  const readRuns = [
    createSubagentRun({
      featureId: "FEAT-005",
      taskId: "TASK-007",
      title: "Repo probe",
      goal: "Inspect files",
      mode: "read",
      now: stableDate,
    }),
    createSubagentRun({
      featureId: "FEAT-005",
      taskId: "TASK-007",
      title: "Review diff",
      goal: "Inspect evidence",
      mode: "read",
      now: stableDate,
    }),
  ];
  assert.deepEqual(ensureReadOnlyConcurrency(readRuns), {
    allowed: true,
    evidence: "All concurrent Subagent Runs are read-only and have no shared workspace writes.",
  });

  const isolatedWrite = createSubagentRun({
    featureId: "FEAT-005",
    taskId: "TASK-007",
    title: "Run tests",
    goal: "Validate feature",
    mode: "write",
    allowedFiles: ["tests/subagents.test.ts"],
    workspace: sampleWorktree(),
    now: stableDate,
  });
  assert.equal(ensureReadOnlyConcurrency([...readRuns, isolatedWrite]).allowed, true);
});

test("contract boundary violations enter review needed for unauthorized reads or diffs", () => {
  const run = createSubagentRun({
    featureId: "FEAT-005",
    taskId: "TASK-008",
    title: "Implement bounded change",
    goal: "Touch only allowed files",
    mode: "write",
    allowedFiles: ["src/subagents.ts"],
    readOnlyFiles: ["docs/features/README.md"],
    workspace: sampleWorktree(),
    now: stableDate,
  });

  assert.deepEqual(evaluateContractBoundary(run.contract, { readFiles: ["src/subagents.ts"], diffFiles: ["src/subagents.ts"] }), {
    status: "passed",
    unauthorizedReads: [],
    unauthorizedDiffs: [],
    evidence: "Observed file access and diff stayed inside Agent Run Contract boundaries.",
  });

  const review = evaluateContractBoundary(run.contract, {
    readFiles: ["src/subagents.ts", "src/secret.ts"],
    diffFiles: ["docs/features/README.md", "src/subagents.ts"],
  });
  assert.equal(review.status, "review_needed");
  assert.deepEqual(review.unauthorizedReads, ["src/secret.ts"]);
  assert.deepEqual(review.unauthorizedDiffs, ["docs/features/README.md"]);
});

test("result merger deduplicates outputs, marks conflicts and risks, and emits board action", () => {
  const merge = mergeSubagentResults(
    [
      {
        runId: "RUN-1",
        agentType: "coding",
        status: "completed",
        summary: "implemented",
        outputs: ["contract builder done"],
        changedFiles: ["src/subagents.ts"],
        risks: [{ level: "low", message: "narrow context" }],
        confidence: 0.9,
      },
      {
        runId: "RUN-2",
        agentType: "test",
        status: "completed",
        summary: "tested",
        outputs: ["contract builder done", "tests passed"],
        changedFiles: ["src/subagents.ts"],
        confidence: 0.8,
      },
    ],
    stableDate,
  );

  assert.deepEqual(merge.outputs, ["contract builder done", "tests passed"]);
  assert.deepEqual(merge.conflicts, ["src/subagents.ts changed by RUN-1,RUN-2"]);
  assert.equal(merge.nextAction, "review_needed");
  assert.equal(merge.boardStatus, "review_needed");
  assert.equal(merge.credibility, "high");
});

test("subagent run artifacts persist for console and audit lookup", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  const run = createSubagentRun({
    featureId: "FEAT-005",
    taskId: "TASK-001",
    title: "Implement subagent runtime",
    goal: "Persist run artifacts",
    mode: "write",
    allowedFiles: ["src/subagents.ts"],
    workspace: sampleWorktree(),
    now: stableDate,
  });
  const contextSlice = buildContextSlice({
    contract: run.contract,
    specSlices: [{ id: "SPEC-REQ-014", title: "REQ-014", content: "Contract required." }],
    fileFragments: [{ id: "FILE-1", title: "runtime", path: "src/subagents.ts", content: "contract", access: "allowed" }],
    now: stableDate,
  });
  const event = recordSubagentEvent({
    runId: run.id,
    status: "context_ready",
    message: "Context slice created.",
    tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    now: stableDate,
  });
  const merge = mergeSubagentResults([{ runId: run.id, agentType: run.agentType, status: "completed", summary: "ready", confidence: 0.9 }], stableDate);

  persistSubagentRunArtifacts(dbPath, { run, contextSlice, events: [event], merge });

  const result = runSqlite(dbPath, [], [
    { name: "run", sql: "SELECT feature_id, task_id, status, metadata_json FROM runs WHERE id = ?", params: [run.id] },
    { name: "contract", sql: "SELECT run_id, contract_json FROM agent_run_contracts WHERE id = ?", params: [run.contract.id] },
    { name: "context", sql: "SELECT token_estimate FROM context_slice_refs WHERE id = ?", params: [contextSlice.id] },
    { name: "event", sql: "SELECT status, token_usage_json FROM subagent_events WHERE id = ?", params: [event.id] },
    { name: "merge", sql: "SELECT next_action, board_status FROM result_merges WHERE id = ?", params: [merge.id] },
  ]);

  assert.equal(result.queries.run[0].feature_id, "FEAT-005");
  assert.equal(JSON.parse(String(result.queries.run[0].metadata_json)).agentType, "coding");
  assert.equal(result.queries.contract[0].run_id, run.id);
  assert.equal(Number(result.queries.context[0].token_estimate) > 0, true);
  assert.equal(JSON.parse(String(result.queries.event[0].token_usage_json)).totalTokens, 120);
  assert.deepEqual(result.queries.merge[0], { next_action: "checking", board_status: "checking" });
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "feat-005-db-")), ".autobuild", "autobuild.db");
}

function sampleWorktree() {
  return buildWorktreeRecord({
    worktreePath: "/repo.worktrees/feat-005-task-001",
    featureId: "FEAT-005",
    taskId: "TASK-001",
    runnerId: "codex",
    branch: "work/feat-005-task-001",
    targetBranch: "main",
    baseCommit: "abc123",
    now: stableDate,
  });
}
