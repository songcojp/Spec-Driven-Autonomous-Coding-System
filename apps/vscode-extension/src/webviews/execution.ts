import type { QueueAction, SpecDriveIdeExecutionDetail, SpecDriveIdeQueueItem, SpecDriveIdeView } from "../types";
import {
  autoRefreshSwitch,
  commandButton,
  compactJsonBlock,
  disabledButtonHtml,
  emptyState,
  escapeAttr,
  escapeHtml,
  executionFieldsHtml,
  jsonBlock,
  queueItemKey,
  queueButton,
  renderBlockerCard,
  renderQueueGroup,
  renderRawLogRefs,
  renderWorkbenchPage,
  statusClass,
  textBlock,
  webviewNonce,
} from "./shared";

const EXECUTION_QUEUE_GROUPS: Array<{ status: string; open: boolean }> = [
  { status: "running", open: true },
  { status: "queued", open: true },
  { status: "approval_needed", open: false },
  { status: "blocked", open: false },
  { status: "failed", open: false },
  { status: "paused", open: false },
  { status: "cancelled", open: false },
  { status: "skipped", open: false },
  { status: "completed", open: false },
];

export function renderExecutionWorkbenchWebview(
  view: SpecDriveIdeView | undefined,
  detail: SpecDriveIdeExecutionDetail | SpecDriveIdeQueueItem | undefined,
  selectedKey?: string,
  autoRefreshEnabled = false,
): string {
  const nonce = webviewNonce();
  const queue = view ? allQueueItems(view) : [];
  const grouped = view?.queue.groups ?? {};
  const selectedItem = selectedKey ? detail : undefined;
  const executionDetail = detail && "metadata" in detail ? detail as SpecDriveIdeExecutionDetail : undefined;
  const selectedBlockers = selectedBlockerItems(selectedItem);
  const blockerApprovalCount = selectedBlockers.length + (executionDetail?.approvalRequests.length ?? 0);
  return renderWorkbenchPage("Execution Workbench", nonce, `
    <section class="toolbar">
      ${executionPreferenceControls(view)}
      ${autoRunButton(view)}
      ${commandButton("Refresh", "refresh", {})}
      ${autoRefreshSwitch(autoRefreshEnabled)}
    </section>
    <div id="workbench-status" class="status-text" role="status" aria-live="polite">${escapeHtml(selectedItem ? `Selected job: ${selectedItem.executionId ?? selectedItem.schedulerJobId ?? "unknown"} · ${selectedItem.status}` : "Select a job to enable job actions.")}</div>
    <main class="execution-layout">
      <section class="panel execution-queue-column">
        <div class="panel-title"><h2>Execution Queue</h2><span>${queue.length} items</span></div>
        ${EXECUTION_QUEUE_GROUPS.map((group) => renderQueueGroup(group.status, grouped[group.status] ?? [], selectedKey, group.open)).join("")}
      </section>
      <section class="panel current-selected-column">
        <div class="panel-title selected-title">
          <div>
            <h2>Current Selected</h2>
            <span>${escapeHtml(selectedItem ? `${selectedItem.status} · ${selectedItem.operation ?? selectedItem.jobType ?? "execution"}` : "none")}</span>
          </div>
          <div class="title-actions">${selectedTaskActionButtons(selectedItem)}</div>
        </div>
        ${detail ? executionFieldsHtml(detail) : emptyState("No active execution selected.")}
        <h3>Token Consumption</h3>
        ${renderTokenConsumption(executionDetail)}
        <h3>Raw Log Refs</h3>
        ${renderRawLogRefs(detail)}
        <h3>Diff Summary</h3>
        ${compactJsonBlock(executionDetail?.diffSummary ?? null)}
        <h3>SkillOutputContractV1</h3>
        ${compactJsonBlock(executionDetail?.skillOutputContract ?? null)}
        <div class="section-title"><h2>Blockers & Approvals</h2><span>${blockerApprovalCount}</span></div>
        ${renderBlockersAndApprovals(selectedBlockers, executionDetail)}
        <div class="section-title"><h2>Result Projection</h2><span>spec-state.json</span></div>
        ${renderSkillOutputSummary(executionDetail)}
        <h3>Produced Artifacts</h3>
        ${renderProducedArtifacts(executionDetail)}
        <h3>Additional Result</h3>
        ${renderAdditionalResult(executionDetail)}
      </section>
    </main>
  `);
}

function selectedBlockerItems(item: SpecDriveIdeQueueItem | undefined): SpecDriveIdeQueueItem[] {
  if (!item) return [];
  const status = item.status.toLowerCase();
  return status === "blocked" || status === "approval_needed" ? [item] : [];
}

function renderTokenConsumption(detail: SpecDriveIdeExecutionDetail | undefined): string {
  const token = detail?.tokenConsumption;
  if (!token) return emptyState("No token consumption recorded.");
  const rows: Array<[string, string]> = [
    ["Model", token.model ?? "unknown"],
    ["Input", formatInteger(token.inputTokens)],
    ["Cached Input", formatInteger(token.cachedInputTokens)],
    ["Output", formatInteger(token.outputTokens)],
    ["Reasoning Output", formatInteger(token.reasoningOutputTokens)],
    ["Total", formatInteger(token.totalTokens)],
    ["Cost", formatCurrency(token.costUsd, token.currency)],
    ["Pricing", token.pricingStatus],
    ["Pricing Source", pricingSourceLabel(token.pricing)],
  ];
  return `<div class="token-consumption-grid">${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`;
}

function pricingSourceLabel(pricing: Record<string, unknown> | undefined): string {
  if (!pricing) return "unknown";
  const adapterKind = typeof pricing.adapterKind === "string" ? pricing.adapterKind.toUpperCase() : undefined;
  const adapterId = typeof pricing.adapterId === "string" ? pricing.adapterId : undefined;
  return adapterKind && adapterId ? `${adapterKind}: ${adapterId}` : adapterId ?? "unknown";
}

function formatInteger(value: number): string {
  return Number.isFinite(value) ? Math.trunc(value).toLocaleString("en-US") : "0";
}

function formatCurrency(value: number, currency: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  return `${currency || "USD"} ${amount.toFixed(6)}`;
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
  return `<label class="inline-field">Provider
      <select id="job-adapter-id" aria-label="Job provider adapter">
        ${adapters.map((adapter) => `<option value="${escapeAttr(adapter.id)}" data-run-mode="${adapter.mode}"${adapter.id === activeAdapter ? " selected" : ""}>${escapeHtml(`${adapter.mode.toUpperCase()}: ${adapter.displayName}`)}</option>`).join("")}
      </select>
    </label>`;
}

function renderBlockersAndApprovals(blockers: SpecDriveIdeQueueItem[], detail: SpecDriveIdeExecutionDetail | undefined): string {
  const approvalRequests = detail?.approvalRequests ?? [];
  const queueHtml = blockers.map(renderBlockerCard).join("");
  const approvalHtml = approvalRequests.length > 0
    ? `<h3>Approval Requests</h3>${compactJsonBlock(approvalRequests)}`
    : "";
  return queueHtml || approvalHtml
    ? `${queueHtml}${approvalHtml}`
    : emptyState("No blockers or approval requests.");
}

function resultProjection(detail: SpecDriveIdeExecutionDetail | undefined): unknown {
  if (!detail) return null;
  const output = detail.skillOutputContract && typeof detail.skillOutputContract === "object"
    ? detail.skillOutputContract as Record<string, unknown>
    : {};
  return {
    status: detail.status,
    summary: output.summary ?? detail.summary,
    nextAction: output.nextAction,
    featureId: detail.featureId,
    taskId: detail.taskId,
    executionId: detail.executionId,
    producedArtifacts: detail.producedArtifacts,
    traceability: output.traceability,
  };
}

function renderSkillOutputSummary(detail: SpecDriveIdeExecutionDetail | undefined): string {
  if (!detail) return emptyState("No execution result selected.");
  const output = skillOutputRecord(detail);
  const projection = resultProjection(detail) as Record<string, unknown>;
  const result = resultRecord(output);
  return `
    <div class="result-summary">
      <div class="result-status"><span class="badge ${statusClass(detail.status)}">${escapeHtml(detail.status)}</span><strong>${escapeHtml(String(projection.summary ?? "No summary."))}</strong></div>
      <div class="row"><span>Next Action</span><span>${escapeHtml(stringOrNone(output?.nextAction))}</span></div>
      ${renderTraceabilityChips(output?.traceability, detail)}
    </div>
    ${renderResultGroups(result)}
  `;
}

function selectedTaskActionButtons(selectedItem: SpecDriveIdeQueueItem | undefined): string {
  return [
    queueActionButton("Run Now", selectedItem, "run_now", ["ready", "queued"]),
    pauseResumeButton(selectedItem),
    queueActionButton("Retry", selectedItem, "retry", ["failed", "cancelled", "skipped"]),
    queueActionButton("Cancel", selectedItem, "cancel", ["ready", "queued", "running", "approval_needed", "blocked", "paused"]),
    queueActionButton("Skip", selectedItem, "skip", ["queued", "approval_needed", "blocked", "failed", "paused"]),
    queueActionButton("Reprioritize", selectedItem, "reprioritize", ["ready", "queued", "blocked", "paused"]),
    queueActionButton("Enqueue", selectedItem, "enqueue", ["ready", "blocked"]),
  ].join("");
}

function renderTraceabilityChips(traceability: unknown, detail: SpecDriveIdeExecutionDetail): string {
  const record = traceability && typeof traceability === "object" && !Array.isArray(traceability)
    ? traceability as Record<string, unknown>
    : {};
  const requirementIds = Array.isArray(record.requirementIds) ? record.requirementIds.filter((item): item is string => typeof item === "string") : [];
  const chips = [
    ["Feature", stringOrNone(record.featureId ?? detail.featureId)],
    ["Task", stringOrNone(record.taskId ?? detail.taskId)],
    ...requirementIds.map((id) => ["REQ", id]),
  ];
  return `<div class="chip-row">${chips.map(([label, value]) => `<span class="badge"><strong>${escapeHtml(label)}</strong>&nbsp;${escapeHtml(value)}</span>`).join("")}</div>`;
}

function renderProducedArtifacts(detail: SpecDriveIdeExecutionDetail | undefined): string {
  const artifacts = Array.isArray(detail?.producedArtifacts) ? detail.producedArtifacts : [];
  if (artifacts.length === 0) return emptyState("No produced artifacts.");
  return `<table class="artifact-table"><thead><tr><th>Path</th><th>Kind</th><th>Status</th><th>Summary</th></tr></thead><tbody>${artifacts.map((artifact) => {
    const record = artifact && typeof artifact === "object" && !Array.isArray(artifact) ? artifact as Record<string, unknown> : {};
    return `<tr><td><code>${escapeHtml(String(record.path ?? "-"))}</code></td><td>${escapeHtml(String(record.kind ?? "-"))}</td><td><span class="${statusClass(String(record.status ?? ""))}">${escapeHtml(String(record.status ?? "-"))}</span></td><td>${escapeHtml(String(record.summary ?? ""))}</td></tr>`;
  }).join("")}</tbody></table>`;
}

function renderResultGroups(result: Record<string, unknown>): string {
  const groups: Array<[string, string[]]> = [
    ["Decision", ["decision", "reason", "selectedFeature", "featureId", "blockedReason"]],
    ["Commands", ["commands", "commandsChecked"]],
    ["Verification", ["verification", "statusChecker", "failureClassification", "recommendedNextAction"]],
    ["Blockers", ["blockers", "blockedReasons", "openQuestions", "residualQuestions"]],
    ["Findings", ["findings", "specDriftFindings", "requiredFixes"]],
    ["Risks", ["risks", "residualRisks", "residualRisk"]],
    ["Coverage", ["coverage", "traceabilityMatrix", "userStoryMapping"]],
    ["Updated Documents", ["updatedDocuments", "updatedArtifacts", "affectedDocuments"]],
  ];
  const html = groups.map(([title, keys]) => renderResultGroup(title, keys, result)).filter(Boolean).join("");
  return html || emptyState("No structured result fields.");
}

function renderResultGroup(title: string, keys: string[], result: Record<string, unknown>): string {
  const entries = keys.filter((key) => result[key] !== undefined).map((key) => [key, result[key]] as const);
  if (entries.length === 0) return "";
  return `<div class="result-group"><h3>${escapeHtml(title)}</h3>${entries.map(([key, value]) => `<div class="row"><span>${escapeHtml(labelize(key))}</span><span>${renderResultValue(value)}</span></div>`).join("")}</div>`;
}

function renderAdditionalResult(detail: SpecDriveIdeExecutionDetail | undefined): string {
  const result = resultRecord(skillOutputRecord(detail));
  const known = new Set(["decision", "reason", "selectedFeature", "featureId", "blockedReason", "commands", "commandsChecked", "verification", "statusChecker", "failureClassification", "recommendedNextAction", "blockers", "blockedReasons", "openQuestions", "residualQuestions", "findings", "specDriftFindings", "requiredFixes", "risks", "residualRisks", "residualRisk", "coverage", "traceabilityMatrix", "userStoryMapping", "updatedDocuments", "updatedArtifacts", "affectedDocuments"]);
  const additional = Object.fromEntries(Object.entries(result).filter(([key]) => !known.has(key)));
  return Object.keys(additional).length > 0 ? compactJsonBlock(additional) : emptyState("No additional result fields.");
}

function renderResultValue(value: unknown): string {
  if (value === null || value === undefined) return `<span class="muted">none</span>`;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return escapeHtml(String(value));
  if (Array.isArray(value)) {
    if (value.length === 0) return `<span class="muted">empty</span>`;
    return `<ul class="compact-list">${value.slice(0, 6).map((entry) => `<li>${escapeHtml(resultLabel(entry))}</li>`).join("")}${value.length > 6 ? `<li class="muted">+${value.length - 6} more</li>` : ""}</ul>`;
  }
  return `<code>${escapeHtml(resultLabel(value))}</code>`;
}

function resultLabel(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  return String(record.summary ?? record.reason ?? record.command ?? record.path ?? record.id ?? record.name ?? JSON.stringify(value));
}

function skillOutputRecord(detail: SpecDriveIdeExecutionDetail | undefined): Record<string, unknown> | undefined {
  return detail?.skillOutputContract && typeof detail.skillOutputContract === "object" && !Array.isArray(detail.skillOutputContract)
    ? detail.skillOutputContract as Record<string, unknown>
    : undefined;
}

function resultRecord(output: Record<string, unknown> | undefined): Record<string, unknown> {
  return output?.result && typeof output.result === "object" && !Array.isArray(output.result)
    ? output.result as Record<string, unknown>
    : {};
}

function stringOrNone(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "none";
}

function labelize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (match) => match.toUpperCase());
}

function autoRunButton(view: SpecDriveIdeView | undefined): string {
  return view?.automation?.status === "running"
    ? commandButton("Pause Auto Run", "controlled", {
      action: "pause_runner",
      entityType: "runner",
      entityId: "runner-main",
      reason: "Pause auto run from Execution Workbench.",
    })
    : commandButton("Start Auto Run", "controlled", {
      action: "start_auto_run",
      entityType: "project",
      entityId: view?.project?.id ?? "workspace",
      reason: "Start auto run from Execution Workbench.",
    });
}

function queueActionButton(
  label: string,
  item: SpecDriveIdeQueueItem | undefined,
  action: QueueAction,
  enabledStatuses: string[],
): string {
  const entityId = item?.executionId ?? item?.schedulerJobId;
  if (!entityId) return disabledButton(label, "Select a job first.");
  const selectedItem = item as SpecDriveIdeQueueItem;
  const status = selectedItem.status.toLowerCase();
  if (!enabledStatuses.includes(status)) {
    return disabledButton(label, `${label} is not available while the selected job is ${selectedItem.status}.`);
  }
  return queueButton(label, selectedItem, action);
}

function pauseResumeButton(item: SpecDriveIdeQueueItem | undefined): string {
  const status = item?.status.toLowerCase();
  if (status === "paused") return queueActionButton("Resume", item, "resume", ["paused"]);
  return queueActionButton("Pause", item, "pause", ["queued", "running"]);
}

function disabledButton(label: string, title: string): string {
  return disabledButtonHtml(label, title);
}

export function renderExecutionWebview(item: SpecDriveIdeExecutionDetail | SpecDriveIdeQueueItem): string {
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

function allQueueItems(view: SpecDriveIdeView): SpecDriveIdeQueueItem[] {
  return Object.values(view.queue.groups).flat();
}

export function currentExecutionItem(view: SpecDriveIdeView): SpecDriveIdeQueueItem | undefined {
  const items = allQueueItems(view);
  return items.find((item) => item.status === "running")
    ?? items.find((item) => item.status === "approval_needed")
    ?? items.find((item) => item.status === "queued")
    ?? items[0];
}

export function runningExecutionItem(view: SpecDriveIdeView): SpecDriveIdeQueueItem | undefined {
  return allQueueItems(view).find((item) => item.status === "running");
}

export function executionItemByKey(view: SpecDriveIdeView | undefined, selectedKey: string | undefined): SpecDriveIdeQueueItem | undefined {
  if (!view || !selectedKey) return undefined;
  return allQueueItems(view).find((item) => queueItemKey(item) === selectedKey);
}
