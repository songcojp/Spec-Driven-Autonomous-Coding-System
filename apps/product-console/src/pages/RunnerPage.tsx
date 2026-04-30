import {
  Bot,
  CalendarCheck,
  CheckCircle2,
  Code2,
  ExternalLink,
  GitBranch,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import type { UiStrings } from "../lib/i18n";
import { formatPercent, statusTone } from "../lib/utils";
import type { CommandReceipt, ConsoleData, RunnerSchedulerJob } from "../types";
import { Button, Chip, EmptyState, Panel, SectionTitle } from "../components/ui/primitives";
import { FactList, StatusDot } from "../components/ui/helpers";

type OnCommand = (
  action: CommandReceipt["action"],
  entityType: string,
  entityId: string,
  payload?: Record<string, unknown>,
) => void;

type RunnerTaskRow = NonNullable<ConsoleData["runner"]["lanes"]>["ready"][number];

function findSchedulerJobForTask(jobs: RunnerSchedulerJob[], task: RunnerTaskRow | undefined) {
  if (!task) return undefined;
  return (
    jobs.find((job) => job.taskId === task.id) ??
    jobs.find((job) => job.runId && job.runId === task.runId) ??
    jobs.find((job) => job.targetId === task.id) ??
    jobs.find((job) => job.featureId && job.featureId === task.featureId) ??
    jobs.find((job) => job.targetId && job.targetId === task.featureId)
  );
}

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

function RunnerTaskFact({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-slate-50 px-2 py-1.5">
      <div className="flex items-center gap-1 text-slate-500">
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-0.5 truncate font-medium text-slate-800">{value}</div>
    </div>
  );
}

function RunnerTaskCard({
  task,
  text,
  onCommand,
  busy,
}: {
  task: RunnerTaskRow;
  text: UiStrings;
  onCommand: OnCommand;
  busy: boolean;
}) {
  const dependencyBlocked = task.dependencies.some((dependency) => !dependency.satisfied);
  const commandAction = task.action === "run" ? "run_board_tasks" : "schedule_board_tasks";
  const actionLabel =
    task.action === "run"
      ? text.run
      : task.action === "review"
        ? text.reviewBlocked
        : task.action === "observe"
          ? text.observe
          : text.schedule;
  return (
    <div className="rounded-lg border border-line bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-action">
            {task.featureId ?? text.none} · {task.status}
          </div>
          <div className="mt-1 text-[13px] font-semibold leading-5 text-ink">
            {task.id} {task.title}
          </div>
        </div>
        <Chip tone={statusTone[task.status] ?? "neutral"}>{task.status}</Chip>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted">
        <RunnerTaskFact icon={ShieldCheck} label={text.risk} value={task.risk} />
        <RunnerTaskFact icon={CheckCircle2} label={text.approval} value={task.approvalStatus} />
        <RunnerTaskFact icon={GitBranch} label={text.assignedRunner} value={task.runnerId ?? text.none} />
        <RunnerTaskFact icon={Code2} label={text.currentRun} value={task.runId ?? text.none} />
      </div>
      <div className="mt-3 flex items-center gap-2 text-[12px]">
        <StatusDot status={dependencyBlocked ? "blocked" : "done"} />
        <span className={dependencyBlocked ? "text-red-600" : "text-emerald-700"}>
          {dependencyBlocked ? text.dependencyBlocked : text.dependencyOk}
        </span>
      </div>
      {task.blockedReasons.length > 0 ? (
        <div className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[12px] leading-5 text-red-700">{task.blockedReasons[0]}</div>
      ) : null}
      {task.recentLog ? (
        <div className="mt-2 truncate rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600">
          {task.recentLog}
        </div>
      ) : null}
      <div className="mt-3 flex justify-end">
        <Button
          tone={task.action === "review" ? "danger" : task.action === "observe" ? "quiet" : "primary"}
          disabled={busy || task.action === "observe"}
          onClick={() =>
            onCommand(commandAction, "feature", task.featureId ?? "feature", { taskIds: [task.id] })
          }
        >
          {task.action === "review" ? (
            <ShieldAlert size={14} />
          ) : task.action === "observe" ? (
            <ExternalLink size={14} />
          ) : (
            <Play size={14} />
          )}
          {task.action === "observe" ? actionLabel : `${actionLabel} ${task.id}`}
        </Button>
      </div>
    </div>
  );
}

function RunnerLane({
  title,
  tone,
  tasks,
  text,
  onCommand,
  busy,
}: {
  title: string;
  tone: "green" | "blue" | "amber" | "red";
  tasks: RunnerTaskRow[];
  text: UiStrings;
  onCommand: OnCommand;
  busy: boolean;
}) {
  return (
    <div className="min-h-[360px] rounded-lg border border-line bg-slate-50/80">
      <div className="flex h-11 items-center justify-between border-b border-line px-3">
        <div className="text-[13px] font-semibold text-ink">{title}</div>
        <Chip tone={tone}>{tasks.length}</Chip>
      </div>
      <div className="space-y-3 p-3">
        {tasks.length > 0 ? (
          tasks.map((task) => <RunnerTaskCard key={task.id} task={task} text={text} onCommand={onCommand} busy={busy} />)
        ) : (
          <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-[13px] text-muted">
            {text.noRunnerTasks}
          </div>
        )}
      </div>
    </div>
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
  const lanes = data.runner.lanes ?? { ready: [], scheduled: [], running: [], blocked: [] };
  const summary = data.runner.summary ?? {
    onlineRunners: data.runner.runners.filter((entry) => entry.online).length,
    runningTasks: lanes.running.length,
    readyTasks: lanes.ready.length,
    blockedTasks: lanes.blocked.length,
    successRate: data.dashboard.runner.successRate,
    failureRate: data.dashboard.runner.failureRate,
  };
  const firstRunnable = lanes.scheduled[0] ?? lanes.ready[0] ?? lanes.blocked[0];
  const schedulerJobs = data.runner.schedulerJobs ?? [];
  const queueGroups = [
    { type: "feature.select", queue: "specdrive:feature-scheduler" },
    { type: "feature.plan", queue: "specdrive:feature-scheduler" },
    { type: "cli.run", queue: "specdrive:cli-runner" },
  ];
  const allTasks = [...lanes.ready, ...lanes.scheduled, ...lanes.running, ...lanes.blocked];
  const [selectedTaskId, setSelectedTaskId] = useState(() => firstRunnable?.id ?? allTasks[0]?.id);
  const selectedTask = allTasks.find((task) => task.id === selectedTaskId) ?? firstRunnable ?? allTasks[0];
  const selectedJob = findSchedulerJobForTask(schedulerJobs, selectedTask) ?? schedulerJobs[0];
  const selectedInvocation =
    data.runner.skillInvocations?.find(
      (item) => item.runId === selectedTask?.runId || item.schedulerJobId === selectedJob?.id,
    ) ?? data.runner.skillInvocations?.[0];
  const selectedRecentLog = selectedTask?.recentLog ?? runner?.recentLogs?.[0]?.stderr ?? runner?.recentLogs?.[0]?.stdout;

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
          <div className="mt-4 grid grid-cols-5 gap-3 max-xl:grid-cols-3 max-md:grid-cols-2">
            <RunnerMetric icon={Bot} label={text.onlineRunners} value={String(summary.onlineRunners)} tone="green" />
            <RunnerMetric icon={Workflow} label={text.runningTasks} value={String(summary.runningTasks)} tone="blue" />
            <RunnerMetric icon={CalendarCheck} label={text.readyTasks} value={String(summary.readyTasks)} tone="neutral" />
            <RunnerMetric icon={ShieldAlert} label={text.blockedTasks} value={String(summary.blockedTasks)} tone="amber" />
            <RunnerMetric
              icon={CheckCircle2}
              label={text.runnerSuccess}
              value={formatPercent(summary.successRate)}
              tone="green"
              subValue={`${text.failureRate} ${formatPercent(summary.failureRate)}`}
            />
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-0 max-xl:grid-cols-1">
          <div className="min-w-0 p-4">
            <div className="mb-4">
              <SectionTitle title={text.schedulerPipeline} action={<Chip tone="blue">BullMQ</Chip>} />
              <div className="mt-3 grid grid-cols-3 gap-3 max-lg:grid-cols-1">
                {queueGroups.map((stage) => {
                  const jobs = schedulerJobs.filter((job) => job.jobType === stage.type);
                  const activeJob =
                    jobs.find((job) => ["queued", "running", "blocked", "failed"].includes(job.status)) ?? jobs[0];
                  return (
                    <button
                      key={stage.type}
                      type="button"
                      onClick={() => {
                        const taskForJob = activeJob
                          ? allTasks.find(
                              (task) =>
                                task.id === activeJob.taskId ||
                                task.runId === activeJob.runId ||
                                task.featureId === activeJob.featureId,
                            )
                          : undefined;
                        if (taskForJob) setSelectedTaskId(taskForJob.id);
                      }}
                      className="min-h-[118px] rounded-lg border border-line bg-white p-3 text-left transition hover:border-action"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-[13px] font-semibold text-ink">{stage.type}</div>
                        <Chip tone={statusTone[activeJob?.status ?? "queued"] ?? "neutral"}>{jobs.length}</Chip>
                      </div>
                      <div className="mt-2 truncate font-mono text-[11px] text-muted">{stage.queue}</div>
                      <div className="mt-3 rounded-md bg-slate-50 px-3 py-2">
                        <div className="text-[11px] text-muted">{text.activeJob}</div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[12px] text-ink">
                            {activeJob?.id ?? text.noSchedulerJob}
                          </span>
                          <Chip tone={statusTone[activeJob?.status ?? ""] ?? "neutral"}>
                            {activeJob?.status ?? text.none}
                          </Chip>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <Chip tone="green">
                  {text.readyLane} {lanes.ready.length}
                </Chip>
                <Chip tone="blue">
                  {text.scheduledLane} {lanes.scheduled.length}
                </Chip>
                <Chip tone="amber">
                  {text.runningLane} {lanes.running.length}
                </Chip>
                <Chip tone="red">
                  {text.blockedLane} {lanes.blocked.length}
                </Chip>
              </div>
              <Button
                tone="primary"
                disabled={busy || !firstRunnable}
                onClick={() =>
                  firstRunnable &&
                  onCommand(
                    firstRunnable.action === "run" ? "run_board_tasks" : "schedule_board_tasks",
                    "feature",
                    firstRunnable.featureId ?? "feature",
                    { taskIds: [firstRunnable.id] },
                  )
                }
              >
                {busy ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />}
                {firstRunnable
                  ? `${firstRunnable.action === "run" ? text.run : text.schedule} ${firstRunnable.id}`
                  : text.schedule}
              </Button>
            </div>
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h3 className="text-[15px] font-semibold text-ink">{text.taskQueue}</h3>
                <div className="flex items-center gap-2 rounded-md border border-line bg-slate-50 px-3 py-2 text-[12px] text-muted">
                  <Search size={14} />
                  <span>{text.searchTasks}</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-left text-[12px]">
                  <thead className="bg-slate-50 text-muted">
                    <tr>
                      <th className="px-4 py-3">{text.idTask}</th>
                      <th className="px-3 py-3">Feature</th>
                      <th className="px-3 py-3">{text.dependencies}</th>
                      <th className="px-3 py-3">{text.approval}</th>
                      <th className="px-3 py-3">Risk</th>
                      <th className="px-3 py-3">{text.schedulerJob}</th>
                      <th className="px-3 py-3">{text.currentRun}</th>
                      <th className="px-3 py-3">{text.workspace}</th>
                      <th className="px-4 py-3">{text.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {allTasks.map((task) => {
                      const job = findSchedulerJobForTask(schedulerJobs, task);
                      const dependencyBlocked = task.dependencies.some((dependency) => !dependency.satisfied);
                      const selected = selectedTask?.id === task.id;
                      return (
                        <tr key={task.id} className={selected ? "bg-blue-50/70" : "bg-white"}>
                          <td className="px-4 py-3 align-top">
                            <button type="button" onClick={() => setSelectedTaskId(task.id)} className="text-left">
                              <div className="font-mono text-[12px] font-semibold text-ink">{task.id}</div>
                              <div className="mt-1 max-w-[260px] truncate text-[13px] text-ink">{task.title}</div>
                              <div className="mt-1">
                                <Chip tone={statusTone[task.status] ?? "neutral"}>{task.status}</Chip>
                              </div>
                            </button>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="font-mono text-[12px] text-ink">{task.featureId ?? text.none}</div>
                            <div className="mt-1 max-w-[160px] truncate text-muted">{task.featureTitle ?? text.none}</div>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <Chip tone={dependencyBlocked ? "amber" : "green"}>
                              {dependencyBlocked ? text.dependencyBlocked : text.dependencyOk}
                            </Chip>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <Chip
                              tone={
                                task.approvalStatus === "approved" || task.approvalStatus === "not_required"
                                  ? "green"
                                  : "amber"
                              }
                            >
                              {task.approvalStatus}
                            </Chip>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <Chip tone={task.risk === "high" ? "red" : task.risk === "medium" ? "amber" : "neutral"}>
                              {task.risk}
                            </Chip>
                          </td>
                          <td className="px-3 py-3 align-top font-mono text-[11px] text-muted">{job?.id ?? text.none}</td>
                          <td className="px-3 py-3 align-top font-mono text-[11px] text-muted">
                            {task.runId ?? job?.runId ?? text.none}
                          </td>
                          <td className="px-3 py-3 align-top text-[11px] text-muted">
                            {job?.workspaceRoot ?? selectedInvocation?.workspaceRoot ?? text.none}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <Button
                              disabled={busy || task.action === "observe" || task.action === "review"}
                              onClick={() =>
                                onCommand(
                                  task.action === "run" ? "run_board_tasks" : "schedule_board_tasks",
                                  "feature",
                                  task.featureId ?? "feature",
                                  { taskIds: [task.id] },
                                )
                              }
                            >
                              {task.action === "run" ? <Play size={14} /> : <CalendarCheck size={14} />}
                              {task.action === "run"
                                ? text.run
                                : task.action === "schedule"
                                  ? text.schedule
                                  : text.observe}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {allTasks.length === 0 ? <EmptyState title={text.noRunnerTasks} /> : null}
            </div>
          </div>

          <aside className="border-l border-line bg-slate-50/70 p-4 max-xl:border-l-0 max-xl:border-t">
            <div className="space-y-4">
              <div className="rounded-lg border border-line bg-white">
                <SectionTitle
                  title={text.jobInspector}
                  action={
                    <Chip tone={statusTone[selectedJob?.status ?? ""] ?? "neutral"}>
                      {selectedJob?.status ?? text.none}
                    </Chip>
                  }
                />
                <div className="space-y-3 p-4 text-[12px]">
                  <FactList
                    rows={[
                      [text.schedulerJob, selectedJob?.id ?? text.none],
                      [text.bullmqJob, selectedJob?.bullmqJobId ?? text.none],
                      [text.queueName, selectedJob?.queueName ?? text.none],
                      [text.jobType, selectedJob?.jobType ?? text.none],
                      [text.target, selectedJob ? `${selectedJob.targetType}:${selectedJob.targetId ?? ""}` : text.none],
                      [text.currentRun, selectedJob?.runId ?? selectedTask?.runId ?? text.none],
                      [text.workspace, selectedJob?.workspaceRoot ?? selectedInvocation?.workspaceRoot ?? text.none],
                    ]}
                  />
                  {selectedJob?.error || selectedInvocation?.blockedReason || selectedTask?.blockedReasons?.[0] ? (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                      {selectedJob?.error ?? selectedInvocation?.blockedReason ?? selectedTask?.blockedReasons?.[0]}
                    </div>
                  ) : null}
                  {selectedInvocation?.evidenceSummary ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                      <div className="font-medium">{text.evidence}</div>
                      <div className="mt-1">{selectedInvocation.evidenceSummary}</div>
                    </div>
                  ) : null}
                  {selectedRecentLog ? (
                    <div className="rounded-md bg-slate-950 px-3 py-2 font-mono text-[11px] leading-5 text-slate-100">
                      {selectedRecentLog}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-line bg-white">
                <SectionTitle
                  title={text.runnerResources}
                  action={
                    <Chip tone={runner?.online ? "green" : "red"}>{runner?.online ? text.online : text.offline}</Chip>
                  }
                />
                {runner ? (
                  <div className="space-y-4 p-4">
                    <div className="rounded-md bg-emerald-50 p-3">
                      <div className="mb-2 flex items-center justify-between text-[12px] text-emerald-800">
                        <span>{text.heartbeat}</span>
                        <span>{runner.lastHeartbeatAt ?? text.none}</span>
                      </div>
                      <svg viewBox="0 0 180 76" className="h-20 w-full" aria-label="Runner heartbeat chart">
                        <polyline
                          fill="none"
                          stroke="#0f9f6e"
                          strokeWidth="3"
                          points="0,55 14,30 28,58 42,38 56,45 70,18 84,42 98,24 112,12 126,48 140,28 154,34 168,22 180,30"
                        />
                      </svg>
                    </div>
                    <FactList
                      rows={[
                        [text.model, runner.codexVersion ?? text.none],
                        [text.sandbox, runner.sandboxMode],
                        [text.approvalPolicy, runner.approvalPolicy],
                        [text.queueDepth, String(runner.queue.length)],
                      ]}
                    />
                    <div className="space-y-2">
                      {runner.queue.map((item) => (
                        <div
                          key={item.runId}
                          className="flex items-center justify-between rounded-md border border-line bg-white px-3 py-2 text-[13px]"
                        >
                          <span className="font-medium">{item.runId}</span>
                          <Chip tone={statusTone[item.status] ?? "neutral"}>{item.status}</Chip>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyState title={text.noRunner} />
                )}
              </div>

              <div className="rounded-lg border border-line bg-white">
                <SectionTitle
                  title={text.cliConfig}
                  action={
                    <Chip tone={data.runner.adapterSummary?.status === "active" ? "green" : "amber"}>
                      {data.runner.adapterSummary?.status ?? text.active}
                    </Chip>
                  }
                />
                <div className="space-y-3 p-4 text-[13px]">
                  <FactList
                    rows={[
                      [text.activeAdapter, data.runner.adapterSummary?.displayName ?? text.none],
                      [text.executable, data.runner.adapterSummary?.executable ?? text.none],
                      [text.dryRun, data.runner.adapterSummary?.lastDryRunStatus ?? text.none],
                    ]}
                  />
                  {(data.runner.adapterSummary?.lastDryRunErrors ?? []).length > 0 ? (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                      {data.runner.adapterSummary?.lastDryRunErrors[0]}
                    </div>
                  ) : null}
                  <Button onClick={onOpenSettings}>
                    <Settings size={14} />
                    {text.openSettings}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-line bg-white">
                <SectionTitle title={text.recentLogs} />
                <div className="space-y-2 p-4">
                  {(runner?.recentLogs ?? []).slice(0, 3).map((log) => (
                    <div
                      key={`${log.runId}-${log.createdAt}`}
                      className="rounded-md bg-slate-950 px-3 py-2 font-mono text-[11px] leading-5 text-slate-100"
                    >
                      <div className="text-slate-400">
                        {log.runId} · {log.createdAt}
                      </div>
                      <div>{log.stderr || log.stdout || text.none}</div>
                    </div>
                  ))}
                  {!runner || runner.recentLogs.length === 0 ? (
                    <div className="text-[13px] text-muted">{text.none}</div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-line bg-white">
                <SectionTitle title={text.recentTriggers} />
                <div className="space-y-2 p-4">
                  {(data.runner.recentTriggers ?? []).slice(0, 5).map((trigger) => (
                    <div key={trigger.id} className="rounded-md border border-line px-3 py-2 text-[12px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">{trigger.action}</span>
                        <Chip
                          tone={
                            trigger.result === "accepted"
                              ? "green"
                              : trigger.result === "blocked"
                                ? "red"
                                : "blue"
                          }
                        >
                          {trigger.result}
                        </Chip>
                      </div>
                      <div className="mt-1 text-muted">
                        {trigger.target} · {trigger.createdAt}
                      </div>
                    </div>
                  ))}
                  {(data.runner.recentTriggers ?? []).length === 0 ? (
                    <div className="text-[13px] text-muted">{text.none}</div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-line bg-white">
                <SectionTitle title={text.skillInvocations} />
                <div className="space-y-2 p-4">
                  {(data.runner.skillInvocations ?? []).slice(0, 5).map((item) => (
                    <div key={item.runId} className="rounded-md border border-line px-3 py-2 text-[12px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">{item.skillSlug ?? item.skillPhase ?? item.runId}</span>
                        <Chip tone={statusTone[item.status] ?? "neutral"}>{item.status}</Chip>
                      </div>
                      <div className="mt-1 text-muted">
                        {item.runId}
                        {item.schedulerJobId ? ` · ${item.schedulerJobId}` : ""}
                      </div>
                      <FactList
                        rows={[
                          [text.workspace, item.workspaceRoot ?? text.none],
                          [text.skillPhase, item.skillPhase ?? text.none],
                        ]}
                      />
                      {item.blockedReason ? (
                        <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-red-700">{item.blockedReason}</div>
                      ) : null}
                      {item.evidenceSummary ? <div className="mt-2 text-muted">{item.evidenceSummary}</div> : null}
                    </div>
                  ))}
                  {(data.runner.skillInvocations ?? []).length === 0 ? (
                    <div className="text-[13px] text-muted">{text.none}</div>
                  ) : null}
                </div>
              </div>
            </div>
          </aside>
        </div>
        <div className="border-t border-line bg-white px-4 py-3 text-[12px] text-muted">
          {data.runner.factSources?.join("、") ?? text.factSourcesRunner}
        </div>
      </Panel>
    </div>
  );
}
