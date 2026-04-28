import { createHash, randomUUID, type BinaryLike } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { recordAuditEvent, recordMetricSample, sanitizeForOrdinaryLog } from "./persistence.ts";
import { createReviewItem, type ReviewTrigger } from "./review-center.ts";
import { runSqlite, type SqlStatement } from "./sqlite.ts";

export type StatusDecision = "done" | "ready" | "scheduled" | "review_needed" | "blocked" | "failed";
export type CommandCheckKind =
  | "build"
  | "unit_test"
  | "integration_test"
  | "typecheck"
  | "lint"
  | "security_scan"
  | "secret_scan"
  | "custom";
export type CommandCheckStatus = "passed" | "failed" | "skipped" | "not_run";
export type RunnerTerminalStatus = "completed" | "ready" | "scheduled" | "review_needed" | "blocked" | "failed";

export type CommandCheckResult = {
  kind: CommandCheckKind;
  command?: string;
  status: CommandCheckStatus;
  summary?: string;
  exitCode?: number | null;
  durationMs?: number;
};

export type DiffSummary = {
  summary?: string;
  files?: string[];
  patch?: string;
};

export type RunnerStatusInput = {
  status?: RunnerTerminalStatus;
  exitCode?: number | null;
  summary?: string;
  stdout?: string;
  stderr?: string;
  evidence?: unknown;
};

export type SpecAlignmentInput = {
  taskId?: string;
  userStoryIds?: string[];
  requirementIds?: string[];
  acceptanceCriteriaIds?: string[];
  coveredRequirementIds?: string[];
  testCoverage?: boolean;
  changedFiles?: string[];
  allowedFiles?: string[];
  forbiddenFiles?: string[];
  notes?: string[];
};

export type SpecAlignmentResult = {
  id: string;
  runId: string;
  taskId?: string;
  featureId?: string;
  aligned: boolean;
  reasons: string[];
  missingTraceability: string[];
  forbiddenFiles: string[];
  unauthorizedFiles: string[];
  coverageGaps: string[];
};

export type EvidenceAttachmentRef = {
  id?: string;
  kind: string;
  path: string;
  description?: string;
  checksum?: string;
};

export type EvidencePack = {
  id: string;
  runId: string;
  agentType: string;
  taskId?: string;
  featureId?: string;
  projectId?: string;
  status: StatusDecision;
  summary: string;
  reasons: string[];
  recommendedActions: string[];
  runner: RunnerStatusInput;
  diff: DiffInspectionResult;
  commands: CommandCheckResult[];
  specAlignment: SpecAlignmentResult;
  attachments: EvidenceAttachmentRef[];
  evidenceWriteMs: number;
  evidenceWriteError?: string;
  createdAt: string;
};

export type StatusCheckResult = {
  id: string;
  runId: string;
  taskId?: string;
  featureId?: string;
  projectId?: string;
  status: StatusDecision;
  summary: string;
  reasons: string[];
  recommendedActions: string[];
  evidencePack: EvidencePack;
  evidencePath?: string;
  evidenceWriteMs: number;
  evidenceWriteError?: string;
  specAlignment: SpecAlignmentResult;
};

export type StatusCheckerInput = {
  runId: string;
  agentType: string;
  taskId?: string;
  featureId?: string;
  projectId?: string;
  workspaceRoot?: string;
  artifactRoot?: string;
  dbPath?: string;
  runner?: RunnerStatusInput;
  diff?: DiffSummary;
  commandChecks?: CommandCheckResult[];
  requiredCommandChecks?: CommandCheckKind[];
  specAlignment?: SpecAlignmentInput;
  allowedFiles?: string[];
  forbiddenFiles?: string[];
  failureHistory?: Array<StatusDecision | RunnerTerminalStatus | CommandCheckStatus>;
  failureThreshold?: number;
  attachments?: EvidenceAttachmentRef[];
  now?: Date;
  writeEvidence?: (path: string, content: string) => void;
};

export type DiffInspectionResult = {
  summary: string;
  files: string[];
  riskFiles: string[];
  unauthorizedFiles: string[];
  forbiddenFiles: string[];
  secretFindings: string[];
  diffThresholdExceeded: boolean;
};

const DEFAULT_FAILURE_THRESHOLD = 3;
const DIFF_PATCH_REVIEW_THRESHOLD_LINES = 400;
const RISK_FILE_PATTERNS = [
  /(^|\/)\.env($|\.)/,
  /(^|\/)secrets?\//i,
  /(^|\/)credentials?\//i,
  /(^|\/)auth/i,
  /(^|\/)permission/i,
  /(^|\/)payment/i,
  /migration/i,
  /schema/i,
];
const SECRET_PATTERNS = [
  { label: "token", pattern: /\btoken\s*[:=]\s*[^,\s]+/gi },
  { label: "password", pattern: /\bpassword\s*[:=]\s*[^,\s]+/gi },
  { label: "secret", pattern: /\bsecret\s*[:=]\s*[^,\s]+/gi },
  { label: "api_key", pattern: /\bapi[_-]?key\s*[:=]\s*[^,\s]+/gi },
  { label: "connection_string", pattern: /\b(?:postgres|mysql|sqlite):\/\/[^\s]+/gi },
];

export function runStatusCheck(input: StatusCheckerInput): StatusCheckResult {
  const now = input.now ?? new Date();
  const resultId = randomUUID();
  const evidencePackId = randomUUID();
  const effectiveTaskId = input.taskId ?? input.specAlignment?.taskId;
  const normalizedInput = { ...input, taskId: effectiveTaskId, attachments: resolveAttachmentRefs(input) };
  const diff = inspectDiff({
    diff: input.diff,
    allowedFiles: mergeFileRules(input.allowedFiles, input.specAlignment?.allowedFiles),
    forbiddenFiles: mergeFileRules(input.forbiddenFiles, input.specAlignment?.forbiddenFiles),
    runner: input.runner,
  });
  const specAlignment = evaluateSpecAlignment({
    runId: input.runId,
    taskId: effectiveTaskId,
    featureId: input.featureId,
    diff,
    input: input.specAlignment,
    allowedFiles: input.allowedFiles,
    forbiddenFiles: input.forbiddenFiles,
  });
  const decision = decideStatus({
    runner: input.runner,
    commands: input.commandChecks ?? [],
    requiredCommands: input.requiredCommandChecks ?? [],
    diff,
    specAlignment,
    failureHistory: input.failureHistory ?? [],
    failureThreshold: input.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD,
  });
  const baseEvidencePack = buildEvidencePack({
    id: evidencePackId,
    input: normalizedInput,
    status: decision.status,
    summary: decision.summary,
    reasons: decision.reasons,
    recommendedActions: decision.recommendedActions,
    diff,
    specAlignment,
    createdAt: now.toISOString(),
  });

  const writeResult = writeEvidencePack(input, baseEvidencePack);
  const evidenceWriteMs = input.writeEvidence && !writeResult.error ? 0 : writeResult.durationMs;
  const finalStatus = writeResult.error ? evidenceWriteFailureStatus(decision.status) : decision.status;
  const finalSummary = writeResult.error
    ? "Status check blocked because evidence could not be written."
    : decision.summary;
  const finalReasons = writeResult.error
    ? [...decision.reasons, `Evidence write failed: ${writeResult.error}`]
    : decision.reasons;
  const finalActions = writeResult.error
    ? ["Inspect evidence storage configuration and retry the status check.", ...decision.recommendedActions]
    : decision.recommendedActions;
  const evidencePack: EvidencePack = {
    ...baseEvidencePack,
    status: finalStatus,
    summary: finalSummary,
    reasons: finalReasons,
    recommendedActions: finalActions,
    evidenceWriteMs,
    evidenceWriteError: writeResult.error,
  };

  if (!writeResult.error && !input.writeEvidence) {
    rewriteEvidencePack(input, evidencePack, writeResult.path);
  }

  let result: StatusCheckResult = {
    id: resultId,
    runId: input.runId,
    taskId: effectiveTaskId,
    featureId: input.featureId,
    projectId: input.projectId,
    status: finalStatus,
    summary: finalSummary,
    reasons: finalReasons,
    recommendedActions: finalActions,
    evidencePack,
    evidencePath: writeResult.path,
    evidenceWriteMs,
    evidenceWriteError: writeResult.error,
    specAlignment,
  };

  if (input.dbPath) {
    try {
      persistStatusCheck(input.dbPath, result, writeResult.path, normalizedInput);
    } catch (error) {
      result = persistenceFailureResult(result, error);
      if (!input.writeEvidence) {
        rewriteEvidencePack(input, result.evidencePack, writeResult.path);
      }
    }
  }

  return result;
}

export function evaluateSpecAlignment(input: {
  runId: string;
  taskId?: string;
  featureId?: string;
  diff: DiffInspectionResult;
  input?: SpecAlignmentInput;
  allowedFiles?: string[];
  forbiddenFiles?: string[];
}): SpecAlignmentResult {
  const missingTraceability: string[] = [];
  const coverageGaps: string[] = [];
  const alignment = input.input;
  const changedFiles = unique([...(alignment?.changedFiles ?? []), ...input.diff.files]);
  const forbiddenFiles = unique([...(alignment?.forbiddenFiles ?? []), ...input.diff.forbiddenFiles]);
  const unauthorizedFiles = unique(input.diff.unauthorizedFiles);

  if (!alignment?.taskId && !input.taskId) missingTraceability.push("task");
  if (!alignment?.userStoryIds?.length) missingTraceability.push("user_story");
  if (!alignment?.requirementIds?.length) missingTraceability.push("requirement");
  if (!alignment?.acceptanceCriteriaIds?.length) missingTraceability.push("acceptance_criteria");
  if (alignment?.testCoverage !== true) coverageGaps.push("test_coverage");
  for (const requirementId of alignment?.requirementIds ?? []) {
    if (!(alignment.coveredRequirementIds ?? []).includes(requirementId)) {
      coverageGaps.push(`requirement:${requirementId}`);
    }
  }
  if (changedFiles.length > 0 && alignment?.testCoverage !== true) {
    coverageGaps.push("changed_files_without_confirmed_tests");
  }

  const reasons = [
    ...missingTraceability.map((item) => `Missing ${item} traceability.`),
    ...coverageGaps.map((item) => `Missing or incomplete coverage for ${item}.`),
    ...forbiddenFiles.map((file) => `Forbidden file changed: ${file}.`),
    ...unauthorizedFiles.map((file) => `Unauthorized file changed: ${file}.`),
    ...(alignment?.notes ?? []),
  ];

  return {
    id: randomUUID(),
    runId: input.runId,
    taskId: input.taskId,
    featureId: input.featureId,
    aligned: reasons.length === 0,
    reasons,
    missingTraceability: unique(missingTraceability),
    forbiddenFiles,
    unauthorizedFiles,
    coverageGaps: unique(coverageGaps),
  };
}

export function listEvidencePacks(dbPath: string, input: { runId?: string; taskId?: string; featureId?: string } = {}): EvidencePack[] {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (input.runId) {
    filters.push("run_id = ?");
    params.push(input.runId);
  }
  if (input.taskId) {
    filters.push("task_id = ?");
    params.push(input.taskId);
  }
  if (input.featureId) {
    filters.push("feature_id = ?");
    params.push(input.featureId);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const rows = runSqlite(dbPath, [], [
    {
      name: "evidence",
      sql: `SELECT * FROM evidence_packs ${where} ORDER BY created_at DESC, rowid DESC`,
      params,
    },
  ]).queries.evidence;

  return rows.map((row) => {
    const metadata = parseJsonObject(row.metadata_json);
    return metadata.statusCheckerEvidencePack as EvidencePack;
  }).filter(Boolean);
}

export function listStatusCheckResults(dbPath: string, runId: string): StatusCheckResult[] {
  const rows = runSqlite(dbPath, [], [
    {
      name: "results",
      sql: "SELECT * FROM status_check_results WHERE run_id = ? ORDER BY created_at DESC, rowid DESC",
      params: [runId],
    },
  ]).queries.results;

  return rows.map((row) => ({
    id: String(row.id),
    runId: String(row.run_id),
    taskId: nullableString(row.task_id),
    featureId: nullableString(row.feature_id),
    projectId: nullableString(row.project_id),
    status: String(row.status) as StatusDecision,
    summary: String(row.summary),
    reasons: parseJsonStringArray(row.reasons_json),
    recommendedActions: parseJsonStringArray(row.recommended_actions_json),
    evidencePack: getEvidencePackById(dbPath, nullableString(row.evidence_pack_id)),
    evidencePath: nullableString(row.evidence_path),
    evidenceWriteMs: Number(row.evidence_write_ms),
    evidenceWriteError: nullableString(row.evidence_write_error),
    specAlignment: getSpecAlignmentResultById(dbPath, nullableString(row.spec_alignment_result_id)),
  }));
}

export function listSpecAlignmentResults(dbPath: string, runId: string): SpecAlignmentResult[] {
  const rows = runSqlite(dbPath, [], [
    {
      name: "alignments",
      sql: "SELECT * FROM spec_alignment_results WHERE run_id = ? ORDER BY created_at DESC, rowid DESC",
      params: [runId],
    },
  ]).queries.alignments;

  return rows.map((row) => ({
    id: String(row.id),
    runId: String(row.run_id),
    taskId: nullableString(row.task_id),
    featureId: nullableString(row.feature_id),
    aligned: Number(row.aligned) === 1,
    reasons: parseJsonStringArray(row.reasons_json),
    missingTraceability: parseJsonStringArray(row.missing_traceability_json),
    forbiddenFiles: parseJsonStringArray(row.forbidden_files_json),
    unauthorizedFiles: parseJsonStringArray(row.unauthorized_files_json),
    coverageGaps: parseJsonStringArray(row.coverage_gaps_json),
  }));
}

function inspectDiff(input: {
  diff?: DiffSummary;
  allowedFiles?: string[];
  forbiddenFiles?: string[];
  runner?: RunnerStatusInput;
}): DiffInspectionResult {
  const files = unique(input.diff?.files ?? []);
  const forbiddenFiles = files.filter((file) => matchesAny(file, input.forbiddenFiles ?? []));
  const unauthorizedFiles = input.allowedFiles?.length
    ? files.filter((file) => !matchesAny(file, input.allowedFiles ?? []))
    : [];
  const riskFiles = files.filter((file) => RISK_FILE_PATTERNS.some((pattern) => pattern.test(normalizePath(file))));
  const patchLineCount = input.diff?.patch?.split(/\r?\n/).length ?? 0;
  const secretFindings = scanSecrets([
    input.diff?.summary,
    input.diff?.patch,
    input.runner?.stdout,
    input.runner?.stderr,
  ].filter(Boolean).join("\n"));

  return {
    summary: input.diff?.summary ?? `${files.length} changed file(s) inspected.`,
    files,
    riskFiles: unique(riskFiles),
    unauthorizedFiles: unique(unauthorizedFiles),
    forbiddenFiles: unique(forbiddenFiles),
    secretFindings,
    diffThresholdExceeded: patchLineCount > DIFF_PATCH_REVIEW_THRESHOLD_LINES,
  };
}

function decideStatus(input: {
  runner?: RunnerStatusInput;
  commands: CommandCheckResult[];
  requiredCommands: CommandCheckKind[];
  diff: DiffInspectionResult;
  specAlignment: SpecAlignmentResult;
  failureHistory: Array<StatusDecision | RunnerTerminalStatus | CommandCheckStatus>;
  failureThreshold: number;
}): Pick<StatusCheckResult, "status" | "summary" | "reasons" | "recommendedActions"> {
  const reasons: string[] = [];
  const recommendedActions: string[] = [];
  const failedCommands = input.commands.filter((command) => command.status === "failed");
  const incompleteCommands = input.commands.filter((command) => command.status === "not_run" || command.status === "skipped");
  const missingCommands = input.requiredCommands.filter((kind) => !input.commands.some((command) => command.kind === kind));
  const repeatedFailureCount = trailingFailureCount(input.failureHistory);
  const missingCommandEvidence = input.commands.length === 0;
  const currentCountsTowardFailure = !input.runner || input.runner.status === "failed" || input.runner.status === "blocked" || failedCommands.length > 0;

  if (repeatedFailureCount + (currentCountsTowardFailure ? 1 : 0) >= input.failureThreshold) {
    reasons.push(`Failure threshold reached (${input.failureThreshold}).`);
    recommendedActions.push("Escalate to recovery because repeated failures exceeded the configured threshold.");
    return { status: "failed", summary: "Status check failed after repeated failures.", reasons, recommendedActions };
  }

  if (input.runner?.status === "scheduled") {
    return { status: "scheduled", summary: "Run is scheduled and waiting for execution.", reasons, recommendedActions };
  }
  if (input.runner?.status === "ready") {
    return { status: "ready", summary: "Run is ready for execution.", reasons, recommendedActions };
  }
  if (!input.runner) {
    reasons.push("Runner output is missing.");
    recommendedActions.push("Provide runner output before selecting a terminal status.");
    return { status: "blocked", summary: "Status check blocked because runner output is missing.", reasons, recommendedActions };
  }
  if (input.diff.forbiddenFiles.length > 0 || input.diff.unauthorizedFiles.length > 0 || input.diff.secretFindings.length > 0) {
    reasons.push(
      ...input.diff.forbiddenFiles.map((file) => `Forbidden file changed: ${file}.`),
      ...input.diff.unauthorizedFiles.map((file) => `Unauthorized file changed: ${file}.`),
      ...input.diff.secretFindings.map((finding) => `Sensitive value pattern detected: ${finding}.`),
    );
    if (failedCommands.length > 0) {
      reasons.push(...failedCommands.map((command) => `${command.kind} failed${command.command ? `: ${command.command}` : ""}.`));
    }
    if (input.runner?.status === "blocked") {
      reasons.push("Runner reported blocked.");
    } else if (input.runner?.status === "failed" || (input.runner?.exitCode ?? 0) !== 0) {
      reasons.push(`Runner failed with exit code ${input.runner?.exitCode ?? "unknown"}.`);
    }
    recommendedActions.push("Review file authorization and remove or rotate sensitive material before completion.");
    return { status: "review_needed", summary: "Status check requires review for file or secret findings.", reasons, recommendedActions };
  }
  if (input.diff.riskFiles.length > 0 || input.diff.diffThresholdExceeded) {
    reasons.push(
      ...input.diff.riskFiles.map((file) => `Risk file changed: ${file}.`),
      ...(input.diff.diffThresholdExceeded ? [`Diff exceeds review threshold of ${DIFF_PATCH_REVIEW_THRESHOLD_LINES} patch lines.`] : []),
    );
    if (failedCommands.length > 0) {
      reasons.push(...failedCommands.map((command) => `${command.kind} failed${command.command ? `: ${command.command}` : ""}.`));
    }
    if (input.runner?.status === "blocked") {
      reasons.push("Runner reported blocked.");
    } else if (input.runner?.status === "failed" || (input.runner?.exitCode ?? 0) !== 0) {
      reasons.push(`Runner failed with exit code ${input.runner?.exitCode ?? "unknown"}.`);
    }
    recommendedActions.push("Review high-risk files or large diffs before delivery.");
    return { status: "review_needed", summary: "Status check needs human review for high-risk diff.", reasons, recommendedActions };
  }
  if (input.runner?.status === "failed" || (input.runner?.exitCode ?? 0) !== 0) {
    reasons.push(`Runner failed with exit code ${input.runner?.exitCode ?? "unknown"}.`);
    recommendedActions.push("Review runner logs and retry or route to recovery.");
    return { status: "blocked", summary: "Status check blocked because runner execution failed.", reasons, recommendedActions };
  }
  if (input.runner?.status === "blocked") {
    reasons.push("Runner reported blocked.");
    recommendedActions.push("Inspect runner blockage and retry after resolution.");
    return { status: "blocked", summary: "Status check is blocked by runner output.", reasons, recommendedActions };
  }
  if (failedCommands.length > 0 && input.runner?.status === "review_needed") {
    reasons.push(...failedCommands.map((command) => `${command.kind} failed${command.command ? `: ${command.command}` : ""}.`));
    reasons.push("Runner requested review.");
    recommendedActions.push("Review failed checks and approve, split, or request changes before continuing.");
    return { status: "review_needed", summary: "Status check needs review for failed command continuation.", reasons, recommendedActions };
  }
  if (failedCommands.length > 0) {
    reasons.push(...failedCommands.map((command) => `${command.kind} failed${command.command ? `: ${command.command}` : ""}.`));
    recommendedActions.push("Fix failing checks before moving the task forward.");
    return { status: "blocked", summary: "Status check blocked by failed command checks.", reasons, recommendedActions };
  }
  if (!input.specAlignment.aligned) {
    reasons.push(...input.specAlignment.reasons);
    reasons.push(...fileSecurityReasons(input.diff));
    recommendedActions.push("Resolve spec alignment gaps before Done can be selected.");
    return { status: "review_needed", summary: "Spec alignment failed; Done is blocked.", reasons, recommendedActions };
  }
  if (incompleteCommands.length > 0 || missingCommands.length > 0 || missingCommandEvidence || input.runner?.status === "review_needed") {
    reasons.push(
      ...incompleteCommands.map((command) => `${command.kind} was ${command.status === "skipped" ? "skipped" : "not run"}.`),
      ...missingCommands.map((kind) => `${kind} result is missing.`),
      ...(missingCommandEvidence ? ["Command check evidence is missing."] : []),
    );
    if (input.runner?.status === "review_needed") reasons.push("Runner requested review.");
    recommendedActions.push("Review risk files or complete missing checks before delivery.");
    return { status: "review_needed", summary: "Status check needs human review.", reasons, recommendedActions };
  }

  return {
    status: "done",
    summary: "Status check passed with aligned spec evidence.",
    reasons: ["Runner, command checks, file checks, and spec alignment passed."],
    recommendedActions: ["Use evidence pack for review, recovery, and delivery reporting."],
  };
}

function buildEvidencePack(input: {
  id: string;
  input: StatusCheckerInput;
  status: StatusDecision;
  summary: string;
  reasons: string[];
  recommendedActions: string[];
  diff: DiffInspectionResult;
  specAlignment: SpecAlignmentResult;
  createdAt: string;
}): EvidencePack {
  const evidencePack: EvidencePack = {
    id: input.id,
    runId: input.input.runId,
    agentType: input.input.agentType,
    taskId: input.input.taskId,
    featureId: input.input.featureId,
    projectId: input.input.projectId,
    status: input.status,
    summary: input.summary,
    reasons: input.reasons,
    recommendedActions: input.recommendedActions,
    runner: input.input.runner ?? {},
    diff: input.diff,
    commands: input.input.commandChecks ?? [],
    specAlignment: input.specAlignment,
    attachments: input.input.attachments ?? [],
    evidenceWriteMs: 0,
    createdAt: input.createdAt,
  };
  return sanitizeJsonValue(evidencePack) as EvidencePack;
}

function writeEvidencePack(input: StatusCheckerInput, evidencePack: EvidencePack): { path?: string; durationMs: number; error?: string } {
  const started = performance.now();
  try {
    const artifactRoot = resolveArtifactRoot(input);
    const evidencePath = join(artifactRoot, "evidence", evidenceFileName(input.runId, evidencePack.id));
    const content = sanitizedEvidenceContent(evidencePack);
    mkdirSync(dirname(evidencePath), { recursive: true, mode: 0o700 });
    if (input.writeEvidence) {
      input.writeEvidence(evidencePath, sanitizeForOrdinaryLog(content));
    } else {
      writeFileSync(evidencePath, sanitizeForOrdinaryLog(content), "utf8");
    }
    return { path: displayEvidencePath(input, evidencePath), durationMs: elapsedMs(started) };
  } catch (error) {
    return {
      durationMs: elapsedMs(started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function rewriteEvidencePack(input: StatusCheckerInput, evidencePack: EvidencePack, evidencePath?: string): void {
  if (!evidencePath) return;
  const artifactRoot = resolveArtifactRoot(input);
  const absolutePath = join(artifactRoot, "evidence", evidenceFileName(input.runId, evidencePack.id));
  try {
    const content = sanitizedEvidenceContent(evidencePack);
    if (input.writeEvidence) {
      input.writeEvidence(absolutePath, sanitizeForOrdinaryLog(content));
    } else {
      writeFileSync(absolutePath, sanitizeForOrdinaryLog(content), "utf8");
    }
  } catch {
    // The first write already proved storage availability and measured the path.
  }
}

function persistStatusCheck(dbPath: string, result: StatusCheckResult, evidencePath: string | undefined, input: StatusCheckerInput): void {
  const evidenceChecksum = checksum(sanitizedEvidenceContent(result.evidencePack));
  const statements: SqlStatement[] = [
    {
      sql: `INSERT INTO evidence_packs (
        id, run_id, task_id, feature_id, path, kind, checksum, summary, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        run_id = excluded.run_id,
        task_id = excluded.task_id,
        feature_id = excluded.feature_id,
        path = excluded.path,
        kind = excluded.kind,
        checksum = excluded.checksum,
        summary = excluded.summary,
        metadata_json = excluded.metadata_json`,
      params: [
        result.evidencePack.id,
        result.runId,
        result.taskId ?? null,
        result.featureId ?? null,
        evidencePath ?? "",
        "status_checker",
        evidenceChecksum,
        sanitizeForOrdinaryLog(result.summary),
        sanitizedJson({ statusCheckerEvidencePack: result.evidencePack }),
      ],
    },
    {
      sql: `INSERT INTO status_check_results (
        id, run_id, task_id, feature_id, project_id, status, summary, reasons_json,
        recommended_actions_json, evidence_pack_id, spec_alignment_result_id, evidence_path,
        evidence_write_ms, evidence_write_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        result.id,
        result.runId,
        result.taskId ?? null,
        result.featureId ?? null,
        result.projectId ?? null,
        result.status,
        sanitizeForOrdinaryLog(result.summary),
        JSON.stringify(result.reasons.map(sanitizeForOrdinaryLog)),
        JSON.stringify(result.recommendedActions.map(sanitizeForOrdinaryLog)),
        result.evidencePack.id,
        result.specAlignment.id,
        evidencePath ?? null,
        result.evidenceWriteMs,
        result.evidenceWriteError ?? null,
      ],
    },
    {
      sql: `INSERT INTO spec_alignment_results (
        id, run_id, task_id, feature_id, aligned, reasons_json, missing_traceability_json,
        forbidden_files_json, unauthorized_files_json, coverage_gaps_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        result.specAlignment.id,
        result.runId,
        result.taskId ?? null,
        result.featureId ?? null,
        result.specAlignment.aligned ? 1 : 0,
        JSON.stringify(result.specAlignment.reasons.map(sanitizeForOrdinaryLog)),
        JSON.stringify(result.specAlignment.missingTraceability),
        JSON.stringify(result.specAlignment.forbiddenFiles),
        JSON.stringify(result.specAlignment.unauthorizedFiles),
        JSON.stringify(result.specAlignment.coverageGaps),
      ],
    },
    ...result.evidencePack.attachments.map((attachment) => ({
      sql: `INSERT INTO evidence_attachment_refs (
        id, evidence_pack_id, run_id, kind, path, description, checksum
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        attachment.id ?? randomUUID(),
        result.evidencePack.id,
        result.runId,
        attachment.kind,
        attachment.path,
        sanitizeForOrdinaryLog(attachment.description ?? ""),
        attachment.checksum ?? readChecksum(resolveAttachmentPath(input, attachment.path)),
      ],
    })),
  ];

  runSqlite(dbPath, statements);
  if (isRepeatedFailureEscalation(result)) {
    runSqlite(dbPath, repeatedFailureStateStatements(result, input));
  }
  if (result.status === "done") {
    runSqlite(dbPath, closeRemediatedStatusReviewStatements(result));
  }
  const shouldRouteToReview = result.status === "review_needed" || isRepeatedFailureEscalation(result);
  const existingReview = shouldRouteToReview ? findOpenStatusReview(dbPath, result) : undefined;
  if (shouldRouteToReview) {
    createReviewItem(dbPath, {
      id: existingReview?.id ?? `status-review-${result.id}`,
      projectId: result.projectId,
      featureId: result.featureId,
      taskId: result.taskId,
      runId: result.runId,
      message: result.summary,
      reviewNeededReason: reviewReasonForStatusCheck(result),
      triggerReasons: reviewTriggersForStatusCheck(result),
      evidenceRefs: [result.evidencePack.id],
      body: {
        testResults: {
          commands: result.evidencePack.commands,
          specAlignment: result.specAlignment,
        },
        diff: result.evidencePack.diff,
        riskExplanation: result.reasons.join(" "),
      },
      pauseEntity: !isRepeatedFailureEscalation(result),
      now: new Date(result.evidencePack.createdAt),
    });
  }
  recordAuditEvent(dbPath, {
    entityType: "run",
    entityId: result.runId,
    eventType: "status_checked",
    source: "status-checker",
    reason: result.summary,
    payload: {
      status: result.status,
      evidencePackId: result.evidencePack.id,
      evidencePath,
      evidenceWriteError: result.evidenceWriteError,
    },
  });
  recordMetricSample(dbPath, {
    name: "evidence_write_ms",
    value: result.evidenceWriteMs,
    unit: "ms",
    labels: {
      runId: result.runId,
      taskId: result.taskId,
      featureId: result.featureId,
      status: result.status,
    },
  });
}

function closeRemediatedStatusReviewStatements(result: StatusCheckResult): SqlStatement[] {
  if (!result.taskId && !result.featureId) {
    return [];
  }
  return [
    {
      sql: `UPDATE review_items
        SET status = 'closed', updated_at = ?
        WHERE id LIKE 'status-review-%'
          AND status IN ('review_needed', 'changes_requested', 'rejected')
          AND review_needed_reason <> 'approval_needed'
          AND COALESCE(task_id, '') = COALESCE(?, '')
          AND COALESCE(feature_id, '') = COALESCE(?, '')`,
      params: [result.evidencePack.createdAt, result.taskId ?? null, result.featureId ?? null],
    },
  ];
}

function repeatedFailureStateStatements(result: StatusCheckResult, input: StatusCheckerInput): SqlStatement[] {
  const now = input.now?.toISOString() ?? result.evidencePack.createdAt;
  const statements: SqlStatement[] = [];
  if (result.taskId) {
    statements.push(
      { sql: "UPDATE tasks SET status = 'failed', updated_at = ? WHERE id = ?", params: [now, result.taskId] },
      {
        sql: `UPDATE task_graph_tasks
          SET status = 'failed', updated_at = ?
          WHERE id = ?
            OR (
              feature_id = ?
              AND title = (SELECT title FROM tasks WHERE id = ?)
              AND (
                SELECT COUNT(*) FROM task_graph_tasks
                WHERE feature_id = ?
                  AND title = (SELECT title FROM tasks WHERE id = ?)
              ) = 1
            )`,
        params: [now, result.taskId, result.featureId ?? "", result.taskId, result.featureId ?? "", result.taskId],
      },
    );
  }
  if (result.featureId) {
    statements.push({ sql: "UPDATE features SET status = 'failed', updated_at = ? WHERE id = ?", params: [now, result.featureId] });
  }
  return statements;
}

function findOpenStatusReview(dbPath: string, result: StatusCheckResult): { id: string } | undefined {
  const reviewNeededReason = reviewReasonForStatusCheck(result);
  const triggerReasons = JSON.stringify(reviewTriggersForStatusCheck(result));
  const hasSubject = result.taskId !== undefined || result.featureId !== undefined;
  const resultRows = runSqlite(dbPath, [], [
    {
      name: "reviews",
      sql: `SELECT id FROM review_items
        WHERE status IN ('review_needed', 'changes_requested', 'rejected')
          AND review_needed_reason = ?
          AND trigger_reasons_json = ?
          AND COALESCE(task_id, '') = COALESCE(?, '')
          AND COALESCE(feature_id, '') = COALESCE(?, '')
          AND (? = 1 OR COALESCE(run_id, '') = COALESCE(?, ''))
        LIMIT 1`,
      params: [reviewNeededReason, triggerReasons, result.taskId ?? null, result.featureId ?? null, hasSubject ? 1 : 0, result.runId],
    },
  ]);
  const row = resultRows.queries.reviews[0];
  return row ? { id: String(row.id) } : undefined;
}

function reviewReasonForStatusCheck(result: StatusCheckResult): "approval_needed" | "clarification_needed" | "risk_review_needed" {
  if (isRepeatedFailureEscalation(result)) {
    return "risk_review_needed";
  }
  if (
    result.evidencePack.diff.forbiddenFiles.length > 0 ||
    result.evidencePack.diff.unauthorizedFiles.length > 0 ||
    result.evidencePack.diff.secretFindings.length > 0
  ) {
    return "risk_review_needed";
  }
  if (!result.specAlignment.aligned) {
    return "clarification_needed";
  }
  if (result.evidencePack.runner.status === "review_needed") {
    return "approval_needed";
  }
  return "risk_review_needed";
}

function reviewTriggersForStatusCheck(result: StatusCheckResult): ReviewTrigger[] {
  const triggers = new Set<ReviewTrigger>();
  if (isRepeatedFailureEscalation(result)) triggers.add("repeated_failure");
  if (!result.specAlignment.aligned) triggers.add("high_impact_ambiguity");
  if (result.evidencePack.runner.status === "review_needed") triggers.add("permission_escalation");
  if (result.evidencePack.diff.riskFiles.length > 0) triggers.add("high_risk_file");
  if (result.evidencePack.diff.diffThresholdExceeded) triggers.add("diff_threshold_exceeded");
  if (
    result.evidencePack.diff.forbiddenFiles.length > 0 ||
    result.evidencePack.diff.unauthorizedFiles.length > 0 ||
    result.evidencePack.diff.secretFindings.length > 0
  ) {
    triggers.add("forbidden_file");
  }
  if (result.evidencePack.commands.some((command) => command.status === "failed")) triggers.add("failed_tests_continue");
  return triggers.size > 0 ? [...triggers] : ["high_risk_file"];
}

function isRepeatedFailureEscalation(result: StatusCheckResult): boolean {
  return result.status === "failed" && result.reasons.some((reason) => reason.includes("Failure threshold reached"));
}

function persistenceFailureResult(result: StatusCheckResult, error: unknown): StatusCheckResult {
  const message = error instanceof Error ? error.message : String(error);
  const status = evidenceWriteFailureStatus(result.status);
  const summary = "Status check blocked because evidence persistence failed.";
  const reasons = [...result.reasons, `Evidence persistence failed: ${message}`];
  const recommendedActions = [
    "Inspect evidence database configuration and retry the status check.",
    ...result.recommendedActions,
  ];
  const evidenceWriteError = result.evidenceWriteError
    ? `${result.evidenceWriteError}; persistence failed: ${message}`
    : `Persistence failed: ${message}`;
  const evidencePack = {
    ...result.evidencePack,
    status,
    summary,
    reasons,
    recommendedActions,
    evidenceWriteError,
  };
  return {
    ...result,
    status,
    summary,
    reasons,
    recommendedActions,
    evidencePack,
    evidenceWriteError,
  };
}

function evidenceWriteFailureStatus(status: StatusDecision): StatusDecision {
  return status === "failed" ? "failed" : "blocked";
}

function resolveArtifactRoot(input: StatusCheckerInput): string {
  if (input.artifactRoot) return input.artifactRoot;
  if (input.workspaceRoot) return join(input.workspaceRoot, ".autobuild");
  return join(process.cwd(), ".autobuild");
}

function resolveAttachmentPath(input: StatusCheckerInput, path: string): string {
  if (isAbsolute(path)) return path;
  if (input.artifactRoot) {
    const artifactPath = join(input.artifactRoot, withoutArtifactRootPrefix(input.artifactRoot, path));
    if (!input.workspaceRoot || existsSync(artifactPath) || hasArtifactRootPrefix(input.artifactRoot, path)) {
      return artifactPath;
    }
  }
  if (input.workspaceRoot) return join(input.workspaceRoot, path);
  return join(process.cwd(), path);
}

function resolveAttachmentRefs(input: StatusCheckerInput): EvidenceAttachmentRef[] {
  return (input.attachments ?? []).map((attachment) => ({
    ...attachment,
    checksum: attachment.checksum ?? readChecksum(resolveAttachmentPath(input, attachment.path)),
  }));
}

function displayEvidencePath(input: StatusCheckerInput, evidencePath: string): string {
  if (input.workspaceRoot) {
    return normalizePath(relative(input.workspaceRoot, evidencePath));
  }
  const artifactRoot = resolveArtifactRoot(input);
  return normalizePath(join(basename(artifactRoot), relative(artifactRoot, evidencePath)));
}

function scanSecrets(value: string): string[] {
  const findings: string[] = [];
  for (const { label, pattern } of SECRET_PATTERNS) {
    if (pattern.test(value)) findings.push(label);
    pattern.lastIndex = 0;
  }
  return unique(findings);
}

function fileSecurityReasons(diff: DiffInspectionResult): string[] {
  return [
    ...diff.forbiddenFiles.map((file) => `Forbidden file changed: ${file}.`),
    ...diff.unauthorizedFiles.map((file) => `Unauthorized file changed: ${file}.`),
    ...diff.secretFindings.map((finding) => `Sensitive value pattern detected: ${finding}.`),
  ];
}

function mergeFileRules(primary?: string[], secondary?: string[]): string[] | undefined {
  const merged = unique([...(primary ?? []), ...(secondary ?? [])]);
  return merged.length > 0 ? merged : undefined;
}

function withoutArtifactRootPrefix(artifactRoot: string, path: string): string {
  const normalizedPath = normalizePath(path);
  const artifactRootName = basename(artifactRoot);
  return normalizedPath.startsWith(`${artifactRootName}/`)
    ? normalizedPath.slice(artifactRootName.length + 1)
    : normalizedPath;
}

function hasArtifactRootPrefix(artifactRoot: string, path: string): boolean {
  const normalizedPath = normalizePath(path);
  return normalizedPath === basename(artifactRoot) || normalizedPath.startsWith(`${basename(artifactRoot)}/`);
}

function trailingFailureCount(history: Array<StatusDecision | RunnerTerminalStatus | CommandCheckStatus>): number {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index] !== "failed" && history[index] !== "blocked") break;
    count += 1;
  }
  return count;
}

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(normalizePath(file)));
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "__DOUBLE_STAR__").replace(/\*/g, "[^/]*").replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function safeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function evidenceFileName(runId: string, evidencePackId: string): string {
  return `${safeArtifactName(runId)}-${safeArtifactName(evidencePackId)}.json`;
}

function sanitizedEvidenceContent(evidencePack: EvidencePack): string {
  return sanitizeForOrdinaryLog(JSON.stringify(evidencePack, null, 2));
}

function elapsedMs(started: number): number {
  return Number((performance.now() - started).toFixed(3));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean).map(String))];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function checksum(value: BinaryLike): string {
  return createHash("sha256").update(value).digest("hex");
}

function getEvidencePackById(dbPath: string, id?: string): EvidencePack {
  if (!id) throw new Error("Status check result is missing evidence_pack_id");
  const row = runSqlite(dbPath, [], [
    { name: "evidence", sql: "SELECT * FROM evidence_packs WHERE id = ?", params: [id] },
  ]).queries.evidence[0];
  if (!row) throw new Error(`Missing evidence pack ${id}`);
  const metadata = parseJsonObject(row.metadata_json);
  return metadata.statusCheckerEvidencePack as EvidencePack;
}

function getSpecAlignmentResultById(dbPath: string, id?: string): SpecAlignmentResult {
  if (!id) throw new Error("Status check result is missing spec_alignment_result_id");
  const row = runSqlite(dbPath, [], [
    { name: "alignment", sql: "SELECT * FROM spec_alignment_results WHERE id = ?", params: [id] },
  ]).queries.alignment[0];
  if (!row) throw new Error(`Missing spec alignment result ${id}`);
  return {
    id: String(row.id),
    runId: String(row.run_id),
    taskId: nullableString(row.task_id),
    featureId: nullableString(row.feature_id),
    aligned: Number(row.aligned) === 1,
    reasons: parseJsonStringArray(row.reasons_json),
    missingTraceability: parseJsonStringArray(row.missing_traceability_json),
    forbiddenFiles: parseJsonStringArray(row.forbidden_files_json),
    unauthorizedFiles: parseJsonStringArray(row.unauthorized_files_json),
    coverageGaps: parseJsonStringArray(row.coverage_gaps_json),
  };
}

function readChecksum(path: string): string | undefined {
  return existsSync(path) ? checksum(readFileSync(path)) : undefined;
}

function sanitizedJson(value: unknown): string {
  return JSON.stringify(sanitizeJsonValue(value));
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeForOrdinaryLog(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeJsonValue(entry)]),
    );
  }
  return value;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}
