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

const cliAdapterConfig = {
  id: "codex-cli",
  displayName: "Codex CLI",
  schemaVersion: 1,
  executable: "codex",
  argumentTemplate: ["-a", "{{approval}}", "exec", "--json", "--sandbox", "{{sandbox}}", "--model", "{{model}}", "--output-schema", "{{output_schema}}", "{{prompt}}"],
  resumeArgumentTemplate: ["-a", "{{approval}}", "--sandbox", "{{sandbox}}", "{{profile_flag}}", "{{profile}}", "exec", "resume", "--json", "-m", "{{model}}", "{{resume_session_id}}", "{{resume_prompt}}"],
  configSchema: { type: "object" },
  formSchema: { fields: ["executable", "defaults.model", "defaults.sandbox", "defaults.approval"] },
  defaults: { model: "gpt-5.3-codex", sandbox: "workspace-write", approval: "never" },
  environmentAllowlist: [],
  outputMapping: { sessionIdJsonPath: "session_id" },
  status: "active",
  updatedAt: "2026-04-29T03:45:00.000Z",
} satisfies ConsoleData["settings"]["cliAdapter"]["active"];

const settings = {
  cliAdapter: {
    active: cliAdapterConfig,
    validation: { valid: true, errors: [], warnings: [], command: "codex", args: cliAdapterConfig.argumentTemplate },
    lastDryRun: { status: "passed", errors: [], command: "codex", args: cliAdapterConfig.argumentTemplate, at: "2026-04-29T03:45:00.000Z" },
  },
  commands: [
    { action: "validate_cli_adapter_config", entityType: "cli_adapter" },
    { action: "save_cli_adapter_config", entityType: "cli_adapter" },
    { action: "activate_cli_adapter_config", entityType: "cli_adapter" },
    { action: "disable_cli_adapter_config", entityType: "cli_adapter" },
  ],
  factSources: ["cli_adapter_configs", "audit_timeline_events"],
} satisfies ConsoleData["settings"];

const overview = {
  summary: {
    totalProjects: 2,
    healthyProjects: 2,
    blockedProjects: 0,
    failedTasks: 0,
    pendingReviews: 3,
    onlineRunners: 2,
    totalCostUsd: 135.96,
  },
  projects: [
    {
      id: "project-1",
      name: "Acme Returns Portal",
      health: "ready",
      repository: "git@github.com:acme/returns-portal.git",
      projectDirectory: "workspace/acme-returns-portal",
      defaultBranch: "main",
      activeFeature: { id: "FEAT-204", title: "Mobile Returns Portal", status: "in-progress" },
      taskCounts: { ready: 4, running: 2, blocked: 2, failed: 0, done: 11 },
      failedTasks: 0,
      pendingReviews: 2,
      activeRuns: 3,
      runnerSuccessRate: 0.957,
      costUsd: 84.32,
      latestRisk: { level: "medium", message: "Refund approval copy needs sign-off", source: "REV-318" },
      lastActivityAt: "2026-04-29T03:45:00.000Z",
    },
    {
      id: "project-2",
      name: "Northwind Supply Planner",
      health: "ready",
      repository: "git@github.com:northwind/supply-planner.git",
      projectDirectory: "workspace/northwind-supply-planner",
      defaultBranch: "develop",
      activeFeature: { id: "FEAT-311", title: "Demand Forecast Review", status: "in-progress" },
      taskCounts: { ready: 2, running: 1, blocked: 1, failed: 0, done: 7 },
      failedTasks: 0,
      pendingReviews: 1,
      activeRuns: 2,
      runnerSuccessRate: 0.924,
      costUsd: 51.64,
      latestRisk: { level: "medium", message: "Forecast override policy needs approval", source: "REV-402" },
      lastActivityAt: "2026-04-29T02:20:00.000Z",
    },
  ],
  signals: [
    { id: "pending-reviews", title: "pending_reviews", tone: "amber", message: "共有 3 项待审查，跨 2 个项目", updatedAt: "刚刚" },
    { id: "blocked-tasks", title: "blocked_tasks", tone: "red", message: "2 个项目中有 3 个任务被阻塞", updatedAt: "2 分钟前" },
    { id: "runner-health", title: "runner_health", tone: "blue", message: "2/2 个 Runner 在线，成功率 93.9%（7 天）", updatedAt: "5 分钟前" },
  ],
  factSources: ["projects", "features", "task_graph_tasks", "runs", "runner_heartbeats", "review_items", "metric_samples"],
} satisfies ConsoleData["overview"];

const returnsPortalData: ConsoleProjectData = {
  overview,
  dashboard: {
    projectHealth: { totalProjects: 2, ready: 2, blocked: 0, failed: 0 },
    activeFeatures: [
      { id: "FEAT-204", title: "Mobile Returns Portal", status: "in-progress", priority: 9 },
      { id: "FEAT-203", title: "Refund Rules Engine", status: "ready", priority: 7 },
    ],
    boardCounts: { ready: 4, scheduled: 3, running: 2, review_needed: 2, done: 11 },
    activeRuns: 3,
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
    prdWorkflow: {
      targetRepoPath: "workspace/acme-returns-portal",
      sourcePath: "docs/zh-CN/PRD.md",
      resolvedSourcePath: "workspace/acme-returns-portal/docs/zh-CN/PRD.md",
      sourceVersion: "v1.3.0",
      scanMode: "smart",
      lastScanAt: "05-19 09:12",
      runtime: "10m 24s",
      blockedReasons: ["存在阻塞项，无法进入调度状态"],
      phases: [
        {
          key: "project_initialization",
          status: "completed",
          updatedAt: "05-19 09:10",
          blockedReasons: [],
          facts: [
            { label: "Project", value: "Acme Returns Portal" },
            { label: "Repository", value: "workspace/acme-returns-portal" },
            { label: "Health", value: "ready" },
          ],
          stages: [
            { key: "create_or_import_project", status: "completed", updatedAt: "05-19 09:04" },
            { key: "connect_git_repository", status: "completed", updatedAt: "05-19 09:05" },
            { key: "initialize_spec_protocol", status: "completed", updatedAt: "05-19 09:07" },
            { key: "import_or_create_constitution", status: "completed", updatedAt: "05-19 09:08" },
            { key: "initialize_project_memory", status: "completed", updatedAt: "05-19 09:10" },
          ],
        },
        {
          key: "requirement_intake",
          status: "blocked",
          updatedAt: "05-19 09:16",
          blockedReasons: ["存在阻塞项，无法进入调度状态"],
          facts: [
            { label: "PRD", value: "workspace/acme-returns-portal/docs/zh-CN/PRD.md" },
            { label: "Features", value: "3" },
            { label: "Requirements", value: "3" },
          ],
          stages: [
            { key: "spec_source_intake", status: "completed", updatedAt: "05-19 09:14" },
            { key: "recognize_requirement_format", status: "completed", updatedAt: "05-19 09:15" },
            { key: "generate_ears", action: "generate_ears", status: "completed", updatedAt: "05-19 09:16", auditEventId: "AUD-PRD-003", evidencePath: "ears/FEAT-013.md" },
            { key: "complete_clarifications", status: "completed", updatedAt: "05-19 09:17" },
            { key: "run_requirement_quality_check", status: "completed", updatedAt: "05-19 09:18" },
            { key: "feature_spec_pool", status: "completed", updatedAt: "05-19 09:19" },
          ],
        },
      ],
      stages: [
        { key: "scan_prd", action: "scan_prd_source", status: "completed", updatedAt: "05-19 09:12", auditEventId: "AUD-PRD-001", evidencePath: "reports/FEAT-013-scan.md" },
        { key: "upload_prd", action: "upload_prd_source", status: "completed", updatedAt: "05-19 09:14", auditEventId: "AUD-PRD-002", evidencePath: "reports/FEAT-013-upload.md" },
        { key: "generate_ears", action: "generate_ears", status: "completed", updatedAt: "05-19 09:16", auditEventId: "AUD-PRD-003", evidencePath: "ears/FEAT-013.md" },
      ],
    },
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
  runner: {
    summary: { onlineRunners: 1, runningTasks: 1, readyTasks: 1, blockedTasks: 2, successRate: 0.957, failureRate: 0.043 },
    schedulerJobs: [
      { id: "JOB-710", bullmqJobId: "BULL-710", queueName: "specdrive:feature-scheduler", jobType: "feature.select", targetType: "project", targetId: "project-1", status: "completed", updatedAt: "2026-04-29T03:41:00.000Z", projectId: "project-1", featureId: "FEAT-204" },
      { id: "JOB-711", bullmqJobId: "BULL-711", queueName: "specdrive:feature-scheduler", jobType: "feature.plan", targetType: "feature", targetId: "FEAT-204", status: "blocked", error: "Project workspace is missing readable AGENTS.md", updatedAt: "2026-04-29T03:41:30.000Z", projectId: "project-1", featureId: "FEAT-204", workspaceRoot: "workspace/acme-returns-portal" },
      { id: "JOB-709", bullmqJobId: "BULL-709", queueName: "specdrive:cli-runner", jobType: "cli.run", targetType: "task", targetId: "T-229", status: "queued", updatedAt: "2026-04-29T03:42:00.000Z", runId: "RUN-709", taskId: "T-229", featureId: "FEAT-204", projectId: "project-1", workspaceRoot: "workspace/acme-returns-portal" },
    ],
    lanes: {
      ready: [
        { id: "T-231", featureId: "FEAT-204", featureTitle: "Mobile Returns Portal", title: "Run mobile browser acceptance", status: "ready", risk: "low", dependencies: [{ id: "T-228", status: "running", satisfied: false }, { id: "T-230", status: "review_needed", satisfied: false }], approvalStatus: "not_required", action: "schedule", blockedReasons: [], recentLog: "npm run console:test -- returns-mobile" },
      ],
      scheduled: [
        { id: "T-229", featureId: "FEAT-204", featureTitle: "Mobile Returns Portal", title: "Connect carrier label quote mock", status: "scheduled", risk: "medium", dependencies: [{ id: "T-228", status: "running", satisfied: false }], approvalStatus: "pending", runnerId: "runner-web-01", runId: "RUN-709", action: "run", blockedReasons: ["Waiting for T-228 upload contract to be finalized."], recentLog: "node --test tests/carrier-labels.test.ts" },
      ],
      running: [
        { id: "T-228", featureId: "FEAT-204", featureTitle: "Mobile Returns Portal", title: "Add photo evidence upload with preview", status: "running", risk: "medium", dependencies: [{ id: "T-227", status: "done", satisfied: true }], approvalStatus: "not_required", runnerId: "runner-web-01", runId: "RUN-708", action: "observe", blockedReasons: [], recentLog: "Mobile upload preview rendered and evidence fixture stored." },
      ],
      blocked: [
        { id: "T-230", featureId: "FEAT-204", featureTitle: "Mobile Returns Portal", title: "Review refund approval copy", status: "review_needed", risk: "medium", dependencies: [{ id: "T-227", status: "done", satisfied: true }], approvalStatus: "pending", action: "review", blockedReasons: ["Product approval is required for customer-facing refund decision copy."], recentLog: "REV-318 waiting on product sign-off." },
        { id: "T-232", featureId: "FEAT-204", featureTitle: "Mobile Returns Portal", title: "Publish governed return demo", status: "blocked", risk: "high", dependencies: [{ id: "T-230", status: "review_needed", satisfied: false }], approvalStatus: "pending", action: "review", blockedReasons: ["High risk release task requires approval before Runner execution."], recentLog: "Release gate held by Review Center." },
      ],
    },
    recentTriggers: [
      { id: "TRG-204-003", action: "manual", target: "feature:FEAT-204", result: "accepted", createdAt: "2026-04-29T03:42:00.000Z" },
      { id: "AUD-204-011", action: "schedule_board_tasks", target: "feature:FEAT-204", result: "blocked", createdAt: "2026-04-29T03:38:00.000Z" },
      { id: "AUD-204-010", action: "run_board_tasks", target: "feature:FEAT-204", result: "accepted", createdAt: "2026-04-29T03:12:00.000Z" },
    ],
    skillInvocations: [
      {
        runId: "RUN-709",
        schedulerJobId: "JOB-709",
        workspaceRoot: "workspace/acme-returns-portal",
        skillSlug: "codex-coding-skill",
        skillPhase: "task_execution",
        status: "queued",
        evidenceSummary: "Codex skill invocation contract queued for workspace execution.",
        updatedAt: "2026-04-29T03:42:00.000Z",
      },
      {
        runId: "RUN-710",
        schedulerJobId: "JOB-710",
        workspaceRoot: "workspace/acme-returns-portal",
        skillSlug: "technical-context-skill",
        skillPhase: "feature_planning",
        blockedReason: "Project workspace is missing readable AGENTS.md",
        status: "blocked",
        updatedAt: "2026-04-29T03:41:00.000Z",
      },
    ],
    factSources: ["task_graph_tasks", "runs", "runner_heartbeats", "runner_policies", "scheduler_job_records", "raw_execution_logs", "review_items", "audit_timeline_events"],
    adapterSummary: {
      id: cliAdapterConfig.id,
      displayName: cliAdapterConfig.displayName,
      status: cliAdapterConfig.status,
      schemaVersion: cliAdapterConfig.schemaVersion,
      executable: cliAdapterConfig.executable,
      lastDryRunStatus: "passed",
      lastDryRunAt: "2026-04-29T03:45:00.000Z",
      lastDryRunErrors: [],
      settingsPath: "/settings/cli",
    },
    runners: [
      { runnerId: "runner-web-01", online: true, codexVersion: "gpt-5.4", sandboxMode: "workspace-write", approvalPolicy: "never", queue: [{ runId: "RUN-708", status: "running" }, { runId: "RUN-709", status: "queued" }, { runId: "RUN-710", status: "queued" }], recentLogs: [{ runId: "RUN-708", stdout: "Mobile upload preview rendered and evidence fixture stored.", stderr: "", createdAt: "2026-04-29T03:40:00.000Z" }], lastHeartbeatAt: "2026-04-29T03:45:00.000Z", heartbeatStale: false },
    ],
  },
  settings,
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
    activeRuns: 2,
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
  overview,
  dashboard: { ...returnsPortalData.dashboard, activeFeatures: [], failedTasks: [], pendingApprovals: 0, activeRuns: 0, risks: [], recentPullRequests: [], boardCounts: {} },
  board: { tasks: [], commands: returnsPortalData.board.commands, factSources: returnsPortalData.board.factSources },
  spec: { features: [], selectedFeature: undefined },
  runner: { summary: { onlineRunners: 0, runningTasks: 0, readyTasks: 0, blockedTasks: 0, successRate: 0, failureRate: 0 }, schedulerJobs: [], lanes: { ready: [], scheduled: [], running: [], blocked: [] }, recentTriggers: [], factSources: [], adapterSummary: returnsPortalData.runner.adapterSummary, runners: [] },
  settings,
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
