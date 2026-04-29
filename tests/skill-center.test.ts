import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeSchema, listTables } from "../src/schema.ts";
import { countProjectSkills, listProjectSkills, readProjectSkill } from "../src/skills.ts";

test("schema removes SQL skill registry and custom context broker tables", () => {
  const dbPath = makeDbPath();
  initializeSchema(dbPath);

  const tables = listTables(dbPath);
  for (const table of [
    "skills",
    "skill_versions",
    "skill_runs",
    "schema_validation_results",
    "skill_project_overrides",
    "agent_run_contracts",
    "context_slice_refs",
    "result_merges",
  ]) {
    assert.equal(tables.includes(table), false, `${table} should not exist`);
  }
  assert.equal(tables.includes("recovery_dispatches"), true);
});

test("project skill discovery reads SKILL.md files from .agents/skills", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-discovery-"));
  writeSkill(root, "feature-spec-execution", `---
name: feature-spec-execution
description: "Execute a feature spec with CLI-native delegation."
---

# Feature Spec Execution
`);
  writeSkill(root, "parse-prd-to-ears", `# Parse PRD to EARS
`);
  mkdirSync(join(root, ".agents", "skills", "missing-skill-file"), { recursive: true });

  const skills = listProjectSkills({ root });

  assert.deepEqual(skills.map((skill) => skill.slug), ["feature-spec-execution", "parse-prd-to-ears"]);
  assert.equal(skills[0].name, "feature-spec-execution");
  assert.equal(skills[0].description, "Execute a feature spec with CLI-native delegation.");
  assert.equal(skills[1].name, "parse-prd-to-ears");
  assert.equal(skills[1].description, "Parse PRD to EARS");
  assert.equal(countProjectSkills({ root }), 2);
});

test("single skill read uses folder slug as stable identity", () => {
  const root = mkdtempSync(join(tmpdir(), "single-skill-discovery-"));
  const skillDir = writeSkill(root, "custom-review", `---
name: Team Review
---

# Team Review
`);

  const skill = readProjectSkill(skillDir);

  assert.equal(skill?.slug, "custom-review");
  assert.equal(skill?.name, "Team Review");
  assert.equal(skill?.path, join(skillDir, "SKILL.md"));
});

function makeDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "skill-center-")), ".autobuild", "autobuild.db");
}

function writeSkill(root: string, slug: string, content: string): string {
  const skillDir = join(root, ".agents", "skills", slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content, "utf8");
  return skillDir;
}
