import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type CommandRunner = (command: string, args: string[], cwd: string) => CommandResult;

export type RepositoryCommandWarning = {
  source: "git" | "gh";
  command: string;
  args: string[];
  code: string;
  message: string;
};

export type RepositorySummary = {
  localPath: string;
  isGitRepository: boolean;
  remoteUrl?: string;
  defaultBranch?: string;
  currentBranch?: string;
  latestCommit?: string;
  hasUncommittedChanges: boolean;
  uncommittedChanges: string[];
  pullRequests: string[];
  ciRuns: string[];
  taskBranches: string[];
  worktrees: Array<{
    path: string;
    branch?: string;
    head?: string;
  }>;
  packageManager?: string;
  testCommand?: string;
  buildCommand?: string;
  hasCodexConfig: boolean;
  hasAgentsFile: boolean;
  hasSpecProtocolDirectory: boolean;
  sensitiveFileRisks: string[];
  commandWarnings: RepositoryCommandWarning[];
  errors: string[];
};

const TASK_BRANCH_PREFIXES = ["feat/", "feature/", "fix/", "task/", "chore/"];
const SENSITIVE_FILE_NAMES = new Set([".env", ".env.local", ".env.production", "id_rsa", "id_ed25519"]);

export function readRepositorySummary(localPath: string, runner: CommandRunner = runCommand): RepositorySummary {
  const summary: RepositorySummary = {
    localPath,
    isGitRepository: false,
    hasUncommittedChanges: false,
    uncommittedChanges: [],
    pullRequests: [],
    ciRuns: [],
    taskBranches: [],
    worktrees: [],
    hasCodexConfig: false,
    hasAgentsFile: false,
    hasSpecProtocolDirectory: false,
    sensitiveFileRisks: [],
    commandWarnings: [],
    errors: [],
  };

  if (!existsSync(localPath)) {
    summary.errors.push("repository_path_missing");
    return summary;
  }

  const gitRoot = git(["rev-parse", "--show-toplevel"], localPath, runner);
  if (gitRoot.status !== 0) {
    summary.errors.push("git_repository_missing");
    return enrichFilesystemSummary(summary);
  }

  summary.isGitRepository = true;
  try {
    summary.remoteUrl = firstSuccessfulLine(git(["config", "--get", "remote.origin.url"], localPath, runner));
    summary.defaultBranch = readDefaultBranch(localPath, runner);
    summary.currentBranch = firstSuccessfulLine(git(["branch", "--show-current"], localPath, runner));
    summary.latestCommit = firstSuccessfulLine(git(["rev-parse", "HEAD"], localPath, runner));

    const status = git(["status", "--short"], localPath, runner);
    summary.uncommittedChanges = lines(status.stdout).filter((line) => !isControlPlaneArtifactStatus(line, localPath));
    summary.hasUncommittedChanges = summary.uncommittedChanges.length > 0;

    summary.taskBranches = lines(git(["branch", "--format=%(refname:short)"], localPath, runner).stdout).filter(
      (branch) => TASK_BRANCH_PREFIXES.some((prefix) => branch.startsWith(prefix)),
    );
    summary.worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"], localPath, runner).stdout);
    const pullRequests = readGhLines(["pr", "list", "--limit", "20", "--json", "number,title,state"], localPath, runner);
    summary.pullRequests = pullRequests.lines;
    summary.commandWarnings.push(...pullRequests.warnings);

    const ciRuns = readGhLines(["run", "list", "--limit", "10", "--json", "name,status,conclusion"], localPath, runner);
    summary.ciRuns = ciRuns.lines;
    summary.commandWarnings.push(...ciRuns.warnings);
  } catch {
    summary.errors.push("repository_scan_failed");
  }

  return enrichFilesystemSummary(summary);
}

function enrichFilesystemSummary(summary: RepositorySummary): RepositorySummary {
  summary.packageManager = detectPackageManager(summary.localPath);
  summary.testCommand = readPackageScript(summary.localPath, "test");
  summary.buildCommand = readPackageScript(summary.localPath, "build");
  summary.hasCodexConfig = existsSync(join(summary.localPath, ".codex")) || existsSync(join(summary.localPath, ".codex.json"));
  summary.hasAgentsFile = existsSync(join(summary.localPath, "AGENTS.md"));
  summary.hasSpecProtocolDirectory =
    existsSync(join(summary.localPath, ".autobuild")) ||
    existsSync(join(summary.localPath, "docs", "features")) ||
    existsSync(join(summary.localPath, ".spec"));
  summary.sensitiveFileRisks = readSensitiveFileRisks(summary.localPath);
  return summary;
}

function runCommand(command: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message,
  };
}

function git(args: string[], cwd: string, runner: CommandRunner): CommandResult {
  return runner("git", args, cwd);
}

function readGhLines(
  args: string[],
  cwd: string,
  runner: CommandRunner,
): { lines: string[]; warnings: RepositoryCommandWarning[] } {
  const result = runner("gh", args, cwd);
  if (result.status !== 0) {
    return {
      lines: [],
      warnings: [
        {
          source: "gh",
          command: "gh",
          args,
          code: classifyGhFailure(result),
          message: result.stderr.trim() || result.error || "GitHub CLI command failed; GitHub facts are unavailable.",
        },
      ],
    };
  }
  return { lines: lines(result.stdout), warnings: [] };
}

function classifyGhFailure(result: CommandResult): string {
  const details = `${result.stderr}\n${result.error ?? ""}`.toLowerCase();
  if (result.status === null || details.includes("enoent") || details.includes("not found")) {
    return "github_cli_unavailable";
  }
  if (details.includes("auth") || details.includes("login") || details.includes("not logged")) {
    return "github_cli_unauthenticated";
  }
  if (details.includes("not a github repository") || details.includes("no github remotes")) {
    return "github_remote_unavailable";
  }
  return "github_cli_failed";
}

function readDefaultBranch(localPath: string, runner: CommandRunner): string | undefined {
  const originHead = firstSuccessfulLine(git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], localPath, runner));
  if (originHead?.startsWith("origin/")) {
    return originHead.slice("origin/".length);
  }
  return firstSuccessfulLine(git(["branch", "--show-current"], localPath, runner));
}

function parseWorktrees(output: string): RepositorySummary["worktrees"] {
  const worktrees: RepositorySummary["worktrees"] = [];
  let current: RepositorySummary["worktrees"][number] | undefined;

  for (const line of lines(output)) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length) };
      worktrees.push(current);
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }

  return worktrees;
}

function detectPackageManager(localPath: string): string | undefined {
  if (existsSync(join(localPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(localPath, "yarn.lock"))) return "yarn";
  if (existsSync(join(localPath, "package-lock.json"))) return "npm";
  if (existsSync(join(localPath, "package.json"))) return "npm";
  if (existsSync(join(localPath, "pyproject.toml"))) return "python";
  if (existsSync(join(localPath, "Cargo.toml"))) return "cargo";
  if (existsSync(join(localPath, "go.mod"))) return "go";
  return undefined;
}

function readPackageScript(localPath: string, scriptName: string): string | undefined {
  const packageJsonPath = join(localPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
    if (packageJson.scripts?.[scriptName]) {
      return `npm run ${scriptName}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readSensitiveFileRisks(localPath: string): string[] {
  try {
    return readdirSync(localPath).filter((name) => SENSITIVE_FILE_NAMES.has(name) || name.endsWith(".pem"));
  } catch {
    return [];
  }
}

function isControlPlaneArtifactStatus(line: string, localPath: string): boolean {
  const path = line.replace(/^[ MADRCU?!]{1,2}\s+/, "");
  if (path === ".autobuild" || path === ".autobuild/" || path.startsWith(".autobuild/")) return true;
  if (path === ".gitignore") return isSpecDriveGeneratedGitIgnore(join(localPath, path));
  if (line.startsWith("?? ") && (path === "AGENTS.md" || path === ".agents" || path === ".agents/" || path.startsWith(".agents/"))) {
    return true;
  }
  return false;
}

function isSpecDriveGeneratedGitIgnore(path: string): boolean {
  try {
    const meaningfulLines = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return meaningfulLines.length === 2
      && meaningfulLines[0] === "# SpecDrive AutoBuild local runtime artifacts"
      && meaningfulLines[1] === ".autobuild/runs/";
  } catch {
    return false;
  }
}

function firstNonEmpty(value: string): string | undefined {
  return lines(value)[0];
}

function firstSuccessfulLine(result: CommandResult): string | undefined {
  return result.status === 0 ? firstNonEmpty(result.stdout) : undefined;
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
