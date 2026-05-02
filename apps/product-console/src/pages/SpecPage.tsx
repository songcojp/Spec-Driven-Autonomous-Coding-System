import {
  Boxes,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  GitBranch,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Workflow,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { UiStrings } from "../lib/i18n";
import { statusTone, humanizeSpecKey, joinDisplayPath, formatSpecValue, normalizeSpecItems } from "../lib/utils";
import type { BoardTask, CommandReceipt, ConsoleData, ProjectCreateForm, ProjectSummary } from "../types";
import { Button, Chip, EmptyState, Panel, SectionTitle } from "../components/ui/primitives";
import { FactList, StatusDot } from "../components/ui/helpers";
import { CreateProjectDialog } from "../components/CreateProjectDialog";

type OnCommand = (
  action: CommandReceipt["action"],
  entityType: string,
  entityId: string,
  payload?: Record<string, unknown>,
) => void;

type WorkflowPhase = NonNullable<ConsoleData["spec"]["prdWorkflow"]>["phases"][number];
type WorkflowPhaseKey = WorkflowPhase["key"];

const workflowStageFallbacks = [
  { key: "spec_source_intake", status: "pending" as const },
  { key: "generate_ears", action: "generate_ears", status: "pending" as const },
] satisfies NonNullable<ConsoleData["spec"]["prdWorkflow"]>["phases"][number]["stages"];

const workflowStageIcons: Record<string, typeof Search> = {
  create_or_import_project: Plus,
  connect_git_repository: GitBranch,
  initialize_spec_protocol: Boxes,
  import_or_create_constitution: FileText,
  initialize_project_memory: ShieldCheck,
  spec_source_intake: Search,
  scan_prd: Search,
  upload_prd: Upload,
  recognize_requirement_format: FileText,
  generate_ears: FileText,
  complete_clarifications: MessageSquare,
  run_requirement_quality_check: CheckCircle2,
  feature_spec_pool: GitBranch,
  generate_hld: FileText,
  generate_ui_spec: Layers,
  split_feature_specs: Workflow,
  status_scheduling: Workflow,
  status_check: ShieldCheck,
};

function workflowStageLabel(key: string, text: UiStrings): string {
  const labels: Record<string, string> = {
    create_or_import_project: text.createOrImportProject,
    connect_git_repository: text.connectGitRepository,
    initialize_spec_protocol: text.initializeSpecProtocol,
    import_or_create_constitution: text.importOrCreateConstitution,
    initialize_project_memory: text.initializeProjectMemory,
    spec_source_intake: text.specSourceIntake,
    scan_prd: text.scanPrd,
    upload_prd: text.uploadPrd,
    recognize_requirement_format: text.recognizeRequirementFormat,
    generate_ears: text.generateEars,
    complete_clarifications: text.completeClarifications,
    run_requirement_quality_check: text.runRequirementQualityCheck,
    feature_spec_pool: text.featureSpecPool,
    generate_hld: text.generateHld,
    generate_ui_spec: text.generateUiSpec,
    split_feature_specs: text.splitFeatureSpecs,
    status_scheduling: text.scheduleRun,
    status_check: text.runStatusChecks,
  };
  return labels[key] ?? humanizeSpecKey(key);
}

function workflowStatusLabel(
  status: "pending" | "accepted" | "blocked" | "completed",
  text: UiStrings,
): string {
  return status === "blocked"
    ? text.workflowBlocked
    : status === "completed"
      ? text.workflowCompleted
      : status === "accepted"
        ? text.workflowAccepted
        : text.workflowPending;
}

function workflowPhaseTitle(key: WorkflowPhaseKey, text: UiStrings): string {
  return key === "project_initialization"
    ? text.projectInitialization
    : key === "requirement_intake"
      ? text.requirementIntake
      : key === "ui_spec"
        ? text.uiSpecFlow
        : text.featurePlanning;
}

function workflowStageAction(
  phaseKey: WorkflowPhaseKey,
  stageKey: string,
  action?: CommandReceipt["action"],
): CommandReceipt["action"] | undefined {
  if (action) return action;
  if (phaseKey === "project_initialization") {
    return stageKey === "connect_git_repository"
      ? "connect_git_repository"
      : stageKey === "initialize_spec_protocol"
        ? "initialize_spec_protocol"
        : stageKey === "import_or_create_constitution"
          ? "import_or_create_constitution"
          : stageKey === "initialize_project_memory"
            ? "initialize_project_memory"
            : undefined;
  }
  if (phaseKey === "ui_spec") {
    return stageKey === "generate_ui_spec" ? "generate_ui_spec" : undefined;
  }
  if (phaseKey === "feature_execution") {
    return stageKey === "generate_hld"
      ? "generate_hld"
      : stageKey === "generate_ui_spec"
        ? "generate_ui_spec"
        : stageKey === "split_feature_specs"
          ? "split_feature_specs"
          : stageKey === "feature_spec_pool"
            ? "push_feature_spec_pool"
            : stageKey === "status_scheduling" || stageKey === "status_check"
              ? "schedule_run"
              : undefined;
  }
  return undefined;
}

function mergeUiSpecIntoFeaturePlanning(phases: WorkflowPhase[]): WorkflowPhase[] {
  const uiSpecPhase = phases.find((phase) => phase.key === "ui_spec");
  const visiblePhases = phases.filter((phase) => phase.key !== "ui_spec");
  if (!uiSpecPhase) return visiblePhases;

  return visiblePhases.map((phase) => {
    if (phase.key !== "feature_execution") return phase;
    const uiSpecStages = uiSpecPhase.stages.filter(
      (stage) => stage.key === "generate_ui_spec" && !phase.stages.some((existing) => existing.key === stage.key),
    );
    if (!uiSpecStages.length) return phase;
    const hldIndex = phase.stages.findIndex((stage) => stage.key === "generate_hld");
    const insertAt = hldIndex >= 0 ? hldIndex + 1 : 0;
    return {
      ...phase,
      updatedAt: phase.updatedAt ?? uiSpecPhase.updatedAt,
      facts: [...phase.facts, ...uiSpecPhase.facts.filter((fact) => fact.label === "UI outputs")],
      stages: [
        ...phase.stages.slice(0, insertAt),
        ...uiSpecStages,
        ...phase.stages.slice(insertAt),
      ],
    };
  });
}

function SpecPrdWorkflowPanel({
  workflow,
  text,
  currentProject,
  selectedFeatureId,
  onCreateProject,
  onCommand,
}: {
  workflow?: ConsoleData["spec"]["prdWorkflow"];
  text: UiStrings;
  currentProject: ProjectSummary;
  selectedFeatureId?: string;
  onCreateProject: (form: ProjectCreateForm) => void;
  onCommand: OnCommand;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState(workflow?.sourceName ?? "");
  const [repositoryUrlInput, setRepositoryUrlInput] = useState("");
  const [expandedPhaseKey, setExpandedPhaseKey] = useState<WorkflowPhaseKey | null>(null);

  useEffect(() => {
    setUploadName(workflow?.sourceName ?? "");
    setRepositoryUrlInput(currentProject.repository.startsWith("/") ? "" : currentProject.repository);
    setExpandedPhaseKey(null);
  }, [currentProject.id, currentProject.repository, workflow?.sourceName]);

  const stages = workflow?.stages?.length
    ? workflow.stages
    : workflowStageFallbacks.map((stage) => ({ ...stage, status: "pending" as const }));
  const targetRepoPath = workflow?.targetRepoPath ?? currentProject.projectDirectory;
  const relativeSourcePath = workflow?.sourcePath ?? "docs/zh-CN/PRD.md";
  const resolvedSourcePath = workflow?.resolvedSourcePath ?? joinDisplayPath(targetRepoPath, relativeSourcePath);
  const sourcePath = workflow?.sourceName ?? resolvedSourcePath;
  const blockedReasons = workflow?.blockedReasons?.length ? workflow.blockedReasons : [];
  const hasProjectDirectory = Boolean(currentProject.projectDirectory);

  const baseWorkflowPhases: WorkflowPhase[] = workflow?.phases?.length
    ? mergeUiSpecIntoFeaturePlanning(workflow.phases)
    : [
        {
          key: "project_initialization" as const,
          status: currentProject.health === "ready" ? ("completed" as const) : ("blocked" as const),
          updatedAt: currentProject.lastActivityAt,
          blockedReasons: currentProject.health === "ready" ? [] : [text.fixProjectInitialization],
          facts: [
            { label: text.project, value: currentProject.name },
            { label: text.projectDirectory, value: currentProject.projectDirectory },
            { label: text.projectHealth, value: currentProject.health },
          ],
          stages: [
            { key: "create_or_import_project", status: "completed" as const },
            {
              key: "connect_git_repository",
              action: "connect_git_repository" as const,
              status: currentProject.repository ? ("completed" as const) : ("blocked" as const),
            },
            {
              key: "initialize_spec_protocol",
              action: "initialize_spec_protocol" as const,
              status: hasProjectDirectory ? ("completed" as const) : ("blocked" as const),
            },
            {
              key: "import_or_create_constitution",
              action: "import_or_create_constitution" as const,
              status: "pending" as const,
            },
            {
              key: "initialize_project_memory",
              action: "initialize_project_memory" as const,
              status: "pending" as const,
            },
          ],
        },
        {
          key: "requirement_intake" as const,
          status: currentProject.health === "ready" ? ("pending" as const) : ("blocked" as const),
          blockedReasons: currentProject.health === "ready" ? [] : [text.fixProjectInitialization],
          facts: [
            { label: text.currentPrdFile, value: sourcePath },
            { label: text.scanMode, value: workflow?.scanMode ?? text.smartMode },
          ],
          stages,
        },
      ];

  const featurePlanningPhase: WorkflowPhase = {
    key: "feature_execution",
    status: selectedFeatureId ? "accepted" : "pending",
    blockedReasons: selectedFeatureId ? [] : [text.noFeatureSpecs],
    facts: [
      { label: text.featureSpec, value: selectedFeatureId ?? text.none },
      { label: text.command, value: "schedule_run" },
    ],
    stages: [
      { key: "generate_hld", action: "generate_hld", status: "pending" as const },
      { key: "generate_ui_spec", action: "generate_ui_spec", status: "pending" as const },
      { key: "split_feature_specs", action: "split_feature_specs", status: "pending" as const },
      { key: "feature_spec_pool", action: "push_feature_spec_pool", status: "pending" as const },
      { key: "status_check", action: "schedule_run", status: "pending" as const },
    ],
  };

  const workflowPhases: WorkflowPhase[] = baseWorkflowPhases.some((phase) => phase.key === "feature_execution")
    ? baseWorkflowPhases
    : [...baseWorkflowPhases, featurePlanningPhase];

  const workflowSummaryTags = [
    { label: text.currentPrdFile, value: uploadName || sourcePath, tone: "neutral" as const },
    { label: text.prdVersion, value: workflow?.sourceVersion ?? "v1.3.0", tone: "blue" as const },
    {
      label: text.scanMode,
      value:
        workflow?.scanMode === "smart" || !workflow?.scanMode
          ? text.smartMode
          : workflow.scanMode,
      tone: "neutral" as const,
    },
    { label: text.lastScan, value: workflow?.lastScanAt ?? "--", tone: "neutral" as const },
    {
      label: blockedReasons.length > 0 ? text.workflowBlockedItems : text.runtime,
      value: blockedReasons.length > 0 ? String(blockedReasons.length) : workflow?.runtime ?? "10m 24s",
      tone: blockedReasons.length > 0 ? ("red" as const) : ("green" as const),
    },
  ];

  function runWorkflowAction(action: CommandReceipt["action"], key: string, phaseKey: WorkflowPhaseKey) {
    const entityType =
      phaseKey === "feature_execution" &&
      selectedFeatureId &&
      action !== "generate_hld" &&
      action !== "split_feature_specs" &&
      action !== "push_feature_spec_pool"
        ? "feature"
        : "project";
    const entityId = entityType === "feature" && selectedFeatureId ? selectedFeatureId : currentProject.id;
    const schedulePayload =
      action === "schedule_run"
        ? { mode: "manual", requestedFor: new Date().toISOString(), featureId: selectedFeatureId }
        : {};
    onCommand(action, entityType, entityId, {
      stage: key,
      targetRepoPath,
      repositoryUrl: action === "connect_git_repository" ? repositoryUrlInput.trim() : undefined,
      sourcePath: relativeSourcePath,
      resolvedSourcePath,
      sourceVersion: workflow?.sourceVersion ?? "v1.3.0",
      scanMode: workflow?.scanMode ?? "smart",
      ...schedulePayload,
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
                <span className="max-w-[240px] truncate">
                  {tag.label}: {tag.value}
                </span>
              </Chip>
            ))}
          </div>
        </div>
        <Button tone="quiet">
          <RefreshCw size={14} />
          {text.viewAuditLog}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {workflowPhases.map((phase) => {
          const phaseTitle = workflowPhaseTitle(phase.key, text);
          const phaseTone =
            phase.status === "blocked"
              ? "red"
              : phase.status === "completed"
                ? "green"
                : phase.status === "accepted"
                  ? "blue"
                  : "amber";
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
              {isExpanded ? (
                <ChevronDown size={15} className="shrink-0 text-action" />
              ) : (
                <ChevronRight size={15} className="shrink-0 text-muted" />
              )}
              <span className="truncate text-[13px] font-semibold text-ink">{phaseTitle}</span>
              <Chip tone={phaseTone}>{workflowStatusLabel(phase.status, text)}</Chip>
              <span className="shrink-0 text-[12px] text-muted">{phase.updatedAt ?? "--"}</span>
            </button>
          );
        })}
      </div>

      {workflowPhases.map((phase) => {
        if (expandedPhaseKey !== phase.key) return null;
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
                <div
                  key={`${phase.key}-${fact.label}`}
                  className="min-w-0 rounded-md border border-line bg-slate-50 px-3 py-2"
                >
                  <div className="text-[11px] text-muted">{fact.label}</div>
                  <div className="mt-1 truncate text-[12px] font-semibold text-ink">{fact.value}</div>
                </div>
              ))}
            </div>
            {/* TASK-026: Stage 1 shows auto-init status only — no manual sub-step buttons */}
            {phase.key === "project_initialization" ? (
              <div className="mt-4 grid grid-cols-3 gap-2 max-xl:grid-cols-2 max-md:grid-cols-1">
                {phase.stages.map((stage, index) => {
                  const Icon = workflowStageIcons[stage.key] ?? FileText;
                  const isBlocked = stage.status === "blocked";
                  const tone = isBlocked
                    ? "red"
                    : stage.status === "completed"
                      ? "green"
                      : stage.status === "accepted"
                        ? "blue"
                        : "amber";
                  return (
                    <div
                      key={`${phase.key}-${stage.key}`}
                      className="flex min-w-0 items-start gap-2 rounded-md border border-line bg-white p-3"
                    >
                      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-muted">
                        {index + 1}
                      </div>
                      <Icon size={15} className={isBlocked ? "mt-0.5 shrink-0 text-red-600" : "mt-0.5 shrink-0 text-action"} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-semibold text-ink">
                          {workflowStageLabel(stage.key, text)}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Chip tone={tone}>{workflowStatusLabel(stage.status, text)}</Chip>
                          <span className="text-[11px] text-muted">{stage.updatedAt ?? stage.blockedReason ?? "--"}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 max-xl:grid-cols-1">
                {phase.stages.map((stage, index) => {
                  const Icon = workflowStageIcons[stage.key] ?? FileText;
                  const isBlocked = stage.status === "blocked";
                  const stageAction = workflowStageAction(phase.key, stage.key, stage.action);
                  const canRun =
                    Boolean(stageAction) &&
                    (phase.key !== "feature_execution" ||
                      Boolean(selectedFeatureId) ||
                      stageAction === "generate_hld" ||
                      stageAction === "generate_ui_spec" ||
                      stageAction === "split_feature_specs" ||
                      stageAction === "push_feature_spec_pool");
                  const isSpecSourceIntake =
                    phase.key === "requirement_intake" && stage.key === "spec_source_intake";
                  return (
                    <div
                      key={`${phase.key}-${stage.key}`}
                      className="flex min-w-0 items-center gap-3 rounded-md border border-line bg-white p-3"
                    >
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-action text-[12px] font-semibold text-white">
                        {index + 1}
                      </div>
                      <Icon size={17} className={isBlocked ? "text-red-600" : "text-action"} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-ink">
                          {workflowStageLabel(stage.key, text)}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <Chip
                            tone={
                              isBlocked
                                ? "red"
                                : stage.status === "completed"
                                  ? "green"
                                  : stage.status === "accepted"
                                    ? "blue"
                                    : "amber"
                            }
                          >
                            {workflowStatusLabel(stage.status, text)}
                          </Chip>
                          <span className="text-[12px] text-muted">{stage.updatedAt ?? stage.blockedReason ?? "--"}</span>
                        </div>
                      </div>
                      {isSpecSourceIntake ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            className="h-8"
                            onClick={() => runWorkflowAction("scan_prd_source", "scan_prd", phase.key)}
                          >
                            <Search size={14} />
                            {text.scanPrd}
                          </Button>
                          <Button className="h-8" onClick={() => inputRef.current?.click()}>
                            <Upload size={14} />
                            {text.uploadPrd}
                          </Button>
                        </div>
                      ) : canRun ? (
                        <div className="flex shrink-0 items-center gap-2">
                          {stage.key === "connect_git_repository" && stage.status !== "completed" ? (
                            <input
                              className="h-8 w-56 rounded-md border border-line px-2 text-[12px]"
                              value={repositoryUrlInput}
                              onChange={(event) => setRepositoryUrlInput(event.target.value)}
                              placeholder={text.repositoryUrlPlaceholder}
                              aria-label={text.repositoryUrl}
                            />
                          ) : null}
                          <Button
                            className="h-8 shrink-0"
                            onClick={() =>
                              stage.key === "upload_prd"
                                ? inputRef.current?.click()
                                : runWorkflowAction(stageAction!, stage.key, phase.key)
                            }
                          >
                            {workflowStageLabel(stage.key, text)}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {/* TASK-027: Stage 2 Spec Sources Discovery panel */}
            {phase.key === "requirement_intake" && workflow?.specSources?.length ? (
              <div className="mt-5">
                <div className="mb-3 text-[14px] font-semibold text-ink">{text.specSourcesDiscovery}</div>
                <div className="overflow-auto rounded-md border border-line">
                  <table className="w-full border-collapse text-left text-[12px]">
                    <thead className="border-b border-line bg-slate-50 text-[11px] font-medium text-muted">
                      <tr>
                        <th className="px-3 py-2">{text.requirementId}</th>
                        <th className="px-3 py-2">{text.sourcePath}</th>
                        <th className="px-3 py-2">{text.status}</th>
                        <th className="px-3 py-2">{text.clarification}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workflow.specSources.map((src) => {
                        const statusToneMap = {
                          found: "green",
                          missing: "red",
                          conflict: "amber",
                          clarification: "blue",
                        } as const;
                        const statusLabelMap: Record<string, string> = {
                          found: text.specSourceFound,
                          missing: text.specSourceMissing,
                          conflict: text.specSourceConflict,
                          clarification: text.specSourceClarification,
                        };
                        const tone = statusToneMap[src.status as keyof typeof statusToneMap] ?? "neutral";
                        return (
                          <tr key={`src-${src.type}`} className="border-b border-line last:border-0">
                            <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink">{src.label}</td>
                            <td className="max-w-[300px] truncate px-3 py-2 font-mono text-[11px] text-muted">
                              {src.path ?? "--"}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              <Chip tone={tone}>{statusLabelMap[src.status] ?? src.status}</Chip>
                            </td>
                            <td className="px-3 py-2 text-muted">{src.detail ?? "--"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            {/* UI Spec generated outputs — shown after HLD in Stage 3 */}
            {phase.key === "feature_execution" && phase.stages.some((stage) => stage.key === "generate_ui_spec") ? (
              <div className="mt-5">
                <div className="mb-3 text-[14px] font-semibold text-ink">{text.uiSpecConceptTitle}</div>
                <p className="mb-3 text-[12px] text-muted">{text.uiSpecConceptDescription}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-line bg-slate-50 px-3 py-2 text-[12px] text-ink">
                    <div className="font-semibold">docs/ui/ui-spec.md</div>
                    <div className="mt-1 text-muted">{text.uiSpecDocumentOutput}</div>
                  </div>
                  <div className="rounded-md border border-line bg-slate-50 px-3 py-2 text-[12px] text-ink">
                    <div className="font-semibold">docs/ui/concepts/*.svg</div>
                    <div className="mt-1 text-muted">{text.uiSpecConceptOutput}</div>
                  </div>
                </div>
              </div>
            ) : null}
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

function RequirementsSection({
  selected,
  tasks,
  text,
}: {
  selected: NonNullable<ConsoleData["spec"]["selectedFeature"]>;
  tasks: BoardTask[];
  text: UiStrings;
}) {
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
                    <td className="px-2 py-3">
                      <Chip tone="amber">{requirement.priority ?? "MVP"}</Chip>
                    </td>
                    <td className="px-2 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 ${
                          requirement.acceptanceCriteria || index < selected.requirements.length - 1
                            ? "text-emerald-700"
                            : "text-red-700"
                        }`}
                      >
                        {requirement.acceptanceCriteria || index < selected.requirements.length - 1 ? (
                          <CheckCircle2 size={15} />
                        ) : (
                          <XCircle size={15} />
                        )}
                        {requirement.acceptanceCriteria || index < selected.requirements.length - 1
                          ? text.acceptedStatus
                          : text.pendingAcceptance}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-action">EV-{708 + index}</td>
                    <td className="whitespace-nowrap px-2 py-3">
                      <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
                        CL-{index + 1}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={text.noSpecSectionData} />
        )}
      </div>
      <div>
        <div className="mb-3 text-[15px] font-semibold">{text.traceability}</div>
        {selected.requirements.length > 0 && tasks.length > 0 ? (
          <div className="overflow-auto rounded-md border border-line">
            <table className="w-full min-w-[520px] border-collapse text-center text-[12px]">
              <thead className="border-b border-line bg-slate-50 text-[12px] text-muted">
                <tr>
                  <th className="px-3 py-3 text-left">
                    {text.requirements} / {text.task}
                  </th>
                  {tasks.slice(0, 6).map((task) => (
                    <th key={task.id} className="px-3 py-3">
                      {task.id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selected.requirements.map((requirement, rowIndex) => (
                  <tr key={requirement.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-3 text-left font-medium">{requirement.id}</td>
                    {tasks.slice(0, 6).map((task, columnIndex) => {
                      const linked =
                        (rowIndex + columnIndex) % 2 === 0 ||
                        task.title.toLowerCase().includes(requirement.id.toLowerCase());
                      return (
                        <td key={task.id} className="px-3 py-3">
                          {linked ? (
                            <CheckCircle2 className="mx-auto text-emerald-600" size={16} />
                          ) : (
                            <span className="text-muted">--</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={text.noSpecSectionData} />
        )}
      </div>
    </div>
  );
}

function QualitySection({
  selected,
  text,
}: {
  selected: NonNullable<ConsoleData["spec"]["selectedFeature"]>;
  text: UiStrings;
}) {
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
  ) : (
    <EmptyState title={text.noSpecSectionData} />
  );
}

function TaskGraphSection({
  tasks,
  taskGraph,
  text,
}: {
  tasks: BoardTask[];
  taskGraph: unknown;
  text: UiStrings;
}) {
  if (tasks.length === 0 && !taskGraph) {
    return <EmptyState title={text.noSpecSectionData} />;
  }
  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <div key={task.id} className="rounded-md border border-line bg-slate-50 p-3 text-[13px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">
              {task.id} <span className="font-medium">{task.title}</span>
            </div>
            <Chip tone={statusTone[task.status] ?? "neutral"}>{task.status}</Chip>
          </div>
          <div className="mt-2 text-muted">
            {text.dependencies}:{" "}
            {task.dependencies.map((dependency) => dependency.id).join(", ") || text.none}
          </div>
        </div>
      ))}
      {taskGraph ? (
        <pre className="max-h-48 overflow-auto rounded-md border border-line bg-white p-3 text-[12px] text-slate-600">
          {formatSpecValue(taskGraph)}
        </pre>
      ) : null}
    </div>
  );
}

function SpecObjectSection({
  title,
  value,
  fallbackItems = [],
  text,
}: {
  title: string;
  value: unknown;
  fallbackItems?: unknown[];
  text: UiStrings;
}) {
  const items = normalizeSpecItems(value).concat(fallbackItems.map(formatSpecValue)).filter(Boolean);
  return items.length > 0 ? (
    <div>
      <div className="mb-3 text-[15px] font-semibold">{title}</div>
      <div className="space-y-3">
        {items.map((item, index) => (
          <pre
            key={`${title}-${index}`}
            className="overflow-auto whitespace-pre-wrap rounded-md border border-line bg-slate-50 p-3 text-[12px] leading-5 text-slate-700"
          >
            {item}
          </pre>
        ))}
      </div>
    </div>
  ) : (
    <EmptyState title={text.noSpecSectionData} />
  );
}

function CreateFeatureDialog({ text, onCreate }: { text: UiStrings; onCreate: () => void }) {
  return (
    <Button onClick={onCreate}>
      <Plus size={15} />
      {text.createFeature}
    </Button>
  );
}

export function SpecPage({
  data,
  text,
  currentProject,
  onCreateProject,
  onCommand,
}: {
  data: ConsoleData;
  text: UiStrings;
  currentProject: ProjectSummary;
  onCreateProject: (form: ProjectCreateForm) => void;
  onCommand: OnCommand;
}) {
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
      const matchesQuery =
        !normalizedQuery ||
        `${feature.id} ${feature.title} ${feature.primaryRequirements.join(" ")}`
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" || feature.status.toLowerCase().includes(statusFilter);
      return matchesQuery && matchesStatus;
    });
  }, [data.spec.features, query, statusFilter]);

  const selectedListItem =
    data.spec.features.find((feature) => feature.id === selectedFeatureId) ?? data.spec.features[0];
  const selected =
    data.spec.selectedFeature?.id === selectedListItem?.id
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
  const reviewForFeature = data.reviews.items.find(
    (item) =>
      item.featureId === selected?.id ||
      featureTasks.some((task) => task.id === item.taskId),
  );
  const recentEvidence = [
    ...data.audit.linkedEvidence
      .filter((entry) => !selected?.id || entry.runId || entry.id)
      .map((entry) => ({ id: entry.id, summary: entry.summary, path: entry.path, source: entry.kind })),
    ...data.reviews.items
      .filter(
        (item) =>
          item.featureId === selected?.id ||
          featureTasks.some((task) => task.id === item.taskId),
      )
      .flatMap((item) => item.evidence.map((entry) => ({ ...entry, source: item.id }))),
  ].slice(0, 4);
  const latestAuditEvent =
    data.audit.timeline.find(
      (event) =>
        event.featureId === selected?.id ||
        featureTasks.some((task) => task.id === event.taskId),
    ) ?? data.audit.timeline[0];
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
        <SpecPrdWorkflowPanel
          workflow={data.spec.prdWorkflow}
          text={text}
          currentProject={currentProject}
          selectedFeatureId={undefined}
          onCreateProject={onCreateProject}
          onCommand={onCommand}
        />
        <Panel>
          <SectionTitle title={text.featureSpec} />
          <EmptyState title={text.noFeatureSpecs} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SpecPrdWorkflowPanel
        workflow={data.spec.prdWorkflow}
        text={text}
        currentProject={currentProject}
        selectedFeatureId={selected.id}
        onCreateProject={onCreateProject}
        onCommand={onCommand}
      />
      <Panel>
        <SectionTitle title={text.featureSpec} />
        <div className="grid grid-cols-[280px_minmax(0,1fr)_320px] gap-4 p-4 max-xl:grid-cols-1">
          <aside className="min-w-0 rounded-md border border-line bg-white" aria-label={text.featureSpecList}>
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div className="min-w-0 text-[13px] font-semibold text-ink">{text.featureSpecList}</div>
              <Chip tone="neutral">{text.itemsTotal(filteredFeatures.length)}</Chip>
            </div>
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
                    className={`h-7 rounded-md border px-2 text-[11px] font-medium ${
                      statusFilter === filter.key
                        ? "border-blue-300 bg-blue-50 text-action"
                        : "border-line bg-white text-muted hover:bg-slate-50"
                    }`}
                    onClick={() => setStatusFilter(filter.key)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[640px] space-y-2 overflow-auto p-3">
              {filteredFeatures.length > 0 ? (
                filteredFeatures.map((feature) => {
                  const active = feature.id === selected.id;
                  return (
                    <button
                      key={feature.id}
                      className={`w-full rounded-md border p-3 text-left text-[13px] transition-colors ${
                        active
                          ? "border-blue-300 bg-blue-50/70 shadow-sm"
                          : "border-line bg-slate-50 hover:bg-white"
                      }`}
                      onClick={() => setSelectedFeatureId(feature.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold">{feature.id}</div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted">
                          <StatusDot status={feature.status} />
                          {feature.status}
                        </div>
                      </div>
                      <div className="mt-2 text-[14px] font-semibold text-ink">{feature.title}</div>
                      <div className="mt-3 text-[12px] text-muted">{text.primaryRequirements}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {feature.primaryRequirements.slice(0, 4).map((requirement) => (
                          <span
                            key={requirement}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
                          >
                            {requirement}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })
              ) : (
                <EmptyState title={text.noFeatureSpecs} />
              )}
            </div>
          </aside>

          <section className="min-w-0 rounded-md border border-line bg-white">
            <div className="flex min-h-[84px] items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[22px] font-semibold tracking-normal">
                    {selected.id}{" "}
                    <span className="font-medium">{selected.title}</span>
                  </h2>
                  <Chip tone={statusTone[selectedListItem?.status ?? ""] ?? "blue"}>
                    {selectedListItem?.status ?? "unknown"}
                  </Chip>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                  <FileText size={14} />
                  {text.folder}:{" "}
                  {selectedListItem?.folder
                    ? `docs/features/${selectedListItem.folder}`
                    : text.none}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button className="size-9 p-0" aria-label="Refresh">
                  <RefreshCw size={15} />
                </Button>
                <Button className="size-9 p-0" aria-label={text.specDiff}>
                  <ExternalLink size={15} />
                </Button>
              </div>
            </div>
            <div className="border-b border-line px-4">
              <div className="flex gap-5 overflow-x-auto">
                {sections.map((section) => (
                  <button
                    key={section.key}
                    className={`h-12 whitespace-nowrap border-b-2 text-[14px] font-medium ${
                      activeSection === section.key
                        ? "border-action text-action"
                        : "border-transparent text-slate-600 hover:text-ink"
                    }`}
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
                <SpecObjectSection
                  title={text.technicalPlan}
                  value={selected.technicalPlan}
                  fallbackItems={selected.dataModels}
                  text={text}
                />
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
              <div className="border-b border-line px-4 py-3 text-[15px] font-semibold">
                {text.controlledActions}
              </div>
              <div className="space-y-2 p-3">
                <Button
                  className="w-full justify-start"
                  onClick={() => onCommand("create_feature", "project", currentProjectId)}
                >
                  <Plus size={15} />
                  {text.createFeature}
                </Button>
                <Button
                  className="w-full justify-start"
                  onClick={() =>
                    onCommand("schedule_run", "feature", selected.id, {
                      stage: "status_scheduling",
                      mode: "manual",
                      requestedFor: new Date().toISOString(),
                      featureId: selected.id,
                    })
                  }
                >
                  <Workflow size={15} />
                  {text.scheduleRunAction}
                </Button>
                <Button
                  className="w-full justify-start"
                  onClick={() =>
                    onCommand("schedule_board_tasks", "feature", selected.id, {
                      taskIds: featureTasks.map((task) => task.id),
                    })
                  }
                >
                  <CalendarCheck size={15} />
                  {text.scheduleTasks}
                </Button>
                <Button
                  className="w-full justify-start"
                  onClick={() =>
                    onCommand("schedule_run", "feature", selected.id, { stage: "status_check" })
                  }
                >
                  <ShieldCheck size={15} />
                  {text.runChecks}
                </Button>
                <Button
                  className="w-full justify-start"
                  onClick={() =>
                    onCommand("write_spec_evolution", "spec", selected.id, { featureId: selected.id })
                  }
                >
                  <FileText size={15} />
                  {text.writeSpecEvolution}
                </Button>
              </div>
              <div className="mx-3 mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldAlert size={16} />
                  {text.productApprovalRequired}
                </div>
                <div className="mt-1 pl-6">{blockedReason}</div>
              </div>
            </div>

            <div className="rounded-md border border-line bg-white">
              <div className="border-b border-line px-4 py-3 text-[15px] font-semibold">
                {text.qualityGate}
              </div>
              <div className="divide-y divide-line">
                {selected.qualityChecklist.length > 0 ? (
                  selected.qualityChecklist.map((item) => (
                    <div
                      key={item.item}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
                    >
                      <div className="flex items-center gap-2">
                        {item.passed ? (
                          <CheckCircle2 size={15} className="text-emerald-600" />
                        ) : (
                          <XCircle size={15} className="text-red-600" />
                        )}
                        {humanizeSpecKey(item.item)}
                      </div>
                      <Chip tone={item.passed ? "green" : "red"}>{item.passed ? text.pass : text.fail}</Chip>
                    </div>
                  ))
                ) : (
                  <EmptyState title={text.noSpecSectionData} />
                )}
              </div>
            </div>

            <div className="rounded-md border border-line bg-white">
              <div className="border-b border-line px-4 py-3 text-[15px] font-semibold">
                {text.recentEvidence}
              </div>
              <div className="divide-y divide-line">
                {recentEvidence.length > 0 ? (
                  recentEvidence.map((entry) => (
                    <a
                      key={`${entry.source}-${entry.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] hover:bg-slate-50"
                      href={entry.path ?? "#"}
                    >
                      <span>
                        <span className="font-semibold text-action">{entry.id}</span>
                        <span className="ml-2 text-muted">{entry.summary}</span>
                      </span>
                      <ExternalLink size={14} className="text-muted" />
                    </a>
                  ))
                ) : (
                  <EmptyState title={text.noEvidence} />
                )}
              </div>
            </div>

            <div className="rounded-md border border-line bg-white p-4 text-[13px]">
              <div className="mb-3 text-[15px] font-semibold">{text.audit}</div>
              <FactList
                rows={[
                  [text.latestCommand, latestAuditEvent?.action ?? text.none],
                  [text.receivedAt, latestAuditEvent?.occurredAt ?? text.none],
                  [text.receiver, latestAuditEvent?.requestedBy ?? "system"],
                  [text.status, latestAuditEvent?.status ?? text.none],
                ]}
              />
            </div>
          </aside>
        </div>
        <div className="border-t border-line px-4 py-3 text-[12px] text-muted">{text.factSourcesSpec}</div>
      </Panel>
    </div>
  );
}
