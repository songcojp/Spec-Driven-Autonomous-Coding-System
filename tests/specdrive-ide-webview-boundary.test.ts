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
const webviewSource = readSourceTree("apps/vscode-extension/src/webviews");
const executionQueueGroupsBlock = webviewSource.match(/const EXECUTION_QUEUE_GROUPS[\s\S]*?\];/)?.[0] ?? "";
const productConsoleSource = readFileSync("src/product-console.ts", "utf8");
const vscodeRestartBackendScript = readFileSync("scripts/vscode-restart-backend.sh", "utf8");
const vscodeDebugScript = readFileSync("scripts/vscode-debug.sh", "utf8");
const rootPackage = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const extensionPackage = JSON.parse(readFileSync("apps/vscode-extension/package.json", "utf8")) as {
  activationEvents?: string[];
  files?: string[];
  contributes?: {
    commands?: Array<{ command: string; title: string }>;
    menus?: {
      "view/title"?: Array<{ command: string; group?: string }>;
    };
  };
};

test("VSCode IDE package includes bundled .agents runtime", () => {
  assert.equal((extensionPackage.files ?? []).includes(".agents/**"), true);
});

test("VSCode bundled server starts with embedded worker by default", () => {
  assert.match(extensionSource, /extensionConfig<"off" \| "embedded" \| "worker-only">\("serverWorkerMode", "embedded"\)/);
  assert.equal(extensionPackage.contributes?.configuration?.properties?.["specdrive.serverWorkerMode"]?.default, "embedded");
  assert.match(vscodeRestartBackendScript, /BACKEND_PORT="\$\{AUTOBUILD_PORT:-43117\}"/);
  assert.match(vscodeRestartBackendScript, /WORKER_MODE="\$\{AUTOBUILD_WORKER_MODE:-embedded\}"/);
  assert.match(vscodeRestartBackendScript, /docker compose up -d redis/);
});

test("VSCode debug entry rebuilds artifacts and clears stale backend", () => {
  assert.equal(rootPackage.scripts?.["ide:debug"], "bash scripts/vscode-debug.sh");
  assert.match(vscodeDebugScript, /npm run ide:build/);
  assert.match(vscodeDebugScript, /esbuild src\/index\.ts/);
  assert.match(vscodeDebugScript, /outfile="\$\{EXTENSION_DIR\}\/server\/index\.cjs"/);
  assert.match(vscodeDebugScript, /BACKEND_PORT="\$\{AUTOBUILD_PORT:-43117\}"/);
  assert.match(vscodeDebugScript, /USER_DATA_DIR="\$\{AUTOBUILD_VSCODE_USER_DATA_DIR:-\$\{ROOT_DIR\}\/\.autobuild\/vscode-extension-host-user-data\}"/);
  assert.match(vscodeDebugScript, /EXTENSIONS_DIR="\$\{AUTOBUILD_VSCODE_EXTENSIONS_DIR:-\$\{ROOT_DIR\}\/\.autobuild\/vscode-extension-host-extensions\}"/);
  assert.match(vscodeDebugScript, /lsof -t -i:"\$\{BACKEND_PORT\}"/);
  assert.match(vscodeDebugScript, /--user-data-dir="\$\{USER_DATA_DIR\}"/);
  assert.match(vscodeDebugScript, /--extensions-dir="\$\{EXTENSIONS_DIR\}"/);
  assert.match(vscodeDebugScript, /--extensionDevelopmentPath="\$\{EXTENSION_DIR\}"/);
  assert.match(readFileSync(".vscode/launch.json", "utf8"), /--user-data-dir=\$\{workspaceFolder\}\/\.autobuild\/vscode-extension-host-user-data/);
  assert.match(readFileSync(".vscode/launch.json", "utf8"), /--extensions-dir=\$\{workspaceFolder\}\/\.autobuild\/vscode-extension-host-extensions/);
});

test("VSCode IDE Webviews expose independent workbench commands", () => {
  const activationEvents = new Set(extensionPackage.activationEvents ?? []);
  const commands = new Set((extensionPackage.contributes?.commands ?? []).map((command) => command.command));

  assert.equal(extensionPackage.contributes?.configuration?.properties?.["specdrive.openSpecWorkspaceOnStartup"]?.default, false);
  assert.match(extensionSource, /extensionConfig\("openSpecWorkspaceOnStartup", false\)/);
  assert.match(extensionSource, /function collapsibleStateFor/);
  assert.match(extensionSource, /element\.type === "root"\) return vscode\.TreeItemCollapsibleState\.Expanded/);

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

test("VSCode Execution Workbench requires selected queue tasks for stateful actions", () => {
  assert.match(extensionSource, /let selectedQueueKey: string \| undefined/);
  assert.match(extensionSource, /message\.command === "selectQueueItem"/);
  assert.match(extensionSource, /executionItemByKey\(view, selectedQueueKey\)/);
  assert.match(extensionSource, /renderExecutionWorkbenchWebview\(view, detail, selectedQueueKey, autoRefreshEnabled\)/);
  assert.match(extensionSource, /automation\?: SpecDriveIdeAutomationState/);
  assert.match(extensionSource, /autoRunButton\(view\)/);
  assert.match(extensionSource, /let autoRefreshEnabled = false/);
  assert.match(extensionSource, /WEBVIEW_AUTO_REFRESH_INTERVAL_MS = 60_000/);
  assert.match(extensionSource, /setInterval\(\(\) => \{/);
  assert.match(extensionSource, /\}, WEBVIEW_AUTO_REFRESH_INTERVAL_MS\)/);
  assert.match(extensionSource, /message\.command === "toggleAutoRefresh"/);
  assert.match(extensionSource, /if \(autoRefreshEnabled && view && !selectedQueueKey\)/);
  assert.match(extensionSource, /runningExecutionItem\(view\)/);
  assert.match(webviewSource, /autoRefreshSwitch\(autoRefreshEnabled\)/);
  assert.match(webviewSource, /role="switch"/);
  assert.match(webviewSource, /title="Refresh every 60 seconds"/);
  assert.match(webviewSource, /data-command="toggleAutoRefresh"/);
  assert.match(extensionSource, /view\?\.automation\?\.status === "running"/);
  assert.match(extensionSource, /commandButton\("Pause Auto Run", "controlled"/);
  assert.match(extensionSource, /action: "pause_runner"/);
  assert.match(extensionSource, /commandButton\("Start Auto Run", "controlled"/);
  assert.match(extensionSource, /commandButton\(selected \? "Selected" : "Select", "selectQueueItem"/);
  assert.match(extensionSource, /class="queue-item\$\{selected \? " selected" : ""\}"/);
  assert.match(extensionSource, /const EXECUTION_QUEUE_GROUPS: Array<\{ status: string; open: boolean \}> = \[/);
  assert.match(extensionSource, /\{ status: "running", open: true \},\n  \{ status: "queued", open: true \}/);
  assert.match(extensionSource, /\{ status: "approval_needed", open: false \}/);
  assert.doesNotMatch(executionQueueGroupsBlock, /status: "ready"/);
  assert.match(extensionSource, /renderQueueGroup\(group\.status, grouped\[group\.status\] \?\? \[\], selectedKey, group\.open\)/);
  assert.match(extensionSource, /<details class="queue-group"\$\{open \? " open" : ""\}>/);
  assert.match(extensionSource, /<summary class="queue-head">/);
  assert.match(extensionSource, /\.queue-group\[open\] \.queue-head::before\{content:"-"\}/);
  assert.match(extensionSource, /Select a job to enable job actions\./);
  assert.match(extensionSource, /<main class="execution-layout">/);
  assert.match(extensionSource, /<h2>Current Selected<\/h2>/);
  assert.match(extensionSource, /<div class="title-actions">\$\{selectedTaskActionButtons\(selectedItem\)\}<\/div>/);
  assert.match(extensionSource, /queueActionButton\("Run Now", selectedItem, "run_now", \["ready", "queued"\]\)/);
  assert.match(extensionSource, /runScheduledReceiptNow\(response, provider, "Auto Run is enabled; run the scheduled Feature now\."\)/);
  assert.match(extensionSource, /queueAction: "run_now"/);
  assert.match(extensionSource, /pauseResumeButton\(selectedItem\)/);
  assert.match(extensionSource, /if \(status === "paused"\) return queueActionButton\("Resume", item, "resume", \["paused"\]\)/);
  assert.match(extensionSource, /return queueActionButton\("Pause", item, "pause", \["queued", "running"\]\)/);
  assert.match(extensionSource, /queueActionButton\("Retry", selectedItem, "retry", \["failed", "cancelled", "skipped"\]\)/);
  assert.match(extensionSource, /queueActionButton\("Cancel", selectedItem, "cancel", \["ready", "queued", "running", "approval_needed", "blocked", "paused"\]\)/);
  assert.match(extensionSource, /queueActionButton\("Enqueue", selectedItem, "enqueue", \["ready", "blocked"\]\)/);
  assert.match(extensionSource, /Select a job first\./);
  assert.match(extensionSource, /selected job is \$\{selectedItem\.status\}/);
  assert.doesNotMatch(extensionSource, /queueButton\("Run Now", queue\.find/);
});

test("VSCode Execution Workbench renders execution result sections from durable runtime fields", () => {
  assert.match(webviewSource, /<h2>Summary<\/h2>/);
  assert.match(webviewSource, /<h3>Raw Log Refs<\/h3>/);
  assert.match(webviewSource, /<h3>Token Consumption<\/h3>/);
  assert.match(webviewSource, /renderTokenConsumption\(executionDetail\)/);
  assert.match(webviewSource, /No token consumption recorded\./);
  assert.match(webviewSource, /commandButton\("Open", "openRawLogRef"/);
  assert.match(extensionSource, /message\.command === "openRawLogRef"/);
  assert.match(extensionSource, /openRawLogRef\(message\.path\)/);
  assert.match(webviewSource, /<h3>Diff Summary<\/h3>/);
  assert.match(webviewSource, /<h3>SkillOutputContractV1<\/h3>/);
  assert.match(webviewSource, /executionDetail\?\.skillOutputContract/);
  assert.match(webviewSource, /<div class="section-title"><h2>Blockers & Approvals<\/h2><span>\$\{blockers\.length\}<\/span><\/div>/);
  assert.match(webviewSource, /Approval Requests/);
  assert.match(webviewSource, /<div class="section-title"><h2>Result Projection<\/h2><span>spec-state\.json<\/span><\/div>/);
  assert.match(webviewSource, /renderSkillOutputSummary\(executionDetail\)/);
  assert.match(webviewSource, /renderTraceabilityChips/);
  assert.match(webviewSource, /<h3>Token Cost<\/h3>/);
  assert.match(webviewSource, /renderTokenCostSummary\(executionDetail\)/);
  assert.match(webviewSource, /Calculated Cost/);
  assert.match(webviewSource, /<h3>Produced Artifacts<\/h3>/);
  assert.match(webviewSource, /renderProducedArtifacts\(executionDetail\)/);
  assert.match(webviewSource, /<h3>Additional Result<\/h3>/);
  assert.match(webviewSource, /renderAdditionalResult\(executionDetail\)/);
  assert.match(webviewSource, /commandsChecked/);
  assert.match(webviewSource, /openQuestions/);
  assert.match(webviewSource, /updatedDocuments/);
  assert.equal(webviewSource.includes('<h3>SkillOutputContractV1</h3>\n        ${compactJsonBlock(executionDetail?.contractValidation'), false);
});

test("VSCode Webview disabled buttons are visually distinct", () => {
  assert.match(extensionSource, /button:disabled,button:disabled:hover/);
  assert.match(extensionSource, /cursor:not-allowed/);
  assert.match(extensionSource, /opacity:\.55/);
  assert.match(extensionSource, /vscode-disabledForeground/);
});

test("VSCode Spec Explorer title actions are ordered by workflow", () => {
  const titleActions = extensionPackage.contributes?.menus?.["view/title"] ?? [];
  assert.deepEqual(titleActions.map((action) => action.command), [
    "specdrive.openSpecWorkspace",
    "specdrive.openFeatureSpec",
    "specdrive.openExecutionWorkbench",
    "specdrive.openSystemSettings",
    "specdrive.refresh",
    "specdrive.registerProject",
  ]);
  assert.deepEqual(titleActions.map((action) => action.group), [
    "navigation@1",
    "navigation@2",
    "navigation@3",
    "navigation@4",
    "navigation@5",
    "navigation@6",
  ]);
  assert.match(extensionSource, /registerCommand\("specdrive\.registerProject"/);
  assert.match(extensionSource, /function registerCurrentProject/);
  assert.match(extensionSource, /function isCompatibleControlPlane/);
  assert.match(extensionSource, /isCompatibleControlPlane\(configuredUrl, workspaceRoot\)/);
  assert.match(extensionSource, /expectedArtifactRoot = join\(workspaceRoot, "\.autobuild"\)/);
  assert.match(extensionSource, /normalizeFsPath\(body\.artifactRoot\) !== normalizeFsPath\(expectedArtifactRoot\)/);
  assert.match(extensionSource, /consoleCommandActions/);
  assert.match(extensionSource, /AUTOBUILD_AGENT_RUNTIME_PATHS/);
  assert.match(extensionSource, /this\.context\.extensionPath/);
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
  assert.match(extensionSource, /renderPricingSummary\(source\)/);
  assert.match(extensionSource, /renderPricingEditor\(editorId, source\)/);
  assert.match(extensionSource, /Pricing Model/);
  assert.match(extensionSource, /Pricing Rates/);
  assert.match(extensionSource, /Token Pricing/);
  assert.match(extensionSource, /data-pricing-field="inputUsdPer1M"/);
  assert.match(extensionSource, /data-pricing-field="cachedInputUsdPer1M"/);
  assert.match(extensionSource, /data-pricing-field="outputUsdPer1M"/);
  assert.match(extensionSource, /data-pricing-field="reasoningOutputUsdPer1M"/);
  assert.match(extensionSource, /updatePricingRate\(pricingTarget\)/);
  assert.match(extensionSource, /costRates: \{/);
  assert.match(extensionSource, /class="grid settings-grid"/);
  assert.match(extensionSource, /\.pricing-editor\{/);
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
  assert.match(extensionSource, /\.feature-card\.current\{background:var\(--vscode-list-activeSelectionBackground\);box-shadow:inset 4px 0 0 var\(--accent\)\}/);
  assert.match(extensionSource, /\.feature-card\.selected\{border-color:var\(--accent\);box-shadow:0 0 0 2px/);
  assert.match(extensionSource, /\.feature-card\.current\.selected\{box-shadow:inset 4px 0 0 var\(--accent\),0 0 0 2px/);
  assert.match(extensionSource, /data-feature-card="\$\{escapeAttr\(feature\.id\)\}"/);
  assert.match(extensionSource, /class="feature-card\$\{current \? " current" : ""\}"/);
  assert.match(extensionSource, /setCurrentFeatureCard\(card\)/);
  assert.match(extensionSource, /setCurrentFeatureCard\(featureCard\)/);
  assert.match(extensionSource, /vscode\.postMessage\(\{command:"selectFeature", featureId: featureCard\.dataset\.featureCard\}\)/);
  assert.match(extensionSource, /card\.classList\.toggle\("selected", selected\)/);
  assert.match(extensionSource, /card\.setAttribute\("aria-selected", selected \? "true" : "false"\)/);
  assert.match(extensionSource, /aria-current=\\"true\\"/);
  assert.match(extensionSource, /isClarificationNeededFeature\(feature\)/);
  assert.match(extensionSource, /commandButton\("Clarify", "openWorkbenchForm"/);
  assert.match(extensionSource, /isReviewNeededFeature\(feature\)/);
  assert.match(extensionSource, /function isPassableFeature\(feature: SpecDriveIdeFeatureNode\): boolean/);
  assert.match(extensionSource, /return isReviewNeededFeature\(feature\) \|\| isBlockedFeature\(feature\)/);
  assert.doesNotMatch(extensionSource, /selected && isClarificationNeededFeature\(selected\)/);
  assert.doesNotMatch(extensionSource, /selected && isPassableFeature\(selected\)/);
  assert.match(extensionSource, /approveFeatureReviewButton\("Pass", feature, projectId, "Feature Detail"\)/);
  assert.match(extensionSource, /action: "mark_feature_complete"/);
  assert.match(extensionSource, /isReadyMarkableFeature\(feature\)/);
  assert.match(extensionSource, /markFeatureReadyButton\("Ready", feature, projectId, "Feature Detail"\)/);
  assert.match(extensionSource, /action: "mark_feature_ready"/);
  assert.match(extensionSource, /renderFeatureSpecWebview\(view, selectedFeatureId, autoRefreshEnabled\)/);
  assert.match(extensionSource, /panel\.onDidDispose\(stopAutoRefresh\)/);
  assert.match(webviewSource, /autoRefreshSwitch\(autoRefreshEnabled\)/);
  assert.match(extensionSource, /title: "Blocked"/);
  assert.match(extensionSource, /title: "In-Process"/);
  assert.match(extensionSource, /title: "Todo"/);
  assert.match(webviewSource, /renderTokenCost\(feature\.tokenConsumption\)/);
  assert.match(webviewSource, /function renderFeatureArtifacts\(documents: SpecDriveIdeDocument\[\]\): string/);
  assert.match(webviewSource, /const fileName = document\.path\.split\(\//);
  assert.match(webviewSource, /<strong>\$\{escapeHtml\(fileName\)\}<\/strong>/);
  assert.match(webviewSource, />Open<\/button>/);
  assert.match(webviewSource, /<div class="task-chip-row">/);
  assert.doesNotMatch(webviewSource, /<h3>Acceptance<\/h3>/);
  assert.match(webviewSource, /\.feature-artifacts\{display:grid;gap:5px\}/);
  assert.match(webviewSource, /\.artifact-row\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(72px,max-content\) auto/);
  assert.match(webviewSource, /\.task-chip-row\{display:flex;flex-wrap:wrap;gap:6px\}/);
  assert.match(webviewSource, /\.token-mini-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(extensionSource, /Block \/ In Process \/ Todo/);
});

test("VSCode Feature Spec Webview schedules selected Features with adapter preference", () => {
  assert.match(extensionSource, /executionPreferenceControls\(view\)/);
  assert.doesNotMatch(extensionSource, /id="job-run-mode"/);
  assert.match(extensionSource, /commandButton\("Schedule Selected", "scheduleSelectedFeatures"/);
  assert.match(extensionSource, /data-feature-select/);
  assert.match(extensionSource, /const selectedFeatureIds = \(\) =>/);
  assert.match(extensionSource, /payload\.command === "scheduleSelectedFeatures"/);
  assert.match(extensionSource, /command: "scheduleFeatures"/);
  assert.match(extensionSource, /executionPreference: selectedExecutionPreference\(\)/);
  assert.match(extensionSource, /message\.command === "scheduleFeatures"/);
  assert.match(extensionSource, /scheduleFeatureSelection\(message, provider\)/);
  assert.match(extensionSource, /const schedulableFeatureIds = featureIds\.filter/);
  assert.match(extensionSource, /Skipped completed or terminal Feature Specs/);
  assert.match(extensionSource, /function isSchedulableFeature/);
  assert.match(extensionSource, /for \(const featureId of schedulableFeatureIds\)/);
  assert.match(extensionSource, /const shouldRunNowAfterSchedule = view\?\.automation\?\.status === "running" && !hasActiveQueueItem\(view\)/);
  assert.match(extensionSource, /action: "schedule_run"/);
  assert.match(extensionSource, /mode: "manual"/);
  assert.match(extensionSource, /operation: "feature_execution"/);
  assert.match(extensionSource, /requestedAction: "feature_execution"/);
  assert.match(extensionSource, /\.\.\.\(executionPreference \? \{ executionPreference \} : \{\}\)/);
  assert.match(extensionSource, /payload\.action === "schedule_run" \|\| payload\.action === "start_auto_run"/);
  assert.match(extensionSource, /scheduleRunPayload\(payload, executionPreference\)/);
  assert.match(extensionSource, /runScheduledReceiptNow\(response, provider, `Auto Run is enabled; run \$\{featureId\} now\.`\)/);
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
  assert.match(extensionSource, /label: "\.agents skill runtime initialized"/);
  assert.match(extensionSource, /function normalizeInitializationSteps/);
  assert.match(extensionSource, /function normalizeSpecDriveIdeView/);
  assert.match(extensionSource, /pathExists\("\.agents\/skills"\)/);
  assert.match(extensionSource, /key: "copy_skill_runtime"/);
  assert.match(extensionSource, /view\.workspaceRoot \? "Draft"/);
  assert.match(extensionSource, /label: "Register Current Project"/);
  assert.match(extensionSource, /action: "register_project"/);
  assert.match(extensionSource, /action: "connect_git_repository"/);
  assert.match(extensionSource, /entityType: "project"/);
  assert.match(extensionSource, /action: "initialize_spec_protocol"/);
  assert.match(extensionSource, /action: "import_or_create_constitution"/);
  assert.match(extensionSource, /action: "initialize_project_memory"/);
  assert.match(extensionSource, /action: "check_project_health"/);
  assert.match(extensionSource, /label: "Requirement Intake"/);
  assert.match(extensionSource, /label: "Feature Split"/);
  assert.match(extensionSource, /action: "scan_spec_sources"/);
  assert.match(extensionSource, /action: "upload_prd_source"/);
  assert.match(extensionSource, /action: "generate_ears"/);
  assert.match(extensionSource, /label: "PRD"/);
  assert.match(extensionSource, /label: "EARS Requirements"/);
  assert.match(extensionSource, /label: "HLD"/);
  assert.match(extensionSource, /label: "UI Spec"/);
  assert.doesNotMatch(extensionSource, /label: "UI Spec document and concept images"/);
  assert.match(extensionSource, /reason: "Generate HLD from Requirement Intake lifecycle\."/);
  assert.match(extensionSource, /reason: "Generate UI Spec from Requirement Intake lifecycle\."/);
  assert.doesNotMatch(extensionSource, /reason: "Generate HLD from Feature Split lifecycle\."/);
  assert.doesNotMatch(extensionSource, /reason: "Generate UI Spec from Feature Split lifecycle\."/);
  assert.match(extensionSource, /action: "split_feature_specs"/);
  assert.match(extensionSource, /<h3>UI Spec Concept Images<\/h3>/);
  assert.doesNotMatch(extensionSource, /<h3>UI Spec Assets<\/h3>/);
  assert.doesNotMatch(extensionSource, /UI Spec includes the Markdown document above plus the concept images below\./);
  assert.match(extensionSource, /class="concept-card" data-command="openConceptImage"/);
  assert.match(extensionSource, /id="concept-modal" class="concept-modal" hidden/);
  assert.match(extensionSource, /payload\.command === "openConceptImage"/);
  assert.match(extensionSource, /payload\.command === "closeConceptImage"/);
  assert.match(extensionSource, /asWebviewUri\(uri\)/);
  assert.match(extensionSource, /latestUiSpecExecutionDetail\(view\)/);
  assert.match(extensionSource, /skillOutputContract/);
  assert.match(extensionSource, /contract\.producedArtifacts/);
  assert.match(extensionSource, /detail\.producedArtifacts/);
  assert.match(extensionSource, /uiConceptWorkspaceRoot\(provider\.currentView\(\), workspaceRoot\)/);
  assert.match(extensionSource, /localResourceRoots/);
  assert.match(extensionSource, /discoverUiConceptImages\(rootUri, "docs\/ui\/concepts"\)/);
  assert.match(extensionSource, /readDirectory\(directoryUri\)/);
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

test("VSCode Webview controlled buttons only send supported Console command actions", () => {
  const consoleActionsMatch = productConsoleSource.match(/const CONSOLE_COMMAND_ACTIONS = new Set<ConsoleCommandAction>\(\[([\s\S]*?)\]\);/);
  assert.ok(consoleActionsMatch, "Console command action allowlist should be discoverable");
  const consoleActions = new Set([...consoleActionsMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
  const webviewControlledActions = new Set(
    [...webviewSource.matchAll(/action: "([^"]+)"/g)]
      .map((match) => match[1]),
  );

  assert.deepEqual(
    [...webviewControlledActions].filter((action) => !consoleActions.has(action)).sort(),
    [],
  );
  assert.equal(webviewControlledActions.has("check_project_health"), true);
  assert.equal(webviewControlledActions.has("scan_spec_sources"), true);
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
