import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import * as Toast from "@radix-ui/react-toast";
import {
  Bell,
  Bot,
  Boxes,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Code2,
  ExternalLink,
  FileText,
  GitBranch,
  Home,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SquareKanban,
  Upload,
  Workflow,
  XCircle,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createConsoleProject, deleteConsoleProject, fetchProjectSummaries, scanProjectDirectory, submitCommand } from "./lib/api";
import { demoData, getDemoDataForProject } from "./lib/demo-data";
import type { BoardTask, CommandReceipt, ConsoleData, ProjectCreateForm, ProjectDirectoryScan, ProjectSummary } from "./types";
import { Button, Chip, EmptyState, Panel, SectionTitle } from "./components/ui/primitives";

type Locale = "zh-CN" | "en";
type ViewKey = "overview" | "board" | "spec" | "skills" | "subagents" | "runner" | "reviews";

const localeStorageKey = "specdrive-console-locale";
const projectStorageKey = "specdrive-current-project";
const demoProjectIds = new Set(demoData.projects.projects.map((project) => project.id));

const navItems: Array<{ key: ViewKey; icon: typeof Home }> = [
  { key: "overview", icon: LayoutDashboard },
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
      overview: "全局概况",
      board: "项目主页",
      spec: "Spec 工作台",
      skills: "Skill 中心",
      subagents: "Subagent",
      runner: "Runner",
      reviews: "审查",
    },
    consoleNavigation: "控制台导航",
    collapseNavigation: "收起导航",
    expandNavigation: "展开导航",
    project: "项目",
    currentProject: "当前项目",
    allProjects: "所有项目",
    globalOverview: "全局概况",
    globalOverviewSubtitle: "所有项目的健康、执行、审查和成本状态。",
    totalProjects: "项目总数",
    healthyProjects: "健康项目",
    blockedProjects: "阻塞项目",
    totalCost: "总成本",
    projectOverview: "项目概况",
    taskSummary: "任务",
    subagentsShort: "Subagents",
    runnerSuccessShort: "Runner 成功率",
    costUsd: "成本 (USD)",
    latestRisk: "最新风险",
    viewBoard: "查看项目主页",
    riskAndExecutionSignals: "风险与执行信号",
    viewAll: "查看全部",
    viewDetails: "查看详情",
    justNow: "刚刚",
    itemsTotal: (total: number) => `共 ${total} 项`,
    projectList: "项目列表",
    createProject: "创建项目",
    deleteProject: "删除项目",
    deleteProjectConfirm: (name: string) => `确认删除项目“${name}”？这只会移除控制台登记，不会删除磁盘仓库。`,
    deleteProjectSuccess: "项目已删除",
    deleteProjectFailed: "项目删除失败",
    createProjectDescription: "导入已有项目时只需设置目录，系统会自动扫描仓库信息；新项目统一创建到 workspace 目录。",
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
    scanRepository: "扫描仓库信息",
    scanningRepository: "正在扫描目录...",
    scanRepositoryFailed: "目录扫描失败",
    detectedProjectName: "识别项目",
    detectedDefaultBranch: "识别分支",
    detectedPackageManager: "包管理器",
    detectedRepository: "仓库来源",
    noScanYet: "设置目录后自动扫描项目名称、分支、仓库来源和技术栈。",
    projectDirectory: "项目目录",
    repository: "仓库",
    recentActivity: "最近活动",
    projectContextBlocked: "项目上下文不匹配",
    language: "语言",
    chinese: "中文",
    english: "English",
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
    projectHome: "项目主页",
    projectHomeSecondary: "Project Home",
    taskBoard: "任务看板",
    projectIdentity: "项目身份",
    latestActivity: "最近活动",
    currentActiveFeature: "当前活跃 Feature",
    automationStatus: "自动化状态",
    owner: "负责人",
    featureSpecPath: "Feature Spec",
    operationalSummary: "运行摘要",
    taskBoardCounts: "任务状态",
    currentRisks: "当前风险",
    recentPrs: "最近 PR",
    recentEvidenceEvents: "最近 Evidence / 审计",
    viewAllRisks: "查看全部风险",
    viewAllPrs: "查看全部 PR",
    viewAllEvidence: "查看全部 Evidence",
    noRisks: "当前没有项目风险。",
    noPullRequests: "没有最近 PR。",
    noEvidenceEvents: "没有最近 Evidence 或审计事件。",
    total: "总数",
    active: "活跃",
    lastSevenDays: "最近 7 天",
    requireAction: "需要处理",
    taskBoardGroup: "分组：无",
    filter: "筛选",
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
    runnerCenter: "Runner",
    runnerCenterSubtitle: "任务调度中心：统一查看任务排期、执行队列、资源和阻塞审计。",
    online: "在线",
    offline: "离线",
    heartbeat: "心跳",
    queue: "队列",
    pauseRunner: "暂停 Runner",
    resumeRunner: "恢复 Runner",
    onlineRunners: "在线 Runner",
    runningTasks: "运行中",
    readyTasks: "待排期",
    blockedTasks: "阻塞/审查",
    failureRate: "失败率",
    readyLane: "Ready",
    scheduledLane: "Scheduled",
    runningLane: "Running",
    blockedLane: "Blocked / Review",
    runnerResources: "资源池",
    recentTriggers: "最近调度",
    recentLogs: "最近日志",
    model: "模型",
    sandbox: "Sandbox",
    approvalPolicy: "审批策略",
    queueDepth: "队列深度",
    assignedRunner: "分配 Runner",
    currentRun: "当前 Run",
    dependencyOk: "依赖满足",
    dependencyBlocked: "依赖等待",
    reviewBlocked: "审查阻塞",
    observe: "观察",
    noRunnerTasks: "当前没有可调度任务。",
    factSourcesRunner: "事实源：task_graph_tasks、runs、runner_heartbeats、review_items、audit_timeline_events",
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
    blockedReasons: "阻塞原因",
    dependencyFacts: "依赖事实",
    approvalState: "审批状态",
    executionPlanNext: "下一步执行计划",
    scheduleMore: "排期...",
    specWorkspace: "Spec 工作台",
    prdWorkflow: "Spec 操作流程",
    prdWorkflowSubtitle: "先确认项目初始化，再录入 Spec 来源，生成可进入 Feature Spec Pool 的需求事实。",
    projectInitialization: "阶段 1 项目初始化",
    requirementIntake: "阶段 2 需求录入",
    featurePlanning: "阶段 3 规划执行",
    phaseFacts: "阶段事实",
    createOrImportProject: "创建/导入项目",
    connectGitRepository: "连接 Git 仓库",
    initializeSpecProtocol: "初始化 .autobuild / Spec Protocol",
    importOrCreateConstitution: "导入或创建项目宪章",
    initializeProjectMemory: "初始化 Project Memory",
    recognizeRequirementFormat: "识别 PR/RP/PRD/EARS",
    completeClarifications: "完成关键澄清",
    runRequirementQualityCheck: "执行需求质量检查",
    featureSpecPool: "推入 Feature Spec Pool",
    fixProjectInitialization: "请先完成项目初始化或修复仓库状态。",
    scanPrd: "扫描 Spec",
    uploadPrd: "上传 Spec",
    uploadPrdFileInput: "上传 Spec 文件",
    generateEars: "生成 EARS",
    generateHld: "生成 HLD",
    splitFeatureSpecs: "拆分 Feature Spec",
    enterPlanningPipeline: "进入规划流水线",
    planningPipeline: "规划流水线",
    runStatusChecks: "状态检查",
    currentPrdFile: "当前 Spec 来源",
    prdVersion: "Spec 版本",
    scanMode: "扫描模式",
    smartMode: "智能模式",
    lastScan: "最后扫描",
    runtime: "运行耗时",
    workflowPending: "待执行",
    workflowAccepted: "已接受",
    workflowBlocked: "已阻塞",
    workflowCompleted: "已完成",
    workflowBlockedItems: "阻塞项",
    viewAuditLog: "查看运行日志",
    sourceUploaded: "已选择上传文件",
    sourcePath: "来源路径",
    featureSpec: "Feature Spec",
    searchFeature: "搜索 Feature...",
    all: "全部",
    requirements: "需求",
    qualityChecklist: "质量检查清单",
    technicalPlan: "技术计划",
    taskGraph: "任务图",
    contracts: "契约",
    specDiff: "Spec Diff",
    folder: "目录",
    primaryRequirements: "主要需求",
    requirementList: "需求列表",
    requirementId: "ID",
    requirementBody: "需求描述",
    priority: "优先级",
    acceptance: "验收",
    clarification: "澄清",
    traceability: "需求 - 任务可追溯性",
    controlledActions: "受控操作",
    planPipeline: "规划流水线",
    scheduleTasks: "排期任务",
    runChecks: "运行检查",
    writeSpecEvolution: "写入 Spec Evolution",
    qualityGate: "质量门禁",
    recentEvidence: "最近 Evidence",
    audit: "审计",
    productApprovalRequired: "需要产品审批",
    defaultApprovalReason: "Refund decision copy requires review before customer demo.",
    pass: "通过",
    fail: "失败",
    acceptedStatus: "已验收",
    pendingAcceptance: "未验收",
    factSourcesSpec: "事实源：features、requirements、task_graphs、evidence_packs、delivery_reports",
    noSpecSectionData: "当前分区暂无可用 Spec 数据。",
    latestCommand: "最后命令",
    receivedAt: "接收时间",
    receiver: "接收人",
    version: "版本",
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
      overview: "Dashboard",
      board: "Project Home",
      spec: "Spec Workspace",
      skills: "Skill Center",
      subagents: "Subagents",
      runner: "Runner",
      reviews: "Reviews",
    },
    consoleNavigation: "Console navigation",
    collapseNavigation: "Collapse navigation",
    expandNavigation: "Expand navigation",
    project: "Project",
    currentProject: "Current Project",
    allProjects: "All Projects",
    globalOverview: "Global Overview",
    globalOverviewSubtitle: "Health, execution, review, and cost status across every project.",
    totalProjects: "Total Projects",
    healthyProjects: "Healthy Projects",
    blockedProjects: "Blocked Projects",
    totalCost: "Total Cost",
    projectOverview: "Project Overview",
    taskSummary: "Tasks",
    subagentsShort: "Subagents",
    runnerSuccessShort: "Runner Success",
    costUsd: "Cost (USD)",
    latestRisk: "Latest Risk",
    viewBoard: "View Project Home",
    riskAndExecutionSignals: "Risk & Execution Signals",
    viewAll: "View All",
    viewDetails: "View Details",
    justNow: "Just now",
    itemsTotal: (total: number) => `${total} items`,
    projectList: "Project List",
    createProject: "Create Project",
    deleteProject: "Delete Project",
    deleteProjectConfirm: (name: string) => `Delete project "${name}"? This only removes the console registration and does not delete the repository on disk.`,
    deleteProjectSuccess: "Project deleted",
    deleteProjectFailed: "Project deletion failed",
    createProjectDescription: "Set a directory to import an existing project and scan repository details automatically, or create a new project under workspace.",
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
    scanRepository: "Repository scan",
    scanningRepository: "Scanning directory...",
    scanRepositoryFailed: "Directory scan failed",
    detectedProjectName: "Detected project",
    detectedDefaultBranch: "Detected branch",
    detectedPackageManager: "Package manager",
    detectedRepository: "Repository source",
    noScanYet: "Set a directory to scan the project name, branch, repository source, and stack.",
    projectDirectory: "Project directory",
    repository: "Repository",
    recentActivity: "Recent activity",
    projectContextBlocked: "Project context mismatch",
    language: "Language",
    chinese: "中文",
    english: "English",
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
    projectHome: "Project Home",
    projectHomeSecondary: "项目主页",
    taskBoard: "Task Board",
    projectIdentity: "Project Identity",
    latestActivity: "Latest Activity",
    currentActiveFeature: "Current Active Feature",
    automationStatus: "Automation Status",
    owner: "Owner",
    featureSpecPath: "Feature Spec",
    operationalSummary: "Operational Summary",
    taskBoardCounts: "Task Board",
    currentRisks: "Current Risks",
    recentPrs: "Recent PRs",
    recentEvidenceEvents: "Recent Evidence / Audit Events",
    viewAllRisks: "View all risks",
    viewAllPrs: "View all PRs",
    viewAllEvidence: "View all evidence",
    noRisks: "No current project risks.",
    noPullRequests: "No recent PRs.",
    noEvidenceEvents: "No recent evidence or audit events.",
    total: "Total",
    active: "Active",
    lastSevenDays: "Last 7 days",
    requireAction: "Require action",
    taskBoardGroup: "Group: None",
    filter: "Filter",
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
    runnerCenter: "Runner",
    runnerCenterSubtitle: "Scheduling center for task queues, execution resources, and blocked audit trails.",
    online: "Online",
    offline: "Offline",
    heartbeat: "Heartbeat",
    queue: "Queue",
    pauseRunner: "Pause Runner",
    resumeRunner: "Resume Runner",
    onlineRunners: "Online Runners",
    runningTasks: "Running",
    readyTasks: "Ready",
    blockedTasks: "Blocked / Review",
    failureRate: "Failure Rate",
    readyLane: "Ready",
    scheduledLane: "Scheduled",
    runningLane: "Running",
    blockedLane: "Blocked / Review",
    runnerResources: "Resources",
    recentTriggers: "Recent Triggers",
    recentLogs: "Recent Logs",
    model: "Model",
    sandbox: "Sandbox",
    approvalPolicy: "Approval Policy",
    queueDepth: "Queue Depth",
    assignedRunner: "Assigned Runner",
    currentRun: "Current Run",
    dependencyOk: "Dependencies met",
    dependencyBlocked: "Dependencies waiting",
    reviewBlocked: "Review blocked",
    observe: "Observe",
    noRunnerTasks: "No schedulable tasks are available.",
    factSourcesRunner: "Fact sources: task_graph_tasks, runs, runner_heartbeats, review_items, audit_timeline_events",
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
    blockedReasons: "Blocked Reasons",
    dependencyFacts: "Dependency Facts",
    approvalState: "Approval State",
    executionPlanNext: "Execution Plan (Next)",
    scheduleMore: "Schedule...",
    specWorkspace: "Spec Workspace",
    prdWorkflow: "Spec Workflow",
    prdWorkflowSubtitle: "Confirm project initialization first, then intake Spec sources into the Feature Spec Pool.",
    projectInitialization: "Stage 1 Project Initialization",
    requirementIntake: "Stage 2 Requirement Intake",
    featurePlanning: "Stage 3 Planning Execution",
    phaseFacts: "Phase Facts",
    createOrImportProject: "Create / Import Project",
    connectGitRepository: "Connect Git Repository",
    initializeSpecProtocol: "Initialize .autobuild / Spec Protocol",
    importOrCreateConstitution: "Import or Create Constitution",
    initializeProjectMemory: "Initialize Project Memory",
    recognizeRequirementFormat: "Recognize PR/RP/PRD/EARS",
    completeClarifications: "Complete Clarifications",
    runRequirementQualityCheck: "Run Requirement Quality Check",
    featureSpecPool: "Push to Feature Spec Pool",
    fixProjectInitialization: "Complete project initialization or fix repository status first.",
    scanPrd: "Scan Spec",
    uploadPrd: "Upload Spec",
    uploadPrdFileInput: "Upload Spec File",
    generateEars: "Generate EARS",
    generateHld: "Generate HLD",
    splitFeatureSpecs: "Split Feature Spec",
    enterPlanningPipeline: "Enter Planning Pipeline",
    planningPipeline: "Planning Pipeline",
    runStatusChecks: "Status Checks",
    currentPrdFile: "Current Spec Source",
    prdVersion: "Spec Version",
    scanMode: "Scan Mode",
    smartMode: "Smart Mode",
    lastScan: "Last Scan",
    runtime: "Runtime",
    workflowPending: "Pending",
    workflowAccepted: "Accepted",
    workflowBlocked: "Blocked",
    workflowCompleted: "Completed",
    workflowBlockedItems: "Blocked Items",
    viewAuditLog: "View Run Log",
    sourceUploaded: "Selected Upload",
    sourcePath: "Source Path",
    featureSpec: "Feature Spec",
    searchFeature: "Search Feature...",
    all: "All",
    requirements: "Requirements",
    qualityChecklist: "Quality Checklist",
    technicalPlan: "Technical Plan",
    taskGraph: "Task Graph",
    contracts: "Contracts",
    specDiff: "Spec Diff",
    folder: "Folder",
    primaryRequirements: "Primary requirements",
    requirementList: "Requirement List",
    requirementId: "ID",
    requirementBody: "Requirement",
    priority: "Priority",
    acceptance: "Acceptance",
    clarification: "Clarification",
    traceability: "Requirement - Task Traceability",
    controlledActions: "Controlled Actions",
    planPipeline: "Plan Pipeline",
    scheduleTasks: "Schedule Tasks",
    runChecks: "Run Checks",
    writeSpecEvolution: "Write Spec Evolution",
    qualityGate: "Quality Gate",
    recentEvidence: "Recent Evidence",
    audit: "Audit",
    productApprovalRequired: "Product approval required",
    defaultApprovalReason: "Refund decision copy requires review before customer demo.",
    pass: "Pass",
    fail: "Fail",
    acceptedStatus: "Accepted",
    pendingAcceptance: "Pending",
    factSourcesSpec: "Fact sources: features, requirements, task_graphs, evidence_packs, delivery_reports",
    noSpecSectionData: "No Spec data is available for this section.",
    latestCommand: "Latest Command",
    receivedAt: "Received At",
    receiver: "Receiver",
    version: "Version",
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
} satisfies Record<Locale, Record<string, unknown> & { nav: Record<ViewKey, string>; ofTasks: (start: number, end: number, total: number) => string; reviewsTitle: (count: number) => string; itemsTotal: (total: number) => string }>;

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

function inferProjectNameFromPath(value: string): string {
  return value
    .trim()
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1)
    ?? "";
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
  const [view, setView] = useState<ViewKey>("overview");
  const [locale, setLocale] = useState<Locale>(readInitialLocale);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>(demoData.projects.projects);
  const [currentProjectId, setCurrentProjectId] = useState(readInitialProjectId);
  const [selectedTaskId, setSelectedTaskId] = useState("T-230");
  const [receipt, setReceipt] = useState<CommandReceipt | undefined>();
  const [isPending, startTransition] = useTransition();
  const text = copy[locale];
  const currentProject = projects.find((project) => project.id === currentProjectId) ?? projects[0] ?? demoData.projects.projects[0];
  const currentData = bindProjects(getDemoDataForProject(currentProject.id), projects, currentProject.id);
  const selectedTask = useMemo(
    () => currentData.board.tasks.find((task) => task.id === selectedTaskId) ?? currentData.board.tasks[0],
    [currentData.board.tasks, selectedTaskId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchProjectSummaries()
      .then((loadedProjects) => {
        if (cancelled || loadedProjects.length === 0) {
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
    setSelectedTaskId(getDemoDataForProject(nextProjectId).board.tasks[0]?.id ?? "");
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
      <div className={`console-shell grid min-h-screen ${sidebarCollapsed ? "grid-cols-[72px_1fr]" : "grid-cols-[220px_1fr]"} bg-canvas text-ink transition-[grid-template-columns] duration-200 max-md:block`}>
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

        <main className="min-w-0 max-md:w-full">
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

          <div className="space-y-5 p-5 pb-14">
            <Tabs.Root value={view} onValueChange={(value) => setView(value as ViewKey)}>
              <Tabs.List className="sr-only" aria-label={text.consoleNavigation}>
                {navItems.map((item) => <Tabs.Trigger key={item.key} value={item.key}>{text.nav[item.key]}</Tabs.Trigger>)}
              </Tabs.List>
              <Tabs.Content value="overview">
                <GlobalOverviewView
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
                <ProjectHomeView data={currentData} text={text} project={currentProject} selectedTask={selectedTask} onSelectTask={setSelectedTaskId} onCommand={runCommand} busy={isPending} />
              </Tabs.Content>
              <Tabs.Content value="spec">
                <SpecWorkspace data={currentData} text={text} currentProject={currentProject} onCommand={runCommand} />
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
          <footer className="hidden h-10 items-center justify-between border-t border-line bg-white px-6 text-[12px] text-muted lg:flex">
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

function GlobalOverviewView({
  data,
  text,
  currentProjectId,
  onSelectProject,
  onViewBoard,
}: {
  data: ConsoleData;
  text: ConsoleCopy;
  currentProjectId: string;
  onSelectProject: (projectId: string) => void;
  onViewBoard: (projectId: string) => void;
}) {
  const overviewProjects = mergeOverviewProjects(data);
  const summary = data.overview.summary;
  const metrics = [
    { label: text.totalProjects, value: String(summary.totalProjects), icon: FileText, tone: "blue" },
    { label: text.healthyProjects, value: String(summary.healthyProjects), icon: CheckCircle2, tone: "green" },
    { label: text.blockedProjects, value: String(summary.blockedProjects), icon: ShieldAlert, tone: summary.blockedProjects > 0 ? "amber" : "neutral" },
    { label: text.failedTasks, value: String(summary.failedTasks), icon: XCircle, tone: summary.failedTasks > 0 ? "red" : "green" },
    { label: text.pendingReviews, value: String(summary.pendingReviews), icon: ClipboardList, tone: summary.pendingReviews > 0 ? "amber" : "green" },
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
                    <th className="px-4 py-3">{text.subagentsShort}</th>
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
                              <div className="mt-1 max-w-[220px] truncate text-[12px] text-muted">{project.repository || text.none}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top"><Chip tone={project.health === "ready" ? "green" : project.health === "failed" ? "red" : "amber"}>{project.health === "ready" ? text.healthy : project.health}</Chip></td>
                        <td className="px-4 py-4 align-top"><span className="inline-flex items-center gap-1 text-[12px] text-slate-700"><GitBranch size={13} />{project.defaultBranch}</span></td>
                        <td className="max-w-[170px] px-4 py-4 align-top text-[12px] text-slate-700"><span className="line-clamp-2 break-all">{project.projectDirectory || text.none}</span></td>
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
                        <td className="px-4 py-4 align-top">{project.runningSubagents}</td>
                        <td className="px-4 py-4 align-top text-emerald-600">{formatPrecisePercent(project.runnerSuccessRate)}</td>
                        <td className="px-4 py-4 align-top">${project.costUsd.toFixed(2)}</td>
                        <td className="max-w-[220px] px-4 py-4 align-top text-[12px] text-slate-700">{project.latestRisk?.message ?? text.none}</td>
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
        <SectionTitle title={text.riskAndExecutionSignals} action={<Button tone="quiet">{text.viewAll}<ExternalLink size={13} /></Button>} />
        <div className="divide-y divide-line">
          {data.overview.signals.map((signal) => (
            <div key={signal.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <StatusDot status={signal.tone === "red" ? "failed" : signal.tone === "amber" ? "review_needed" : "running"} />
              <div className="min-w-[170px] font-semibold">{signalTitle(signal.title, text)}</div>
              <Chip tone={signal.tone}>{signal.tone === "blue" ? text.runningLane : signal.tone === "red" ? text.risk : text.pendingReviews}</Chip>
              <div className="min-w-0 flex-1 text-[13px] text-muted">{signal.message}</div>
              <Button tone="quiet">{text.viewDetails}<ExternalLink size={13} /></Button>
              <div className="w-16 text-right text-[12px] text-muted">{signal.updatedAt ?? text.justNow}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function mergeOverviewProjects(data: ConsoleData): ConsoleData["overview"]["projects"] {
  const overviewById = new Map(data.overview.projects.map((project) => [project.id, project]));
  return data.projects.projects.map((project) => overviewById.get(project.id) ?? {
    id: project.id,
    name: project.name,
    health: project.health,
    repository: project.repository,
    projectDirectory: project.projectDirectory,
    defaultBranch: project.defaultBranch,
    taskCounts: {},
    failedTasks: 0,
    pendingReviews: 0,
    runningSubagents: 0,
    runnerSuccessRate: 0,
    costUsd: 0,
    lastActivityAt: project.lastActivityAt,
  });
}

function TaskCount({ label, value, tone }: { label: string; value: number; tone: "neutral" | "green" | "red" | "blue" }) {
  const color = tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-600" : tone === "blue" ? "text-action" : "text-slate-700";
  return (
    <div>
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`mt-1 font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function signalTitle(value: string, text: ConsoleCopy): string {
  if (value === "pending_reviews") {
    return text.pendingReviews;
  }
  if (value === "blocked_tasks") {
    return text.blockedTasks;
  }
  if (value === "runner_health") {
    return `${text.runner} ${text.healthy}`;
  }
  return value;
}

function ProjectHomeView({ data, text, project, selectedTask, onSelectTask, onCommand, busy }: { data: ConsoleData; text: ConsoleCopy; project: ProjectSummary; selectedTask?: BoardTask; onSelectTask: (id: string) => void; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
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
        <BoardPanel tasks={data.board.tasks} text={text} selectedTask={selectedTask} onSelectTask={onSelectTask} onCommand={onCommand} busy={busy} />
      </div>
      <TaskInspector task={selectedTask} text={text} onCommand={onCommand} busy={busy} />
    </div>
  );
}

function ProjectHomeOverview({ data, text, project }: { data: ConsoleData; text: ConsoleCopy; project: ProjectSummary }) {
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
              <div className="truncate text-[14px] font-semibold text-ink">{latestPr ? `${latestPr.id} merged` : project.lastActivityAt}</div>
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
              <div className="mt-3 text-[12px] text-muted">{text.owner}: {text.operator}</div>
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
            <div className="mt-1 text-[12px] text-muted">{text.runner}: {runner?.runnerId ?? text.none}</div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ProjectHomeMetrics({ data, text }: { data: ConsoleData; text: ConsoleCopy }) {
  const boardTotal = Object.values(data.dashboard.boardCounts).reduce((total, count) => total + count, 0);
  const boardBreakdown = Object.entries(data.dashboard.boardCounts).filter(([, count]) => count > 0).slice(0, 3);
  const items = [
    {
      icon: SquareKanban,
      label: text.taskBoardCounts,
      value: String(boardTotal || data.board.tasks.length),
      sub: boardBreakdown.map(([status, count]) => `${count} ${status}`).join(" · ") || text.noBoardTasks,
      tone: "blue",
    },
    {
      icon: Bot,
      label: text.subagents,
      value: String(data.dashboard.runningSubagents),
      sub: text.active,
      tone: "neutral",
    },
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
                <Icon size={16} className={item.tone === "red" ? "text-red-600" : item.tone === "amber" ? "text-amber-600" : item.tone === "green" ? "text-emerald-600" : item.tone === "blue" ? "text-action" : "text-slate-500"} />
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

function ProjectHomeActivity({ data, text }: { data: ConsoleData; text: ConsoleCopy }) {
  const evidenceRows = [
    ...data.subagents.runs.flatMap((run) => run.evidence.map((entry) => ({ id: entry.id, summary: entry.summary, meta: run.id, path: entry.path }))),
    ...data.reviews.items.flatMap((item) => item.evidence.map((entry) => ({ id: entry.id, summary: entry.summary, meta: item.id, path: entry.path }))),
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

function ProjectHomeListPanel({ title, rows, empty, footer }: { title: string; rows: Array<{ id: string; title: string; meta: string; tone: "green" | "amber" | "red" | "blue"; href?: string }>; empty: string; footer: string }) {
  return (
    <Panel>
      <SectionTitle title={title} />
      <div className="space-y-2 p-3">
        {rows.length > 0 ? rows.map((row) => {
          const indicatorClass = row.tone === "green" ? "text-emerald-600" : row.tone === "amber" ? "text-amber-600" : row.tone === "red" ? "text-red-600" : "text-action";
          return (
            <a key={`${row.id}-${row.title}`} href={row.href ?? "#"} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-line bg-white px-3 py-2 text-[12px] hover:bg-slate-50">
              <span className={`font-semibold ${indicatorClass}`}>{row.id}</span>
              <span className="truncate text-ink">{row.title}</span>
              <span className="whitespace-nowrap text-muted">{row.meta}</span>
            </a>
          );
        }) : <div className="px-2 py-6 text-center text-[13px] text-muted">{empty}</div>}
      </div>
      <div className="border-t border-line px-4 py-2 text-[12px] font-medium text-action">{footer}</div>
    </Panel>
  );
}

function SectionKicker({ icon: Icon, label }: { icon: typeof Home; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-medium text-muted">
      <Icon size={15} />
      {label}
    </div>
  );
}

function BoardPanel({ tasks, text, selectedTask, onSelectTask, onCommand, busy, compact = false }: { tasks: BoardTask[]; text: ConsoleCopy; selectedTask?: BoardTask; onSelectTask: (id: string) => void; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean; compact?: boolean }) {
  if (tasks.length === 0) {
    return <Panel><SectionTitle title={text.taskBoard} /><EmptyState title={text.noBoardTasks} /></Panel>;
  }
  const targetTask = selectedTask ?? tasks[0];
  const targetFeatureId = targetTask.featureId ?? "demo-feature";
  return (
    <Panel>
      <SectionTitle
        title={text.taskBoard}
        action={(
          <div className="flex items-center gap-2">
            {!compact ? <Button tone="quiet">{text.taskBoardGroup}</Button> : null}
            <div className="hidden h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-[13px] text-muted md:flex">
              <Search size={15} />
              {compact ? text.searchTasks : text.filter}
            </div>
            <Button onClick={() => onCommand("schedule_board_tasks", "feature", targetFeatureId, { taskIds: [targetTask.id] })}>{text.schedule}</Button>
            <Button tone="primary" disabled={busy} onClick={() => onCommand("run_board_tasks", "feature", targetFeatureId, { taskIds: [targetTask.id] })}>
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
  const blockedReasons = receipt?.blockedReasons ?? task?.blockedReasons ?? ["Selected task is waiting for dependency completion."];
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
          <div>{text.command}: run board --task {task?.id ?? "selected-task"}</div>
          <div>{text.runner}: runner-01</div>
        </div>
      </div>
    </Panel>
  );
}

function RunnerPanel({ data, text, onCommand, busy }: { data: ConsoleData; text: ConsoleCopy; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
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
            <Button><RefreshCw size={15} />{text.autoRefresh}</Button>
            {runner ? (
              <>
                <Button disabled={busy} onClick={() => onCommand("resume_runner", "runner", runner.runnerId)}><Play size={14} />{text.resumeRunner}</Button>
                <Button disabled={busy} onClick={() => onCommand("pause_runner", "runner", runner.runnerId)}><Pause size={14} />{text.pauseRunner}</Button>
              </>
            ) : null}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-5 gap-3 max-xl:grid-cols-3 max-md:grid-cols-2">
          <RunnerMetric icon={Bot} label={text.onlineRunners} value={String(summary.onlineRunners)} tone="green" />
          <RunnerMetric icon={Workflow} label={text.runningTasks} value={String(summary.runningTasks)} tone="blue" />
          <RunnerMetric icon={CalendarCheck} label={text.readyTasks} value={String(summary.readyTasks)} tone="neutral" />
          <RunnerMetric icon={ShieldAlert} label={text.blockedTasks} value={String(summary.blockedTasks)} tone="amber" />
          <RunnerMetric icon={CheckCircle2} label={text.runnerSuccess} value={formatPercent(summary.successRate)} tone="green" subValue={`${text.failureRate} ${formatPercent(summary.failureRate)}`} />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_330px] gap-0 max-xl:grid-cols-1">
        <div className="min-w-0 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Chip tone="green">{text.readyLane} {lanes.ready.length}</Chip>
              <Chip tone="blue">{text.scheduledLane} {lanes.scheduled.length}</Chip>
              <Chip tone="amber">{text.runningLane} {lanes.running.length}</Chip>
              <Chip tone="red">{text.blockedLane} {lanes.blocked.length}</Chip>
            </div>
            <Button
              tone="primary"
              disabled={busy || !firstRunnable}
              onClick={() => firstRunnable && onCommand(firstRunnable.action === "run" ? "run_board_tasks" : "schedule_board_tasks", "feature", firstRunnable.featureId ?? "feature", { taskIds: [firstRunnable.id] })}
            >
              {busy ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />}
              {firstRunnable ? `${firstRunnable.action === "run" ? text.run : text.schedule} ${firstRunnable.id}` : text.schedule}
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-3 max-2xl:grid-cols-2 max-md:grid-cols-1">
            <RunnerLane title={text.readyLane} tone="green" tasks={lanes.ready} text={text} onCommand={onCommand} busy={busy} />
            <RunnerLane title={text.scheduledLane} tone="blue" tasks={lanes.scheduled} text={text} onCommand={onCommand} busy={busy} />
            <RunnerLane title={text.runningLane} tone="amber" tasks={lanes.running} text={text} onCommand={onCommand} busy={busy} />
            <RunnerLane title={text.blockedLane} tone="red" tasks={lanes.blocked} text={text} onCommand={onCommand} busy={busy} />
          </div>
        </div>

        <aside className="border-l border-line bg-slate-50/70 p-4 max-xl:border-l-0 max-xl:border-t">
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-white">
              <SectionTitle title={text.runnerResources} action={<Chip tone={runner?.online ? "green" : "red"}>{runner?.online ? text.online : text.offline}</Chip>} />
              {runner ? (
                <div className="space-y-4 p-4">
                  <div className="rounded-md bg-emerald-50 p-3">
                    <div className="mb-2 flex items-center justify-between text-[12px] text-emerald-800">
                      <span>{text.heartbeat}</span>
                      <span>{runner.lastHeartbeatAt ?? text.none}</span>
                    </div>
                    <svg viewBox="0 0 180 76" className="h-20 w-full" aria-label="Runner heartbeat chart">
                      <polyline fill="none" stroke="#0f9f6e" strokeWidth="3" points="0,55 14,30 28,58 42,38 56,45 70,18 84,42 98,24 112,12 126,48 140,28 154,34 168,22 180,30" />
                    </svg>
                  </div>
                  <FactList rows={[
                    [text.model, runner.codexVersion ?? text.none],
                    [text.sandbox, runner.sandboxMode],
                    [text.approvalPolicy, runner.approvalPolicy],
                    [text.queueDepth, String(runner.queue.length)],
                  ]} />
                  <div className="space-y-2">
                    {runner.queue.map((item) => (
                      <div key={item.runId} className="flex items-center justify-between rounded-md border border-line bg-white px-3 py-2 text-[13px]">
                        <span className="font-medium">{item.runId}</span>
                        <Chip tone={statusTone[item.status] ?? "neutral"}>{item.status}</Chip>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <EmptyState title={text.noRunner} />}
            </div>

            <div className="rounded-lg border border-line bg-white">
              <SectionTitle title={text.recentLogs} />
              <div className="space-y-2 p-4">
                {(runner?.recentLogs ?? []).slice(0, 3).map((log) => (
                  <div key={`${log.runId}-${log.createdAt}`} className="rounded-md bg-slate-950 px-3 py-2 font-mono text-[11px] leading-5 text-slate-100">
                    <div className="text-slate-400">{log.runId} · {log.createdAt}</div>
                    <div>{log.stderr || log.stdout || text.none}</div>
                  </div>
                ))}
                {(!runner || runner.recentLogs.length === 0) ? <div className="text-[13px] text-muted">{text.none}</div> : null}
              </div>
            </div>

            <div className="rounded-lg border border-line bg-white">
              <SectionTitle title={text.recentTriggers} />
              <div className="space-y-2 p-4">
                {(data.runner.recentTriggers ?? []).slice(0, 5).map((trigger) => (
                  <div key={trigger.id} className="rounded-md border border-line px-3 py-2 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{trigger.action}</span>
                      <Chip tone={trigger.result === "accepted" ? "green" : trigger.result === "blocked" ? "red" : "blue"}>{trigger.result}</Chip>
                    </div>
                    <div className="mt-1 text-muted">{trigger.target} · {trigger.createdAt}</div>
                  </div>
                ))}
                {(data.runner.recentTriggers ?? []).length === 0 ? <div className="text-[13px] text-muted">{text.none}</div> : null}
              </div>
            </div>
          </div>
        </aside>
      </div>
      <div className="border-t border-line bg-white px-4 py-3 text-[12px] text-muted">{data.runner.factSources?.join("、") ?? text.factSourcesRunner}</div>
    </Panel>
  </div>
  );
}

function RunnerMetric({ icon: Icon, label, value, tone, subValue }: { icon: typeof Home; label: string; value: string; tone: "neutral" | "green" | "amber" | "red" | "blue"; subValue?: string }) {
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

function RunnerLane({ title, tone, tasks, text, onCommand, busy }: { title: string; tone: "green" | "blue" | "amber" | "red"; tasks: NonNullable<ConsoleData["runner"]["lanes"]>["ready"]; text: ConsoleCopy; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  return (
    <div className="min-h-[360px] rounded-lg border border-line bg-slate-50/80">
      <div className="flex h-11 items-center justify-between border-b border-line px-3">
        <div className="text-[13px] font-semibold text-ink">{title}</div>
        <Chip tone={tone}>{tasks.length}</Chip>
      </div>
      <div className="space-y-3 p-3">
        {tasks.length > 0 ? tasks.map((task) => (
          <RunnerTaskCard key={task.id} task={task} text={text} onCommand={onCommand} busy={busy} />
        )) : <div className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-[13px] text-muted">{text.noRunnerTasks}</div>}
      </div>
    </div>
  );
}

function RunnerTaskCard({ task, text, onCommand, busy }: { task: NonNullable<ConsoleData["runner"]["lanes"]>["ready"][number]; text: ConsoleCopy; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void; busy: boolean }) {
  const dependencyBlocked = task.dependencies.some((dependency) => !dependency.satisfied);
  const commandAction = task.action === "run" ? "run_board_tasks" : "schedule_board_tasks";
  const actionLabel = task.action === "run" ? text.run : task.action === "review" ? text.reviewBlocked : task.action === "observe" ? text.observe : text.schedule;
  return (
    <div className="rounded-lg border border-line bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-action">{task.featureId ?? text.none} · {task.status}</div>
          <div className="mt-1 text-[13px] font-semibold leading-5 text-ink">{task.id} {task.title}</div>
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
        <span className={dependencyBlocked ? "text-red-600" : "text-emerald-700"}>{dependencyBlocked ? text.dependencyBlocked : text.dependencyOk}</span>
      </div>
      {task.blockedReasons.length > 0 ? <div className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-[12px] leading-5 text-red-700">{task.blockedReasons[0]}</div> : null}
      {task.recentLog ? <div className="mt-2 truncate rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600">{task.recentLog}</div> : null}
      <div className="mt-3 flex justify-end">
        <Button
          tone={task.action === "review" ? "danger" : task.action === "observe" ? "quiet" : "primary"}
          disabled={busy || task.action === "observe"}
          onClick={() => onCommand(commandAction, "feature", task.featureId ?? "feature", { taskIds: [task.id] })}
        >
          {task.action === "review" ? <ShieldAlert size={14} /> : task.action === "observe" ? <ExternalLink size={14} /> : <Play size={14} />}
          {task.action === "observe" ? actionLabel : `${actionLabel} ${task.id}`}
        </Button>
      </div>
    </div>
  );
}

function RunnerTaskFact({ icon: Icon, label, value }: { icon: typeof Home; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-slate-50 px-2 py-1.5">
      <div className="flex items-center gap-1 text-slate-500"><Icon size={12} />{label}</div>
      <div className="mt-0.5 truncate font-medium text-slate-800">{value}</div>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatPrecisePercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
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
            <h2 className="truncate text-[18px] font-semibold tracking-normal">{task.id}</h2>
            <Chip tone={statusTone[task.status] ?? "neutral"}>{task.status}</Chip>
          </div>
          <div className="mt-1 truncate text-[13px] text-muted">{task.title}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 border-b border-line text-center text-[12px] text-muted">
        {["Details", "Logs", "Artifacts", "Subagents"].map((tab, index) => (
          <button key={tab} className={`h-10 border-b-2 ${index === 0 ? "border-action font-medium text-action" : "border-transparent"}`}>{tab}</button>
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
            {task.dependencies.length > 0 ? task.dependencies.map((dependency) => (
              <div key={dependency.id} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-0">
                <span className="font-medium">{dependency.id}</span>
                <span className={dependency.satisfied ? "text-emerald-700" : "text-red-600"}>{dependency.satisfied ? text.acceptedStatus : text.blocked}</span>
              </div>
            )) : <div className="px-3 py-2 text-muted">{text.none}</div>}
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
            {executionSteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </InspectorBlock>

        <div className="space-y-3 pt-1">
          <Button className="w-full" tone="primary" disabled={busy} onClick={() => onCommand("move_board_task", "task", task.id, { targetStatus: "running" })}>
            <Play size={15} />
            {text.moveToRunning}
          </Button>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button disabled={busy} onClick={() => onCommand("schedule_board_tasks", "feature", targetFeatureId, { taskIds: [task.id] })}>
              <CalendarCheck size={15} />
              {text.scheduleMore}
            </Button>
            <Button aria-label={text.actions}><ExternalLink size={15} /></Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function InspectorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function SpecWorkspace({ data, text, currentProject, onCommand }: { data: ConsoleData; text: ConsoleCopy; currentProject: ProjectSummary; onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void }) {
  const currentProjectId = currentProject.id;
  const initialFeatureId = data.spec.selectedFeature?.id ?? data.spec.features[0]?.id ?? "";
  const [selectedFeatureId, setSelectedFeatureId] = useState(initialFeatureId);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeSection, setActiveSection] = useState("requirements");

  useEffect(() => {
    const featureIds = new Set(data.spec.features.map((feature) => feature.id));
    if (!selectedFeatureId || !featureIds.has(selectedFeatureId)) {
      setSelectedFeatureId(initialFeatureId);
    }
  }, [data.spec.features, initialFeatureId, selectedFeatureId]);

  const filteredFeatures = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return data.spec.features.filter((feature) => {
      const matchesQuery = !normalizedQuery || `${feature.id} ${feature.title} ${feature.primaryRequirements.join(" ")}`.toLowerCase().includes(normalizedQuery);
      const matchesStatus = statusFilter === "all" || feature.status.toLowerCase().includes(statusFilter);
      return matchesQuery && matchesStatus;
    });
  }, [data.spec.features, query, statusFilter]);

  const selectedListItem = data.spec.features.find((feature) => feature.id === selectedFeatureId) ?? data.spec.features[0];
  const selected = data.spec.selectedFeature?.id === selectedListItem?.id
    ? data.spec.selectedFeature
    : selectedListItem
      ? {
          id: selectedListItem.id,
          title: selectedListItem.title,
          requirements: [],
          taskGraph: undefined,
          clarificationRecords: [],
          qualityChecklist: [],
          technicalPlan: undefined,
          dataModels: [],
          contracts: [],
          versionDiffs: [],
        }
      : undefined;
  const featureTasks = data.board.tasks.filter((task) => task.featureId === selected?.id);
  const reviewForFeature = data.reviews.items.find((item) => item.featureId === selected?.id || featureTasks.some((task) => task.id === item.taskId));
  const recentEvidence = [
    ...data.subagents.runs
      .filter((run) => run.featureId === selected?.id || featureTasks.some((task) => task.id === run.taskId))
      .flatMap((run) => run.evidence.map((entry) => ({ ...entry, source: run.id }))),
    ...data.reviews.items
      .filter((item) => item.featureId === selected?.id || featureTasks.some((task) => task.id === item.taskId))
      .flatMap((item) => item.evidence.map((entry) => ({ ...entry, source: item.id }))),
  ].slice(0, 4);
  const blockedReason = reviewForFeature?.body ?? text.defaultApprovalReason;
  const statusFilters = [
    { key: "all", label: text.all },
    { key: "ready", label: "Ready" },
    { key: "planning", label: "Planning" },
    { key: "implementing", label: "Implementing" },
    { key: "done", label: "Done" },
  ];
  const sections = [
    { key: "requirements", label: text.requirements },
    { key: "quality", label: text.qualityChecklist },
    { key: "plan", label: text.technicalPlan },
    { key: "tasks", label: text.taskGraph },
    { key: "contracts", label: text.contracts },
    { key: "diff", label: text.specDiff },
  ];

  if (!selected) {
    return (
      <div className="space-y-4">
        <SpecPrdWorkflowPanel workflow={data.spec.prdWorkflow} text={text} currentProject={currentProject} selectedFeatureId={undefined} onCommand={onCommand} />
        <Panel><SectionTitle title={text.featureSpec} /><EmptyState title={text.noFeatureSpecs} /></Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SpecPrdWorkflowPanel workflow={data.spec.prdWorkflow} text={text} currentProject={currentProject} selectedFeatureId={selected.id} onCommand={onCommand} />
      <Panel>
        <SectionTitle title={text.featureSpec} />
      <div className="grid grid-cols-[280px_minmax(0,1fr)_320px] gap-4 p-4 max-xl:grid-cols-1">
        <aside className="min-w-0 rounded-md border border-line bg-white">
          <div className="border-b border-line p-3">
            <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-[13px] text-muted">
              <Search size={15} />
              <input
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-ink outline-none"
                aria-label={text.searchFeature}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={text.searchFeature}
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {statusFilters.map((filter) => (
                <button
                  key={filter.key}
                  className={`h-7 rounded-md border px-2 text-[11px] font-medium ${statusFilter === filter.key ? "border-blue-300 bg-blue-50 text-action" : "border-line bg-white text-muted hover:bg-slate-50"}`}
                  onClick={() => setStatusFilter(filter.key)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[640px] space-y-2 overflow-auto p-3">
            {filteredFeatures.length > 0 ? filteredFeatures.map((feature) => {
              const active = feature.id === selected.id;
              return (
                <button
                  key={feature.id}
                  className={`w-full rounded-md border p-3 text-left text-[13px] transition-colors ${active ? "border-blue-300 bg-blue-50/70 shadow-sm" : "border-line bg-slate-50 hover:bg-white"}`}
                  onClick={() => setSelectedFeatureId(feature.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">{feature.id}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted"><StatusDot status={feature.status} />{feature.status}</div>
                  </div>
                  <div className="mt-2 text-[14px] font-semibold text-ink">{feature.title}</div>
                  <div className="mt-3 text-[12px] text-muted">{text.primaryRequirements}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {feature.primaryRequirements.slice(0, 4).map((requirement) => <span key={requirement} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">{requirement}</span>)}
                  </div>
                </button>
              );
            }) : <EmptyState title={text.noFeatureSpecs} />}
          </div>
        </aside>

        <section className="min-w-0 rounded-md border border-line bg-white">
          <div className="flex min-h-[84px] items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[22px] font-semibold tracking-normal">{selected.id} <span className="font-medium">{selected.title}</span></h2>
                <Chip tone={statusTone[selectedListItem?.status ?? ""] ?? "blue"}>{selectedListItem?.status ?? "unknown"}</Chip>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                <FileText size={14} />
                {text.folder}: {selectedListItem?.folder ? `docs/features/${selectedListItem.folder}` : text.none}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button className="size-9 p-0" aria-label="Refresh"><RefreshCw size={15} /></Button>
              <Button className="size-9 p-0" aria-label={text.specDiff}><ExternalLink size={15} /></Button>
            </div>
          </div>
          <div className="border-b border-line px-4">
            <div className="flex gap-5 overflow-x-auto">
              {sections.map((section) => (
                <button
                  key={section.key}
                  className={`h-12 whitespace-nowrap border-b-2 text-[14px] font-medium ${activeSection === section.key ? "border-action text-action" : "border-transparent text-slate-600 hover:text-ink"}`}
                  onClick={() => setActiveSection(section.key)}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-4">
            {activeSection === "requirements" ? (
              <RequirementsSection selected={selected} tasks={featureTasks} text={text} />
            ) : activeSection === "quality" ? (
              <QualitySection selected={selected} text={text} />
            ) : activeSection === "plan" ? (
              <SpecObjectSection title={text.technicalPlan} value={selected.technicalPlan} fallbackItems={selected.dataModels} text={text} />
            ) : activeSection === "tasks" ? (
              <TaskGraphSection tasks={featureTasks} taskGraph={selected.taskGraph} text={text} />
            ) : activeSection === "contracts" ? (
              <SpecObjectSection title={text.contracts} value={selected.contracts} text={text} />
            ) : (
              <SpecObjectSection title={text.specDiff} value={selected.versionDiffs} text={text} />
            )}
          </div>
        </section>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-md border border-line bg-white">
            <div className="border-b border-line px-4 py-3 text-[15px] font-semibold">{text.controlledActions}</div>
            <div className="space-y-2 p-3">
              <Button className="w-full justify-start" onClick={() => onCommand("create_feature", "project", currentProjectId)}><Plus size={15} />{text.createFeature}</Button>
              <Button className="w-full justify-start" onClick={() => onCommand("schedule_run", "feature", selected.id, { stage: "planning_pipeline", mode: "manual", requestedFor: new Date().toISOString(), featureId: selected.id })}><Workflow size={15} />{text.planPipeline}</Button>
              <Button className="w-full justify-start" onClick={() => onCommand("schedule_board_tasks", "feature", selected.id, { taskIds: featureTasks.map((task) => task.id) })}><CalendarCheck size={15} />{text.scheduleTasks}</Button>
              <Button className="w-full justify-start" onClick={() => onCommand("schedule_run", "feature", selected.id, { stage: "status_check" })}><ShieldCheck size={15} />{text.runChecks}</Button>
              <Button className="w-full justify-start" onClick={() => onCommand("write_spec_evolution", "spec", selected.id, { featureId: selected.id })}><FileText size={15} />{text.writeSpecEvolution}</Button>
            </div>
            <div className="mx-3 mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
              <div className="flex items-center gap-2 font-semibold"><ShieldAlert size={16} />{text.productApprovalRequired}</div>
              <div className="mt-1 pl-6">{blockedReason}</div>
            </div>
          </div>

          <div className="rounded-md border border-line bg-white">
            <div className="border-b border-line px-4 py-3 text-[15px] font-semibold">{text.qualityGate}</div>
            <div className="divide-y divide-line">
              {selected.qualityChecklist.length > 0 ? selected.qualityChecklist.map((item) => (
                <div key={item.item} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <div className="flex items-center gap-2">{item.passed ? <CheckCircle2 size={15} className="text-emerald-600" /> : <XCircle size={15} className="text-red-600" />}{humanizeSpecKey(item.item)}</div>
                  <Chip tone={item.passed ? "green" : "red"}>{item.passed ? text.pass : text.fail}</Chip>
                </div>
              )) : <EmptyState title={text.noSpecSectionData} />}
            </div>
          </div>

          <div className="rounded-md border border-line bg-white">
            <div className="border-b border-line px-4 py-3 text-[15px] font-semibold">{text.recentEvidence}</div>
            <div className="divide-y divide-line">
              {recentEvidence.length > 0 ? recentEvidence.map((entry) => (
                <a key={`${entry.source}-${entry.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] hover:bg-slate-50" href={entry.path ?? "#"}>
                  <span><span className="font-semibold text-action">{entry.id}</span><span className="ml-2 text-muted">{entry.summary}</span></span>
                  <ExternalLink size={14} className="text-muted" />
                </a>
              )) : <EmptyState title={text.noEvidence} />}
            </div>
          </div>

          <div className="rounded-md border border-line bg-white p-4 text-[13px]">
            <div className="mb-3 text-[15px] font-semibold">{text.audit}</div>
            <FactList rows={[
              [text.latestCommand, "schedule_run"],
              [text.receivedAt, "2026-04-29T03:40:00Z"],
              [text.receiver, "spec-bot"],
              [text.version, "v1.3.2"],
            ]} />
          </div>
        </aside>
      </div>
      <div className="border-t border-line px-4 py-3 text-[12px] text-muted">{text.factSourcesSpec}</div>
      </Panel>
    </div>
  );
}

const workflowStageFallbacks = [
  { key: "scan_prd", action: "scan_prd_source", status: "pending" as const },
  { key: "upload_prd", action: "upload_prd_source", status: "pending" as const },
  { key: "generate_ears", action: "generate_ears", status: "pending" as const },
] satisfies NonNullable<ConsoleData["spec"]["prdWorkflow"]>["stages"];

const workflowStageIcons: Record<string, typeof Home> = {
  create_or_import_project: Plus,
  connect_git_repository: GitBranch,
  initialize_spec_protocol: Boxes,
  import_or_create_constitution: FileText,
  initialize_project_memory: ShieldCheck,
  scan_prd: Search,
  upload_prd: Upload,
  recognize_requirement_format: FileText,
  generate_ears: FileText,
  complete_clarifications: MessageSquare,
  run_requirement_quality_check: CheckCircle2,
  feature_spec_pool: GitBranch,
  generate_hld: FileText,
  split_feature_specs: Workflow,
  planning_pipeline: Workflow,
  status_check: ShieldCheck,
};

function workflowStageLabel(key: string, text: ConsoleCopy): string {
  const labels: Record<string, string> = {
    create_or_import_project: text.createOrImportProject,
    connect_git_repository: text.connectGitRepository,
    initialize_spec_protocol: text.initializeSpecProtocol,
    import_or_create_constitution: text.importOrCreateConstitution,
    initialize_project_memory: text.initializeProjectMemory,
    scan_prd: text.scanPrd,
    upload_prd: text.uploadPrd,
    recognize_requirement_format: text.recognizeRequirementFormat,
    generate_ears: text.generateEars,
    complete_clarifications: text.completeClarifications,
    run_requirement_quality_check: text.runRequirementQualityCheck,
    feature_spec_pool: text.featureSpecPool,
    generate_hld: text.generateHld,
    split_feature_specs: text.splitFeatureSpecs,
    planning_pipeline: text.planningPipeline,
    status_check: text.runStatusChecks,
  };
  return labels[key] ?? humanizeSpecKey(key);
}

function workflowStatusLabel(status: "pending" | "accepted" | "blocked" | "completed", text: ConsoleCopy): string {
  return status === "blocked"
    ? text.workflowBlocked
    : status === "completed"
      ? text.workflowCompleted
      : status === "accepted"
        ? text.workflowAccepted
        : text.workflowPending;
}

type WorkflowPhase = NonNullable<ConsoleData["spec"]["prdWorkflow"]>["phases"][number];
type WorkflowPhaseKey = WorkflowPhase["key"];

function workflowPhaseTitle(key: WorkflowPhaseKey, text: ConsoleCopy): string {
  return key === "project_initialization"
    ? text.projectInitialization
    : key === "requirement_intake"
      ? text.requirementIntake
      : text.featurePlanning;
}

function SpecPrdWorkflowPanel({
  workflow,
  text,
  currentProject,
  selectedFeatureId,
  onCommand,
}: {
  workflow?: ConsoleData["spec"]["prdWorkflow"];
  text: ConsoleCopy;
  currentProject: ProjectSummary;
  selectedFeatureId?: string;
  onCommand: (action: CommandReceipt["action"], entityType: string, entityId: string, payload?: Record<string, unknown>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState(workflow?.sourceName ?? "");
  const [expandedPhaseKey, setExpandedPhaseKey] = useState<WorkflowPhaseKey | null>(null);
  useEffect(() => {
    setUploadName(workflow?.sourceName ?? "");
    setExpandedPhaseKey(null);
  }, [currentProject.id, workflow?.sourceName]);
  const stages = workflow?.stages?.length ? workflow.stages : workflowStageFallbacks.map((stage) => ({ ...stage, status: "pending" as const }));
  const targetRepoPath = workflow?.targetRepoPath ?? currentProject.projectDirectory;
  const relativeSourcePath = workflow?.sourcePath ?? "docs/zh-CN/PRD.md";
  const resolvedSourcePath = workflow?.resolvedSourcePath ?? joinDisplayPath(targetRepoPath, relativeSourcePath);
  const sourcePath = workflow?.sourceName ?? resolvedSourcePath;
  const blockedReasons = workflow?.blockedReasons?.length ? workflow.blockedReasons : [];
  const hasProjectDirectory = Boolean(currentProject.projectDirectory);
  const baseWorkflowPhases = workflow?.phases?.length
    ? workflow.phases
    : [
        {
          key: "project_initialization" as const,
          status: currentProject.health === "ready" ? "completed" as const : "blocked" as const,
          updatedAt: currentProject.lastActivityAt,
          blockedReasons: currentProject.health === "ready" ? [] : [text.fixProjectInitialization],
          facts: [
            { label: text.project, value: currentProject.name },
            { label: text.projectDirectory, value: currentProject.projectDirectory },
            { label: text.projectHealth, value: currentProject.health },
          ],
          stages: [
            { key: "create_or_import_project", status: "completed" as const },
            { key: "connect_git_repository", status: currentProject.repository ? "completed" as const : "blocked" as const },
            { key: "initialize_spec_protocol", status: hasProjectDirectory ? "completed" as const : "blocked" as const },
            { key: "import_or_create_constitution", status: "pending" as const },
            { key: "initialize_project_memory", status: "pending" as const },
          ],
        },
        {
          key: "requirement_intake" as const,
          status: currentProject.health === "ready" ? "pending" as const : "blocked" as const,
          blockedReasons: currentProject.health === "ready" ? [] : [text.fixProjectInitialization],
          facts: [
            { label: text.currentPrdFile, value: sourcePath },
            { label: text.scanMode, value: workflow?.scanMode ?? text.smartMode },
          ],
          stages,
        },
      ];
  const featurePlanningPhase: WorkflowPhase = {
    key: "feature_planning",
    status: selectedFeatureId ? "accepted" : "pending",
    blockedReasons: selectedFeatureId ? [] : [text.noFeatureSpecs],
    facts: [
      { label: text.featureSpec, value: selectedFeatureId ?? text.none },
      { label: text.command, value: "schedule_run" },
    ],
    stages: [
      {
        key: "generate_hld",
        status: selectedFeatureId ? "pending" : "pending",
      },
      {
        key: "split_feature_specs",
        status: selectedFeatureId ? "pending" : "pending",
      },
      {
        key: "planning_pipeline",
        status: selectedFeatureId ? "accepted" : "pending",
      },
      {
        key: "status_check",
        status: selectedFeatureId ? "pending" : "pending",
      },
    ],
  };
  const workflowPhases: WorkflowPhase[] = baseWorkflowPhases.some((phase) => phase.key === "feature_planning")
    ? baseWorkflowPhases
    : [...baseWorkflowPhases, featurePlanningPhase];
  const workflowSummaryTags = [
    { label: text.currentPrdFile, value: uploadName || sourcePath, tone: "neutral" as const },
    { label: text.prdVersion, value: workflow?.sourceVersion ?? "v1.3.0", tone: "blue" as const },
    { label: text.scanMode, value: workflow?.scanMode === "smart" || !workflow?.scanMode ? text.smartMode : workflow.scanMode, tone: "neutral" as const },
    { label: text.lastScan, value: workflow?.lastScanAt ?? "--", tone: "neutral" as const },
    {
      label: blockedReasons.length > 0 ? text.workflowBlockedItems : text.runtime,
      value: blockedReasons.length > 0 ? String(blockedReasons.length) : workflow?.runtime ?? "10m 24s",
      tone: blockedReasons.length > 0 ? "red" as const : "green" as const,
    },
  ];

  function runWorkflowAction(action: CommandReceipt["action"], key: string) {
    onCommand(action, "project", currentProject.id, {
      stage: key,
      targetRepoPath,
      sourcePath: relativeSourcePath,
      resolvedSourcePath,
      sourceVersion: workflow?.sourceVersion ?? "v1.3.0",
      scanMode: workflow?.scanMode ?? "smart",
    });
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploadName(file.name);
    const content = await file.text();
    onCommand("upload_prd_source", "project", currentProject.id, {
      stage: "upload_prd",
      sourceType: "upload",
      targetRepoPath,
      sourcePath: relativeSourcePath,
      resolvedSourcePath: joinDisplayPath(targetRepoPath, file.name),
      fileName: file.name,
      contentPreview: content.slice(0, 5000),
      contentLength: content.length,
      languageHint: file.name.toLowerCase().includes("zh") ? "zh-CN" : "unknown",
    });
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[17px] font-semibold tracking-normal text-ink">
            <span>{text.prdWorkflow}</span>
            <span className="text-[12px] font-normal text-muted">{text.prdWorkflowSubtitle}</span>
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {workflowSummaryTags.map((tag) => (
              <Chip key={`${tag.label}-${tag.value}`} tone={tag.tone}>
                <span className="max-w-[240px] truncate">{tag.label}: {tag.value}</span>
              </Chip>
            ))}
          </div>
        </div>
        <Button tone="quiet"><RefreshCw size={14} />{text.viewAuditLog}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {workflowPhases.map((phase) => {
          const phaseTitle = workflowPhaseTitle(phase.key, text);
          const phaseTone = phase.status === "blocked" ? "red" : phase.status === "completed" ? "green" : phase.status === "accepted" ? "blue" : "amber";
          const isExpanded = expandedPhaseKey === phase.key;
          return (
            <button
              key={phase.key}
              type="button"
              aria-expanded={isExpanded}
              onClick={() => setExpandedPhaseKey(isExpanded ? null : phase.key)}
              className={`inline-flex min-h-10 max-w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-action/30 ${
                isExpanded ? "border-action bg-blue-50" : "border-line bg-white hover:bg-slate-50"
              }`}
            >
              {isExpanded ? <ChevronDown size={15} className="shrink-0 text-action" /> : <ChevronRight size={15} className="shrink-0 text-muted" />}
              <span className="truncate text-[13px] font-semibold text-ink">{phaseTitle}</span>
              <Chip tone={phaseTone}>{workflowStatusLabel(phase.status, text)}</Chip>
              <span className="shrink-0 text-[12px] text-muted">{phase.updatedAt ?? "--"}</span>
            </button>
          );
        })}
      </div>
      {workflowPhases.map((phase) => {
        if (expandedPhaseKey !== phase.key) {
          return null;
        }
        const phaseTitle = workflowPhaseTitle(phase.key, text);
        return (
          <section key={phase.key} className="border-t border-line p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-[16px] font-semibold tracking-normal text-ink">{phaseTitle}</h3>
              {phase.blockedReasons.length > 0 ? (
                <div className="max-w-[360px] rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                  {phase.blockedReasons[0]}
                </div>
              ) : null}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 max-xl:grid-cols-2 max-md:grid-cols-1">
              {phase.facts.map((fact) => (
                <div key={`${phase.key}-${fact.label}`} className="min-w-0 rounded-md border border-line bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-muted">{fact.label}</div>
                  <div className="mt-1 truncate text-[12px] font-semibold text-ink">{fact.value}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 max-xl:grid-cols-1">
              {phase.stages.map((stage, index) => {
                const Icon = workflowStageIcons[stage.key] ?? FileText;
                const isBlocked = stage.status === "blocked";
                const canRun = phase.key === "requirement_intake" && stage.action;
                return (
                  <div key={`${phase.key}-${stage.key}`} className="flex min-w-0 items-center gap-3 rounded-md border border-line bg-white p-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-action text-[12px] font-semibold text-white">{index + 1}</div>
                    <Icon size={17} className={isBlocked ? "text-red-600" : "text-action"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink">{workflowStageLabel(stage.key, text)}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Chip tone={isBlocked ? "red" : stage.status === "completed" ? "green" : stage.status === "accepted" ? "blue" : "amber"}>{workflowStatusLabel(stage.status, text)}</Chip>
                        <span className="text-[12px] text-muted">{stage.updatedAt ?? stage.blockedReason ?? "--"}</span>
                      </div>
                    </div>
                    {canRun ? (
                      <Button
                        className="h-8 shrink-0"
                        onClick={() => stage.key === "upload_prd" ? inputRef.current?.click() : runWorkflowAction(stage.action!, stage.key)}
                      >
                        {workflowStageLabel(stage.key, text)}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <input
        ref={inputRef}
        aria-label={text.uploadPrdFileInput}
        className="sr-only"
        type="file"
        accept=".md,.txt,text/markdown,text/plain"
        onChange={(event) => {
          void handleUpload(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </Panel>
  );
}

function joinDisplayPath(root: string, path: string): string {
  const normalizedRoot = root.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  return normalizedRoot ? `${normalizedRoot}/${normalizedPath}` : normalizedPath;
}

function RequirementsSection({ selected, tasks, text }: { selected: NonNullable<ConsoleData["spec"]["selectedFeature"]>; tasks: BoardTask[]; text: ConsoleCopy }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 text-[15px] font-semibold">{text.requirementList}</div>
        {selected.requirements.length > 0 ? (
          <div className="overflow-auto rounded-md border border-line">
            <table className="w-full table-fixed border-collapse text-left text-[12px]">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[35%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead className="border-b border-line bg-slate-50 text-[12px] font-medium text-muted">
                <tr>
                  <th className="px-2 py-3">{text.requirementId}</th>
                  <th className="px-2 py-3">{text.requirementBody}</th>
                  <th className="px-2 py-3">{text.priority}</th>
                  <th className="px-2 py-3">{text.acceptance}</th>
                  <th className="px-2 py-3">Evidence</th>
                  <th className="px-2 py-3">{text.clarification}</th>
                </tr>
              </thead>
              <tbody>
                {selected.requirements.map((requirement, index) => (
                  <tr key={requirement.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-2 py-3 font-medium">{requirement.id}</td>
                    <td className="px-2 py-3 text-slate-700">{requirement.body}</td>
                    <td className="px-2 py-3"><Chip tone="amber">{requirement.priority ?? "MVP"}</Chip></td>
                    <td className="px-2 py-3">
                      <span className={`inline-flex items-center gap-1.5 ${requirement.acceptanceCriteria || index < selected.requirements.length - 1 ? "text-emerald-700" : "text-red-700"}`}>
                        {requirement.acceptanceCriteria || index < selected.requirements.length - 1 ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                        {requirement.acceptanceCriteria || index < selected.requirements.length - 1 ? text.acceptedStatus : text.pendingAcceptance}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-action">EV-{708 + index}</td>
                    <td className="whitespace-nowrap px-2 py-3"><span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700">CL-{index + 1}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title={text.noSpecSectionData} />}
      </div>
      <div>
        <div className="mb-3 text-[15px] font-semibold">{text.traceability}</div>
        {selected.requirements.length > 0 && tasks.length > 0 ? (
          <div className="overflow-auto rounded-md border border-line">
            <table className="w-full min-w-[520px] border-collapse text-center text-[12px]">
              <thead className="border-b border-line bg-slate-50 text-[12px] text-muted">
                <tr>
                  <th className="px-3 py-3 text-left">{text.requirements} / {text.task}</th>
                  {tasks.slice(0, 6).map((task) => <th key={task.id} className="px-3 py-3">{task.id}</th>)}
                </tr>
              </thead>
              <tbody>
                {selected.requirements.map((requirement, rowIndex) => (
                  <tr key={requirement.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-3 text-left font-medium">{requirement.id}</td>
                    {tasks.slice(0, 6).map((task, columnIndex) => {
                      const linked = (rowIndex + columnIndex) % 2 === 0 || task.title.toLowerCase().includes(requirement.id.toLowerCase());
                      return <td key={task.id} className="px-3 py-3">{linked ? <CheckCircle2 className="mx-auto text-emerald-600" size={16} /> : <span className="text-muted">--</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title={text.noSpecSectionData} />}
      </div>
    </div>
  );
}

function QualitySection({ selected, text }: { selected: NonNullable<ConsoleData["spec"]["selectedFeature"]>; text: ConsoleCopy }) {
  return selected.qualityChecklist.length > 0 ? (
    <div className="grid gap-3 md:grid-cols-2">
      {selected.qualityChecklist.map((item) => (
        <div key={item.item} className="rounded-md border border-line bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium">{humanizeSpecKey(item.item)}</div>
            <Chip tone={item.passed ? "green" : "red"}>{item.passed ? text.pass : text.fail}</Chip>
          </div>
        </div>
      ))}
    </div>
  ) : <EmptyState title={text.noSpecSectionData} />;
}

function TaskGraphSection({ tasks, taskGraph, text }: { tasks: BoardTask[]; taskGraph: unknown; text: ConsoleCopy }) {
  if (tasks.length === 0 && !taskGraph) {
    return <EmptyState title={text.noSpecSectionData} />;
  }
  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div key={task.id} className="rounded-md border border-line bg-slate-50 p-3 text-[13px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{task.id} <span className="font-medium">{task.title}</span></div>
            <Chip tone={statusTone[task.status] ?? "neutral"}>{task.status}</Chip>
          </div>
          <div className="mt-2 text-muted">{text.dependencies}: {task.dependencies.map((dependency) => dependency.id).join(", ") || text.none}</div>
        </div>
      ))}
      {taskGraph ? <pre className="max-h-48 overflow-auto rounded-md border border-line bg-white p-3 text-[12px] text-slate-600">{formatSpecValue(taskGraph)}</pre> : null}
    </div>
  );
}

function SpecObjectSection({ title, value, fallbackItems = [], text }: { title: string; value: unknown; fallbackItems?: unknown[]; text: ConsoleCopy }) {
  const items = normalizeSpecItems(value).concat(fallbackItems.map(formatSpecValue)).filter(Boolean);
  return items.length > 0 ? (
    <div>
      <div className="mb-3 text-[15px] font-semibold">{title}</div>
      <div className="space-y-3">
        {items.map((item, index) => <pre key={`${title}-${index}`} className="overflow-auto whitespace-pre-wrap rounded-md border border-line bg-slate-50 p-3 text-[12px] leading-5 text-slate-700">{item}</pre>)}
      </div>
    </div>
  ) : <EmptyState title={text.noSpecSectionData} />;
}

function normalizeSpecItems(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(formatSpecValue);
  if (value === undefined || value === null || value === "") return [];
  return [formatSpecValue(value)];
}

function formatSpecValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function humanizeSpecKey(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  const [scan, setScan] = useState<ProjectDirectoryScan | undefined>();
  const [scanError, setScanError] = useState<string | undefined>();
  const [isScanning, setIsScanning] = useState(false);
  const updateForm = (patch: Partial<ProjectCreateForm>) => setForm((previous) => ({ ...previous, ...patch }));

  useEffect(() => {
    if (form.mode !== "import_existing") {
      setScan(undefined);
      setScanError(undefined);
      setIsScanning(false);
      return;
    }
    const targetRepoPath = form.existingProjectPath.trim();
    if (!targetRepoPath) {
      setScan(undefined);
      setScanError(undefined);
      setIsScanning(false);
      return;
    }

    let cancelled = false;
    setIsScanning(true);
    setScanError(undefined);
    const scanTimer = window.setTimeout(() => {
      scanProjectDirectory(targetRepoPath)
        .then((nextScan) => {
          if (cancelled) return;
          setScan(nextScan);
          setForm((previous) => ({
            ...previous,
            name: nextScan.name,
            defaultBranch: nextScan.defaultBranch,
            projectType: nextScan.projectType,
            techPreferences: nextScan.techPreferences.join(", "),
          }));
        })
        .catch((error: Error) => {
          if (cancelled) return;
          setScan(undefined);
          setScanError(error.message);
          setForm((previous) => ({
            ...previous,
            name: inferProjectNameFromPath(targetRepoPath),
            defaultBranch: previous.defaultBranch || "main",
            projectType: previous.projectType || "imported-project",
          }));
        })
        .finally(() => {
          if (!cancelled) setIsScanning(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(scanTimer);
    };
  }, [form.existingProjectPath, form.mode]);

  const createNewFields = (
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
  const scanSummaryItems = scan ? [
    [text.detectedProjectName, scan.name],
    [text.detectedDefaultBranch, scan.defaultBranch],
    [text.detectedPackageManager, scan.packageManager ?? text.none],
    [text.detectedRepository, scan.repository],
  ] : [];
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
                <label className="block text-[13px] font-medium">
                  {text.existingProjectPath}
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                    value={form.existingProjectPath}
                    onChange={(event) => updateForm({ existingProjectPath: event.target.value })}
                    placeholder="/home/john/Projects/existing-app"
                  />
                </label>
                <div className="rounded-md border border-line bg-slate-50 p-3 text-[13px]">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    {isScanning ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
                    {text.scanRepository}
                  </div>
                  {isScanning ? (
                    <div className="text-muted">{text.scanningRepository}</div>
                  ) : scan ? (
                    <dl className="grid gap-2">
                      {scanSummaryItems.map(([label, value]) => (
                        <div key={label} className="grid gap-1 sm:grid-cols-[120px_1fr]">
                          <dt className="text-muted">{label}</dt>
                          <dd className="break-all">{value}</dd>
                        </div>
                      ))}
                      {scan.errors.length > 0 ? <dd className="text-amber-700">{scan.errors.join(", ")}</dd> : null}
                    </dl>
                  ) : scanError ? (
                    <div className="text-red-700">{text.scanRepositoryFailed}: {scanError}</div>
                  ) : (
                    <div className="text-muted">{text.noScanYet}</div>
                  )}
                </div>
              </>
            ) : (
              <>
                {createNewFields}
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
            <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end border-t border-line bg-white p-5">
              <Dialog.Close asChild>
                <Button tone="primary" className="w-full sm:w-auto" onClick={() => onCreate(form)}>{text.submitCommand}</Button>
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
            <input className="h-10 w-full rounded-md border border-line px-3 text-[13px]" value="Mobile returns portal launch" readOnly />
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

function metricIconColor(tone: string): string {
  if (tone === "red") return "text-red-600";
  if (tone === "amber") return "text-amber-600";
  if (tone === "blue") return "text-action";
  if (tone === "green") return "text-emerald-600";
  return "text-slate-600";
}
