import * as Dialog from "@radix-ui/react-dialog";
import {
  Bot,
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { UiStrings } from "../lib/i18n";
import { formatSpecValue, statusTone } from "../lib/utils";
import type { CommandReceipt, ConsoleData, RunnerSchedulerJob, SkillOutputModel } from "../types";
import { Button, Chip, EmptyState, Panel, SectionTitle } from "../components/ui/primitives";
import { FactList } from "../components/ui/helpers";

const pageSize = 10;

type OnCommand = (
  action: CommandReceipt["action"],
  entityType: string,
  entityId: string,
  payload?: Record<string, unknown>,
) => void;

function RunnerMetric({
  icon: Icon,
  label,
  value,
  tone,
  subValue,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  tone: "neutral" | "green" | "amber" | "red" | "blue";
  subValue?: string;
}) {
  const toneClass = {
    neutral: "bg-slate-50 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-50 text-blue-700",
  }[tone];
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] text-muted">{label}</div>
          <div className="mt-1 text-[22px] font-semibold leading-none text-ink">{value}</div>
          {subValue ? <div className="mt-1 text-[11px] text-muted">{subValue}</div> : null}
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${toneClass}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function stringifyContextValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function jobDisplayName(job: RunnerSchedulerJob | undefined, text: UiStrings): string {
  if (!job) return text.noSchedulerJob;
  return job.name
    || stringifyContextValue(job.context?.taskName)
    || stringifyContextValue(job.context?.name)
    || stringifyContextValue(job.context?.featureTitle)
    || friendlyWork(job, undefined, text)
    || text.task;
}

function friendlyStatus(job: RunnerSchedulerJob, text: UiStrings): string {
  const status = job.status.toLowerCase();
  if (["queued", "scheduled", "waiting", "delayed"].includes(status)) return text.statusQueued;
  if (["running", "active", "processing"].includes(status)) return text.statusRunning;
  if (["completed", "complete", "done", "succeeded", "success"].includes(status)) return text.statusCompleted;
  if (["blocked", "failed", "error"].includes(status)) return text.statusBlockedFailed;
  return job.status;
}

function friendlyWork(job: RunnerSchedulerJob, invocation: { skillSlug?: string; skillPhase?: string } | undefined, text: UiStrings): string {
  const skillSlug = invocation?.skillSlug ?? stringifyContextValue(job.context?.skillSlug);
  const phase = invocation?.skillPhase ?? stringifyContextValue(job.context?.skillPhase);
  const operation = job.operation ?? phase;
  if (skillSlug === "codex-coding-skill" || phase === "task_execution") return text.workTaskExecution;
  if (skillSlug === "create-project-hld" || operation === "generate_hld") return text.workGenerateHld;
  if (skillSlug === "pr-ears-requirement-decomposition-skill" || operation === "generate_ears") return text.workGenerateEars;
  if (skillSlug === "task-slicing-skill" || operation === "split_feature_specs") return text.workSplitFeatures;
  if (skillSlug === "ui-spec-skill" || operation === "generate_ui_spec") return text.workGenerateUiSpec;
  if (skillSlug === "technical-context-skill") return text.workCollectContext;
  return text.workExecuteTask;
}

function filterOptionLabel(option: string, text: UiStrings): string {
  if (option === "all") return text.allTypesQueues;
  if (option.startsWith("type:")) return option.slice("type:".length);
  if (option.startsWith("queue:")) return option.slice("queue:".length);
  return option;
}

function jobSearchBlob(job: RunnerSchedulerJob, text: UiStrings) {
  const displayName = jobDisplayName(job, text);
  return [
    job.id,
    displayName,
    job.bullmqJobId,
    job.queueName,
    job.jobType,
    job.operation,
    job.status,
    job.executionId,
    job.runId,
    job.taskId,
    job.featureId,
    job.projectId,
    job.workspaceRoot,
    ...Object.entries(job.context ?? {}).flatMap(([key, value]) => [key, stringifyContextValue(value)]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function JobDetailDrawer({
  job,
  text,
  invocation,
  recentLog,
  error,
  open,
  onOpenChange,
}: {
  job?: RunnerSchedulerJob;
  text: UiStrings;
  invocation?: { skillSlug?: string; skillPhase?: string; workspaceRoot?: string; evidenceSummary?: string };
  recentLog?: { runId: string; stdout: string; stderr: string; createdAt: string };
  error?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!job) {
    return null;
  }
  const runId = job.executionId ?? job.runId;
  const recentLogText = recentLog?.stderr || recentLog?.stdout || text.none;
  const skillOutput = job.skillOutput ?? invocation?.output;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/20" />
        <Dialog.Content className="fixed right-0 top-0 z-50 flex h-screen w-[460px] max-w-[calc(100vw-24px)] flex-col border-l border-line bg-white shadow-panel focus:outline-none">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-[16px] font-semibold text-ink">{jobDisplayName(job, text)}</Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] text-muted">
                {friendlyStatus(job, text)}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button className="h-8 w-8 shrink-0 px-0" tone="quiet" aria-label={text.close}>
                <X size={16} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-[13px]">
            <section className="rounded-md border border-line bg-slate-50 p-3">
              <div className="text-[12px] font-semibold text-ink">{text.executionSummary}</div>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between gap-4">
                  <span className="text-muted">{text.status}</span>
                  <Chip tone={statusTone[job.status] ?? "neutral"}>{friendlyStatus(job, text)}</Chip>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted">{text.currentWork}</span>
                  <span className="text-right font-medium text-ink">{friendlyWork(job, invocation, text)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted">{text.updatedAt}</span>
                  <span className="text-right font-medium text-ink">{job.updatedAt}</span>
                </div>
              </div>
            </section>

            <section className={`rounded-md border p-3 ${error ? "border-red-200 bg-red-50" : "border-line bg-white"}`}>
              <div className={`text-[12px] font-semibold ${error ? "text-red-700" : "text-ink"}`}>{text.blockedReason}</div>
              <div className={`mt-2 leading-5 ${error ? "text-red-700" : "text-muted"}`}>{error ?? text.noBlockingIssue}</div>
            </section>

            <section className="rounded-md border border-line bg-white p-3">
              <div className="text-[12px] font-semibold text-ink">{text.latestExecutionInfo}</div>
              <div className="mt-2 space-y-2 leading-5 text-muted">
                <p>{invocation?.evidenceSummary ?? text.noEvidence}</p>
                <p className="font-mono text-[11px]">{runId ? `${runId}: ${recentLogText}` : recentLogText}</p>
              </div>
            </section>

            <SkillOutputPanel output={skillOutput} text={text} />

            <details className="rounded-md border border-line bg-white p-3">
              <summary className="cursor-pointer text-[12px] font-semibold text-ink">{text.technicalTrace}</summary>
              <FactList
                rows={[
                  [text.schedulerJob, job.id],
                  [text.bullmqJob, job.bullmqJobId ?? text.none],
                  [text.currentRun, runId ?? text.none],
                  [text.queueName, job.queueName],
                  [text.workspace, job.workspaceRoot ?? invocation?.workspaceRoot ?? text.none],
                  [text.skillInvocations, invocation?.skillSlug ?? stringifyContextValue(job.context?.skillSlug) ?? text.none],
                  [text.skillPhase, invocation?.skillPhase ?? stringifyContextValue(job.context?.skillPhase) ?? text.none],
                ]}
              />
            </details>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SkillOutputPanel({ output, text }: { output?: SkillOutputModel; text: UiStrings }) {
  if (!output) {
    return (
      <section className="rounded-md border border-line bg-white p-3">
        <div className="text-[12px] font-semibold text-ink">{text.skillOutput}</div>
        <div className="mt-2 text-muted">{text.stdoutLogNotFound}</div>
      </section>
    );
  }
  const tone = output.parseStatus === "found" ? "green" : output.parseStatus === "invalid" ? "red" : "amber";
  return (
    <section className="rounded-md border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] font-semibold text-ink">{text.skillOutput}</div>
        <Chip tone={tone}>{output.parseStatus}</Chip>
      </div>
      <div className="mt-3 space-y-3 text-[12px]">
        <FactList
          rows={[
            [text.status, output.status ?? text.none],
            [text.summary, output.summary ?? output.error ?? text.stdoutLogNotFound],
            [text.tokenUsage, output.tokenUsage ? formatSpecValue(output.tokenUsage) : text.none],
            ["Cost", output.tokenConsumption ? `$${output.tokenConsumption.costUsd.toFixed(6)} ${output.tokenConsumption.pricingStatus}` : text.none],
            [text.stdoutLogPath, output.stdoutLogPath ?? text.none],
          ]}
        />
        {output.producedArtifacts.length > 0 ? (
          <div>
            <div className="mb-1 font-semibold text-ink">{text.producedArtifacts}</div>
            <div className="space-y-1">
              {output.producedArtifacts.map((artifact, index) => (
                <pre key={index} className="overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[11px] text-slate-700">
                  {formatSpecValue(artifact)}
                </pre>
              ))}
            </div>
          </div>
        ) : null}
        {output.evidence.length > 0 ? (
          <div>
            <div className="mb-1 font-semibold text-ink">{text.evidence}</div>
            <div className="space-y-1">
              {output.evidence.map((entry, index) => (
                <pre key={index} className="overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-[11px] text-slate-700">
                  {formatSpecValue(entry)}
                </pre>
              ))}
            </div>
          </div>
        ) : null}
        {output.traceability ? (
          <details className="rounded-md border border-line p-2">
            <summary className="cursor-pointer font-semibold text-ink">{text.traceability}</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">{formatSpecValue(output.traceability)}</pre>
          </details>
        ) : null}
        {output.result ? (
          <details className="rounded-md border border-line p-2">
            <summary className="cursor-pointer font-semibold text-ink">{text.result}</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">{formatSpecValue(output.result)}</pre>
          </details>
        ) : null}
      </div>
    </section>
  );
}

export function RunnerPage({
  data,
  text,
  onCommand,
  busy,
  onOpenSettings,
}: {
  data: ConsoleData;
  text: UiStrings;
  onCommand: OnCommand;
  busy: boolean;
  onOpenSettings: () => void;
}) {
  const runner = data.runner.runners[0];
  const schedulerJobs = data.runner.schedulerJobs ?? [];
  const jobStats = useMemo(() => {
    const byStatus = (statuses: string[]) =>
      schedulerJobs.filter((job) => statuses.includes(job.status.toLowerCase())).length;
    return {
      onlineRunners: data.runner.runners.filter((entry) => entry.online && !entry.heartbeatStale).length,
      total: schedulerJobs.length,
      queued: byStatus(["queued", "scheduled", "waiting", "delayed"]),
      running: byStatus(["running", "active", "processing"]),
      blockedFailed: byStatus(["blocked", "failed", "error"]),
      completed: byStatus(["completed", "complete", "done", "succeeded", "success"]),
    };
  }, [data.runner.runners, schedulerJobs]);
  const statusOptions = useMemo(
    () => ["all", ...Array.from(new Set(schedulerJobs.map((job) => job.status)))],
    [schedulerJobs],
  );
  const typeQueueOptions = useMemo(
    () => [
      "all",
      ...Array.from(new Set(schedulerJobs.map((job) => `type:${job.jobType}`))),
      ...Array.from(new Set(schedulerJobs.map((job) => `queue:${job.queueName}`))),
    ],
    [schedulerJobs],
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeQueueFilter, setTypeQueueFilter] = useState("all");
  const [jobQuery, setJobQuery] = useState("");
  const [page, setPage] = useState(1);
  const [detailJobId, setDetailJobId] = useState<string | undefined>();
  const visibleJobs = useMemo(() => {
    const query = jobQuery.trim().toLowerCase();
    return schedulerJobs.filter(
      (job) =>
        (statusFilter === "all" || job.status === statusFilter) &&
        (typeQueueFilter === "all" ||
          typeQueueFilter === `type:${job.jobType}` ||
          typeQueueFilter === `queue:${job.queueName}`) &&
        (!query || jobSearchBlob(job, text).includes(query)),
    );
  }, [jobQuery, schedulerJobs, statusFilter, text, typeQueueFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleJobs.length / pageSize));
  const safePage = Math.min(page, pageCount);
  useEffect(() => {
    setPage((value) => Math.min(value, pageCount));
  }, [pageCount]);
  const pageStart = visibleJobs.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(visibleJobs.length, safePage * pageSize);
  const pagedJobs = visibleJobs.slice((safePage - 1) * pageSize, safePage * pageSize);
  const detailJob = schedulerJobs.find((job) => job.id === detailJobId);
  const detailInvocation =
    data.runner.skillInvocations?.find(
      (item) =>
        item.schedulerJobId === detailJob?.id ||
        item.runId === detailJob?.executionId ||
        item.runId === detailJob?.runId,
    );
  const detailRecentLog = runner?.recentLogs.find(
    (log) => log.runId === detailJob?.executionId || log.runId === detailJob?.runId,
  );
  const detailError = detailJob?.error ?? detailInvocation?.blockedReason;
  const resetFiltersToFirstPage = (callback: () => void) => {
    callback();
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="border-b border-line bg-white px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-semibold text-ink">{text.runnerCenter}</h2>
              <p className="mt-1 text-[13px] text-muted">{text.runnerCenterSubtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button>
                <RefreshCw size={15} />
                {text.autoRefresh}
              </Button>
              <Button onClick={onOpenSettings}>
                <Settings size={15} />
                {text.openSettings}
              </Button>
              {runner ? (
                <>
                  <Button disabled={busy} onClick={() => onCommand("resume_runner", "runner", runner.runnerId)}>
                    <Play size={14} />
                    {text.resumeRunner}
                  </Button>
                  <Button disabled={busy} onClick={() => onCommand("pause_runner", "runner", runner.runnerId)}>
                    <Pause size={14} />
                    {text.pauseRunner}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-6 gap-3 max-xl:grid-cols-3 max-md:grid-cols-2">
            <RunnerMetric icon={Bot} label={text.onlineRunners} value={String(jobStats.onlineRunners)} tone="green" />
            <RunnerMetric icon={Workflow} label={text.totalJobs} value={String(jobStats.total)} tone="blue" />
            <RunnerMetric icon={CalendarCheck} label={text.queuedJobs} value={String(jobStats.queued)} tone="neutral" />
            <RunnerMetric icon={Play} label={text.runningJobs} value={String(jobStats.running)} tone="blue" />
            <RunnerMetric icon={ShieldAlert} label={text.blockedFailedJobs} value={String(jobStats.blockedFailed)} tone="amber" />
            <RunnerMetric icon={CheckCircle2} label={text.completedJobs} value={String(jobStats.completed)} tone="green" />
          </div>
        </div>

        <div className="min-w-0 p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Chip tone="neutral">
              {text.totalJobs} {jobStats.total}
            </Chip>
            <Chip tone="blue">
              {text.queuedJobs} {jobStats.queued}
            </Chip>
            <Chip tone="amber">
              {text.runningJobs} {jobStats.running}
            </Chip>
            <Chip tone="red">
              {text.blockedFailedJobs} {jobStats.blockedFailed}
            </Chip>
            <Chip tone="green">
              {text.completedJobs} {jobStats.completed}
            </Chip>
          </div>
          <div className="mb-3 grid grid-cols-[minmax(220px,1fr)_180px_180px] gap-2 max-lg:grid-cols-2 max-sm:grid-cols-1">
            <label className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-[12px] text-muted">
              <Search size={14} />
              <input
                value={jobQuery}
                onChange={(event) => resetFiltersToFirstPage(() => setJobQuery(event.target.value))}
                placeholder={text.searchTasks}
                className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
              />
            </label>
            <label className="rounded-md border border-line bg-white px-3 py-2 text-[12px] text-muted">
              <span className="sr-only">{text.typeQueueFilter}</span>
              <select
                value={typeQueueFilter}
                onChange={(event) => resetFiltersToFirstPage(() => setTypeQueueFilter(event.target.value))}
                className="w-full bg-transparent text-ink outline-none"
              >
                {typeQueueOptions.map((option) => (
                  <option key={option} value={option}>{filterOptionLabel(option, text)}</option>
                ))}
              </select>
            </label>
            <label className="rounded-md border border-line bg-white px-3 py-2 text-[12px] text-muted">
              <span className="sr-only">{text.status}</span>
              <select
                value={statusFilter}
                onChange={(event) => resetFiltersToFirstPage(() => setStatusFilter(event.target.value))}
                className="w-full bg-transparent text-ink outline-none"
              >
                {statusOptions.map((option) => <option key={option} value={option}>{option === "all" ? text.allStatuses : option}</option>)}
              </select>
            </label>
          </div>

          <div className="overflow-hidden rounded-lg border border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="text-[15px] font-semibold text-ink">{text.taskQueue}</h3>
              <Chip tone="neutral">{text.itemsTotal(visibleJobs.length)}</Chip>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[620px] w-full table-fixed text-left text-[12px]">
                <thead className="bg-slate-50 text-muted">
                  <tr>
                    <th className="w-[50%] px-4 py-2">{text.task}</th>
                    <th className="w-[18%] px-3 py-2">{text.status}</th>
                    <th className="w-[22%] px-3 py-2">{text.updatedAt}</th>
                    <th className="w-[10%] px-4 py-2 text-right">{text.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pagedJobs.map((job) => (
                    <tr key={job.id} className="h-10 bg-white hover:bg-slate-50">
                      <td className="px-4 py-1">
                        <button
                          type="button"
                          onClick={() => setDetailJobId(job.id)}
                          title={jobDisplayName(job, text)}
                          className="block max-w-full truncate text-left text-[13px] font-semibold text-ink"
                        >
                          {jobDisplayName(job, text)}
                        </button>
                      </td>
                      <td className="px-3 py-1"><Chip tone={statusTone[job.status] ?? "neutral"}>{friendlyStatus(job, text)}</Chip></td>
                      <td className="truncate px-3 py-1 text-[11px] text-muted">{job.updatedAt}</td>
                      <td className="px-4 py-1 text-right">
                        <Button className="h-7 px-2 text-[12px]" tone="quiet" onClick={() => setDetailJobId(job.id)}>
                          <Eye size={13} />
                          {text.detailsAction}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleJobs.length === 0 ? <EmptyState title={text.noRunnerTasks} /> : null}
            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[12px] text-muted">
              <span>{text.pageRange(pageStart, pageEnd, visibleJobs.length)}</span>
              <div className="flex items-center gap-2">
                <Button className="h-7 px-2 text-[12px]" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                  <ChevronLeft size={14} />
                  {text.previousPage}
                </Button>
                <Button className="h-7 px-2 text-[12px]" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
                  {text.nextPage}
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="border-t border-line bg-white px-4 py-3 text-[12px] text-muted">
          {data.runner.factSources?.join("、") ?? text.factSourcesRunner}
        </div>
      </Panel>
      <JobDetailDrawer
        job={detailJob}
        text={text}
        invocation={detailInvocation}
        recentLog={detailRecentLog}
        error={detailError}
        open={Boolean(detailJob)}
        onOpenChange={(open) => {
          if (!open) setDetailJobId(undefined);
        }}
      />
    </div>
  );
}
