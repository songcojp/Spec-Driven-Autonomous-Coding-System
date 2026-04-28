import { randomUUID } from "node:crypto";
import { runSqlite } from "./sqlite.ts";

export type BuiltInSkill = {
  slug: string;
  name: string;
  description: string;
  trigger: string;
  riskLevel: "low" | "medium" | "high";
  phase: string;
};

const PLACEHOLDER_SCHEMA = JSON.stringify({
  type: "object",
  additionalProperties: true,
});

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
    const result = runSqlite(dbPath, [
      {
        sql: `INSERT OR IGNORE INTO skills (
          id, slug, name, description, trigger, risk_level, phase,
          input_schema_json, output_schema_json, built_in, enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        params: [
          randomUUID(),
          builtInSkill.slug,
          builtInSkill.name,
          builtInSkill.description,
          builtInSkill.trigger,
          builtInSkill.riskLevel,
          builtInSkill.phase,
          PLACEHOLDER_SCHEMA,
          PLACEHOLDER_SCHEMA,
        ],
      },
    ]);
    inserted += result.changes;
  }

  return {
    inserted,
    total: BUILT_IN_SKILLS.length,
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

function skill(
  slug: string,
  name: string,
  description: string,
  trigger: string,
  riskLevel: BuiltInSkill["riskLevel"],
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
