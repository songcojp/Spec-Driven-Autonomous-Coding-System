import type { SpecDriveIdeExecutionDetail, SpecDriveIdeQueueItem, SpecDriveIdeView } from "../types";
import {
  commandButton,
  compactJsonBlock,
  emptyState,
  escapeHtml,
  executionFieldsHtml,
  jsonBlock,
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
): string {
  const nonce = webviewNonce();
  const queue = view ? allQueueItems(view) : [];
  const grouped = view?.queue.groups ?? {};
  const blockers = queue.filter((item) => item.status === "blocked" || item.status === "approval_needed");
  return renderWorkbenchPage("Execution Workbench", nonce, `
    <section class="toolbar">
      ${commandButton("Start Auto Run", "controlled", { action: "start_auto_run", entityType: "project", entityId: view?.project?.id ?? "workspace", reason: "Start auto run from Execution Workbench." })}
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
        <div class="panel-title"><h2>Execution Queue</h2><span>${queue.length} items</span></div>
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
