import { expect, test, type Page } from "@playwright/test";
import { demoData, emptyData } from "../lib/demo-data";

test.beforeEach(async ({ page }) => {
  await installConsoleRoutes(page);
});

test("renders the console first screen and navigates across all pages", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("SpecDrive Console")).toBeVisible();
  await expect(page.getByText("AutoBuild Platform")).toBeVisible();
  await expect(page.getByText("Project Health")).toBeVisible();
  await expect(page.getByText("Product Console")).toBeVisible();
  await expect(page.getByText("Board Run Blocked")).toBeVisible();

  for (const label of ["Board", "Spec Workspace", "Skill Center", "Subagents", "Runner", "Reviews", "Dashboard"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const heading = label === "Dashboard" ? "Command Feedback" : label === "Reviews" ? /Reviews \d+/ : label;
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("renders empty and error states", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Data state").selectOption("empty");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByText("No board tasks are available for this project.")).toBeVisible();

  await page.getByLabel("Data state").selectOption("error");
  await expect(page.getByText("Control Plane API returned a simulated failure.")).toBeVisible();
});

test("submits a controlled command and shows blocked feedback", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /^Run$/ }).click();
  await expect(page.getByText("Command blocked")).toBeVisible();
  await expect(page.getByLabel("Notifications (F8)").getByText("Dependencies are not done: T-121.")).toBeVisible();
});

async function installConsoleRoutes(page: Page) {
  await page.route("**/console/dashboard?projectId=project-1", async (route) => route.fulfill({ json: demoData.dashboard }));
  await page.route("**/console/dashboard-board?projectId=project-1", async (route) => route.fulfill({ json: demoData.board }));
  await page.route("**/console/spec-workspace?projectId=project-1&featureId=FEAT-013", async (route) => route.fulfill({ json: demoData.spec }));
  await page.route("**/console/skills?projectId=project-1", async (route) => route.fulfill({ json: demoData.skills }));
  await page.route("**/console/subagents?projectId=project-1", async (route) => route.fulfill({ json: demoData.subagents }));
  await page.route("**/console/runner?projectId=project-1", async (route) => route.fulfill({ json: demoData.runner }));
  await page.route("**/console/reviews?projectId=project-1", async (route) => route.fulfill({ json: demoData.reviews }));
  await page.route("**/console/commands", async (route) => {
    const body = route.request().postDataJSON() as { action: string; entityId: string };
    await route.fulfill({
      json: {
        id: "receipt-1",
        action: body.action,
        status: "blocked",
        entityType: "feature",
        entityId: body.entityId,
        auditEventId: "audit-1",
        acceptedAt: "2026-04-29T03:40:00.000Z",
        blockedReasons: ["Dependencies are not done: T-121."],
      },
    });
  });
  await page.route("**/console/dashboard-board?projectId=empty", async (route) => route.fulfill({ json: emptyData.board }));
}
