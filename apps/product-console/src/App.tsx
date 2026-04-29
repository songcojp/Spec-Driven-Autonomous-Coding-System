import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import * as Toast from "@radix-ui/react-toast";
import {
  Bell,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Code2,
  FileText,
  GitBranch,
  Home,
  LayoutDashboard,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SquareKanban,
} from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { fetchConsoleData, submitCommand } from "./lib/api";
import { demoData, emptyData } from "./lib/demo-data";
import type { BoardTask, CommandReceipt, ConsoleData } from "./types";
import { Button, Chip, EmptyState, Panel, SectionTitle } from "./components/ui/primitives";

type DataMode = "live" | "empty" | "error";
type ViewKey = "dashboard" | "board" | "spec" | "skills" | "subagents" | "runner" | "reviews";

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Home }> = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "board", label: "Board", icon: SquareKanban },
  { key: "spec", label: "Spec Workspace", icon: FileText },
  { key: "skills", label: "Skill Center", icon: Boxes },
  { key: "subagents", label: "Subagents", icon: Bot },
  { key: "runner", label: "Runner", icon: Play },
  { key: "reviews", label: "Reviews", icon: ClipboardList },
];

const statusTone: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  approved: "green",
  done: "green",
  ready: "green",
  running: "blue",
  scheduled: "blue",
  pending: "amber",
  review_needed: "amber",
  blocked: "red",
  failed: "red",
};

export function App() {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [mode, setMode] = useState<DataMode>("live");
  const [data, setData] = useState<ConsoleData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [selectedTaskId, setSelectedTaskId] = useState("T-129");
  const [receipt, setReceipt] = useState<CommandReceipt | undefined>();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    if (mode === "empty") {
      setData(emptyData);
      setError(undefined);
      return;
    }
    if (mode === "error") {
      setData(undefined);
      setError("Control Plane API returned a simulated failure.");
      return;
    }
    setError(undefined);
    fetchConsoleData()
      .then((nextData) => {
        if (!cancelled) {
          setData(nextData);
        }
      })
      .catch((nextError: Error) => {
        if (!cancelled) {
          setData(demoData);
          setError(`Live API unavailable; showing seeded console data. ${nextError.message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const currentData = data ?? demoData;
  const selectedTask = useMemo(
    () => currentData.board.tasks.find((task) => task.id === selectedTaskId) ?? currentData.board.tasks[0],
    [currentData.board.tasks, selectedTaskId],
  );

  async function runCommand(action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) {
    startTransition(async () => {
      try {
        const nextReceipt = await submitCommand({
          action,
          entityType,
          entityId,
          reason: action === "run_board_tasks" ? "Run selected board task from Product Console." : `Operator requested ${action}.`,
          payload,
        });
        setReceipt(nextReceipt);
      } catch (nextError) {
        setReceipt({
          id: "local-error",
          action,
          status: "blocked",
          entityType,
          entityId,
          acceptedAt: new Date().toISOString(),
          blockedReasons: [nextError instanceof Error ? nextError.message : String(nextError)],
        });
      }
    });
  }

  return (
    <Toast.Provider swipeDirection="right">
      <div className="console-shell grid min-h-screen grid-cols-[220px_1fr] bg-canvas text-ink">
        <aside className="console-sidebar sticky top-0 h-screen border-r border-line bg-white">
          <div className="flex h-16 items-center gap-3 border-b border-line px-5">
            <div className="grid size-8 place-items-center rounded-md border border-slate-300 text-action">
              <Code2 size={18} strokeWidth={2.2} />
            </div>
            <div className="whitespace-nowrap text-[15px] font-semibold">SpecDrive Console</div>
          </div>
          <nav className="space-y-1 p-2" aria-label="Console navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.key === view;
              return (
                <button
                  key={item.key}
                  className={`flex h-11 w-full items-center gap-3 rounded-md px-4 text-left text-[14px] transition-colors ${
                    active ? "bg-blue-50 text-action" : "text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => setView(item.key)}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-line bg-slate-50 p-3">
            <div className="text-[13px] font-semibold">AutoBuild Team</div>
            <div className="mt-1 text-[12px] text-muted">Operator</div>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-6">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-[12px] text-muted">Project</div>
                <div className="flex items-center gap-2 text-[15px] font-semibold">
                  AutoBuild Platform
                  <ChevronDown size={15} />
                </div>
              </div>
              <Button className="h-8">
                <GitBranch size={14} />
                main
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <select
                className="h-9 rounded-md border border-line bg-white px-3 text-[13px]"
                aria-label="Data state"
                value={mode}
                onChange={(event) => setMode(event.target.value as DataMode)}
              >
                <option value="live">Live data</option>
                <option value="empty">Empty state</option>
                <option value="error">Error state</option>
              </select>
              <Chip tone="green">Healthy</Chip>
              <Bell size={18} />
              <div className="grid size-9 place-items-center rounded-full bg-slate-100 text-[13px] font-semibold">OP</div>
            </div>
          </header>

          <div className="space-y-5 p-5 pb-14">
            {error ? <StatusBanner message={error} /> : null}
            <MetricsStrip data={currentData} onCreateFeature={() => runCommand("create_feature", "project", "project-1")} />

            <Tabs.Root value={view} onValueChange={(value) => setView(value as ViewKey)}>
              <Tabs.List className="sr-only" aria-label="Console pages">
                {navItems.map((item) => <Tabs.Trigger key={item.key} value={item.key}>{item.label}</Tabs.Trigger>)}
              </Tabs.List>
              <Tabs.Content value="dashboard">
                <DashboardView data={currentData} selectedTask={selectedTask} onSelectTask={setSelectedTaskId} onCommand={runCommand} busy={isPending} receipt={receipt} />
              </Tabs.Content>
              <Tabs.Content value="board">
                <BoardView data={currentData} selectedTask={selectedTask} onSelectTask={setSelectedTaskId} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
              <Tabs.Content value="spec">
                <SpecWorkspace data={currentData} onCommand={runCommand} />
              </Tabs.Content>
              <Tabs.Content value="skills">
                <SkillCenter data={currentData} />
              </Tabs.Content>
              <Tabs.Content value="subagents">
                <Subagents data={currentData} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
              <Tabs.Content value="runner">
                <Runner data={currentData} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
              <Tabs.Content value="reviews">
                <Reviews data={currentData} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
            </Tabs.Root>
          </div>
          <footer className="fixed bottom-0 left-[220px] right-0 hidden h-10 items-center justify-between border-t border-line bg-white px-6 text-[12px] text-muted lg:flex">
            <div className="flex items-center gap-8">
              <span>Git: main <span className="text-emerald-600">✓</span></span>
              <span>Commit: a1b2c3d</span>
              <span><span className="mr-2 inline-block size-2 rounded-full bg-emerald-500" />Runner: online</span>
              <span>Last sync: 2m ago</span>
            </div>
            <div className="flex items-center gap-3">
              <span>Auto-refresh</span>
              <span className="inline-flex h-5 w-9 items-center rounded-full bg-action p-0.5"><span className="ml-auto size-4 rounded-full bg-white" /></span>
            </div>
          </footer>
        </main>
      </div>
      {receipt ? (
        <Toast.Root className="fixed bottom-5 right-5 z-50 w-96 rounded-lg border border-line bg-white p-4 shadow-panel">
          <Toast.Title className="text-[14px] font-semibold">{receipt.status === "accepted" ? "Command accepted" : "Command blocked"}</Toast.Title>
          <Toast.Description className="mt-2 text-[13px] text-muted">
            {receipt.blockedReasons?.[0] ?? `${receipt.action} recorded for ${receipt.entityId}.`}
          </Toast.Description>
        </Toast.Root>
      ) : null}
      <Toast.Viewport />
    </Toast.Provider>
  );
}

function StatusBanner({ message }: { message: string }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
      <ShieldAlert size={17} />
      {message}
    </div>
  );
}

function MetricsStrip({ data, onCreateFeature }: { data: ConsoleData; onCreateFeature: () => void }) {
  const metrics = [
    { label: "Project Health", value: data.dashboard.projectHealth.ready > 0 ? "Healthy" : "Needs Setup", icon: CheckCircle2, tone: "green" },
    { label: "Active Feature", value: data.dashboard.activeFeatures[0]?.title ?? "None", icon: Code2, tone: "blue" },
    { label: "Failed Tasks", value: String(data.dashboard.failedTasks.length), icon: ShieldAlert, tone: data.dashboard.failedTasks.length > 0 ? "red" : "green" },
    { label: "Pending Reviews", value: String(data.dashboard.pendingApprovals), icon: ClipboardList, tone: data.dashboard.pendingApprovals > 0 ? "amber" : "green" },
    { label: "Runner Success", value: `${Math.round(data.dashboard.runner.successRate * 1000) / 10}%`, icon: CheckCircle2, tone: "green" },
    { label: "Cost (MTD)", value: `$${data.dashboard.cost.totalUsd.toFixed(2)}`, icon: CircleDollarSign, tone: "neutral" },
  ] as const;
  return (
    <Panel className="flex flex-wrap items-center">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div key={metric.label} className="metric-separator flex min-w-[140px] flex-1 items-center gap-3 px-4 py-4">
            <div className={`grid size-9 place-items-center rounded-md ${metricIconBg(metric.tone)}`}>
              <Icon size={18} className={metric.tone === "red" ? "text-red-600" : metric.tone === "amber" ? "text-amber-600" : metric.tone === "blue" ? "text-action" : metric.tone === "green" ? "text-emerald-600" : "text-slate-600"} />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] text-muted">{metric.label}</div>
              <div className="truncate text-[18px] font-semibold tracking-normal">{metric.value}</div>
            </div>
          </div>
        );
      })}
      <div className="p-4">
        <Button tone="primary" className="whitespace-nowrap" onClick={onCreateFeature}>
          <Plus size={16} />
          Create Feature
        </Button>
      </div>
    </Panel>
  );
}

function DashboardView({
  data,
  selectedTask,
  onSelectTask,
  onCommand,
  busy,
  receipt,
}: {
  data: ConsoleData;
  selectedTask?: BoardTask;
  onSelectTask: (id: string) => void;
  onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void;
  busy: boolean;
  receipt?: CommandReceipt;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(360px,0.85fr)] gap-4 max-xl:grid-cols-1">
      <BoardPanel tasks={data.board.tasks} selectedTask={selectedTask} onSelectTask={onSelectTask} onCommand={onCommand} busy={busy} compact />
      <div className="space-y-4">
        <ReviewsPanel data={data} onCommand={onCommand} busy={busy} compact />
        <CommandFeedback task={selectedTask} receipt={receipt} />
      </div>
      <RunnerPanel data={data} onCommand={onCommand} busy={busy} />
      <SubagentPanel data={data} onCommand={onCommand} busy={busy} />
    </div>
  );
}

function BoardView({ data, selectedTask, onSelectTask, onCommand, busy }: { data: ConsoleData; selectedTask?: BoardTask; onSelectTask: (id: string) => void; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_360px] gap-4 max-lg:grid-cols-1">
      <BoardPanel tasks={data.board.tasks} selectedTask={selectedTask} onSelectTask={onSelectTask} onCommand={onCommand} busy={busy} />
      <TaskInspector task={selectedTask} onCommand={onCommand} busy={busy} />
    </div>
  );
}

function BoardPanel({ tasks, selectedTask, onSelectTask, onCommand, busy, compact = false }: { tasks: BoardTask[]; selectedTask?: BoardTask; onSelectTask: (id: string) => void; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean; compact?: boolean }) {
  if (tasks.length === 0) {
    return <Panel><SectionTitle title="Board" /><EmptyState title="No board tasks are available for this project." /></Panel>;
  }
  return (
    <Panel>
      <SectionTitle
        title="Board"
        action={(
          <div className="flex items-center gap-2">
            <div className="hidden h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-[13px] text-muted md:flex">
              <Search size={15} />
              Search tasks...
            </div>
            <Button onClick={() => onCommand("schedule_board_tasks", "feature", "FEAT-013", { taskIds: [selectedTask?.id ?? tasks[0].id] })}>Schedule</Button>
            <Button tone="primary" disabled={busy} onClick={() => onCommand("run_board_tasks", "feature", "FEAT-013", { taskIds: [selectedTask?.id ?? tasks[0].id] })}>
              {busy ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />}
              Run
            </Button>
          </div>
        )}
      />
      <div className="scrollbar-thin overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
          <thead className="border-b border-line bg-slate-50 text-[12px] font-medium text-muted">
            <tr>
              <th className="px-4 py-3">ID / Task</th>
              <th className="px-4 py-3">Dependencies</th>
              <th className="px-4 py-3">Diff</th>
              <th className="px-4 py-3">Tests</th>
              <th className="px-4 py-3">Approval</th>
              <th className="px-4 py-3">Recovery</th>
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
                  <div className="font-medium">{task.id} <span className="ml-2 text-ink">{task.title}</span></div>
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-muted"><StatusDot status={task.status} />{task.status} · {task.risk} risk</div>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    {task.dependencies.length > 0 ? task.dependencies.map((dependency) => (
                      <div key={dependency.id} className="flex items-center gap-2">
                        <StatusDot status={dependency.satisfied ? "done" : "pending"} />
                        {dependency.id}
                      </div>
                    )) : "None"}
                  </div>
                </td>
                <td className="px-4 py-3"><DiffCell value={task.diff} /></td>
                <td className="px-4 py-3"><TestCell value={task.testResults} /></td>
                <td className="px-4 py-3"><Chip tone={statusTone[task.approvalStatus] ?? "neutral"}>{task.approvalStatus}</Chip></td>
                <td className="px-4 py-3">{task.recoveryHistory.length > 0 ? <Button tone="quiet"><RefreshCw size={14} />Retry</Button> : <span className="text-muted">--</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[12px] text-muted">
        <span>1-{Math.min(tasks.length, compact ? 5 : 12)} of {tasks.length} tasks</span>
        <span>Fact sources: task_graph_tasks, review_items, evidence_packs</span>
      </div>
    </Panel>
  );
}

function CommandFeedback({ task, receipt }: { task?: BoardTask; receipt?: CommandReceipt }) {
  const blockedReasons = receipt?.blockedReasons ?? task?.blockedReasons ?? ["Dependency T-121 is not completed."];
  const blocked = receipt?.status === "blocked" || blockedReasons.length > 0;
  return (
    <Panel className={blocked ? "border-red-200" : ""}>
      <SectionTitle title="Command Feedback" action={<Chip tone={blocked ? "red" : "green"}>{blocked ? "Blocked" : "Accepted"}</Chip>} />
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className={blocked ? "text-red-600" : "text-emerald-600"} size={20} />
          <div>
            <div className="text-[14px] font-semibold">{blocked ? "Board Run Blocked" : "Command Accepted"}</div>
            <div className="mt-1 text-[13px] text-muted">{blockedReasons[0] ?? `Command recorded for ${task?.id ?? "selected task"}.`}</div>
          </div>
        </div>
        <div className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-600">
          <div>Requested by: Operator</div>
          <div>Command: run board --task {task?.id ?? "T-129"}</div>
          <div>Runner: runner-01</div>
        </div>
      </div>
    </Panel>
  );
}

function RunnerPanel({ data, onCommand, busy }: { data: ConsoleData; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  const runner = data.runner.runners[0];
  return (
    <Panel>
      <SectionTitle title="Runner" action={<Chip tone={runner?.online ? "green" : "red"}>{runner?.online ? "Online" : "Offline"}</Chip>} />
      {runner ? (
        <div className="grid grid-cols-[170px_1fr] gap-0 p-4 max-sm:grid-cols-1">
          <div className="border-r border-line pr-4 max-sm:border-r-0">
            <div className="text-[12px] text-muted">Heartbeat</div>
            <div className="mt-3 h-28 rounded-md bg-gradient-to-b from-emerald-50 to-white p-3">
              <svg viewBox="0 0 140 80" className="h-full w-full" aria-label="Runner heartbeat chart">
                <polyline fill="none" stroke="#15a16c" strokeWidth="3" points="0,58 12,20 24,62 36,34 48,50 60,18 72,44 84,28 96,10 108,48 120,26 132,35" />
              </svg>
            </div>
          </div>
          <div className="px-4 max-sm:px-0">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[12px] text-muted">Queue <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5">{runner.queue.length}</span></div>
              <Button disabled={busy} onClick={() => onCommand("pause_runner", "runner", runner.runnerId)}><Pause size={14} />Pause Runner</Button>
            </div>
            <div className="space-y-2">
              {runner.queue.map((item) => <div key={item.runId} className="flex justify-between text-[13px]"><span>{item.runId}</span><span className="text-muted">{item.status}</span></div>)}
            </div>
          </div>
        </div>
      ) : <EmptyState title="No runner heartbeats have been recorded." />}
    </Panel>
  );
}

function SubagentPanel({ data, onCommand, busy }: { data: ConsoleData; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return (
    <Panel>
      <SectionTitle title="Subagents" action={<Chip tone="green">All Healthy</Chip>} />
      {data.subagents.runs.length > 0 ? (
        <div className="p-4">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[12px] text-muted"><tr><th className="pb-2">Subagent</th><th className="pb-2">Run Contract</th><th className="pb-2">Evidence</th><th className="pb-2">Action</th></tr></thead>
            <tbody>
              {data.subagents.runs.map((run) => (
                <tr key={run.id} className="border-t border-line">
                  <td className="py-2">{run.id}</td>
                  <td className="py-2 text-muted">{String((run.runContract as { command?: string } | undefined)?.command ?? "pending")}</td>
                  <td className="py-2"><a className="text-action" href={run.evidence[0]?.path ?? "#"}>{run.evidence[0]?.summary ?? "No evidence"}</a></td>
                  <td className="py-2"><Button disabled={busy} onClick={() => onCommand("retry_subagent", "run", run.id)}>Retry</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="No subagent runs are active." />}
    </Panel>
  );
}

function ReviewsPanel({ data, onCommand, busy, compact = false }: { data: ConsoleData; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean; compact?: boolean }) {
  return (
    <Panel>
      <SectionTitle title={`Reviews ${data.reviews.items.length}`} />
      {data.reviews.items.length > 0 ? (
        <div className="overflow-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="border-b border-line bg-slate-50 text-[12px] text-muted"><tr><th className="px-4 py-3">ID</th><th>Task</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {data.reviews.items.slice(0, compact ? 4 : 12).map((item) => (
                <tr key={item.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">{item.id}</td>
                  <td className="py-3">{item.taskId}<div className="text-[12px] text-muted">{item.body}</div></td>
                  <td className="py-3"><Chip tone={statusTone[item.status] ?? "amber"}>{item.status}</Chip></td>
                  <td className="py-3"><Button disabled={busy} onClick={() => onCommand("approve_review", "review_item", item.id)}>Approve</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="No reviews are waiting for action." />}
    </Panel>
  );
}

function TaskInspector({ task, onCommand, busy }: { task?: BoardTask; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  if (!task) {
    return <Panel><SectionTitle title="Task Detail" /><EmptyState title="Select a board task to inspect dependency, diff, test, approval, and recovery facts." /></Panel>;
  }
  return (
    <Panel>
      <SectionTitle title={task.id} action={<Chip tone={statusTone[task.status] ?? "neutral"}>{task.status}</Chip>} />
      <div className="space-y-4 p-4 text-[13px]">
        <h3 className="text-[16px] font-semibold">{task.title}</h3>
        <FactList rows={[
          ["Risk", task.risk],
          ["Approval", task.approvalStatus],
          ["Dependencies", task.dependencies.map((item) => `${item.id}: ${item.status}`).join(", ") || "None"],
          ["Blocked", task.blockedReasons.join(" ") || "None"],
        ]} />
        <Button tone="primary" disabled={busy} onClick={() => onCommand("move_board_task", "task", task.id, { targetStatus: "running" })}>Move to Running</Button>
      </div>
    </Panel>
  );
}

function SpecWorkspace({ data, onCommand }: { data: ConsoleData; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void }) {
  const selected = data.spec.selectedFeature;
  return (
    <Panel>
      <SectionTitle title="Spec Workspace" action={<CreateFeatureDialog onCreate={() => onCommand("create_feature", "project", "project-1")} />} />
      {selected ? (
        <div className="grid grid-cols-[280px_1fr] gap-4 p-4 max-lg:grid-cols-1">
          <div className="space-y-2">
            {data.spec.features.map((feature) => <div key={feature.id} className="rounded-md border border-line bg-slate-50 p-3 text-[13px]"><strong>{feature.id}</strong><div>{feature.title}</div><div className="text-muted">{feature.status}</div></div>)}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FactBox title="Requirements" items={selected.requirements.map((item) => `${item.id}: ${item.body}`)} />
            <FactBox title="Quality Checklist" items={selected.qualityChecklist.map((item) => `${item.passed ? "Pass" : "Fail"} ${item.item}`)} />
            <FactBox title="Contracts" items={selected.contracts.map((item) => JSON.stringify(item))} />
            <FactBox title="Spec Diff" items={selected.versionDiffs.map((item) => JSON.stringify(item))} />
          </div>
        </div>
      ) : <EmptyState title="No feature specs are available for this project." />}
    </Panel>
  );
}

function SkillCenter({ data }: { data: ConsoleData }) {
  return (
    <Panel>
      <SectionTitle title="Skill Center" />
      {data.skills.skills.length > 0 ? (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {data.skills.skills.map((skill) => (
            <div key={skill.slug} className="rounded-lg border border-line bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-semibold">{skill.name}</div><div className="text-[12px] text-muted">{skill.slug} · v{skill.version}</div></div>
                <Chip tone={skill.enabled ? "green" : "neutral"}>{skill.enabled ? "enabled" : "disabled"}</Chip>
              </div>
              <FactList rows={[["Phase", skill.phase], ["Risk", skill.riskLevel], ["Success", `${Math.round(skill.successRate * 100)}%`]]} />
            </div>
          ))}
        </div>
      ) : <EmptyState title="No skills are registered." />}
    </Panel>
  );
}

function Subagents(props: { data: ConsoleData; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return <SubagentPanel {...props} />;
}

function Runner(props: { data: ConsoleData; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return <RunnerPanel {...props} />;
}

function Reviews(props: { data: ConsoleData; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return <ReviewsPanel {...props} />;
}

function CreateFeatureDialog({ onCreate }: { onCreate: () => void }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild><Button tone="primary"><Plus size={15} />Create Feature</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/20" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-white p-5 shadow-panel">
          <Dialog.Title className="text-[16px] font-semibold">Create Feature</Dialog.Title>
          <Dialog.Description className="mt-2 text-[13px] text-muted">Submit a controlled create_feature command to the Control Plane.</Dialog.Description>
          <div className="mt-4 space-y-3">
            <input className="h-10 w-full rounded-md border border-line px-3 text-[13px]" value="Product Console UI acceptance" readOnly />
            <div className="flex justify-end"><Dialog.Close asChild><Button tone="primary" onClick={onCreate}>Submit Command</Button></Dialog.Close></div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FactBox({ title, items }: { title: string; items: string[] }) {
  return <div className="rounded-lg border border-line bg-slate-50 p-4"><div className="mb-2 font-semibold">{title}</div><ul className="space-y-2 text-[13px] text-muted">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function FactList({ rows }: { rows: Array<[string, string]> }) {
  return <dl className="mt-4 space-y-2 text-[13px]">{rows.map(([key, value]) => <div key={key} className="flex justify-between gap-4"><dt className="text-muted">{key}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl>;
}

function DiffCell({ value }: { value: unknown }) {
  const diff = value as { additions?: number; deletions?: number } | undefined;
  return <div><div className="text-emerald-600">+{diff?.additions ?? 0}</div><div className="text-red-600">-{diff?.deletions ?? 0}</div></div>;
}

function TestCell({ value }: { value: unknown }) {
  const result = value as { passed?: boolean; total?: number } | undefined;
  const passed = result?.passed === true;
  return <div className="flex items-center gap-2"><div className="h-1.5 w-14 rounded-full bg-slate-200"><div className={`h-full rounded-full ${passed ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: passed ? "100%" : "55%" }} /></div><span>{result?.total ?? "--"}</span></div>;
}

function StatusDot({ status }: { status: string }) {
  const color = status === "done" || status === "approved" || status === "ready" ? "bg-emerald-500" : status === "blocked" || status === "failed" ? "bg-red-500" : status === "pending" || status === "scheduled" ? "bg-amber-500" : "bg-blue-500";
  return <span className={`inline-block size-2 rounded-full ${color}`} />;
}

function metricIconBg(tone: string): string {
  if (tone === "red") return "bg-red-50";
  if (tone === "amber") return "bg-amber-50";
  if (tone === "blue") return "bg-blue-50";
  if (tone === "green") return "bg-emerald-50";
  return "bg-slate-50";
}
