---
name: project-constitution-skill
description: "Create or update the project constitution for SpecDrive projects. Use when a project charter, goal, boundary, default branch, trust level, repository policy, or governance baseline must be captured before planning or execution."
---

# Project Constitution Skill

Use this skill to establish the project-level operating contract consumed by Project Memory, Scheduler, Review Center, and later Feature Specs.

## Workflow

1. Read the PRD, requirements, project repository metadata, and existing constitution notes.
2. Capture project name, product goal, repository root, default branch, trusted paths, restricted paths, trust level, owner contacts, and required review gates.
3. Record delivery boundaries: what the automation may change, what requires approval, and what is out of scope.
4. Map constitution decisions to source references such as PRD sections, user instruction, repository facts, or review decisions.
5. Update the formal project artifact requested by the caller. If unspecified, prefer the existing project foundation or memory artifact instead of creating a new root file.

## Output

- Project identity and goal.
- Repository and branch contract.
- Trust and approval rules.
- Review routing rules for `approval_needed`, `clarification_needed`, and `risk_review_needed`.
- Traceability to source references.

## Output Contract

- Follow `.agents/skills/SKILL_OUTPUT_CONTRACT.md` and return exactly one `SkillOutputContractV1` JSON object.
- `summary` must state whether the constitution was created, updated, unchanged, blocked, or approval-routed.
- `result` must follow the specialized contract below.

## Specialized Result Contract

`result` should contain:

- `projectIdentity`: project name, goal, and repository boundary.
- `branchContract`: default branch, protected branches, and delivery policy.
- `trustRules`: approval, sandbox, and write-boundary rules.
- `reviewRouting`: mapping for approval, clarification, and risk-review outcomes.
- `sourceReferences`: source files or decisions used.

## Failure Routing

- Use `clarification_needed` when the project goal, target repo, or allowed write boundary is unclear.
- Use `approval_needed` when the constitution grants new permissions or changes a protected boundary.
