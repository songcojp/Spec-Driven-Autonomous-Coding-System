import type { QueueAction, SpecDriveIdeDocument, SpecDriveIdeExecutionDetail, SpecDriveIdeQueueItem } from "../types";

export function renderWorkbenchPage(title: string, nonce: string, body: string, cspSource?: string): string {
  const imgSource = cspSource ? `${cspSource} data:` : "data:";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
    :root{color-scheme:dark;--accent:var(--vscode-focusBorder,#22d3ee);--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;--muted:var(--vscode-descriptionForeground,#9ca3af);--panel:var(--vscode-sideBar-background,#11181d);--border:var(--vscode-panel-border,#2b3942)}
    *{box-sizing:border-box}body{margin:0;padding:14px 16px 18px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);line-height:1.45}
    h1{font-size:22px;margin:4px 0 12px;font-weight:650}h2{font-size:14px;margin:0;font-weight:650}h3{font-size:12px;margin:14px 0 6px;color:var(--muted);text-transform:uppercase}
    button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:1px solid var(--border);border-radius:4px;padding:6px 10px;cursor:pointer;max-width:100%;overflow-wrap:anywhere}button:hover{background:var(--vscode-button-hoverBackground)}button:disabled,button:disabled:hover{color:var(--vscode-disabledForeground,var(--muted));background:var(--vscode-button-secondaryBackground,var(--vscode-input-background));border-color:var(--vscode-disabledForeground,var(--border));opacity:.55;cursor:not-allowed}
    [hidden]{display:none!important}.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}.inline-field{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:12px}.inline-field select{min-height:30px;max-width:220px;background:var(--vscode-dropdown-background,var(--vscode-input-background));color:var(--vscode-dropdown-foreground,var(--vscode-input-foreground));border:1px solid var(--border);border-radius:4px;padding:4px 7px}.view-toggle{min-width:132px}.status-text{color:var(--muted);font-size:12px;min-height:18px}.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:10px}.span-3{grid-column:span 3}.span-4{grid-column:span 4}.span-5{grid-column:span 5}.span-8{grid-column:span 8}.span-12{grid-column:span 12}
    .panel{border:1px solid var(--border);background:var(--panel);border-radius:6px;padding:10px;min-width:0}.panel-title,.section-title{display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:8px}.panel-title h2,.section-title h2{min-width:0;overflow-wrap:anywhere}.panel-title span,.section-title span,.muted{color:var(--muted)}.section-title{border-top:1px solid var(--border);padding-top:12px;margin-top:14px}.selected-title{align-items:flex-start}.selected-title>div:first-child{min-width:0}.title-actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;min-width:min(100%,360px)}.title-actions button{padding:4px 7px;font-size:12px}
    .execution-layout{display:grid;grid-template-columns:minmax(280px,38%) minmax(0,1fr);gap:10px;align-items:start}.execution-queue-column,.current-selected-column{min-width:0}.current-selected-column{max-height:calc(100vh - 92px);overflow:auto}
    .queue-group{margin:8px 0;border:1px solid var(--border);border-radius:5px;overflow:hidden}.queue-head{display:flex;justify-content:space-between;padding:6px 8px;background:var(--vscode-list-hoverBackground)}.queue-item,.row{display:grid;grid-template-columns:1.2fr .8fr .8fr auto;gap:8px;align-items:center;padding:6px 8px;border-top:1px solid var(--border);font-size:12px;min-width:0}.queue-item.selected{background:var(--vscode-list-activeSelectionBackground);box-shadow:inset 3px 0 0 var(--accent)}.row{grid-template-columns:minmax(0,1fr) minmax(0,max-content)}.row>*{min-width:0;overflow-wrap:anywhere}.row code{white-space:pre-wrap;overflow-wrap:anywhere}
    .badge{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:999px;padding:2px 7px;font-size:11px;max-width:100%;overflow-wrap:anywhere}.ok{color:var(--ok)}.warning,.warn{color:var(--warn)}.error,.bad{color:var(--bad)}.info,.draft{color:var(--accent)}
    pre{max-height:180px;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:8px;border-radius:4px;font-family:var(--vscode-editor-font-family);font-size:11px}.issue{border:1px solid var(--border);border-radius:4px;padding:8px;margin:6px 0}.issue span{color:var(--muted)}
    .result-summary{display:grid;gap:7px;margin-bottom:8px}.result-status{display:flex;gap:8px;align-items:flex-start;min-width:0}.result-status strong{min-width:0;overflow-wrap:anywhere}.chip-row{display:flex;gap:6px;flex-wrap:wrap}.result-group{border-top:1px solid var(--border);padding-top:4px;margin-top:6px}.compact-list{margin:0;padding-left:16px}.compact-list li{margin:2px 0}.artifact-table{width:100%;border-collapse:collapse;font-size:12px}.artifact-table th,.artifact-table td{border-top:1px solid var(--border);padding:5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}.artifact-table th{color:var(--muted);font-weight:650}.artifact-table code{white-space:pre-wrap}
    .stage-strip{display:grid;grid-template-columns:repeat(12,minmax(80px,1fr));gap:6px;margin-bottom:10px}.stage{background:transparent;color:var(--vscode-foreground);min-height:54px}.stage span{display:block;color:var(--accent)}.stage.active{border-color:var(--accent);background:var(--vscode-list-activeSelectionBackground)}.spec-stage-panel{width:100%;min-height:320px}
    .concept-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.concept-card{padding:0;text-align:left;background:var(--vscode-editor-background);color:var(--vscode-foreground);overflow:hidden}.concept-card img{display:block;width:100%;height:96px;object-fit:cover;background:var(--vscode-editor-background);border-bottom:1px solid var(--border)}.concept-card span{display:block;padding:7px 8px;color:var(--muted);font-size:12px}.concept-modal{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:rgba(0,0,0,.72);padding:18px}.concept-modal[hidden]{display:none!important}.concept-dialog{width:min(1100px,96vw);max-height:94vh;border:1px solid var(--border);border-radius:6px;background:var(--vscode-editor-background);overflow:hidden}.concept-dialog header{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border)}.concept-dialog img{display:block;width:100%;max-height:calc(94vh - 54px);object-fit:contain;background:#000}
    .hidden{display:none!important}.workbench-form{margin-bottom:10px}.workbench-form textarea,.settings-editor{width:100%;max-width:100%;min-height:96px;resize:vertical;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--border);border-radius:4px;padding:8px;font:inherit}.settings-editor{min-height:280px;font-family:var(--vscode-editor-font-family);font-size:12px}.settings-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))}.settings-grid .span-6{grid-column:auto}.settings-grid .settings-facts{grid-column:1/-1}.workbench-form-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}.dependency-panel{margin-bottom:10px}.dependency-tree,.dependency-tree ul{list-style:none;margin:0;padding-left:18px}.dependency-tree{padding-left:0}.dependency-tree li{position:relative;margin:4px 0;padding-left:14px}.dependency-tree li::before{content:"";position:absolute;left:0;top:13px;width:9px;border-top:1px solid var(--border)}.dependency-tree ul{border-left:1px solid var(--border);margin-left:8px}.dependency-branch>summary{list-style:none;cursor:pointer}.dependency-branch>summary::-webkit-details-marker{display:none}.dependency-branch>summary::before{content:"+";display:inline-flex;width:16px;color:var(--muted)}.dependency-branch[open]>summary::before{content:"-"}.dependency-leaf{margin-left:16px}.dependency-node{display:inline-flex;align-items:center;gap:7px;min-height:26px;border:1px solid var(--border);border-radius:5px;background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:4px 7px}.dependency-node button{padding:2px 6px}.dependency-node.missing{color:var(--warn)}.dependency-node .muted{font-size:11px}
    .feature-layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:10px}.feature-board{display:flex;flex-direction:column;gap:10px;min-width:0}.feature-panel{border:1px solid var(--border);border-radius:6px;background:var(--panel);min-width:0;overflow:hidden}.feature-panel summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;cursor:pointer;background:var(--vscode-list-hoverBackground);user-select:none;list-style:none}.feature-panel summary::-webkit-details-marker{display:none}.feature-panel summary::before{content:"+";display:inline-flex;width:16px;color:var(--muted);font-weight:650}.feature-panel[open] summary::before{content:"-"}.feature-panel summary h2{display:flex;gap:8px;align-items:center;margin-right:auto}.feature-panel summary span{color:var(--muted);font-size:12px}.feature-panel-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),280px));justify-content:start;gap:8px;align-items:stretch;padding:9px;overflow:visible}.feature-panel-items .muted{padding:2px}.feature-card{width:100%;min-width:0;min-height:154px;text-align:left;background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1px solid var(--border);border-radius:6px;padding:9px;position:relative}.feature-card.selected{border-color:var(--accent);background:var(--vscode-list-activeSelectionBackground);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 65%,transparent)}.feature-card.selected::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--accent)}.feature-card header{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}.feature-card-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}.feature-select{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:12px}.feature-select input{margin:0}.metric{display:grid;grid-template-columns:1fr auto;gap:6px;font-size:12px;color:var(--muted)}.bar{grid-column:1/-1;height:5px;background:var(--vscode-progressBar-background,#334155);border-radius:999px;overflow:hidden}.bar span{display:block;height:100%;background:var(--accent)}.detail-panel{position:sticky;top:12px;height:calc(100vh - 32px);overflow:auto}.task-row{border:1px solid var(--border);border-radius:5px;padding:7px;margin:6px 0}.task-row>div{display:flex;justify-content:space-between;gap:8px}.task-row p{margin:6px 0;color:var(--muted)}.task-row code{display:block;white-space:pre-wrap;color:var(--accent);font-family:var(--vscode-editor-font-family);font-size:11px}
    @media (max-width:980px){.grid,.feature-layout{display:block}.panel,.feature-panel{margin-bottom:10px}.detail-panel{position:static;height:auto}.stage-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.feature-panel-items{grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),260px))}}
  </style></head><body><h1>${escapeHtml(title)}</h1>${body}<div id="concept-modal" class="concept-modal" hidden><div class="concept-dialog" role="dialog" aria-modal="true" aria-labelledby="concept-modal-title"><header><strong id="concept-modal-title">UI Concept</strong><button data-command="closeConceptImage" aria-label="Close">Close</button></header><img id="concept-modal-image" alt=""></div></div><script nonce="${nonce}">
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
    const selectedExecutionPreference = () => {
      const adapterSelect = document.getElementById("job-adapter-id");
      const selected = adapterSelect?.selectedOptions?.[0] || adapterSelect?.options?.[adapterSelect.selectedIndex];
      return selected ? {adapterId: selected.value, source: "job"} : undefined;
    };
    const scheduleRunPayload = (payload, executionPreference) => {
      if (payload.action !== "schedule_run") return executionPreference ? {executionPreference} : undefined;
      const result = {
        mode: "manual",
        operation: "feature_execution",
        requestedAction: "feature_execution",
      };
      if (payload.projectId) result.projectId = payload.projectId;
      if (payload.featureId || payload.entityType === "feature") result.featureId = payload.featureId || payload.entityId;
      if (payload.taskId || payload.entityType === "task") result.taskId = payload.taskId || payload.entityId;
      if (executionPreference) result.executionPreference = executionPreference;
      return result;
    };
    const selectedFeatureIds = () => {
      return Array.from(document.querySelectorAll("[data-feature-select]:checked"))
        .map((entry) => entry.dataset.featureSelect)
        .filter(Boolean);
    };
    document.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-feature-select]");
      if (!checkbox) return;
      const card = checkbox.closest("[data-feature-card]");
      const selected = Boolean(checkbox.checked);
      if (card) {
        card.classList.toggle("selected", selected);
        card.setAttribute("aria-selected", selected ? "true" : "false");
      }
    });
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-command]");
      if (!target) return;
      if (target.closest(".dependency-branch > summary")) event.preventDefault();
      const payload = {...target.dataset};
      if (payload.command === "selectFeature") payload.featureId = target.dataset.featureId;
      if (payload.command === "selectQueueItem") {
        setWorkbenchStatus("Selected task " + (target.dataset.entityId || "unknown") + ".");
        vscode.postMessage(payload);
        return;
      }
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
      if (payload.command === "openConceptImage") {
        const modal = document.getElementById("concept-modal");
        const image = document.getElementById("concept-modal-image");
        const title = document.getElementById("concept-modal-title");
        if (modal && image && title) {
          image.src = target.dataset.imageSrc || "";
          image.alt = target.dataset.imageTitle || "UI Concept";
          title.textContent = target.dataset.imageTitle || "UI Concept";
          modal.hidden = false;
        }
        return;
      }
      if (payload.command === "closeConceptImage") {
        const modal = document.getElementById("concept-modal");
        if (modal) modal.hidden = true;
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
      if (payload.command === "scheduleSelectedFeatures") {
        const featureIds = selectedFeatureIds();
        if (featureIds.length === 0) {
          setWorkbenchStatus("Select at least one Feature Spec.");
          return;
        }
        setWorkbenchStatus("Scheduling " + featureIds.length + " Feature Spec" + (featureIds.length === 1 ? "" : "s") + "...");
        vscode.postMessage({
          command: "scheduleFeatures",
          featureIds,
          projectId: payload.projectId,
          executionPreference: selectedExecutionPreference(),
        });
        return;
      }
      if (payload.command === "controlled") {
        const executionPreference = selectedExecutionPreference();
        if (payload.action === "schedule_run" || payload.action === "start_auto_run") payload.payload = scheduleRunPayload(payload, executionPreference);
        setWorkbenchStatus("Running command...");
        vscode.postMessage(payload);
        return;
      }
      if (payload.command === "settingsCommand") {
        const editor = document.getElementById(payload.editorId || "");
        setWorkbenchStatus("Applying settings command...");
        vscode.postMessage({...payload, configText: editor?.value || ""});
        return;
      }
      if (payload.command === "loadSettingsPreset") {
        const editor = document.getElementById(payload.editorId || "");
        if (editor) editor.value = target.dataset.presetJson || "";
        setWorkbenchStatus("Preset loaded into editor.");
        return;
      }
      if (payload.command === "queue") {
        const executionPreference = selectedExecutionPreference();
        if (executionPreference && (payload.action === "enqueue" || payload.action === "run_now")) {
          payload.payload = {executionPreference};
        }
      }
      vscode.postMessage(payload);
    });
  </script></body></html>`;
}

export function commandButton(label: string, command: string, data: Record<string, string | undefined>): string {
  const attrs = Object.entries({ command, ...data })
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `data-${kebab(key)}="${escapeAttr(String(value))}"`)
    .join(" ");
  return `<button ${attrs}>${escapeHtml(label)}</button>`;
}

export function renderWorkbenchInputForm(): string {
  return `<section id="workbench-form" class="panel workbench-form" hidden data-form-mode="newFeature">
    <div class="panel-title"><h2 id="workbench-form-title">New Feature</h2><span id="workbench-form-subtitle">Add or change</span></div>
    <textarea id="workbench-form-input" aria-label="Feature input"></textarea>
    <div class="workbench-form-actions">
      ${commandButton("Cancel", "closeWorkbenchForm", {})}
      ${commandButton("Submit", "submitWorkbenchForm", {})}
    </div>
  </section>`;
}

export function queueButton(label: string, item: SpecDriveIdeQueueItem | undefined, action: QueueAction): string {
  const entityId = item?.executionId ?? item?.schedulerJobId;
  if (!entityId) return `<button disabled>${escapeHtml(label)}</button>`;
  return commandButton(label, "queue", {
    action,
    entityType: item?.executionId ? "run" : "job",
    entityId,
    reason: `${label} from Execution Workbench.`,
  });
}

export function renderQueueGroup(status: string, items: SpecDriveIdeQueueItem[], selectedKey?: string): string {
  return `<div class="queue-group"><div class="queue-head"><strong class="${statusClass(status)}">${escapeHtml(status)}</strong><span>${items.length}</span></div>
    ${items.map((item) => {
      const key = queueItemKey(item);
      const selected = Boolean(selectedKey && key === selectedKey);
      return `<div class="queue-item${selected ? " selected" : ""}"><span>${escapeHtml(item.featureId ?? item.taskId ?? item.operation ?? "execution")}</span><span>${escapeHtml(item.operation ?? item.jobType ?? "-")}</span><span>${escapeHtml(item.adapter ?? "-")}</span>${queueSelectButton(item, selected)}</div>`;
    }).join("") || `<div class="queue-item"><span class="muted">No items</span></div>`}
  </div>`;
}

export function queueItemKey(item: SpecDriveIdeQueueItem | undefined): string | undefined {
  const entityId = item?.executionId ?? item?.schedulerJobId;
  if (!entityId) return undefined;
  return `${item?.executionId ? "run" : "job"}:${entityId}`;
}

function queueSelectButton(item: SpecDriveIdeQueueItem, selected?: boolean): string {
  const entityId = item.executionId ?? item.schedulerJobId;
  if (!entityId) return `<button disabled>Select</button>`;
  return commandButton(selected ? "Selected" : "Select", "selectQueueItem", {
    entityType: item.executionId ? "run" : "job",
    entityId,
  });
}

export function renderBlockerCard(item: SpecDriveIdeQueueItem): string {
  return `<div class="issue ${statusClass(item.status)}"><strong>${escapeHtml(item.featureId ?? item.executionId ?? item.schedulerJobId ?? "approval")}</strong><br>
    <span>${escapeHtml(item.summary ?? item.operation ?? item.status)}</span>
    <div class="toolbar">${queueButton("Accept", item, "approve").replace("data-action=\"approve\"", "data-action=\"approve\" data-approval-decision=\"accept\"")}${queueButton("Decline", item, "approve").replace("data-action=\"approve\"", "data-action=\"approve\" data-approval-decision=\"decline\"")}${queueButton("Retry", item, "retry")}</div>
  </div>`;
}

export function renderRawLogRefs(item: SpecDriveIdeExecutionDetail | SpecDriveIdeQueueItem | undefined): string {
  if (!item || !("rawLogs" in item)) return emptyState("No raw log references.");
  const refs = item.rawLogRefs ?? [];
  if (refs.length > 0) {
    return refs.map((ref, index) => {
      const label = rawLogRefLabel(ref, index);
      const open = isOpenableRawLogRef(ref)
        ? commandButton("Open", "openRawLogRef", { path: ref })
        : `<span class="muted">stored ref</span>`;
      return `<div class="row"><span><code>${escapeHtml(label)}</code></span>${open}</div>`;
    }).join("");
  }
  if (item.rawLogs.length === 0) return emptyState("No raw log references.");
  return item.rawLogs.map((log, index) => `<div class="row"><span>Log ${index + 1}</span><span>${escapeHtml(log.createdAt ?? "recorded")}</span></div>`).join("");
}

function isOpenableRawLogRef(ref: string): boolean {
  return ref.includes("/") || ref.includes("\\") || ref.startsWith(".");
}

function rawLogRefLabel(ref: string, index: number): string {
  const normalized = ref.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.length > 0 ? segments.slice(-3).join("/") : `Log ${index + 1}`;
}

export function statusClass(status: string | undefined): string {
  const value = (status ?? "").toLowerCase();
  if (["ready", "completed", "delivered", "passed", "available", "success"].some((token) => value.includes(token))) return "ok";
  if (["blocked", "failed", "error", "decline"].some((token) => value.includes(token))) return "bad";
  if (["approval", "review", "warning", "draft", "require"].some((token) => value.includes(token))) return "warn";
  return "info";
}

export function compactJsonBlock(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return textBlock(json.length > 1200 ? `${json.slice(0, 1200)}\n...` : json);
}

export function emptyState(message: string): string {
  return `<p class="muted">${escapeHtml(message)}</p>`;
}

export function webviewNonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

export function executionFieldsHtml(item: SpecDriveIdeQueueItem): string {
  const fields = item.executionId
    ? [
      ["Status", item.status],
      ["Operation", item.operation],
      ["Execution", item.executionId],
      ["Feature", item.featureId],
      ["Task", item.taskId],
      ["Adapter", item.adapter],
      ["Run Mode", item.runMode],
      ["Provider", item.adapterId],
      ["Preference", item.preferenceSource],
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
      ["Run Mode", item.runMode],
      ["Provider", item.adapterId],
      ["Preference", item.preferenceSource],
      ["Updated", item.updatedAt],
    ];
  return `<ul>${fields
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([label, value]) => `<li>${escapeHtml(String(label))}: <code>${escapeHtml(String(value))}</code></li>`)
    .join("")}</ul><h2>Summary</h2><p>${escapeHtml(item.summary ?? "No summary recorded yet.")}</p>`;
}

export function jsonBlock(value: unknown): string {
  return textBlock(JSON.stringify(value, null, 2));
}

export function textBlock(value: string): string {
  return `<pre>${escapeHtml(value)}</pre>`;
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("\"", "&quot;");
}

export function documentList(documents: SpecDriveIdeDocument[]): string {
  if (documents.length === 0) return emptyState("No source documents discovered.");
  return documents.map((document) => `<div class="row"><span>${escapeHtml(document.label)}</span><button data-command="openDocument" data-path="${escapeAttr(document.path)}">${document.exists ? "Open" : "Missing"}</button></div>`).join("");
}
