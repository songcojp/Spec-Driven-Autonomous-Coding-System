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
  assert.match(extensionSource, /data-command="toggleFeatureSpecView" data-view-mode="dependency"/);
  assert.match(extensionSource, /const mode = target\.dataset\.viewMode === "dependency" \? "dependency" : "list"/);
  assert.match(extensionSource, /target\.dataset\.viewMode = mode === "dependency" \? "list" : "dependency"/);
  assert.match(extensionSource, /target\.textContent = mode === "dependency" \? "Feature List" : "Dependency Graph"/);
  assert.doesNotMatch(extensionSource, /data-command="setFeatureSpecView"/);
  assert.match(extensionSource, /\.hidden\{display:none!important\}/);
  assert.match(extensionSource, /id="workbench-status" class="status-text" role="status" aria-live="polite"/);
  assert.match(extensionSource, /id="workbench-form" class="panel workbench-form" hidden/);
  assert.match(extensionSource, /id="workbench-form-subtitle">Add or change/);
  assert.match(extensionSource, /clarify: \["Clarify Feature", "Clarification", "Enter clarification content\."\]/);
  assert.match(extensionSource, /specChange: \["Spec Change", "Global Spec request", "Enter the Spec change or new requirement\."\]/);
  assert.match(extensionSource, /textarea id="workbench-form-input"/);
  assert.match(extensionSource, /commandButton\("New Feature", "openWorkbenchForm", \{ formMode: "newFeature" \}\)/);
  assert.match(extensionSource, /intent: "requirement_change_or_intake"/);
  assert.match(extensionSource, /intent: "clarification"/);
  assert.match(extensionSource, /command:"newFeature", content/);
  assert.match(extensionSource, /command:"reviewFeature", featureId: form\.dataset\.featureId, comment: content/);
  assert.match(extensionSource, /setWorkbenchStatus\("Refreshing\.\.\."\)/);
  assert.match(extensionSource, /setWorkbenchStatus\("Running command\.\.\."\)/);
  assert.match(extensionSource, /data-view-panel="list"/);
  assert.match(extensionSource, /data-view-panel="dependency"/);
  assert.match(extensionSource, /data-command="toggleDependencyGraphBranches" data-expanded="true"/);
  assert.match(extensionSource, /#dependency-graph-panel \.dependency-branch/);
  assert.match(extensionSource, /target\.textContent = expanded \? "Collapse All" : "Expand All"/);
  assert.match(extensionSource, /class="dependency-branch"\$\{open\}/);
  assert.match(extensionSource, /const open = depth < 2/);
  assert.match(extensionSource, /\.feature-panel summary::before\{content:"\+"/);
  assert.match(extensionSource, /\.feature-panel\[open\] summary::before\{content:"-"\}/);
  assert.match(extensionSource, /\.feature-card\.selected\{border-color:var\(--accent\);background:var\(--vscode-list-activeSelectionBackground\)/);
  assert.match(extensionSource, /aria-current=\\"true\\"/);
  assert.match(extensionSource, /isClarificationNeededFeature\(feature\)/);
  assert.match(extensionSource, /commandButton\("Clarify", "openWorkbenchForm"/);
  assert.match(extensionSource, /title: "Blocked"/);
  assert.match(extensionSource, /title: "In-Process"/);
  assert.match(extensionSource, /title: "Todo"/);
  assert.doesNotMatch(extensionSource, /Block \/ In Process \/ Todo/);
});

test("VSCode Spec Workspace keeps global skill input at top and document actions inside lifecycle", () => {
  assert.match(extensionSource, /renderSpecWorkspaceWebview/);
  assert.match(extensionSource, /commandButton\("Spec Change", "openWorkbenchForm", \{ formMode: "specChange", intent: "requirement_change_or_intake" \}\)/);
  assert.match(extensionSource, /commandButton\("Clarification", "openWorkbenchForm", \{ formMode: "specClarification", intent: "clarification" \}\)/);
  assert.match(extensionSource, /commandButton\("Diagnostics & Blockers", "showDiagnostics", \{\}\)/);
  assert.match(extensionSource, /vscode\.postMessage\(\{command:"specWorkspaceRequest", intent: form\.dataset\.intent, content\}\)/);
  assert.match(extensionSource, /data-command="selectSpecStage" data-stage-id/);
  assert.match(extensionSource, /payload\.command === "showDiagnostics"/);
  assert.match(extensionSource, /entry\.id !== "spec-diagnostics-panel"/);
  assert.match(extensionSource, /class="panel span-12 spec-stage-panel"/);
  assert.match(extensionSource, /\.span-12\{grid-column:span 12\}/);
  assert.match(extensionSource, /\.spec-stage-panel\{width:100%;min-height:320px\}/);
  assert.match(extensionSource, /data-workspace-panel="stage" data-stage-detail/);
  assert.match(extensionSource, /id="spec-diagnostics-panel" data-workspace-panel="diagnostics" hidden/);
  assert.match(extensionSource, /function renderGlobalDiagnosticsPanel/);
  assert.match(extensionSource, /renderSpecLifecycleDetail\(stage, view, projectId, stage\.id !== active\.id\)/);
  assert.match(extensionSource, /<h3>Spec Documents<\/h3>/);
  assert.match(extensionSource, /<h3>Stage Actions<\/h3>/);
  assert.match(extensionSource, /<h3>Diagnostics & Blockers<\/h3>/);
  assert.match(extensionSource, /function filterLifecycleDiagnostics/);
  assert.match(extensionSource, /function renderLifecycleDiagnostic/);
  assert.match(extensionSource, /No active diagnostics or blockers\./);
  assert.match(extensionSource, /label: "Requirement Intake"/);
  assert.match(extensionSource, /label: "Feature Split"/);
  assert.match(extensionSource, /action: "scan_spec_sources"/);
  assert.match(extensionSource, /action: "upload_prd_source"/);
  assert.match(extensionSource, /action: "generate_ears"/);
  assert.match(extensionSource, /action: "split_feature_specs"/);
  assert.doesNotMatch(extensionSource, /<h2>Lifecycle<\/h2>/);
  assert.doesNotMatch(extensionSource, /<h2>Control Guardrails<\/h2>/);
  assert.doesNotMatch(extensionSource, /function guardrailRow/);
  assert.doesNotMatch(extensionSource, /Command Approvals/);
  assert.doesNotMatch(extensionSource, /Safe Actions Only/);
  assert.doesNotMatch(extensionSource, /<h2>Evidence & Traceability<\/h2>/);
  assert.doesNotMatch(extensionSource, /Evidence Required/);
  assert.doesNotMatch(extensionSource, /Traceability Enforced/);
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
