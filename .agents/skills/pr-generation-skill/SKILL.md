---
name: pr-generation-skill
description: "Prepare commits, push branches, and create pull requests for SpecDrive delivery. Use when a completed feature or task needs a clean commit, PR description, evidence summary, and delivery traceability."
---

# PR Generation Skill

Use this skill after implementation, tests, and review have passed.

## Workflow

1. Inspect git status and confirm the intended diff belongs to the feature or task.
2. Follow `git-commit-conventions` for scoped staging and commit message format.
3. Push the feature branch to the configured remote.
4. Create a PR with summary, requirement/feature traceability, verification evidence, risks, and follow-up items.
5. Do not include unrelated user changes.

## Output

- Commit hash.
- Branch and PR URL or creation failure evidence.
- Verification summary.
- Delivery notes.

## Failure Routing

- Use `blocked` for authentication, remote, or network failures.
- Use `approval_needed` when protected branch, permission, or release policy blocks delivery.
