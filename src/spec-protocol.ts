import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export type InputSourceType = "natural-language" | "PR" | "RP" | "PRD" | "EARS" | "mixed";
export type FeatureStatus = "draft" | "review_needed" | "ready";
export type FileSpecLifecycleStatus =
  | "draft"
  | "ready"
  | "queued"
  | "running"
  | "paused"
  | "approval_needed"
  | "cancelled"
  | "blocked"
  | "review_needed"
  | "completed"
  | "failed"
  | "skipped"
  | "delivered";
export type FileSpecExecutionStatus =
  | "queued"
  | "running"
  | "paused"
  | "approval_needed"
  | "cancelled"
  | "blocked"
  | "completed"
  | "failed"
  | "skipped";
export type ClarificationStatus = "open" | "answered" | "closed";
export type ChecklistStatus = "passed" | "failed";
export type SpecVersionBump = "MAJOR" | "MINOR" | "PATCH";

export type SourceContext = {
  id: string;
  type: InputSourceType;
  label: string;
  text: string;
  lineNumber?: number;
};

export type AcceptanceCriteria = {
  id: string;
  requirementId: string;
  description: string;
  source: SourceContext;
};

export type TestScenario = {
  id: string;
  requirementId: string;
  acceptanceCriteriaId: string;
  title: string;
  steps: string[];
  expectedResult: string;
  source: SourceContext;
};

export type Requirement = {
  id: string;
  featureId: string;
  statement: string;
  behavior: string;
  source: SourceContext;
  acceptanceCriteriaIds: string[];
  testScenarioIds: string[];
  atomic: boolean;
  observable: boolean;
  trace: {
    featureId: string;
    acceptanceCriteriaIds: string[];
    testScenarioIds: string[];
  };
};

export type UserStory = {
  id: string;
  role: string;
  goal: string;
  benefit: string;
  source: SourceContext;
};

export type ClarificationLogEntry = {
  id: string;
  status: ClarificationStatus;
  question: string;
  source: SourceContext;
  impact: string[];
  recommendedAnswer?: string;
  answer?: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
};

export type ChecklistCategory =
  | "completeness"
  | "clarity"
  | "consistency"
  | "measurability"
  | "scenarioCoverage"
  | "edgeCases"
  | "nonFunctionalAttributes"
  | "dependencies"
  | "assumptions"
  | "ambiguity"
  | "conflicts";

export type RequirementChecklistItem = {
  category: ChecklistCategory;
  status: ChecklistStatus;
  passed: boolean;
  detail: string;
};

export type RequirementChecklist = {
  featureId: string;
  status: ChecklistStatus;
  items: RequirementChecklistItem[];
  blocksReady: boolean;
};

export type SpecVersion = {
  version: string;
  bump: SpecVersionBump;
  reason: string;
  createdAt: string;
};

export type FeatureSpec = {
  id: string;
  name: string;
  goal: string;
  roles: string[];
  userStories: UserStory[];
  priority: string;
  acceptanceCriteria: AcceptanceCriteria[];
  testScenarios: TestScenario[];
  requirements: Requirement[];
  successMetrics: string[];
  entities: string[];
  assumptions: string[];
  nonScope: string[];
  risks: string[];
  relatedFiles: string[];
  sources: SourceContext[];
  clarificationLog: ClarificationLogEntry[];
  checklist: RequirementChecklist;
  versions: SpecVersion[];
  status: FeatureStatus;
};

export type FileSpecState = {
  schemaVersion: 1;
  featureId: string;
  status: FileSpecLifecycleStatus;
  executionStatus?: FileSpecExecutionStatus;
  updatedAt: string;
  currentJob?: {
    schedulerJobId?: string;
    executionId?: string;
    operation?: string;
    queuedAt?: string;
    startedAt?: string;
    completedAt?: string;
  };
  blockedReasons: string[];
  dependencies: string[];
  lastResult?: {
    status: FileSpecLifecycleStatus;
    summary: string;
    producedArtifacts: Array<{ path: string; kind: string; status: string; summary?: string }>;
    completedAt: string;
  };
  nextAction?: string;
  history: Array<{
    at: string;
    status: FileSpecLifecycleStatus;
    executionStatus?: FileSpecExecutionStatus;
    summary: string;
    source: string;
    schedulerJobId?: string;
    executionId?: string;
  }>;
};

export type FileSpecStatePatch = Partial<Omit<FileSpecState, "schemaVersion" | "featureId" | "history">> & {
  history?: FileSpecState["history"];
};

export type SpecSlice = {
  feature: Pick<FeatureSpec, "id" | "name" | "goal" | "priority" | "status">;
  userStories: UserStory[];
  requirements: Requirement[];
  acceptanceCriteria: AcceptanceCriteria[];
  testScenarios: TestScenario[];
  relatedFiles: string[];
  trace: {
    featureId: string;
    requirementIds: string[];
    acceptanceCriteriaIds: string[];
    testScenarioIds: string[];
    sourceIds: string[];
  };
};

export type SpecSourceFileType =
  | "PRD"
  | "EARS"
  | "HLD"
  | "design"
  | "feature-requirements"
  | "tasks"
  | "README";

export type SpecMissingItemKind =
  | "missing_design"
  | "missing_requirements"
  | "missing_tasks"
  | "orphaned_traceability"
  | "missing_hld";

export type SpecConflictItem = {
  id: string;
  sourcePathA: string;
  sourcePathB: string;
  description: string;
};

export type SpecMissingItem = {
  id: string;
  kind: SpecMissingItemKind;
  relatedPath: string;
  description: string;
};

export type SpecSourceScanResult = {
  path: string;
  relativePath: string;
  fileType: SpecSourceFileType;
  traceIds: string[];
  version?: string;
  hasAmbiguousContent: boolean;
  hasConflictContent: boolean;
  exists: boolean;
};

export type SpecSourceClarificationItem = {
  id: string;
  sourcePath: string;
  description: string;
  type: "ambiguity" | "conflict" | "missing" | "orphaned";
};

export type SpecSourceScanSummary = {
  projectPath: string;
  scannedAt: string;
  sources: SpecSourceScanResult[];
  missingItems: SpecMissingItem[];
  conflicts: SpecConflictItem[];
  clarificationItems: SpecSourceClarificationItem[];
};

export type CreateFeatureSpecInput = {
  featureId: string;
  name?: string;
  rawInput: string;
  sourceType?: InputSourceType;
  scanSummary?: SpecSourceScanSummary;
  now?: Date;
};

export type SliceRequest = {
  userStoryIds?: string[];
  requirementIds?: string[];
  acceptanceCriteriaIds?: string[];
  relatedFiles?: string[];
};

const CHECKLIST_CATEGORIES: ChecklistCategory[] = [
  "completeness",
  "clarity",
  "consistency",
  "measurability",
  "scenarioCoverage",
  "edgeCases",
  "nonFunctionalAttributes",
  "dependencies",
  "assumptions",
  "ambiguity",
  "conflicts",
];

const AMBIGUOUS_TERMS = /\b(tbd|todo|unclear|maybe|possibly|probably|somehow|as needed|later|nice to have)\b|待定|不明确|可能|也许|看情况/i;
const CONFLICT_PATTERN = /\b(must|shall|required)\b[\s\S]*\b(must not|shall not|forbidden|never)\b|\b(must not|shall not|forbidden|never)\b[\s\S]*\b(must|shall|required)\b/i;

export function createFeatureSpec(input: CreateFeatureSpecInput): FeatureSpec {
  const sources = parseSources(input.rawInput, input.sourceType ?? "mixed");
  const bySection = parseSections(input.rawInput);
  const name = input.name ?? firstValue(bySection, ["feature", "title", "name"]) ?? input.featureId;
  const goal = firstValue(bySection, ["goal", "objective", "summary"]) ?? firstNonEmptyLine(input.rawInput) ?? name;
  const roles = parseList(firstValue(bySection, ["roles", "role", "actors"]) ?? "user");
  const userStories = parseUserStories(input.featureId, bySection, sources);
  const requirements = decomposeRequirements(input.featureId, sources);
  const acceptanceCriteria = createAcceptanceCriteria(requirements);
  const testScenarios = createTestScenarios(requirements, acceptanceCriteria);

  for (const requirement of requirements) {
    requirement.acceptanceCriteriaIds = acceptanceCriteria
      .filter((criteria) => criteria.requirementId === requirement.id)
      .map((criteria) => criteria.id);
    requirement.testScenarioIds = testScenarios
      .filter((scenario) => scenario.requirementId === requirement.id)
      .map((scenario) => scenario.id);
    requirement.trace.acceptanceCriteriaIds = requirement.acceptanceCriteriaIds;
    requirement.trace.testScenarioIds = requirement.testScenarioIds;
  }

  const clarificationLog = createClarificationLog(sources, input.now);
  if (input.scanSummary) {
    clarificationLog.push(...generateClarificationsFromScan(input.scanSummary, input.now));
  }
  const partial: Omit<FeatureSpec, "checklist" | "status"> = {
    id: input.featureId,
    name,
    goal,
    roles,
    userStories,
    priority: firstValue(bySection, ["priority"]) ?? "medium",
    acceptanceCriteria,
    testScenarios,
    requirements,
    successMetrics: parseList(firstValue(bySection, ["success metrics", "metrics"]) ?? ""),
    entities: parseList(firstValue(bySection, ["entities", "domain entities"]) ?? ""),
    assumptions: parseList(firstValue(bySection, ["assumptions"]) ?? ""),
    nonScope: parseList(firstValue(bySection, ["non-scope", "out of scope"]) ?? ""),
    risks: parseList(firstValue(bySection, ["risks", "risk"]) ?? ""),
    relatedFiles: parseList(firstValue(bySection, ["related files", "files"]) ?? ""),
    sources,
    clarificationLog,
    versions: [createSpecVersion("0.1.0", "MINOR", "Initial feature spec creation", input.now)],
  };
  const checklist = buildRequirementChecklist(partial);

  return {
    ...partial,
    checklist,
    status: checklist.blocksReady ? "review_needed" : "ready",
  };
}

export function decomposeRequirements(featureId: string, sources: SourceContext[]): Requirement[] {
  const candidates = sources.flatMap((source) =>
    splitRequirementText(source.text).map((text) => ({
      text,
      source: {
        ...source,
        text,
      },
    })),
  );

  return candidates.map(({ text, source }, index) => {
    const statement = normalizeEarsStatement(text);
    const behavior = statement.replace(/^WHEN .+?, THE SYSTEM SHALL /i, "").replace(/^THE SYSTEM SHALL /i, "");
    const atomic = isAtomicBehavior(behavior);
    const observable = isObservableBehavior(behavior);
    const id = requirementId(index + 1);

    return {
      id,
      featureId,
      statement,
      behavior,
      source,
      acceptanceCriteriaIds: [],
      testScenarioIds: [],
      atomic,
      observable,
      trace: {
        featureId,
        acceptanceCriteriaIds: [],
        testScenarioIds: [],
      },
    };
  });
}

export function addClarificationAnswer(
  spec: FeatureSpec,
  clarificationId: string,
  answer: string,
  now = new Date(),
): FeatureSpec {
  const clarificationLog = spec.clarificationLog.map((entry) =>
    entry.id === clarificationId
      ? {
          ...entry,
          status: "answered" as const,
          answer,
          updatedAt: now.toISOString(),
        }
      : entry,
  );
  const updated = {
    ...spec,
    clarificationLog,
  };
  const checklist = buildRequirementChecklist(updated);
  return {
    ...updated,
    checklist,
    status: checklist.blocksReady ? "review_needed" : "ready",
  };
}

export function buildRequirementChecklist(
  spec: Pick<
    FeatureSpec,
    | "id"
    | "goal"
    | "roles"
    | "userStories"
    | "requirements"
    | "acceptanceCriteria"
    | "testScenarios"
    | "assumptions"
    | "clarificationLog"
  >,
): RequirementChecklist {
  const checks: Record<ChecklistCategory, [boolean, string]> = {
    completeness: [
      Boolean(spec.goal && spec.roles.length > 0 && spec.requirements.length > 0),
      "Feature has goal, role, and at least one requirement.",
    ],
    clarity: [
      spec.requirements.every((requirement) => requirement.statement.length > 0 && !AMBIGUOUS_TERMS.test(requirement.statement)),
      "Requirements avoid known ambiguous terms.",
    ],
    consistency: [
      !spec.requirements.some((requirement) => CONFLICT_PATTERN.test(requirement.statement)),
      "No single requirement contains contradictory modal language.",
    ],
    measurability: [
      spec.requirements.every((requirement) => requirement.observable),
      "Every requirement has an observable behavior.",
    ],
    scenarioCoverage: [
      spec.requirements.every((requirement) => requirement.testScenarioIds.length > 0) &&
        spec.acceptanceCriteria.length >= spec.requirements.length,
      "Every requirement maps to acceptance criteria and a test scenario.",
    ],
    edgeCases: [
      spec.requirements.some((requirement) => /invalid|error|empty|missing|failure|edge|boundary|conflict|ambiguous/i.test(requirement.statement)),
      "At least one requirement covers an edge or failure path.",
    ],
    nonFunctionalAttributes: [
      spec.requirements.some((requirement) => /performance|secure|security|privacy|audit|trace|deterministic|observable|reliable/i.test(requirement.statement)),
      "At least one requirement covers a non-functional attribute.",
    ],
    dependencies: [
      spec.requirements.some((requirement) => /depend|integration|source|file|artifact|input|context/i.test(requirement.statement)),
      "Dependencies or source context are represented.",
    ],
    assumptions: [spec.assumptions.length > 0, "Assumptions are explicit."],
    ambiguity: [
      !spec.clarificationLog.some((entry) => entry.status === "open" && entry.impact.includes("checklist.ambiguity")),
      "Ambiguities are resolved or absent.",
    ],
    conflicts: [
      !spec.clarificationLog.some((entry) => entry.status === "open" && entry.impact.includes("checklist.conflicts")),
      "Conflicts are resolved or absent.",
    ],
  };

  const items = CHECKLIST_CATEGORIES.map((category) => {
    const [passed, detail] = checks[category];
    return {
      category,
      status: passed ? "passed" : "failed",
      passed,
      detail,
    } satisfies RequirementChecklistItem;
  });
  const blocksReady = items.some((item) => !item.passed);

  return {
    featureId: spec.id,
    status: blocksReady ? "failed" : "passed",
    items,
    blocksReady,
  };
}

export function createSpecVersion(
  currentVersion: string,
  bump: SpecVersionBump,
  reason: string,
  now = new Date(),
): SpecVersion {
  if (!reason.trim()) {
    throw new Error("Spec version reason is required");
  }

  return {
    version: bumpVersion(currentVersion, bump),
    bump,
    reason: reason.trim(),
    createdAt: now.toISOString(),
  };
}

export function recordSpecVersion(spec: FeatureSpec, bump: SpecVersionBump, reason: string, now = new Date()): FeatureSpec {
  const current = spec.versions.at(-1)?.version ?? "0.0.0";
  return {
    ...spec,
    versions: [...spec.versions, createSpecVersion(current, bump, reason, now)],
  };
}

export function createSpecSlice(spec: FeatureSpec, request: SliceRequest = {}): SpecSlice {
  const requestedRequirementIds = new Set(request.requirementIds ?? []);
  const requestedAcceptanceCriteriaIds = new Set(request.acceptanceCriteriaIds ?? []);
  const requestedUserStoryIds = new Set(request.userStoryIds ?? []);
  const hasRequirementFilter = requestedRequirementIds.size > 0;
  const hasAcceptanceCriteriaFilter = requestedAcceptanceCriteriaIds.size > 0;
  const hasContextFilter = hasRequirementFilter || hasAcceptanceCriteriaFilter;

  const requirements =
    hasContextFilter
      ? spec.requirements.filter(
          (requirement) =>
            requestedRequirementIds.has(requirement.id) ||
            requirement.acceptanceCriteriaIds.some((id) => requestedAcceptanceCriteriaIds.has(id)),
        )
      : spec.requirements;
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const acceptanceCriteria = spec.acceptanceCriteria.filter(
    (criteria) =>
      (hasAcceptanceCriteriaFilter
        ? requestedAcceptanceCriteriaIds.has(criteria.id)
        : requirementIds.has(criteria.requirementId)) ||
      (!hasContextFilter && requirementIds.has(criteria.requirementId)),
  );
  const acceptanceCriteriaIds = new Set(acceptanceCriteria.map((criteria) => criteria.id));
  const testScenarios = spec.testScenarios.filter(
    (scenario) => requirementIds.has(scenario.requirementId) || acceptanceCriteriaIds.has(scenario.acceptanceCriteriaId),
  );
  const userStories =
    requestedUserStoryIds.size > 0
      ? spec.userStories.filter((story) => requestedUserStoryIds.has(story.id))
      : spec.userStories.slice(0, 1);
  const sourceIds = new Set([
    ...requirements.map((requirement) => requirement.source.id),
    ...acceptanceCriteria.map((criteria) => criteria.source.id),
    ...testScenarios.map((scenario) => scenario.source.id),
  ]);

  return {
    feature: {
      id: spec.id,
      name: spec.name,
      goal: spec.goal,
      priority: spec.priority,
      status: spec.status,
    },
    userStories,
    requirements,
    acceptanceCriteria,
    testScenarios,
    relatedFiles: request.relatedFiles?.filter((file) => spec.relatedFiles.includes(file)) ?? spec.relatedFiles,
    trace: {
      featureId: spec.id,
      requirementIds: requirements.map((requirement) => requirement.id),
      acceptanceCriteriaIds: acceptanceCriteria.map((criteria) => criteria.id),
      testScenarioIds: testScenarios.map((scenario) => scenario.id),
      sourceIds: [...sourceIds],
    },
  };
}

export function scanSpecSources(projectPath: string, now = new Date()): SpecSourceScanSummary {
  const root = resolve(projectPath);
  const sources: SpecSourceScanResult[] = [];
  const missingItems: SpecMissingItem[] = [];
  const conflicts: SpecConflictItem[] = [];
  const clarificationItems: SpecSourceClarificationItem[] = [];

  const rootCandidates: Array<[string, SpecSourceFileType]> = [
    ["README.md", "README"],
    ["docs/README.md", "README"],
    ["docs/PRD.md", "PRD"],
    ["docs/requirements.md", "EARS"],
    ["docs/hld.md", "HLD"],
    ["docs/design.md", "design"],
  ];
  const localizedCandidates: Array<[string, SpecSourceFileType]> = hasMultilingualSpecSupport(root)
    ? preferredSpecLanguages(root).flatMap((language): Array<[string, SpecSourceFileType]> => [
      [`docs/${language}/PRD.md`, "PRD"],
      [`docs/${language}/requirements.md`, "EARS"],
      [`docs/${language}/hld.md`, "HLD"],
      [`docs/${language}/design.md`, "design"],
    ])
    : [];
  const staticCandidates = [...rootCandidates, ...localizedCandidates];

  for (const [relPath, fileType] of staticCandidates) {
    const result = scanSpecFile(join(root, relPath), relPath, fileType);
    if (result.exists) {
      sources.push(result);
    }
  }

  const featuresDir = join(root, "docs", "features");
  if (existsSync(featuresDir)) {
    for (const entry of readdirSync(featuresDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^feat-\d+/.test(entry.name)) continue;

      const featRel = join("docs", "features", entry.name);
      const featureFiles: Array<[string, SpecSourceFileType]> = [
        [join(featRel, "requirements.md"), "feature-requirements"],
        [join(featRel, "design.md"), "design"],
        [join(featRel, "tasks.md"), "tasks"],
      ];

      let hasRequirements = false;
      let hasDesign = false;
      let hasTasks = false;

      for (const [relPath, fileType] of featureFiles) {
        const result = scanSpecFile(join(root, relPath), relPath, fileType);
        if (result.exists) {
          sources.push(result);
          if (fileType === "feature-requirements") hasRequirements = true;
          if (fileType === "design") hasDesign = true;
          if (fileType === "tasks") hasTasks = true;
        }
      }

      if (hasTasks && !hasRequirements) {
        const id = missingItemId(missingItems.length + 1);
        missingItems.push({ id, kind: "missing_requirements", relatedPath: featRel, description: `${entry.name} has tasks.md but no requirements.md` });
        clarificationItems.push({ id: scanClarId(clarificationItems.length + 1), sourcePath: featRel, description: `Missing requirements.md for ${entry.name}`, type: "missing" });
      }
      if (hasTasks && !hasDesign) {
        const id = missingItemId(missingItems.length + 1);
        missingItems.push({ id, kind: "missing_design", relatedPath: featRel, description: `${entry.name} has tasks.md but no design.md` });
      }
      if (hasRequirements && !hasDesign && !hasTasks) {
        const id = missingItemId(missingItems.length + 1);
        missingItems.push({ id, kind: "missing_design", relatedPath: featRel, description: `${entry.name} has requirements.md but no design.md — design phase needed before task slicing` });
      }
    }
  }

  detectOrphanedTraceability(sources, missingItems, clarificationItems);

  for (const source of sources) {
    if (source.hasConflictContent) {
      conflicts.push({
        id: conflictId(conflicts.length + 1),
        sourcePathA: source.relativePath,
        sourcePathB: source.relativePath,
        description: `Conflicting modal language detected in ${source.relativePath}`,
      });
      clarificationItems.push({ id: scanClarId(clarificationItems.length + 1), sourcePath: source.relativePath, description: `Conflicting modal language in ${source.relativePath}`, type: "conflict" });
    } else if (source.hasAmbiguousContent) {
      clarificationItems.push({ id: scanClarId(clarificationItems.length + 1), sourcePath: source.relativePath, description: `Ambiguous terms detected in ${source.relativePath}`, type: "ambiguity" });
    }
  }

  return { projectPath: root, scannedAt: now.toISOString(), sources, missingItems, conflicts, clarificationItems };
}

function hasMultilingualSpecSupport(root: string): boolean {
  const docsReadme = join(root, "docs", "README.md");
  if (existsSync(docsReadme)) {
    const content = readFileSafe(docsReadme).toLowerCase();
    if (content.includes("default language") || content.includes("languages:") || content.includes("multilingual")) {
      return true;
    }
  }
  return ["en", "zh-CN", "ja"].filter((language) => hasAnyProjectSpecFile(join(root, "docs", language))).length > 1;
}

function preferredSpecLanguages(root: string): string[] {
  const docsReadme = join(root, "docs", "README.md");
  if (existsSync(docsReadme)) {
    const content = readFileSafe(docsReadme).toLowerCase();
    if (content.includes("default language: english")) return ["en", "zh-CN", "ja"];
    if (content.includes("default language: 中文") || content.includes("default language: chinese")) return ["zh-CN", "en", "ja"];
    if (content.includes("default language: japanese") || content.includes("default language: 日本")) return ["ja", "en", "zh-CN"];
  }
  return ["en", "zh-CN", "ja"];
}

function hasAnyProjectSpecFile(root: string): boolean {
  return existsSync(join(root, "PRD.md")) || existsSync(join(root, "requirements.md")) || existsSync(join(root, "hld.md"));
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function projectSpecArtifact(spec: FeatureSpec, artifactRoot: string): string {
  const specsDir = join(artifactRoot, "specs");
  mkdirSync(specsDir, { recursive: true, mode: 0o700 });
  const path = safeSpecArtifactPath(specsDir, spec.id);
  writeFileSync(path, `${JSON.stringify(spec, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return path;
}

export function specStateRelativePath(featureFolder: string): string {
  const safeFolder = sanitizeFeatureFolder(featureFolder);
  return `docs/features/${safeFolder}/spec-state.json`;
}

export function readFileSpecState(
  workspaceRoot: string,
  featureFolder: string,
  featureId: string,
  now: Date = new Date(),
): FileSpecState {
  const relativePath = specStateRelativePath(featureFolder);
  const fullPath = safeWorkspacePath(workspaceRoot, relativePath);
  if (!existsSync(fullPath)) {
    return createDefaultFileSpecState(featureId, now);
  }

  try {
    const parsed = JSON.parse(readFileSync(fullPath, "utf8")) as Partial<FileSpecState>;
    return normalizeFileSpecState(parsed, featureId, now);
  } catch {
    return {
      ...createDefaultFileSpecState(featureId, now),
      status: "blocked",
      blockedReasons: [`Spec state file is invalid JSON: ${relativePath}`],
      nextAction: "Fix spec-state.json before scheduling this Feature.",
    };
  }
}

export function writeFileSpecState(workspaceRoot: string, featureFolder: string, state: FileSpecState): string {
  const relativePath = specStateRelativePath(featureFolder);
  const fullPath = safeWorkspacePath(workspaceRoot, relativePath);
  mkdirSync(resolve(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return relativePath;
}

export function mergeFileSpecState(
  current: FileSpecState,
  patch: FileSpecStatePatch,
  input: { now?: Date; source: string; summary?: string; schedulerJobId?: string; executionId?: string },
): FileSpecState {
  const updatedAt = (input.now ?? new Date()).toISOString();
  const status = patch.status ?? current.status;
  const executionStatus = patch.executionStatus ?? current.executionStatus;
  return {
    ...current,
    ...patch,
    schemaVersion: 1,
    featureId: current.featureId,
    status,
    executionStatus,
    updatedAt,
    blockedReasons: patch.blockedReasons ?? current.blockedReasons,
    dependencies: patch.dependencies ?? current.dependencies,
    history: [
      ...current.history,
      {
        at: updatedAt,
        status,
        executionStatus,
        summary: input.summary ?? patch.lastResult?.summary ?? status,
        source: input.source,
        schedulerJobId: input.schedulerJobId,
        executionId: input.executionId,
      },
      ...(patch.history ?? []),
    ].slice(-50),
  };
}

export function skillOutputToSpecStatePatch(output: {
  status: "completed" | "review_needed" | "blocked" | "failed";
  summary: string;
  nextAction?: string;
  producedArtifacts: Array<{ path: string; kind: string; status: string; summary?: string }>;
}): FileSpecStatePatch {
  const status: FileSpecLifecycleStatus = output.status === "completed" ? "completed" : output.status;
  const executionStatus: FileSpecExecutionStatus | undefined = output.status === "review_needed" ? undefined : output.status;
  return {
    status,
    executionStatus,
    blockedReasons: output.status === "blocked" || output.status === "failed" ? [output.summary] : [],
    nextAction: output.nextAction ?? (output.status === "completed"
      ? "Run status checks and prepare review."
      : output.status === "review_needed"
        ? "Review Skill output and resolve the open decision."
        : "Resolve blocked reason and resume this Feature."),
    lastResult: {
      status,
      summary: output.summary,
      producedArtifacts: output.producedArtifacts,
      completedAt: new Date().toISOString(),
    },
  };
}

function safeSpecArtifactPath(specsDir: string, specId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(specId)) {
    throw new Error(`Invalid spec artifact id: ${specId}`);
  }

  const root = resolve(specsDir);
  const path = resolve(root, `${specId}.json`);
  if (path !== root && path.startsWith(`${root}${sep}`)) {
    return path;
  }
  throw new Error(`Spec artifact path escapes specs directory: ${specId}`);
}

function createDefaultFileSpecState(featureId: string, now: Date): FileSpecState {
  const updatedAt = now.toISOString();
  return {
    schemaVersion: 1,
    featureId,
    status: "ready",
    executionStatus: undefined,
    updatedAt,
    blockedReasons: [],
    dependencies: [],
    nextAction: "Ready for scheduler selection.",
    history: [{ at: updatedAt, status: "ready", summary: "Spec state initialized from Feature Spec files.", source: "spec-protocol" }],
  };
}

function normalizeFileSpecState(parsed: Partial<FileSpecState>, featureId: string, now: Date): FileSpecState {
  const fallback = createDefaultFileSpecState(featureId, now);
  return {
    schemaVersion: 1,
    featureId: typeof parsed.featureId === "string" && parsed.featureId ? parsed.featureId : featureId,
    status: isFileSpecLifecycleStatus(parsed.status) ? parsed.status : fallback.status,
    executionStatus: isFileSpecExecutionStatus(parsed.executionStatus) ? parsed.executionStatus : undefined,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : fallback.updatedAt,
    currentJob: parsed.currentJob && typeof parsed.currentJob === "object" ? parsed.currentJob : undefined,
    blockedReasons: Array.isArray(parsed.blockedReasons) ? parsed.blockedReasons.filter((item): item is string => typeof item === "string") : [],
    dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies.filter((item): item is string => typeof item === "string") : [],
    lastResult: parsed.lastResult && typeof parsed.lastResult === "object" ? parsed.lastResult : undefined,
    nextAction: typeof parsed.nextAction === "string" ? parsed.nextAction : fallback.nextAction,
    history: Array.isArray(parsed.history) ? parsed.history.filter(isFileSpecStateHistoryEntry).slice(-50) : fallback.history,
  };
}

function isFileSpecLifecycleStatus(value: unknown): value is FileSpecLifecycleStatus {
  return typeof value === "string" && [
    "draft",
    "ready",
    "queued",
    "running",
    "paused",
    "approval_needed",
    "blocked",
    "cancelled",
    "review_needed",
    "completed",
    "failed",
    "skipped",
    "delivered",
  ].includes(value);
}

function isFileSpecExecutionStatus(value: unknown): value is FileSpecExecutionStatus {
  return typeof value === "string" && [
    "queued",
    "running",
    "paused",
    "approval_needed",
    "blocked",
    "cancelled",
    "completed",
    "failed",
    "skipped",
  ].includes(value);
}

function isFileSpecStateHistoryEntry(value: unknown): value is FileSpecState["history"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.at === "string"
    && isFileSpecLifecycleStatus(record.status)
    && typeof record.summary === "string"
    && typeof record.source === "string";
}

function sanitizeFeatureFolder(featureFolder: string): string {
  const normalized = featureFolder.replaceAll("\\", "/").split("/").filter(Boolean).join("/");
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../") || normalized.startsWith("/")) {
    throw new Error(`Feature folder must stay inside docs/features: ${featureFolder}`);
  }
  return normalized;
}

function safeWorkspacePath(workspaceRoot: string, relativePath: string): string {
  if (!workspaceRoot) throw new Error("workspaceRoot is required.");
  const root = resolve(workspaceRoot);
  const fullPath = resolve(root, relativePath);
  if (fullPath === root || fullPath.startsWith(`${root}${sep}`)) {
    return fullPath;
  }
  throw new Error(`Path must stay inside workspace: ${relativePath}`);
}

function parseSources(rawInput: string, defaultType: InputSourceType): SourceContext[] {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line, index) => ({ text: cleanLine(line), lineNumber: index + 1 }))
    .filter((line) => line.text.length > 0);

  if (lines.length === 0) {
    return [
      {
        id: "SRC-001",
        type: defaultType,
        label: "empty input",
        text: "",
      },
    ];
  }

  return lines.map((line, index) => {
    const type = detectSourceType(line.text, defaultType);
    return {
      id: sourceId(index + 1),
      type,
      label: `${type} line ${line.lineNumber}`,
      text: stripKnownPrefix(line.text),
      lineNumber: line.lineNumber,
    };
  });
}

function parseSections(rawInput: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current = "";

  for (const line of rawInput.split(/\r?\n/)) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^#{1,6}\s+(.+)$|^([A-Za-z][A-Za-z -]+):\s*(.*)$/);
    if (heading?.[1]) {
      current = normalizeKey(heading[1]);
      sections.set(current, "");
    } else if (heading?.[2]) {
      current = normalizeKey(heading[2]);
      sections.set(current, heading[3]?.trim() ?? "");
    } else if (current && trimmed) {
      sections.set(current, `${sections.get(current) ?? ""}\n${trimmed}`.trim());
    }
  }

  return sections;
}

function firstValue(sections: Map<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = sections.get(normalizeKey(key));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseUserStories(featureId: string, sections: Map<string, string>, sources: SourceContext[]): UserStory[] {
  const source = sources.find((entry) => /as a|作为/.test(entry.text)) ?? sources[0];
  const storyText = firstValue(sections, ["user story", "user stories", "story"]) ?? source.text;
  const match = storyText.match(/as a\s+(.+?),?\s+i want\s+(.+?)(?:\s+so that\s+(.+))?$/i);
  const chineseMatch = storyText.match(/作为(.+?)[，,]\s*我希望(.+?)(?:[，,]\s*以便(.+))?$/);

  return [
    {
      id: `${featureId}-US-001`,
      role: match?.[1]?.trim() ?? chineseMatch?.[1]?.trim() ?? "user",
      goal: match?.[2]?.trim() ?? chineseMatch?.[2]?.trim() ?? storyText,
      benefit: match?.[3]?.trim() ?? chineseMatch?.[3]?.trim() ?? "the feature delivers the stated goal",
      source,
    },
  ];
}

function splitRequirementText(text: string): string[] {
  const stripped = stripKnownPrefix(cleanLine(text));
  if (!stripped) {
    return [];
  }

  const withoutHeading = stripped.replace(/^(requirements?|acceptance criteria|scenario|prd|pr|rp|ears)\s*:\s*/i, "");
  const pieces = withoutHeading
    .split(/(?:;\s+|\.\s+|\n+)/)
    .map((piece) => piece.trim())
    .filter(Boolean);

  return pieces.flatMap(splitCompoundBehavior).filter((piece) => looksLikeRequirement(piece));
}

function splitCompoundBehavior(text: string): string[] {
  const match = text.match(/^(.*?\b(?:shall|must|should|will|can|能够|必须|应当)\b\s+)(.+)$/i);
  if (!match) {
    return [text];
  }

  const prefix = match[1];
  const behavior = match[2];
  const pieces = behavior.split(/\s+(?:and|以及|并且)\s+(?=\w|[\u4e00-\u9fa5])/i).map((piece) => piece.trim());
  if (pieces.length <= 1) {
    return [text];
  }

  return pieces.map((piece) => `${prefix}${piece}`);
}

function normalizeEarsStatement(text: string): string {
  const trimmed = stripKnownPrefix(text).replace(/\.$/, "").trim();
  if (/^(when|while|where|if)\b.+\b(the system|system)\s+shall\b/i.test(trimmed)) {
    return `${upperFirst(trimmed)}.`;
  }
  if (/\b(the system|system)\s+shall\b/i.test(trimmed)) {
    return `${upperFirst(trimmed)}.`;
  }
  return `The system shall ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}.`;
}

function createAcceptanceCriteria(requirements: Requirement[]): AcceptanceCriteria[] {
  return requirements.map((requirement, index) => ({
    id: acceptanceCriteriaId(index + 1),
    requirementId: requirement.id,
    description: `Given ${requirement.source.label}, when the requirement is evaluated, then ${requirement.behavior.replace(/\.$/, "")}.`,
    source: requirement.source,
  }));
}

function createTestScenarios(requirements: Requirement[], acceptanceCriteria: AcceptanceCriteria[]): TestScenario[] {
  return requirements.map((requirement, index) => {
    const criteria = acceptanceCriteria.find((entry) => entry.requirementId === requirement.id);
    return {
      id: testScenarioId(index + 1),
      requirementId: requirement.id,
      acceptanceCriteriaId: criteria?.id ?? acceptanceCriteriaId(index + 1),
      title: `Validate ${requirement.id}`,
      steps: [`Use source ${requirement.source.id}.`, `Evaluate: ${requirement.statement}`],
      expectedResult: criteria?.description ?? requirement.behavior,
      source: requirement.source,
    };
  });
}

function createClarificationLog(sources: SourceContext[], now = new Date()): ClarificationLogEntry[] {
  const timestamp = now.toISOString();
  const entries: ClarificationLogEntry[] = [];

  for (const source of sources) {
    if (AMBIGUOUS_TERMS.test(source.text)) {
      entries.push({
        id: clarificationId(entries.length + 1),
        status: "open",
        question: `Ambiguous input requires clarification: ${source.text}`,
        source,
        impact: ["checklist.ambiguity", "feature.status"],
        recommendedAnswer: "Replace ambiguous wording with an observable condition and expected behavior.",
        owner: "product",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    if (CONFLICT_PATTERN.test(source.text)) {
      entries.push({
        id: clarificationId(entries.length + 1),
        status: "open",
        question: `Conflict requires clarification: ${source.text}`,
        source,
        impact: ["checklist.conflicts", "feature.status"],
        recommendedAnswer: "Choose the intended behavior and remove the conflicting statement.",
        owner: "product",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  return entries;
}

function bumpVersion(currentVersion: string, bump: SpecVersionBump): string {
  const [major = 0, minor = 0, patch = 0] = currentVersion.split(".").map((part) => Number(part));
  if ([major, minor, patch].some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid spec version: ${currentVersion}`);
  }

  if (bump === "MAJOR") {
    return `${major + 1}.0.0`;
  }
  if (bump === "MINOR") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function looksLikeRequirement(text: string): boolean {
  return /\b(shall|must|should|will|can|required|when|if|given|accept|validate|block|record|generate|create|return|write)\b|必须|应当|生成|记录|阻止|创建|返回/.test(
    text,
  );
}

function isAtomicBehavior(behavior: string): boolean {
  return !/\s+(?:and|as well as|以及|并且)\s+/i.test(behavior);
}

function isObservableBehavior(behavior: string): boolean {
  return /\b(create|return|write|record|generate|block|prevent|include|map|trace|emit|update|validate|fail|pass|show|read)\b|创建|返回|写入|记录|生成|阻止|包含|映射|追踪|验证/.test(
    behavior,
  );
}

function parseList(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => stripKnownPrefix(entry).trim())
    .filter(Boolean);
}

function firstNonEmptyLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => stripKnownPrefix(line).trim())
    .find(Boolean);
}

function detectSourceType(text: string, defaultType: InputSourceType): InputSourceType {
  const typeMatch = text.match(/^\s*(PRD|EARS|PR|RP)\s*:/i);
  return typeMatch ? (typeMatch[1].toUpperCase() as InputSourceType) : defaultType;
}

function cleanLine(line: string): string {
  return line.trim().replace(/^[-*]\s+\[[ xX]\]\s+/, "").replace(/^[-*]\s+/, "").trim();
}

function stripKnownPrefix(text: string): string {
  return text
    .trim()
    .replace(/^(PRD|EARS|PR|RP|Requirement|Acceptance Criteria|Scenario)\s*:\s*/i, "")
    .replace(/^REQ-\d+\s*:\s*/i, "")
    .trim();
}

function normalizeKey(value: string): string {
  return value.toLowerCase().trim();
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sourceId(index: number): string {
  return `SRC-${String(index).padStart(3, "0")}`;
}

function requirementId(index: number): string {
  return `REQ-${String(index).padStart(3, "0")}`;
}

function acceptanceCriteriaId(index: number): string {
  return `AC-${String(index).padStart(3, "0")}`;
}

function testScenarioId(index: number): string {
  return `TS-${String(index).padStart(3, "0")}`;
}

function clarificationId(index: number): string {
  return `CLAR-${String(index).padStart(3, "0")}`;
}

function missingItemId(index: number): string {
  return `MISS-${String(index).padStart(3, "0")}`;
}

function conflictId(index: number): string {
  return `CONF-${String(index).padStart(3, "0")}`;
}

function scanClarId(index: number): string {
  return `SCAN-CLAR-${String(index).padStart(3, "0")}`;
}

function scanSpecFile(absPath: string, relativePath: string, fileType: SpecSourceFileType): SpecSourceScanResult {
  if (!existsSync(absPath)) {
    return { path: absPath, relativePath, fileType, traceIds: [], hasAmbiguousContent: false, hasConflictContent: false, exists: false };
  }
  let content = "";
  try {
    content = readFileSync(absPath, "utf8");
  } catch {
    return { path: absPath, relativePath, fileType, traceIds: [], hasAmbiguousContent: false, hasConflictContent: false, exists: false };
  }
  return {
    path: absPath,
    relativePath,
    fileType,
    traceIds: extractTraceIds(content),
    version: extractVersion(content),
    hasAmbiguousContent: AMBIGUOUS_TERMS.test(content),
    hasConflictContent: CONFLICT_PATTERN.test(content),
    exists: true,
  };
}

export function extractVersion(content: string): string | undefined {
  const versionPatterns = [
    /^(?:版本|Version)\s*[：:]\s*(.+)$/im,
    /^(?:Spec 版本|Spec Version)\s*[：:]\s*(.+)$/im,
    /^(?:版本号|Version ID)\s*[：:]\s*(.+)$/im,
  ];

  for (const pattern of versionPatterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function extractTraceIds(content: string): string[] {
  const matches = content.match(/\b(REQ|NFR|EDGE|FEAT|TASK|AC|TS)-\d+\b/g) ?? [];
  return [...new Set(matches)].sort();
}

function detectOrphanedTraceability(
  sources: SpecSourceScanResult[],
  missingItems: SpecMissingItem[],
  clarificationItems: SpecSourceClarificationItem[],
): void {
  const earsSources = sources.filter((s) => s.fileType === "EARS");
  const featureReqSources = sources.filter((s) => s.fileType === "feature-requirements");

  const allEarsReqIds = new Set(earsSources.flatMap((s) => s.traceIds.filter((id) => id.startsWith("REQ-"))));
  const allFeatureReqIds = new Set(featureReqSources.flatMap((s) => s.traceIds.filter((id) => id.startsWith("REQ-"))));

  for (const reqId of allEarsReqIds) {
    if (!allFeatureReqIds.has(reqId)) {
      missingItems.push({
        id: missingItemId(missingItems.length + 1),
        kind: "orphaned_traceability",
        relatedPath: "docs/features/",
        description: `${reqId} appears in EARS requirements but is not referenced by any Feature Spec`,
      });
      clarificationItems.push({
        id: scanClarId(clarificationItems.length + 1),
        sourcePath: "docs/features/",
        description: `${reqId} is not yet assigned to a Feature Spec`,
        type: "orphaned",
      });
    }
  }
}

function generateClarificationsFromScan(
  summary: SpecSourceScanSummary,
  now = new Date(),
): ClarificationLogEntry[] {
  const timestamp = now.toISOString();
  return summary.clarificationItems.map((item, index) => ({
    id: clarificationId(100 + index + 1),
    status: "open" as const,
    question: item.description,
    source: {
      id: `SCAN-SRC-${String(index + 1).padStart(3, "0")}`,
      type: "mixed" as const,
      label: item.sourcePath,
      text: item.description,
    },
    impact: [item.type === "conflict" ? "checklist.conflicts" : "checklist.ambiguity", "feature.status"],
    recommendedAnswer: item.type === "missing"
      ? "Create the missing artifact before proceeding with task slicing."
      : item.type === "orphaned"
      ? "Assign this requirement to an existing or new Feature Spec."
      : "Resolve the ambiguity or conflict before promoting to ready.",
    owner: "product",
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}
