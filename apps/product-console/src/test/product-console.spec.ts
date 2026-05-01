import { expect, test, type Page } from "@playwright/test";
import { demoData } from "../lib/demo-data";

test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript((storageKey) => {
    if (!window.sessionStorage.getItem(storageKey)) {
      window.localStorage.clear();
      window.sessionStorage.setItem(storageKey, "1");
    }
  }, `specdrive-test-storage-cleared-${testInfo.testId}`);
  await installConsoleRoutes(page);
});

test("renders the console first screen and navigates across all pages", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("SpecDrive Console")).toBeVisible();
  await expect(page.getByLabel("项目列表")).toHaveValue("project-1");
  await expect(page.getByRole("heading", { name: "全局概况" })).toBeVisible();
  await expect(page.getByText("项目总数")).toBeVisible();
  await expect(page.getByText("Mobile Returns Portal")).toBeVisible();
  await expect(page.getByRole("row", { name: /Northwind Supply Planner/ })).toBeVisible();

  for (const label of ["项目主页", "Spec 工作台", "任务调度", "审计中心", "全局概况"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const heading = label === "审计中心" ? "审计中心" : label === "Spec 工作台" ? "Feature Spec" : label;
    await expect(page.getByRole("heading", { name: heading, exact: typeof heading === "string" })).toBeVisible();
    if (label === "任务调度") {
      await expect(page.getByText("任务调度中心")).toBeVisible();
      await expect(page.getByRole("heading", { name: "调度流水线" })).toBeVisible();
      await expect(page.getByText("feature.select").first()).toBeVisible();
      await expect(page.getByText("feature.plan").first()).toBeVisible();
      await expect(page.getByText("cli.run").first()).toBeVisible();
      await expect(page.getByText("specdrive:feature-scheduler").first()).toBeVisible();
      await expect(page.getByText("specdrive:cli-runner").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "任务队列" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Job 详情" })).toBeVisible();
      await expect(page.getByText("JOB-709").first()).toBeVisible();
      await expect(page.getByText("BULL-709")).toBeVisible();
      await expect(page.getByText("Ready 1")).toBeVisible();
      await expect(page.getByText("Scheduled 1")).toBeVisible();
      await expect(page.getByRole("button", { name: "运行 T-229" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "暂停 Runner" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "资源池" })).toBeVisible();
      await expect(page.getByText("schedule_board_tasks")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Skill 调用" })).toBeVisible();
      await expect(page.getByText("codex-coding-skill")).toBeVisible();
      await expect(page.getByText("workspace/acme-returns-portal").first()).toBeVisible();
      await expect(page.getByText("Project workspace is missing readable AGENTS.md")).toBeVisible();
      await page.getByRole("button", { name: "运行 T-229" }).first().click();
      await expect(page.getByLabel("Notifications (F8)").getByText("Product approval is required for customer-facing refund decision copy.")).toBeVisible();
    }
    if (label === "审计中心") {
      await expect(page.getByText("Audit Timeline")).toBeVisible();
      await expect(page.getByText("命令回执")).toBeVisible();
      await expect(page.getByText("阻塞命令")).toBeVisible();
      await expect(page.getByText("console_command_run_board_tasks").first()).toBeVisible();
      await expect(page.getByText("RUN-709").first()).toBeVisible();
      await expect(page.getByText("JOB-709").first()).toBeVisible();
      await expect(page.getByText("依赖服务不可用: board-service timeout").first()).toBeVisible();
      await expect(page.getByText("关联 Evidence")).toBeVisible();
      await expect(page.getByText("Approval 记录")).toBeVisible();
    }
  }
});

test("supports collapsible navigation and keeps the content header fixed", async ({ page }) => {
  await page.goto("/");

  const shellHeader = page.locator("main > header");
  const shellFooter = page.locator("main > footer");
  const contentScroll = page.getByTestId("console-content-scroll");
  await expect(page.getByLabel("收起导航")).toBeVisible();
  await expect(shellHeader).toHaveCSS("position", "sticky");

  const expandedWidth = await page.locator(".console-sidebar").boundingBox();
  await page.getByLabel("收起导航").click();
  await expect(page.getByLabel("展开导航")).toBeVisible();
  const collapsedWidth = await page.locator(".console-sidebar").boundingBox();
  if (page.viewportSize()!.width > 900) {
    expect(collapsedWidth!.width).toBeLessThan(expandedWidth!.width);
    await expect(shellFooter).toBeVisible();
    await expect(contentScroll).toHaveCSS("overflow-y", "auto");

    const viewport = page.viewportSize()!;
    const mainBox = await page.locator("main").boundingBox();
    const footerBox = await shellFooter.boundingBox();
    expect(Math.round(mainBox!.height)).toBe(viewport.height);
    expect(Math.round(footerBox!.y + footerBox!.height)).toBe(viewport.height);
  }

  await page.getByRole("button", { name: "Spec 工作台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Feature Spec", exact: true })).toBeVisible();
});

test("omits the project metric summary strip from workbench pages", async ({ page }) => {
  await page.goto("/");

  for (const label of ["Spec 工作台", "任务调度", "审计中心"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByText("项目健康")).toHaveCount(0);
    await expect(page.getByText("本月成本")).toHaveCount(0);
  }
});

test("defaults to Chinese and persists language switching", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("语言")).toHaveValue("zh-CN");
  await expect(page.getByRole("button", { name: "全局概况", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "项目主页", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "任务调度", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "审计中心", exact: true })).toBeVisible();
  await expect(page.getByText("项目总数")).toBeVisible();
  await expect(page.getByText("Mobile Returns Portal")).toBeVisible();

  await page.getByLabel("语言").selectOption("en");
  await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Project Home", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Task Scheduler", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Audit Center", exact: true })).toBeVisible();
  await expect(page.getByText("Total Projects")).toBeVisible();
  await expect(page.getByText("Mobile Returns Portal")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Language")).toHaveValue("en");
  await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
});

test("global overview switches projects and opens the selected board", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "全局概况" })).toBeVisible();
  await page.getByRole("row", { name: /Northwind Supply Planner/ }).click();
  await expect(page.getByLabel("项目列表")).toHaveValue("project-2");

  await page.getByRole("row", { name: /Northwind Supply Planner/ }).getByRole("button", { name: "查看项目主页" }).click();
  await expect(page.getByRole("heading", { name: "项目主页" })).toBeVisible();
  await expect(page.getByText("T-401 Model forecast confidence bands")).toBeVisible();
});

test("renders the Spec workspace workbench and submits controlled spec commands", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Spec 工作台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Feature Spec", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spec 操作流程" })).toBeVisible();
  await expect(page.getByRole("button", { name: /阶段 1 项目初始化/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /阶段 2 需求录入/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /阶段 3 设计规划阶段/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /阶段 4 UI Spec/ })).toHaveCount(0);
  await page.getByRole("button", { name: /阶段 1 项目初始化/ }).click();
  await expect(page.getByRole("button", { name: /阶段 1 项目初始化/ })).toHaveAttribute("aria-expanded", "true");
  // TASK-026: Stage 1 shows auto-init status items without manual action buttons
  await expect(page.getByText("创建/导入项目")).toBeVisible();
  await page.getByRole("button", { name: /阶段 2 需求录入/ }).click();
  await expect(page.getByRole("button", { name: /阶段 1 项目初始化/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: /阶段 2 需求录入/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: /阶段 3 设计规划阶段/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("创建/导入项目")).toHaveCount(0);
  await expect(page.getByText("推入 Feature Spec Pool")).toHaveCount(0);
  await expect(page.getByText("Spec 扫描与上传")).toBeVisible();
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成 EARS" })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成 HLD" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "拆分 Feature Spec" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "进入规划流水线" })).toHaveCount(0);
  // TASK-027: Stage 2 shows Spec Sources Discovery table
  await expect(page.getByText("Spec 来源盘点")).toBeVisible();
  await expect(page.getByText("PRD").first()).toBeVisible();
  await expect(page.getByText("EARS").first()).toBeVisible();
  await expect(page.getByText("HLD").first()).toBeVisible();
  await expect(page.getByText("workspace/acme-returns-portal/docs/zh-CN/PRD.md").first()).toBeVisible();
  await page.getByRole("button", { name: /阶段 3 设计规划阶段/ }).click();
  await expect(page.getByRole("button", { name: /阶段 2 需求录入/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("生成 HLD").first()).toBeVisible();
  await expect(page.getByText("生成 UI Spec").first()).toBeVisible();
  await expect(page.getByText("拆分 Feature Spec").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "推入 Feature Spec Pool" })).toBeVisible();
  await expect(page.getByText("调度运行").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "生成 HLD" })).toBeVisible();
  await page.getByRole("button", { name: "生成 HLD" }).click();
  await expect(page.getByLabel("Notifications (F8)").getByText("generate_hld recorded")).toBeVisible();
  // UI Spec is part of Stage 3 after HLD.
  await expect(page.getByText("UI Spec 概念图")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成 UI Spec" })).toBeVisible();
  await page.getByRole("button", { name: "生成 UI Spec" }).click();
  await expect(page.getByLabel("Notifications (F8)").getByText("generate_ui_spec recorded")).toBeVisible();
  await expect(page.getByAltText(/Spec 工作台 UI 概念图/)).toBeVisible();
  await expect(page.getByText("Feature Spec", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Feature Spec List" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Feature Spec List" }).getByText("共 3 项")).toBeVisible();
  await expect(page.getByText("FEAT-204 Mobile Returns Portal")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Feature Spec List" }).getByText("FEAT-202")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Feature Spec List" }).getByText("Customer Notification Timeline")).toBeVisible();
  await expect(page.getByText("需求列表")).toBeVisible();
  await expect(page.getByRole("cell", { name: "REQ-204-001" }).first()).toBeVisible();
  await expect(page.getByText("需求 - 任务可追溯性")).toBeVisible();
  await expect(page.getByText("受控操作")).toBeVisible();
  await expect(page.getByText("需要产品审批")).toBeVisible();
  await expect(page.getByRole("link", { name: /EV-318/ })).toBeVisible();

  await page.getByRole("button", { name: "质量检查清单" }).click();
  await expect(page.getByText("Copy Review Pending").first()).toBeVisible();

  await page.getByRole("button", { name: "契约" }).click();
  await expect(page.getByText("/returns/orders/lookup")).toBeVisible();

  await page.getByRole("button", { name: /FEAT-203/ }).click();
  await expect(page.getByText("FEAT-203 Refund Rules Engine")).toBeVisible();
  await expect(page.getByText("当前分区暂无可用 Spec 数据。").first()).toBeVisible();

  await page.getByText("受控操作").click();
  await page.getByRole("button", { name: /阶段 3 设计规划阶段/ }).click();
  await page.locator("aside").filter({ hasText: "受控操作" }).getByRole("button", { name: "调度运行", exact: true }).click();
  await expect(page.getByText("命令被阻塞", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Notifications (F8)").getByText("Product approval is required for customer-facing refund decision copy.")).toBeVisible();

  await page.getByRole("button", { name: /阶段 2 需求录入/ }).click();
  await page.getByRole("button", { name: "扫描", exact: true }).click();
  await expect(page.getByLabel("Notifications (F8)").getByText("scan_prd_source recorded")).toBeVisible();
  await page.getByLabel("上传 Spec 文件").setInputFiles({
    name: "uploaded-prd.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Uploaded PRD\n\nWHEN a user scans a PRD\nTHE SYSTEM SHALL create governed workflow input."),
  });
  await expect(page.getByText("uploaded-prd.md")).toBeVisible();
  await expect(page.getByLabel("Notifications (F8)").getByText("upload_prd_source recorded")).toBeVisible();
  await page.getByRole("button", { name: "生成 EARS" }).click();
  await expect(page.getByLabel("Notifications (F8)").getByText("generate_ears recorded")).toBeVisible();
});

test("creates projects and switches project-scoped console data", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("项目列表")).toHaveValue("project-1");
  await expect(page.getByText("Mobile Returns Portal")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Acme Returns Portal");
    await dialog.accept();
  });
  await page.getByLabel("删除项目").click();
  await expect(page.getByLabel("项目列表")).not.toHaveValue("project-1");
  await expect(page.getByLabel("Notifications (F8)").getByText("项目已删除: Acme Returns Portal")).toBeVisible();

  await page.getByLabel("项目列表").selectOption("project-2");
  await expect(page.getByText("Demand Forecast Review")).toBeVisible();
  await page.getByRole("button", { name: "项目主页", exact: true }).click();
  await expect(page.getByText("T-401 Model forecast confidence bands")).toBeVisible();

  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByLabel("现有项目目录")).toBeVisible();
  await expect(page.getByLabel("项目目标")).toHaveCount(0);
  await expect(page.getByLabel("项目名称")).toHaveCount(0);
  await page.getByLabel("现有项目目录").fill("/home/john/Projects/imported-console");
  await expect(page.getByText("imported-console", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("识别项目")).toBeVisible();
  await expect(page.getByText("识别分支")).toBeVisible();
  await expect(page.getByText("main", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "创建新项目" }).click();
  await expect(page.getByLabel("项目目标")).toBeVisible();
  await expect(page.getByLabel("Workspace 目录名")).toBeVisible();
  await expect(page.getByLabel("现有项目目录")).toHaveCount(0);
  await page.getByLabel("项目名称").fill("New Client App");
  await page.getByLabel("项目目标").fill("Build a new client workspace");
  await page.getByLabel("Workspace 目录名").fill("new-client-app");
  await page.getByRole("button", { name: "提交命令" }).click();

  await expect(page.getByLabel("项目列表")).toContainText("New Client App");
  await expect(page.getByLabel("项目列表")).not.toHaveValue("project-1");
  await expect(page.getByText("项目目录: workspace/new-client-app")).toBeVisible();
  await page.getByRole("button", { name: "项目主页", exact: true }).click();
  await expect(page.getByText("当前项目没有可用的看板任务。").first()).toBeVisible();
});

test("uses a complete mock project instead of UI demo data modes", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("数据状态")).toHaveCount(0);
  await expect(page.getByLabel("项目列表")).toContainText("Acme Returns Portal");
  await expect(page.getByText("Mobile Returns Portal")).toBeVisible();
  await page.getByRole("button", { name: "项目主页", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目主页" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "任务看板" })).toBeVisible();
  await expect(page.getByText("T-230 Review refund approval copy")).toBeVisible();
  await expect(page.getByText("T-231 Run mobile browser acceptance")).toBeVisible();
});

test("submits a controlled command and shows blocked feedback", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "项目主页", exact: true }).click();
  await page.getByRole("button", { name: "运行", exact: true }).click();
  await expect(page.getByText("命令被阻塞", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Notifications (F8)").getByText("Product approval is required for customer-facing refund decision copy.")).toBeVisible();
});

async function installConsoleRoutes(page: Page) {
  const projectTwoData = {
    ...demoData,
    dashboard: {
      ...demoData.dashboard,
      activeFeatures: [{ id: "FEAT-007", title: "Workspace Isolation", status: "in-progress", priority: 7 }],
      failedTasks: [],
      pendingApprovals: 1,
    },
    board: {
      ...demoData.board,
      tasks: [
        {
          ...demoData.board.tasks[0],
          id: "T-222",
          featureId: "FEAT-007",
          title: "Verify project-scoped worktree isolation",
        },
      ],
    },
    spec: {
      ...demoData.spec,
      features: [
        { id: "FEAT-007", title: "Workspace Isolation", folder: "feat-007-workspace-isolation", status: "done", primaryRequirements: ["REQ-017", "REQ-035"] },
        { id: "FEAT-006", title: "Project Memory Projection", folder: "feat-006-project-memory-projection", status: "ready", primaryRequirements: ["REQ-016", "REQ-034"] },
        { id: "FEAT-005", title: "Subagent Runtime Context", folder: "feat-005-subagent-runtime-context", status: "done", primaryRequirements: ["REQ-015"] },
      ],
      selectedFeature: {
        ...demoData.spec.selectedFeature!,
        id: "FEAT-007",
        title: "Workspace Isolation",
      },
    },
  };
  await page.route("**/console/dashboard?projectId=project-1", async (route) => route.fulfill({ json: demoData.dashboard }));
  await page.route("**/console/project-overview", async (route) => route.fulfill({ json: demoData.overview }));
  await page.route("**/console/dashboard-board?projectId=project-1", async (route) => route.fulfill({ json: demoData.board }));
  await page.route("**/console/spec-workspace?projectId=project-1", async (route) => route.fulfill({ json: demoData.spec }));
  await page.route("**/console/runner?projectId=project-1", async (route) => route.fulfill({ json: demoData.runner }));
  await page.route("**/console/reviews?projectId=project-1", async (route) => route.fulfill({ json: demoData.reviews }));
  await page.route("**/console/audit?projectId=project-1", async (route) => route.fulfill({ json: demoData.audit }));
  await page.route("**/console/dashboard?projectId=project-2", async (route) => route.fulfill({ json: projectTwoData.dashboard }));
  await page.route("**/console/dashboard-board?projectId=project-2", async (route) => route.fulfill({ json: projectTwoData.board }));
  await page.route("**/console/spec-workspace?projectId=project-2", async (route) => route.fulfill({ json: projectTwoData.spec }));
  await page.route("**/console/runner?projectId=project-2", async (route) => route.fulfill({ json: demoData.runner }));
  await page.route("**/console/reviews?projectId=project-2", async (route) => route.fulfill({ json: demoData.reviews }));
  await page.route("**/console/audit?projectId=project-2", async (route) => route.fulfill({ json: demoData.audit }));
  await page.route("**/projects/scan", async (route) => {
    const body = route.request().postDataJSON() as { targetRepoPath?: string };
    await route.fulfill({
      json: {
        targetRepoPath: body.targetRepoPath,
        name: "imported-console",
        repository: "git@github.com:example/imported-console.git",
        defaultBranch: "main",
        projectType: "specdrive-project",
        techPreferences: ["npm", "specdrive"],
        isGitRepository: true,
        packageManager: "npm",
        hasSpecProtocolDirectory: true,
        errors: [],
      },
    });
  });
  await page.route("**/projects", async (route) => {
    const body = route.request().postDataJSON() as { name?: string; targetRepoPath?: string };
    await route.fulfill({
      status: 201,
      json: {
        id: "project-created",
        name: body.name ?? "New Client App",
        targetRepoPath: body.targetRepoPath ?? "workspace/new-client-app",
        defaultBranch: "main",
        status: "created",
      },
    });
  });
  await page.route("**/projects/project-1", async (route) => {
    await route.fulfill({
      status: 404,
      json: { error: "not_found" },
    });
  });
  await page.route("**/console/commands", async (route) => {
    const body = route.request().postDataJSON() as { action: string; entityId: string; projectId?: string };
    const workflowActions = new Set([
      "connect_git_repository",
      "initialize_spec_protocol",
      "import_or_create_constitution",
      "initialize_project_memory",
      "scan_prd_source",
      "upload_prd_source",
      "generate_ears",
      "generate_hld",
      "generate_ui_spec",
      "split_feature_specs",
      "push_feature_spec_pool",
    ]);
    const accepted = body.action === "create_project" || workflowActions.has(body.action);
    await route.fulfill({
      json: {
        id: "receipt-1",
        action: body.action,
        status: accepted ? "accepted" : "blocked",
        entityType: "feature",
        entityId: body.entityId,
        projectId: body.projectId,
        auditEventId: "audit-1",
        acceptedAt: "2026-04-29T03:40:00.000Z",
        schedulerJobId: body.action === "run_board_tasks" || body.action === "schedule_board_tasks" ? "JOB-709" : undefined,
        runId: body.action === "run_board_tasks" ? "RUN-709" : undefined,
        blockedReasons: accepted ? [] : ["Product approval is required for customer-facing refund decision copy."],
      },
    });
  });
}
