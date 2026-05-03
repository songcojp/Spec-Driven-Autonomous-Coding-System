import { createHash } from "node:crypto";
import * as vscode from "vscode";

type SpecDriveIdeDocument = {
  kind: string;
  label: string;
  path: string;
  exists: boolean;
};

type SpecDriveIdeFeatureNode = {
  id: string;
  folder: string;
  title: string;
  status: string;
  priority?: string;
  dependencies: string[];
  blockedReasons: string[];
  nextAction?: string;
  documents: SpecDriveIdeDocument[];
  latestExecutionId?: string;
  latestExecutionStatus?: string;
  indexStatus?: "indexed" | "missing_from_index" | "missing_folder";
  tasks?: SpecDriveIdeTaskProjection[];
  taskParseBlockedReasons?: string[];
};

type SpecDriveIdeTaskProjection = {
  id: string;
  title: string;
  status: string;
  description?: string;
  verification?: string;
  line?: number;
};

type SpecDriveIdeQueueItem = {
  schedulerJobId?: string;
  executionId?: string;
  status: string;
  operation?: string;
  jobType?: string;
  featureId?: string;
  taskId?: string;
  adapter?: string;
  threadId?: string;
  turnId?: string;
  updatedAt?: string;
  summary?: string;
};

type SpecDriveIdeExecutionDetail = SpecDriveIdeQueueItem & {
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  rawLogs: Array<{ stdout: string; stderr: string; events: unknown[]; createdAt?: string }>;
  producedArtifacts: unknown[];
  diffSummary?: unknown;
  contractValidation?: unknown;
  outputSchema?: unknown;
  approvalRequests: unknown[];
};

type SpecDriveIdeDiagnostic = {
  path: string;
  severity: "error" | "warning" | "info";
  message: string;
  source: "workspace" | "spec-state" | "execution";
  featureId?: string;
  executionId?: string;
};

type SpecDriveIdeView = {
  recognized: boolean;
  workspaceRoot?: string;
  specRoot?: string;
  language?: string;
  project?: {
    id: string;
    name: string;
    targetRepoPath?: string;
  };
  activeAdapter?: {
    id: string;
    displayName: string;
    status: string;
  };
  documents: SpecDriveIdeDocument[];
  features: SpecDriveIdeFeatureNode[];
  queue: {
    groups: Record<string, SpecDriveIdeQueueItem[]>;
  };
  diagnostics: SpecDriveIdeDiagnostic[];
  missing: string[];
  factSources: string[];
  productConsole?: {
    defaultUrl: string;
    links: {
      workspace: string;
      queue: string;
    };
  };
};

type ControlledCommandInput = {
  action: string;
  entityType: "project" | "feature" | "task" | "run" | "runner" | "review_item" | "rule" | "spec" | "cli_adapter" | "settings";
  entityId: string;
  payload?: Record<string, unknown>;
  reason: string;
};

type QueueAction = "enqueue" | "run_now" | "pause" | "resume" | "retry" | "cancel" | "skip" | "reprioritize" | "refresh" | "approve";
type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

type IdeQueueCommandV1 = {
  schemaVersion: 1;
  ideCommandType: "queue_action";
  projectId?: string;
  workspaceRoot?: string;
  queueAction: QueueAction;
  entityType: "run" | "job";
  entityId: string;
  requestedBy: string;
  reason: string;
  payload?: Record<string, unknown>;
  approvalDecision?: ApprovalDecision;
};

type SpecChangeRequestIntent =
  | "clarification"
  | "requirement_intake"
  | "requirement_change_or_intake"
  | "spec_evolution"
  | "generate_ears"
  | "update_design"
  | "split_feature";

type SpecChangeRequestV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceRoot: string;
  source: {
    file: string;
    range: {
      startLine: number;
      endLine: number;
      startCharacter?: number;
      endCharacter?: number;
    };
    textHash: string;
  };
  intent: SpecChangeRequestIntent;
  comment: string;
  targetRequirementId?: string;
  traceability?: string[];
};

type SpecChangeCommandInput = {
  intent: SpecChangeRequestIntent;
  comment: string;
  targetRequirementId?: string;
  traceability?: string[];
  line?: number;
};

type SpecExplorerItem =
  | { type: "root"; id: string; label: string; description?: string; children: SpecExplorerItem[] }
  | { type: "document"; id: string; label: string; description?: string; path: string; exists: boolean }
  | { type: "feature"; id: string; label: string; description?: string; feature: SpecDriveIdeFeatureNode }
  | { type: "queue-item"; id: string; label: string; description?: string; item: SpecDriveIdeQueueItem };

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection("specdrive");
  context.subscriptions.push(diagnostics);
  const provider = new SpecExplorerProvider(diagnostics, context);
  context.subscriptions.push(vscode.window.createTreeView("specdrive.specExplorer", { treeDataProvider: provider }));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.refresh", () => provider.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.filterQueue", () => filterQueue(provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openProductConsole", (item: unknown) => openProductConsole(item, provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openExecutionWorkbench", () => openExecutionWorkbench(provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openSpecWorkspace", () => openSpecWorkspace(provider)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openFeatureSpec", (item: unknown) => openFeatureSpec(provider, item)));
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
  void provider.refresh();
}

export function deactivate(): void {
  return;
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
    const collapsible = "children" in element || element.type === "feature"
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    const treeItem = new vscode.TreeItem(element.label, collapsible);
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
  const controlPlaneUrl = configuredControlPlaneUrl();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const url = new URL("/ide/spec-tree", controlPlaneUrl);
  if (workspaceRoot) url.searchParams.set("workspaceRoot", workspaceRoot);
  const response = await fetchJson(url);
  if (!response.ok) {
    throw new Error(`SpecDrive request failed: ${response.status} ${response.statusText}`);
  }
  return await response.json() as SpecDriveIdeView;
}

async function runControlledCommand(input: unknown, provider: SpecExplorerProvider): Promise<void> {
  if (!isControlledCommandInput(input)) {
    await vscode.window.showErrorMessage("SpecDrive command input is invalid.");
    return;
  }
  try {
    const response = await postIdeCommand({
      ...input,
      requestedBy: "vscode-extension",
    });
    const status = typeof response.status === "string" ? response.status : "unknown";
    const executionId = typeof response.executionId === "string" ? ` execution=${response.executionId}` : "";
    await vscode.window.showInformationMessage(`SpecDrive command ${status}.${executionId}`);
    await provider.refresh();
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
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
  const controlPlaneUrl = configuredControlPlaneUrl();
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
  panel.webview.html = renderExecutionWebview(await fetchExecutionDetail(item.item));
}

async function openExecutionWorkbench(provider: SpecExplorerProvider): Promise<void> {
  const panel = vscode.window.createWebviewPanel("specdriveExecutionWorkbench", "Execution Workbench", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  const render = async (): Promise<void> => {
    await provider.refresh();
    const view = provider.currentView();
    const current = view ? currentExecutionItem(view) : undefined;
    const detail = current ? await fetchExecutionDetail(current) : undefined;
    panel.webview.html = renderExecutionWorkbenchWebview(view, detail);
  };
  panel.webview.onDidReceiveMessage((message: unknown) => handleWorkbenchMessage(message, provider, render));
  await render();
}

async function openSpecWorkspace(provider: SpecExplorerProvider): Promise<void> {
  const panel = vscode.window.createWebviewPanel("specdriveSpecWorkspace", "Spec Workspace", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  const render = async (): Promise<void> => {
    await provider.refresh();
    panel.webview.html = renderSpecWorkspaceWebview(provider.currentView());
  };
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (isWorkbenchMessage(message) && message.command === "specWorkspaceRequest" && typeof message.content === "string") {
      await submitSpecWorkspaceRequest(message.content, message.intent, provider);
      await render();
      return;
    }
    await handleWorkbenchMessage(message, provider, render);
  });
  await render();
}

async function openFeatureSpec(provider: SpecExplorerProvider, item?: unknown): Promise<void> {
  const panel = vscode.window.createWebviewPanel("specdriveFeatureSpec", "Feature Spec", vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  let selectedFeatureId = isFeatureItem(item) ? item.feature.id : undefined;
  const render = async (): Promise<void> => {
    await provider.refresh();
    const view = provider.currentView();
    if (!selectedFeatureId || !view?.features.some((feature) => feature.id === selectedFeatureId)) {
      selectedFeatureId = preferredFeature(view)?.id;
    }
    panel.webview.html = renderFeatureSpecWebview(view, selectedFeatureId);
  };
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    if (isWorkbenchMessage(message) && message.command === "selectFeature" && typeof message.featureId === "string") {
      selectedFeatureId = message.featureId;
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
    await handleWorkbenchMessage(message, provider, render);
  });
  await render();
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
    if (message.command === "queue" && isQueueAction(message.action) && typeof message.entityId === "string") {
      const payload = message.action === "reprioritize" ? await priorityPayload() : undefined;
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
  const fields = [
    ["Status", item.status],
    ["Operation", item.operation],
    ["Job type", item.jobType],
    ["Scheduler job", item.schedulerJobId],
    ["Execution", item.executionId],
    ["Feature", item.featureId],
    ["Task", item.taskId],
    ["Adapter", item.adapter],
    ["Thread", item.threadId],
    ["Turn", item.turnId],
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
  const controlPlaneUrl = configuredControlPlaneUrl();
  const response = await fetchJson(new URL(`/ide/executions/${encodeURIComponent(item.executionId)}`, controlPlaneUrl));
  if (!response.ok) return item;
  return await response.json() as SpecDriveIdeExecutionDetail;
}

function configuredControlPlaneUrl(): string {
  return vscode.workspace.getConfiguration("specdrive").get("controlPlaneUrl", "http://127.0.0.1:4317");
}

async function fetchJson(input: URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot reach SpecDrive Control Plane at ${input.origin}. Start it with npm run dev or update specdrive.controlPlaneUrl. Cause: ${cause}`);
  }
}

function renderExecutionWorkbenchWebview(
  view: SpecDriveIdeView | undefined,
  detail: SpecDriveIdeExecutionDetail | SpecDriveIdeQueueItem | undefined,
): string {
  const nonce = webviewNonce();
  const queue = view ? allQueueItems(view) : [];
  const grouped = view?.queue.groups ?? {};
  const blockers = queue.filter((item) => item.status === "blocked" || item.status === "approval_needed");
  return renderWorkbenchPage("Execution Workbench", nonce, `
    <section class="toolbar">
      ${commandButton("Start Auto Run", "controlled", { action: "auto_run", entityType: "runner", entityId: view?.project?.id ?? "workspace", reason: "Start auto run from Execution Workbench." })}
      ${queueButton("Run Now", queue.find((item) => item.status === "ready" || item.status === "queued"), "run_now")}
      ${queueButton("Pause", detail, "pause")}
      ${queueButton("Resume", detail, "resume")}
      ${queueButton("Retry", detail, "retry")}
      ${queueButton("Cancel", detail, "cancel")}
      ${queueButton("Skip", detail, "skip")}
      ${queueButton("Reprioritize", detail, "reprioritize")}
      ${queueButton("Enqueue", queue[0], "enqueue")}
      ${commandButton("Refresh", "refresh", {})}
    </section>
    <main class="grid execution-grid">
      <section class="panel span-5">
        <div class="panel-title"><h2>Job Queue</h2><span>${queue.length} jobs</span></div>
        ${["ready", "queued", "running", "approval_needed", "blocked", "failed", "completed"].map((status) => renderQueueGroup(status, grouped[status] ?? [])).join("")}
      </section>
      <section class="panel span-3">
        <div class="panel-title"><h2>Current Execution</h2><span>${escapeHtml(detail?.status ?? "none")}</span></div>
        ${detail ? executionFieldsHtml(detail) : emptyState("No active execution selected.")}
        <h3>Raw Log Refs</h3>
        ${renderRawLogRefs(detail)}
        <h3>Diff Summary</h3>
        ${compactJsonBlock("metadata" in (detail ?? {}) ? (detail as SpecDriveIdeExecutionDetail).diffSummary ?? null : null)}
        <h3>SkillOutputContractV1</h3>
        ${compactJsonBlock("metadata" in (detail ?? {}) ? (detail as SpecDriveIdeExecutionDetail).contractValidation ?? null : null)}
      </section>
      <section class="panel span-4">
        <div class="panel-title"><h2>Blockers & Approvals</h2><span>${blockers.length}</span></div>
        ${blockers.length === 0 ? emptyState("No blockers or approval requests.") : blockers.map(renderBlockerCard).join("")}
      </section>
      <section class="panel span-4">
        <div class="panel-title"><h2>Result Projection</h2><span>spec-state.json</span></div>
        <h3>Produced Artifacts</h3>
        ${compactJsonBlock("metadata" in (detail ?? {}) ? (detail as SpecDriveIdeExecutionDetail).producedArtifacts ?? [] : [])}
      </section>
    </main>
  `);
}

function renderSpecWorkspaceWebview(view: SpecDriveIdeView | undefined): string {
  const nonce = webviewNonce();
  const projectId = view?.project?.id ?? "workspace";
  const stages = specLifecycleStages(view);
  const active = stages.find((stage) => stage.active) ?? stages[0];
  return renderWorkbenchPage("Spec Workspace", nonce, `
    <section class="toolbar">
      ${commandButton("Spec Change", "openWorkbenchForm", { formMode: "specChange", intent: "requirement_change_or_intake" })}
      ${commandButton("Clarification", "openWorkbenchForm", { formMode: "specClarification", intent: "clarification" })}
      ${commandButton("Diagnostics & Blockers", "showDiagnostics", {})}
      ${commandButton("Refresh", "refresh", {})}
      <span id="workbench-status" class="status-text" role="status" aria-live="polite"></span>
    </section>
    ${renderWorkbenchInputForm()}
    <section class="stage-strip">
      ${stages.map((stage) => `
        <button class="stage ${stage.active ? "active" : ""}" data-command="selectSpecStage" data-stage-id="${escapeAttr(stage.id)}" aria-pressed="${stage.active ? "true" : "false"}">
          <span>${escapeHtml(stage.index)} · ${escapeHtml(stage.status)}</span>${escapeHtml(stage.label)}
        </button>
      `).join("")}
    </section>
    <main class="grid">
      <section class="panel span-12 spec-stage-panel">
        ${stages.map((stage) => renderSpecLifecycleDetail(stage, view, projectId, stage.id !== active.id)).join("")}
        ${renderGlobalDiagnosticsPanel(view)}
      </section>
    </main>
  `);
}

function renderFeatureSpecWebview(view: SpecDriveIdeView | undefined, selectedFeatureId: string | undefined): string {
  const nonce = webviewNonce();
  const features = view?.features ?? [];
  const selected = features.find((feature) => feature.id === selectedFeatureId) ?? preferredFeature(view);
  const groups = groupFeaturePanels(features);
  return renderWorkbenchPage("Feature Spec", nonce, `
    <section class="toolbar">
      <button class="view-toggle" data-command="toggleFeatureSpecView" data-view-mode="dependency" aria-pressed="false">Dependency Graph</button>
      ${commandButton("New Feature", "openWorkbenchForm", { formMode: "newFeature" })}
      ${commandButton("Refresh", "refresh", {})}
      ${selected ? commandButton("Schedule", "controlled", { action: "schedule_run", entityType: "feature", entityId: selected.id, reason: `Schedule ${selected.id} from Feature Spec Webview.` }) : ""}
      ${selected && isClarificationNeededFeature(selected) ? commandButton("Clarify", "openWorkbenchForm", { formMode: "clarify", featureId: selected.id }) : ""}
      <span id="workbench-status" class="status-text" role="status" aria-live="polite"></span>
    </section>
    ${renderWorkbenchInputForm()}
    <main id="feature-list-panel" class="feature-layout" data-view-panel="list">
      <section class="feature-board">
        ${groups.map((group) => renderFeaturePanel(group, selected?.id)).join("")}
      </section>
      <aside class="panel detail-panel">
        ${selected ? renderFeatureDetail(selected) : emptyState("No Feature Specs discovered.")}
      </aside>
    </main>
    <section id="dependency-graph-panel" class="panel dependency-panel hidden" data-view-panel="dependency">
      <div class="panel-title"><h2>Dependency Graph</h2><span>${features.length} Feature Specs</span><button class="dependency-toggle" data-command="toggleDependencyGraphBranches" data-expanded="true">Collapse All</button></div>
      ${renderDependencyGraph(features)}
    </section>
  `);
}

function renderExecutionWebview(item: SpecDriveIdeExecutionDetail | SpecDriveIdeQueueItem): string {
  const detail = "metadata" in item ? item : undefined;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px;line-height:1.45}
    code,pre{font-family:var(--vscode-editor-font-family)}
    pre{background:var(--vscode-textCodeBlock-background);padding:12px;overflow:auto}
  </style></head><body>
    <h1>SpecDrive Execution</h1>
    ${executionFieldsHtml(item)}
    <h2>Thread / Turn</h2>
    <ul><li>Thread: <code>${escapeHtml(item.threadId ?? "none")}</code></li><li>Turn: <code>${escapeHtml(item.turnId ?? "none")}</code></li></ul>
    <h2>Diff Summary</h2>
    ${jsonBlock(detail?.diffSummary ?? null)}
    <h2>Produced Artifacts</h2>
    ${jsonBlock(detail?.producedArtifacts ?? [])}
    <h2>Output Schema</h2>
    ${jsonBlock(detail?.outputSchema ?? null)}
    <h2>Contract Validation</h2>
    ${jsonBlock(detail?.contractValidation ?? detail?.metadata?.contractValidation ?? null)}
    <h2>Approval Requests</h2>
    ${jsonBlock(detail?.approvalRequests ?? [])}
    <h2>Raw Logs</h2>
    ${(detail?.rawLogs ?? []).map((log, index) => `<h3>Log ${index + 1}</h3><p>Stdout</p>${textBlock(log.stdout)}<p>Stderr</p>${textBlock(log.stderr)}`).join("")}
    <h2>Product Console</h2>
    <p><a href="http://127.0.0.1:5173/#runner">Open Runner Console</a></p>
  </body></html>`;
}

function renderWorkbenchPage(title: string, nonce: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
    :root{color-scheme:dark;--accent:var(--vscode-focusBorder,#22d3ee);--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--muted:var(--vscode-descriptionForeground,#9ca3af);--panel:var(--vscode-sideBar-background,#11181d);--border:var(--vscode-panel-border,#2b3942)}
    *{box-sizing:border-box}body{margin:0;padding:14px 16px 18px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);line-height:1.45}
    h1{font-size:22px;margin:4px 0 12px;font-weight:650}h2{font-size:14px;margin:0;font-weight:650}h3{font-size:12px;margin:14px 0 6px;color:var(--muted);text-transform:uppercase}
    button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:1px solid var(--border);border-radius:4px;padding:6px 10px;cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}
    [hidden]{display:none!important}.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}.view-toggle{min-width:132px}.status-text{color:var(--muted);font-size:12px;min-height:18px}.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:10px}.span-3{grid-column:span 3}.span-4{grid-column:span 4}.span-5{grid-column:span 5}.span-8{grid-column:span 8}.span-12{grid-column:span 12}
    .panel{border:1px solid var(--border);background:var(--panel);border-radius:6px;padding:10px;min-width:0}.panel-title{display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:8px}.panel-title span,.muted{color:var(--muted)}
    .queue-group{margin:8px 0;border:1px solid var(--border);border-radius:5px;overflow:hidden}.queue-head{display:flex;justify-content:space-between;padding:6px 8px;background:var(--vscode-list-hoverBackground)}.queue-item,.row{display:grid;grid-template-columns:1.2fr .8fr .8fr auto;gap:8px;align-items:center;padding:6px 8px;border-top:1px solid var(--border);font-size:12px}.row{grid-template-columns:1fr auto}
    .badge{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:999px;padding:2px 7px;font-size:11px}.ok{color:var(--ok)}.warning,.warn{color:var(--warn)}.error,.bad{color:var(--bad)}.info,.draft{color:var(--accent)}
    pre{max-height:180px;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:8px;border-radius:4px;font-family:var(--vscode-editor-font-family);font-size:11px}.issue{border:1px solid var(--border);border-radius:4px;padding:8px;margin:6px 0}.issue span{color:var(--muted)}
    .stage-strip{display:grid;grid-template-columns:repeat(12,minmax(80px,1fr));gap:6px;margin-bottom:10px}.stage{background:transparent;color:var(--vscode-foreground);min-height:54px}.stage span{display:block;color:var(--accent)}.stage.active{border-color:var(--accent);background:var(--vscode-list-activeSelectionBackground)}.spec-stage-panel{width:100%;min-height:320px}
    .hidden{display:none!important}.workbench-form{margin-bottom:10px}.workbench-form textarea{width:100%;min-height:96px;resize:vertical;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--border);border-radius:4px;padding:8px;font:inherit}.workbench-form-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}.dependency-panel{margin-bottom:10px}.dependency-tree,.dependency-tree ul{list-style:none;margin:0;padding-left:18px}.dependency-tree{padding-left:0}.dependency-tree li{position:relative;margin:4px 0;padding-left:14px}.dependency-tree li::before{content:"";position:absolute;left:0;top:13px;width:9px;border-top:1px solid var(--border)}.dependency-tree ul{border-left:1px solid var(--border);margin-left:8px}.dependency-branch>summary{list-style:none;cursor:pointer}.dependency-branch>summary::-webkit-details-marker{display:none}.dependency-branch>summary::before{content:"+";display:inline-flex;width:16px;color:var(--muted)}.dependency-branch[open]>summary::before{content:"-"}.dependency-leaf{margin-left:16px}.dependency-node{display:inline-flex;align-items:center;gap:7px;min-height:26px;border:1px solid var(--border);border-radius:5px;background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:4px 7px}.dependency-node button{padding:2px 6px}.dependency-node.missing{color:var(--warn)}.dependency-node .muted{font-size:11px}
    .feature-layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:10px}.feature-board{display:flex;flex-direction:column;gap:10px;min-width:0}.feature-panel{border:1px solid var(--border);border-radius:6px;background:var(--panel);min-width:0;overflow:hidden}.feature-panel summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;cursor:pointer;background:var(--vscode-list-hoverBackground);user-select:none;list-style:none}.feature-panel summary::-webkit-details-marker{display:none}.feature-panel summary::before{content:"+";display:inline-flex;width:16px;color:var(--muted);font-weight:650}.feature-panel[open] summary::before{content:"-"}.feature-panel summary h2{display:flex;gap:8px;align-items:center;margin-right:auto}.feature-panel summary span{color:var(--muted);font-size:12px}.feature-panel-items{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;align-items:stretch;padding:9px;overflow:visible}.feature-panel-items .muted{padding:2px}.feature-card{width:100%;min-width:0;min-height:154px;text-align:left;background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1px solid var(--border);border-radius:6px;padding:9px;position:relative}.feature-card.selected{border-color:var(--accent);background:var(--vscode-list-activeSelectionBackground);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 65%,transparent)}.feature-card.selected::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--accent)}.feature-card header{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}.metric{display:grid;grid-template-columns:1fr auto;gap:6px;font-size:12px;color:var(--muted)}.bar{grid-column:1/-1;height:5px;background:var(--vscode-progressBar-background,#334155);border-radius:999px;overflow:hidden}.bar span{display:block;height:100%;background:var(--accent)}.detail-panel{position:sticky;top:12px;height:calc(100vh - 32px);overflow:auto}.task-row{border:1px solid var(--border);border-radius:5px;padding:7px;margin:6px 0}.task-row>div{display:flex;justify-content:space-between;gap:8px}.task-row p{margin:6px 0;color:var(--muted)}.task-row code{display:block;white-space:pre-wrap;color:var(--accent);font-family:var(--vscode-editor-font-family);font-size:11px}
    @media (max-width:980px){.grid,.feature-layout{display:block}.panel,.feature-panel{margin-bottom:10px}.detail-panel{position:static;height:auto}.stage-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.feature-panel-items{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}}
  </style></head><body><h1>${escapeHtml(title)}</h1>${body}<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const setWorkbenchStatus = (message) => {
      const status = document.getElementById("workbench-status");
      if (status) status.textContent = message;
    };
    const openWorkbenchForm = (mode, featureId, intent) => {
      const form = document.getElementById("workbench-form");
      const title = document.getElementById("workbench-form-title");
      const subtitle = document.getElementById("workbench-form-subtitle");
      const input = document.getElementById("workbench-form-input");
      if (!form || !title || !subtitle || !input) return;
      form.hidden = false;
      form.dataset.formMode = mode;
      form.dataset.featureId = featureId || "";
      form.dataset.intent = intent || "";
      const copy = {
        clarify: ["Clarify Feature", "Clarification", "Enter clarification content."],
        specChange: ["Spec Change", "Global Spec request", "Enter the Spec change or new requirement."],
        specClarification: ["Clarification", "Global Spec request", "Enter the clarification question or decision."],
        newFeature: ["New Feature", "Add or change", "Enter add-or-change content."],
      }[mode] || ["New Feature", "Add or change", "Enter add-or-change content."];
      title.textContent = copy[0];
      subtitle.textContent = copy[1];
      input.value = "";
      input.focus();
      setWorkbenchStatus(copy[2]);
    };
    const closeWorkbenchForm = () => {
      const form = document.getElementById("workbench-form");
      if (form) form.hidden = true;
    };
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-command]");
      if (!target) return;
      if (target.closest(".dependency-branch > summary")) event.preventDefault();
      const payload = {...target.dataset};
      if (payload.command === "selectFeature") payload.featureId = target.dataset.featureId;
      if (payload.command === "openWorkbenchForm") {
        openWorkbenchForm(payload.formMode || "newFeature", target.dataset.featureId, target.dataset.intent);
        return;
      }
      if (payload.command === "closeWorkbenchForm") {
        closeWorkbenchForm();
        setWorkbenchStatus("");
        return;
      }
      if (payload.command === "submitWorkbenchForm") {
        const form = document.getElementById("workbench-form");
        const input = document.getElementById("workbench-form-input");
        const content = input?.value?.trim() || "";
        if (!content) {
          setWorkbenchStatus("Input content is required.");
          return;
        }
        if (form?.dataset.formMode === "clarify") {
          setWorkbenchStatus("Submitting clarification...");
          vscode.postMessage({command:"reviewFeature", featureId: form.dataset.featureId, comment: content});
        } else if (form?.dataset.formMode === "specChange" || form?.dataset.formMode === "specClarification") {
          setWorkbenchStatus("Submitting Spec Workspace request...");
          vscode.postMessage({command:"specWorkspaceRequest", intent: form.dataset.intent, content});
        } else {
          setWorkbenchStatus("Submitting add-or-change request...");
          vscode.postMessage({command:"newFeature", content});
        }
        closeWorkbenchForm();
        return;
      }
      if (payload.command === "refresh") {
        setWorkbenchStatus("Refreshing...");
        vscode.postMessage(payload);
        return;
      }
      if (payload.command === "toggleFeatureSpecView") {
        const mode = target.dataset.viewMode === "dependency" ? "dependency" : "list";
        document.querySelectorAll("[data-view-panel]").forEach((panel) => {
          panel.classList.toggle("hidden", panel.dataset.viewPanel !== mode);
        });
        target.dataset.viewMode = mode === "dependency" ? "list" : "dependency";
        target.textContent = mode === "dependency" ? "Feature List" : "Dependency Graph";
        target.setAttribute("aria-pressed", mode === "dependency" ? "true" : "false");
        return;
      }
      if (payload.command === "selectSpecStage") {
        const stageId = target.dataset.stageId;
        document.querySelectorAll("[data-workspace-panel]").forEach((entry) => entry.hidden = entry.dataset.stageDetail !== stageId);
        document.querySelectorAll(".stage[data-stage-id]").forEach((entry) => {
          const selected = entry.dataset.stageId === stageId;
          entry.classList.toggle("active", selected);
          entry.setAttribute("aria-pressed", selected ? "true" : "false");
        });
        return;
      }
      if (payload.command === "showDiagnostics") {
        document.querySelectorAll("[data-workspace-panel]").forEach((entry) => entry.hidden = entry.id !== "spec-diagnostics-panel");
        document.querySelectorAll(".stage[data-stage-id]").forEach((entry) => {
          entry.classList.remove("active");
          entry.setAttribute("aria-pressed", "false");
        });
        setWorkbenchStatus("Showing diagnostics and blockers.");
        return;
      }
      if (payload.command === "toggleDependencyGraphBranches") {
        const expanded = target.dataset.expanded !== "true";
        document.querySelectorAll("#dependency-graph-panel .dependency-branch").forEach((branch) => {
          branch.open = expanded;
        });
        target.dataset.expanded = expanded ? "true" : "false";
        target.textContent = expanded ? "Collapse All" : "Expand All";
        return;
      }
      if (payload.command === "controlled") {
        setWorkbenchStatus("Running command...");
        vscode.postMessage(payload);
        return;
      }
      vscode.postMessage(payload);
    });
  </script></body></html>`;
}

function commandButton(label: string, command: string, data: Record<string, string | undefined>): string {
  const attrs = Object.entries({ command, ...data })
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `data-${kebab(key)}="${escapeAttr(String(value))}"`)
    .join(" ");
  return `<button ${attrs}>${escapeHtml(label)}</button>`;
}

function renderWorkbenchInputForm(): string {
  return `<section id="workbench-form" class="panel workbench-form" hidden data-form-mode="newFeature">
    <div class="panel-title"><h2 id="workbench-form-title">New Feature</h2><span id="workbench-form-subtitle">Add or change</span></div>
    <textarea id="workbench-form-input" aria-label="Feature input"></textarea>
    <div class="workbench-form-actions">
      ${commandButton("Cancel", "closeWorkbenchForm", {})}
      ${commandButton("Submit", "submitWorkbenchForm", {})}
    </div>
  </section>`;
}

function queueButton(label: string, item: SpecDriveIdeQueueItem | undefined, action: QueueAction): string {
  const entityId = item?.executionId ?? item?.schedulerJobId;
  if (!entityId) return `<button disabled>${escapeHtml(label)}</button>`;
  return commandButton(label, "queue", {
    action,
    entityType: item?.executionId ? "run" : "job",
    entityId,
    reason: `${label} from Execution Workbench.`,
  });
}

function renderQueueGroup(status: string, items: SpecDriveIdeQueueItem[]): string {
  return `<div class="queue-group"><div class="queue-head"><strong class="${statusClass(status)}">${escapeHtml(status)}</strong><span>${items.length}</span></div>
    ${items.map((item) => `<div class="queue-item"><span>${escapeHtml(item.featureId ?? item.taskId ?? item.operation ?? "execution")}</span><span>${escapeHtml(item.operation ?? item.jobType ?? "-")}</span><span>${escapeHtml(item.adapter ?? "-")}</span>${queueButton("Open", item, "run_now")}</div>`).join("") || `<div class="queue-item"><span class="muted">No items</span></div>`}
  </div>`;
}

function renderBlockerCard(item: SpecDriveIdeQueueItem): string {
  return `<div class="issue ${statusClass(item.status)}"><strong>${escapeHtml(item.featureId ?? item.executionId ?? item.schedulerJobId ?? "approval")}</strong><br>
    <span>${escapeHtml(item.summary ?? item.operation ?? item.status)}</span>
    <div class="toolbar">${queueButton("Accept", item, "approve").replace("data-action=\"approve\"", "data-action=\"approve\" data-approval-decision=\"accept\"")}${queueButton("Decline", item, "approve").replace("data-action=\"approve\"", "data-action=\"approve\" data-approval-decision=\"decline\"")}${queueButton("Retry", item, "retry")}</div>
  </div>`;
}

function renderRawLogRefs(item: SpecDriveIdeExecutionDetail | SpecDriveIdeQueueItem | undefined): string {
  if (!item || !("rawLogs" in item) || item.rawLogs.length === 0) return emptyState("No raw log references.");
  return item.rawLogs.map((log, index) => `<div class="row"><span>Log ${index + 1}</span><span>${escapeHtml(log.createdAt ?? "recorded")}</span></div>`).join("");
}

type SpecLifecycleStage = {
  id: "project-init" | "requirement-intake" | "feature-split";
  index: string;
  label: string;
  status: string;
  active: boolean;
  description: string;
  documentKinds: string[];
  steps: Array<{ label: string; status: string }>;
  actions: Array<{ label: string; action: string; reason: string }>;
};

function specLifecycleStages(view: SpecDriveIdeView | undefined): SpecLifecycleStage[] {
  const docs = new Set((view?.documents ?? []).filter((document) => document.exists).map((document) => document.kind));
  const hasProjectDocs = docs.has("prd") || docs.has("requirements") || docs.has("hld") || (view?.recognized ?? false);
  const hasRequirementDocs = docs.has("prd") || docs.has("requirements") || docs.has("ears") || docs.has("feature-requirements");
  const hasFeatureSpecs = (view?.features.length ?? 0) > 0;
  const activeId: SpecLifecycleStage["id"] = !hasProjectDocs
    ? "project-init"
    : !hasRequirementDocs
      ? "requirement-intake"
      : "feature-split";
  const stageStatus = (id: SpecLifecycleStage["id"], ready: boolean): string =>
    id === activeId ? (ready ? "Active" : "Blocked") : ready ? "Ready" : "Not Started";
  return [
    {
      id: "project-init",
      index: "1",
      label: "Project Initialization",
      status: stageStatus("project-init", hasProjectDocs),
      active: activeId === "project-init",
      description: "Recognize the project, repository, Spec protocol, constitution, memory, and workspace health before intake begins.",
      documentKinds: ["constitution", "memory", "readme"],
      steps: [
        { label: "Project context", status: view?.project?.id ? "Ready" : "Blocked" },
        { label: "Workspace root", status: view?.workspaceRoot ? "Ready" : "Blocked" },
        { label: "Spec protocol", status: view?.recognized ? "Ready" : "Blocked" },
      ],
      actions: [
        { label: "Check Project Health", action: "check_project_health", reason: "Check project initialization from Spec Workspace lifecycle." },
      ],
    },
    {
      id: "requirement-intake",
      index: "2",
      label: "Requirement Intake",
      status: stageStatus("requirement-intake", hasRequirementDocs),
      active: activeId === "requirement-intake",
      description: "Scan PR, RP, PRD, EARS, requirements, HLD, design, Feature Spec, tasks, and index documents as the source pool for requirement flow.",
      documentKinds: ["prd", "requirements", "ears", "feature-requirements", "hld", "design", "tasks", "readme"],
      steps: [
        { label: "Spec source scan", status: (view?.documents.length ?? 0) > 0 ? "Ready" : "Not Started" },
        { label: "PRD / requirements", status: hasRequirementDocs ? "Ready" : "Draft" },
        { label: "Clarification and quality check", status: (view?.diagnostics.length ?? 0) === 0 ? "Ready" : "Active" },
      ],
      actions: [
        { label: "Scan Sources", action: "scan_spec_sources", reason: "Scan Spec sources from Requirement Intake lifecycle." },
        { label: "Upload PRD", action: "upload_prd_source", reason: "Upload PRD source from Requirement Intake lifecycle." },
        { label: "Generate EARS", action: "generate_ears", reason: "Generate EARS requirements from Requirement Intake lifecycle." },
      ],
    },
    {
      id: "feature-split",
      index: "3",
      label: "Feature Split",
      status: stageStatus("feature-split", hasFeatureSpecs),
      active: activeId === "feature-split",
      description: "Turn accepted requirements into Feature Specs, planning outputs, task slices, and runnable Feature execution queue entries.",
      documentKinds: ["feature-requirements", "feature-design", "feature-tasks", "tasks", "hld", "design"],
      steps: [
        { label: "HLD / design", status: docs.has("hld") || docs.has("design") ? "Ready" : "Draft" },
        { label: "Feature Spec directory", status: hasFeatureSpecs ? "Ready" : "Not Started" },
        { label: "Feature task slices", status: view?.features.some((feature) => (feature.tasks?.length ?? 0) > 0) ? "Ready" : "Draft" },
      ],
      actions: [
        { label: "Generate HLD", action: "generate_hld", reason: "Generate HLD from Feature Split lifecycle." },
        { label: "Generate UI Spec", action: "generate_ui_spec", reason: "Generate UI Spec from Feature Split lifecycle." },
        { label: "Split Feature Specs", action: "split_feature_specs", reason: "Split Feature Specs from Feature Split lifecycle." },
        { label: "Push Feature Pool", action: "push_feature_spec_pool", reason: "Push Feature Spec Pool from Feature Split lifecycle." },
      ],
    },
  ];
}

function documentList(documents: SpecDriveIdeDocument[]): string {
  if (documents.length === 0) return emptyState("No source documents discovered.");
  return documents.map((document) => `<div class="row"><span>${escapeHtml(document.label)}</span><button data-command="openDocument" data-path="${escapeAttr(document.path)}">${document.exists ? "Open" : "Missing"}</button></div>`).join("");
}

function renderSpecLifecycleDetail(stage: SpecLifecycleStage, view: SpecDriveIdeView | undefined, projectId: string, hidden: boolean): string {
  const documents = filterLifecycleDocuments(view?.documents ?? [], stage.documentKinds);
  const diagnostics = filterLifecycleDiagnostics(view?.diagnostics ?? [], documents, stage);
  return `<div data-workspace-panel="stage" data-stage-detail="${escapeAttr(stage.id)}" ${hidden ? "hidden" : ""}>
    <div class="panel-title"><h2>${escapeHtml(stage.label)}</h2><span class="${statusClass(stage.status)}">${escapeHtml(stage.status)}</span></div>
    <p class="muted">${escapeHtml(stage.description)}</p>
    <h3>Stage Steps</h3>
    ${stage.steps.map((step) => `<div class="row"><span>${escapeHtml(step.label)}</span><strong class="${statusClass(step.status)}">${escapeHtml(step.status)}</strong></div>`).join("")}
    <h3>Diagnostics & Blockers</h3>
    ${diagnostics.length === 0 ? emptyState("No active diagnostics or blockers.") : diagnostics.slice(0, 8).map(renderLifecycleDiagnostic).join("")}
    <h3>Spec Documents</h3>
    ${documentList(documents)}
    <h3>Stage Actions</h3>
    <div class="toolbar">${stage.actions.map((action) => commandButton(action.label, "controlled", { action: action.action, entityType: "spec", entityId: projectId, reason: action.reason })).join("")}</div>
  </div>`;
}

function renderGlobalDiagnosticsPanel(view: SpecDriveIdeView | undefined): string {
  const diagnostics = view?.diagnostics ?? [];
  return `<div id="spec-diagnostics-panel" data-workspace-panel="diagnostics" hidden>
    <div class="panel-title"><h2>Diagnostics & Blockers</h2><span>${diagnostics.length} active</span></div>
    ${diagnostics.length === 0 ? emptyState("No active diagnostics or blockers.") : diagnostics.map(renderLifecycleDiagnostic).join("")}
  </div>`;
}

function filterLifecycleDocuments(documents: SpecDriveIdeDocument[], kinds: string[]): SpecDriveIdeDocument[] {
  const accepted = new Set(kinds);
  const filtered = documents.filter((document) => accepted.has(document.kind) || kinds.some((kind) => document.kind.includes(kind)));
  return filtered.length > 0 ? filtered : documents.slice(0, 8);
}

function filterLifecycleDiagnostics(
  diagnostics: SpecDriveIdeDiagnostic[],
  documents: SpecDriveIdeDocument[],
  stage: SpecLifecycleStage,
): SpecDriveIdeDiagnostic[] {
  if (diagnostics.length === 0) return [];
  const documentPaths = new Set(documents.map((document) => document.path));
  const stageKinds = new Set(stage.documentKinds);
  const matching = diagnostics.filter((diagnostic) =>
    documentPaths.has(diagnostic.path)
    || stage.documentKinds.some((kind) => diagnostic.path.toLowerCase().includes(kind.replace("feature-", "")))
    || (diagnostic.featureId && stageKinds.has("feature-requirements")));
  return matching.length > 0 ? matching : diagnostics.slice(0, 5);
}

function renderLifecycleDiagnostic(diagnostic: SpecDriveIdeDiagnostic): string {
  return `<div class="issue ${statusClass(diagnostic.severity)}">
    <strong>${escapeHtml(diagnostic.path)}</strong>
    <br><span>${escapeHtml(diagnostic.message)}</span>
    <div class="toolbar"><button data-command="openDocument" data-path="${escapeAttr(diagnostic.path)}">Open</button></div>
  </div>`;
}

function preferredWorkspaceRequestSource(view: SpecDriveIdeView): string {
  return view.documents.find((document) => document.exists && document.path === "docs/README.md")?.path
    ?? view.documents.find((document) => document.exists && document.kind === "readme")?.path
    ?? view.documents.find((document) => document.exists)?.path
    ?? "docs/README.md";
}

type DependencyTreeNode = {
  id: string;
  feature?: SpecDriveIdeFeatureNode;
  missing?: boolean;
};

function renderDependencyGraph(features: SpecDriveIdeFeatureNode[]): string {
  if (features.length === 0) return emptyState("No Feature Specs discovered.");
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const childIdsByDependency = new Map<string, string[]>();
  const missingDependencyIds = new Set<string>();
  for (const feature of features) {
    for (const dependencyId of feature.dependencies) {
      childIdsByDependency.set(dependencyId, [...(childIdsByDependency.get(dependencyId) ?? []), feature.id]);
      if (!byId.has(dependencyId)) missingDependencyIds.add(dependencyId);
    }
  }
  const roots: DependencyTreeNode[] = [
    ...Array.from(missingDependencyIds).sort().map((id) => ({ id, missing: true })),
    ...features.filter((feature) => feature.dependencies.length === 0).map((feature) => ({ id: feature.id, feature })),
  ];
  const effectiveRoots = roots.length > 0 ? roots : features.map((feature) => ({ id: feature.id, feature }));
  return `<ul class="dependency-tree">${effectiveRoots.map((node) => renderDependencyNode(node, byId, childIdsByDependency, new Set(), 0)).join("")}</ul>`;
}

function renderDependencyNode(
  node: DependencyTreeNode,
  byId: Map<string, SpecDriveIdeFeatureNode>,
  childIdsByDependency: Map<string, string[]>,
  path: Set<string>,
  depth: number,
): string {
  const feature = node.feature ?? byId.get(node.id);
  const children = (childIdsByDependency.get(node.id) ?? [])
    .filter((childId) => !path.has(childId))
    .map((childId) => ({ id: childId, feature: byId.get(childId) }));
  const nextPath = new Set(path);
  nextPath.add(node.id);
  const label = feature
    ? `<button data-command="selectFeature" data-feature-id="${escapeAttr(feature.id)}">${escapeHtml(feature.id)}</button><span>${escapeHtml(feature.title)}</span><span class="${statusClass(feature.status)}">${escapeHtml(feature.status)}</span>`
    : `<strong>${escapeHtml(node.id)}</strong><span class="muted">missing dependency</span>`;
  const nodeHtml = `<span class="dependency-node ${feature ? "" : "missing"}">${label}</span>`;
  if (children.length === 0) return `<li><div class="dependency-leaf">${nodeHtml}</div></li>`;
  const open = depth < 2 ? " open" : "";
  return `<li><details class="dependency-branch"${open}><summary>${nodeHtml}</summary><ul>${children.map((child) => renderDependencyNode(child, byId, childIdsByDependency, nextPath, depth + 1)).join("")}</ul></details></li>`;
}

type FeaturePanelGroup = {
  id: "blocked" | "in-process" | "todo" | "ready" | "done";
  title: string;
  statuses: string;
  features: SpecDriveIdeFeatureNode[];
  open: boolean;
};

function renderFeaturePanel(group: FeaturePanelGroup, selectedFeatureId: string | undefined): string {
  return `<details class="feature-panel" data-panel="${escapeAttr(group.id)}" ${group.open ? "open" : ""}>
    <summary><h2>${escapeHtml(group.title)} <span>${group.features.length}</span></h2><span>${escapeHtml(group.statuses)}</span></summary>
    <div class="feature-panel-items">
      ${group.features.length === 0 ? emptyState("No Feature Specs in this category.") : group.features.map((feature) => renderFeatureCard(feature, feature.id === selectedFeatureId)).join("")}
    </div>
  </details>`;
}

function renderFeatureCard(feature: SpecDriveIdeFeatureNode, selected: boolean): string {
  const taskCount = feature.tasks?.length ?? 0;
  const doneTasks = (feature.tasks ?? []).filter((task) => ["done", "completed", "x"].includes(task.status.toLowerCase())).length;
  const progress = taskCount > 0
    ? Math.round((doneTasks / taskCount) * 100)
    : feature.latestExecutionStatus === "completed" ? 100 : feature.latestExecutionStatus === "running" ? 70 : feature.status === "ready" ? 60 : 30;
  return `<button class="feature-card ${selected ? "selected" : ""}" data-command="selectFeature" data-feature-id="${escapeAttr(feature.id)}" ${selected ? "aria-current=\"true\"" : ""}>
    <header><strong>${escapeHtml(feature.id)}</strong><span class="${statusClass(feature.status)}">${escapeHtml(feature.status)}</span></header>
    <div>${escapeHtml(feature.title)}</div>
    <div class="metric"><span>Task Progress</span><strong>${progress}%</strong><div class="bar"><span style="width:${progress}%"></span></div></div>
    <div class="metric"><span>Execution State</span><strong>${escapeHtml(feature.latestExecutionStatus ?? "Not Started")}</strong></div>
    <div class="metric"><span>Tasks</span><strong>${doneTasks}/${taskCount}</strong></div>
    <div class="metric"><span>Next Action</span><strong>${escapeHtml(feature.nextAction ?? "None")}</strong></div>
  </button>`;
}

function renderFeatureDetail(feature: SpecDriveIdeFeatureNode): string {
  return `<div class="panel-title"><h2>${escapeHtml(feature.id)}</h2><span class="${statusClass(feature.status)}">${escapeHtml(feature.status)}</span></div>
    <h3>${escapeHtml(feature.title)}</h3>
    <div class="row"><span>Priority</span><strong>${escapeHtml(feature.priority ?? "-")}</strong></div>
    <div class="row"><span>Latest Run</span><strong>${escapeHtml(feature.latestExecutionId ?? "-")}</strong></div>
    <div class="row"><span>Execution</span><strong>${escapeHtml(feature.latestExecutionStatus ?? "Not Started")}</strong></div>
    <h3>Artifacts</h3>
    ${documentList(feature.documents)}
    <h3>Tasks</h3>
    ${renderFeatureTasks(feature)}
    <h3>Acceptance</h3>
    ${["Requirements traced", "Task queue visible", "Execution state persisted", "Adapter failures handled"].map((item, index) => `<div class="row"><span>${escapeHtml(item)}</span><strong class="${index < 3 ? "ok" : "draft"}">${index < 3 ? "Passed" : "Draft"}</strong></div>`).join("")}
    <h3>Blockers</h3>
    ${feature.blockedReasons.length === 0 ? emptyState("No blockers.") : feature.blockedReasons.map((reason) => `<div class="issue bad">${escapeHtml(reason)}</div>`).join("")}
    <h3>Traceability</h3>
    <div class="row"><span>Dependencies</span><strong>${escapeHtml(feature.dependencies.join(", ") || "-")}</strong></div>
    <div class="toolbar">${commandButton("Schedule", "controlled", { action: "schedule_run", entityType: "feature", entityId: feature.id, reason: `Schedule ${feature.id} from Feature Detail.` })}${isClarificationNeededFeature(feature) ? commandButton("Clarify", "openWorkbenchForm", { formMode: "clarify", featureId: feature.id }) : ""}</div>`;
}

function renderFeatureTasks(feature: SpecDriveIdeFeatureNode): string {
  const tasks = feature.tasks ?? [];
  const blockers = feature.taskParseBlockedReasons ?? [];
  if (tasks.length === 0) {
    return blockers.length > 0
      ? blockers.map((reason) => `<div class="issue bad">${escapeHtml(reason)}</div>`).join("")
      : emptyState("No tasks parsed.");
  }
  return `${tasks.map((task) => `<div class="task-row">
    <div><strong>${escapeHtml(task.id)}</strong> ${escapeHtml(task.title)}</div>
    <span class="${statusClass(task.status)}">${escapeHtml(task.status)}</span>
    ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
    ${task.verification ? `<code>${escapeHtml(task.verification)}</code>` : ""}
  </div>`).join("")}${blockers.map((reason) => `<div class="issue warn">${escapeHtml(reason)}</div>`).join("")}`;
}

function allQueueItems(view: SpecDriveIdeView): SpecDriveIdeQueueItem[] {
  return Object.values(view.queue.groups).flat();
}

function currentExecutionItem(view: SpecDriveIdeView): SpecDriveIdeQueueItem | undefined {
  const items = allQueueItems(view);
  return items.find((item) => item.status === "running")
    ?? items.find((item) => item.status === "approval_needed")
    ?? items.find((item) => item.status === "queued")
    ?? items[0];
}

function preferredFeature(view: SpecDriveIdeView | undefined): SpecDriveIdeFeatureNode | undefined {
  return view?.features.find((feature) => feature.status === "in_execution" || feature.latestExecutionStatus === "running")
    ?? view?.features[0];
}

function groupFeaturePanels(features: SpecDriveIdeFeatureNode[]): FeaturePanelGroup[] {
  const blocked: SpecDriveIdeFeatureNode[] = [];
  const inProcess: SpecDriveIdeFeatureNode[] = [];
  const todo: SpecDriveIdeFeatureNode[] = [];
  const ready: SpecDriveIdeFeatureNode[] = [];
  const done: SpecDriveIdeFeatureNode[] = [];
  for (const feature of features) {
    if (isDoneFeature(feature)) {
      done.push(feature);
    } else if (isReadyFeature(feature)) {
      ready.push(feature);
    } else if (isBlockedFeature(feature)) {
      blocked.push(feature);
    } else if (isInProcessFeature(feature)) {
      inProcess.push(feature);
    } else {
      todo.push(feature);
    }
  }
  return [
    { id: "blocked", title: "Blocked", statuses: "Blocked", features: blocked, open: true },
    { id: "in-process", title: "In-Process", statuses: "In process, running", features: inProcess, open: true },
    { id: "todo", title: "Todo", statuses: "Todo, planning, draft", features: todo, open: true },
    { id: "ready", title: "Ready", statuses: "Ready", features: ready, open: true },
    { id: "done", title: "Done", statuses: "Done", features: done, open: false },
  ];
}

function isBlockedFeature(feature: SpecDriveIdeFeatureNode): boolean {
  const status = normalizedFeatureStatus(feature);
  return feature.blockedReasons.length > 0 || status === "blocked" || status === "block";
}

function isInProcessFeature(feature: SpecDriveIdeFeatureNode): boolean {
  const status = normalizedFeatureStatus(feature);
  const executionStatus = (feature.latestExecutionStatus ?? "").toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  return status === "in process"
    || status === "in progress"
    || status === "in execution"
    || status === "running"
    || executionStatus === "running"
    || executionStatus === "in process"
    || executionStatus === "in progress";
}

function isReadyFeature(feature: SpecDriveIdeFeatureNode): boolean {
  return normalizedFeatureStatus(feature) === "ready";
}

function isDoneFeature(feature: SpecDriveIdeFeatureNode): boolean {
  const status = normalizedFeatureStatus(feature);
  return status === "done" || status === "delivered" || status === "completed";
}

function isReviewNeededFeature(feature: SpecDriveIdeFeatureNode): boolean {
  const status = normalizedFeatureStatus(feature);
  return status === "need review" || status === "review needed" || status === "review";
}

function isClarificationNeededFeature(feature: SpecDriveIdeFeatureNode): boolean {
  return isReviewNeededFeature(feature) || isBlockedFeature(feature);
}

function normalizedFeatureStatus(feature: SpecDriveIdeFeatureNode): string {
  return (feature.blockedReasons.length > 0 ? "blocked" : feature.status).toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
}

function preferredFeatureReviewSource(feature: SpecDriveIdeFeatureNode): string {
  return feature.documents.find((document) => document.kind === "feature-requirements" && document.exists)?.path
    ?? feature.documents.find((document) => document.exists)?.path
    ?? "docs/features/README.md";
}

function statusClass(status: string | undefined): string {
  const value = (status ?? "").toLowerCase();
  if (["ready", "completed", "delivered", "passed", "available", "success"].some((token) => value.includes(token))) return "ok";
  if (["blocked", "failed", "error", "decline"].some((token) => value.includes(token))) return "bad";
  if (["approval", "review", "warning", "draft", "require"].some((token) => value.includes(token))) return "warn";
  return "info";
}

function compactJsonBlock(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return textBlock(json.length > 1200 ? `${json.slice(0, 1200)}\n...` : json);
}

function emptyState(message: string): string {
  return `<p class="muted">${escapeHtml(message)}</p>`;
}

function webviewNonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function executionFieldsHtml(item: SpecDriveIdeQueueItem): string {
  const fields = [
    ["Status", item.status],
    ["Operation", item.operation],
    ["Job type", item.jobType],
    ["Scheduler job", item.schedulerJobId],
    ["Execution", item.executionId],
    ["Feature", item.featureId],
    ["Task", item.taskId],
    ["Adapter", item.adapter],
    ["Updated", item.updatedAt],
  ];
  return `<ul>${fields
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([label, value]) => `<li>${escapeHtml(String(label))}: <code>${escapeHtml(String(value))}</code></li>`)
    .join("")}</ul><h2>Summary</h2><p>${escapeHtml(item.summary ?? "No summary recorded yet.")}</p>`;
}

function jsonBlock(value: unknown): string {
  return textBlock(JSON.stringify(value, null, 2));
}

function textBlock(value: string): string {
  return `<pre>${escapeHtml(value)}</pre>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("\"", "&quot;");
}
