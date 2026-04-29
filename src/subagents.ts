import { randomUUID } from "node:crypto";
import { runSqlite, type SqlStatement } from "./sqlite.ts";
import type { BoardColumn, RiskLevel } from "./orchestration.ts";
import type { TestEnvironmentIsolationRecord, WorktreeRecord } from "./workspace.ts";

export type AgentType =
  | "spec"
  | "clarification"
  | "repo_probe"
  | "architecture"
  | "task"
  | "coding"
  | "test"
  | "review"
  | "recovery"
  | "state";

export type RunMode = "read" | "write";
export type SubagentRunStatus = "created" | "context_ready" | "running" | "completed" | "review_needed" | "failed";
export type ContextSourceKind = "spec_slice" | "memory_summary" | "file_fragment" | "evidence";
export type ResultAction = "continue" | "checking" | "review_needed" | "blocked" | "failed" | "done";

export type AgentRunContract = {
  id: string;
  runId: string;
  agentType: AgentType;
  taskId: string;
  goal: string;
  allowedFiles: string[];
  readOnlyFiles: string[];
  prohibitedActions: string[];
  acceptanceCriteria: string[];
  outputSchema: Record<string, unknown>;
  workspace?: Pick<WorktreeRecord, "id" | "path" | "branch" | "baseCommit" | "targetBranch" | "featureId" | "taskId">;
  testEnvironmentIsolation?: Pick<
    TestEnvironmentIsolationRecord,
    "id" | "environmentId" | "environmentType" | "runnerInput" | "evidencePackMetadata"
  >;
  immutable: true;
  createdAt: string;
};

export type SubagentRun = {
  id: string;
  featureId: string;
  taskId: string;
  agentType: AgentType;
  mode: RunMode;
  status: SubagentRunStatus;
  contract: AgentRunContract;
  contextSlice?: ContextSlice;
  tokenUsage?: TokenUsage;
  createdAt: string;
};

export type ContextSliceRef = {
  kind: ContextSourceKind;
  sourceId: string;
  label: string;
  checksum?: string;
};

export type ContextSlice = {
  id: string;
  runId: string;
  refs: ContextSliceRef[];
  specSlices: ContextItem[];
  memorySummaries: ContextItem[];
  fileFragments: FileFragment[];
  evidence: ContextItem[];
  tokenEstimate: number;
  createdAt: string;
};

export type ContextItem = {
  id: string;
  title: string;
  content: string;
};

export type FileFragment = ContextItem & {
  path: string;
  startLine?: number;
  endLine?: number;
  access: "allowed" | "read_only";
};

export type ContextBrokerInput = {
  contract: AgentRunContract;
  specSlices?: ContextItem[];
  memorySummaries?: ContextItem[];
  fileFragments?: FileFragment[];
  evidence?: ContextItem[];
  now?: Date;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type SubagentEvent = {
  id: string;
  runId: string;
  status: SubagentRunStatus;
  message: string;
  evidence?: string;
  tokenUsage?: TokenUsage;
  createdAt: string;
};

export type CreateSubagentRunInput = {
  featureId: string;
  taskId: string;
  title: string;
  goal: string;
  responsibility?: string;
  requiredSkill?: string;
  mode: RunMode;
  allowedFiles?: string[];
  readOnlyFiles?: string[];
  prohibitedActions?: string[];
  acceptanceCriteria?: string[];
  outputSchema?: Record<string, unknown>;
  workspace?: WorktreeRecord;
  testEnvironmentIsolation?: TestEnvironmentIsolationRecord;
  now?: Date;
};

export type BoundaryObservation = {
  readFiles?: string[];
  diffFiles?: string[];
  events?: SubagentEvent[];
};

export type BoundaryEvaluation = {
  status: "passed" | "review_needed";
  unauthorizedReads: string[];
  unauthorizedDiffs: string[];
  evidence: string;
};

export type SubagentResult = {
  runId: string;
  agentType: AgentType;
  status: "completed" | "review_needed" | "blocked" | "failed";
  summary: string;
  outputs?: string[];
  changedFiles?: string[];
  risks?: Array<{ level: RiskLevel; message: string }>;
  confidence?: number;
  nextAction?: ResultAction;
};

export type ResultMerge = {
  id: string;
  runIds: string[];
  outputs: string[];
  conflicts: string[];
  risks: Array<{ level: RiskLevel; message: string }>;
  credibility: "low" | "medium" | "high";
  nextAction: ResultAction;
  boardStatus: BoardColumn;
  evidence: string;
  createdAt: string;
};

const AGENT_TYPES: AgentType[] = [
  "spec",
  "clarification",
  "repo_probe",
  "architecture",
  "task",
  "coding",
  "test",
  "review",
  "recovery",
  "state",
];

const READ_ONLY_AGENT_TYPES = new Set<AgentType>(["spec", "clarification", "repo_probe", "architecture", "task", "review"]);
const DEFAULT_PROHIBITED_ACTIONS = [
  "read_full_main_context",
  "write_outside_allowed_files",
  "modify_read_only_files",
  "delete_workspace",
  "push_without_owner_approval",
];

export function selectAgentType(input: Pick<CreateSubagentRunInput, "responsibility" | "requiredSkill" | "title" | "mode">): AgentType {
  const text = `${input.responsibility ?? ""} ${input.requiredSkill ?? ""} ${input.title}`.toLowerCase();
  if (/\bclarif|question|ambigu/.test(text)) return "clarification";
  if (/\brepo|probe|inspect|discover|search/.test(text)) return "repo_probe";
  if (/\barch|design|hld|lld|adr/.test(text)) return "architecture";
  if (/\bspec|requirement|ears|prd|pr\b/.test(text)) return "spec";
  if (/\btest|verify|qa|acceptance/.test(text)) return "test";
  if (/\breview|diff|audit/.test(text)) return "review";
  if (/\brecover|rollback|retry/.test(text)) return "recovery";
  if (/\bstate|transition|board|status/.test(text)) return "state";
  if (/\btask|slice|plan/.test(text)) return "task";
  return input.mode === "write" ? "coding" : "repo_probe";
}

export function createSubagentRun(input: CreateSubagentRunInput): SubagentRun {
  const now = input.now ?? new Date();
  const agentType = selectAgentType(input);
  assertAgentType(agentType);
  if (input.mode === "write" && !input.workspace) {
    throw new Error("Write Subagent Run requires an allocated workspace before contract creation.");
  }

  const runId = randomUUID();
  const contract: AgentRunContract = {
    id: randomUUID(),
    runId,
    agentType,
    taskId: input.taskId,
    goal: input.goal,
    allowedFiles: normalizeUnique(input.allowedFiles ?? []),
    readOnlyFiles: normalizeUnique(input.readOnlyFiles ?? []),
    prohibitedActions: normalizeUnique([...(input.prohibitedActions ?? []), ...DEFAULT_PROHIBITED_ACTIONS]),
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    outputSchema: input.outputSchema ?? defaultOutputSchema(agentType),
    workspace: input.workspace
      ? {
          id: input.workspace.id,
          path: input.workspace.path,
          branch: input.workspace.branch,
          baseCommit: input.workspace.baseCommit,
          targetBranch: input.workspace.targetBranch,
          featureId: input.workspace.featureId,
          taskId: input.workspace.taskId,
        }
      : undefined,
    testEnvironmentIsolation: input.testEnvironmentIsolation
      ? {
          id: input.testEnvironmentIsolation.id,
          environmentId: input.testEnvironmentIsolation.environmentId,
          environmentType: input.testEnvironmentIsolation.environmentType,
          runnerInput: input.testEnvironmentIsolation.runnerInput,
          evidencePackMetadata: input.testEnvironmentIsolation.evidencePackMetadata,
        }
      : undefined,
    immutable: true,
    createdAt: now.toISOString(),
  };

  return {
    id: runId,
    featureId: input.featureId,
    taskId: input.taskId,
    agentType,
    mode: input.mode,
    status: "created",
    contract,
    createdAt: now.toISOString(),
  };
}

export function buildContextSlice(input: ContextBrokerInput): ContextSlice {
  const now = input.now ?? new Date();
  const allowedFiles = new Set(input.contract.allowedFiles.map(normalizePath));
  const readOnlyFiles = new Set(input.contract.readOnlyFiles.map(normalizePath));
  const fileFragments = (input.fileFragments ?? [])
    .map((fragment) => ({ ...fragment, path: normalizePath(fragment.path) }))
    .filter((fragment) => allowedFiles.has(fragment.path) || readOnlyFiles.has(fragment.path))
    .map((fragment) => ({
      ...fragment,
      access: allowedFiles.has(fragment.path) ? "allowed" as const : "read_only" as const,
    }));

  const refs: ContextSliceRef[] = [
    ...(input.specSlices ?? []).map((item) => ref("spec_slice", item)),
    ...(input.memorySummaries ?? []).map((item) => ref("memory_summary", item)),
    ...fileFragments.map((item) => ({ ...ref("file_fragment", item), label: item.path })),
    ...(input.evidence ?? []).map((item) => ref("evidence", item)),
  ];

  return {
    id: randomUUID(),
    runId: input.contract.runId,
    refs,
    specSlices: input.specSlices ?? [],
    memorySummaries: input.memorySummaries ?? [],
    fileFragments,
    evidence: input.evidence ?? [],
    tokenEstimate: estimateTokens([
      ...(input.specSlices ?? []),
      ...(input.memorySummaries ?? []),
      ...fileFragments,
      ...(input.evidence ?? []),
    ]),
    createdAt: now.toISOString(),
  };
}

export function ensureReadOnlyConcurrency(runs: SubagentRun[]): { allowed: boolean; evidence: string } {
  const writeRuns = runs.filter((run) => run.mode === "write" || !READ_ONLY_AGENT_TYPES.has(run.agentType));
  const sharedWorkspaceWrites = writeRuns.filter((run) => !run.contract.workspace);
  if (writeRuns.length === 0) {
    return { allowed: true, evidence: "All concurrent Subagent Runs are read-only and have no shared workspace writes." };
  }
  if (sharedWorkspaceWrites.length > 0) {
    return {
      allowed: false,
      evidence: `Concurrent execution blocked: ${sharedWorkspaceWrites.map((run) => run.id).join(", ")} can write without workspace isolation.`,
    };
  }
  return { allowed: true, evidence: "Concurrent write-capable Subagent Runs are isolated by workspace contracts." };
}

export function evaluateContractBoundary(contract: AgentRunContract, observation: BoundaryObservation): BoundaryEvaluation {
  const allowedReadFiles = new Set([...contract.allowedFiles, ...contract.readOnlyFiles].map(normalizePath));
  const allowedDiffFiles = new Set(contract.allowedFiles.map(normalizePath));
  const unauthorizedReads = normalizeUnique(observation.readFiles ?? []).filter((file) => !allowedReadFiles.has(file));
  const unauthorizedDiffs = normalizeUnique(observation.diffFiles ?? []).filter((file) => !allowedDiffFiles.has(file));
  const status = unauthorizedReads.length === 0 && unauthorizedDiffs.length === 0 ? "passed" : "review_needed";

  return {
    status,
    unauthorizedReads,
    unauthorizedDiffs,
    evidence:
      status === "passed"
        ? "Observed file access and diff stayed inside Agent Run Contract boundaries."
        : `Contract boundary violation: reads=${unauthorizedReads.join(",") || "none"} diffs=${unauthorizedDiffs.join(",") || "none"}.`,
  };
}

export function recordSubagentEvent(input: Omit<SubagentEvent, "id" | "createdAt"> & { now?: Date }): SubagentEvent {
  return {
    id: randomUUID(),
    runId: input.runId,
    status: input.status,
    message: input.message,
    evidence: input.evidence,
    tokenUsage: input.tokenUsage,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export function mergeSubagentResults(results: SubagentResult[], now: Date = new Date()): ResultMerge {
  const outputs = unique(results.flatMap((result) => result.outputs ?? [result.summary]));
  const risks = results.flatMap((result) => result.risks ?? []);
  const conflicts = detectResultConflicts(results);
  const terminalFailure = results.find((result) => result.status === "failed" || result.status === "blocked");
  const reviewRequested = results.some((result) => result.status === "review_needed" || result.nextAction === "review_needed");
  const highRisk = risks.some((risk) => risk.level === "high");
  const credibility = classifyCredibility(results);
  const nextAction: ResultAction = terminalFailure
    ? terminalFailure.status
    : conflicts.length > 0 || reviewRequested || highRisk || credibility === "low"
      ? "review_needed"
      : "checking";

  return {
    id: randomUUID(),
    runIds: results.map((result) => result.runId),
    outputs,
    conflicts,
    risks: uniqueRiskEntries(risks),
    credibility,
    nextAction,
    boardStatus: mapActionToBoard(nextAction),
    evidence: [
      conflicts.length > 0 ? `conflicts=${conflicts.join("; ")}` : "conflicts=none",
      `credibility=${credibility}`,
      `runs=${results.length}`,
    ].join(" | "),
    createdAt: now.toISOString(),
  };
}

export function persistSubagentRunArtifacts(
  dbPath: string,
  input: {
    run: SubagentRun;
    contextSlice?: ContextSlice;
    events?: SubagentEvent[];
    merge?: ResultMerge;
  },
): void {
  const statements: SqlStatement[] = [
    {
      sql: `INSERT INTO runs (id, task_id, feature_id, status, started_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, metadata_json = excluded.metadata_json`,
      params: [
        input.run.id,
        input.run.taskId,
        input.run.featureId,
        input.run.status,
        input.run.createdAt,
        JSON.stringify({ agentType: input.run.agentType, mode: input.run.mode }),
      ],
    },
    {
      sql: `INSERT INTO agent_run_contracts (id, run_id, contract_json, created_at)
        VALUES (?, ?, ?, ?)`,
      params: [input.run.contract.id, input.run.id, JSON.stringify(input.run.contract), input.run.contract.createdAt],
    },
  ];

  if (input.contextSlice) {
    statements.push({
      sql: `INSERT INTO context_slice_refs (id, run_id, refs_json, token_estimate, created_at)
        VALUES (?, ?, ?, ?, ?)`,
      params: [
        input.contextSlice.id,
        input.run.id,
        JSON.stringify(input.contextSlice.refs),
        input.contextSlice.tokenEstimate,
        input.contextSlice.createdAt,
      ],
    });
  }

  for (const event of input.events ?? []) {
    statements.push({
      sql: `INSERT INTO subagent_events (id, run_id, status, message, evidence, token_usage_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        event.id,
        event.runId,
        event.status,
        event.message,
        event.evidence ?? null,
        JSON.stringify(event.tokenUsage ?? {}),
        event.createdAt,
      ],
    });
  }

  if (input.merge) {
    statements.push({
      sql: `INSERT INTO result_merges (
        id, run_ids_json, outputs_json, conflicts_json, risks_json, credibility,
        next_action, board_status, evidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        input.merge.id,
        JSON.stringify(input.merge.runIds),
        JSON.stringify(input.merge.outputs),
        JSON.stringify(input.merge.conflicts),
        JSON.stringify(input.merge.risks),
        input.merge.credibility,
        input.merge.nextAction,
        input.merge.boardStatus,
        input.merge.evidence,
        input.merge.createdAt,
      ],
    });
  }

  runSqlite(dbPath, statements);
}

function assertAgentType(agentType: AgentType): void {
  if (!AGENT_TYPES.includes(agentType)) {
    throw new Error(`Unsupported agent_type: ${agentType}`);
  }
}

function defaultOutputSchema(agentType: AgentType): Record<string, unknown> {
  return {
    type: "object",
    required: ["summary", "status", "evidence"],
    properties: {
      agentType: { const: agentType },
      status: { enum: ["completed", "review_needed", "blocked", "failed"] },
      summary: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
      risks: { type: "array" },
      nextAction: { type: "string" },
    },
  };
}

function detectResultConflicts(results: SubagentResult[]): string[] {
  const byFile = new Map<string, Set<string>>();
  for (const result of results) {
    for (const file of result.changedFiles ?? []) {
      const normalized = normalizePath(file);
      const runs = byFile.get(normalized) ?? new Set<string>();
      runs.add(result.runId);
      byFile.set(normalized, runs);
    }
  }
  return [...byFile.entries()]
    .filter(([, runs]) => runs.size > 1)
    .map(([file, runs]) => `${file} changed by ${[...runs].join(",")}`)
    .sort();
}

function classifyCredibility(results: SubagentResult[]): ResultMerge["credibility"] {
  if (results.length === 0) return "low";
  const confidence = results.reduce((sum, result) => sum + (result.confidence ?? 0.5), 0) / results.length;
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

function mapActionToBoard(action: ResultAction): BoardColumn {
  const map: Record<ResultAction, BoardColumn> = {
    continue: "running",
    checking: "checking",
    review_needed: "review_needed",
    blocked: "blocked",
    failed: "failed",
    done: "done",
  };
  return map[action];
}

function ref(kind: ContextSourceKind, item: ContextItem): ContextSliceRef {
  return {
    kind,
    sourceId: item.id,
    label: item.title,
    checksum: checksum(item.content),
  };
}

function estimateTokens(items: ContextItem[]): number {
  return Math.ceil(items.reduce((sum, item) => sum + item.content.length, 0) / 4);
}

function checksum(content: string): string {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash * 31 + content.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeUnique(values: string[]): string[] {
  return unique(values.map(normalizePath).filter(Boolean));
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueRiskEntries(risks: Array<{ level: RiskLevel; message: string }>): Array<{ level: RiskLevel; message: string }> {
  const keyed = new Map<string, { level: RiskLevel; message: string }>();
  for (const risk of risks) {
    keyed.set(`${risk.level}:${risk.message}`, risk);
  }
  return [...keyed.values()];
}
