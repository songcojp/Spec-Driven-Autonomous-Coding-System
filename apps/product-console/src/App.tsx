import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import * as Toast from "@radix-ui/react-toast";
import {
  Bell,
  Bot,
  Boxes,
  CheckCircle2,
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
import { createConsoleProject, fetchConsoleData, submitCommand } from "./lib/api";
import { demoData, emptyData } from "./lib/demo-data";
import type { BoardTask, CommandReceipt, ConsoleData, ProjectCreateForm, ProjectSummary } from "./types";
import { Button, Chip, EmptyState, Panel, SectionTitle } from "./components/ui/primitives";

type DataMode = "live" | "empty" | "error";
type Locale = "zh-CN" | "en";
type ViewKey = "dashboard" | "board" | "spec" | "skills" | "subagents" | "runner" | "reviews";

const localeStorageKey = "specdrive-console-locale";
const projectStorageKey = "specdrive-current-project";

const navItems: Array<{ key: ViewKey; icon: typeof Home }> = [
  { key: "dashboard", icon: LayoutDashboard },
  { key: "board", icon: SquareKanban },
  { key: "spec", icon: FileText },
  { key: "skills", icon: Boxes },
  { key: "subagents", icon: Bot },
  { key: "runner", icon: Play },
  { key: "reviews", icon: ClipboardList },
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

const copy = {
  "zh-CN": {
    nav: {
      dashboard: "仪表盘",
      board: "看板",
      spec: "Spec 工作台",
      skills: "Skill 中心",
      subagents: "Subagent",
      runner: "Runner",
      reviews: "审查",
    },
    consoleNavigation: "控制台导航",
    project: "项目",
    currentProject: "当前项目",
    projectList: "项目列表",
    createProject: "创建项目",
    createProjectDescription: "导入已有项目目录，或填写表单在 workspace 目录中创建新项目。",
    importExistingProject: "导入现有项目",
    createNewProject: "创建新项目",
    projectName: "项目名称",
    projectGoal: "项目目标",
    projectType: "项目类型",
    techPreferences: "技术偏好",
    existingProjectPath: "现有项目目录",
    workspaceSlug: "Workspace 目录名",
    defaultBranch: "默认分支",
    automationEnabled: "启用自动化",
    projectDirectory: "项目目录",
    repository: "仓库",
    recentActivity: "最近活动",
    projectContextBlocked: "项目上下文不匹配",
    language: "语言",
    chinese: "中文",
    english: "English",
    dataState: "数据状态",
    liveData: "实时数据",
    emptyStateMode: "空状态",
    errorStateMode: "错误状态",
    healthy: "健康",
    operator: "操作员",
    autobuildTeam: "AutoBuild 团队",
    projectHealth: "项目健康",
    activeFeature: "当前 Feature",
    failedTasks: "失败任务",
    pendingReviews: "待审查",
    runnerSuccess: "Runner 成功率",
    costMtd: "本月成本",
    needsSetup: "需初始化",
    none: "无",
    createFeature: "创建 Feature",
    board: "看板",
    noBoardTasks: "当前项目没有可用的看板任务。",
    searchTasks: "搜索任务...",
    schedule: "排期",
    run: "运行",
    idTask: "ID / 任务",
    dependencies: "依赖",
    diff: "Diff",
    tests: "测试",
    approval: "审批",
    recovery: "恢复",
    risk: "风险",
    ofTasks: (start: number, end: number, total: number) => `${start}-${end} / ${total} 个任务`,
    factSources: "事实源：task_graph_tasks、review_items、evidence_packs",
    commandFeedback: "命令反馈",
    blocked: "已阻塞",
    accepted: "已接受",
    boardRunBlocked: "看板运行被阻塞",
    commandAccepted: "命令已接受",
    selectedTask: "所选任务",
    requestedBy: "请求人",
    command: "命令",
    runner: "Runner",
    online: "在线",
    offline: "离线",
    heartbeat: "心跳",
    queue: "队列",
    pauseRunner: "暂停 Runner",
    noRunner: "尚未记录 Runner 心跳。",
    subagents: "Subagent",
    allHealthy: "全部健康",
    subagent: "Subagent",
    runContract: "Run Contract",
    evidence: "Evidence",
    action: "操作",
    noEvidence: "无 Evidence",
    noSubagents: "没有活跃的 Subagent Run。",
    retry: "重试",
    reviewsTitle: (count: number) => `审查 ${count}`,
    id: "ID",
    task: "任务",
    status: "状态",
    actions: "操作",
    approve: "批准",
    noReviews: "没有待处理审查。",
    taskDetail: "任务详情",
    selectTask: "选择一个看板任务以查看依赖、diff、测试、审批和恢复事实。",
    moveToRunning: "移动到运行中",
    specWorkspace: "Spec 工作台",
    requirements: "需求",
    qualityChecklist: "质量检查清单",
    contracts: "契约",
    specDiff: "Spec Diff",
    noFeatureSpecs: "当前项目没有可用的 Feature Spec。",
    skillCenter: "Skill 中心",
    enabled: "已启用",
    disabled: "已禁用",
    phase: "阶段",
    success: "成功率",
    noSkills: "没有注册 Skill。",
    createFeatureDescription: "向 Control Plane 提交受控 create_feature 命令。",
    submitCommand: "提交命令",
    commandBlocked: "命令被阻塞",
    autoRefresh: "自动刷新",
    git: "Git",
    commit: "Commit",
    runnerFooter: "Runner：在线",
    lastSync: "上次同步：2 分钟前",
  },
  en: {
    nav: {
      dashboard: "Dashboard",
      board: "Board",
      spec: "Spec Workspace",
      skills: "Skill Center",
      subagents: "Subagents",
      runner: "Runner",
      reviews: "Reviews",
    },
    consoleNavigation: "Console navigation",
    project: "Project",
    currentProject: "Current Project",
    projectList: "Project List",
    createProject: "Create Project",
    createProjectDescription: "Import an existing project directory, or create a new project under workspace.",
    importExistingProject: "Import Existing",
    createNewProject: "Create New",
    projectName: "Project name",
    projectGoal: "Project goal",
    projectType: "Project type",
    techPreferences: "Tech preferences",
    existingProjectPath: "Existing project directory",
    workspaceSlug: "Workspace directory",
    defaultBranch: "Default branch",
    automationEnabled: "Enable automation",
    projectDirectory: "Project directory",
    repository: "Repository",
    recentActivity: "Recent activity",
    projectContextBlocked: "Project context mismatch",
    language: "Language",
    chinese: "中文",
    english: "English",
    dataState: "Data state",
    liveData: "Live data",
    emptyStateMode: "Empty state",
    errorStateMode: "Error state",
    healthy: "Healthy",
    operator: "Operator",
    autobuildTeam: "AutoBuild Team",
    projectHealth: "Project Health",
    activeFeature: "Active Feature",
    failedTasks: "Failed Tasks",
    pendingReviews: "Pending Reviews",
    runnerSuccess: "Runner Success",
    costMtd: "Cost (MTD)",
    needsSetup: "Needs Setup",
    none: "None",
    createFeature: "Create Feature",
    board: "Board",
    noBoardTasks: "No board tasks are available for this project.",
    searchTasks: "Search tasks...",
    schedule: "Schedule",
    run: "Run",
    idTask: "ID / Task",
    dependencies: "Dependencies",
    diff: "Diff",
    tests: "Tests",
    approval: "Approval",
    recovery: "Recovery",
    risk: "Risk",
    ofTasks: (start: number, end: number, total: number) => `${start}-${end} of ${total} tasks`,
    factSources: "Fact sources: task_graph_tasks, review_items, evidence_packs",
    commandFeedback: "Command Feedback",
    blocked: "Blocked",
    accepted: "Accepted",
    boardRunBlocked: "Board Run Blocked",
    commandAccepted: "Command Accepted",
    selectedTask: "selected task",
    requestedBy: "Requested by",
    command: "Command",
    runner: "Runner",
    online: "Online",
    offline: "Offline",
    heartbeat: "Heartbeat",
    queue: "Queue",
    pauseRunner: "Pause Runner",
    noRunner: "No runner heartbeats have been recorded.",
    subagents: "Subagents",
    allHealthy: "All Healthy",
    subagent: "Subagent",
    runContract: "Run Contract",
    evidence: "Evidence",
    action: "Action",
    noEvidence: "No evidence",
    noSubagents: "No subagent runs are active.",
    retry: "Retry",
    reviewsTitle: (count: number) => `Reviews ${count}`,
    id: "ID",
    task: "Task",
    status: "Status",
    actions: "Actions",
    approve: "Approve",
    noReviews: "No reviews are waiting for action.",
    taskDetail: "Task Detail",
    selectTask: "Select a board task to inspect dependency, diff, test, approval, and recovery facts.",
    moveToRunning: "Move to Running",
    specWorkspace: "Spec Workspace",
    requirements: "Requirements",
    qualityChecklist: "Quality Checklist",
    contracts: "Contracts",
    specDiff: "Spec Diff",
    noFeatureSpecs: "No feature specs are available for this project.",
    skillCenter: "Skill Center",
    enabled: "enabled",
    disabled: "disabled",
    phase: "Phase",
    success: "Success",
    noSkills: "No skills are registered.",
    createFeatureDescription: "Submit a controlled create_feature command to the Control Plane.",
    submitCommand: "Submit Command",
    commandBlocked: "Command blocked",
    autoRefresh: "Auto-refresh",
    git: "Git",
    commit: "Commit",
    runnerFooter: "Runner: online",
    lastSync: "Last sync: 2m ago",
  },
} satisfies Record<Locale, Record<string, unknown> & { nav: Record<ViewKey, string>; ofTasks: (start: number, end: number, total: number) => string; reviewsTitle: (count: number) => string }>;

type ConsoleCopy = (typeof copy)[Locale];

function readInitialLocale(): Locale {
  if (typeof window === "undefined") {
    return "zh-CN";
  }
  return window.localStorage.getItem(localeStorageKey) === "en" ? "en" : "zh-CN";
}

function slugifyProjectName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "new-project";
}

function readInitialProjectId(): string {
  if (typeof window === "undefined") {
    return "project-1";
  }
  return window.localStorage.getItem(projectStorageKey) ?? "project-1";
}

function bindProjects(data: Omit<ConsoleData, "projects"> | ConsoleData, projects: ProjectSummary[], currentProjectId: string): ConsoleData {
  return {
    ...data,
    projects: {
      currentProjectId,
      projects,
    },
  };
}

export function App() {
  const [view, setView] = useState<ViewKey>("dashboard");
  const [mode, setMode] = useState<DataMode>("live");
  const [locale, setLocale] = useState<Locale>(readInitialLocale);
  const [projects, setProjects] = useState<ProjectSummary[]>(demoData.projects.projects);
  const [currentProjectId, setCurrentProjectId] = useState(readInitialProjectId);
  const [data, setData] = useState<ConsoleData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [selectedTaskId, setSelectedTaskId] = useState("T-129");
  const [receipt, setReceipt] = useState<CommandReceipt | undefined>();
  const [isPending, startTransition] = useTransition();
  const text = copy[locale];
  const currentProject = projects.find((project) => project.id === currentProjectId) ?? projects[0] ?? demoData.projects.projects[0];

  useEffect(() => {
    let cancelled = false;
    if (mode === "empty") {
      setData(bindProjects(emptyData, projects, currentProject.id));
      setError(undefined);
      return;
    }
    if (mode === "error") {
      setData(undefined);
      setError("Control Plane API returned a simulated failure.");
      return;
    }
    if (currentProject.repository === "not-connected") {
      setData(bindProjects(emptyData, projects, currentProject.id));
      setError(undefined);
      return;
    }
    setError(undefined);
    fetchConsoleData(currentProject.id)
      .then((nextData) => {
        if (!cancelled) {
          setData(bindProjects(nextData, projects, currentProject.id));
        }
      })
      .catch((nextError: Error) => {
        if (!cancelled) {
          setData(bindProjects(demoData, projects, currentProject.id));
          setError(`Live API unavailable; showing seeded console data. ${nextError.message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentProject.id, mode, projects]);

  const currentData = data ?? demoData;
  const selectedTask = useMemo(
    () => currentData.board.tasks.find((task) => task.id === selectedTaskId) ?? currentData.board.tasks[0],
    [currentData.board.tasks, selectedTaskId],
  );

  async function runCommand(action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>, commandProjectId = currentProject.id) {
    startTransition(async () => {
      try {
        const nextReceipt = await submitCommand({
          action,
          entityType,
          entityId,
          projectId: commandProjectId,
          reason: action === "run_board_tasks" ? "Run selected board task from Product Console." : `Operator requested ${action}.`,
          payload: { projectId: commandProjectId, ...payload },
        });
        setReceipt(nextReceipt);
      } catch (nextError) {
        setReceipt({
          id: "local-error",
          action,
          status: "blocked",
          entityType,
          entityId,
          projectId: commandProjectId,
          acceptedAt: new Date().toISOString(),
          blockedReasons: [nextError instanceof Error ? nextError.message : String(nextError)],
        });
      }
    });
  }

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    window.localStorage.setItem(localeStorageKey, nextLocale);
  }

  function switchProject(nextProjectId: string) {
    setCurrentProjectId(nextProjectId);
    window.localStorage.setItem(projectStorageKey, nextProjectId);
    setSelectedTaskId("T-129");
    setReceipt(undefined);
  }

  function createProject(form: ProjectCreateForm) {
    const projectName = form.name.trim() || (locale === "zh-CN" ? "新 AutoBuild 项目" : "New AutoBuild Project");
    const normalizedForm = {
      ...form,
      name: projectName,
      goal: form.goal.trim() || "Created from Product Console",
      projectType: form.projectType.trim() || "autobuild-project",
      workspaceSlug: slugifyProjectName(form.workspaceSlug || projectName),
      defaultBranch: form.defaultBranch.trim() || "main",
    };
    startTransition(async () => {
      let nextProject: ProjectSummary;
      try {
        nextProject = await createConsoleProject(normalizedForm);
      } catch {
        const projectDirectory = normalizedForm.mode === "create_new"
          ? `workspace/${normalizedForm.workspaceSlug}`
          : normalizedForm.existingProjectPath || "not-connected";
        nextProject = {
          id: `project-${Date.now()}`,
          name: normalizedForm.name,
          repository: projectDirectory,
          projectDirectory,
          defaultBranch: normalizedForm.defaultBranch,
          health: "blocked",
          lastActivityAt: new Date().toISOString(),
        };
      }
      setProjects((previous) => [...previous.filter((project) => project.id !== nextProject.id), nextProject]);
      switchProject(nextProject.id);
      setReceipt({
        id: `create-${nextProject.id}`,
        action: "create_project",
        status: "accepted",
        entityType: "project",
        entityId: nextProject.id,
        projectId: nextProject.id,
        acceptedAt: new Date().toISOString(),
      });
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
          <nav className="space-y-1 p-2" aria-label={text.consoleNavigation}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.key === view;
              const label = text.nav[item.key];
              return (
                <button
                  key={item.key}
                  className={`flex h-11 w-full items-center gap-3 rounded-md px-4 text-left text-[14px] transition-colors ${
                    active ? "bg-blue-50 text-action" : "text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => setView(item.key)}
                >
                  <Icon size={18} />
                  {label}
                </button>
              );
            })}
          </nav>
          <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-line bg-slate-50 p-3">
            <div className="text-[13px] font-semibold">{text.autobuildTeam}</div>
            <div className="mt-1 text-[12px] text-muted">{text.operator}</div>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-6">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-[12px] text-muted">{text.currentProject}</div>
                <div className="flex items-center gap-2">
                  <select
                    className="h-9 max-w-[260px] rounded-md border border-line bg-white px-3 text-[14px] font-semibold text-ink"
                    aria-label={text.projectList}
                    value={currentProject.id}
                    onChange={(event) => switchProject(event.target.value)}
                  >
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                  <CreateProjectDialog text={text} onCreate={createProject} />
                </div>
              </div>
              <Button className="h-8">
                <GitBranch size={14} />
                {currentProject.defaultBranch}
              </Button>
              <div className="text-[12px] text-muted">
                {text.projectDirectory}: {currentProject.projectDirectory}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[12px] text-muted">
                {text.language}
                <select
                  className="h-9 rounded-md border border-line bg-white px-3 text-[13px] text-ink"
                  aria-label={text.language}
                  value={locale}
                  onChange={(event) => changeLocale(event.target.value as Locale)}
                >
                  <option value="zh-CN">{text.chinese}</option>
                  <option value="en">{text.english}</option>
                </select>
              </label>
              <select
                className="h-9 rounded-md border border-line bg-white px-3 text-[13px]"
                aria-label={text.dataState}
                value={mode}
                onChange={(event) => setMode(event.target.value as DataMode)}
              >
                <option value="live">{text.liveData}</option>
                <option value="empty">{text.emptyStateMode}</option>
                <option value="error">{text.errorStateMode}</option>
              </select>
              <Chip tone="green">{text.healthy}</Chip>
              <Bell size={18} />
              <div className="grid size-9 place-items-center rounded-full bg-slate-100 text-[13px] font-semibold">OP</div>
            </div>
          </header>

          <div className="space-y-5 p-5 pb-14">
            {error ? <StatusBanner message={error} /> : null}
            <MetricsStrip data={currentData} text={text} project={currentProject} onCreateFeature={() => runCommand("create_feature", "project", currentProject.id)} />

            <Tabs.Root value={view} onValueChange={(value) => setView(value as ViewKey)}>
              <Tabs.List className="sr-only" aria-label={text.consoleNavigation}>
                {navItems.map((item) => <Tabs.Trigger key={item.key} value={item.key}>{text.nav[item.key]}</Tabs.Trigger>)}
              </Tabs.List>
              <Tabs.Content value="dashboard">
                <DashboardView data={currentData} text={text} selectedTask={selectedTask} onSelectTask={setSelectedTaskId} onCommand={runCommand} busy={isPending} receipt={receipt} />
              </Tabs.Content>
              <Tabs.Content value="board">
                <BoardView data={currentData} text={text} selectedTask={selectedTask} onSelectTask={setSelectedTaskId} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
              <Tabs.Content value="spec">
                <SpecWorkspace data={currentData} text={text} currentProjectId={currentProject.id} onCommand={runCommand} />
              </Tabs.Content>
              <Tabs.Content value="skills">
                <SkillCenter data={currentData} text={text} />
              </Tabs.Content>
              <Tabs.Content value="subagents">
                <Subagents data={currentData} text={text} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
              <Tabs.Content value="runner">
                <Runner data={currentData} text={text} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
              <Tabs.Content value="reviews">
                <Reviews data={currentData} text={text} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
            </Tabs.Root>
          </div>
          <footer className="fixed bottom-0 left-[220px] right-0 hidden h-10 items-center justify-between border-t border-line bg-white px-6 text-[12px] text-muted lg:flex">
            <div className="flex items-center gap-8">
              <span>{text.git}: main <span className="text-emerald-600">✓</span></span>
              <span>{text.commit}: a1b2c3d</span>
              <span><span className="mr-2 inline-block size-2 rounded-full bg-emerald-500" />{text.runnerFooter}</span>
              <span>{text.lastSync}</span>
            </div>
            <div className="flex items-center gap-3">
              <span>{text.autoRefresh}</span>
              <span className="inline-flex h-5 w-9 items-center rounded-full bg-action p-0.5"><span className="ml-auto size-4 rounded-full bg-white" /></span>
            </div>
          </footer>
        </main>
      </div>
      {receipt ? (
        <Toast.Root className="fixed bottom-5 right-5 z-50 w-96 rounded-lg border border-line bg-white p-4 shadow-panel">
          <Toast.Title className="text-[14px] font-semibold">{receipt.status === "accepted" ? text.commandAccepted : text.commandBlocked}</Toast.Title>
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

function MetricsStrip({ data, text, project, onCreateFeature }: { data: ConsoleData; text: ConsoleCopy; project: ProjectSummary; onCreateFeature: () => void }) {
  const metrics = [
    { label: text.projectHealth, value: project.health === "ready" ? text.healthy : text.needsSetup, icon: CheckCircle2, tone: project.health === "ready" ? "green" : "amber" },
    { label: text.activeFeature, value: data.dashboard.activeFeatures[0]?.title ?? text.none, icon: Code2, tone: "blue" },
    { label: text.failedTasks, value: String(data.dashboard.failedTasks.length), icon: ShieldAlert, tone: data.dashboard.failedTasks.length > 0 ? "red" : "green" },
    { label: text.pendingReviews, value: String(data.dashboard.pendingApprovals), icon: ClipboardList, tone: data.dashboard.pendingApprovals > 0 ? "amber" : "green" },
    { label: text.runnerSuccess, value: `${Math.round(data.dashboard.runner.successRate * 1000) / 10}%`, icon: CheckCircle2, tone: "green" },
    { label: text.costMtd, value: `$${data.dashboard.cost.totalUsd.toFixed(2)}`, icon: CircleDollarSign, tone: "neutral" },
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
          {text.createFeature}
        </Button>
      </div>
    </Panel>
  );
}

function DashboardView({
  data,
  text,
  selectedTask,
  onSelectTask,
  onCommand,
  busy,
  receipt,
}: {
  data: ConsoleData;
  text: ConsoleCopy;
  selectedTask?: BoardTask;
  onSelectTask: (id: string) => void;
  onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void;
  busy: boolean;
  receipt?: CommandReceipt;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(360px,0.85fr)] gap-4 max-xl:grid-cols-1">
      <BoardPanel tasks={data.board.tasks} text={text} selectedTask={selectedTask} onSelectTask={onSelectTask} onCommand={onCommand} busy={busy} compact />
      <div className="space-y-4">
        <ReviewsPanel data={data} text={text} onCommand={onCommand} busy={busy} compact />
        <CommandFeedback task={selectedTask} text={text} receipt={receipt} />
      </div>
      <RunnerPanel data={data} text={text} onCommand={onCommand} busy={busy} />
      <SubagentPanel data={data} text={text} onCommand={onCommand} busy={busy} />
    </div>
  );
}

function BoardView({ data, text, selectedTask, onSelectTask, onCommand, busy }: { data: ConsoleData; text: ConsoleCopy; selectedTask?: BoardTask; onSelectTask: (id: string) => void; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_360px] gap-4 max-lg:grid-cols-1">
      <BoardPanel tasks={data.board.tasks} text={text} selectedTask={selectedTask} onSelectTask={onSelectTask} onCommand={onCommand} busy={busy} />
      <TaskInspector task={selectedTask} text={text} onCommand={onCommand} busy={busy} />
    </div>
  );
}

function BoardPanel({ tasks, text, selectedTask, onSelectTask, onCommand, busy, compact = false }: { tasks: BoardTask[]; text: ConsoleCopy; selectedTask?: BoardTask; onSelectTask: (id: string) => void; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean; compact?: boolean }) {
  if (tasks.length === 0) {
    return <Panel><SectionTitle title={text.board} /><EmptyState title={text.noBoardTasks} /></Panel>;
  }
  return (
    <Panel>
      <SectionTitle
        title={text.board}
        action={(
          <div className="flex items-center gap-2">
            <div className="hidden h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-[13px] text-muted md:flex">
              <Search size={15} />
              {text.searchTasks}
            </div>
            <Button onClick={() => onCommand("schedule_board_tasks", "feature", "FEAT-013", { taskIds: [selectedTask?.id ?? tasks[0].id] })}>{text.schedule}</Button>
            <Button tone="primary" disabled={busy} onClick={() => onCommand("run_board_tasks", "feature", "FEAT-013", { taskIds: [selectedTask?.id ?? tasks[0].id] })}>
              {busy ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />}
              {text.run}
            </Button>
          </div>
        )}
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
                  <div className="font-medium">{task.id} <span className="ml-2 text-ink">{task.title}</span></div>
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-muted"><StatusDot status={task.status} />{task.status} · {task.risk} {text.risk}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    {task.dependencies.length > 0 ? task.dependencies.map((dependency) => (
                      <div key={dependency.id} className="flex items-center gap-2">
                        <StatusDot status={dependency.satisfied ? "done" : "pending"} />
                        {dependency.id}
                      </div>
                    )) : text.none}
                  </div>
                </td>
                <td className="px-4 py-3"><DiffCell value={task.diff} /></td>
                <td className="px-4 py-3"><TestCell value={task.testResults} /></td>
                <td className="px-4 py-3"><Chip tone={statusTone[task.approvalStatus] ?? "neutral"}>{task.approvalStatus}</Chip></td>
                <td className="px-4 py-3">{task.recoveryHistory.length > 0 ? <Button tone="quiet"><RefreshCw size={14} />{text.retry}</Button> : <span className="text-muted">--</span>}</td>
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

function CommandFeedback({ task, text, receipt }: { task?: BoardTask; text: ConsoleCopy; receipt?: CommandReceipt }) {
  const blockedReasons = receipt?.blockedReasons ?? task?.blockedReasons ?? ["Dependency T-121 is not completed."];
  const blocked = receipt?.status === "blocked" || blockedReasons.length > 0;
  return (
    <Panel className={blocked ? "border-red-200" : ""}>
      <SectionTitle title={text.commandFeedback} action={<Chip tone={blocked ? "red" : "green"}>{blocked ? text.blocked : text.accepted}</Chip>} />
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className={blocked ? "text-red-600" : "text-emerald-600"} size={20} />
          <div>
            <div className="text-[14px] font-semibold">{blocked ? text.boardRunBlocked : text.commandAccepted}</div>
            <div className="mt-1 text-[13px] text-muted">{blockedReasons[0] ?? `${text.commandAccepted}: ${task?.id ?? text.selectedTask}.`}</div>
          </div>
        </div>
        <div className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-600">
          <div>{text.requestedBy}: {text.operator}</div>
          <div>{text.command}: run board --task {task?.id ?? "T-129"}</div>
          <div>{text.runner}: runner-01</div>
        </div>
      </div>
    </Panel>
  );
}

function RunnerPanel({ data, text, onCommand, busy }: { data: ConsoleData; text: ConsoleCopy; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  const runner = data.runner.runners[0];
  return (
    <Panel>
      <SectionTitle title={text.runner} action={<Chip tone={runner?.online ? "green" : "red"}>{runner?.online ? text.online : text.offline}</Chip>} />
      {runner ? (
        <div className="grid grid-cols-[170px_1fr] gap-0 p-4 max-sm:grid-cols-1">
          <div className="border-r border-line pr-4 max-sm:border-r-0">
            <div className="text-[12px] text-muted">{text.heartbeat}</div>
            <div className="mt-3 h-28 rounded-md bg-gradient-to-b from-emerald-50 to-white p-3">
              <svg viewBox="0 0 140 80" className="h-full w-full" aria-label="Runner heartbeat chart">
                <polyline fill="none" stroke="#15a16c" strokeWidth="3" points="0,58 12,20 24,62 36,34 48,50 60,18 72,44 84,28 96,10 108,48 120,26 132,35" />
              </svg>
            </div>
          </div>
          <div className="px-4 max-sm:px-0">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[12px] text-muted">{text.queue} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5">{runner.queue.length}</span></div>
              <Button disabled={busy} onClick={() => onCommand("pause_runner", "runner", runner.runnerId)}><Pause size={14} />{text.pauseRunner}</Button>
            </div>
            <div className="space-y-2">
              {runner.queue.map((item) => <div key={item.runId} className="flex justify-between text-[13px]"><span>{item.runId}</span><span className="text-muted">{item.status}</span></div>)}
            </div>
          </div>
        </div>
      ) : <EmptyState title={text.noRunner} />}
    </Panel>
  );
}

function SubagentPanel({ data, text, onCommand, busy }: { data: ConsoleData; text: ConsoleCopy; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return (
    <Panel>
      <SectionTitle title={text.subagents} action={<Chip tone="green">{text.allHealthy}</Chip>} />
      {data.subagents.runs.length > 0 ? (
        <div className="p-4">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[12px] text-muted"><tr><th className="pb-2">{text.subagent}</th><th className="pb-2">{text.runContract}</th><th className="pb-2">{text.evidence}</th><th className="pb-2">{text.action}</th></tr></thead>
            <tbody>
              {data.subagents.runs.map((run) => (
                <tr key={run.id} className="border-t border-line">
                  <td className="py-2">{run.id}</td>
                  <td className="py-2 text-muted">{String((run.runContract as { command?: string } | undefined)?.command ?? "pending")}</td>
                  <td className="py-2"><a className="text-action" href={run.evidence[0]?.path ?? "#"}>{run.evidence[0]?.summary ?? text.noEvidence}</a></td>
                  <td className="py-2"><Button disabled={busy} onClick={() => onCommand("retry_subagent", "run", run.id)}>{text.retry}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title={text.noSubagents} />}
    </Panel>
  );
}

function ReviewsPanel({ data, text, onCommand, busy, compact = false }: { data: ConsoleData; text: ConsoleCopy; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean; compact?: boolean }) {
  return (
    <Panel>
      <SectionTitle title={text.reviewsTitle(data.reviews.items.length)} />
      {data.reviews.items.length > 0 ? (
        <div className="overflow-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="border-b border-line bg-slate-50 text-[12px] text-muted"><tr><th className="px-4 py-3">{text.id}</th><th>{text.task}</th><th>{text.status}</th><th>{text.actions}</th></tr></thead>
            <tbody>
              {data.reviews.items.slice(0, compact ? 4 : 12).map((item) => (
                <tr key={item.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">{item.id}</td>
                  <td className="py-3">{item.taskId}<div className="text-[12px] text-muted">{item.body}</div></td>
                  <td className="py-3"><Chip tone={statusTone[item.status] ?? "amber"}>{item.status}</Chip></td>
                  <td className="py-3"><Button disabled={busy} onClick={() => onCommand("approve_review", "review_item", item.id)}>{text.approve}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title={text.noReviews} />}
    </Panel>
  );
}

function TaskInspector({ task, text, onCommand, busy }: { task?: BoardTask; text: ConsoleCopy; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  if (!task) {
    return <Panel><SectionTitle title={text.taskDetail} /><EmptyState title={text.selectTask} /></Panel>;
  }
  return (
    <Panel>
      <SectionTitle title={task.id} action={<Chip tone={statusTone[task.status] ?? "neutral"}>{task.status}</Chip>} />
      <div className="space-y-4 p-4 text-[13px]">
        <h3 className="text-[16px] font-semibold">{task.title}</h3>
        <FactList rows={[
          [text.risk, task.risk],
          [text.approval, task.approvalStatus],
          [text.dependencies, task.dependencies.map((item) => `${item.id}: ${item.status}`).join(", ") || text.none],
          [text.blocked, task.blockedReasons.join(" ") || text.none],
        ]} />
        <Button tone="primary" disabled={busy} onClick={() => onCommand("move_board_task", "task", task.id, { targetStatus: "running" })}>{text.moveToRunning}</Button>
      </div>
    </Panel>
  );
}

function SpecWorkspace({ data, text, currentProjectId, onCommand }: { data: ConsoleData; text: ConsoleCopy; currentProjectId: string; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void }) {
  const selected = data.spec.selectedFeature;
  return (
    <Panel>
      <SectionTitle title={text.specWorkspace} action={<CreateFeatureDialog text={text} onCreate={() => onCommand("create_feature", "project", currentProjectId)} />} />
      {selected ? (
        <div className="grid grid-cols-[280px_1fr] gap-4 p-4 max-lg:grid-cols-1">
          <div className="space-y-2">
            {data.spec.features.map((feature) => <div key={feature.id} className="rounded-md border border-line bg-slate-50 p-3 text-[13px]"><strong>{feature.id}</strong><div>{feature.title}</div><div className="text-muted">{feature.status}</div></div>)}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FactBox title={text.requirements} items={selected.requirements.map((item) => `${item.id}: ${item.body}`)} />
            <FactBox title={text.qualityChecklist} items={selected.qualityChecklist.map((item) => `${item.passed ? "Pass" : "Fail"} ${item.item}`)} />
            <FactBox title={text.contracts} items={selected.contracts.map((item) => JSON.stringify(item))} />
            <FactBox title={text.specDiff} items={selected.versionDiffs.map((item) => JSON.stringify(item))} />
          </div>
        </div>
      ) : <EmptyState title={text.noFeatureSpecs} />}
    </Panel>
  );
}

function SkillCenter({ data, text }: { data: ConsoleData; text: ConsoleCopy }) {
  return (
    <Panel>
      <SectionTitle title={text.skillCenter} />
      {data.skills.skills.length > 0 ? (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {data.skills.skills.map((skill) => (
            <div key={skill.slug} className="rounded-lg border border-line bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-semibold">{skill.name}</div><div className="text-[12px] text-muted">{skill.slug} · v{skill.version}</div></div>
                <Chip tone={skill.enabled ? "green" : "neutral"}>{skill.enabled ? text.enabled : text.disabled}</Chip>
              </div>
              <FactList rows={[[text.phase, skill.phase], [text.risk, skill.riskLevel], [text.success, `${Math.round(skill.successRate * 100)}%`]]} />
            </div>
          ))}
        </div>
      ) : <EmptyState title={text.noSkills} />}
    </Panel>
  );
}

function Subagents(props: { data: ConsoleData; text: ConsoleCopy; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return <SubagentPanel {...props} />;
}

function Runner(props: { data: ConsoleData; text: ConsoleCopy; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return <RunnerPanel {...props} />;
}

function Reviews(props: { data: ConsoleData; text: ConsoleCopy; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return <ReviewsPanel {...props} />;
}

function CreateProjectDialog({ text, onCreate }: { text: ConsoleCopy; onCreate: (form: ProjectCreateForm) => void }) {
  const [form, setForm] = useState<ProjectCreateForm>({
    mode: "import_existing",
    name: "",
    goal: "",
    projectType: "autobuild-project",
    techPreferences: "",
    existingProjectPath: "",
    workspaceSlug: "",
    defaultBranch: "main",
    automationEnabled: false,
  });
  const updateForm = (patch: Partial<ProjectCreateForm>) => setForm((previous) => ({ ...previous, ...patch }));
  const sharedFields = (
    <>
      <label className="block text-[13px] font-medium">
        {text.projectName}
        <input
          className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
          value={form.name}
          onChange={(event) => updateForm({ name: event.target.value, workspaceSlug: form.workspaceSlug || slugifyProjectName(event.target.value) })}
          placeholder="SpecDrive Demo"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] font-medium">
          {text.defaultBranch}
          <input
            className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
            value={form.defaultBranch}
            onChange={(event) => updateForm({ defaultBranch: event.target.value })}
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-[13px]">
          <input
            type="checkbox"
            checked={form.automationEnabled}
            onChange={(event) => updateForm({ automationEnabled: event.target.checked })}
          />
          {text.automationEnabled}
        </label>
      </div>
    </>
  );
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button className="h-9 whitespace-nowrap" aria-label={text.createProject}>
          <Plus size={15} />
          {text.createProject}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/20" />
        <Dialog.Content className="fixed left-1/2 top-6 max-h-[calc(100vh-48px)] w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-auto rounded-lg border border-line bg-white p-5 shadow-panel">
          <Dialog.Title className="text-[16px] font-semibold">{text.createProject}</Dialog.Title>
          <Dialog.Description className="mt-2 text-[13px] text-muted">{text.createProjectDescription}</Dialog.Description>
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
              <button
                type="button"
                className={`h-9 rounded-md text-[13px] font-medium ${form.mode === "import_existing" ? "bg-white shadow-sm" : "text-muted"}`}
                onClick={() => updateForm({ mode: "import_existing" })}
              >
                {text.importExistingProject}
              </button>
              <button
                type="button"
                className={`h-9 rounded-md text-[13px] font-medium ${form.mode === "create_new" ? "bg-white shadow-sm" : "text-muted"}`}
                onClick={() => updateForm({ mode: "create_new" })}
              >
                {text.createNewProject}
              </button>
            </div>
            {form.mode === "import_existing" ? (
              <>
                {sharedFields}
                <label className="block text-[13px] font-medium">
                  {text.existingProjectPath}
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                    value={form.existingProjectPath}
                    onChange={(event) => updateForm({ existingProjectPath: event.target.value })}
                    placeholder="/home/john/Projects/existing-app"
                  />
                </label>
              </>
            ) : (
              <>
                {sharedFields}
                <label className="block text-[13px] font-medium">
                  {text.projectGoal}
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                    value={form.goal}
                    onChange={(event) => updateForm({ goal: event.target.value })}
                    placeholder="Automate spec-driven delivery"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-[13px] font-medium">
                    {text.projectType}
                    <input
                      className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                      value={form.projectType}
                      onChange={(event) => updateForm({ projectType: event.target.value })}
                    />
                  </label>
                  <label className="block text-[13px] font-medium">
                    {text.workspaceSlug}
                    <input
                      className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                      value={form.workspaceSlug}
                      onChange={(event) => updateForm({ workspaceSlug: slugifyProjectName(event.target.value) })}
                      placeholder="new-client-app"
                    />
                  </label>
                </div>
                <label className="block text-[13px] font-medium">
                  {text.techPreferences}
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                    value={form.techPreferences}
                    onChange={(event) => updateForm({ techPreferences: event.target.value })}
                    placeholder="TypeScript, React, Node.js"
                  />
                </label>
              </>
            )}
            <div className="flex justify-end">
              <Dialog.Close asChild>
                <Button tone="primary" onClick={() => onCreate(form)}>{text.submitCommand}</Button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CreateFeatureDialog({ text, onCreate }: { text: ConsoleCopy; onCreate: () => void }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild><Button tone="primary"><Plus size={15} />{text.createFeature}</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/20" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-white p-5 shadow-panel">
          <Dialog.Title className="text-[16px] font-semibold">{text.createFeature}</Dialog.Title>
          <Dialog.Description className="mt-2 text-[13px] text-muted">{text.createFeatureDescription}</Dialog.Description>
          <div className="mt-4 space-y-3">
            <input className="h-10 w-full rounded-md border border-line px-3 text-[13px]" value="Product Console UI acceptance" readOnly />
            <div className="flex justify-end"><Dialog.Close asChild><Button tone="primary" onClick={onCreate}>{text.submitCommand}</Button></Dialog.Close></div>
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
