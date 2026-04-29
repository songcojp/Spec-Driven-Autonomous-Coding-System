import type { ConsoleData } from "../types";

export const demoData: ConsoleData = {
  dashboard: {
    projectHealth: { totalProjects: 1, ready: 1, blocked: 0, failed: 0 },
    activeFeatures: [{ id: "FEAT-013", title: "Product Console", status: "in-progress", priority: 8 }],
    boardCounts: { ready: 9, scheduled: 6, running: 3, blocked: 2, failed: 1, done: 14 },
    runningSubagents: 3,
    todayAutomaticExecutions: 7,
    failedTasks: [{ id: "T-130", title: "Add logout endpoint", status: "failed", featureId: "FEAT-013" }],
    pendingApprovals: 4,
    cost: { totalUsd: 128.47, tokensUsed: 918000 },
    runner: { heartbeats: 42, online: 1, successRate: 0.932, failureRate: 0.068 },
    recentPullRequests: [{ id: "PR-20", title: "Workspace isolation", url: "https://example.test/pr/20" }],
    risks: [{ level: "high", message: "Dependency T-121 blocks board run.", source: "REV-245" }],
    performance: { loadMs: 118, refreshMs: 46 },
    factSources: ["projects", "features", "task_graph_tasks", "runs", "review_items", "metric_samples"],
  },
  board: {
    tasks: [
      {
        id: "T-128",
        featureId: "FEAT-013",
        title: "Add magic link auth endpoint",
        status: "ready",
        risk: "low",
        dependencies: [{ id: "T-120", status: "done", satisfied: true }],
        diff: { files: ["src/product-console.ts"], additions: 142, deletions: 18 },
        testResults: { command: "node --test tests/product-console.test.ts", passed: true, total: 18 },
        approvalStatus: "approved",
        recoveryHistory: [],
        blockedReasons: [],
      },
      {
        id: "T-129",
        featureId: "FEAT-013",
        title: "Persist sessions to Redis",
        status: "scheduled",
        risk: "medium",
        dependencies: [
          { id: "T-128", status: "done", satisfied: true },
          { id: "T-121", status: "ready", satisfied: false },
        ],
        diff: { files: ["src/schema.ts"], additions: 87, deletions: 9 },
        testResults: { command: "npm test", passed: false, total: 12 },
        approvalStatus: "pending",
        recoveryHistory: [{ from: "failed", to: "scheduled", reason: "retry: transient db lock", occurredAt: "2026-04-29T03:20:00.000Z" }],
        blockedReasons: ["Dependencies are not done: T-121."],
      },
      {
        id: "T-130",
        featureId: "FEAT-013",
        title: "Add logout endpoint",
        status: "blocked",
        risk: "high",
        dependencies: [{ id: "T-129", status: "scheduled", satisfied: false }],
        diff: { files: ["src/server.ts"], additions: 64, deletions: 3 },
        testResults: { command: "npm test", passed: false, total: 10 },
        approvalStatus: "pending",
        recoveryHistory: [{ from: "run", to: "forbidden_retry", reason: "same failure fingerprint repeated", occurredAt: "2026-04-29T03:35:00.000Z" }],
        blockedReasons: ["Task T-130 is high risk and requires approval."],
      },
    ],
    commands: [
      { action: "move_board_task", entityType: "task" },
      { action: "schedule_board_tasks", entityType: "feature" },
      { action: "run_board_tasks", entityType: "feature" },
    ],
    factSources: ["task_graph_tasks", "review_items", "approval_records", "evidence_packs", "state_transitions"],
  },
  spec: {
    features: [{ id: "FEAT-013", title: "Product Console", folder: "feat-013-product-console", status: "in-progress", primaryRequirements: ["REQ-052", "REQ-053", "REQ-061"] }],
    selectedFeature: {
      id: "FEAT-013",
      title: "Product Console",
      requirements: [
        { id: "REQ-052", body: "Dashboard can show project and task status summaries.", priority: "MVP" },
        { id: "REQ-061", body: "Board actions must go through controlled commands.", priority: "MVP" },
      ],
      clarificationRecords: [{ id: "CHG-009", summary: "API/ViewModel is not UI completion evidence." }],
      qualityChecklist: [
        { item: "requirements_present", passed: true },
        { item: "task_graph_present", passed: true },
        { item: "technical_plan_present", passed: true },
      ],
      dataModels: [{ entities: ["ConsoleDashboard", "BoardTask", "ConsoleCommandReceipt"] }],
      contracts: [{ endpoints: ["/console/dashboard", "/console/commands"] }],
      versionDiffs: [{ id: "CHG-009", summary: "Reopened FEAT-013 for browser UI." }],
    },
  },
  skills: {
    skills: [
      { slug: "feature-spec-execution", name: "Feature Spec Execution", version: "1.4.0", enabled: true, phase: "execution", riskLevel: "high", schema: { input: { type: "object" }, output: { type: "object" } }, recentRuns: [{ id: "RUN-013", status: "completed", createdAt: "2026-04-29T02:00:00.000Z" }], successRate: 0.86 },
      { slug: "feature-spec-design", name: "Feature Spec Design", version: "1.1.0", enabled: true, phase: "design", riskLevel: "medium", schema: { input: { type: "object" }, output: { type: "object" } }, recentRuns: [{ id: "RUN-012", status: "completed", createdAt: "2026-04-29T01:30:00.000Z" }], successRate: 0.93 },
    ],
  },
  subagents: {
    runs: [
      { id: "RUN-331", featureId: "FEAT-013", taskId: "T-129", status: "running", runContract: { command: "npm test", files: ["apps/product-console/src/App.tsx"] }, contextSlice: { refs: ["docs/features/feat-013-product-console/design.md"], tokenEstimate: 4200 }, evidence: [{ id: "EV-331", summary: "UI route smoke passed.", path: ".autobuild/evidence/RUN-331.json" }], tokenUsage: { input: 11800, output: 2400 } },
      { id: "RUN-332", featureId: "FEAT-013", taskId: "T-130", status: "queued", runContract: { command: "npm run console:build" }, evidence: [] },
    ],
  },
  runner: {
    runners: [
      { runnerId: "runner-01", online: true, codexVersion: "gpt-5.4", sandboxMode: "workspace-write", approvalPolicy: "never", queue: [{ runId: "RUN-331", status: "running" }, { runId: "RUN-332", status: "queued" }], recentLogs: [{ runId: "RUN-331", stdout: "Playwright route loaded", stderr: "", createdAt: "2026-04-29T03:30:00.000Z" }], lastHeartbeatAt: "2026-04-29T03:31:00.000Z", heartbeatStale: false },
    ],
  },
  reviews: {
    riskFilters: ["high", "medium"],
    items: [
      { id: "R-245", featureId: "FEAT-013", taskId: "T-129", status: "review_needed", severity: "high", body: "Persist sessions to Redis needs approval.", evidence: [{ id: "EV-R245", summary: "Dependency T-121 is incomplete.", path: ".autobuild/evidence/R-245.json" }], approvals: [], createdAt: "2026-04-29T03:00:00.000Z" },
      { id: "R-244", featureId: "FEAT-013", taskId: "T-128", status: "review_needed", severity: "medium", body: "Magic link auth endpoint diff ready.", evidence: [], approvals: [], createdAt: "2026-04-29T02:40:00.000Z" },
    ],
  },
};

export const emptyData: ConsoleData = {
  dashboard: { ...demoData.dashboard, activeFeatures: [], failedTasks: [], pendingApprovals: 0, runningSubagents: 0, risks: [], recentPullRequests: [], boardCounts: {} },
  board: { tasks: [], commands: demoData.board.commands, factSources: demoData.board.factSources },
  spec: { features: [], selectedFeature: undefined },
  skills: { skills: [] },
  subagents: { runs: [] },
  runner: { runners: [] },
  reviews: { items: [], riskFilters: [] },
};
