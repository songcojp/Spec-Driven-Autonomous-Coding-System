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
};

type ControlledCommandInput = {
  action: string;
  entityType: "project" | "feature" | "task" | "run" | "runner" | "review_item" | "rule" | "spec" | "cli_adapter" | "settings";
  entityId: string;
  payload?: Record<string, unknown>;
  reason: string;
};

type SpecChangeRequestIntent =
  | "clarification"
  | "requirement_intake"
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
  const provider = new SpecExplorerProvider(diagnostics);
  context.subscriptions.push(vscode.window.createTreeView("specdrive.specExplorer", { treeDataProvider: provider }));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.refresh", () => provider.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openItem", (item: unknown) => openItem(item)));
  context.subscriptions.push(vscode.commands.registerCommand("specdrive.openExecution", (item: unknown) => openExecution(item)));
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

  constructor(private readonly diagnostics: vscode.DiagnosticCollection) {}

  async refresh(): Promise<void> {
    try {
      const view = await fetchSpecDriveView();
      this.view = view;
      this.items = buildItems(view);
      updateDiagnostics(this.diagnostics, view);
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
    treeItem.contextValue = element.type;
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
  const controlPlaneUrl = vscode.workspace.getConfiguration("specdrive").get("controlPlaneUrl", "http://127.0.0.1:4000");
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const url = new URL("/ide/spec-tree", controlPlaneUrl);
  if (workspaceRoot) url.searchParams.set("workspaceRoot", workspaceRoot);
  const response = await fetch(url);
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

async function postIdeCommand(input: (ControlledCommandInput & { requestedBy: string }) | SpecChangeRequestV1): Promise<Record<string, unknown>> {
  const controlPlaneUrl = vscode.workspace.getConfiguration("specdrive").get("controlPlaneUrl", "http://127.0.0.1:4000");
  const response = await fetch(new URL("/ide/commands", controlPlaneUrl), {
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

function buildItems(view: SpecDriveIdeView): SpecExplorerItem[] {
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
  const queueGroups = Object.entries(view.queue.groups).map(([status, items]) => ({
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
      description: `${queueGroups.reduce((total, group) => total + Number(group.description ?? 0), 0)}`,
      children: queueGroups,
    },
  ];
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
  const details = formatExecutionDetails(item.item);
  const document = await vscode.workspace.openTextDocument({ content: details, language: "markdown" });
  await vscode.window.showTextDocument(document);
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
    || value === "spec_evolution"
    || value === "generate_ears"
    || value === "update_design"
    || value === "split_feature";
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
