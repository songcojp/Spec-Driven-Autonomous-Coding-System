import { ClipboardList, FileText, RefreshCw, Search, ShieldAlert, ShieldCheck, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import type { UiStrings } from "../lib/i18n";
import { statusTone } from "../lib/utils";
import type { CommandReceipt, ConsoleData } from "../types";
import { Button, Chip, EmptyState, Panel, SectionTitle } from "../components/ui/primitives";
import { FactList } from "../components/ui/helpers";

type OnCommand = (
  action: CommandReceipt["action"],
  entityType: string,
  entityId: string,
  payload?: Record<string, unknown>,
) => void;

function formatAuditTime(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(11, 19);
}

function AuditMetric({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
}) {
  const toneClass =
    tone === "green"
      ? "text-emerald-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "red"
          ? "text-red-600"
          : tone === "blue"
            ? "text-action"
            : "text-slate-500";
  return (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-3 text-[12px] text-muted">
        <span>{label}</span>
        <span className={toneClass}>{icon}</span>
      </div>
      <div className="mt-2 text-[24px] font-semibold tracking-normal">{value.toLocaleString()}</div>
    </div>
  );
}

function ExecutionResultsTable({ rows, text }: { rows: ConsoleData["audit"]["executionResults"]; text: UiStrings }) {
  if (rows.length === 0) return <EmptyState title={text.noEvidence} />;
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead className="border-b border-line bg-slate-50 text-[12px] text-muted">
          <tr>
            <th className="px-4 py-3">{text.id}</th>
            <th>{text.eventType}</th>
            <th>{text.receivedAt}</th>
            <th>{text.run}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3 font-medium text-action">{row.id}</td>
              <td className="py-3">
                <Chip tone="blue">{row.kind}</Chip>
                <div className="mt-1 max-w-[320px] truncate text-[12px] text-muted">{row.summary}</div>
              </td>
              <td className="py-3">{formatAuditTime(row.createdAt)}</td>
              <td className="py-3 text-action">{row.runId ?? text.none}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditApprovalTable({
  rows,
  text,
  busy,
  onCommand,
}: {
  rows: ConsoleData["audit"]["approvals"];
  text: UiStrings;
  busy: boolean;
  onCommand: OnCommand;
}) {
  if (rows.length === 0) return <EmptyState title={text.noReviews} />;
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead className="border-b border-line bg-slate-50 text-[12px] text-muted">
          <tr>
            <th className="px-4 py-3">{text.requestedBy}</th>
            <th>{text.status}</th>
            <th>{text.receivedAt}</th>
            <th>{text.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line last:border-0">
              <td className="px-4 py-3">{row.actor}</td>
              <td className="py-3">
                <Chip tone={statusTone[row.decision] ?? "green"}>{row.decision}</Chip>
                <div className="mt-1 max-w-[260px] truncate text-[12px] text-muted">{row.reason}</div>
              </td>
              <td className="py-3">{formatAuditTime(row.decidedAt)}</td>
              <td className="py-3">
                <Button
                  disabled={busy}
                  onClick={() => onCommand("approve_review", "review_item", row.reviewItemId)}
                >
                  {text.approve}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReviewsPage({
  data,
  text,
  onCommand,
  busy,
}: {
  data: ConsoleData;
  text: UiStrings;
  onCommand: OnCommand;
  busy: boolean;
}) {
  const audit = data.audit;
  const selected = audit.selectedEvent ?? audit.timeline[0];
  const timeline = audit.timeline.slice(0, 12);

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-normal">{text.auditCenterTitle}</h1>
            <div className="mt-2 text-[14px] font-medium text-action">{text.auditTimeline}</div>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span>UTC+8</span>
            <Button className="size-9 p-0" aria-label={text.autoRefresh}>
              <RefreshCw size={15} />
            </Button>
          </div>
        </div>

        <div className="grid gap-3 border-b border-line p-4 md:grid-cols-3 xl:grid-cols-6">
          <AuditMetric
            label={text.commandReceipts}
            value={audit.summary.acceptedCommands + audit.summary.blockedCommands}
            icon={<FileText size={18} />}
          />
          <AuditMetric
            label={text.acceptedCommands}
            value={audit.summary.acceptedCommands}
            tone="green"
            icon={<ShieldCheck size={18} />}
          />
          <AuditMetric
            label={text.blockedCommands}
            value={audit.summary.blockedCommands}
            tone="red"
            icon={<ShieldAlert size={18} />}
          />
          <AuditMetric
            label={text.stateTransitions}
            value={audit.summary.stateTransitions}
            tone="blue"
            icon={<Workflow size={18} />}
          />
          <AuditMetric
            label={text.evidence}
            value={audit.summary.activityCount}
            tone="blue"
            icon={<FileText size={18} />}
          />
          <AuditMetric
            label={text.pendingApprovals}
            value={audit.summary.pendingApprovals}
            tone="amber"
            icon={<ClipboardList size={18} />}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-[280px] flex-1 items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-[13px] text-muted">
            <Search size={15} />
            <span>{text.searchAudit}</span>
          </div>
          <select className="h-9 rounded-md border border-line bg-white px-3 text-[13px]">
            <option>
              {text.status}: {text.all}
            </option>
          </select>
          <select className="h-9 rounded-md border border-line bg-white px-3 text-[13px]">
            <option>
              {text.eventType}: {text.all}
            </option>
          </select>
          <Button tone="quiet">
            <Search size={14} />
            {text.moreFilters}
          </Button>
        </div>

        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="overflow-auto border-r border-line">
            {timeline.length > 0 ? (
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead className="border-b border-line bg-slate-50 text-[12px] text-muted">
                  <tr>
                    <th className="px-4 py-3">{text.receivedAt}</th>
                    <th>{text.status}</th>
                    <th>{text.eventType}</th>
                    <th>{text.eventCommand}</th>
                    <th>{text.run}</th>
                    <th>{text.job}</th>
                    <th>{text.requestedBy}</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((event) => (
                    <tr
                      key={event.id}
                      className={`border-b border-line last:border-0 ${event.id === selected?.id ? "bg-blue-50/70" : "hover:bg-slate-50"}`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-700">{formatAuditTime(event.occurredAt)}</td>
                      <td className="py-3">
                        <Chip tone={statusTone[event.status] ?? "neutral"}>{event.status}</Chip>
                      </td>
                      <td className="py-3 text-slate-600">{event.eventType}</td>
                      <td className="py-3 font-medium">{event.action}</td>
                      <td className="py-3 text-action">{event.runId ?? text.none}</td>
                      <td className="py-3 text-action">{event.jobId ?? text.none}</td>
                      <td className="py-3 text-muted">{event.requestedBy ?? "system"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState title={text.noReviews} />
            )}
          </div>

          <aside className="min-h-[420px] bg-white">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="font-semibold">{text.eventDetail}</div>
              <Chip tone={statusTone[selected?.status ?? "recorded"] ?? "neutral"}>{selected?.status ?? "recorded"}</Chip>
            </div>
            {selected ? (
              <div className="space-y-3 p-4 text-[13px]">
                <div className="flex items-center gap-2 text-[15px] font-semibold">
                  {selected.status === "blocked" ? (
                    <ShieldAlert size={18} className="text-red-600" />
                  ) : (
                    <ShieldCheck size={18} className="text-emerald-600" />
                  )}
                  {text.selectedEvent}
                </div>
                <FactList
                  rows={[
                    [text.id, selected.id],
                    [text.receivedAt, selected.occurredAt],
                    [text.requestedBy, selected.requestedBy ?? "system"],
                    [text.eventType, selected.eventType],
                    [text.command, selected.action],
                    [text.status, selected.status],
                    [text.blockedReasons, selected.blockedReasons[0] ?? selected.reason ?? text.none],
                    [text.run, selected.runId ?? text.none],
                    [text.job, selected.jobId ?? text.none],
                    ["Spec", selected.featureId ?? text.none],
                    [text.task, selected.taskId ?? text.none],
                  ]}
                />
              </div>
            ) : (
              <EmptyState title={text.noReviews} />
            )}
          </aside>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel>
          <SectionTitle title={`${text.executionResults} (${audit.executionResults.length})`} />
          <ExecutionResultsTable rows={audit.executionResults} text={text} />
        </Panel>
        <Panel>
          <SectionTitle title={`${text.approvalRecords} (${audit.approvals.length})`} />
          <AuditApprovalTable rows={audit.approvals} text={text} busy={busy} onCommand={onCommand} />
        </Panel>
      </div>
    </div>
  );
}
