import { randomUUID } from "node:crypto";
import { runSqlite } from "./sqlite.ts";

export type SkillRiskLevel = "low" | "medium" | "high";
export type SkillStateInput = "continue" | "review_needed" | "failed";
export type SchemaDirection = "input" | "output";

export type JsonSchema = {
  schema_version?: string;
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  nullable?: boolean;
  additionalProperties?: boolean;
};

export type BuiltInSkill = {
  slug: string;
  name: string;
  description: string;
  trigger: string;
  riskLevel: SkillRiskLevel;
  phase: string;
};

export type SkillRegistrationInput = BuiltInSkill & {
  allowedContext?: string[];
  requiredTools?: string[];
  successCriteria?: string;
  failureHandling?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  builtIn?: boolean;
  enabled?: boolean;
  teamShared?: boolean;
  projectId?: string;
  version?: string;
};

export type SkillRecord = Required<Omit<SkillRegistrationInput, "inputSchema" | "outputSchema">> & {
  id: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
};

export type SkillMatchQuery = {
  phase?: string;
  trigger?: string;
  riskLevel?: SkillRiskLevel;
  projectId?: string;
  includeDisabled?: boolean;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

export type EvidencePack = {
  run_id: string;
  agent_type: "skill-schema-validator";
  task_id?: string;
  status: "failed";
  summary: string;
  evidence: {
    skill: string;
    direction: SchemaDirection;
    errors: string[];
  };
  recommendation: {
    next_skill: "failure-recovery-skill" | "review-report-skill";
    risk: SkillRiskLevel;
  };
};

export type SchemaValidationRecord = ValidationResult & {
  id: string;
  skillRunId?: string;
  skillSlug: string;
  direction: SchemaDirection;
  evidencePack?: EvidencePack;
  stateInput: SkillStateInput;
};

const DEFAULT_SCHEMA: JsonSchema = {
  schema_version: "1.0.0",
  type: "object",
  required: ["schema_version"],
  properties: {
    schema_version: {
      type: "string",
    },
  },
  additionalProperties: true,
};

export const BUILT_IN_SKILLS: BuiltInSkill[] = [
  skill("project-constitution-skill", "Project Constitution Skill", "Captures project rules and operating constraints.", "project onboarding", "medium", "foundation"),
  skill("requirement-intake-skill", "Requirement Intake Skill", "Normalizes source requirements for the spec pipeline.", "new product input", "low", "spec"),
  skill("pr-ears-requirement-decomposition-skill", "PR/EARS Requirement Decomposition Skill", "Decomposes PRD prose into EARS requirements.", "requirements decomposition", "medium", "spec"),
  skill("ambiguity-clarification-skill", "Ambiguity Clarification Skill", "Finds unclear requirements and records clarification needs.", "ambiguous requirement", "low", "spec"),
  skill("requirements-checklist-skill", "Requirements Checklist Skill", "Builds machine-checkable requirement coverage lists.", "requirements review", "low", "spec"),
  skill("technical-context-skill", "Technical Context Skill", "Summarizes relevant repository and platform context.", "planning start", "medium", "planning"),
  skill("research-decision-skill", "Research Decision Skill", "Records evidence-backed technical decisions.", "technical uncertainty", "medium", "planning"),
  skill("architecture-plan-skill", "Architecture Plan Skill", "Produces bounded architecture plans for feature work.", "feature planning", "medium", "planning"),
  skill("data-model-skill", "Data Model Skill", "Designs data entities, persistence, and migration implications.", "data change", "medium", "planning"),
  skill("contract-design-skill", "Contract Design Skill", "Defines API, event, and integration contracts.", "contract change", "medium", "planning"),
  skill("quickstart-validation-skill", "Quickstart Validation Skill", "Validates that setup and quickstart flows are executable.", "quickstart update", "low", "validation"),
  skill("task-slicing-skill", "Task Slicing Skill", "Breaks feature designs into executable task graphs.", "ready design", "medium", "planning"),
  skill("spec-consistency-analysis-skill", "Spec Consistency Analysis Skill", "Checks PRD, requirements, design, and tasks for drift.", "spec update", "low", "review"),
  skill("repo-probe-skill", "Repo Probe Skill", "Inspects repository structure and available tooling.", "execution start", "low", "execution"),
  skill("codex-coding-skill", "Codex Coding Skill", "Implements approved code changes inside allowed file scopes.", "task implementation", "high", "implementation"),
  skill("test-execution-skill", "Test Execution Skill", "Runs tests and captures verification evidence.", "verification", "medium", "test"),
  skill("failure-recovery-skill", "Failure Recovery Skill", "Diagnoses failures and proposes bounded recovery actions.", "run failure", "high", "recovery"),
  skill("review-report-skill", "Review Report Skill", "Creates review findings and acceptance summaries.", "review needed", "medium", "review"),
  skill("pr-generation-skill", "PR Generation Skill", "Prepares branch, commit, push, and pull request artifacts.", "delivery ready", "medium", "delivery"),
  skill("spec-evolution-skill", "Spec Evolution Skill", "Captures changes needed in specs after implementation learning.", "post-delivery learning", "medium", "delivery"),
  skill("workflow-hook-skill", "Workflow Hook Skill", "Runs controlled hooks at workflow transition points.", "state transition", "high", "orchestration"),
];

export function seedBuiltInSkills(dbPath: string): { inserted: number; total: number } {
  let inserted = 0;

  for (const builtInSkill of BUILT_IN_SKILLS) {
    const record = registerSkill(dbPath, {
      ...builtInSkill,
      builtIn: true,
      enabled: true,
      teamShared: true,
      version: "1.0.0",
      inputSchema: DEFAULT_SCHEMA,
      outputSchema: DEFAULT_SCHEMA,
    });
    inserted += record.created ? 1 : 0;
  }

  return {
    inserted,
    total: BUILT_IN_SKILLS.length,
  };
}

export function registerSkill(
  dbPath: string,
  input: SkillRegistrationInput,
): { skill: SkillRecord; created: boolean } {
  const id = randomUUID();
  const version = input.version ?? "1.0.0";
  const skillRecord = normalizeSkill(id, input, version);
  const result = runSqlite(dbPath, [
    {
      sql: `INSERT OR IGNORE INTO skills (
        id, slug, name, description, trigger, allowed_context_json, required_tools_json,
        risk_level, phase, success_criteria, failure_handling, input_schema_json,
        output_schema_json, built_in, enabled, team_shared, project_id, current_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        skillRecord.id,
        skillRecord.slug,
        skillRecord.name,
        skillRecord.description,
        skillRecord.trigger,
        JSON.stringify(skillRecord.allowedContext),
        JSON.stringify(skillRecord.requiredTools),
        skillRecord.riskLevel,
        skillRecord.phase,
        skillRecord.successCriteria,
        skillRecord.failureHandling,
        JSON.stringify(skillRecord.inputSchema),
        JSON.stringify(skillRecord.outputSchema),
        skillRecord.builtIn ? 1 : 0,
        skillRecord.enabled ? 1 : 0,
        skillRecord.teamShared ? 1 : 0,
        skillRecord.projectId || null,
        skillRecord.version,
      ],
    },
    {
      sql: `INSERT OR IGNORE INTO skill_versions (
        id, skill_slug, version, change_summary, snapshot_json
      ) VALUES (?, ?, ?, ?, ?)`,
      params: [
        randomUUID(),
        skillRecord.slug,
        skillRecord.version,
        "Initial registration",
        JSON.stringify(skillRecord),
      ],
    },
  ]);

  return {
    skill: getSkill(dbPath, skillRecord.slug) ?? skillRecord,
    created: result.changes > 0,
  };
}

export function getSkill(dbPath: string, slug: string): SkillRecord | undefined {
  const result = runSqlite(dbPath, [], [
    {
      name: "skill",
      sql: "SELECT * FROM skills WHERE slug = ?",
      params: [slug],
    },
  ]);
  const row = result.queries.skill[0];
  return row ? mapSkill(row) : undefined;
}

export function listSkills(dbPath: string, query: SkillMatchQuery = {}): SkillRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!query.includeDisabled) {
    clauses.push("enabled = 1");
  }
  if (query.phase) {
    clauses.push("phase = ?");
    params.push(query.phase);
  }
  if (query.riskLevel) {
    clauses.push("risk_level = ?");
    params.push(query.riskLevel);
  }
  if (query.projectId) {
    clauses.push("(project_id IS NULL OR project_id = ?)");
    params.push(query.projectId);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = runSqlite(dbPath, [], [
    {
      name: "skills",
      sql: `SELECT * FROM skills ${where} ORDER BY phase, slug`,
      params,
    },
  ]);
  return result.queries.skills.map(mapSkill).filter((record) => matchesTrigger(record, query.trigger));
}

export function matchSkills(dbPath: string, query: SkillMatchQuery): SkillRecord[] {
  return listSkills(dbPath, query);
}

export function getEffectiveSkill(dbPath: string, slug: string, projectId?: string): SkillRecord | undefined {
  if (!projectId) {
    return getSkill(dbPath, slug);
  }

  const result = runSqlite(dbPath, [], [
    {
      name: "override",
      sql: `SELECT override_skill_slug FROM skill_project_overrides
        WHERE project_id = ? AND base_skill_slug = ? AND enabled = 1`,
      params: [projectId, slug],
    },
  ]);
  const overrideSlug = result.queries.override[0]?.override_skill_slug;
  return getSkill(dbPath, overrideSlug ? String(overrideSlug) : slug);
}

export function setSkillEnabled(dbPath: string, slug: string, enabled: boolean): SkillRecord {
  runSqlite(dbPath, [
    {
      sql: "UPDATE skills SET enabled = ? WHERE slug = ?",
      params: [enabled ? 1 : 0, slug],
    },
  ]);
  return requireSkill(dbPath, slug);
}

export function addSkillVersion(
  dbPath: string,
  slug: string,
  version: string,
  changeSummary: string,
  patch: Partial<SkillRegistrationInput> = {},
): SkillRecord {
  const current = requireSkill(dbPath, slug);
  const next: SkillRecord = {
    ...current,
    ...patch,
    id: current.id,
    slug: current.slug,
    version,
    inputSchema: patch.inputSchema ?? current.inputSchema,
    outputSchema: patch.outputSchema ?? current.outputSchema,
  };

  runSqlite(dbPath, [
    {
      sql: `UPDATE skills SET
        name = ?, description = ?, trigger = ?, allowed_context_json = ?,
        required_tools_json = ?, risk_level = ?, phase = ?, success_criteria = ?,
        failure_handling = ?, input_schema_json = ?, output_schema_json = ?,
        enabled = ?, team_shared = ?, project_id = ?, current_version = ?
        WHERE slug = ?`,
      params: [
        next.name,
        next.description,
        next.trigger,
        JSON.stringify(next.allowedContext),
        JSON.stringify(next.requiredTools),
        next.riskLevel,
        next.phase,
        next.successCriteria,
        next.failureHandling,
        JSON.stringify(next.inputSchema),
        JSON.stringify(next.outputSchema),
        next.enabled ? 1 : 0,
        next.teamShared ? 1 : 0,
        next.projectId || null,
        next.version,
        slug,
      ],
    },
    {
      sql: `INSERT INTO skill_versions (id, skill_slug, version, change_summary, snapshot_json)
        VALUES (?, ?, ?, ?, ?)`,
      params: [randomUUID(), slug, version, changeSummary, JSON.stringify(next)],
    },
  ]);

  return requireSkill(dbPath, slug);
}

export function rollbackSkillVersion(dbPath: string, slug: string, version: string): SkillRecord {
  const result = runSqlite(dbPath, [], [
    {
      name: "version",
      sql: "SELECT snapshot_json FROM skill_versions WHERE skill_slug = ? AND version = ?",
      params: [slug, version],
    },
  ]);
  const snapshot = result.queries.version[0]?.snapshot_json;
  if (!snapshot) {
    throw new Error(`Skill version not found: ${slug}@${version}`);
  }

  const parsed = JSON.parse(String(snapshot)) as SkillRecord;
  runSqlite(dbPath, [
    {
      sql: `UPDATE skills SET
        name = ?, description = ?, trigger = ?, allowed_context_json = ?,
        required_tools_json = ?, risk_level = ?, phase = ?, success_criteria = ?,
        failure_handling = ?, input_schema_json = ?, output_schema_json = ?,
        enabled = ?, team_shared = ?, project_id = ?, current_version = ?
        WHERE slug = ?`,
      params: [
        parsed.name,
        parsed.description,
        parsed.trigger,
        JSON.stringify(parsed.allowedContext),
        JSON.stringify(parsed.requiredTools),
        parsed.riskLevel,
        parsed.phase,
        parsed.successCriteria,
        parsed.failureHandling,
        JSON.stringify(parsed.inputSchema),
        JSON.stringify(parsed.outputSchema),
        parsed.enabled ? 1 : 0,
        parsed.teamShared ? 1 : 0,
        parsed.projectId || null,
        version,
        slug,
      ],
    },
    {
      sql: `INSERT INTO audit_timeline_events (id, entity_type, entity_id, event_type, payload_json)
        VALUES (?, ?, ?, ?, ?)`,
      params: [
        randomUUID(),
        "skill",
        slug,
        "skill_version_rollback",
        JSON.stringify({ targetVersion: version }),
      ],
    },
  ]);
  return requireSkill(dbPath, slug);
}

export function createSkillProjectOverride(
  dbPath: string,
  projectId: string,
  baseSkillSlug: string,
  overrideSkillSlug: string,
  enabled = true,
): void {
  runSqlite(dbPath, [
    {
      sql: `INSERT INTO skill_project_overrides (
        id, project_id, base_skill_slug, override_skill_slug, enabled
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, base_skill_slug) DO UPDATE SET
        override_skill_slug = excluded.override_skill_slug,
        enabled = excluded.enabled`,
      params: [randomUUID(), projectId, baseSkillSlug, overrideSkillSlug, enabled ? 1 : 0],
    },
  ]);
}

export function validateSkillPayload(schema: JsonSchema, payload: unknown): ValidationResult {
  const errors: string[] = [];
  validateAgainstSchema(schema, payload, "$", errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function recordSkillSchemaValidation(
  dbPath: string,
  input: {
    skillSlug: string;
    direction: SchemaDirection;
    payload: unknown;
    runId?: string;
    taskId?: string;
    failureState?: Exclude<SkillStateInput, "continue">;
  },
): SchemaValidationRecord {
  const selected = requireSkill(dbPath, input.skillSlug);
  const schema = input.direction === "input" ? selected.inputSchema : selected.outputSchema;
  const validation = validateSkillPayload(schema, input.payload);
  const evidencePack = validation.valid
    ? undefined
    : createSchemaFailureEvidence(selected, input.direction, validation.errors, input.runId, input.taskId);
  const stateInput: SkillStateInput = validation.valid ? "continue" : input.failureState ?? "review_needed";
  const id = randomUUID();

  runSqlite(dbPath, [
    {
      sql: `INSERT INTO schema_validation_results (
        id, skill_run_id, skill_slug, direction, valid, errors_json, evidence_pack_json, state_input
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        input.runId ?? null,
        input.skillSlug,
        input.direction,
        validation.valid ? 1 : 0,
        JSON.stringify(validation.errors),
        evidencePack ? JSON.stringify(evidencePack) : null,
        stateInput,
      ],
    },
  ]);

  return {
    id,
    skillRunId: input.runId,
    skillSlug: input.skillSlug,
    direction: input.direction,
    valid: validation.valid,
    errors: validation.errors,
    evidencePack,
    stateInput,
  };
}

export function countBuiltInSkills(dbPath: string): number {
  const result = runSqlite(dbPath, [], [
    {
      name: "count",
      sql: "SELECT COUNT(*) AS count FROM skills WHERE built_in = 1",
    },
  ]);
  return Number(result.queries.count[0]?.count ?? 0);
}

function createSchemaFailureEvidence(
  skillRecord: SkillRecord,
  direction: SchemaDirection,
  errors: string[],
  runId = randomUUID(),
  taskId?: string,
): EvidencePack {
  return {
    run_id: runId,
    agent_type: "skill-schema-validator",
    task_id: taskId,
    status: "failed",
    summary: `${skillRecord.slug} ${direction} schema validation failed`,
    evidence: {
      skill: skillRecord.slug,
      direction,
      errors,
    },
    recommendation: {
      next_skill: skillRecord.riskLevel === "high" ? "failure-recovery-skill" : "review-report-skill",
      risk: skillRecord.riskLevel,
    },
  };
}

function validateAgainstSchema(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  if (value === null) {
    if (schema.nullable || schema.type === "null") {
      return;
    }
    errors.push(`${path} must not be null`);
    return;
  }

  if (schema.enum && !schema.enum.some((entry) => Object.is(entry, value))) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
  }

  if (schema.type) {
    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (schema.type === "integer") {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`${path} must be integer`);
        return;
      }
    } else if (actualType !== schema.type) {
      errors.push(`${path} must be ${schema.type}`);
      return;
    }
  }

  if (schema.type === "object" || schema.properties || schema.required) {
    if (typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${path} must be object`);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!(required in record)) {
        errors.push(`${path}.${required} is required`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in record) {
        validateAgainstSchema(childSchema, record[key], `${path}.${key}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!schema.properties?.[key]) {
          errors.push(`${path}.${key} is not allowed`);
        }
      }
    }
  }

  if (schema.type === "array" && schema.items) {
    for (const [index, entry] of (value as unknown[]).entries()) {
      validateAgainstSchema(schema.items, entry, `${path}[${index}]`, errors);
    }
  }
}

function requireSkill(dbPath: string, slug: string): SkillRecord {
  const selected = getSkill(dbPath, slug);
  if (!selected) {
    throw new Error(`Skill not found: ${slug}`);
  }
  return selected;
}

function normalizeSkill(id: string, input: SkillRegistrationInput, version: string): SkillRecord {
  return {
    id,
    slug: input.slug,
    name: input.name,
    description: input.description,
    trigger: input.trigger,
    allowedContext: input.allowedContext ?? [],
    requiredTools: input.requiredTools ?? [],
    riskLevel: input.riskLevel,
    phase: input.phase,
    successCriteria: input.successCriteria ?? "Skill completes and returns schema-valid output.",
    failureHandling: input.failureHandling ?? "Generate evidence and route to review or recovery.",
    inputSchema: input.inputSchema ?? DEFAULT_SCHEMA,
    outputSchema: input.outputSchema ?? DEFAULT_SCHEMA,
    builtIn: input.builtIn ?? false,
    enabled: input.enabled ?? true,
    teamShared: input.teamShared ?? false,
    projectId: input.projectId ?? "",
    version,
  };
}

function mapSkill(row: Record<string, unknown>): SkillRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description),
    trigger: String(row.trigger),
    allowedContext: parseJsonStringArray(row.allowed_context_json),
    requiredTools: parseJsonStringArray(row.required_tools_json),
    riskLevel: String(row.risk_level) as SkillRiskLevel,
    phase: String(row.phase),
    successCriteria: String(row.success_criteria),
    failureHandling: String(row.failure_handling),
    inputSchema: parseJsonSchema(row.input_schema_json),
    outputSchema: parseJsonSchema(row.output_schema_json),
    builtIn: Number(row.built_in) === 1,
    enabled: Number(row.enabled) === 1,
    teamShared: Number(row.team_shared) === 1,
    projectId: nullableString(row.project_id) ?? "",
    version: String(row.current_version),
  };
}

function parseJsonStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  const parsed = JSON.parse(String(value));
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function parseJsonSchema(value: unknown): JsonSchema {
  return value ? (JSON.parse(String(value)) as JsonSchema) : DEFAULT_SCHEMA;
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function matchesTrigger(record: SkillRecord, trigger?: string): boolean {
  if (!trigger) {
    return true;
  }
  return record.trigger.toLocaleLowerCase().includes(trigger.toLocaleLowerCase());
}

function skill(
  slug: string,
  name: string,
  description: string,
  trigger: string,
  riskLevel: SkillRiskLevel,
  phase: string,
): BuiltInSkill {
  return {
    slug,
    name,
    description,
    trigger,
    riskLevel,
    phase,
  };
}
