import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import {
  addSkillVersion,
  BUILT_IN_SKILLS,
  countBuiltInSkills,
  createSkillProjectOverride,
  getEffectiveSkill,
  listSkills,
  matchSkills,
  recordSkillSchemaValidation,
  registerSkill,
  rollbackSkillVersion,
  seedBuiltInSkills,
  setSkillEnabled,
  validateSkillPayload,
} from "../src/skills.ts";

test("skill schema owns registry, version, run, validation, and override tables", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const tables = listTables(dbPath);
  for (const table of [
    "skills",
    "skill_versions",
    "skill_runs",
    "schema_validation_results",
    "skill_project_overrides",
  ]) {
    assert.equal(tables.includes(table), true, `${table} should exist`);
  }
});

test("built-in skill seed stays synchronized with PRD FR-021", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const seeded = seedBuiltInSkills(dbPath);
  assert.equal(seeded.total, 21);
  assert.equal(countBuiltInSkills(dbPath), 21);

  const prd = readFileSync(new URL("../docs/zh-CN/PRD.md", import.meta.url), "utf8");
  const fr021 = prd.slice(prd.indexOf("#### FR-021"), prd.indexOf("#### FR-022"));
  const prdSlugs = [...fr021.matchAll(/`([^`]+-skill)`/g)].map((match) => match[1]);

  assert.deepEqual(BUILT_IN_SKILLS.map((skill) => skill.slug), prdSlugs);
});

test("skill registry creates, queries, matches, and filters disabled skills", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  seedBuiltInSkills(dbPath);

  const registered = registerSkill(dbPath, {
    slug: "security-review-skill",
    name: "Security Review Skill",
    description: "Reviews risky code changes.",
    trigger: "security review",
    riskLevel: "high",
    phase: "review",
    requiredTools: ["rg"],
    allowedContext: ["diff", "requirements"],
    inputSchema: objectSchema(["schema_version", "diff"]),
    outputSchema: objectSchema(["schema_version", "findings"]),
  });

  assert.equal(registered.created, true);
  assert.equal(listSkills(dbPath, { phase: "review" }).some((skill) => skill.slug === "security-review-skill"), true);
  assert.equal(matchSkills(dbPath, { trigger: "security" }).at(0)?.slug, "security-review-skill");

  setSkillEnabled(dbPath, "security-review-skill", false);
  assert.equal(listSkills(dbPath, { phase: "review" }).some((skill) => skill.slug === "security-review-skill"), false);
  assert.equal(listSkills(dbPath, { phase: "review", includeDisabled: true }).some((skill) => skill.slug === "security-review-skill"), true);
});

test("schema validation gates invalid input and creates evidence state input", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  registerSkill(dbPath, {
    slug: "strict-output-skill",
    name: "Strict Output Skill",
    description: "Requires versioned payloads.",
    trigger: "strict",
    riskLevel: "medium",
    phase: "validation",
    inputSchema: objectSchema(["schema_version", "source_text"]),
    outputSchema: {
      schema_version: "1.0.0",
      type: "object",
      required: ["schema_version", "items"],
      properties: {
        schema_version: { type: "string" },
        items: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  });

  const validInput = validateSkillPayload(objectSchema(["schema_version", "source_text"]), {
    schema_version: "1.0.0",
    source_text: "Ship it.",
  });
  assert.equal(validInput.valid, true);

  const failure = recordSkillSchemaValidation(dbPath, {
    skillSlug: "strict-output-skill",
    direction: "output",
    payload: { schema_version: "1.0.0", items: [1], extra: true },
    runId: "RUN-003",
    taskId: "TASK-008",
  });

  assert.equal(failure.valid, false);
  assert.equal(failure.stateInput, "review_needed");
  assert.equal(failure.evidencePack?.run_id, "RUN-003");
  assert.equal(failure.evidencePack?.recommendation.next_skill, "review-report-skill");
  assert.equal(failure.errors.some((error) => error.includes("$.items[0] must be string")), true);
  assert.equal(failure.errors.some((error) => error.includes("$.extra is not allowed")), true);
});

test("skill versions are auditable and rollback restores an earlier snapshot", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);
  createSkillProjectOverride(dbPath, "PROJECT-1", "task-slicing-skill", "team-task-slicing-skill");
  registerSkill(dbPath, {
    slug: "team-task-slicing-skill",
    name: "Team Task Slicing Skill",
    description: "Initial team task slicing.",
    trigger: "task slicing",
    riskLevel: "medium",
    phase: "planning",
    teamShared: true,
  });
  assert.equal(getEffectiveSkill(dbPath, "task-slicing-skill", "PROJECT-1")?.slug, "team-task-slicing-skill");

  const changed = addSkillVersion(dbPath, "team-task-slicing-skill", "1.1.0", "Tighten trigger", {
    description: "Updated team task slicing.",
    trigger: "ready design",
    enabled: false,
  });
  assert.equal(changed.version, "1.1.0");
  assert.equal(changed.enabled, false);

  const restored = rollbackSkillVersion(dbPath, "team-task-slicing-skill", "1.0.0");
  assert.equal(restored.version, "1.0.0");
  assert.equal(restored.description, "Initial team task slicing.");
  assert.equal(restored.enabled, true);
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "skill-center-")), ".autobuild", "autobuild.db");
}

function objectSchema(required: string[]) {
  return {
    schema_version: "1.0.0",
    type: "object" as const,
    required,
    properties: Object.fromEntries(required.map((name) => [name, { type: "string" as const }])),
    additionalProperties: true,
  };
}
