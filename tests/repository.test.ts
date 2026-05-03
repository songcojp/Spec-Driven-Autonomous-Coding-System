import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRepositorySummary, type CommandResult, type CommandRunner } from "../src/repository.ts";

test("repository adapter reads live git and gh facts through the command runner", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-adapter-live-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test", build: "tsc" } }));

  const runner = mockRunner({
    "git rev-parse --show-toplevel": ok(`${root}\n`),
    "git config --get remote.origin.url": ok("git@github.com:example/specdrive.git\n"),
    "git symbolic-ref --short refs/remotes/origin/HEAD": ok("origin/main\n"),
    "git branch --show-current": ok("feature/live-git\n"),
    "git rev-parse HEAD": ok("abc123\n"),
    "git status --short": ok(" M src/repository.ts\n?? .autobuild/reports/latest.json\n"),
    "git branch --format=%(refname:short)": ok("main\nfeature/live-git\nfix/runtime-git\n"),
    "git worktree list --porcelain": ok(`worktree ${root}\nHEAD abc123\nbranch refs/heads/feature/live-git\n`),
    "gh pr list --limit 20 --json number,title,state": ok('[{"number":12,"title":"Live PR","state":"OPEN"}]\n'),
    "gh run list --limit 10 --json name,status,conclusion": ok('[{"name":"CI","status":"completed","conclusion":"success"}]\n'),
  });

  const summary = readRepositorySummary(root, runner);

  assert.equal(summary.isGitRepository, true);
  assert.equal(summary.remoteUrl, "git@github.com:example/specdrive.git");
  assert.equal(summary.defaultBranch, "main");
  assert.equal(summary.currentBranch, "feature/live-git");
  assert.equal(summary.latestCommit, "abc123");
  assert.deepEqual(summary.uncommittedChanges, ["M src/repository.ts"]);
  assert.deepEqual(summary.taskBranches, ["feature/live-git", "fix/runtime-git"]);
  assert.deepEqual(summary.worktrees, [{ path: root, head: "abc123", branch: "feature/live-git" }]);
  assert.equal(summary.pullRequests.length, 1);
  assert.equal(summary.ciRuns.length, 1);
  assert.deepEqual(summary.commandWarnings, []);
  assert.equal(summary.testCommand, "npm run test");
  assert.equal(summary.buildCommand, "npm run build");
});

test("repository adapter degrades gh failures without blocking local git facts", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-adapter-gh-"));

  const summary = readRepositorySummary(root, mockRunner({
    "git rev-parse --show-toplevel": ok(`${root}\n`),
    "git config --get remote.origin.url": ok("git@example.com:repo.git\n"),
    "git symbolic-ref --short refs/remotes/origin/HEAD": err("no origin head"),
    "git branch --show-current": ok("main\n"),
    "git rev-parse HEAD": ok("def456\n"),
    "git status --short": ok(""),
    "git branch --format=%(refname:short)": ok("main\n"),
    "git worktree list --porcelain": ok(`worktree ${root}\nHEAD def456\nbranch refs/heads/main\n`),
    "gh pr list --limit 20 --json number,title,state": { status: null, stdout: "", stderr: "", error: "spawn gh ENOENT" },
    "gh run list --limit 10 --json name,status,conclusion": err("authentication required"),
  }));

  assert.equal(summary.isGitRepository, true);
  assert.equal(summary.currentBranch, "main");
  assert.equal(summary.latestCommit, "def456");
  assert.deepEqual(summary.pullRequests, []);
  assert.deepEqual(summary.ciRuns, []);
  assert.deepEqual(
    summary.commandWarnings.map((warning) => warning.code),
    ["github_cli_unavailable", "github_cli_unauthenticated"],
  );
  assert.deepEqual(summary.errors, []);
});

test("repository adapter returns filesystem facts and a blocker for non-git directories", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-adapter-nongit-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));

  const summary = readRepositorySummary(root, mockRunner({
    "git rev-parse --show-toplevel": err("fatal: not a git repository"),
  }));

  assert.equal(summary.isGitRepository, false);
  assert.deepEqual(summary.errors, ["git_repository_missing"]);
  assert.equal(summary.packageManager, "npm");
  assert.equal(summary.testCommand, "npm run test");
});

function mockRunner(responses: Record<string, CommandResult>): CommandRunner {
  return (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    return responses[key] ?? err(`unexpected command: ${key}`);
  };
}

function ok(stdout: string): CommandResult {
  return { status: 0, stdout, stderr: "" };
}

function err(stderr: string): CommandResult {
  return { status: 1, stdout: "", stderr };
}
