import { createHash } from "node:crypto";
import * as vscode from "vscode";
import type {
  ApprovalDecision,
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
} from "./types";
import { currentExecutionItem, renderExecutionWebview, renderExecutionWorkbenchWebview } from "./webviews/execution";
import { preferredFeature, preferredFeatureReviewSource, renderFeatureSpecWebview } from "./webviews/feature-spec";
import { preferredWorkspaceRequestSource, renderSpecWorkspaceWebview } from "./webviews/spec-workspace";

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
