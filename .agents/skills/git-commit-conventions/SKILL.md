---
name: git-commit-conventions
description: Prepare clean git commits using project conventions. Use when Codex is asked to commit changes, define commit standards, create commit messages, review staged changes, split commits, or ensure git history is readable, scoped, and traceable to specs, requirements, features, tasks, or issue IDs.
---

# Git Commit Conventions

## Workflow

1. Inspect `git status --short --branch` before staging or committing.
2. Identify which changes belong to the user's requested scope. Do not stage unrelated user changes.
3. Review the diff for the intended files before committing.
4. Stage only the files that belong to the commit.
5. Use the commit message format below.
6. Run relevant validation before committing when practical. If validation is skipped or unavailable, mention that in the final response.
7. After committing, report the commit hash and concise summary.

## Commit Message Format

Use Conventional Commits with optional project trace IDs:

```text
<type>(<scope>): <imperative summary>

<body>

Refs: <REQ-001|FEAT-001|TASK-001|issue-id>
```

Use no body for tiny commits where the subject is enough.

## Types

- `feat`: user-visible capability or feature behavior.
- `fix`: bug fix or correctness repair.
- `docs`: documentation-only change.
- `test`: test-only change.
- `refactor`: code restructuring without behavior change.
- `chore`: tooling, config, dependency, or maintenance work.
- `perf`: performance improvement.
- `ci`: continuous integration or automation change.

## Subject Rules

- Use imperative mood: `add`, `fix`, `document`, `split`, `remove`.
- Keep the subject at or under 72 characters when possible.
- Use a narrow scope such as `spec`, `requirements`, `design`, `skills`, `api`, `web`, or the affected module.
- Do not end the subject with a period.
- Prefer English commit messages unless the repository already consistently uses another language.

## Commit Hygiene

- Keep generated noise out of commits unless it is required.
- Split unrelated changes into separate commits.
- Never revert or overwrite unrelated work unless the user explicitly asks.
- Include spec traceability when the change implements or updates a requirement, feature, task, or design decision.
- Before a commit, make sure the worktree state is understood; after a commit, verify `git status --short`.

## Examples

```text
docs(spec): add EARS requirement generation skill

Refs: FEAT-001
```

```text
feat(scheduler): select ready feature by priority

Adds readiness filtering and deterministic tie-breaking for feature selection.

Refs: REQ-055
```
