---
name: collect-project-context
description: "Collect source-backed project context for SpecDrive work. Use when Codex needs repository facts, relevant specs, commands, constraints, file ownership, implementation patterns, or project constitution context before planning or execution."
---

# Project Context Collection

## Workflow

1. Confirm the requested outcome, source artifacts, workspace root, and allowed scope.
2. Read referenced files from disk and pass paths, IDs, and section anchors instead of pasted document bodies.
3. Apply this skill's workflow only to its declared responsibility; route adjacent lifecycle work to another project skill.
4. Produce or review the requested artifacts with traceability to PRD, requirements, HLD, Feature Spec, execution records, tests, or evidence as applicable.
5. Return the runtime-supplied structured output shape exactly. Echo `executionId`, `skillName`, `requestedAction`, produced artifacts, next action, and Feature-level traceability when the adapter provides them.

## Guidance

Read only the referenced artifacts and targeted repository files. Return compact facts, relevant paths, commands, constraints, unknowns, and confidence. Do not edit files.

## Harness: Context Engineering

This skill acts as the **Context Engineering** layer in the Agent Harness architecture. Its output directly shapes what the Model sees in the Observe phase of the Observe-Plan-Act loop. Poor context selection causes `context_gap` failures; over-inclusive context wastes context budget and degrades plan quality.

### Context Classification

Classify all collected context into three types before returning it:

| Type | Description | Load policy |
|---|---|---|
| **Procedural Context** | Guides: AGENTS.md, SKILL.md files, templates, constitutions | Always load; these are active constraints on every invocation |
| **Factual Context** | Specific source files, spec docs, code snippets, test outputs, checkpoint data | Load only what the current task explicitly references; use paths and anchors, not full documents |
| **Relational Context** | Dependency graphs, traceability ledger, feature pool queue, HLD relationships | Load only for planning and review phases; not needed for bounded execution tasks |

### Context Budget Rules

- Pass file paths, IDs, and section anchors to downstream skills instead of pasting full document bodies.
- Limit Factual Context to the smallest set of files that directly constrain the current task. Prefer anchored sections (`requirements.md#acceptance-criteria`) over full-file pastes.
- For Feature execution, Factual Context must include: `requirements.md`, `design.md`, `tasks.md`, relevant source files in `Allowed Paths`, and the most recent `checkpoint.json`.
- For planning, Factual Context must include: `feature-pool-queue.json`, candidate `spec-state.json` files, and the `traceability-ledger.md` for UI Features.
- Do not include files outside the declared `Allowed Paths` for the current Feature.

### Confidence Output

Return a `contextConfidence` field with the collected context:

```json
{
  "contextConfidence": {
    "score": "high | medium | low",
    "missingFacts": ["<what is unknown>"],
    "ambiguousFacts": ["<what is uncertain>"],
    "staleRisk": ["<files that may be outdated>"]
  }
}
```

If `score` is `low`, route to `clarification_needed` before allowing planning or execution to proceed.

## References

- Read `references/harness-contract.md` to understand the Observe-Plan-Act loop, Harness types, Sensor priority, HITL gates, and execution trace schema that govern all SpecDrive skills.
- Read `references/specdrive-output.md` when invoked by an adapter that requires structured execution output.
- Read `references/quality-loop.md` when this skill creates or updates Spec documents that must pass a review and repair loop before downstream use.

## Boundaries

- Do not rely on old dotted Skill names or compatibility aliases.
- Do not hardcode product-specific UI, database, scheduler, or adapter behavior unless the invocation supplies it as a source constraint.
- Surface missing decisions as `clarification_needed`, `review_needed`, `risk_review_needed`, or `blocked` instead of inventing facts.
