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
  submitCommand,
} from "./lib/api";
import { i18n, localeStorageKey, type UiStrings, type Locale, type ViewKey } from "./lib/i18n";
import { formatRelativeTime, inferProjectNameFromPath, slugifyProjectName } from "./lib/utils";
import { demoData, getDemoDataForProject } from "./lib/demo-data";
import type { CommandReceipt, ConsoleData, ProjectCreateForm, ProjectSummary } from "./types";
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
const demoProjectIds = new Set(demoData.projects.projects.map((project) => project.id));

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
    return "project-1";
  }
  return window.localStorage.getItem(projectStorageKey) ?? "project-1";
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
  currentProjects
    .filter((project) => !demoProjectIds.has(project.id))
    .forEach((project) => {
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
  const [projects, setProjects] = useState<ProjectSummary[]>(demoData.projects.projects);
  const [overviewData, setOverviewData] = useState(demoData.overview);
  const [currentProjectId, setCurrentProjectId] = useState(readInitialProjectId);
  const [projectDataCache, setProjectDataCache] = useState<Record<string, Omit<ConsoleData, "projects">>>({});
  const [selectedTaskId, setSelectedTaskId] = useState("T-230");
  const [receipt, setReceipt] = useState<CommandReceipt | undefined>();
  const [isPending, startTransition] = useTransition();
  const text = i18n[locale];
  const currentProject = projects.find((project) => project.id === currentProjectId) ?? projects[0] ?? demoData.projects.projects[0];
  const currentData = bindProjects(
    { ...(projectDataCache[currentProject.id] ?? getDemoDataForProject(currentProject.id)), overview: overviewData },
    projects,
    currentProject.id,
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
        if (loadedProjects.length === 0) {
          return;
        }
        setProjects((previousProjects) => {
          const nextProjects = mergeLoadedProjects(loadedProjects, previousProjects);
          setCurrentProjectId((previousProjectId) => {
            if (nextProjects.some((project) => project.id === previousProjectId)) {
              return previousProjectId;
            }
            const nextProjectId = nextProjects[0]?.id ?? previousProjectId;
            window.localStorage.setItem(projectStorageKey, nextProjectId);
            return nextProjectId;
          });
          return nextProjects;
        });
      })
      .catch(() => {
        // The console can still run against bundled demo data when the API is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (demoProjectIds.has(currentProject.id)) {
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
        // Fall back to bundled demo data when the API is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [currentProject.id]);

  useEffect(() => {
    if (currentData.board.tasks.length === 0 || currentData.board.tasks.some((task) => task.id === selectedTaskId)) {
      return;
    }
    setSelectedTaskId(currentData.board.tasks[0].id);
  }, [currentData.board.tasks, selectedTaskId]);

  async function runCommand(action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>, commandProjectId = currentProject.id) {
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

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    window.localStorage.setItem(localeStorageKey, nextLocale);
  }

  function switchProject(nextProjectId: string) {
    setCurrentProjectId(nextProjectId);
    window.localStorage.setItem(projectStorageKey, nextProjectId);
    setSelectedTaskId(
      demoProjectIds.has(nextProjectId)
        ? (getDemoDataForProject(nextProjectId).board.tasks[0]?.id ?? "")
        : "",
    );
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
      const fallbackProject = remainingProjects[0] ?? demoData.projects.projects[0];
      setProjects(remainingProjects.length ? remainingProjects : [fallbackProject]);
      if (currentProjectId === project.id) {
        switchProject(fallbackProject.id);
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
                    value={currentProject.id}
                    onChange={(event) => switchProject(event.target.value)}
                  >
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                  <CreateProjectDialog text={text} onCreate={createProject} />
                  <Button
                    tone="danger"
                    className="size-9 px-0"
                    aria-label={text.deleteProject}
                    title={text.deleteProject}
                    onClick={() => removeProject(currentProject)}
                    disabled={isPending || projects.length === 0}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
              <Button className="h-8">
                <GitBranch size={14} />
                {currentProject.defaultBranch}
              </Button>
              <div className="min-w-0 truncate text-[12px] text-muted max-md:w-full max-md:whitespace-normal max-md:break-all">
                <span className="font-medium text-ink">{currentProject.name}</span> · {text.projectDirectory}: {currentProject.projectDirectory}
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
                <SpecPage data={currentData} text={text} currentProject={currentProject} onCreateProject={createProject} onCommand={runCommand} />
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
          </div>
          <footer className="hidden h-10 items-center justify-between border-t border-line bg-white px-6 text-[12px] text-muted lg:flex">
            <div className="flex items-center gap-8">
              <span>{text.git}: {currentProject.defaultBranch} <span className="text-emerald-600">✓</span></span>
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
      <ChatPanel open={showChat} onToggle={() => setShowChat((prev) => !prev)} projectId={currentProject.id} locale={locale} />
    </Toast.Provider>
  );
}
