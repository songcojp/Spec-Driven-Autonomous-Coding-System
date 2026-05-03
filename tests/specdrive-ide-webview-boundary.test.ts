import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function readSourceTree(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) return readSourceTree(entryPath);
      if (!entry.name.endsWith(".ts")) return "";
      return readFileSync(entryPath, "utf8");
    })
    .filter(Boolean)
    .join("\n");
}

const extensionSource = readSourceTree("apps/vscode-extension/src");
const extensionPackage = JSON.parse(readFileSync("apps/vscode-extension/package.json", "utf8")) as {
  activationEvents?: string[];
  contributes?: {
    commands?: Array<{ command: string; title: string }>;
    menus?: {
      "view/title"?: Array<{ command: string; group?: string }>;
    };
  };
};

test("VSCode IDE Webviews expose independent workbench commands", () => {
  const activationEvents = new Set(extensionPackage.activationEvents ?? []);
  const commands = new Set((extensionPackage.contributes?.commands ?? []).map((command) => command.command));

  for (const command of [
    "specdrive.openExecutionWorkbench",
    "specdrive.openSpecWorkspace",
    "specdrive.openFeatureSpec",
    "specdrive.openSystemSettings",
  ]) {
    assert.equal(activationEvents.has(`onCommand:${command}`), true);
    assert.equal(commands.has(command), true);
  }

  assert.match(extensionSource, /renderExecutionWorkbenchWebview/);
  assert.match(extensionSource, /renderSpecWorkspaceWebview/);
  assert.match(extensionSource, /renderFeatureSpecWebview/);
  assert.match(extensionSource, /renderSystemSettingsWebview/);
  assert.match(extensionSource, /onDidReceiveMessage/);
  assert.match(extensionSource, /Content-Security-Policy/);
});

test("VSCode Spec Explorer title actions are ordered by workflow", () => {
  const titleActions = extensionPackage.contributes?.menus?.["view/title"] ?? [];
  assert.deepEqual(titleActions.map((action) => action.command), [
    "specdrive.openSpecWorkspace",
    "specdrive.openFeatureSpec",
    "specdrive.openExecutionWorkbench",
    "specdrive.openSystemSettings",
    "specdrive.refresh",
  ]);
  assert.deepEqual(titleActions.map((action) => action.group), [
    "navigation@1",
    "navigation@2",
    "navigation@3",
    "navigation@4",
    "navigation@5",
  ]);
});

test("VSCode System Settings Webview manages adapter configs through controlled commands", () => {
  assert.match(extensionSource, /renderSystemSettingsWebview/);
  assert.match(extensionSource, new RegExp('new URL\\("/ide/system-settings", controlPlaneUrl\\)'));
  assert.match(extensionSource, new RegExp('new URL\\("/console/system-settings", controlPlaneUrl\\)'));
  assert.match(extensionSource, /normalizeSystemSettingsViewModel\(await response\.json\(\)\)/);
  assert.match(extensionSource, /function normalizeAdapterSettingsSection/);
  assert.match(extensionSource, /message\.command === "settingsCommand"/);
  assert.match(extensionSource, /JSON\.parse\(message\.configText\)/);
  assert.match(extensionSource, /entityType: message\.entityType/);
  assert.match(extensionSource, /payload: \{ config \}/);
  assert.match(extensionSource, /"validate_cli_adapter_config"/);
  assert.match(extensionSource, /"activate_rpc_adapter_config"/);
  assert.match(extensionSource, /settingsCommandButton\("Validate"/);
  assert.match(extensionSource, /class="settings-editor"/);
  assert.match(extensionSource, /"loadSettingsPreset"/);
  assert.match(extensionSource, /class="grid settings-grid"/);
  assert.match(extensionSource, /\.settings-grid\{grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,360px\),1fr\)\)\}/);
  assert.match(extensionSource, /\.settings-grid \.span-6\{grid-column:auto\}/);
  assert.match(extensionSource, /\.row\{grid-template-columns:minmax\(0,1fr\) minmax\(0,max-content\)\}/);
  assert.match(extensionSource, /\.row code\{white-space:pre-wrap;overflow-wrap:anywhere\}/);
});

test("VSCode System Settings Webview tolerates partial settings responses", () => {
  assert.match(extensionSource, /cliAdapter\?: AdapterSettingsSection/);
  assert.match(extensionSource, /rpcAdapter\?: AdapterSettingsSection/);
  assert.match(extensionSource, /renderAdapterSection\(title: string, kind: AdapterKind, section: AdapterSettingsSection \| undefined\)/);
  assert.match(extensionSource, /settings are unavailable from the current Control Plane response/);
  assert.match(extensionSource, /const source = section\.draft \?\? section\.active \?\? \{\}/);
  assert.match(extensionSource, /const validation = section\.validation \?\? \{ valid: false/);
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
  assert.doesNotMatch(extensionSource, /commandButton\("Diagnostics & Blockers", "showDiagnostics", \{\}\)/);
  assert.match(extensionSource, /vscode\.postMessage\(\{command:"specWorkspaceRequest", intent: form\.dataset\.intent, content\}\)/);
  assert.match(extensionSource, /data-command="selectSpecStage" data-stage-id/);
  assert.match(extensionSource, /<span>4 · \$\{view\?\.diagnostics\.length \?\? 0\} active<\/span>Diagnostics & Blockers/);
  assert.match(extensionSource, /payload\.command === "showDiagnostics"/);
  assert.match(extensionSource, /entry\.id !== "spec-diagnostics-panel"/);
  assert.match(extensionSource, /class="panel span-12 spec-stage-panel"/);
  assert.match(extensionSource, /\.span-12\{grid-column:span 12\}/);
  assert.match(extensionSource, /\.spec-stage-panel\{width:100%;min-height:320px\}/);
  assert.match(extensionSource, /data-workspace-panel="stage" data-stage-detail/);
  assert.match(extensionSource, /id="spec-diagnostics-panel" data-workspace-panel="diagnostics" hidden/);
  assert.match(extensionSource, /function renderGlobalDiagnosticsPanel/);
  assert.match(extensionSource, /renderSpecLifecycleDetail\(stage, view, projectId, uiConceptImages, stage\.id !== active\.id\)/);
  assert.match(extensionSource, /<h3>Spec Documents<\/h3>/);
  assert.match(extensionSource, /<h3>Stage Actions<\/h3>/);
  assert.doesNotMatch(extensionSource, /<h3>Diagnostics & Blockers<\/h3>/);
  assert.doesNotMatch(extensionSource, /function filterLifecycleDiagnostics/);
  assert.match(extensionSource, /function renderLifecycleDiagnostic/);
  assert.match(extensionSource, /No active diagnostics or blockers\./);
  assert.match(extensionSource, /label: "Project Initialization"/);
  assert.match(extensionSource, /label: "Project created or imported"/);
  assert.match(extensionSource, /label: "Workspace root resolved"/);
  assert.match(extensionSource, /label: "Git repository connected"/);
  assert.match(extensionSource, /label: "\.autobuild \/ Spec Protocol"/);
  assert.match(extensionSource, /label: "Project constitution"/);
  assert.match(extensionSource, /label: "Project Memory"/);
  assert.match(extensionSource, /label: "Workspace health check"/);
  assert.match(extensionSource, /label: "Current project context"/);
  assert.match(extensionSource, /action: "connect_git_repository"/);
  assert.match(extensionSource, /action: "initialize_spec_protocol"/);
  assert.match(extensionSource, /action: "import_or_create_constitution"/);
  assert.match(extensionSource, /action: "initialize_project_memory"/);
  assert.match(extensionSource, /action: "check_project_health"/);
  assert.match(extensionSource, /label: "Requirement Intake"/);
  assert.match(extensionSource, /label: "Feature Split"/);
  assert.match(extensionSource, /action: "scan_spec_sources"/);
  assert.match(extensionSource, /action: "upload_prd_source"/);
  assert.match(extensionSource, /action: "generate_ears"/);
  assert.match(extensionSource, /label: "HLD \/ design"/);
  assert.match(extensionSource, /reason: "Generate HLD from Requirement Intake lifecycle\."/);
  assert.match(extensionSource, /reason: "Generate UI Spec from Requirement Intake lifecycle\."/);
  assert.doesNotMatch(extensionSource, /reason: "Generate HLD from Feature Split lifecycle\."/);
  assert.doesNotMatch(extensionSource, /reason: "Generate UI Spec from Feature Split lifecycle\."/);
  assert.match(extensionSource, /action: "split_feature_specs"/);
  assert.match(extensionSource, /<h3>UI Spec Concept Images<\/h3>/);
  assert.match(extensionSource, /class="concept-card" data-command="openConceptImage"/);
  assert.match(extensionSource, /id="concept-modal" class="concept-modal" hidden/);
  assert.match(extensionSource, /payload\.command === "openConceptImage"/);
  assert.match(extensionSource, /payload\.command === "closeConceptImage"/);
  assert.match(extensionSource, /asWebviewUri\(uri\)/);
  assert.match(extensionSource, /img-src \$\{imgSource\}/);
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
