import {
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  ExternalLink,
  FileText,
  GitBranch,
  ShieldAlert,
  Workflow,
  XCircle,
} from "lucide-react";
import type { UiStrings } from "../lib/i18n";
import { formatPrecisePercent, metricIconBg, metricIconColor, statusTone } from "../lib/utils";
import type { ConsoleData } from "../types";
import { Button, Chip, EmptyState, Panel, SectionTitle } from "../components/ui/primitives";
import { StatusDot } from "../components/ui/helpers";

function TaskCount({ label, value, tone }: { label: string; value: number; tone: "neutral" | "green" | "red" | "blue" }) {
  const color =
    tone === "green"
      ? "text-emerald-600"
      : tone === "red"
        ? "text-red-600"
        : tone === "blue"
          ? "text-action"
          : "text-slate-700";
  return (
    <div>
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`mt-1 font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function signalTitle(value: string, text: UiStrings): string {
  if (value === "pending_reviews") return text.pendingReviews;
  if (value === "blocked_tasks") return text.blockedTasks;
  if (value === "runner_health") return `${text.runner} ${text.healthy}`;
  return value;
}

function mergeOverviewProjects(data: ConsoleData): ConsoleData["overview"]["projects"] {
  const overviewById = new Map(data.overview.projects.map((project) => [project.id, project]));
  return data.projects.projects.map(
    (project) =>
      overviewById.get(project.id) ?? {
        id: project.id,
        name: project.name,
        health: project.health,
        repository: project.repository,
        projectDirectory: project.projectDirectory,
        defaultBranch: project.defaultBranch,
        taskCounts: {},
        failedTasks: 0,
        pendingReviews: 0,
        activeRuns: 0,
        runnerSuccessRate: 0,
        costUsd: 0,
        lastActivityAt: project.lastActivityAt,
      },
  );
}

export function OverviewPage({
  data,
  text,
  currentProjectId,
  onSelectProject,
  onViewBoard,
}: {
  data: ConsoleData;
  text: UiStrings;
  currentProjectId: string;
  onSelectProject: (projectId: string) => void;
  onViewBoard: (projectId: string) => void;
}) {
  const overviewProjects = mergeOverviewProjects(data);
  const summary = data.overview.summary;
  const metrics = [
    { label: text.totalProjects, value: String(summary.totalProjects), icon: FileText, tone: "blue" },
    { label: text.healthyProjects, value: String(summary.healthyProjects), icon: CheckCircle2, tone: "green" },
    {
      label: text.blockedProjects,
      value: String(summary.blockedProjects),
      icon: ShieldAlert,
      tone: summary.blockedProjects > 0 ? "amber" : "neutral",
    },
    {
      label: text.failedTasks,
      value: String(summary.failedTasks),
      icon: XCircle,
      tone: summary.failedTasks > 0 ? "red" : "green",
    },
    {
      label: text.pendingReviews,
      value: String(summary.pendingReviews),
      icon: ClipboardList,
      tone: summary.pendingReviews > 0 ? "amber" : "green",
    },
    { label: text.onlineRunners, value: String(summary.onlineRunners), icon: Workflow, tone: "blue" },
    { label: text.totalCost, value: `$${summary.totalCostUsd.toFixed(2)}`, icon: CircleDollarSign, tone: "neutral" },
  ] as const;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-normal text-ink">{text.globalOverview}</h1>
        <p className="mt-2 text-[14px] text-muted">{text.globalOverviewSubtitle}</p>
      </div>

      <Panel className="grid grid-cols-7 divide-x divide-line max-2xl:grid-cols-4 max-2xl:divide-x-0 max-2xl:divide-y max-lg:grid-cols-2 max-sm:grid-cols-1">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="flex min-h-[102px] items-center gap-4 px-5 py-4">
              <div className={`grid size-10 shrink-0 place-items-center rounded-md ${metricIconBg(metric.tone)}`}>
                <Icon size={20} className={metricIconColor(metric.tone)} />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] text-muted">{metric.label}</div>
                <div className="mt-1 truncate text-[22px] font-semibold tracking-normal">{metric.value}</div>
              </div>
            </div>
          );
        })}
      </Panel>

      <Panel className="overflow-hidden">
        <SectionTitle title={text.projectOverview} />
        {overviewProjects.length > 0 ? (
          <>
            <div className="scrollbar-thin overflow-auto">
              <table className="w-full min-w-[1220px] border-collapse text-left text-[13px]">
                <thead className="border-b border-line bg-slate-50 text-[12px] font-medium text-muted">
                  <tr>
                    <th className="px-4 py-3">{text.project}</th>
                    <th className="px-4 py-3">{text.status}</th>
                    <th className="px-4 py-3">{text.defaultBranch}</th>
                    <th className="px-4 py-3">{text.projectDirectory}</th>
                    <th className="px-4 py-3">{text.activeFeature}</th>
                    <th className="px-4 py-3">{text.taskSummary}</th>
                    <th className="px-4 py-3">{text.pendingReviews}</th>
                    <th className="px-4 py-3">{text.activeRunsShort}</th>
                    <th className="px-4 py-3">{text.runnerSuccessShort}</th>
                    <th className="px-4 py-3">{text.costUsd}</th>
                    <th className="px-4 py-3">{text.latestRisk}</th>
                    <th className="px-4 py-3">{text.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewProjects.map((project) => {
                    const selected = project.id === currentProjectId;
                    return (
                      <tr
                        key={project.id}
                        className={`cursor-pointer border-b border-line last:border-0 ${selected ? "bg-blue-50/80 ring-1 ring-inset ring-blue-200" : "hover:bg-slate-50"}`}
                        onClick={() => onSelectProject(project.id)}
                      >
                        <td className="px-4 py-4 align-top">
                          <div className="flex min-w-[180px] items-start gap-2">
                            <span className={`mt-1 text-[16px] ${selected ? "text-action" : "text-slate-300"}`}>★</span>
                            <div>
                              <div className="font-semibold text-action">{project.name}</div>
                              <div className="mt-1 max-w-[220px] truncate text-[12px] text-muted">
                                {project.repository || text.none}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <Chip tone={project.health === "ready" ? "green" : project.health === "failed" ? "red" : "amber"}>
                            {project.health === "ready" ? text.healthy : project.health}
                          </Chip>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <span className="inline-flex items-center gap-1 text-[12px] text-slate-700">
                            <GitBranch size={13} />
                            {project.defaultBranch}
                          </span>
                        </td>
                        <td className="max-w-[170px] px-4 py-4 align-top text-[12px] text-slate-700">
                          <span className="line-clamp-2 break-all">{project.projectDirectory || text.none}</span>
                        </td>
                        <td className="max-w-[180px] px-4 py-4 align-top">{project.activeFeature?.title ?? text.none}</td>
                        <td className="px-4 py-4 align-top">
                          <div className="grid min-w-[190px] grid-cols-5 gap-1 text-center text-[12px]">
                            <TaskCount label="Ready" value={project.taskCounts.ready ?? 0} tone="neutral" />
                            <TaskCount label="Running" value={project.taskCounts.running ?? 0} tone="blue" />
                            <TaskCount label="Blocked" value={project.taskCounts.blocked ?? 0} tone="red" />
                            <TaskCount label="Failed" value={project.failedTasks} tone="red" />
                            <TaskCount label="Done" value={project.taskCounts.done ?? 0} tone="green" />
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-amber-600">{project.pendingReviews}</td>
                        <td className="px-4 py-4 align-top">{project.activeRuns}</td>
                        <td className="px-4 py-4 align-top text-emerald-600">{formatPrecisePercent(project.runnerSuccessRate)}</td>
                        <td className="px-4 py-4 align-top">${project.costUsd.toFixed(2)}</td>
                        <td className="max-w-[220px] px-4 py-4 align-top text-[12px] text-slate-700">
                          {project.latestRisk?.message ?? text.none}
                        </td>
                        <td className="px-4 py-4 align-top">
                          <Button
                            onClick={(event) => {
                              event.stopPropagation();
                              onViewBoard(project.id);
                            }}
                          >
                            {text.viewBoard}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[12px] text-muted">
              <span>{text.itemsTotal(overviewProjects.length)}</span>
              <span>{data.overview.factSources.join(", ")}</span>
            </div>
          </>
        ) : (
          <EmptyState title={text.noFeatureSpecs} />
        )}
      </Panel>

      <Panel>
        <SectionTitle
          title={text.riskAndExecutionSignals}
          action={
            <Button tone="quiet">
              {text.viewAll}
              <ExternalLink size={13} />
            </Button>
          }
        />
        <div className="divide-y divide-line">
          {data.overview.signals.map((signal) => (
            <div key={signal.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <StatusDot status={signal.tone === "red" ? "failed" : signal.tone === "amber" ? "review_needed" : "running"} />
              <div className="min-w-[170px] font-semibold">{signalTitle(signal.title, text)}</div>
              <Chip tone={signal.tone}>
                {signal.tone === "blue" ? text.runningLane : signal.tone === "red" ? text.risk : text.pendingReviews}
              </Chip>
              <div className="min-w-0 flex-1 text-[13px] text-muted">{signal.message}</div>
              <Button tone="quiet">
                {text.viewDetails}
                <ExternalLink size={13} />
              </Button>
              <div className="w-16 text-right text-[12px] text-muted">{signal.updatedAt ?? text.justNow}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
