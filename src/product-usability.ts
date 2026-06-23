export const PRODUCT_USABILITY_PROTOCOL_STRUCTURES = [
  "LifecycleHandoff",
  "SkillWrapperContract",
  "DecisionLog",
  "ProtocolGap",
  "UsabilityEvidence",
  "ReferencePatternMap",
] as const;

export type ProductUsabilityProtocolStructure = typeof PRODUCT_USABILITY_PROTOCOL_STRUCTURES[number];
export type LifecycleStage = "Define" | "Plan" | "Build" | "Verify" | "Review" | "Ship";
export type ProductUsabilityRisk = "low" | "medium" | "high";
export type ProductUsabilitySeverity = "P0" | "P1" | "P2" | "P3";
export type ProductUsabilityEvidenceMode = "browser" | "manual" | "unit" | "integration" | "fixture" | "seed" | "text";
export type ProtocolGapCategory =
  | "source_gap"
  | "story_gap"
  | "journey_gap"
  | "interaction_gap"
  | "state_data_gap"
  | "test_semantics_gap"
  | "runtime_gap"
  | "review_gap"
  | "ship_gap"
  /** DHI-### or TM-### references are missing from Feature spec-state.json */
  | "coverage_contract_gap"
  /** UH-### user scenario has not been defined for a UI/App Feature */
  | "user_understanding_gap"
  /** deliveryHarnessRef.harnessStatus is not "ready" before Feature execution */
  | "harness_gap"
  /** deliveryHarnessRef.stitchScreenIds is empty; design not yet WYSIWYG-verified */
  | "design_gap";


export type DecisionLogType =
  | "auto_decided"
  | "open_question"
  | "blocking_open_question"
  | "autonomous_repair"
  | "human_approved"
  | "rejected_or_deferred";

export type DecisionLogEntry = {
  id: string;
  type: DecisionLogType;
  summary: string;
  sourceRefs?: string[];
  rationale: string;
  rejectedAlternatives?: string[];
  risk: ProductUsabilityRisk;
  affectedArtifacts: string[];
  verification: string[];
  status: "accepted" | "open" | "blocked" | "closed" | "deferred";
};

export type SkillWrapperContract = {
  skillName: string;
  lifecycleStage: LifecycleStage;
  requiredSourceRefs: string[];
  allowedDecisionTypes: DecisionLogType[];
  requiredOutputFields: ProductUsabilityProtocolStructure[];
  handoffReadiness: string[];
  antiRationalizationChecks: string[];
  verificationEvidence: string[];
};

export type ProtocolGap = {
  id: string;
  category: ProtocolGapCategory;
  severity: ProductUsabilitySeverity;
  status: "open" | "closed" | "deferred" | "accepted";
  message: string;
  affectedStories: string[];
  affectedJourneys: string[];
  evidenceRefs: string[];
  resumeStage: LifecycleStage;
};

export type UsabilityEvidence = {
  id: string;
  userStoryId: string;
  journeyId: string;
  checkpointId: string;
  mode: ProductUsabilityEvidenceMode;
  status: "passed" | "failed" | "blocked";
  assertion: string;
  evidenceRefs: string[];
};

export type LifecycleHandoff = {
  id: string;
  from: LifecycleStage;
  to: LifecycleStage;
  owner: string;
  inputRefs: string[];
  outputRefs: string[];
  preservedObligations?: string[];
  evidenceRefs: string[];
  status: "passed" | "failed" | "blocked";
};

export type ReferencePatternMapEntry = {
  source: "superpowers" | "agent-skills" | "everything-claude-code";
  workflow: string;
  specdriveStage: LifecycleStage;
  localRule: string;
  localSkill: string;
  evidenceField: ProductUsabilityProtocolStructure;
};

export type ProductUsabilityGateInput = {
  priorityStories: string[];
  decisionLog?: DecisionLogEntry[];
  skillWrapperContracts?: SkillWrapperContract[];
  protocolGaps?: ProtocolGap[];
  usabilityEvidence?: UsabilityEvidence[];
  lifecycleHandoffs?: LifecycleHandoff[];
  referencePatternMap?: ReferencePatternMapEntry[];
  invalidFields?: string[];
};

export type ProductUsabilityValidationResult = {
  valid: boolean;
  reasons: string[];
};

export type ProductUsabilityGateResult = {
  passed: boolean;
  reason?: "product_usability_gap";
  triggers: string[];
  details: string[];
  gaps: ProtocolGap[];
};

export function validateDecisionLog(entries: DecisionLogEntry[] | undefined): ProductUsabilityValidationResult {
  const reasons: string[] = [];
  for (const entry of entries ?? []) {
    if (!nonEmptyArray(entry.sourceRefs)) reasons.push(`DecisionLog ${entry.id} requires sourceRefs.`);
    if (!nonEmptyArray(entry.affectedArtifacts)) reasons.push(`DecisionLog ${entry.id} requires affectedArtifacts.`);
    if (!nonEmptyArray(entry.verification)) reasons.push(`DecisionLog ${entry.id} requires verification.`);
  }
  return { valid: reasons.length === 0, reasons };
}

export function validateSkillWrapperContract(entries: SkillWrapperContract[] | SkillWrapperContract | undefined): ProductUsabilityValidationResult {
  const reasons: string[] = [];
  for (const entry of Array.isArray(entries) ? entries : entries ? [entries] : []) {
    const label = nonEmptyString(entry.skillName) ? entry.skillName : "(unnamed skill)";
    if (!nonEmptyString(entry.skillName)) reasons.push("SkillWrapperContract requires skillName.");
    if (!nonEmptyArray(entry.requiredSourceRefs)) reasons.push(`SkillWrapperContract ${label} requires requiredSourceRefs.`);
    if (!nonEmptyArray(entry.allowedDecisionTypes)) reasons.push(`SkillWrapperContract ${label} requires allowedDecisionTypes.`);
    if (!nonEmptyArray(entry.requiredOutputFields)) reasons.push(`SkillWrapperContract ${label} requires requiredOutputFields.`);
    if (!nonEmptyArray(entry.handoffReadiness)) reasons.push(`SkillWrapperContract ${label} requires handoffReadiness.`);
    if (!nonEmptyArray(entry.antiRationalizationChecks)) reasons.push(`SkillWrapperContract ${label} requires antiRationalizationChecks.`);
    if (!nonEmptyArray(entry.verificationEvidence)) reasons.push(`SkillWrapperContract ${label} requires verificationEvidence.`);
  }
  return { valid: reasons.length === 0, reasons };
}

export function validateProtocolGaps(entries: ProtocolGap[] | undefined): ProductUsabilityValidationResult {
  const reasons: string[] = [];
  for (const entry of entries ?? []) {
    if (!nonEmptyArray(entry.affectedStories)) reasons.push(`ProtocolGap ${entry.id} requires affectedStories.`);
    if (!nonEmptyArray(entry.affectedJourneys)) reasons.push(`ProtocolGap ${entry.id} requires affectedJourneys.`);
    if (!nonEmptyArray(entry.evidenceRefs)) reasons.push(`ProtocolGap ${entry.id} requires evidenceRefs.`);
  }
  return { valid: reasons.length === 0, reasons };
}

export function validateUsabilityEvidence(entries: UsabilityEvidence[] | undefined): ProductUsabilityValidationResult {
  const reasons: string[] = [];
  for (const entry of entries ?? []) {
    if (!nonEmptyArray(entry.evidenceRefs)) reasons.push(`UsabilityEvidence ${entry.id} requires evidenceRefs.`);
    if (entry.status === "passed" && fixtureOnlyEvidenceModes.includes(entry.mode)) {
      reasons.push(`UsabilityEvidence ${entry.id} cannot use fixture-only evidence for product usability.`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}

export function validateLifecycleHandoffs(entries: LifecycleHandoff[] | undefined): ProductUsabilityValidationResult {
  const reasons: string[] = [];
  for (const entry of entries ?? []) {
    if (!nonEmptyArray(entry.preservedObligations)) reasons.push(`LifecycleHandoff ${entry.id} requires preservedObligations.`);
    if (!nonEmptyArray(entry.evidenceRefs)) reasons.push(`LifecycleHandoff ${entry.id} requires evidenceRefs.`);
  }
  return { valid: reasons.length === 0, reasons };
}

export function validateReferencePatternMap(entries: ReferencePatternMapEntry[] | undefined): ProductUsabilityValidationResult {
  const reasons: string[] = [];
  const sources = new Set((entries ?? []).map((entry) => entry.source));
  for (const source of ["superpowers", "agent-skills", "everything-claude-code"] as const) {
    if (!sources.has(source)) reasons.push(`ReferencePatternMap requires at least one ${source} workflow.`);
  }
  for (const entry of entries ?? []) {
    if (!PRODUCT_USABILITY_PROTOCOL_STRUCTURES.includes(entry.evidenceField)) {
      reasons.push(`ReferencePatternMap ${entry.source}:${entry.workflow} references unknown evidenceField ${entry.evidenceField}.`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}

export function assessProductUsabilityGate(input: ProductUsabilityGateInput | undefined): ProductUsabilityGateResult {
  if (!input) return { passed: true, triggers: [], details: ["Product usability evidence not provided."], gaps: [] };

  const validationReasons = [
    ...(input.invalidFields ?? []).map((field) => `productUsability.${field} must be an array when provided.`),
    ...validateDecisionLog(input.decisionLog).reasons,
    ...validateSkillWrapperContract(input.skillWrapperContracts).reasons,
    ...validateProtocolGaps(input.protocolGaps).reasons,
    ...validateUsabilityEvidence(input.usabilityEvidence).reasons,
    ...validateLifecycleHandoffs(input.lifecycleHandoffs).reasons,
  ];
  const openCriticalGaps = (input.protocolGaps ?? []).filter((gap) =>
    gap.status === "open" && (gap.severity === "P0" || gap.severity === "P1")
  );
  const priorityStories = new Set(input.priorityStories);
  const coveredStories = new Set((input.usabilityEvidence ?? [])
    .filter((entry) => entry.status === "passed" && !fixtureOnlyEvidenceModes.includes(entry.mode))
    .map((entry) => entry.userStoryId));
  const missingStories = [...priorityStories].filter((story) => !coveredStories.has(story));
  const syntheticGaps = missingStories.map((story): ProtocolGap => ({
    id: `missing-usability-evidence-${story}`,
    category: "runtime_gap",
    severity: "P1",
    status: "open",
    message: `P0/P1 story ${story} lacks runtime or equivalent usability evidence.`,
    affectedStories: [story],
    affectedJourneys: [`missing-journey-${story}`],
    evidenceRefs: [`missing-usability-evidence-${story}`],
    resumeStage: "Verify",
  }));
  const gaps = [...openCriticalGaps, ...syntheticGaps];
  const details = [
    ...validationReasons,
    ...gaps.map((gap) => `${gap.id}: ${gap.message}`),
  ];
  if (details.length > 0) {
    return {
      passed: false,
      reason: "product_usability_gap",
      triggers: ["product_usability_gap", ...gaps.map((gap) => gap.category)],
      details,
      gaps,
    };
  }
  return { passed: true, triggers: [], details: ["Product Usability Gate passed."], gaps: [] };
}

const fixtureOnlyEvidenceModes: ProductUsabilityEvidenceMode[] = ["fixture", "seed", "text"];

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
