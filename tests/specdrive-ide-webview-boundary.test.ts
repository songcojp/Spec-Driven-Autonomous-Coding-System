import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const extensionSource = readFileSync("apps/vscode-extension/src/extension.ts", "utf8");
const extensionPackage = JSON.parse(readFileSync("apps/vscode-extension/package.json", "utf8")) as {
  activationEvents?: string[];
  contributes?: {
    commands?: Array<{ command: string; title: string }>;
  };
};

test("VSCode IDE Webviews expose three independent workbench commands", () => {
  const activationEvents = new Set(extensionPackage.activationEvents ?? []);
  const commands = new Set((extensionPackage.contributes?.commands ?? []).map((command) => command.command));

  for (const command of [
    "specdrive.openExecutionWorkbench",
    "specdrive.openSpecWorkspace",
    "specdrive.openFeatureSpec",
  ]) {
    assert.equal(activationEvents.has(`onCommand:${command}`), true);
    assert.equal(commands.has(command), true);
  }

  assert.match(extensionSource, /renderExecutionWorkbenchWebview/);
  assert.match(extensionSource, /renderSpecWorkspaceWebview/);
  assert.match(extensionSource, /renderFeatureSpecWebview/);
  assert.match(extensionSource, /onDidReceiveMessage/);
  assert.match(extensionSource, /Content-Security-Policy/);
});

test("VSCode Feature Spec Webview switches between list and dependency graph views", () => {
  assert.match(extensionSource, /data-command="toggleFeatureSpecView" data-view-mode="list"/);
  assert.match(extensionSource, /target\.textContent = mode === "dependency" \? "Feature List" : "Dependency Graph"/);
  assert.doesNotMatch(extensionSource, /data-command="setFeatureSpecView"/);
  assert.match(extensionSource, /data-view-panel="list"/);
  assert.match(extensionSource, /data-view-panel="dependency"/);
  assert.match(extensionSource, /class="dependency-branch"\$\{open\}/);
  assert.match(extensionSource, /const open = depth < 2/);
  assert.match(extensionSource, /\.feature-panel summary::before\{content:"\+"/);
  assert.match(extensionSource, /\.feature-panel\[open\] summary::before\{content:"-"\}/);
  assert.match(extensionSource, /title: "Blocked"/);
  assert.match(extensionSource, /title: "In-Process"/);
  assert.match(extensionSource, /title: "Todo"/);
  assert.doesNotMatch(extensionSource, /Block \/ In Process \/ Todo/);
});

test("VSCode IDE Webviews do not import Product Console UI surfaces", () => {
  const forbiddenPatterns = [
    /from\s+["'][^"']*apps\/product-console/i,
    /import\([^)]*apps\/product-console/i,
    /from\s+["'][^"']*product-console\/src/i,
    /import\([^)]*product-console\/src/i,
    /RunnerPage\.tsx/,
    /SpecPage\.tsx/,
    /AppShell/,
    /react-router/,
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(extensionSource), false, `Forbidden Product Console UI dependency matched ${pattern}`);
  }
});
