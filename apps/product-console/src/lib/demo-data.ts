import type { ConsoleData } from "../types";

type ConsoleProjectData = Omit<ConsoleData, "projects">;

const projects = {
  currentProjectId: "project-1",
  projects: [
    {
      id: "project-1",
      name: "Acme Returns Portal",
      repository: "git@github.com:acme/returns-portal.git",
      projectDirectory: "workspace/acme-returns-portal",
      defaultBranch: "main",
      health: "ready",
      lastActivityAt: "2026-04-29T03:45:00.000Z",
    },
    {
      id: "project-2",
      name: "Northwind Supply Planner",
      repository: "git@github.com:northwind/supply-planner.git",
      projectDirectory: "workspace/northwind-supply-planner",
      defaultBranch: "develop",
      health: "ready",
      lastActivityAt: "2026-04-29T02:20:00.000Z",
    },
  ],
} satisfies ConsoleData["projects"];

const returnsPortalData: ConsoleProjectData = {
  dashboard: {
    projectHealth: { totalProjects: 2, ready: 2, blocked: 0, failed: 0 },
    activeFeatures: [
      { id: "FEAT-204", title: "Mobile Returns Portal", status: "in-progress", priority: 9 },
      { id: "FEAT-203", title: "Refund Rules Engine", status: "ready", priority: 7 },
    ],
    boardCounts: { ready: 4, scheduled: 3, running: 2, review_needed: 2, done: 11 },
    runningSubagents: 3,
    todayAutomaticExecutions: 12,
    failedTasks: [],
    pendingApprovals: 2,
    cost: { totalUsd: 84.32, tokensUsed: 642500 },
    runner: { heartbeats: 58, online: 2, successRate: 0.957, failureRate: 0.043 },
    recentPullRequests: [
      { id: "PR-42", title: "feat(returns): add photo evidence upload flow", url: "https://example.test/pr/42", createdAt: "2026-04-29T02:58:00.000Z" },
      { id: "PR-41", title: "test(returns): cover refund eligibility matrix", url: "https://example.test/pr/41", createdAt: "2026-04-28T22:10:00.000Z" },
    ],
    risks: [
      { level: "medium", message: "Refund approval copy needs product sign-off before launch.", source: "REV-318" },
      { level: "medium", message: "Carrier API sandbox has rate limits during browser smoke.", source: "RUN-710" },
    ],
    performance: { loadMs: 96, refreshMs: 38 },
    factSources: ["projects", "features", "task_graph_tasks", "runs", "review_items", "metric_samples"],
  },
  board: {
    tasks: [
      {
        id: "T-226",
        featureId: "FEAT-204",
        title: "Draft return request intake spec",
        status: "done",
        risk: "low",
        dependencies: [],
        diff: { files: ["docs/features/feat-204-mobile-returns/requirements.md"], additions: 118, deletions: 4 },
        testResults: { command: "npm test", passed: true, total: 24 },
        approvalStatus: "approved",
        recoveryHistory: [],
        blockedReasons: [],
      },
      {
        id: "T-227",
        featureId: "FEAT-204",
        title: "Implement order lookup and eligibility cards",
        status: "done",
        risk: "medium",
        dependencies: [{ id: "T-226", status: "done", satisfied: true }],
        diff: { files: ["apps/web/src/returns/OrderLookup.tsx", "src/returns.ts"], additions: 264, deletions: 31 },
        testResults: { command: "npm test -- returns", passed: true, total: 31 },
        approvalStatus: "approved",
        recoveryHistory: [],
        blockedReasons: [],
      },
      {
        id: "T-228",
        featureId: "FEAT-204",
        title: "Add photo evidence upload with preview",
        status: "running",
        risk: "medium",
        dependencies: [{ id: "T-227", status: "done", satisfied: true }],
        diff: { files: ["apps/web/src/returns/EvidenceUpload.tsx", "src/evidence-store.ts"], additions: 193, deletions: 16 },
        testResults: { command: "npm run console:build", passed: true, total: 14 },
        approvalStatus: "not_required",
        recoveryHistory: [],
        blockedReasons: [],
      },
      {
        id: "T-229",
        featureId: "FEAT-204",
        title: "Connect carrier label quote mock",
        status: "scheduled",
        risk: "medium",
        dependencies: [{ id: "T-228", status: "running", satisfied: false }],
        diff: { files: ["src/carrier-labels.ts", "tests/carrier-labels.test.ts"], additions: 146, deletions: 11 },
        testResults: { command: "node --test tests/carrier-labels.test.ts", passed: true, total: 12 },
        approvalStatus: "pending",
        recoveryHistory: [{ from: "blocked", to: "scheduled", reason: "Carrier sandbox replaced by deterministic local fixture.", occurredAt: "2026-04-29T02:40:00.000Z" }],
        blockedReasons: ["Waiting for T-228 upload contract to be finalized."],
      },
      {
        id: "T-230",
        featureId: "FEAT-204",
        title: "Review refund approval copy",
        status: "review_needed",
        risk: "medium",
        dependencies: [{ id: "T-227", status: "done", satisfied: true }],
        diff: { files: ["apps/web/src/returns/RefundDecision.tsx", "docs/features/feat-204-mobile-returns/copy.md"], additions: 74, deletions: 22 },
        testResults: { command: "npm test -- refund-copy", passed: true, total: 9 },
        approvalStatus: "pending",
        recoveryHistory: [],
        blockedReasons: ["Product approval is required for customer-facing refund decision copy."],
      },
      {
        id: "T-231",
        featureId: "FEAT-204",
        title: "Run mobile browser acceptance",
        status: "ready",
        risk: "low",
        dependencies: [
          { id: "T-228", status: "running", satisfied: false },
          { id: "T-230", status: "review_needed", satisfied: false },
        ],
        diff: { files: ["apps/web/src/test/returns-mobile.spec.ts"], additions: 102, deletions: 0 },
        testResults: { command: "npm run console:test", passed: true, total: 7 },
        approvalStatus: "not_required",
        recoveryHistory: [],
        blockedReasons: ["Waiting for upload and copy review tasks before final acceptance."],
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
    features: [
      { id: "FEAT-204", title: "Mobile Returns Portal", folder: "feat-204-mobile-returns", status: "implementing", primaryRequirements: ["REQ-204-001", "REQ-204-002", "REQ-204-003"] },
      { id: "FEAT-203", title: "Refund Rules Engine", folder: "feat-203-refund-rules", status: "ready", primaryRequirements: ["REQ-203-001", "REQ-203-004"] },
      { id: "FEAT-202", title: "Customer Notification Timeline", folder: "feat-202-notification-timeline", status: "done", primaryRequirements: ["REQ-202-001"] },
    ],
    selectedFeature: {
      id: "FEAT-204",
      title: "Mobile Returns Portal",
      requirements: [
        { id: "REQ-204-001", body: "Customers can find eligible orders by email and order number.", priority: "MVP" },
        { id: "REQ-204-002", body: "Customers can attach photo evidence and preview files before submission.", priority: "MVP" },
        { id: "REQ-204-003", body: "The portal shows refund decision copy and carrier label options before confirmation.", priority: "MVP" },
        { id: "EDGE-204-001", body: "Expired, final-sale, and already-returned orders must show a non-submittable decision.", priority: "MVP" },
      ],
      clarificationRecords: [
        { id: "CLR-204-001", summary: "Product chose customer-facing return reasons over internal RMA codes." },
        { id: "CLR-204-002", summary: "Carrier quote integration remains mocked for launch demo." },
      ],
      qualityChecklist: [
        { item: "requirements_present", passed: true },
        { item: "mobile_acceptance_path_defined", passed: true },
        { item: "copy_review_pending", passed: false },
      ],
      dataModels: [
        { entities: ["ReturnRequest", "ReturnEvidence", "RefundDecision", "CarrierLabelQuote"] },
      ],
      contracts: [
        { endpoints: ["/returns/orders/lookup", "/returns/evidence", "/returns/label-quotes"] },
        { events: ["return_request.submitted", "refund_decision.reviewed"] },
      ],
      versionDiffs: [
        { id: "CHG-204-003", summary: "Added local carrier label fixture and mobile screenshot acceptance." },
      ],
    },
  },
  skills: {
    skills: [
      { slug: "requirement-intake-skill", name: "Requirement Intake", version: "1.2.0", enabled: true, phase: "intake", riskLevel: "medium", schema: { input: { type: "object" }, output: { type: "object" } }, recentRuns: [{ id: "RUN-701", status: "completed", createdAt: "2026-04-29T01:10:00.000Z" }], successRate: 0.94 },
      { slug: "feature-spec-design", name: "Feature Spec Design", version: "1.1.0", enabled: true, phase: "design", riskLevel: "medium", schema: { input: { type: "object" }, output: { type: "object" } }, recentRuns: [{ id: "RUN-704", status: "completed", createdAt: "2026-04-29T01:55:00.000Z" }], successRate: 0.91 },
      { slug: "codex-coding-skill", name: "Codex Coding", version: "1.0.0", enabled: true, phase: "execution", riskLevel: "high", schema: { input: { type: "object" }, output: { type: "object" } }, recentRuns: [{ id: "RUN-709", status: "running", createdAt: "2026-04-29T03:12:00.000Z" }], successRate: 0.88 },
    ],
  },
  subagents: {
    runs: [
      { id: "RUN-708", featureId: "FEAT-204", taskId: "T-228", status: "running", runContract: { command: "npm test -- evidence-upload", files: ["apps/web/src/returns/EvidenceUpload.tsx"] }, contextSlice: { refs: ["docs/features/feat-204-mobile-returns/design.md"], tokenEstimate: 5100 }, evidence: [{ id: "EV-708", summary: "Upload preview smoke passed on mobile viewport.", path: ".autobuild/evidence/RUN-708.json" }], tokenUsage: { input: 14200, output: 3100 } },
      { id: "RUN-709", featureId: "FEAT-204", taskId: "T-229", status: "queued", runContract: { command: "node --test tests/carrier-labels.test.ts", files: ["src/carrier-labels.ts"] }, contextSlice: { refs: ["docs/features/feat-204-mobile-returns/contracts.md"], tokenEstimate: 3600 }, evidence: [], tokenUsage: { input: 0, output: 0 } },
      { id: "RUN-710", featureId: "FEAT-204", taskId: "T-231", status: "queued", runContract: { command: "npm run console:test -- returns-mobile", files: ["apps/web/src/test/returns-mobile.spec.ts"] }, contextSlice: { refs: ["docs/features/feat-204-mobile-returns/tasks.md"], tokenEstimate: 2900 }, evidence: [], tokenUsage: { input: 0, output: 0 } },
    ],
  },
  runner: {
    runners: [
      { runnerId: "runner-web-01", online: true, codexVersion: "gpt-5.4", sandboxMode: "workspace-write", approvalPolicy: "never", queue: [{ runId: "RUN-708", status: "running" }, { runId: "RUN-709", status: "queued" }, { runId: "RUN-710", status: "queued" }], recentLogs: [{ runId: "RUN-708", stdout: "Mobile upload preview rendered and evidence fixture stored.", stderr: "", createdAt: "2026-04-29T03:40:00.000Z" }], lastHeartbeatAt: "2026-04-29T03:45:00.000Z", heartbeatStale: false },
    ],
  },
  reviews: {
    riskFilters: ["high", "medium"],
    items: [
      { id: "REV-318", featureId: "FEAT-204", taskId: "T-230", status: "review_needed", severity: "medium", body: "Refund decision copy needs product approval before customer demo.", evidence: [{ id: "EV-318", summary: "Copy diff and screenshot are attached.", path: ".autobuild/evidence/REV-318.json" }], approvals: [], createdAt: "2026-04-29T03:15:00.000Z" },
      { id: "REV-319", featureId: "FEAT-204", taskId: "T-229", status: "review_needed", severity: "medium", body: "Carrier label fixture replaces external sandbox for demo stability.", evidence: [{ id: "EV-319", summary: "Fixture decision recorded in contracts.", path: ".autobuild/evidence/REV-319.json" }], approvals: [], createdAt: "2026-04-29T03:28:00.000Z" },
    ],
  },
};

const supplyPlannerData: ConsoleProjectData = {
  ...returnsPortalData,
  dashboard: {
    ...returnsPortalData.dashboard,
    activeFeatures: [{ id: "FEAT-311", title: "Demand Forecast Review", status: "in-progress", priority: 8 }],
    pendingApprovals: 1,
    runningSubagents: 2,
    cost: { totalUsd: 51.64, tokensUsed: 418900 },
    risks: [{ level: "medium", message: "Forecast override policy needs operations approval.", source: "REV-402" }],
  },
  board: {
    ...returnsPortalData.board,
    tasks: [
      {
        ...returnsPortalData.board.tasks[0],
        id: "T-401",
        featureId: "FEAT-311",
        title: "Model forecast confidence bands",
      },
      {
        ...returnsPortalData.board.tasks[2],
        id: "T-402",
        featureId: "FEAT-311",
        title: "Build planner override table",
      },
      {
        ...returnsPortalData.board.tasks[4],
        id: "T-403",
        featureId: "FEAT-311",
        title: "Review override approval copy",
        blockedReasons: ["Operations approval is required for override copy."],
      },
    ],
  },
  spec: {
    features: [{ id: "FEAT-311", title: "Demand Forecast Review", folder: "feat-311-demand-forecast-review", status: "implementing", primaryRequirements: ["REQ-311-001", "REQ-311-002"] }],
    selectedFeature: {
      ...returnsPortalData.spec.selectedFeature!,
      id: "FEAT-311",
      title: "Demand Forecast Review",
      requirements: [
        { id: "REQ-311-001", body: "Planners can review confidence bands by SKU and warehouse.", priority: "MVP" },
        { id: "REQ-311-002", body: "Planners can submit governed forecast overrides with approval evidence.", priority: "MVP" },
      ],
    },
  },
  reviews: {
    riskFilters: ["medium"],
    items: [
      { id: "REV-402", featureId: "FEAT-311", taskId: "T-403", status: "review_needed", severity: "medium", body: "Forecast override policy needs operations approval.", evidence: [{ id: "EV-402", summary: "Override policy diff attached.", path: ".autobuild/evidence/REV-402.json" }], approvals: [], createdAt: "2026-04-29T02:18:00.000Z" },
    ],
  },
};

const emptyProjectData: ConsoleProjectData = {
  dashboard: { ...returnsPortalData.dashboard, activeFeatures: [], failedTasks: [], pendingApprovals: 0, runningSubagents: 0, risks: [], recentPullRequests: [], boardCounts: {} },
  board: { tasks: [], commands: returnsPortalData.board.commands, factSources: returnsPortalData.board.factSources },
  spec: { features: [], selectedFeature: undefined },
  skills: { skills: [] },
  subagents: { runs: [] },
  runner: { runners: [] },
  reviews: { items: [], riskFilters: [] },
};

const projectData: Record<string, ConsoleProjectData> = {
  "project-1": returnsPortalData,
  "project-2": supplyPlannerData,
};

export const demoData: ConsoleData = {
  projects,
  ...returnsPortalData,
};

export const emptyData: ConsoleData = {
  projects,
  ...emptyProjectData,
};

export function getDemoDataForProject(projectId: string): ConsoleProjectData {
  return projectData[projectId] ?? emptyProjectData;
}
