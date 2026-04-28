import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addClarificationAnswer,
  buildRequirementChecklist,
  createFeatureSpec,
  createSpecSlice,
  createSpecVersion,
  projectSpecArtifact,
  recordSpecVersion,
} from "../src/spec-protocol.ts";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

test("creates traceable atomic requirements from mixed requirement input", () => {
  const spec = createFeatureSpec({
    featureId: "FEAT-002",
    name: "Spec Protocol Foundation",
    now: stableDate,
    rawInput: `
Goal: Turn raw requirements into reviewable specs.
Roles: product manager, developer
Assumptions: Source documents are available.
Related Files: src/spec-protocol.ts, tests/spec-protocol.test.ts
PRD: When raw input is provided, the system shall create a feature spec.
EARS: When requirements are decomposed, the system shall record source traceability.
PR: When invalid input is provided, the system shall block ready status.
RP: When projection is requested, the system shall write deterministic artifact JSON.
`,
  });

  assert.equal(spec.id, "FEAT-002");
  assert.equal(spec.status, "ready");
  assert.equal(spec.requirements.length, 4);
  assert.equal(spec.acceptanceCriteria.length, 4);
  assert.equal(spec.testScenarios.length, 4);
  assert.equal(spec.checklist.blocksReady, false);

  for (const requirement of spec.requirements) {
    assert.equal(requirement.atomic, true);
    assert.equal(requirement.observable, true);
    assert.equal(requirement.trace.featureId, spec.id);
    assert.equal(requirement.trace.acceptanceCriteriaIds.length, 1);
    assert.equal(requirement.trace.testScenarioIds.length, 1);
    assert.match(requirement.source.id, /^SRC-/);

    const criteria = spec.acceptanceCriteria.find((entry) => entry.requirementId === requirement.id);
    const scenario = spec.testScenarios.find((entry) => entry.requirementId === requirement.id);
    assert.equal(criteria?.id, requirement.acceptanceCriteriaIds[0]);
    assert.equal(criteria?.source.id, requirement.source.id);
    assert.equal(scenario?.id, requirement.testScenarioIds[0]);
    assert.equal(scenario?.acceptanceCriteriaId, criteria?.id);
    assert.equal(scenario?.source.id, requirement.source.id);
  }
});

test("ambiguous and conflicting input creates statused clarification entries and blocks ready", () => {
  const spec = createFeatureSpec({
    featureId: "FEAT-AMBIGUOUS",
    now: stableDate,
    rawInput: `
Goal: Maybe support imports later.
Roles: user
Assumptions: Input owners will clarify.
PRD: When imports run, the system shall maybe create a spec.
EARS: When imports run, the system must create a spec and must not create a spec.
`,
  });

  assert.equal(spec.status, "review_needed");
  assert.equal(spec.checklist.blocksReady, true);
  assert.equal(spec.clarificationLog.length, 3);
  assert.equal(spec.clarificationLog.every((entry) => entry.status === "open"), true);
  assert.ok(spec.clarificationLog.every((entry) => entry.source.text.length > 0));
  assert.ok(spec.checklist.items.find((item) => item.category === "ambiguity")?.passed === false);
  assert.ok(spec.checklist.items.find((item) => item.category === "conflicts")?.passed === false);
});

test("checklist includes required categories and prevents automatic ready on missing coverage", () => {
  const spec = createFeatureSpec({
    featureId: "FEAT-INCOMPLETE",
    now: stableDate,
    rawInput: `
Goal: Parse a tiny input.
Roles: user
PRD: When input arrives, the system shall create a draft.
`,
  });
  const categories = spec.checklist.items.map((item) => item.category);

  assert.deepEqual(categories, [
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
  ]);
  assert.equal(spec.status, "review_needed");
  assert.equal(spec.checklist.status, "failed");

  const rebuilt = buildRequirementChecklist(spec);
  assert.equal(rebuilt.blocksReady, true);
});

test("clarification answers update status but unresolved checklist failures still gate ready", () => {
  const spec = createFeatureSpec({
    featureId: "FEAT-CLARIFY",
    now: stableDate,
    rawInput: `
Goal: Maybe normalize incoming text.
Roles: user
Assumptions: Owner can clarify vague words.
PRD: When raw text arrives, the system shall maybe create a normalized spec.
`,
  });
  const clarified = addClarificationAnswer(spec, spec.clarificationLog[0].id, "Create a normalized spec for valid raw text.", stableDate);

  assert.equal(clarified.clarificationLog[0].status, "answered");
  assert.equal(clarified.clarificationLog[0].answer, "Create a normalized spec for valid raw text.");
  assert.equal(clarified.status, "review_needed");
});

test("spec versions support major minor patch bump type and reason", () => {
  assert.deepEqual(createSpecVersion("1.2.3", "MAJOR", "Breaking source model change", stableDate), {
    version: "2.0.0",
    bump: "MAJOR",
    reason: "Breaking source model change",
    createdAt: stableDate.toISOString(),
  });
  assert.equal(createSpecVersion("1.2.3", "MINOR", "New slice mode", stableDate).version, "1.3.0");
  assert.equal(createSpecVersion("1.2.3", "PATCH", "Clarify wording", stableDate).version, "1.2.4");
  assert.throws(() => createSpecVersion("1.0.0", "PATCH", ""), /reason is required/);

  const spec = createFeatureSpec({
    featureId: "FEAT-VERSION",
    now: stableDate,
    rawInput: "PRD: When source input exists, the system shall create a feature spec.",
  });
  const updated = recordSpecVersion(spec, "PATCH", "Refine generated acceptance criteria", stableDate);
  assert.equal(updated.versions.at(-1)?.bump, "PATCH");
  assert.equal(updated.versions.at(-1)?.reason, "Refine generated acceptance criteria");
});

test("spec slices return minimal task-relevant context with source traceability", () => {
  const spec = createFeatureSpec({
    featureId: "FEAT-SLICE",
    now: stableDate,
    rawInput: `
Goal: Slice only relevant context.
Roles: developer
Assumptions: Source docs are stable.
Related Files: src/spec-protocol.ts, src/schema.ts
PRD: When raw input is provided, the system shall create a feature spec.
EARS: When a coding task asks for REQ-002, the system shall return related source traceability.
PR: When invalid input is provided, the system shall block ready status.
RP: When projection is requested, the system shall write deterministic artifact JSON.
`,
  });
  const slice = createSpecSlice(spec, {
    requirementIds: ["REQ-002"],
    relatedFiles: ["src/spec-protocol.ts"],
  });

  assert.deepEqual(slice.trace.requirementIds, ["REQ-002"]);
  assert.deepEqual(slice.trace.acceptanceCriteriaIds, ["AC-002"]);
  assert.deepEqual(slice.trace.testScenarioIds, ["TS-002"]);
  assert.deepEqual(slice.relatedFiles, ["src/spec-protocol.ts"]);
  assert.equal(slice.requirements.length, 1);
  assert.equal(slice.acceptanceCriteria.length, 1);
  assert.equal(slice.testScenarios.length, 1);
  assert.equal(slice.requirements[0].id, "REQ-002");
  assert.equal(slice.acceptanceCriteria[0].requirementId, "REQ-002");
  assert.equal(slice.testScenarios[0].requirementId, "REQ-002");
  assert.equal(slice.requirements.some((requirement) => requirement.id === "REQ-001"), false);
  assert.deepEqual(slice.trace.sourceIds, [spec.requirements[1].source.id]);

  const criteriaOnlySlice = createSpecSlice(spec, {
    acceptanceCriteriaIds: ["AC-003"],
  });
  assert.deepEqual(criteriaOnlySlice.trace.requirementIds, ["REQ-003"]);
  assert.deepEqual(criteriaOnlySlice.trace.acceptanceCriteriaIds, ["AC-003"]);
  assert.deepEqual(criteriaOnlySlice.trace.testScenarioIds, ["TS-003"]);
  assert.equal(criteriaOnlySlice.requirements.length, 1);
  assert.equal(criteriaOnlySlice.acceptanceCriteria.length, 1);
  assert.equal(criteriaOnlySlice.testScenarios.length, 1);
});

test("projects feature specs into .autobuild specs artifact JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-protocol-"));
  const spec = createFeatureSpec({
    featureId: "FEAT-PROJECT",
    now: stableDate,
    rawInput: `
Goal: Project spec artifacts.
Roles: reviewer
Assumptions: Artifact root exists or can be created.
PRD: When projection is requested, the system shall write deterministic artifact JSON.
PR: When invalid input is provided, the system shall block ready status.
EARS: When source context is present, the system shall record source traceability.
RP: When review starts, the system shall return spec JSON for inspection.
`,
  });

  const path = projectSpecArtifact(spec, join(root, ".autobuild"));
  assert.equal(path, join(root, ".autobuild", "specs", "FEAT-PROJECT.json"));
  assert.equal(existsSync(path), true);

  const projected = JSON.parse(readFileSync(path, "utf8")) as {
    id: string;
    requirements: unknown[];
    acceptanceCriteria: unknown[];
    testScenarios: unknown[];
    sources: unknown[];
  };
  assert.equal(projected.id, "FEAT-PROJECT");
  assert.equal(projected.requirements.length, spec.requirements.length);
  assert.equal(projected.acceptanceCriteria.length, spec.acceptanceCriteria.length);
  assert.equal(projected.testScenarios.length, spec.testScenarios.length);
  assert.equal(projected.sources.length, spec.sources.length);
});

test("rejects unsafe spec artifact ids before projection", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-protocol-"));
  const spec = createFeatureSpec({
    featureId: "../FEAT-ESCAPE",
    now: stableDate,
    rawInput: `
Goal: Project spec artifacts safely.
Roles: reviewer
Assumptions: Artifact root exists or can be created.
PRD: When projection is requested, the system shall write deterministic artifact JSON.
PR: When invalid input is provided, the system shall block ready status.
EARS: When source context is present, the system shall record source traceability.
RP: When review starts, the system shall return spec JSON for inspection.
`,
  });

  assert.throws(() => projectSpecArtifact(spec, join(root, ".autobuild")), /Invalid spec artifact id/);
});
