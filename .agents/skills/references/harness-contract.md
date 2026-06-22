# Harness Contract

This document defines the shared harness rules that apply across all SpecDrive skills. Every skill that participates in the SpecDrive execution lifecycle must follow these contracts.

## Model: Agent = Model + Harness

The SpecDrive skill system is the **Harness**. The LLM (Codex, Gemini, etc.) is the **Model**. The Harness governs what the Model sees, how it acts, and how its output is validated.

> Source: Birgitta Böckeler, "Harness Engineering for Coding Agent Users" (martinfowler.com, 2025–2026)

## Three Harness Types

| Type | Responsibility | SpecDrive Skills |
|---|---|---|
| **Maintainability Harness** | Code quality, naming, complexity, coverage | `review-code-spec`, `validate-requirements` |
| **Architecture Fitness Harness** | Module boundaries, dependency direction, HLD compliance | `design-architecture`, `review-code-spec` |
| **Behaviour Harness** | User journeys, UI interactions, acceptance criteria | `design-ui-spec`, `verify-behavior`, `review-delivery-evidence` |

## Two Control Mechanisms

### Guides (Feed-forward — run before execution)

Guides steer the Model before it acts. They are always active.

- `AGENTS.md` — project-level operating rules and skill routing
- `SKILL.md` files — skill-level workflow, guidance, and boundaries
- Feature Spec `design.md` — feature-level design constraints and interaction contracts
- `docs/agentic-spec/ui/coverage/` — UI Coverage Contract (DHI-### / TM-### design targets)
- `templates/` — output format contracts

**Rule:** Do not skip reading Guides to save tokens. A plan formed without reading active Guides is invalid.

### Sensors (Feedback — run after execution)

Sensors observe the Model's work. They come in two subtypes:

#### Computational Sensors (deterministic, fast, run first)

Must run and pass before any inferential Sensor may declare a result:

| Sequence | Sensor | Command pattern |
|---|---|---|
| 1 | Whitespace check | `git diff --check` |
| 2 | Lint | `npm run lint` / project-specific |
| 3 | Type check | `tsc --noEmit` / project-specific |
| 4 | Unit tests | Targeted `npm test -- <pattern>` |
| 5 | Integration tests | When shared behavior or persistence is changed |
| 6 | Browser / acceptance tests | For UI/App Features with `TM-###` oracle rows |

#### Inferential Sensors (probabilistic, run after computational)

| Sensor | Provided by |
|---|---|
| Code diff review | `review-code-spec` |
| Evidence completeness review | `review-delivery-evidence` |
| Coverage matrix | `package-evidence` |

**Rule:** An inferential Sensor may NOT declare a Feature `completed` if any scheduled computational Sensor has a non-passing exit status. Record missed sensors as `sensorSkipReason` and route to `manual-gated`.

## Observe → Plan → Act → Sense Loop

```
Observe   → read spec-state.json, checkpoint, ledger, Sensor results
Plan      → select Features, assign task→executor, declare Sensors, flag HITL
Act       → dispatch executor, record executionTrace[]
Sense     → run computational Sensors, then inferential Sensors
              │
              ├── all pass → advance Feature status
              └── any fail → route to recover-execution (Reflection)
```

The loop repeats until all Features reach `completed` or `blocked`.

## HITL Gate List

The following actions MUST NOT execute without explicit human approval:

| Gate Name | Condition |
|---|---|
| `pr_merge` | Merging a Feature PR to the main branch |
| `destructive_migration` | Running irreversible database or state migrations |
| `production_deploy` | Triggering production environment deployments |
| `sensor_override` | Overriding a computational Sensor that failed 3 times |
| `coverage_contract_gap_bypass` | Marking UI Feature `completed` with empty `stitchScreenIds` |

Return `approval_needed` with `gateName`, `condition`, and `evidence` when a gate is reached.

## Execution Trace Schema

All skills that dispatch or execute work must append to `result.executionTrace[]`:

```json
{
  "executionTrace": [
    {
      "step": "dispatch | sensor | reflection | hitl | complete",
      "taskId": "TASK-001",
      "skillName": "implement-feature",
      "executorRole": "codex-cli",
      "at": "<ISO-8601>",
      "sourceFiles": ["path/to/file"],
      "expectedSensors": ["lint", "unit-tests"],
      "actualSensorResults": {
        "lint": "pass",
        "unit-tests": "pass"
      },
      "outcome": "pass | fail | blocked | skipped",
      "outcomeDetail": "<brief>"
    }
  ]
}
```

## Reflection Record Schema

`recover-execution` must produce a `ReflectionRecord` before any recovery action:

```json
{
  "reflectionRecord": {
    "failureType": "context_gap | guardrail_block | execution_error | sensor_failure | spec_ambiguity",
    "failureCause": "<which file, step, assertion, or sensor>",
    "guideUsed": ["AGENTS.md#section", "SKILL.md#section"],
    "sensorRan": {"lint": 0, "unit-tests": 1},
    "sensorSkipped": ["integration-tests"],
    "sensorSkipReason": "<reason>",
    "inferentialJudgement": "<verbatim key finding or null>",
    "selfCritique": "<one-paragraph critique>",
    "retryCount": 1,
    "retryBudgetRemaining": 2,
    "recoveryAction": "enrich-context | targeted-repair | escalate | blocked"
  }
}
```

## Context Budget Guidelines

To prevent context overload, skills must apply Context Engineering discipline:

| Context Type | Purpose | Priority |
|---|---|---|
| **Procedural** | Rules, skills, templates (Guides) | Always load |
| **Factual** | Source files, spec docs, test evidence | Load only what the current task references |
| **Relational** | Dependency graphs, traceability ledger | Load only for planning and review phases |

Do not paste entire documents into prompts. Pass paths, IDs, and section anchors. Use `collect-project-context` to curate context before planning or implementation.
