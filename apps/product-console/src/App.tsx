import * as Tabs from "@radix-ui/react-tabs";
import * as Toast from "@radix-ui/react-toast";
import {
  Bell,
  ClipboardList,
  Code2,
  FileText,
  GitBranch,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Settings,
  SquareKanban,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  createConsoleProject,
  deleteConsoleProject,
  fetchConsoleData,
  fetchProjectOverview,
  fetchProjectSummaries,
  fetchSpecWorkspace,
  importDemoSeedProject,
  submitCommand,
} from "./lib/api";
import { i18n, localeStorageKey, type UiStrings, type Locale, type ViewKey } from "./lib/i18n";
import { formatRelativeTime, inferProjectNameFromPath, slugifyProjectName } from "./lib/utils";
import type { CommandReceipt, ConsoleData, ProjectCreateForm, ProjectOverviewModel, ProjectSummary } from "./types";
import { Button, Chip } from "./components/ui/primitives";
import { CreateProjectDialog } from "./components/CreateProjectDialog";
import { ChatPanel } from "./components/ChatPanel";
import { OverviewPage } from "./pages/OverviewPage";
import { BoardPage } from "./pages/BoardPage";
import { SpecPage } from "./pages/SpecPage";
import { RunnerPage } from "./pages/RunnerPage";
import { ReviewsPage } from "./pages/ReviewsPage";
import { SettingsPage } from "./pages/SettingsPage";

const projectStorageKey = "specdrive-current-project";
const emptyOverviewData: ProjectOverviewModel = {
  summary: {
    totalProjects: 0,
    healthyProjects: 0,
    blockedProjects: 0,
    failedTasks: 0,
    pendingReviews: 0,
    onlineRunners: 0,
    totalCostUsd: 0,
  },
  projects: [],
  signals: [],
  factSources: ["projects"],
};
const emptyProjectData: Omit<ConsoleData, "projects" | "overview"> = {
  dashboard: {
    projectHealth: { totalProjects: 0, ready: 0, blocked: 0, failed: 0 },
    activeFeatures: [],
    boardCounts: {},
    activeRuns: 0,
    todayAutomaticExecutions: 0,
    failedTasks: [],
    pendingApprovals: 0,
    cost: { totalUsd: 0, tokensUsed: 0 },
    runner: { heartbeats: 0, online: 0, successRate: 0, failureRate: 0 },
    recentPullRequests: [],
    risks: [],
    performance: { loadMs: 0 },
    factSources: [],
  },
  board: { tasks: [], commands: [], factSources: [] },
  spec: { features: [] },
  runner: { runners: [], factSources: [] },
  settings: {
    cliAdapter: {
      active: {
        id: "unconfigured",
        displayName: "Unconfigured",
        schemaVersion: 1,
        executable: "",
        argumentTemplate: [],
        configSchema: {},
        formSchema: {},
        defaults: {},
        environmentAllowlist: [],
        outputMapping: {},
        status: "disabled",
        updatedAt: "",
      },
      presets: [],
      validation: { valid: false, errors: [] },
    },
    commands: [],
    factSources: [],
  },
  reviews: { items: [], riskFilters: [] },
  audit: {
    summary: {
      totalEvents: 0,
      acceptedCommands: 0,
      blockedCommands: 0,
      stateTransitions: 0,
      activityCount: 0,
      pendingApprovals: 0,
    },
    timeline: [],
    executionResults: [],
    approvals: [],
    filters: { eventTypes: [], entityTypes: [], statuses: [] },
    factSources: [],
  },
};

const navItems: Array<{ key: ViewKey; icon: typeof LayoutDashboard }> = [
  { key: "overview", icon: LayoutDashboard },
  { key: "board", icon: SquareKanban },
  { key: "spec", icon: FileText },
  { key: "runner", icon: Play },
  { key: "reviews", icon: ClipboardList },
  { key: "settings", icon: Settings },
];

function readInitialLocale(): Locale {
  if (typeof window === "undefined") {
    return "zh-CN";
  }
  return window.localStorage.getItem(localeStorageKey) === "en" ? "en" : "zh-CN";
}

function readInitialProjectId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(projectStorageKey) ?? "";
}

function readInitialView(): ViewKey {
  if (typeof window === "undefined") {
    return "overview";
  }
  const hash = window.location.hash.slice(1) as ViewKey;
  const validKeys: ViewKey[] = ["overview", "board", "spec", "runner", "reviews", "settings"];
  return validKeys.includes(hash) ? hash : "overview";
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

function mergeLoadedProjects(loadedProjects: ProjectSummary[], currentProjects: ProjectSummary[]): ProjectSummary[] {
  const merged = new Map(loadedProjects.map((project) => [project.id, project]));
  currentProjects.forEach((project) => {
    if (!merged.has(project.id)) {
      merged.set(project.id, project);
    }
  });
  return Array.from(merged.values());
}

export function App() {
  const [view, setView] = useState<ViewKey>(readInitialView);
  const [locale, setLocale] = useState<Locale>(readInitialLocale);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [overviewData, setOverviewData] = useState(emptyOverviewData);
  const [currentProjectId, setCurrentProjectId] = useState(readInitialProjectId);
  const [projectDataCache, setProjectDataCache] = useState<Record<string, Omit<ConsoleData, "projects">>>({});
  const [selectedTaskId, setSelectedTaskId] = useState("T-230");
  const [receipt, setReceipt] = useState<CommandReceipt | undefined>();
  const [isPending, startTransition] = useTransition();
  const text = i18n[locale];
  const currentProject = currentProjectId
    ? projects.find((project) => project.id === currentProjectId)
    : undefined;
  const currentData = bindProjects(
    { ...(currentProject ? projectDataCache[currentProject.id] ?? emptyProjectData : emptyProjectData), overview: overviewData },
    projects,
    currentProject?.id ?? "",
  );
  const selectedTask = useMemo(
    () => currentData.board.tasks.find((task) => task.id === selectedTaskId) ?? currentData.board.tasks[0],
    [currentData.board.tasks, selectedTaskId],
  );

  useEffect(() => {
    window.location.hash = view;
  }, [view]);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1) as ViewKey;
      const validKeys: ViewKey[] = ["overview", "board", "spec", "runner", "reviews", "settings"];
      if (validKeys.includes(hash)) {
        setView(hash);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchProjectOverview()
      .then((overview) => {
        if (cancelled) {
          return;
        }
        setOverviewData(overview);
        const loadedProjects = overview.projects.map((project) => ({
          id: project.id,
          name: project.name,
          repository: project.repository,
          projectDirectory: project.projectDirectory,
          defaultBranch: project.defaultBranch,
          health: project.health,
          lastActivityAt: project.lastActivityAt,
        }));
        setProjects((previousProjects) => {
          const nextProjects = mergeLoadedProjects(loadedProjects, previousProjects);
          setCurrentProjectId((previousProjectId) => {
            if (nextProjects.some((project) => project.id === previousProjectId)) {
              return previousProjectId;
            }
            const nextProjectId = nextProjects[0]?.id ?? "";
            if (nextProjectId) {
              window.localStorage.setItem(projectStorageKey, nextProjectId);
            } else {
              window.localStorage.removeItem(projectStorageKey);
            }
            return nextProjectId;
          });
          return nextProjects;
        });
      })
      .catch(() => {
        setReceipt({
          id: `overview-error-${Date.now()}`,
          action: "create_project",
          status: "blocked",
          entityType: "project",
          entityId: "project-overview",
          acceptedAt: new Date().toISOString(),
          blockedReasons: [text.projectOverviewLoadFailed],
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentProject) {
      return;
    }
    let cancelled = false;
    fetchConsoleData(currentProject.id)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setProjectDataCache((previous) => ({ ...previous, [currentProject.id]: data }));
      })
      .catch(() => {
        setReceipt({
          id: `project-data-error-${Date.now()}`,
          action: "create_project",
          status: "blocked",
          entityType: "project",
          entityId: currentProject.id,
          projectId: currentProject.id,
          acceptedAt: new Date().toISOString(),
          blockedReasons: [text.projectDataLoadFailed],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [currentProject?.id]);

  useEffect(() => {
    if (currentData.board.tasks.length === 0 || currentData.board.tasks.some((task) => task.id === selectedTaskId)) {
      return;
    }
    setSelectedTaskId(currentData.board.tasks[0].id);
  }, [currentData.board.tasks, selectedTaskId]);

  async function runCommand(action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>, commandProjectId = currentProject?.id ?? "") {
    if (!commandProjectId) {
      return;
    }
    startTransition(async () => {
      try {
        const nextReceipt = await submitCommand({
          action,
          entityType,
          entityId,
          projectId: commandProjectId,
          reason: action === "run_board_tasks" ? "Run selected board task from demo project." : `Operator requested ${action}.`,
          payload: { projectId: commandProjectId, ...payload },
        });
        setReceipt(nextReceipt);
        try {
          const [nextProjectData, nextOverviewData] = await Promise.all([
            fetchConsoleData(commandProjectId),
            fetchProjectOverview(),
          ]);
          setProjectDataCache((previous) => ({ ...previous, [commandProjectId]: nextProjectData }));
          setOverviewData(nextOverviewData);
          const loadedProjects = nextOverviewData.projects.map((project) => ({
            id: project.id,
            name: project.name,
            repository: project.repository,
            projectDirectory: project.projectDirectory,
            defaultBranch: project.defaultBranch,
            health: project.health,
            lastActivityAt: project.lastActivityAt,
          }));
          if (loadedProjects.length > 0) {
            setProjects(loadedProjects);
          }
        } catch {
          // Keep the accepted command receipt visible when a follow-up refresh fails.
        }
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

  function selectSpecFeature(featureId: string) {
    if (!currentProject) {
      return;
    }
    startTransition(async () => {
      try {
        const spec = await fetchSpecWorkspace(currentProject.id, featureId);
        setProjectDataCache((previous) => {
          const current = previous[currentProject.id];
          if (!current) {
            return previous;
          }
          return {
            ...previous,
            [currentProject.id]: {
              ...current,
              spec,
            },
          };
        });
      } catch {
        // Keep the list selection responsive when detail refresh fails.
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
    setSelectedTaskId("");
    setReceipt(undefined);
  }

  function createProject(form: ProjectCreateForm) {
    const inferredImportName = inferProjectNameFromPath(form.existingProjectPath);
    const projectName = form.name.trim()
      || (form.mode === "import_existing" && inferredImportName)
      || (locale === "zh-CN" ? "新 AutoBuild 项目" : "New AutoBuild Project");
    const normalizedForm = {
      ...form,
      name: projectName,
      goal: form.goal.trim() || "Created from SpecDrive Console",
      projectType: form.projectType.trim() || "autobuild-project",
      workspaceSlug: slugifyProjectName(form.workspaceSlug || projectName),
      defaultBranch: form.defaultBranch.trim() || "main",
      repositoryUrl: form.repositoryUrl.trim(),
    };
    startTransition(async () => {
      let nextProject: ProjectSummary;
      try {
        nextProject = await createConsoleProject(normalizedForm);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isDuplicatePath = message.startsWith("project_path_already_registered:");
        const duplicatePath = isDuplicatePath ? message.slice("project_path_already_registered:".length) : "";
        setReceipt({
          id: `create-error-${Date.now()}`,
          action: "create_project",
          status: "blocked",
          entityType: "project",
          entityId: normalizedForm.name,
          acceptedAt: new Date().toISOString(),
          blockedReasons: [
            isDuplicatePath
              ? locale === "zh-CN"
                ? `项目创建失败：路径已绑定到已有项目，不能重复创建。${duplicatePath}`
                : `Project creation failed: this path is already registered to an existing project. ${duplicatePath}`
              : locale === "zh-CN"
                ? `项目创建失败：${message}`
                : `Project creation failed: ${message}`,
          ],
        });
        return;
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

  function importDemoSeed() {
    startTransition(async () => {
      try {
        const result = await importDemoSeedProject();
        const nextOverviewData = await fetchProjectOverview();
        const loadedProjects = nextOverviewData.projects.map((project) => ({
          id: project.id,
          name: project.name,
          repository: project.repository,
          projectDirectory: project.projectDirectory,
          defaultBranch: project.defaultBranch,
          health: project.health,
          lastActivityAt: project.lastActivityAt,
        }));
        setOverviewData(nextOverviewData);
        setProjects(loadedProjects.length > 0 ? loadedProjects : [result.project]);
        setReceipt({
          id: `seed-demo-${Date.now()}`,
          action: "create_project",
          status: "accepted",
          entityType: "project",
          entityId: result.project.id,
          projectId: result.project.id,
          acceptedAt: new Date().toISOString(),
          blockedReasons: [
            result.imported ? text.demoSeedImported : text.demoSeedAlreadyImported,
          ],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isDuplicatePath = message.startsWith("project_path_already_registered:");
        setReceipt({
          id: `seed-demo-error-${Date.now()}`,
          action: "create_project",
          status: "blocked",
          entityType: "project",
          entityId: "demo-seed",
          acceptedAt: new Date().toISOString(),
          blockedReasons: [
            isDuplicatePath
              ? text.demoSeedPathConflict
              : `${text.demoSeedImportFailed}: ${message}`,
          ],
        });
      }
    });
  }

  function removeProject(project: ProjectSummary) {
    if (!window.confirm(text.deleteProjectConfirm(project.name))) {
      return;
    }
    startTransition(async () => {
      try {
        await deleteConsoleProject(project.id);
      } catch (error) {
        setReceipt({
          id: `delete-error-${Date.now()}`,
          action: "delete_project",
          status: "blocked",
          entityType: "project",
          entityId: project.id,
          projectId: project.id,
          acceptedAt: new Date().toISOString(),
          blockedReasons: [
            `${text.deleteProjectFailed}: ${error instanceof Error ? error.message : String(error)}`,
          ],
        });
        return;
      }
      let remainingProjects = projects.filter((item) => item.id !== project.id);
      try {
        const loadedProjects = await fetchProjectSummaries();
        remainingProjects = loadedProjects.filter((item) => item.id !== project.id);
      } catch {
        // Local state still reflects the operator's delete action when refresh is unavailable.
      }
      const fallbackProject = remainingProjects[0];
      setProjects(remainingProjects);
      if (currentProjectId === project.id) {
        if (fallbackProject) {
          switchProject(fallbackProject.id);
        } else {
          setCurrentProjectId("");
          window.localStorage.removeItem(projectStorageKey);
        }
      }
      setReceipt({
        id: `delete-${project.id}`,
        action: "delete_project",
        status: "accepted",
        entityType: "project",
        entityId: project.id,
        acceptedAt: new Date().toISOString(),
        blockedReasons: [`${text.deleteProjectSuccess}: ${project.name}`],
      });
    });
  }

  return (
    <Toast.Provider swipeDirection="right">
      <div className={`console-shell grid h-screen overflow-hidden ${sidebarCollapsed ? "grid-cols-[72px_1fr]" : "grid-cols-[220px_1fr]"} bg-canvas text-ink transition-[grid-template-columns] duration-200 max-md:block max-md:h-auto max-md:min-h-screen max-md:overflow-visible`}>
        <aside className="console-sidebar sticky top-0 h-screen border-r border-line bg-white transition-[width] max-md:static max-md:h-auto max-md:border-b max-md:border-r-0">
          <div className={`flex h-16 items-center gap-3 border-b border-line ${sidebarCollapsed ? "justify-center px-2 max-md:justify-between max-md:px-4" : "px-5"}`}>
            <div className="grid size-8 place-items-center rounded-md border border-slate-300 text-action">
              <Code2 size={18} strokeWidth={2.2} />
            </div>
            <div className={`whitespace-nowrap text-[15px] font-semibold max-md:block ${sidebarCollapsed ? "hidden" : "block"}`}>SpecDrive Console</div>
            <button
              className={`${sidebarCollapsed ? "absolute right-2 top-3 max-md:static" : "ml-auto"} inline-flex size-9 items-center justify-center rounded-md border border-transparent text-muted hover:border-line hover:bg-slate-50 hover:text-ink`}
              aria-label={sidebarCollapsed ? text.expandNavigation : text.collapseNavigation}
              title={sidebarCollapsed ? text.expandNavigation : text.collapseNavigation}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
          <nav className="space-y-1 p-2 max-md:grid max-md:grid-cols-2 max-md:gap-1 max-md:space-y-0" aria-label={text.consoleNavigation}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.key === view;
              const label = text.nav[item.key];
              return (
                <button
                  key={item.key}
                  className={`flex h-11 w-full items-center gap-3 rounded-md px-4 text-left text-[14px] transition-colors ${
                    active ? "bg-blue-50 text-action" : "text-slate-700 hover:bg-slate-50"
                  } ${sidebarCollapsed ? "justify-center px-2 max-md:justify-start max-md:px-4" : ""}`}
                  onClick={() => setView(item.key)}
                  title={label}
                >
                  <Icon size={18} />
                  <span className={`max-md:inline ${sidebarCollapsed ? "sr-only" : "inline"}`}>{label}</span>
                </button>
              );
            })}
          </nav>
          <div className={`absolute bottom-3 left-3 right-3 rounded-lg border border-line bg-slate-50 p-3 max-md:static max-md:m-3 ${sidebarCollapsed ? "hidden max-md:block" : ""}`}>
            <div className="text-[13px] font-semibold">{text.autobuildTeam}</div>
            <div className="mt-1 text-[12px] text-muted">{text.operator}</div>
          </div>
        </aside>

        <main className="flex h-screen min-w-0 flex-col overflow-hidden max-md:h-auto max-md:w-full max-md:overflow-visible">
          <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-6 shadow-sm max-md:px-4">
            <div className="flex min-w-0 items-center gap-6 max-md:w-full max-md:flex-wrap max-md:gap-2">
              <div className="min-w-0 max-md:flex-1">
                <div className="flex items-center gap-2 max-md:flex-wrap">
                  <select
                    className="h-9 max-w-[260px] rounded-md border border-line bg-white px-3 text-[14px] font-semibold text-ink max-md:min-w-0 max-md:flex-1"
                    aria-label={text.projectList}
                    value={currentProject?.id ?? ""}
                    onChange={(event) => switchProject(event.target.value)}
                    disabled={projects.length === 0}
                  >
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                  <CreateProjectDialog text={text} onCreate={createProject} />
                  <Button
                    tone="danger"
                    className="size-9 px-0"
                    aria-label={text.deleteProject}
                    title={text.deleteProject}
                    onClick={() => currentProject ? removeProject(currentProject) : undefined}
                    disabled={isPending || !currentProject}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
              <Button className="h-8">
                <GitBranch size={14} />
                {currentProject?.defaultBranch ?? text.none}
              </Button>
              <div className="min-w-0 truncate text-[12px] text-muted max-md:w-full max-md:whitespace-normal max-md:break-all">
                {currentProject ? (
                  <><span className="font-medium text-ink">{currentProject.name}</span> · {text.projectDirectory}: {currentProject.projectDirectory}</>
                ) : text.noProjectsDescription}
              </div>
            </div>
            <div className="flex items-center gap-3 max-md:flex-wrap">
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
              <Chip tone="green">{text.healthy}</Chip>
              <Bell size={18} />
              <div className="grid size-9 place-items-center rounded-full bg-slate-100 text-[13px] font-semibold">OP</div>
            </div>
          </header>

          <div data-testid="console-content-scroll" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto space-y-5 p-5 pb-14 max-md:overflow-visible">
            {!currentProject ? (
              <section className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
                <div className="max-w-xl text-center">
                  <h1 className="text-2xl font-semibold text-ink">{text.noProjectsTitle}</h1>
                  <p className="mt-3 text-[14px] leading-6 text-muted">{text.noProjectsDescription}</p>
                  <div className="mt-5 flex justify-center">
                    <CreateProjectDialog text={text} onCreate={createProject} />
                    <Button className="ml-3" onClick={importDemoSeed} disabled={isPending}>
                      {text.importDemoSeed}
                    </Button>
                  </div>
                </div>
              </section>
            ) : (
            <Tabs.Root value={view} onValueChange={(value) => setView(value as ViewKey)}>
              <Tabs.List className="sr-only" aria-label={text.consoleNavigation}>
                {navItems.map((item) => <Tabs.Trigger key={item.key} value={item.key}>{text.nav[item.key]}</Tabs.Trigger>)}
              </Tabs.List>
              <Tabs.Content value="overview">
                <OverviewPage
                  data={currentData}
                  text={text}
                  currentProjectId={currentProject.id}
                  onSelectProject={switchProject}
                  onViewBoard={(projectId) => {
                    switchProject(projectId);
                    setView("board");
                  }}
                />
              </Tabs.Content>
              <Tabs.Content value="board">
                <BoardPage data={currentData} text={text} project={currentProject} selectedTask={selectedTask} onSelectTask={setSelectedTaskId} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
              <Tabs.Content value="spec">
                <SpecPage
                  data={currentData}
                  text={text}
                  currentProject={currentProject}
                  onCreateProject={createProject}
                  onCommand={runCommand}
                  onSelectFeature={selectSpecFeature}
                />
              </Tabs.Content>
              <Tabs.Content value="runner">
                <RunnerPage data={currentData} text={text} onCommand={runCommand} busy={isPending} onOpenSettings={() => setView("settings")} />
              </Tabs.Content>
              <Tabs.Content value="reviews">
                <ReviewsPage data={currentData} text={text} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
              <Tabs.Content value="settings">
                <SettingsPage data={currentData} text={text} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
            </Tabs.Root>
            )}
          </div>
          <footer className="hidden h-10 items-center justify-between border-t border-line bg-white px-6 text-[12px] text-muted lg:flex">
            <div className="flex items-center gap-8">
              <span>{text.git}: {currentProject?.defaultBranch ?? text.none} <span className="text-emerald-600">✓</span></span>
              <span>
                <span className={`mr-2 inline-block size-2 rounded-full ${overviewData.summary.onlineRunners > 0 ? "bg-emerald-500" : "bg-slate-400"}`} />
                {text.runner}: {overviewData.summary.onlineRunners > 0 ? text.online : text.offline}
              </span>
              <span>{text.lastSync}: {formatRelativeTime(
                overviewData.projects.map((p) => p.lastActivityAt).filter(Boolean).sort().at(-1),
                locale,
              )}</span>
            </div>
            <div className="flex items-center gap-3">
              <span>{text.autoRefresh}</span>
              <span className="inline-flex h-5 w-9 items-center rounded-full bg-action p-0.5"><span className="ml-auto size-4 rounded-full bg-white" /></span>
            </div>
          </footer>
        </main>
      </div>
      {receipt ? (
        <Toast.Root key={`${receipt.id}-${receipt.status}-${receipt.action}`} className="fixed bottom-5 right-5 z-50 w-96 rounded-lg border border-line bg-white p-4 shadow-panel">
          <Toast.Title className="text-[14px] font-semibold">{receipt.status === "accepted" ? text.commandAccepted : text.commandBlocked}</Toast.Title>
          <Toast.Description className="mt-2 text-[13px] text-muted">
            {receipt.blockedReasons?.[0] ?? `${receipt.action} recorded for ${receipt.entityId}.`}
          </Toast.Description>
        </Toast.Root>
      ) : null}
      <Toast.Viewport />
      {currentProject ? <ChatPanel open={showChat} onToggle={() => setShowChat((prev) => !prev)} projectId={currentProject.id} locale={locale} /> : null}
    </Toast.Provider>
  );
}
