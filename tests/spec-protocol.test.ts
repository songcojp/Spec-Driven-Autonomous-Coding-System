import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addClarificationAnswer,
  buildRequirementChecklist,
  createFeatureSpec,
  createSpecSlice,
  createSpecVersion,
  projectSpecArtifact,
  mergeFileSpecState,
  readFileSpecState,
  recordSpecVersion,
  scanSpecSources,
  specStateRelativePath,
  writeFileSpecState,
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

test("file spec state reads, merges, writes, and blocks path escapes", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-state-"));
  mkdirSync(join(root, "docs", "features", "feat-001-demo"), { recursive: true });
  const initial = readFileSpecState(root, "feat-001-demo", "FEAT-001", stableDate);
  const merged = mergeFileSpecState(initial, {
    status: "blocked",
    executionStatus: "blocked",
    blockedReasons: ["Missing tasks.md"],
    nextAction: "Complete tasks.md, then resume.",
  }, {
    now: stableDate,
    source: "test",
    summary: "Blocked by incomplete Feature Spec.",
    executionId: "RUN-1",
  });
  const relativePath = writeFileSpecState(root, "feat-001-demo", merged);
  const reread = readFileSpecState(root, "feat-001-demo", "FEAT-001", stableDate);

  assert.equal(relativePath, "docs/features/feat-001-demo/spec-state.json");
  assert.equal(specStateRelativePath("feat-001-demo"), relativePath);
  assert.equal(existsSync(join(root, relativePath)), true);
  assert.equal(reread.status, "blocked");
  assert.equal(reread.executionStatus, "blocked");
  assert.deepEqual(reread.blockedReasons, ["Missing tasks.md"]);
  assert.equal(reread.history.at(-1)?.executionStatus, "blocked");
  assert.equal(reread.history.at(-1)?.executionId, "RUN-1");
  assert.throws(() => specStateRelativePath("../outside"), /inside docs\/features/);
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

test("scanSpecSources returns scan results for existing project spec files", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-scan-"));

  // Create a minimal project structure
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "docs", "features", "feat-001"), { recursive: true });
  mkdirSync(join(root, "docs", "features", "feat-002"), { recursive: true });

  writeFileSync(join(root, "README.md"), "# My Project\nREQ-001 is satisfied by FEAT-001.");
  writeFileSync(join(root, "docs", "PRD.md"), "## Root PRD\n# Goal\nCreate a project from root docs.");
  writeFileSync(join(root, "docs", "requirements.md"),
    "REQ-001: The system shall create a project.\nREQ-002: The system shall validate input.");
  writeFileSync(join(root, "docs", "hld.md"), "## HLD\nFEAT-001 covers REQ-001.");

  // feat-001 has all three files
  writeFileSync(join(root, "docs", "features", "feat-001", "requirements.md"), "REQ-001, REQ-002");
  writeFileSync(join(root, "docs", "features", "feat-001", "design.md"), "## Design for FEAT-001");
  writeFileSync(join(root, "docs", "features", "feat-001", "tasks.md"), "- [ ] TASK-001: Implement REQ-001");

  // feat-002 has requirements but no design or tasks
  writeFileSync(join(root, "docs", "features", "feat-002", "requirements.md"), "REQ-002");

  const stableDate = new Date("2026-04-29T00:00:00.000Z");
  const summary = scanSpecSources(root, stableDate);

  assert.equal(summary.projectPath, root);
  assert.equal(summary.scannedAt, stableDate.toISOString());

  const fileTypes = summary.sources.map((s) => s.fileType);
  assert.ok(fileTypes.includes("README"), "README should be scanned");
  assert.ok(fileTypes.includes("PRD"), "PRD should be scanned");
  assert.ok(fileTypes.includes("EARS"), "requirements.md should be scanned as EARS");
  assert.ok(fileTypes.includes("HLD"), "hld.md should be scanned");
  assert.ok(fileTypes.includes("feature-requirements"), "feature requirements should be scanned");
  assert.ok(fileTypes.includes("design"), "feature design should be scanned");
  assert.ok(summary.sources.some((source) => source.relativePath === "docs/PRD.md" && source.fileType === "PRD"));
  assert.ok(fileTypes.includes("tasks"), "feature tasks should be scanned");

  // All returned sources should exist
  assert.ok(summary.sources.every((s) => s.exists), "All scanned sources should exist");
});

test("scanSpecSources ignores single localized lane unless multilingual docs are declared", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-scan-single-localized-"));
  mkdirSync(join(root, "docs", "zh-CN"), { recursive: true });
  writeFileSync(join(root, "docs", "zh-CN", "PRD.md"), "# Localized PRD\n");
  writeFileSync(join(root, "docs", "zh-CN", "requirements.md"), "# Localized Requirements\n");

  const summary = scanSpecSources(root);

  assert.equal(summary.sources.some((source) => source.relativePath === "docs/zh-CN/PRD.md"), false);
  assert.equal(summary.sources.some((source) => source.relativePath === "docs/zh-CN/requirements.md"), false);
});

test("scanSpecSources detects trace IDs in spec files", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-scan-trace-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "docs", "features", "feat-001"), { recursive: true });

  writeFileSync(join(root, "docs", "requirements.md"),
    "REQ-001: The system shall validate.\nREQ-002: The system shall record.\nNFR-001: Performance under 200ms.\nEDGE-001: Empty input is rejected.");
  writeFileSync(join(root, "docs", "features", "feat-001", "requirements.md"), "Covers REQ-001, REQ-002");
  writeFileSync(join(root, "docs", "features", "feat-001", "design.md"), "## Design\nFEAT-001");
  writeFileSync(join(root, "docs", "features", "feat-001", "tasks.md"), "TASK-001: implement REQ-001");

  const summary = scanSpecSources(root);

  const earsSrc = summary.sources.find((s) => s.fileType === "EARS");
  assert.ok(earsSrc, "Should find EARS source");
  assert.ok(earsSrc.traceIds.includes("REQ-001"));
  assert.ok(earsSrc.traceIds.includes("REQ-002"));
  assert.ok(earsSrc.traceIds.includes("NFR-001"));
  assert.ok(earsSrc.traceIds.includes("EDGE-001"));
});

test("scanSpecSources detects missing design file when tasks exist", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-scan-miss-"));
  mkdirSync(join(root, "docs", "features", "feat-003"), { recursive: true });

  // Tasks without design
  writeFileSync(join(root, "docs", "features", "feat-003", "requirements.md"), "REQ-010: The system shall run.");
  writeFileSync(join(root, "docs", "features", "feat-003", "tasks.md"), "- [x] TASK-001 done");

  const summary = scanSpecSources(root);

  const missingDesign = summary.missingItems.find((m) => m.kind === "missing_design");
  assert.ok(missingDesign, "Should detect missing design.md");
  assert.ok(missingDesign.description.includes("feat-003"));
  assert.ok(missingDesign.relatedPath.includes("feat-003"));
});

test("scanSpecSources detects missing requirements file when tasks exist", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-scan-miss2-"));
  mkdirSync(join(root, "docs", "features", "feat-004"), { recursive: true });

  // Tasks without requirements
  writeFileSync(join(root, "docs", "features", "feat-004", "design.md"), "## Design");
  writeFileSync(join(root, "docs", "features", "feat-004", "tasks.md"), "TASK-001: implement something");

  const summary = scanSpecSources(root);

  const missingReqs = summary.missingItems.find((m) => m.kind === "missing_requirements");
  assert.ok(missingReqs, "Should detect missing requirements.md");
  assert.ok(missingReqs.description.includes("feat-004"));
});

test("scanSpecSources detects orphaned traceability (REQ not in any feature spec)", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-scan-orphan-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "docs", "features", "feat-001"), { recursive: true });

  // REQ-001 and REQ-002 in EARS, only REQ-001 in feature spec
  writeFileSync(join(root, "docs", "requirements.md"), "REQ-001: feature one.\nREQ-002: unassigned requirement.");
  writeFileSync(join(root, "docs", "features", "feat-001", "requirements.md"), "REQ-001");
  writeFileSync(join(root, "docs", "features", "feat-001", "design.md"), "REQ-001 design.");
  writeFileSync(join(root, "docs", "features", "feat-001", "tasks.md"), "TASK-001: implement REQ-001");

  const summary = scanSpecSources(root);

  const orphaned = summary.missingItems.find((m) => m.kind === "orphaned_traceability");
  assert.ok(orphaned, "Should detect orphaned REQ-002");
  assert.ok(orphaned.description.includes("REQ-002"));

  const clarItem = summary.clarificationItems.find((c) => c.type === "orphaned");
  assert.ok(clarItem, "Should generate clarification for orphaned traceability");
  assert.ok(clarItem.description.includes("REQ-002"));
});

test("scanSpecSources scan summary integrates into createFeatureSpec clarification log", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-scan-integrate-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "docs", "features", "feat-001"), { recursive: true });

  writeFileSync(join(root, "docs", "requirements.md"), "REQ-001: validate.\nREQ-999: unassigned requirement.");
  writeFileSync(join(root, "docs", "features", "feat-001", "requirements.md"), "REQ-001");
  writeFileSync(join(root, "docs", "features", "feat-001", "design.md"), "Design for REQ-001.");
  writeFileSync(join(root, "docs", "features", "feat-001", "tasks.md"), "TASK-001");

  const scanSummary = scanSpecSources(root);

  // scanSummary should have clarification items for the orphaned REQ-999
  assert.ok(scanSummary.clarificationItems.length > 0);

  const spec = createFeatureSpec({
    featureId: "FEAT-SCAN-TEST",
    now: new Date("2026-04-29T00:00:00.000Z"),
    rawInput: `
Goal: Validate scan integration.
Roles: developer
Assumptions: Source docs are available.
PRD: When the scan runs, the system shall detect missing traceability.
`,
    scanSummary,
  });

  // Spec clarification log should include entries from the scan summary
  const scanEntries = spec.clarificationLog.filter((e) => e.id.startsWith("CLAR-1"));
  assert.ok(scanEntries.length > 0, "Scan clarifications should appear in clarification log");
  assert.ok(spec.status === "review_needed", "Spec with orphaned traceability should be review_needed");
});

test("scanSpecSources is read-only and does not modify project files", () => {
  const root = mkdtempSync(join(tmpdir(), "spec-scan-readonly-"));
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, "docs", "requirements.md"), "REQ-001: The system shall validate.");
  const mtime = readFileSync(join(root, "docs", "requirements.md")).length;

  scanSpecSources(root);

  // File should be unchanged
  const mtimeAfter = readFileSync(join(root, "docs", "requirements.md")).length;
  assert.equal(mtime, mtimeAfter, "scanSpecSources must not modify spec files");
  // No new files created
  assert.equal(existsSync(join(root, "docs", "zh-CN", "hld.md")), false, "Scanner must not create missing files");
});
