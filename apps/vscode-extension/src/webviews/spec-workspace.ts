import type { SpecDriveIdeDiagnostic, SpecDriveIdeDocument, SpecDriveIdeView } from "../types";
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

export function renderSpecWorkspaceWebview(view: SpecDriveIdeView | undefined): string {
  const nonce = webviewNonce();
  const projectId = view?.project?.id ?? "workspace";
  const stages = specLifecycleStages(view);
  const active = stages.find((stage) => stage.active) ?? stages[0];
  return renderWorkbenchPage("Spec Workspace", nonce, `
    <section class="toolbar">
      ${commandButton("Spec Change", "openWorkbenchForm", { formMode: "specChange", intent: "requirement_change_or_intake" })}
      ${commandButton("Clarification", "openWorkbenchForm", { formMode: "specClarification", intent: "clarification" })}
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
      <button class="stage" data-command="showDiagnostics" aria-pressed="false">
        <span>4 · ${view?.diagnostics.length ?? 0} active</span>Diagnostics & Blockers
      </button>
    </section>
    <main class="grid">
      <section class="panel span-12 spec-stage-panel">
        ${stages.map((stage) => renderSpecLifecycleDetail(stage, view, projectId, stage.id !== active.id)).join("")}
        ${renderGlobalDiagnosticsPanel(view)}
      </section>
    </main>
  `);
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

function renderSpecLifecycleDetail(stage: SpecLifecycleStage, view: SpecDriveIdeView | undefined, projectId: string, hidden: boolean): string {
  const documents = filterLifecycleDocuments(view?.documents ?? [], stage.documentKinds);
  return `<div data-workspace-panel="stage" data-stage-detail="${escapeAttr(stage.id)}" ${hidden ? "hidden" : ""}>
    <div class="panel-title"><h2>${escapeHtml(stage.label)}</h2><span class="${statusClass(stage.status)}">${escapeHtml(stage.status)}</span></div>
    <p class="muted">${escapeHtml(stage.description)}</p>
    <h3>Stage Steps</h3>
    ${stage.steps.map((step) => `<div class="row"><span>${escapeHtml(step.label)}</span><strong class="${statusClass(step.status)}">${escapeHtml(step.status)}</strong></div>`).join("")}
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

function renderLifecycleDiagnostic(diagnostic: SpecDriveIdeDiagnostic): string {
  return `<div class="issue ${statusClass(diagnostic.severity)}">
    <strong>${escapeHtml(diagnostic.path)}</strong>
    <br><span>${escapeHtml(diagnostic.message)}</span>
    <div class="toolbar"><button data-command="openDocument" data-path="${escapeAttr(diagnostic.path)}">Open</button></div>
  </div>`;
}

export function preferredWorkspaceRequestSource(view: SpecDriveIdeView): string {
  return view.documents.find((document) => document.exists && document.path === "docs/README.md")?.path
    ?? view.documents.find((document) => document.exists && document.kind === "readme")?.path
    ?? view.documents.find((document) => document.exists)?.path
    ?? "docs/README.md";
}
