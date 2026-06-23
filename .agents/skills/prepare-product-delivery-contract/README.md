# Prepare Product Delivery Contract

This skill creates a complete, coded downstream-consumption package that links every business workflow, UI structure, user operation, system state change, design-tool input, and automated verification oracle into a single traceable contract.

Its product goal is to prepare WYSIWYG inputs for design and acceptance: Figma, Stitch, screenshots, prototypes, implementation, rendered UI evidence, and acceptance tests should describe and verify the same user-visible product after the dedicated design skill completes the design work. It produces design-ready consumption targets and automation-ready acceptance rows, not final design screens.

## Source And Publish

- Source directory: `skills/prepare-product-delivery-contract`
- Published skill name: `prepare-product-delivery-contract`
- Published directory: `~/.agents/skills/prepare-product-delivery-contract` (agents), `~/.codex/skills/prepare-product-delivery-contract` (Codex), `~/.claude/skills/prepare-product-delivery-contract` (Claude)

Install via the repository installer:

```bash
python3 install_skills.py install --target agents --skills prepare-product-delivery-contract
```

Or install alongside related skills:

```bash
python3 install_skills.py install --target codex \
  --skills prepare-product-delivery-contract,stitch-design-coverage,work-package-delivery-loop
```

## When To Use

Use this skill when:

- Creating or updating a 功能地图, workflow contract, UI interaction tree, design-consumption package, or acceptance automation matrix for a software product.
- Building a test acceptance matrix or automated UI test plan from requirements or design.
- Preparing structured inputs for Stitch, Figma, or product-design skills from workflows, UI states, and acceptance criteria.
- Connecting existing Figma, Stitch, screenshots, or prototypes to implementation-ready UI nodes and acceptance-test evidence.
- Converting a feature list into a traceable workflow-to-verification map.
- Auditing coverage gaps before a release or QA handoff.
- Generating stable coded IDs (`F-###`, `PAGE-###`, `CTRL-###`, `TM-###`, etc.) for design, implementation, and test traceability.

Do **not** use this skill when:

- The task is to run or generate UI designs (use `stitch-design-coverage` instead).
- The task is to write directly into Figma or create design screens (use the relevant Figma or product-design skill instead).
- The task is to execute a delivery workflow (use `work-package-delivery-loop`).
- The question is only about a single code fix or bug that does not require a workflow/UI map.

## Skill Type

**Analytical / mapping skill.** This skill has no helper scripts. It guides the agent to produce structured downstream-consumption documents — product workflows, UI interaction tree, design consumption package, acceptance automation contract, and traceability ledger — using the `SKILL.md` definition and the `references/consumer-coverage-contract.md` template.

## Core Model

```
Product workflows → UI interaction tree → Design consumption → Acceptance automation → Traceability ledger
```

| Artifact | Purpose |
|---|---|
| Product workflows | What capabilities and workflows exist, for whom, under which state, and with what result |
| UI interaction tree | Where and how users operate each workflow across screens, regions, components, controls, design inputs, and states |
| Design consumption | What Stitch, Figma, or product-design skills should render, with `DHI-###` targets, versioned screen/state titles, viewports, prompts, design-system constraints, assets, and acceptance hooks |
| Acceptance automation | How each behavior and visual contract is verified with automation-ready oracles, locators, fixtures, screenshots, and evidence |
| Traceability ledger | Whether every product, UI, design, and test chain is ready for the next consumer or blocked by a named gap |

All artifacts are linked by stable codes. Every workflow traces to UI nodes or an explicit non-UI interface. Every user-visible UI node traces to an existing design source or explicit `DHI-###` design-consumption target. Every actionable UI node traces to one or more acceptance rows. Every acceptance row has a verifiable assertion.

To prevent a single file from becoming too large and unmanageable, these artifacts must always be split into multiple documents within the target project's `docs/coverage/` directory (containing `README.md`, `product-workflows.md`, `ui-interaction-tree.md`, `design-consumption.md`, `acceptance-automation.md`, and `traceability-ledger.md`).

## References

- Skill definition: `SKILL.md`
- Template and checklists: `references/consumer-coverage-contract.md`
