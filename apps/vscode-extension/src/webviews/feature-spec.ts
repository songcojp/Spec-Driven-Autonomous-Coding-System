import type { SpecDriveIdeFeatureNode, SpecDriveIdeView } from "../types";
import {
  commandButton,
  documentList,
  emptyState,
  escapeAttr,
  escapeHtml,
  renderWorkbenchInputForm,
  renderWorkbenchPage,
  statusClass,
  webviewNonce,
} from "./shared";

export function renderFeatureSpecWebview(view: SpecDriveIdeView | undefined, selectedFeatureId: string | undefined): string {
  const nonce = webviewNonce();
  const features = view?.features ?? [];
  const selected = features.find((feature) => feature.id === selectedFeatureId) ?? preferredFeature(view);
  const groups = groupFeaturePanels(features);
  const projectId = view?.project?.id;
  return renderWorkbenchPage("Feature Spec", nonce, `
    <section class="toolbar">
      <button class="view-toggle" data-command="toggleFeatureSpecView" data-view-mode="dependency" aria-pressed="false">Dependency Graph</button>
      ${executionPreferenceControls(view)}
      ${features.length > 0 ? commandButton("Schedule Selected", "scheduleSelectedFeatures", { projectId }) : ""}
      ${commandButton("New Feature", "openWorkbenchForm", { formMode: "newFeature" })}
      ${commandButton("Refresh", "refresh", {})}
      ${selected ? scheduleFeatureButton("Schedule Current", selected, projectId, "Feature Spec Webview") : ""}
      ${selected && isClarificationNeededFeature(selected) ? commandButton("Clarify", "openWorkbenchForm", { formMode: "clarify", featureId: selected.id }) : ""}
      <span id="workbench-status" class="status-text" role="status" aria-live="polite"></span>
    </section>
    ${renderWorkbenchInputForm()}
    <main id="feature-list-panel" class="feature-layout" data-view-panel="list">
      <section class="feature-board">
        ${groups.map((group) => renderFeaturePanel(group, selected?.id)).join("")}
      </section>
      <aside class="panel detail-panel">
        ${selected ? renderFeatureDetail(selected, projectId) : emptyState("No Feature Specs discovered.")}
      </aside>
    </main>
    <section id="dependency-graph-panel" class="panel dependency-panel hidden" data-view-panel="dependency">
      <div class="panel-title"><h2>Dependency Graph</h2><span>${features.length} Feature Specs</span><button class="dependency-toggle" data-command="toggleDependencyGraphBranches" data-expanded="true">Collapse All</button></div>
      ${renderDependencyGraph(features)}
    </section>
  `);
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
  return `<article class="feature-card ${selected ? "selected" : ""}" ${selected ? "aria-current=\"true\"" : ""}>
    <header><strong>${escapeHtml(feature.id)}</strong><span class="${statusClass(feature.status)}">${escapeHtml(feature.status)}</span></header>
    <div>${escapeHtml(feature.title)}</div>
    <div class="metric"><span>Task Progress</span><strong>${progress}%</strong><div class="bar"><span style="width:${progress}%"></span></div></div>
    <div class="metric"><span>Execution State</span><strong>${escapeHtml(feature.latestExecutionStatus ?? "Not Started")}</strong></div>
    <div class="metric"><span>Tasks</span><strong>${doneTasks}/${taskCount}</strong></div>
    <div class="metric"><span>Next Action</span><strong>${escapeHtml(feature.nextAction ?? "None")}</strong></div>
    <div class="feature-card-actions">
      <label class="feature-select"><input type="checkbox" data-feature-select="${escapeAttr(feature.id)}" ${selected ? "checked" : ""}> Select</label>
      <button data-command="selectFeature" data-feature-id="${escapeAttr(feature.id)}">Open</button>
    </div>
  </article>`;
}

function renderFeatureDetail(feature: SpecDriveIdeFeatureNode, projectId?: string): string {
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
    <div class="toolbar">${scheduleFeatureButton("Schedule", feature, projectId, "Feature Detail")}${isClarificationNeededFeature(feature) ? commandButton("Clarify", "openWorkbenchForm", { formMode: "clarify", featureId: feature.id }) : ""}</div>`;
}

function scheduleFeatureButton(label: string, feature: SpecDriveIdeFeatureNode, projectId: string | undefined, source: string): string {
  return commandButton(label, "controlled", {
    action: "schedule_run",
    entityType: "feature",
    entityId: feature.id,
    projectId,
    featureId: feature.id,
    reason: `Schedule ${feature.id} from ${source}.`,
  });
}

function executionPreferenceControls(view: SpecDriveIdeView | undefined): string {
  const options = view?.executionPreferenceOptions;
  if (!options) return "";
  const activeMode = options.active.runMode ?? "cli";
  const activeAdapter = options.active.adapterId ?? (activeMode === "rpc" ? options.rpcAdapters[0]?.id : options.cliAdapters[0]?.id) ?? "";
  const adapters = [
    ...options.cliAdapters.map((adapter) => ({ ...adapter, mode: "cli" as const })),
    ...options.rpcAdapters.map((adapter) => ({ ...adapter, mode: "rpc" as const })),
  ];
  return `<label class="inline-field">Run Mode
      <select id="job-run-mode" aria-label="Feature schedule run mode">
        <option value="cli"${activeMode === "cli" ? " selected" : ""}>CLI</option>
        <option value="rpc"${activeMode === "rpc" ? " selected" : ""}>RPC</option>
      </select>
    </label>
    <label class="inline-field">Provider
      <select id="job-adapter-id" aria-label="Feature schedule provider adapter">
        ${adapters.map((adapter) => `<option value="${escapeAttr(adapter.id)}" data-run-mode="${adapter.mode}"${adapter.id === activeAdapter ? " selected" : ""}>${escapeHtml(`${adapter.mode.toUpperCase()}: ${adapter.displayName}`)}</option>`).join("")}
      </select>
    </label>`;
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

export function preferredFeature(view: SpecDriveIdeView | undefined): SpecDriveIdeFeatureNode | undefined {
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

export function isClarificationNeededFeature(feature: SpecDriveIdeFeatureNode): boolean {
  return isReviewNeededFeature(feature) || isBlockedFeature(feature);
}

function normalizedFeatureStatus(feature: SpecDriveIdeFeatureNode): string {
  return (feature.blockedReasons.length > 0 ? "blocked" : feature.status).toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
}

export function preferredFeatureReviewSource(feature: SpecDriveIdeFeatureNode): string {
  return feature.documents.find((document) => document.kind === "feature-requirements" && document.exists)?.path
    ?? feature.documents.find((document) => document.exists)?.path
    ?? "docs/features/README.md";
}
