import {
  Bot,
  CalendarCheck,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Code2,
  ExternalLink,
  FileText,
  GitBranch,
  Home,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SquareKanban,
  Workflow,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { UiStrings } from "../lib/i18n";
import { formatPrecisePercent, statusTone } from "../lib/utils";
import type { BoardTask, CommandReceipt, ConsoleData, ProjectSummary } from "../types";
import { Button, Chip, EmptyState, Panel, SectionTitle } from "../components/ui/primitives";
import { DiffCell, FactList, InspectorBlock, StatusDot, TestCell } from "../components/ui/helpers";

type OnCommand = (
  action: CommandReceipt["action"],
  entityType: string,
  entityId: string,
  payload?: Record<string, unknown>,
) => void;

function SectionKicker({ icon: Icon, label }: { icon: typeof Home; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-medium text-muted">
      <Icon size={15} />
      {label}
    </div>
  );
}

function taskDisplayName(task: BoardTask): string {
  return task.name || task.title || task.id;
}

function ProjectHomeOverview({ data, text, project }: { data: ConsoleData; text: UiStrings; project: ProjectSummary }) {
  const activeFeature = data.dashboard.activeFeatures[0];
  const latestPr = data.dashboard.recentPullRequests[0];
  const runner = data.runner.runners[0];
  return (
    <Panel>
      <div className="grid grid-cols-4 divide-x divide-line max-2xl:grid-cols-2 max-2xl:divide-x-0 max-2xl:divide-y max-md:grid-cols-1">
        <div className="space-y-4 p-4">
          <SectionKicker icon={Home} label={text.projectIdentity} />
          <div>
            <div className="text-[20px] font-semibold tracking-normal">{project.name}</div>
            <div className="mt-3 text-[12px] font-medium text-muted">{text.repository}</div>
            <a className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[13px] font-medium text-action" href="#">
              <GitBranch size={14} />
              {project.repository}
              <ExternalLink size={12} />
            </a>
            <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[12px] font-medium text-blue-700">
              <GitBranch size={13} />
              {project.defaultBranch}
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <SectionKicker icon={CheckCircle2} label={text.latestActivity} />
          <div className="flex items-start gap-2">
            <StatusDot status={latestPr ? "done" : project.health} />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-ink">
                {latestPr ? `${latestPr.id} merged` : project.lastActivityAt}
              </div>
              <div className="mt-1 text-[12px] leading-5 text-muted">{latestPr?.title ?? project.projectDirectory}</div>
            </div>
          </div>
          <div className="text-[12px] text-muted">{latestPr?.createdAt ?? project.lastActivityAt}</div>
        </div>

        <div className="space-y-4 p-4">
          <SectionKicker icon={Code2} label={text.currentActiveFeature} />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="break-words text-[18px] font-semibold tracking-normal">{activeFeature?.title ?? text.none}</div>
              <a className="mt-3 inline-flex max-w-full items-center gap-1 truncate text-[13px] font-medium text-action" href="#">
                <FileText size={14} />
                docs/features/{activeFeature?.id.toLowerCase() ?? "none"}
              </a>
              <div className="mt-3 text-[12px] text-muted">
                {text.owner}: {text.operator}
              </div>
            </div>
            <Chip tone={statusTone[activeFeature?.status ?? ""] ?? "neutral"}>{activeFeature?.status ?? text.none}</Chip>
          </div>
        </div>

        <div className="space-y-4 p-4">
          <SectionKicker icon={ShieldCheck} label={text.projectHealth} />
          <div className="flex items-center gap-2 text-[18px] font-semibold text-emerald-700">
            <CheckCircle2 size={20} />
            {project.health === "ready" ? text.healthy : project.health}
          </div>
          <div className="border-t border-line pt-4">
            <div className="text-[12px] font-medium text-muted">{text.automationStatus}</div>
            <div className="mt-2 flex items-center gap-2 text-[16px] font-semibold text-emerald-700">
              <Play size={18} />
              {runner?.online ? text.runningLane : text.offline}
            </div>
            <div className="mt-1 text-[12px] text-muted">
              {text.runner}: {runner?.runnerId ?? text.none}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ProjectHomeMetrics({ data, text }: { data: ConsoleData; text: UiStrings }) {
  const boardTotal = Object.values(data.dashboard.boardCounts).reduce((total, count) => total + count, 0);
  const boardBreakdown = Object.entries(data.dashboard.boardCounts)
    .filter(([, count]) => count > 0)
    .slice(0, 3);
  const items = [
    {
      icon: SquareKanban,
      label: text.taskBoardCounts,
      value: String(boardTotal || data.board.tasks.length),
      sub: boardBreakdown.map(([status, count]) => `${count} ${status}`).join(" · ") || text.noBoardTasks,
      tone: "blue",
    },
    { icon: Bot, label: text.activeRunsShort, value: String(data.dashboard.activeRuns), sub: text.active, tone: "neutral" },
    {
      icon: Workflow,
      label: text.runnerSuccess,
      value: formatPrecisePercent(data.dashboard.runner.successRate),
      sub: text.lastSevenDays,
      tone: "green",
    },
    {
      icon: ClipboardList,
      label: text.pendingReviews,
      value: String(data.dashboard.pendingApprovals),
      sub: text.requireAction,
      tone: "amber",
    },
    {
      icon: ShieldAlert,
      label: text.failedTasks,
      value: String(data.dashboard.failedTasks.length),
      sub: text.lastSevenDays,
      tone: data.dashboard.failedTasks.length > 0 ? "red" : "green",
    },
    {
      icon: CircleDollarSign,
      label: text.costMtd,
      value: `$${data.dashboard.cost.totalUsd.toFixed(2)}`,
      sub: `${data.dashboard.cost.tokensUsed.toLocaleString()} tokens`,
      tone: "neutral",
    },
  ] as const;
  return (
    <Panel>
      <div className="grid grid-cols-6 divide-x divide-line max-2xl:grid-cols-3 max-2xl:divide-x-0 max-2xl:divide-y max-md:grid-cols-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="min-w-0 p-4">
              <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-muted">
                <Icon
                  size={16}
                  className={
                    item.tone === "red"
                      ? "text-red-600"
                      : item.tone === "amber"
                        ? "text-amber-600"
                        : item.tone === "green"
                          ? "text-emerald-600"
                          : item.tone === "blue"
                            ? "text-action"
                            : "text-slate-500"
                  }
                />
                <span className="truncate">{item.label}</span>
              </div>
              <div className="text-[28px] font-semibold leading-none tracking-normal">{item.value}</div>
              <div className="mt-2 min-h-8 text-[12px] leading-4 text-muted">{item.sub}</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function ProjectHomeListPanel({
  title,
  rows,
  empty,
  footer,
}: {
  title: string;
  rows: Array<{ id: string; title: string; meta: string; tone: "green" | "amber" | "red" | "blue"; href?: string }>;
  empty: string;
  footer: string;
}) {
  return (
    <Panel>
      <SectionTitle title={title} />
      <div className="space-y-2 p-3">
        {rows.length > 0 ? (
          rows.map((row) => {
            const indicatorClass =
              row.tone === "green"
                ? "text-emerald-600"
                : row.tone === "amber"
                  ? "text-amber-600"
                  : row.tone === "red"
                    ? "text-red-600"
                    : "text-action";
            return (
              <a
                key={`${row.id}-${row.title}`}
                href={row.href ?? "#"}
                className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-line bg-white px-3 py-2 text-[12px] hover:bg-slate-50"
              >
                <span className={`font-semibold ${indicatorClass}`}>{row.id}</span>
                <span className="truncate text-ink">{row.title}</span>
                <span className="whitespace-nowrap text-muted">{row.meta}</span>
              </a>
            );
          })
        ) : (
          <div className="px-2 py-6 text-center text-[13px] text-muted">{empty}</div>
        )}
      </div>
      <div className="border-t border-line px-4 py-2 text-[12px] font-medium text-action">{footer}</div>
    </Panel>
  );
}

function ProjectHomeActivity({ data, text }: { data: ConsoleData; text: UiStrings }) {
  const evidenceRows = [
    ...data.reviews.items.flatMap((item) =>
      item.evidence.map((entry) => ({ id: entry.id, summary: entry.summary, meta: item.id, path: entry.path })),
    ),
  ].slice(0, 3);
  return (
    <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-1">
      <ProjectHomeListPanel
        title={text.currentRisks}
        empty={text.noRisks}
        footer={text.viewAllRisks}
        rows={data.dashboard.risks.slice(0, 3).map((risk) => ({
          id: risk.source,
          title: risk.message,
          meta: risk.level,
          tone: risk.level === "high" ? "red" : "amber",
        }))}
      />
      <ProjectHomeListPanel
        title={text.recentPrs}
        empty={text.noPullRequests}
        footer={text.viewAllPrs}
        rows={data.dashboard.recentPullRequests.slice(0, 3).map((pr) => ({
          id: pr.id,
          title: pr.title,
          meta: pr.createdAt ?? text.none,
          tone: "green",
          href: pr.url,
        }))}
      />
      <ProjectHomeListPanel
        title={text.recentEvidenceEvents}
        empty={text.noEvidenceEvents}
        footer={text.viewAllEvidence}
        rows={evidenceRows.map((entry) => ({
          id: entry.id,
          title: entry.summary,
          meta: entry.meta,
          tone: "blue",
          href: entry.path,
        }))}
      />
    </div>
  );
}

function BoardPanel({
  tasks,
  text,
  selectedTask,
  onSelectTask,
  onCommand,
  busy,
  compact = false,
}: {
  tasks: BoardTask[];
  text: UiStrings;
  selectedTask?: BoardTask;
  onSelectTask: (id: string) => void;
  onCommand: OnCommand;
  busy: boolean;
  compact?: boolean;
}) {
  if (tasks.length === 0) {
    return (
      <Panel>
        <SectionTitle title={text.taskBoard} />
        <EmptyState title={text.noBoardTasks} />
      </Panel>
    );
  }
  const targetTask = selectedTask ?? tasks[0];
  const targetFeatureId = targetTask.featureId ?? "demo-feature";
  return (
    <Panel>
      <SectionTitle
        title={text.taskBoard}
        action={
          <div className="flex items-center gap-2">
            {!compact ? <Button tone="quiet">{text.taskBoardGroup}</Button> : null}
            <div className="hidden h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-[13px] text-muted md:flex">
              <Search size={15} />
              {compact ? text.searchTasks : text.filter}
            </div>
            <Button
              onClick={() =>
                onCommand("schedule_board_tasks", "feature", targetFeatureId, { taskIds: [targetTask.id] })
              }
            >
              {text.schedule}
            </Button>
            <Button
              tone="primary"
              disabled={busy}
              onClick={() => onCommand("run_board_tasks", "feature", targetFeatureId, { taskIds: [targetTask.id] })}
            >
              {busy ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />}
              {text.run}
            </Button>
          </div>
        }
      />
      <div className="scrollbar-thin overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
          <thead className="border-b border-line bg-slate-50 text-[12px] font-medium text-muted">
            <tr>
              <th className="px-4 py-3">{text.idTask}</th>
              <th className="px-4 py-3">{text.dependencies}</th>
              <th className="px-4 py-3">{text.diff}</th>
              <th className="px-4 py-3">{text.tests}</th>
              <th className="px-4 py-3">{text.approval}</th>
              <th className="px-4 py-3">{text.recovery}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.slice(0, compact ? 5 : 12).map((task) => (
              <tr
                key={task.id}
                className={`cursor-pointer border-b border-line last:border-0 ${selectedTask?.id === task.id ? "bg-blue-50/70" : "hover:bg-slate-50"}`}
                onClick={() => onSelectTask(task.id)}
              >
                <td className="px-4 py-3">
                  <div className="font-medium">
                    <span className="text-ink">{taskDisplayName(task)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-muted">
                    <StatusDot status={task.status} />
                    {task.id} · {task.status} · {task.risk} {text.risk}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    {task.dependencies.length > 0
                      ? task.dependencies.map((dependency) => (
                          <div key={dependency.id} className="flex items-center gap-2">
                            <StatusDot status={dependency.satisfied ? "done" : "pending"} />
                            {dependency.id}
                          </div>
                        ))
                      : text.none}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <DiffCell value={task.diff} />
                </td>
                <td className="px-4 py-3">
                  <TestCell value={task.testResults} />
                </td>
                <td className="px-4 py-3">
                  <Chip tone={statusTone[task.approvalStatus] ?? "neutral"}>{task.approvalStatus}</Chip>
                </td>
                <td className="px-4 py-3">
                  {task.recoveryHistory.length > 0 ? (
                    <Button tone="quiet">
                      <RefreshCw size={14} />
                      {text.retry}
                    </Button>
                  ) : (
                    <span className="text-muted">--</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[12px] text-muted">
        <span>{text.ofTasks(1, Math.min(tasks.length, compact ? 5 : 12), tasks.length)}</span>
        <span>{text.factSources}</span>
      </div>
    </Panel>
  );
}

function CommandFeedback({ task, text, receipt }: { task?: BoardTask; text: UiStrings; receipt?: CommandReceipt }) {
  const blockedReasons = receipt?.blockedReasons ?? task?.blockedReasons ?? [
    "Selected task is waiting for dependency completion.",
  ];
  const blocked = receipt?.status === "blocked" || blockedReasons.length > 0;
  return (
    <Panel className={blocked ? "border-red-200" : ""}>
      <SectionTitle
        title={text.commandFeedback}
        action={<Chip tone={blocked ? "red" : "green"}>{blocked ? text.blocked : text.accepted}</Chip>}
      />
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className={blocked ? "text-red-600" : "text-emerald-600"} size={20} />
          <div>
            <div className="text-[14px] font-semibold">{blocked ? text.boardRunBlocked : text.commandAccepted}</div>
            <div className="mt-1 text-[13px] text-muted">
              {blockedReasons[0] ?? `${text.commandAccepted}: ${task?.id ?? text.selectedTask}.`}
            </div>
          </div>
        </div>
        <div className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-600">
          <div>
            {text.requestedBy}: {text.operator}
          </div>
          <div>
            {text.command}: run board --task {task?.id ?? "selected-task"}
          </div>
          <div>
            {text.runner}: runner-01
          </div>
        </div>
      </div>
    </Panel>
  );
}

function TaskInspector({
  task,
  text,
  onCommand,
  busy,
}: {
  task?: BoardTask;
  text: UiStrings;
  onCommand: OnCommand;
  busy: boolean;
}) {
  if (!task) {
    return (
      <Panel>
        <SectionTitle title={text.taskDetail} />
        <EmptyState title={text.selectTask} />
      </Panel>
    );
  }
  const targetFeatureId = task.featureId ?? "feature";
  const executionSteps = [
    `${text.dependencies}: ${task.dependencies.map((item) => item.id).join(", ") || text.none}`,
    `${text.approval}: ${task.approvalStatus}`,
    `${text.tests}: ${(task.testResults as { command?: string } | undefined)?.command ?? text.none}`,
    task.blockedReasons[0] ?? `${text.moveToRunning}: ${task.id}`,
  ];
  return (
    <Panel className="sticky top-20 overflow-hidden max-xl:static">
      <div className="flex min-h-14 items-center justify-between border-b border-line px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[18px] font-semibold tracking-normal">{taskDisplayName(task)}</h2>
            <Chip tone={statusTone[task.status] ?? "neutral"}>{task.status}</Chip>
          </div>
          <div className="mt-1 truncate text-[13px] text-muted">{task.id}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 border-b border-line text-center text-[12px] text-muted">
        {["Details", "Logs", "Artifacts", "State"].map((tab, index) => (
          <button
            key={tab}
            className={`h-10 border-b-2 ${index === 0 ? "border-action font-medium text-action" : "border-transparent"}`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="space-y-5 p-4 text-[13px]">
        <InspectorBlock title={text.blockedReasons}>
          <div className="space-y-2">
            {(task.blockedReasons.length > 0 ? task.blockedReasons : [text.none]).map((reason) => (
              <div key={reason} className="rounded-md border border-line bg-white px-3 py-2">
                <div className="flex items-start gap-2">
                  <XCircle className={reason === text.none ? "text-slate-400" : "text-red-600"} size={15} />
                  <span className="leading-5">{reason}</span>
                </div>
              </div>
            ))}
          </div>
        </InspectorBlock>

        <InspectorBlock title={text.dependencyFacts}>
          <div className="rounded-md border border-line">
            {task.dependencies.length > 0 ? (
              task.dependencies.map((dependency) => (
                <div
                  key={dependency.id}
                  className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-0"
                >
                  <span className="font-medium">{dependency.id}</span>
                  <span className={dependency.satisfied ? "text-emerald-700" : "text-red-600"}>
                    {dependency.satisfied ? text.acceptedStatus : text.blocked}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-3 py-2 text-muted">{text.none}</div>
            )}
          </div>
        </InspectorBlock>

        <InspectorBlock title={text.approvalState}>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-md border border-line px-3 py-2">
              <span>{text.approval}</span>
              <Chip tone={statusTone[task.approvalStatus] ?? "neutral"}>{task.approvalStatus}</Chip>
            </div>
            <div className="flex items-center justify-between rounded-md border border-line px-3 py-2">
              <span>{text.risk}</span>
              <Chip tone={task.risk === "high" ? "red" : task.risk === "medium" ? "amber" : "green"}>{task.risk}</Chip>
            </div>
          </div>
        </InspectorBlock>

        <InspectorBlock title={text.executionPlanNext}>
          <ol className="list-decimal space-y-2 pl-5 text-[12px] leading-5 text-muted">
            {executionSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </InspectorBlock>

        <div className="space-y-3 pt-1">
          <Button
            className="w-full"
            tone="primary"
            disabled={busy}
            onClick={() => onCommand("move_board_task", "task", task.id, { targetStatus: "running" })}
          >
            <Play size={15} />
            {text.moveToRunning}
          </Button>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                onCommand("schedule_board_tasks", "feature", targetFeatureId, { taskIds: [task.id] })
              }
            >
              <CalendarCheck size={15} />
              {text.scheduleMore}
            </Button>
            <Button aria-label={text.actions}>
              <ExternalLink size={15} />
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function BoardPage({
  data,
  text,
  project,
  selectedTask,
  onSelectTask,
  onCommand,
  busy,
}: {
  data: ConsoleData;
  text: UiStrings;
  project: ProjectSummary;
  selectedTask?: BoardTask;
  onSelectTask: (id: string) => void;
  onCommand: OnCommand;
  busy: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5 max-xl:grid-cols-1">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="text-[24px] font-semibold tracking-normal text-ink">{text.projectHome}</h1>
          <span className="pb-1 text-[13px] text-muted">{text.projectHomeSecondary}</span>
        </div>
        <ProjectHomeOverview data={data} text={text} project={project} />
        <ProjectHomeMetrics data={data} text={text} />
        <ProjectHomeActivity data={data} text={text} />
        <BoardPanel
          tasks={data.board.tasks}
          text={text}
          selectedTask={selectedTask}
          onSelectTask={onSelectTask}
          onCommand={onCommand}
          busy={busy}
        />
      </div>
      <TaskInspector task={selectedTask} text={text} onCommand={onCommand} busy={busy} />
    </div>
  );
}
