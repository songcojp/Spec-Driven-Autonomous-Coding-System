import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import * as vscode from "vscode";
import type {
  ApprovalDecision,
  AdapterSettingsSection,
  ControlledCommandInput,
  IdeQueueCommandV1,
  QueueAction,
  SpecChangeCommandInput,
  SpecChangeRequestIntent,
  SpecChangeRequestV1,
  SpecDriveIdeDiagnostic,
  SpecDriveIdeExecutionDetail,
  SpecDriveIdeFeatureNode,
  SpecDriveIdeQueueItem,
  SpecDriveIdeView,
  SpecExplorerItem,
  SystemSettingsViewModel,
  UiConceptImage,
} from "./types";
import { currentExecutionItem, executionItemByKey, renderExecutionWebview, renderExecutionWorkbenchWebview, runningExecutionItem } from "./webviews/execution";
import { preferredFeature, preferredFeatureReviewSource, renderFeatureSpecWebview } from "./webviews/feature-spec";
import { preferredWorkspaceRequestSource, renderSpecWorkspaceWebview } from "./webviews/spec-workspace";
import { renderSystemSettingsWebview } from "./webviews/system-settings";

let controlPlaneManager: BundledControlPlaneManager | undefined;
let startupSpecWorkspaceOpened = false;
const WEBVIEW_AUTO_REFRESH_INTERVAL_MS = 60_000;
type ManagedWebviewPanel = {
  panel: vscode.WebviewPanel;
  render: () => Promise<void>;
};
let executionWorkbenchPanel: ManagedWebviewPanel | undefined;
let specWorkspacePanel: ManagedWebviewPanel | undefined;
let featureSpecPanel: (ManagedWebviewPanel & { selectFeature: (item?: unknown) => void }) | undefined;
let systemSettingsPanel: ManagedWebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("specdrive");
  context.subscriptions.push(diagnostics);
  controlPlaneManager = new BundledControlPlaneManager(context);
  context.subscriptions.push(controlPlaneManager);
  const provider = new SpecExplorerProvider(diagnostics, context);
  context.subscriptions.push(vscode.window.createTreeView("specdrive.specExplorer", { treeDataProvider: provider }));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.refresh", () => provider.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.registerProject", () => registerCurrentProject(provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.filterQueue", () => filterQueue(provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openProductConsole", (item: unknown) => openProductConsole(item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openExecutionWorkbench", () => openExecutionWorkbench(provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openSpecWorkspace", () => openSpecWorkspace(provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openFeatureSpec", (item: unknown) => openFeatureSpec(provider, item)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openSystemSettings", () => openSystemSettings(provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openItem", (item: unknown) => openItem(item)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openExecution", (item: unknown) => openExecution(item)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.queueRunNow", (item: unknown) => runQueueAction("run_now", item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.queuePause", (item: unknown) => runQueueAction("pause", item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.queueResume", (item: unknown) => runQueueAction("resume", item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.queueRetry", (item: unknown) => runQueueAction("retry", item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.queueCancel", (item: unknown) => runQueueAction("cancel", item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.queueSkip", (item: unknown) => runQueueAction("skip", item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.queueReprioritize", (item: unknown) => reprioritizeQueueItem(item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.approveAccept", (item: unknown) => approveQueueItem("accept", item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.approveAcceptForSession", (item: unknown) => approveQueueItem("acceptForSession", item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.approveDecline", (item: unknown) => approveQueueItem("decline", item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.approveCancel", (item: unknown) => approveQueueItem("cancel", item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.runControlledCommand", (input: unknown) => runControlledCommand(input, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.submitSpecChangeRequest", (input: unknown) => submitSpecChangeRequest(input, provider)));
  context.subscriptions.push(createSpecCommentController(context, provider));
  context.subscriptions.push(vscode.languages.registerHoverProvider({ language: "markdown", scheme: "file" }, new SpecHoverProvider(provider)));
  context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: "markdown", scheme: "file" }, new SpecCodeLensProvider(provider)));
  void provider.refresh().then(() => openSpecWorkspaceOnStartup(provider));
}

export function deactivate(): void {
  controlPlaneManager?.dispose();
  return;
}

class BundledControlPlaneManager implements vscode.Disposable {
  private process: ChildProcessWithoutNullStreams | undefined;
  private runtimeUrl: string | undefined;
  private startPromise: Promise<string> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async ensureReady(): Promise<string> {
    const configuredUrl = configuredControlPlaneUrlFromSettings();
    const mode = extensionConfig<"auto" | "external" | "off">("serverMode", "auto");
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (mode === "external" || mode === "off") {
      if (await isHealthy(configuredUrl)) {
        this.runtimeUrl = configuredUrl;
      }
      return configuredUrl;
    }

    if (await isCompatibleControlPlane(configuredUrl, workspaceRoot)) {
      this.runtimeUrl = configuredUrl;
      return configuredUrl;
    }

    if (!this.startPromise) {
      this.startPromise = this.startBundledServer().catch((error) => {
        this.startPromise = undefined;
        throw error;
      });
    }
    return this.startPromise;
  }

  currentUrl(): string | undefined {
    return this.runtimeUrl;
  }

  dispose(): void {
    this.process?.kill();
    this.process = undefined;
    this.startPromise = undefined;
  }

  private async startBundledServer(): Promise<string> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return configuredControlPlaneUrlFromSettings();

    const portStart = extensionConfig("serverPortStart", 43117);
    const port = await findFreePort(Number.isInteger(portStart) ? portStart : 43117);
    const serverPath = join(__dirname, "..", "server", "index.cjs");
    const configuredNodePath = extensionConfig("serverNodePath", "").trim();
    const command = configuredNodePath.length > 0 ? configuredNodePath : process.execPath;
    const workerMode = extensionConfig<"off" | "embedded" | "worker-only">("serverWorkerMode", "embedded");
    const args = [
      serverPath,
      "--port",
      String(port),
      ...(workerMode === "off" ? ["--no-worker"] : []),
      ...(workerMode === "worker-only" ? ["--worker-only"] : []),
    ];
    const env: Record<string, string | undefined> = {
      ...process.env,
      AUTOBUILD_PORT: String(port),
      AUTOBUILD_AGENT_RUNTIME_PATHS: [
        join(this.context.extensionPath, ".agents"),
        join(this.context.extensionPath, "..", "..", ".agents"),
      ].join("||"),
    };
    if (!configuredNodePath) env.ELECTRON_RUN_AS_NODE = "1";

    const child = spawn(command, args, { cwd: workspaceRoot, env, stdio: "pipe" });
    this.process = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const url = `http://127.0.0.1:${port}`;
    return await new Promise((resolve, reject) => {
      let stderr = "";
      const timeout = setTimeout(() => {
        reject(new Error(`SpecDrive bundled server did not become ready on ${url}. ${stderr.trim()}`.trim()));
      }, 15000);

      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdout.on("data", (chunk) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line) as { status?: string; port?: number };
            if (message.status === "listening") {
              clearTimeout(timeout);
              this.runtimeUrl = `http://127.0.0.1:${message.port ?? port}`;
              void this.context.workspaceState.update("specdrive.runtimeControlPlaneUrl", this.runtimeUrl);
              resolve(this.runtimeUrl);
            }
          } catch {
            // Non-JSON stdout is ignored; server readiness is reported as JSON.
          }
        }
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      child.once("exit", (code, signal) => {
        this.process = undefined;
        this.startPromise = undefined;
        if (!this.runtimeUrl) {
          clearTimeout(timeout);
          reject(new Error(`SpecDrive bundled server exited before ready: code=${String(code)} signal=${String(signal)} ${stderr.trim()}`.trim()));
        }
      });
    });
  }
}

class SpecExplorerProvider implements vscode.TreeDataProvider<SpecExplorerItem> {
  private readonly changed = new vscode.EventEmitter<SpecExplorerItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: SpecExplorerItem[] = [messageItem("loading", "Loading SpecDrive workspace...")];
  private view: SpecDriveIdeView | undefined;
  private queueStatusFilter: string | undefined;

  constructor(
    private readonly diagnostics: vscode.DiagnosticCollection,
    private readonly context: vscode.ExtensionContext,
  ) {
    const cachedView = context.workspaceState.get<SpecDriveIdeView>("specdrive.lastView");
    const cachedFilter = context.workspaceState.get<string | undefined>("specdrive.queueStatusFilter");
    this.queueStatusFilter = cachedFilter;
    if (cachedView) {
      this.view = cachedView;
      this.items = buildItems(cachedView, cachedFilter);
      updateDiagnostics(this.diagnostics, cachedView);
    }
  }

  async refresh(): Promise<void> {
    try {
      const view = await fetchSpecDriveView();
      this.view = view;
      this.items = buildItems(view, this.queueStatusFilter);
      updateDiagnostics(this.diagnostics, view);
      await this.context.workspaceState.update("specdrive.lastView", view);
      this.changed.fire(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.items = [messageItem("error", "Control Plane unavailable", message)];
      this.diagnostics.clear();
      this.changed.fire(undefined);
    }
  }

  getTreeItem(element: SpecExplorerItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(element.label, collapsibleStateFor(element));
    treeItem.description = element.description;
    treeItem.tooltip = element.description;
    treeItem.contextValue = element.type === "queue-item" ? `queue-item:${element.item.status}` : element.type;
    treeItem.iconPath = iconFor(element);
    if (element.type === "document" && element.exists) {
      treeItem.command = {
        command: "specdrive.openItem",
        title: "Open",
        arguments: [element],
      };
    }
    if (element.type === "queue-item") {
      treeItem.command = {
        command: "specdrive.openExecution",
        title: "Open Execution",
        arguments: [element],
      };
    }
    return treeItem;
  }

  getChildren(element?: SpecExplorerItem): SpecExplorerItem[] {
    if (!element) return this.items;
    if ("children" in element) return element.children;
    if (element.type === "feature") {
      return element.feature.documents.map((document) => ({
        type: "document",
        id: `${element.feature.id}:${document.path}`,
        label: document.label,
        description: document.exists ? document.path : `Missing: ${document.path}`,
        path: document.path,
        exists: document.exists,
      }));
    }
    return [];
  }

  currentView(): SpecDriveIdeView | undefined {
    return this.view;
  }

  currentQueueStatusFilter(): string | undefined {
    return this.queueStatusFilter;
  }

  async setQueueStatusFilter(status: string | undefined): Promise<void> {
    this.queueStatusFilter = status;
    if (this.view) this.items = buildItems(this.view, status);
    await this.context.workspaceState.update("specdrive.queueStatusFilter", status);
    this.changed.fire(undefined);
  }
}

function collapsibleStateFor(element: SpecExplorerItem): vscode.TreeItemCollapsibleState {
  if (!("children" in element) && element.type !== "feature") return vscode.TreeItemCollapsibleState.None;
  if (element.type === "root") return vscode.TreeItemCollapsibleState.Expanded;
  return vscode.TreeItemCollapsibleState.Collapsed;
}

function updateDiagnostics(collection: vscode.DiagnosticCollection, view: SpecDriveIdeView): void {
  collection.clear();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot || !view.recognized) return;
  const grouped = new Map<string, vscode.Diagnostic[]>();
  for (const item of view.diagnostics) {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      item.message,
      diagnosticSeverity(item.severity),
    );
    diagnostic.source = `SpecDrive ${item.source}`;
    const pathDiagnostics = grouped.get(item.path) ?? [];
    pathDiagnostics.push(diagnostic);
    grouped.set(item.path, pathDiagnostics);
  }
  for (const [path, diagnostics] of grouped) {
    collection.set(vscode.Uri.joinPath(workspaceRoot, ...path.split("/")), diagnostics);
  }
}

class SpecHoverProvider implements vscode.HoverProvider {
  constructor(private readonly provider: SpecExplorerProvider) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const view = this.provider.currentView();
    if (!view?.recognized) return undefined;
    const relativePath = workspaceRelativePath(document.fileName);
    if (!relativePath || !isSpecMarkdown(relativePath)) return undefined;
    const line = document.lineAt(position.line).text;
    const requirementId = line.match(/\b(REQ-[A-Z0-9-]+|REQ-\d+|NFR-\d+|EDGE-\d+)\b/)?.[1];
    const feature = featureForPath(view, relativePath);
    const contents = new vscode.MarkdownString();
    contents.appendMarkdown("**SpecDrive**\n\n");
    contents.appendMarkdown(`Path: \`${relativePath}\`\n\n`);
    if (requirementId) contents.appendMarkdown(`Requirement: \`${requirementId}\`\n\n`);
    if (feature) {
      contents.appendMarkdown(`Feature: \`${feature.id}\` (${feature.status})\n\n`);
      contents.appendMarkdown(`Traceability: \`${feature.dependencies.length > 0 ? feature.dependencies.join(", ") : "none"}\`\n\n`);
      if (feature.nextAction) contents.appendMarkdown(`Next action: ${feature.nextAction}\n\n`);
      if (feature.blockedReasons.length > 0) contents.appendMarkdown(`Blocked: ${feature.blockedReasons.join("; ")}\n\n`);
    }
    contents.appendMarkdown(`Actions: Add clarification, generate/update EARS, update design, split Feature, execute task.\n\n`);
    if (!requirementId && !feature) return undefined;
    return new vscode.Hover(contents);
  }
}

class SpecCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly provider: SpecExplorerProvider) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const view = this.provider.currentView();
    if (!view?.recognized) return [];
    const relativePath = workspaceRelativePath(document.fileName);
    if (!relativePath || !isSpecMarkdown(relativePath)) return [];
    const lenses: vscode.CodeLens[] = [];
    const projectId = view.project?.id;
    if (projectId && /(^|\/)PRD\.md$/.test(relativePath)) {
      lenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        command: "specdrive.submitSpecChangeRequest",
        title: "SpecDrive: Generate / Update EARS",
        arguments: [{
          intent: "generate_ears",
          comment: "Generate or update EARS requirements from VSCode PRD CodeLens.",
          line: 0,
        }],
      }));
      for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
        const text = document.lineAt(lineNumber).text.trim();
        if (!text || text.startsWith("#")) continue;
        lenses.push(new vscode.CodeLens(new vscode.Range(lineNumber, 0, lineNumber, 0), {
          command: "specdrive.submitSpecChangeRequest",
          title: "SpecDrive: Add Clarification",
          arguments: [{
            intent: "clarification",
            comment: "Clarification requested from VSCode CodeLens.",
            line: lineNumber,
          }],
        }));
      }
    }
    if (projectId && /(^|\/)requirements\.md$/.test(relativePath)) {
      for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
        const requirementId = document.lineAt(lineNumber).text.match(/\b(REQ-[A-Z0-9-]+|REQ-\d+|NFR-\d+|EDGE-\d+)\b/)?.[1];
        if (!requirementId) continue;
        lenses.push(new vscode.CodeLens(new vscode.Range(lineNumber, 0, lineNumber, 0), {
          command: "specdrive.submitSpecChangeRequest",
          title: "SpecDrive: Update Design",
          arguments: [{
            intent: "update_design",
            comment: `Update design for ${requirementId} from VSCode CodeLens.`,
            targetRequirementId: requirementId,
            traceability: [requirementId],
            line: lineNumber,
          }],
        }));
        lenses.push(new vscode.CodeLens(new vscode.Range(lineNumber, 0, lineNumber, 0), {
          command: "specdrive.submitSpecChangeRequest",
          title: "SpecDrive: Split Feature",
          arguments: [{
            intent: "split_feature",
            comment: `Split Feature Spec for ${requirementId} from VSCode CodeLens.`,
            targetRequirementId: requirementId,
            traceability: [requirementId],
            line: lineNumber,
          }],
        }));
      }
    }
    const feature = featureForPath(view, relativePath);
    if (projectId && feature && /\/tasks\.md$/.test(relativePath)) {
      lenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        command: "specdrive.runControlledCommand",
        title: "SpecDrive: Execute Feature",
        arguments: [{
          action: "schedule_run",
          entityType: "feature",
          entityId: feature.id,
          reason: "Schedule Feature execution from VSCode tasks CodeLens.",
          payload: {
            projectId,
            featureId: feature.id,
            mode: "manual",
            operation: "feature_execution",
            requestedAction: "feature_execution",
          },
        }],
      }));
      for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
        const taskId = document.lineAt(lineNumber).text.match(/\b(TASK-[A-Z0-9-]+|TASK-\d+)\b/)?.[1];
        if (!taskId) continue;
        lenses.push(new vscode.CodeLens(new vscode.Range(lineNumber, 0, lineNumber, 0), {
          command: "specdrive.runControlledCommand",
          title: `SpecDrive: Execute ${taskId}`,
          arguments: [{
            action: "schedule_run",
            entityType: "task",
            entityId: taskId,
            reason: `Schedule ${taskId} from VSCode tasks CodeLens.`,
            payload: {
              projectId,
              featureId: feature.id,
              taskId,
              mode: "manual",
              operation: "feature_execution",
              requestedAction: "feature_execution",
            },
          }],
        }));
        lenses.push(new vscode.CodeLens(new vscode.Range(lineNumber, 0, lineNumber, 0), {
          command: "specdrive.submitSpecChangeRequest",
          title: `SpecDrive: Mark ${taskId} Blocked`,
          arguments: [{
            intent: "spec_evolution",
            comment: `Mark ${taskId} blocked from VSCode CodeLens.`,
            traceability: [feature.id, taskId],
            line: lineNumber,
          }],
        }));
        lenses.push(new vscode.CodeLens(new vscode.Range(lineNumber, 0, lineNumber, 0), {
          command: "specdrive.submitSpecChangeRequest",
          title: `SpecDrive: Request ${taskId} Recovery`,
          arguments: [{
            intent: "spec_evolution",
            comment: `Request recovery for ${taskId} from VSCode CodeLens.`,
            traceability: [feature.id, taskId],
            line: lineNumber,
          }],
        }));
      }
    }
    return lenses;
  }
}

async function fetchSpecDriveView(): Promise<SpecDriveIdeView> {
  const controlPlaneUrl = await ensureControlPlaneReady();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const url = new URL("/ide/spec-tree", controlPlaneUrl);
  if (workspaceRoot) url.searchParams.set("workspaceRoot", workspaceRoot);
  const response = await fetchJson(url);
  if (!response.ok) {
    throw new Error(`SpecDrive request failed: ${response.status} ${response.statusText}`);
  }
  return await normalizeSpecDriveIdeView(await response.json() as SpecDriveIdeView);
}

async function normalizeSpecDriveIdeView(view: SpecDriveIdeView): Promise<SpecDriveIdeView> {
  const hasSkillRuntime = await pathExists(".agents/skills");
  const projectInitialization = view.projectInitialization ?? {
    ready: false,
    blocked: true,
    steps: [],
  };
  const steps = [...(projectInitialization.steps ?? [])];
  const existingIndex = steps.findIndex((step) => step.key === "copy_skill_runtime"
    || step.label.includes(".agents")
    || step.label.toLowerCase().includes("skill runtime"));
  const skillRuntimeStep = {
    key: "copy_skill_runtime" as const,
    label: ".agents skill runtime initialized",
    status: hasSkillRuntime ? "Ready" as const : view.workspaceRoot ? "Draft" as const : "Blocked" as const,
    blockedReason: hasSkillRuntime ? undefined : "Copy project-local .agents skills for governed SpecDrive workflows.",
  };
  if (existingIndex >= 0) {
    steps[existingIndex] = { ...steps[existingIndex], ...skillRuntimeStep };
  } else {
    const specProtocolIndex = steps.findIndex((step) => step.key === "initialize_spec_protocol"
      || step.label.includes("Spec Protocol")
      || step.label.includes(".autobuild"));
    steps.splice(specProtocolIndex >= 0 ? specProtocolIndex + 1 : steps.length, 0, skillRuntimeStep);
  }
  return {
    ...view,
    projectInitialization: {
      ...projectInitialization,
      ready: projectInitialization.ready && hasSkillRuntime,
      blocked: steps.some((step) => step.status === "Blocked"),
      steps,
    },
  };
}

async function pathExists(relativePath: string): Promise<boolean> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) return false;
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceRoot, ...relativePath.split("/")));
    return true;
  } catch {
    return false;
  }
}

async function fetchSystemSettings(): Promise<SystemSettingsViewModel> {
  const controlPlaneUrl = await ensureControlPlaneReady();
  let response = await fetchJson(new URL("/ide/system-settings", controlPlaneUrl));
  if (response.status === 404) {
    response = await fetchJson(new URL("/console/system-settings", controlPlaneUrl));
  }
  if (!response.ok) {
    throw new Error(`SpecDrive settings request failed: ${response.status} ${response.statusText}`);
  }
  return normalizeSystemSettingsViewModel(await response.json());
}

function normalizeSystemSettingsViewModel(payload: unknown): SystemSettingsViewModel {
  const source = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  return {
    projectExecutionPreference: normalizeProjectExecutionPreferenceSettings(source.projectExecutionPreference),
    cliAdapter: normalizeAdapterSettingsSection(source.cliAdapter),
    rpcAdapter: normalizeAdapterSettingsSection(source.rpcAdapter),
    commands: Array.isArray(source.commands)
      ? source.commands.filter((entry): entry is SystemSettingsViewModel["commands"][number] => {
        return typeof entry === "object"
          && entry !== null
          && typeof (entry as { action?: unknown }).action === "string"
          && typeof (entry as { entityType?: unknown }).entityType === "string";
      })
      : [],
    factSources: Array.isArray(source.factSources)
      ? source.factSources.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function normalizeProjectExecutionPreferenceSettings(value: unknown): SystemSettingsViewModel["projectExecutionPreference"] {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const active = typeof source.active === "object" && source.active !== null ? source.active as Record<string, unknown> : {};
  const validation = typeof source.validation === "object" && source.validation !== null ? source.validation as Record<string, unknown> : {};
  return {
    projectId: typeof source.projectId === "string" ? source.projectId : undefined,
    active,
    cliAdapters: Array.isArray(source.cliAdapters) ? source.cliAdapters.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null) : [],
    rpcAdapters: Array.isArray(source.rpcAdapters) ? source.rpcAdapters.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null) : [],
    validation: {
      valid: typeof validation.valid === "boolean" ? validation.valid : false,
      errors: Array.isArray(validation.errors) ? validation.errors.filter((entry): entry is string => typeof entry === "string") : [],
    },
  };
}

function normalizeAdapterSettingsSection(value: unknown): AdapterSettingsSection {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const active = typeof source.active === "object" && source.active !== null ? source.active as Record<string, unknown> : {};
  const draft = typeof source.draft === "object" && source.draft !== null ? source.draft as Record<string, unknown> : undefined;
  const presets = Array.isArray(source.presets)
    ? source.presets.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
  const validationSource = typeof source.validation === "object" && source.validation !== null
    ? source.validation as Record<string, unknown>
    : {};
  return {
    active,
    draft,
    presets,
    validation: {
      valid: validationSource.valid === true,
      errors: Array.isArray(validationSource.errors)
        ? validationSource.errors.filter((entry): entry is string => typeof entry === "string")
        : [],
    },
    lastDryRun: normalizeAdapterCheck(source.lastDryRun),
    lastProbe: normalizeAdapterCheck(source.lastProbe),
  };
}

type AdapterCheck = NonNullable<AdapterSettingsSection["lastDryRun"]>;

function normalizeAdapterCheck(value: unknown): AdapterCheck | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const status = typeof source.status === "string" ? source.status : undefined;
  if (!status) return undefined;
  return {
    status,
    errors: Array.isArray(source.errors)
      ? source.errors.filter((entry): entry is string => typeof entry === "string")
      : [],
    command: typeof source.command === "string" ? source.command : undefined,
    args: Array.isArray(source.args)
      ? source.args.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    at: typeof source.at === "string" ? source.at : undefined,
  };
}

async function runControlledCommand(input: unknown, provider: SpecExplorerProvider): Promise<Record<string, unknown> | undefined> {
  if (!isControlledCommandInput(input)) {
    await vscode.window.showErrorMessage("SpecDrive command input is invalid.");
    return undefined;
  }
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const currentView = provider.currentView();
    const projectId = currentView?.project?.id;
    const shouldRunNowAfterSchedule = input.action === "schedule_run"
      && currentView?.automation?.status === "running"
      && !hasActiveQueueItem(currentView);
    const payload = {
      ...(input.payload ?? {}),
      ...(input.action === "register_project" && workspaceRoot ? {
        workspaceRoot,
        projectName: provider.currentView()?.project?.name ?? workspaceName(workspaceRoot),
      } : {}),
      ...(projectId ? { projectId } : {}),
      ...((input.action === "pause_runner" || input.action === "resume_runner") && projectId ? {
        projectId,
      } : {}),
    };
    const response = await postIdeCommand({
      ...input,
      payload,
      requestedBy: "vscode-extension",
    });
    const status = typeof response.status === "string" ? response.status : "unknown";
    const executionId = typeof response.executionId === "string" ? ` execution=${response.executionId}` : "";
    const blocked = Array.isArray(response.blockedReasons) && response.blockedReasons.length > 0
      ? ` blocked=${response.blockedReasons.join("; ")}`
      : "";
    await vscode.window.showInformationMessage(`SpecDrive command ${status}.${executionId}${blocked}`);
    await provider.refresh();
    if (shouldRunNowAfterSchedule && response.status === "accepted") {
      await runScheduledReceiptNow(response, provider, "Auto Run is enabled; run the scheduled Feature now.");
    }
    return response;
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

function hasActiveQueueItem(view: SpecDriveIdeView | undefined): boolean {
  return Object.values(view?.queue.groups ?? {})
    .flat()
    .some((item) => ["queued", "running", "approval_needed"].includes(item.status));
}

async function registerCurrentProject(provider: SpecExplorerProvider): Promise<void> {
  const view = provider.currentView();
  await runControlledCommand({
    action: "register_project",
    entityType: "project",
    entityId: view?.project?.id ?? "workspace",
    reason: "Register current VSCode workspace as a SpecDrive project.",
  }, provider);
}

function workspaceName(workspaceRoot: string): string {
  return workspaceRoot.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace";
}

async function submitSpecChangeRequest(input: unknown, provider: SpecExplorerProvider): Promise<void> {
  if (!isSpecChangeCommandInput(input)) {
    await vscode.window.showErrorMessage("SpecDrive Spec change input is invalid.");
    return;
  }
  const view = provider.currentView();
  const editor = vscode.window.activeTextEditor;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!view?.project?.id || !workspaceRoot || !editor) {
    await vscode.window.showErrorMessage("SpecDrive Spec change requires an active Spec document and recognized project.");
    return;
  }
  const relativePath = workspaceRelativePath(editor.document.fileName);
  if (!relativePath || !isSpecMarkdown(relativePath)) {
    await vscode.window.showErrorMessage("SpecDrive Spec change requires a Spec Markdown document.");
    return;
  }
  try {
    const request = buildSpecChangeRequest(view.project.id, workspaceRoot, editor.document, relativePath, input);
    const response = await postIdeCommand(request);
    const status = typeof response.status === "string" ? response.status : "unknown";
    const stale = response.error === "stale_source" ? " stale_source" : "";
    await vscode.window.showInformationMessage(`SpecDrive Spec change ${status}.${stale}`);
    await provider.refresh();
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function postIdeCommand(input: (ControlledCommandInput & { requestedBy: string }) | SpecChangeRequestV1 | IdeQueueCommandV1): Promise<Record<string, unknown>> {
  const controlPlaneUrl = await ensureControlPlaneReady();
  const response = await fetchJson(new URL("/ide/commands", controlPlaneUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `SpecDrive command failed: ${response.status}`);
  }
  return body;
}

async function runSettingsCommand(message: Record<string, unknown>, provider: SpecExplorerProvider): Promise<void> {
  if (typeof message.action !== "string"
    || !isControlledEntityType(message.entityType)
    || typeof message.configText !== "string") {
    await vscode.window.showErrorMessage("SpecDrive settings command input is invalid.");
    return;
  }
  let config: Record<string, unknown>;
  try {
    const parsed = JSON.parse(message.configText) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      await vscode.window.showErrorMessage("SpecDrive settings JSON must be an object.");
      return;
    }
    config = parsed as Record<string, unknown>;
  } catch {
    await vscode.window.showErrorMessage("SpecDrive settings JSON is invalid.");
    return;
  }
  await runControlledCommand({
    action: message.action,
    entityType: message.entityType,
    entityId: typeof config.id === "string" ? config.id : "adapter",
    payload: { config },
    reason: typeof message.reason === "string" ? message.reason : "Update adapter config from VSCode System Settings.",
  }, provider);
}

async function postQueueCommand(
  queueAction: QueueAction,
  item: SpecDriveIdeQueueItem,
  provider: SpecExplorerProvider,
  input: { reason: string; payload?: Record<string, unknown>; approvalDecision?: ApprovalDecision },
): Promise<void> {
  const view = provider.currentView();
  const entityId = item.executionId ?? item.schedulerJobId;
  if (!entityId) {
    await vscode.window.showErrorMessage("SpecDrive queue action requires an execution or job id.");
    return;
  }
  const body: IdeQueueCommandV1 = {
    schemaVersion: 1,
    ideCommandType: "queue_action",
    projectId: view?.project?.id,
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    queueAction,
    entityType: item.executionId ? "run" : "job",
    entityId,
    requestedBy: "vscode-extension",
    reason: input.reason,
    payload: input.payload,
    approvalDecision: input.approvalDecision,
  };
  const response = await postIdeCommand(body);
  const status = typeof response.status === "string" ? response.status : "unknown";
  const executionId = typeof response.executionId === "string" ? ` execution=${response.executionId}` : "";
  await vscode.window.showInformationMessage(`SpecDrive queue ${queueAction} ${status}.${executionId}`);
  await provider.refresh();
}

async function runScheduledReceiptNow(response: Record<string, unknown>, provider: SpecExplorerProvider, reason: string): Promise<void> {
  const schedulerJobId = typeof response.schedulerJobId === "string" ? response.schedulerJobId : undefined;
  const executionId = typeof response.executionId === "string" ? response.executionId : undefined;
  const entityId = schedulerJobId ?? executionId;
  if (!entityId) return;
  const entityType: "job" | "run" = schedulerJobId ? "job" : "run";
  const view = provider.currentView();
  const body: IdeQueueCommandV1 = {
    schemaVersion: 1,
    ideCommandType: "queue_action",
    projectId: view?.project?.id,
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    queueAction: "run_now",
    entityType,
    entityId,
    requestedBy: "vscode-extension",
    reason,
  };
  const runNow = await postIdeCommand(body);
  const status = typeof runNow.status === "string" ? runNow.status : "unknown";
  const runExecutionId = typeof runNow.executionId === "string" ? ` execution=${runNow.executionId}` : "";
  await vscode.window.showInformationMessage(`SpecDrive queue run_now ${status}.${runExecutionId}`);
  await provider.refresh();
}

async function postQueueCommandForTarget(
  queueAction: QueueAction,
  entityId: string,
  entityType: "run" | "job",
  provider: SpecExplorerProvider,
  input: { reason: string; payload?: Record<string, unknown>; approvalDecision?: ApprovalDecision },
): Promise<void> {
  const view = provider.currentView();
  const body: IdeQueueCommandV1 = {
    schemaVersion: 1,
    ideCommandType: "queue_action",
    projectId: view?.project?.id,
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    queueAction,
    entityType,
    entityId,
    requestedBy: "vscode-extension",
    reason: input.reason,
    payload: input.payload,
    approvalDecision: input.approvalDecision,
  };
  const response = await postIdeCommand(body);
  const status = typeof response.status === "string" ? response.status : "unknown";
  const executionId = typeof response.executionId === "string" ? ` execution=${response.executionId}` : "";
  await vscode.window.showInformationMessage(`SpecDrive queue ${queueAction} ${status}.${executionId}`);
  await provider.refresh();
}

async function runQueueAction(queueAction: QueueAction, rawItem: unknown, provider: SpecExplorerProvider): Promise<void> {
  if (!isQueueItem(rawItem)) return;
  const reason = queueAction === "cancel" && rawItem.item.status === "running"
    ? "Cancel running app-server turn from VSCode Task Queue."
    : `Run ${queueAction} from VSCode Task Queue.`;
  try {
    await postQueueCommand(queueAction, rawItem.item, provider, { reason });
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function reprioritizeQueueItem(rawItem: unknown, provider: SpecExplorerProvider): Promise<void> {
  if (!isQueueItem(rawItem)) return;
  const value = await vscode.window.showInputBox({ prompt: "Priority", value: "0" });
  if (value === undefined) return;
  const priority = Number(value);
  if (!Number.isFinite(priority)) {
    await vscode.window.showErrorMessage("SpecDrive priority must be a number.");
    return;
  }
  await postQueueCommand("reprioritize", rawItem.item, provider, {
    reason: "Reprioritize from VSCode Task Queue.",
    payload: { priority },
  });
}

async function approveQueueItem(decision: ApprovalDecision, rawItem: unknown, provider: SpecExplorerProvider): Promise<void> {
  if (!isQueueItem(rawItem)) return;
  await postQueueCommand("approve", rawItem.item, provider, {
    reason: `Approval ${decision} from VSCode Task Queue.`,
    approvalDecision: decision,
  });
}

function buildSpecChangeRequest(
  projectId: string,
  workspaceRoot: string,
  document: vscode.TextDocument,
  relativePath: string,
  input: SpecChangeCommandInput,
): SpecChangeRequestV1 {
  const lineNumber = Math.max(0, Math.min(input.line ?? 0, document.lineCount - 1));
  const line = document.lineAt(lineNumber).text;
  const range = {
    startLine: lineNumber,
    endLine: lineNumber,
    startCharacter: 0,
    endCharacter: line.length,
  };
  const requirementId = input.targetRequirementId ?? line.match(/\b(REQ-[A-Z0-9-]+|REQ-\d+|NFR-\d+|EDGE-\d+)\b/)?.[1];
  const featureId = featureIdForPath(relativePath);
  return {
    schemaVersion: 1,
    projectId,
    workspaceRoot,
    source: {
      file: relativePath,
      range,
      textHash: hashText(line),
    },
    intent: input.intent,
    comment: input.comment,
    targetRequirementId: requirementId,
    traceability: [
      ...(input.traceability ?? []),
      ...(requirementId ? [requirementId] : []),
      ...(featureId ? [featureId] : []),
    ],
  };
}

function createSpecCommentController(
  context: vscode.ExtensionContext,
  provider: SpecExplorerProvider,
): vscode.Disposable {
  const controller = vscode.comments.createCommentController("specdrive-comments", "SpecDrive");
  controller.commentingRangeProvider = {
    provideCommentingRanges(document: vscode.TextDocument): vscode.Range[] {
      const relativePath = workspaceRelativePath(document.fileName);
      if (!relativePath || !isSpecMarkdown(relativePath)) return [];
      return Array.from({ length: document.lineCount }, (_, line) => new vscode.Range(line, 0, line, document.lineAt(line).text.length));
    },
  };
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.submitCommentDraft", (thread: unknown) =>
    submitCommentDraft(thread, provider)));
  return controller;
}

async function submitCommentDraft(thread: unknown, provider: SpecExplorerProvider): Promise<void> {
  if (!isCommentThread(thread)) {
    await vscode.window.showErrorMessage("SpecDrive comment draft is invalid.");
    return;
  }
  const view = provider.currentView();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!view?.project?.id || !workspaceRoot) {
    await vscode.window.showErrorMessage("SpecDrive comment submission requires a recognized project.");
    return;
  }
  const relativePath = workspaceRelativePath(thread.uri.fsPath);
  if (!relativePath || !isSpecMarkdown(relativePath)) {
    await vscode.window.showErrorMessage("SpecDrive comment submission requires a Spec Markdown document.");
    return;
  }
  const document = await vscode.workspace.openTextDocument(thread.uri) as vscode.TextDocument;
  const comment = thread.comments[0];
  const body = typeof comment.body === "string" ? comment.body : comment.body.value;
  const request = buildSpecChangeRequest(view.project.id, workspaceRoot, document, relativePath, {
    intent: "clarification",
    comment: body,
    line: thread.range.start.line,
  });
  const response = await postIdeCommand(request);
  const status = typeof response.status === "string" ? response.status : "unknown";
  if (status === "accepted") {
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    thread.comments = thread.comments.map((entry) => ({ ...entry, mode: vscode.CommentMode.Preview }));
  }
  await vscode.window.showInformationMessage(`SpecDrive comment ${status}.`);
  await provider.refresh();
}

function buildItems(view: SpecDriveIdeView, queueStatusFilter?: string): SpecExplorerItem[] {
  if (!view.recognized) {
    return [messageItem("unrecognized", "No SpecDrive workspace recognized", view.workspaceRoot ?? "Open a SpecDrive workspace or start the Control Plane.")];
  }
  const docs = view.documents.map((document) => ({
    type: "document" as const,
    id: document.path,
    label: document.label,
    description: document.exists ? document.path : `Missing: ${document.path}`,
    path: document.path,
    exists: document.exists,
  }));
  const features = view.features.map((feature) => ({
    type: "feature" as const,
    id: feature.id,
    label: `${feature.id} ${feature.title}`,
    description: [feature.status, feature.priority, feature.latestExecutionStatus].filter(Boolean).join(" · "),
    feature,
  }));
  const filteredGroups = Object.entries(view.queue.groups)
    .filter(([status]) => !queueStatusFilter || status === queueStatusFilter);
  const queueGroups = filteredGroups.map(([status, items]) => ({
    type: "root" as const,
      id: `queue:${status}`,
      label: status,
    description: `${items.length}`,
    children: items.map((item) => ({
      type: "queue-item" as const,
      id: item.executionId ?? item.schedulerJobId ?? `${status}:${item.operation}`,
      label: item.operation ?? item.jobType ?? "execution",
      description: [item.featureId, item.taskId, item.executionId].filter(Boolean).join(" · "),
      item,
    })),
  }));
  return [
    {
      type: "root",
      id: "workspace",
      label: view.project?.name ?? "SpecDrive Workspace",
      description: view.specRoot,
      children: docs,
    },
    {
      type: "root",
      id: "features",
      label: "Feature Specs",
      description: `${features.length}`,
      children: features,
    },
    {
      type: "root",
      id: "queue",
      label: "Task Queue",
      description: queueStatusFilter
        ? `${queueStatusFilter} · ${queueGroups.reduce((total, group) => total + Number(group.description ?? 0), 0)}`
        : `${queueGroups.reduce((total, group) => total + Number(group.description ?? 0), 0)}`,
      children: queueGroups,
    },
  ];
}

async function filterQueue(provider: SpecExplorerProvider): Promise<void> {
  const view = provider.currentView();
  const statuses = Object.keys(view?.queue.groups ?? {}).sort();
  const clearLabel = "All statuses";
  const selected = await vscode.window.showQuickPick([clearLabel, ...statuses], {
    placeHolder: provider.currentQueueStatusFilter() ?? clearLabel,
  });
  if (selected === undefined) return;
  await provider.setQueueStatusFilter(selected === clearLabel ? undefined : selected);
}

async function openItem(item: unknown): Promise<void> {
  if (!isDocumentItem(item) || !item.exists) return;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) return;
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspaceRoot, ...item.path.split("/")));
  await vscode.window.showTextDocument(document);
}

async function openExecution(item: unknown): Promise<void> {
  if (!isQueueItem(item)) return;
  const panel = vscode.window.createWebviewPanel("specdriveExecution", "SpecDrive Execution", vscode.ViewColumn.Active, { enableScripts: false });
  panel.iconPath = specExplorePanelIconUri("run-all");
  panel.webview.html = renderExecutionWebview(await fetchExecutionDetail(item.item));
}

async function openExecutionWorkbench(provider: SpecExplorerProvider): Promise<void> {
  if (executionWorkbenchPanel) {
    executionWorkbenchPanel.panel.reveal(vscode.ViewColumn.Active);
    await executionWorkbenchPanel.render();
    return;
  }
  const panel = vscode.window.createWebviewPanel("specdriveExecutionWorkbench", "Execution Workbench", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.iconPath = specExplorePanelIconUri("run-all");
  let selectedQueueKey: string | undefined;
  let autoRefreshEnabled = true;
  let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;
  let rendering = false;
  const render = async (): Promise<void> => {
    if (rendering) return;
    rendering = true;
    try {
      await provider.refresh();
      const view = provider.currentView();
      if (autoRefreshEnabled && view && !selectedQueueKey) {
        selectedQueueKey = queueItemKeyForWorkbench(runningExecutionItem(view)) ?? selectedQueueKey;
      }
      const selected = executionItemByKey(view, selectedQueueKey);
      if (selectedQueueKey && !selected) selectedQueueKey = undefined;
      const current = selected ?? (view ? currentExecutionItem(view) : undefined);
      const detail = current ? await fetchExecutionDetail(current) : undefined;
      panel.webview.html = renderExecutionWorkbenchWebview(view, detail, selectedQueueKey, autoRefreshEnabled);
    } finally {
      rendering = false;
    }
  };
  const stopAutoRefresh = (): void => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = undefined;
  };
  const startAutoRefresh = (): void => {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      void render();
    }, WEBVIEW_AUTO_REFRESH_INTERVAL_MS);
  };
  panel.onDidDispose(() => {
    stopAutoRefresh();
    executionWorkbenchPanel = undefined;
  });
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (isWorkbenchMessage(message) && message.command === "selectQueueItem" && typeof message.entityId === "string") {
      selectedQueueKey = `${message.entityType === "job" ? "job" : "run"}:${message.entityId}`;
      await render();
      return;
    }
    if (isWorkbenchMessage(message) && message.command === "toggleAutoRefresh") {
      autoRefreshEnabled = !autoRefreshEnabled;
      if (autoRefreshEnabled) startAutoRefresh();
      else stopAutoRefresh();
      await render();
      return;
    }
    await handleWorkbenchMessage(message, provider, render);
  });
  executionWorkbenchPanel = { panel, render };
  startAutoRefresh();
  await render();
}

async function openSpecWorkspace(provider: SpecExplorerProvider): Promise<void> {
  if (specWorkspacePanel) {
    specWorkspacePanel.panel.reveal(vscode.ViewColumn.Active);
    await specWorkspacePanel.render();
    return;
  }
  await provider.refresh();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const conceptRoot = uiConceptWorkspaceRoot(provider.currentView(), workspaceRoot);
  const localResourceRoots = uniqueUris([workspaceRoot, conceptRoot]);
  const panel = vscode.window.createWebviewPanel("specdriveSpecWorkspace", "Spec Workspace", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots,
  });
  panel.iconPath = specExplorePanelIconUri("checklist");
  let autoRefreshEnabled = true;
  let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;
  let rendering = false;
  const render = async (): Promise<void> => {
    if (rendering) return;
    rendering = true;
    try {
      await provider.refresh();
      const view = provider.currentView();
      const uiConceptImages = await collectUiConceptImages(panel.webview, view, uiConceptWorkspaceRoot(view, workspaceRoot));
      panel.webview.html = renderSpecWorkspaceWebview(view, uiConceptImages, autoRefreshEnabled, panel.webview.cspSource);
    } finally {
      rendering = false;
    }
  };
  const stopAutoRefresh = (): void => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = undefined;
  };
  const startAutoRefresh = (): void => {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      void render();
    }, WEBVIEW_AUTO_REFRESH_INTERVAL_MS);
  };
  panel.onDidDispose(() => {
    stopAutoRefresh();
    specWorkspacePanel = undefined;
  });
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (isWorkbenchMessage(message) && message.command === "specWorkspaceRequest" && typeof message.content === "string") {
      await submitSpecWorkspaceRequest(message.content, message.intent, provider);
      await render();
      return;
    }
    if (isWorkbenchMessage(message) && message.command === "toggleAutoRefresh") {
      autoRefreshEnabled = !autoRefreshEnabled;
      if (autoRefreshEnabled) startAutoRefresh();
      else stopAutoRefresh();
      await render();
      return;
    }
    await handleWorkbenchMessage(message, provider, render);
  });
  specWorkspacePanel = { panel, render };
  startAutoRefresh();
  await render();
}

function queueItemKeyForWorkbench(item: SpecDriveIdeQueueItem | undefined): string | undefined {
  const entityId = item?.executionId ?? item?.schedulerJobId;
  if (!entityId) return undefined;
  return `${item?.executionId ? "run" : "job"}:${entityId}`;
}

async function openFeatureSpec(provider: SpecExplorerProvider, item?: unknown): Promise<void> {
  if (featureSpecPanel) {
    featureSpecPanel.selectFeature(item);
    featureSpecPanel.panel.reveal(vscode.ViewColumn.Active);
    await featureSpecPanel.render();
    return;
  }
  const panel = vscode.window.createWebviewPanel("specdriveFeatureSpec", "Feature Spec", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.iconPath = specExplorePanelIconUri("layout");
  let selectedFeatureId = isFeatureItem(item) ? item.feature.id : undefined;
  let panelOpenState: Record<string, boolean> = {};
  let autoRefreshEnabled = true;
  let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;
  let rendering = false;
  const render = async (): Promise<void> => {
    if (rendering) return;
    rendering = true;
    try {
      await provider.refresh();
      const view = provider.currentView();
      if (!selectedFeatureId || !view?.features.some((feature) => feature.id === selectedFeatureId)) {
        selectedFeatureId = preferredFeature(view)?.id;
      }
      panel.webview.html = renderFeatureSpecWebview(view, selectedFeatureId, autoRefreshEnabled, panelOpenState);
    } finally {
      rendering = false;
    }
  };
  const stopAutoRefresh = (): void => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = undefined;
  };
  const startAutoRefresh = (): void => {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      void render();
    }, WEBVIEW_AUTO_REFRESH_INTERVAL_MS);
  };
  const selectFeature = (nextItem?: unknown): void => {
    if (isFeatureItem(nextItem)) selectedFeatureId = nextItem.feature.id;
  };
  panel.onDidDispose(() => {
    stopAutoRefresh();
    featureSpecPanel = undefined;
  });
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (isWorkbenchMessage(message) && message.command === "selectFeature" && typeof message.featureId === "string") {
      selectedFeatureId = message.featureId;
      if (typeof message.panelOpenState === "object" && message.panelOpenState !== null && !Array.isArray(message.panelOpenState)) {
        panelOpenState = Object.fromEntries(Object.entries(message.panelOpenState).filter((entry): entry is [string, boolean] => typeof entry[0] === "string" && typeof entry[1] === "boolean"));
      }
      await render();
      return;
    }
    if (isWorkbenchMessage(message) && message.command === "newFeature" && typeof message.content === "string") {
      await submitNewFeatureRequest(message.content, provider);
      await render();
      return;
    }
    if (isWorkbenchMessage(message) && message.command === "reviewFeature" && typeof message.featureId === "string" && typeof message.comment === "string") {
      const feature = provider.currentView()?.features.find((entry) => entry.id === message.featureId);
      if (feature) await submitFeatureReviewClarification(feature, message.comment, provider);
      await render();
      return;
    }
    if (isWorkbenchMessage(message) && message.command === "scheduleFeatures") {
      await scheduleFeatureSelection(message, provider);
      await render();
      return;
    }
    if (isWorkbenchMessage(message) && message.command === "toggleAutoRefresh") {
      autoRefreshEnabled = !autoRefreshEnabled;
      if (autoRefreshEnabled) startAutoRefresh();
      else stopAutoRefresh();
      await render();
      return;
    }
    await handleWorkbenchMessage(message, provider, render);
  });
  featureSpecPanel = { panel, render, selectFeature };
  startAutoRefresh();
  await render();
}

async function openSystemSettings(provider: SpecExplorerProvider): Promise<void> {
  if (systemSettingsPanel) {
    systemSettingsPanel.panel.reveal(vscode.ViewColumn.Active);
    await systemSettingsPanel.render();
    return;
  }
  const panel = vscode.window.createWebviewPanel("specdriveSystemSettings", "System Settings", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  panel.iconPath = specExplorePanelIconUri("settings-gear");
  const render = async (): Promise<void> => {
    panel.webview.html = renderSystemSettingsWebview(await fetchSystemSettings());
  };
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (!isWorkbenchMessage(message)) return;
    try {
      if (message.command === "refresh") {
        await render();
        return;
      }
      if (message.command === "settingsCommand") {
        await runSettingsCommand(message, provider);
        await render();
      }
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });
  panel.onDidDispose(() => {
    systemSettingsPanel = undefined;
  });
  systemSettingsPanel = { panel, render };
  await render();
}

function specExplorePanelIconUri(icon: "checklist" | "layout" | "run-all" | "settings-gear"): { light: vscode.Uri; dark: vscode.Uri } {
  const resourceRoot = join(__dirname, "..", "resources");
  return {
    light: vscode.Uri.file(join(resourceRoot, `spec-explore-${icon}-light.svg`)),
    dark: vscode.Uri.file(join(resourceRoot, `spec-explore-${icon}-dark.svg`)),
  };
}

async function handleWorkbenchMessage(
  message: unknown,
  provider: SpecExplorerProvider,
  render: () => Promise<void>,
): Promise<void> {
  if (!isWorkbenchMessage(message)) return;
  try {
    if (message.command === "refresh") {
      await render();
      return;
    }
    if (message.command === "openDocument" && typeof message.path === "string") {
      await openDocumentPath(message.path);
      return;
    }
    if (message.command === "openRawLogRef" && typeof message.path === "string") {
      await openRawLogRef(message.path);
      return;
    }
    if (message.command === "queue" && isQueueAction(message.action) && typeof message.entityId === "string") {
      const payload = message.action === "reprioritize"
        ? await priorityPayload()
        : typeof message.payload === "object" && message.payload !== null ? message.payload as Record<string, unknown> : undefined;
      if (message.action === "reprioritize" && !payload) return;
      await postQueueCommandForTarget(message.action, message.entityId, message.entityType === "job" ? "job" : "run", provider, {
        reason: typeof message.reason === "string" ? message.reason : `Run ${message.action} from VSCode Webview.`,
        payload,
        approvalDecision: isApprovalDecision(message.approvalDecision) ? message.approvalDecision : undefined,
      });
      await render();
      return;
    }
    if (message.command === "controlled"
      && typeof message.action === "string"
      && isControlledEntityType(message.entityType)
      && typeof message.entityId === "string") {
      await runControlledCommand({
        action: message.action,
        entityType: message.entityType,
        entityId: message.entityId,
        reason: typeof message.reason === "string" ? message.reason : "Run controlled command from VSCode Webview.",
        payload: typeof message.payload === "object" && message.payload !== null ? message.payload as Record<string, unknown> : undefined,
      }, provider);
      await render();
    }
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}

async function submitNewFeatureRequest(content: string, provider: SpecExplorerProvider): Promise<void> {
  const view = provider.currentView();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!view?.project?.id || !workspaceRoot) {
    await vscode.window.showErrorMessage("SpecDrive New Feature requires a recognized project.");
    return;
  }
  const trimmed = content.trim();
  if (!trimmed) {
    await vscode.window.showErrorMessage("SpecDrive New Feature input is empty.");
    return;
  }
  const sourcePath = "docs/features/README.md";
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), ...sourcePath.split("/")));
  const firstLine = document.lineCount > 0 ? document.lineAt(0).text : "";
  const request: SpecChangeRequestV1 = {
    schemaVersion: 1,
    projectId: view.project.id,
    workspaceRoot,
    source: {
      file: sourcePath,
      range: {
        startLine: 0,
        endLine: 0,
        startCharacter: 0,
        endCharacter: firstLine.length,
      },
      textHash: hashText(firstLine),
    },
    intent: "requirement_change_or_intake",
    comment: trimmed,
    traceability: [
      "VSCode Feature Spec Webview",
      "New Feature",
      ...view.features.map((feature) => feature.id).slice(0, 20),
    ],
  };
  const response = await postIdeCommand(request);
  const status = typeof response.status === "string" ? response.status : "unknown";
  const routed = typeof response.routedIntent === "string" ? ` routed=${response.routedIntent}` : "";
  const blocked = Array.isArray(response.blockedReasons) && response.blockedReasons.length > 0
    ? ` blocked=${response.blockedReasons.join("; ")}`
    : "";
  await vscode.window.showInformationMessage(`SpecDrive New Feature ${status}.${routed}${blocked}`);
  await provider.refresh();
}

async function scheduleFeatureSelection(message: Record<string, unknown>, provider: SpecExplorerProvider): Promise<void> {
  const view = provider.currentView();
  const projectId = typeof message.projectId === "string" && message.projectId
    ? message.projectId
    : view?.project?.id;
  if (!projectId) {
    await vscode.window.showErrorMessage("SpecDrive Feature scheduling requires a recognized project.");
    return;
  }
  const featuresById = new Map((view?.features ?? []).map((feature) => [feature.id, feature]));
  const featureIds = Array.isArray(message.featureIds)
    ? message.featureIds.filter((entry): entry is string => typeof entry === "string" && featuresById.has(entry))
    : [];
  if (featureIds.length === 0) {
    await vscode.window.showErrorMessage("Select at least one Feature Spec to schedule.");
    return;
  }
  const schedulableFeatureIds = featureIds.filter((featureId) => isSchedulableFeature(featuresById.get(featureId)));
  const skippedFeatureIds = featureIds.filter((featureId) => !schedulableFeatureIds.includes(featureId));
  if (schedulableFeatureIds.length === 0) {
    await vscode.window.showInformationMessage(`No selected Feature Specs can be scheduled. Skipped: ${skippedFeatureIds.join(", ")}.`);
    return;
  }
  const executionPreference = typeof message.executionPreference === "object" && message.executionPreference !== null && !Array.isArray(message.executionPreference)
    ? message.executionPreference as Record<string, unknown>
    : undefined;
  const receipts: string[] = [];
  const shouldRunNowAfterSchedule = view?.automation?.status === "running" && !hasActiveQueueItem(view);
  for (const featureId of schedulableFeatureIds) {
    const response = await postIdeCommand({
      action: "schedule_run",
      entityType: "feature",
      entityId: featureId,
      requestedBy: "vscode-extension",
      reason: `Schedule ${featureId} from Feature Spec Webview selection.`,
      payload: {
        projectId,
        featureId,
        mode: "manual",
        operation: "feature_execution",
        requestedAction: "feature_execution",
        ...(executionPreference ? { executionPreference } : {}),
      },
    });
    const status = typeof response.status === "string" ? response.status : "unknown";
    const executionId = typeof response.executionId === "string" ? `:${response.executionId}` : "";
    receipts.push(`${featureId}=${status}${executionId}`);
    if (shouldRunNowAfterSchedule && response.status === "accepted") {
      await runScheduledReceiptNow(response, provider, `Auto Run is enabled; run ${featureId} now.`);
    }
  }
  const skipped = skippedFeatureIds.length > 0 ? ` Skipped completed or terminal Feature Specs: ${skippedFeatureIds.join(", ")}.` : "";
  await vscode.window.showInformationMessage(`SpecDrive scheduled ${receipts.length} Feature Spec${receipts.length === 1 ? "" : "s"}: ${receipts.join(", ")}.${skipped}`);
  await provider.refresh();
}

function isSchedulableFeature(feature: SpecDriveIdeFeatureNode | undefined): boolean {
  if (!feature) return false;
  const status = normalizeFeatureScheduleStatus(feature.status);
  const executionStatus = normalizeFeatureScheduleStatus(feature.latestExecutionStatus);
  return !["done", "completed", "delivered"].includes(status)
    && !["queued", "running"].includes(executionStatus);
}

function normalizeFeatureScheduleStatus(status: string | undefined): string {
  return (status ?? "").toLowerCase().replaceAll("_", " ").replaceAll("-", " ").trim();
}

async function submitSpecWorkspaceRequest(content: string, intent: unknown, provider: SpecExplorerProvider): Promise<void> {
  const view = provider.currentView();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!view?.project?.id || !workspaceRoot) {
    await vscode.window.showErrorMessage("SpecDrive Spec Workspace request requires a recognized project.");
    return;
  }
  const trimmed = content.trim();
  if (!trimmed) {
    await vscode.window.showErrorMessage("SpecDrive Spec Workspace request input is empty.");
    return;
  }
  const requestIntent: SpecChangeRequestIntent = isSpecChangeRequestIntent(intent) ? intent : "requirement_change_or_intake";
  const sourcePath = preferredWorkspaceRequestSource(view);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), ...sourcePath.split("/")));
  const firstLine = document.lineCount > 0 ? document.lineAt(0).text : "";
  const request: SpecChangeRequestV1 = {
    schemaVersion: 1,
    projectId: view.project.id,
    workspaceRoot,
    source: {
      file: sourcePath,
      range: {
        startLine: 0,
        endLine: 0,
        startCharacter: 0,
        endCharacter: firstLine.length,
      },
      textHash: hashText(firstLine),
    },
    intent: requestIntent,
    comment: trimmed,
    traceability: [
      "VSCode Spec Workspace",
      requestIntent,
    ],
  };
  const response = await postIdeCommand(request);
  const status = typeof response.status === "string" ? response.status : "unknown";
  const routed = typeof response.routedIntent === "string" ? ` routed=${response.routedIntent}` : "";
  const blocked = Array.isArray(response.blockedReasons) && response.blockedReasons.length > 0
    ? ` blocked=${response.blockedReasons.join("; ")}`
    : "";
  await vscode.window.showInformationMessage(`SpecDrive Spec Workspace request ${status}.${routed}${blocked}`);
  await provider.refresh();
}

async function submitFeatureReviewClarification(
  feature: SpecDriveIdeFeatureNode,
  comment: string,
  provider: SpecExplorerProvider,
): Promise<void> {
  const view = provider.currentView();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!view?.project?.id || !workspaceRoot) {
    await vscode.window.showErrorMessage("SpecDrive Feature review requires a recognized project.");
    return;
  }
  const trimmed = comment.trim();
  if (!trimmed) {
    await vscode.window.showErrorMessage("SpecDrive Feature review clarification is empty.");
    return;
  }
  const sourcePath = preferredFeatureReviewSource(feature);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), ...sourcePath.split("/")));
  const firstLine = document.lineCount > 0 ? document.lineAt(0).text : "";
  const request: SpecChangeRequestV1 = {
    schemaVersion: 1,
    projectId: view.project.id,
    workspaceRoot,
    source: {
      file: sourcePath,
      range: {
        startLine: 0,
        endLine: 0,
        startCharacter: 0,
        endCharacter: firstLine.length,
      },
      textHash: hashText(firstLine),
    },
    intent: "clarification",
    comment: trimmed,
    traceability: [
      "VSCode Feature Spec Webview",
      "Feature Review",
      feature.id,
      feature.status,
    ],
  };
  const response = await postIdeCommand(request);
  const status = typeof response.status === "string" ? response.status : "unknown";
  const routed = typeof response.routedIntent === "string" ? ` routed=${response.routedIntent}` : "";
  const blocked = Array.isArray(response.blockedReasons) && response.blockedReasons.length > 0
    ? ` blocked=${response.blockedReasons.join("; ")}`
    : "";
  await vscode.window.showInformationMessage(`SpecDrive Feature review ${status}.${routed}${blocked}`);
  await provider.refresh();
}

async function priorityPayload(): Promise<Record<string, unknown> | undefined> {
  const value = await vscode.window.showInputBox({ prompt: "Priority", value: "0" });
  if (value === undefined) return undefined;
  const priority = Number(value);
  if (!Number.isFinite(priority)) {
    await vscode.window.showErrorMessage("SpecDrive priority must be a number.");
    return undefined;
  }
  return { priority };
}

async function openDocumentPath(path: string): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) return;
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspaceRoot, ...path.split("/")));
  await vscode.window.showTextDocument(document);
}

async function openRawLogRef(path: string): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const uri = isAbsolutePath(path)
    ? vscode.Uri.file(path)
    : workspaceRoot
      ? vscode.Uri.joinPath(workspaceRoot, ...path.split(/[\\/]+/u))
      : undefined;
  if (!uri) return;
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);
}

async function openProductConsole(item: unknown, provider: SpecExplorerProvider): Promise<void> {
  const baseUrl = vscode.workspace.getConfiguration("specdrive").get("productConsoleUrl", provider.currentView()?.productConsole?.defaultUrl ?? "http://127.0.0.1:5173");
  const path = isQueueItem(item)
    ? provider.currentView()?.productConsole?.links.queue ?? "/#runner"
    : provider.currentView()?.productConsole?.links.workspace ?? "/#spec";
  const url = new URL(path, baseUrl);
  if (isQueueItem(item) && item.item.executionId) url.searchParams.set("executionId", item.item.executionId);
  if (isQueueItem(item) && item.item.featureId) url.searchParams.set("featureId", item.item.featureId);
  if (isFeatureItem(item)) url.searchParams.set("featureId", item.feature.id);
  await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
}

async function collectUiConceptImages(
  webview: vscode.Webview,
  view: SpecDriveIdeView | undefined,
  rootUri: vscode.Uri | undefined,
): Promise<UiConceptImage[]> {
  if (!rootUri) return [];
  const uiSpecDetail = await latestUiSpecExecutionDetail(view);
  const artifacts = uiConceptImageArtifacts(uiSpecDetail);
  const candidates = artifacts.length > 0
    ? artifacts
    : await discoverUiConceptImages(rootUri, "docs/ui/concepts");
  const images: UiConceptImage[] = [];
  const seen = new Set<string>();
  for (const [label, path] of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);
    const uri = conceptImageUri(rootUri, path);
    if (!uri) continue;
    try {
      await vscode.workspace.fs.stat(uri);
      images.push({ label, path, uri: webview.asWebviewUri(uri).toString() });
    } catch {
      // Missing concept images are expected in early projects.
    }
  }
  return images;
}

function uiConceptWorkspaceRoot(view: SpecDriveIdeView | undefined, fallback: vscode.Uri | undefined): vscode.Uri | undefined {
  const path = view?.project?.targetRepoPath ?? view?.workspaceRoot;
  return path ? vscode.Uri.file(path) : fallback;
}

function uniqueUris(uris: Array<vscode.Uri | undefined>): vscode.Uri[] {
  const seen = new Set<string>();
  return uris.filter((uri): uri is vscode.Uri => {
    if (!uri) return false;
    const key = uri.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function latestUiSpecExecutionDetail(view: SpecDriveIdeView | undefined): Promise<SpecDriveIdeExecutionDetail | SpecDriveIdeQueueItem | undefined> {
  const items = Object.values(view?.queue.groups ?? {}).flat();
  const uiSpecItem = items
    .filter((item) => item.executionId && (item.operation === "generate_ui_spec" || item.adapter === "ui-spec-skill"))
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))[0];
  return uiSpecItem ? await fetchExecutionDetail(uiSpecItem) : undefined;
}

function uiConceptImageArtifacts(detail: SpecDriveIdeExecutionDetail | SpecDriveIdeQueueItem | undefined): Array<[string, string]> {
  const contract = detail && "skillOutputContract" in detail && isRecord(detail.skillOutputContract)
    ? detail.skillOutputContract
    : {};
  const contractArtifacts = arrayValue(contract.producedArtifacts);
  const detailArtifacts = detail && "producedArtifacts" in detail ? arrayValue(detail.producedArtifacts) : [];
  return [...contractArtifacts, ...detailArtifacts]
    .map(uiConceptImageArtifact)
    .filter((entry): entry is [string, string] => Boolean(entry));
}

function uiConceptImageArtifact(artifact: unknown): [string, string] | undefined {
  if (!isRecord(artifact)) return undefined;
  const path = optionalString(artifact.path);
  if (!path || !isUiConceptImagePath(path)) return undefined;
  const status = optionalString(artifact.status)?.toLowerCase();
  if (status === "missing" || status === "skipped") return undefined;
  return [optionalString(artifact.summary) ?? conceptImageLabel(path), path];
}

function isUiConceptImagePath(path: string): boolean {
  return /\.(svg|png|jpe?g|webp)$/iu.test(path);
}

function conceptImageUri(workspaceRoot: vscode.Uri, path: string): vscode.Uri | undefined {
  if (isAbsolutePath(path)) return vscode.Uri.file(path);
  const segments = path.split(/[\\/]+/u).filter(Boolean);
  return segments.length > 0 ? vscode.Uri.joinPath(workspaceRoot, ...segments) : undefined;
}

async function discoverUiConceptImages(workspaceRoot: vscode.Uri, directory: string): Promise<Array<[string, string]>> {
  const directoryUri = vscode.Uri.joinPath(workspaceRoot, ...directory.split("/"));
  try {
    const entries: Array<[string, vscode.FileType]> = await vscode.workspace.fs.readDirectory(directoryUri);
    return entries
      .filter(([, type]) => type === vscode.FileType.File)
      .map(([name]) => name)
      .filter((name: string) => isUiConceptImagePath(name))
      .sort((left: string, right: string) => left.localeCompare(right))
      .map((name: string): [string, string] => [conceptImageLabel(name), `${directory}/${name}`]);
  } catch {
    return [];
  }
}

function conceptImageLabel(path: string): string {
  const fileName = path.split(/[\\/]+/u).filter(Boolean).at(-1) ?? path;
  return fileName
    .replace(/\.(svg|png|jpe?g|webp)$/iu, "")
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (match) => match.toUpperCase());
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isDocumentItem(item: unknown): item is Extract<SpecExplorerItem, { type: "document" }> {
  return typeof item === "object"
    && item !== null
    && (item as { type?: unknown }).type === "document"
    && typeof (item as { path?: unknown }).path === "string";
}

function isQueueItem(item: unknown): item is Extract<SpecExplorerItem, { type: "queue-item" }> {
  return typeof item === "object"
    && item !== null
    && (item as { type?: unknown }).type === "queue-item"
    && typeof (item as { item?: unknown }).item === "object";
}

function isFeatureItem(item: unknown): item is Extract<SpecExplorerItem, { type: "feature" }> {
  return typeof item === "object"
    && item !== null
    && (item as { type?: unknown }).type === "feature"
    && typeof (item as { feature?: { id?: unknown } }).feature?.id === "string";
}

function isControlledCommandInput(input: unknown): input is ControlledCommandInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Partial<ControlledCommandInput>;
  return typeof record.action === "string"
    && typeof record.entityType === "string"
    && typeof record.entityId === "string"
    && typeof record.reason === "string";
}

function isSpecChangeCommandInput(input: unknown): input is SpecChangeCommandInput {
  if (typeof input !== "object" || input === null) return false;
  const record = input as Partial<SpecChangeCommandInput>;
  return isSpecChangeRequestIntent(record.intent) && typeof record.comment === "string";
}

function isSpecChangeRequestIntent(value: unknown): value is SpecChangeRequestIntent {
  return value === "clarification"
    || value === "requirement_intake"
    || value === "requirement_change_or_intake"
    || value === "spec_evolution"
    || value === "generate_ears"
    || value === "update_design"
    || value === "split_feature";
}

function isWorkbenchMessage(value: unknown): value is Record<string, unknown> & { command: string } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { command?: unknown }).command === "string";
}

function isQueueAction(value: unknown): value is QueueAction {
  return value === "enqueue"
    || value === "run_now"
    || value === "pause"
    || value === "resume"
    || value === "retry"
    || value === "cancel"
    || value === "skip"
    || value === "reprioritize"
    || value === "refresh"
    || value === "approve";
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
  return value === "accept" || value === "acceptForSession" || value === "decline" || value === "cancel";
}

function isControlledEntityType(value: unknown): value is ControlledCommandInput["entityType"] {
  return value === "project"
    || value === "feature"
    || value === "task"
    || value === "run"
    || value === "runner"
    || value === "review_item"
    || value === "rule"
    || value === "spec"
    || value === "cli_adapter"
    || value === "rpc_adapter"
    || value === "settings";
}

function isCommentThread(value: unknown): value is vscode.CommentThread {
  return typeof value === "object"
    && value !== null
    && "uri" in value
    && "range" in value
    && Array.isArray((value as { comments?: unknown }).comments)
    && ((value as unknown) as { comments: unknown[] }).comments.length > 0;
}

function workspaceRelativePath(fileName: string): string | undefined {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot || !fileName.startsWith(workspaceRoot)) return undefined;
  return fileName.slice(workspaceRoot.length).replace(/^[/\\]/, "").replaceAll("\\", "/");
}

function isSpecMarkdown(path: string): boolean {
  return path.endsWith(".md") && (path.startsWith("docs/") || path.startsWith(".agents/"));
}

function featureForPath(view: SpecDriveIdeView, path: string): SpecDriveIdeFeatureNode | undefined {
  const match = path.match(/^docs\/features\/([^/]+)\//);
  if (!match) return undefined;
  return view.features.find((feature) => feature.folder === match[1]);
}

function featureIdForPath(path: string): string | undefined {
  const match = path.match(/^docs\/features\/feat-(\d+)/i);
  return match ? `FEAT-${match[1]}` : undefined;
}

function hashText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function messageItem(id: string, label: string, description?: string): SpecExplorerItem {
  return { type: "root", id, label, description, children: [] };
}

function iconFor(element: SpecExplorerItem): vscode.ThemeIcon {
  if (element.type === "feature") return new vscode.ThemeIcon("symbol-folder");
  if (element.type === "document") return new vscode.ThemeIcon(element.exists ? "markdown" : "warning");
  if (element.type === "queue-item") return new vscode.ThemeIcon("debug-start");
  return new vscode.ThemeIcon("folder");
}

function diagnosticSeverity(severity: SpecDriveIdeDiagnostic["severity"]): vscode.DiagnosticSeverity {
  if (severity === "error") return vscode.DiagnosticSeverity.Error;
  if (severity === "warning") return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

function formatExecutionDetails(item: SpecDriveIdeQueueItem): string {
  const fields = item.executionId
    ? [
      ["Status", item.status],
      ["Operation", item.operation],
      ["Execution", item.executionId],
      ["Feature", item.featureId],
      ["Task", item.taskId],
      ["Adapter", item.adapter],
      ["Thread", item.threadId],
      ["Turn", item.turnId],
      ["Updated", item.updatedAt],
    ]
    : [
      ["Status", item.status],
      ["Schedule job type", item.jobType],
      ["Schedule action", item.operation],
      ["Scheduler job", item.schedulerJobId],
      ["Feature", item.featureId],
      ["Task", item.taskId],
      ["Adapter", item.adapter],
      ["Updated", item.updatedAt],
    ];
  return [
    "# SpecDrive Execution",
    "",
    ...fields
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([label, value]) => `- **${label}:** \`${value}\``),
    "",
    "## Summary",
    "",
    item.summary ?? "No summary recorded yet.",
    "",
  ].join("\n");
}

async function fetchExecutionDetail(item: SpecDriveIdeQueueItem): Promise<SpecDriveIdeExecutionDetail | SpecDriveIdeQueueItem> {
  if (!item.executionId) return item;
  const controlPlaneUrl = await ensureControlPlaneReady();
  const response = await fetchJson(new URL(`/ide/executions/${encodeURIComponent(item.executionId)}`, controlPlaneUrl));
  if (!response.ok) return item;
  return await response.json() as SpecDriveIdeExecutionDetail;
}

function configuredControlPlaneUrl(): string {
  return controlPlaneManager?.currentUrl() ?? configuredControlPlaneUrlFromSettings();
}

function configuredControlPlaneUrlFromSettings(): string {
  return extensionConfig("controlPlaneUrl", "http://127.0.0.1:43117");
}

async function ensureControlPlaneReady(): Promise<string> {
  return await controlPlaneManager?.ensureReady() ?? configuredControlPlaneUrl();
}

function extensionConfig<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration("specdrive").get(key, defaultValue);
}

async function openSpecWorkspaceOnStartup(provider: SpecExplorerProvider): Promise<void> {
  if (startupSpecWorkspaceOpened || !extensionConfig("openSpecWorkspaceOnStartup", false)) return;
  if (!provider.currentView()?.recognized) return;
  startupSpecWorkspaceOpened = true;
  await openSpecWorkspace(provider);
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", baseUrl));
    return response.ok;
  } catch {
    return false;
  }
}

async function isCompatibleControlPlane(baseUrl: string, workspaceRoot?: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", baseUrl));
    if (!response.ok) return false;
    const body = await response.json() as Record<string, unknown>;
    if (workspaceRoot && typeof body.artifactRoot === "string") {
      const expectedArtifactRoot = join(workspaceRoot, ".autobuild");
      if (normalizeFsPath(body.artifactRoot) !== normalizeFsPath(expectedArtifactRoot)) {
        return false;
      }
    }
    const capabilities = typeof body.capabilities === "object" && body.capabilities !== null
      ? body.capabilities as Record<string, unknown>
      : {};
    const actions = Array.isArray(capabilities.consoleCommandActions)
      ? capabilities.consoleCommandActions
      : [];
    return actions.includes("register_project");
  } catch {
    return false;
  }
}

function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

async function findFreePort(startPort: number): Promise<number> {
  const boundedStart = Math.min(Math.max(startPort, 1024), 65535);
  for (let port = boundedStart; port <= 65535; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port found at or above ${boundedStart}.`);
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function fetchJson(input: URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot reach SpecDrive Control Plane at ${input.origin}. Use serverMode=auto to start the bundled server, or update specdrive.controlPlaneUrl. Cause: ${cause}`);
  }
}
