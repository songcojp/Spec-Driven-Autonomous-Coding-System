import { expect, test, type Page } from "@playwright/test";
import { demoData, emptyData } from "../lib/demo-data";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("specdrive-test-storage-cleared")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("specdrive-test-storage-cleared", "1");
    }
  });
  await installConsoleRoutes(page);
});

test("renders the console first screen and navigates across all pages", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("SpecDrive Console")).toBeVisible();
  await expect(page.getByLabel("项目列表")).toHaveValue("project-1");
  await expect(page.getByText("项目健康")).toBeVisible();
  await expect(page.getByText("Product Console")).toBeVisible();
  await expect(page.getByText("看板运行被阻塞")).toBeVisible();

  for (const label of ["看板", "Spec 工作台", "Skill 中心", "Subagent", "Runner", "审查", "仪表盘"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const heading = label === "仪表盘" ? "命令反馈" : label === "审查" ? /审查 \d+/ : label;
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("defaults to Chinese and persists language switching", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("语言")).toHaveValue("zh-CN");
  await expect(page.getByRole("button", { name: "仪表盘", exact: true })).toBeVisible();
  await expect(page.getByText("项目健康")).toBeVisible();
  await expect(page.getByText("Product Console")).toBeVisible();

  await page.getByLabel("语言").selectOption("en");
  await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("Project Health")).toBeVisible();
  await expect(page.getByText("Product Console")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Language")).toHaveValue("en");
  await expect(page.getByRole("button", { name: "Dashboard", exact: true })).toBeVisible();
});

test("creates projects and switches project-scoped console data", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("项目列表")).toHaveValue("project-1");
  await expect(page.getByText("Product Console")).toBeVisible();

  await page.getByLabel("项目列表").selectOption("project-2");
  await expect(page.getByText("Workspace Isolation")).toBeVisible();
  await expect(page.getByText("T-222 Verify project-scoped")).toBeVisible();

  await page.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByLabel("现有项目目录")).toBeVisible();
  await expect(page.getByLabel("项目目标")).toHaveCount(0);
  await expect(page.getByLabel("项目名称")).toHaveCount(0);
  await page.getByLabel("现有项目目录").fill("/home/john/Projects/imported-console");
  await expect(page.getByText("识别项目")).toBeVisible();
  await expect(page.getByText("imported-console", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await expect(page.getByText("当前项目没有可用的看板任务。")).toBeVisible();
});

test("renders empty and error states", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("数据状态").selectOption("empty");
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await expect(page.getByText("当前项目没有可用的看板任务。")).toBeVisible();

  await page.getByLabel("数据状态").selectOption("error");
  await expect(page.getByText("Control Plane API returned a simulated failure.")).toBeVisible();
});

test("submits a controlled command and shows blocked feedback", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "运行", exact: true }).click();
  await expect(page.getByText("命令被阻塞", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Notifications (F8)").getByText("Dependencies are not done: T-121.")).toBeVisible();
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
      features: [{ id: "FEAT-007", title: "Workspace Isolation", folder: "feat-007-workspace-isolation", status: "done", primaryRequirements: ["REQ-017", "REQ-035"] }],
      selectedFeature: {
        ...demoData.spec.selectedFeature!,
        id: "FEAT-007",
        title: "Workspace Isolation",
      },
    },
  };
  await page.route("**/console/dashboard?projectId=project-1", async (route) => route.fulfill({ json: demoData.dashboard }));
  await page.route("**/console/dashboard-board?projectId=project-1", async (route) => route.fulfill({ json: demoData.board }));
  await page.route("**/console/spec-workspace?projectId=project-1&featureId=FEAT-013", async (route) => route.fulfill({ json: demoData.spec }));
  await page.route("**/console/skills?projectId=project-1", async (route) => route.fulfill({ json: demoData.skills }));
  await page.route("**/console/subagents?projectId=project-1", async (route) => route.fulfill({ json: demoData.subagents }));
  await page.route("**/console/runner?projectId=project-1", async (route) => route.fulfill({ json: demoData.runner }));
  await page.route("**/console/reviews?projectId=project-1", async (route) => route.fulfill({ json: demoData.reviews }));
  await page.route("**/console/dashboard?projectId=project-2", async (route) => route.fulfill({ json: projectTwoData.dashboard }));
  await page.route("**/console/dashboard-board?projectId=project-2", async (route) => route.fulfill({ json: projectTwoData.board }));
  await page.route("**/console/spec-workspace?projectId=project-2&featureId=FEAT-013", async (route) => route.fulfill({ json: projectTwoData.spec }));
  await page.route("**/console/skills?projectId=project-2", async (route) => route.fulfill({ json: demoData.skills }));
  await page.route("**/console/subagents?projectId=project-2", async (route) => route.fulfill({ json: demoData.subagents }));
  await page.route("**/console/runner?projectId=project-2", async (route) => route.fulfill({ json: demoData.runner }));
  await page.route("**/console/reviews?projectId=project-2", async (route) => route.fulfill({ json: demoData.reviews }));
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
  await page.route("**/console/commands", async (route) => {
    const body = route.request().postDataJSON() as { action: string; entityId: string; projectId?: string };
    await route.fulfill({
      json: {
        id: "receipt-1",
        action: body.action,
        status: body.action === "create_project" ? "accepted" : "blocked",
        entityType: "feature",
        entityId: body.entityId,
        projectId: body.projectId,
        auditEventId: "audit-1",
        acceptedAt: "2026-04-29T03:40:00.000Z",
        blockedReasons: body.action === "create_project" ? [] : ["Dependencies are not done: T-121."],
      },
    });
  });
  await page.route("**/console/dashboard-board?projectId=empty", async (route) => route.fulfill({ json: emptyData.board }));
}
