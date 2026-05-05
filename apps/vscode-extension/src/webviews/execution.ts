import type { QueueAction, SpecDriveIdeExecutionDetail, SpecDriveIdeQueueItem, SpecDriveIdeView } from "../types";
import {
  commandButton,
  compactJsonBlock,
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
  textBlock,
  webviewNonce,
} from "./shared";

export function renderExecutionWorkbenchWebview(
  view: SpecDriveIdeView | undefined,
  detail: SpecDriveIdeExecutionDetail | SpecDriveIdeQueueItem | undefined,
  selectedKey?: string,
): string {
  const nonce = webviewNonce();
  const queue = view ? allQueueItems(view) : [];
  const grouped = view?.queue.groups ?? {};
  const blockers = queue.filter((item) => item.status === "blocked" || item.status === "approval_needed");
  const selectedItem = selectedKey ? detail : undefined;
  const executionDetail = detail && "metadata" in detail ? detail as SpecDriveIdeExecutionDetail : undefined;
  return renderWorkbenchPage("Execution Workbench", nonce, `
    <section class="toolbar">
      ${autoRunButton(view)}
      ${queueActionButton("Run Now", selectedItem, "run_now", ["ready", "queued"])}
      ${pauseResumeButton(selectedItem)}
      ${queueActionButton("Retry", selectedItem, "retry", ["failed", "cancelled", "skipped"])}
      ${queueActionButton("Cancel", selectedItem, "cancel", ["ready", "queued", "running", "approval_needed", "blocked", "paused"])}
      ${queueActionButton("Skip", selectedItem, "skip", ["queued", "approval_needed", "blocked", "failed", "paused"])}
      ${queueActionButton("Reprioritize", selectedItem, "reprioritize", ["ready", "queued", "blocked", "paused"])}
      ${queueActionButton("Enqueue", selectedItem, "enqueue", ["ready", "blocked"])}
      ${commandButton("Refresh", "refresh", {})}
    </section>
    <div id="workbench-status" class="status-text" role="status" aria-live="polite">${escapeHtml(selectedItem ? `Selected job: ${selectedItem.executionId ?? selectedItem.schedulerJobId ?? "unknown"} · ${selectedItem.status}` : "Select a job to enable job actions.")}</div>
    <main class="grid execution-grid">
      <section class="panel span-5">
        <div class="panel-title"><h2>Execution Queue</h2><span>${queue.length} items</span></div>
        ${["ready", "queued", "running", "approval_needed", "blocked", "failed", "paused", "cancelled", "skipped", "completed"].map((status) => renderQueueGroup(status, grouped[status] ?? [], selectedKey)).join("")}
      </section>
      <section class="panel span-3">
        <div class="panel-title"><h2>Current Execution</h2><span>${escapeHtml(detail?.status ?? "none")}</span></div>
        ${detail ? executionFieldsHtml(detail) : emptyState("No active execution selected.")}
        <h3>Raw Log Refs</h3>
        ${renderRawLogRefs(detail)}
        <h3>Diff Summary</h3>
        ${compactJsonBlock(executionDetail?.diffSummary ?? null)}
        <h3>SkillOutputContractV1</h3>
        ${compactJsonBlock(executionDetail?.skillOutputContract ?? null)}
      </section>
      <section class="panel span-4">
        <div class="panel-title"><h2>Blockers & Approvals</h2><span>${blockers.length}</span></div>
        ${renderBlockersAndApprovals(blockers, executionDetail)}
      </section>
      <section class="panel span-4">
        <div class="panel-title"><h2>Result Projection</h2><span>spec-state.json</span></div>
        ${compactJsonBlock(resultProjection(executionDetail))}
        <h3>Produced Artifacts</h3>
        ${compactJsonBlock(executionDetail?.producedArtifacts ?? [])}
      </section>
    </main>
  `);
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
  return `<button disabled title="${escapeAttr(title)}">${escapeHtml(label)}</button>`;
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

export function executionItemByKey(view: SpecDriveIdeView | undefined, selectedKey: string | undefined): SpecDriveIdeQueueItem | undefined {
  if (!view || !selectedKey) return undefined;
  return allQueueItems(view).find((item) => queueItemKey(item) === selectedKey);
}
