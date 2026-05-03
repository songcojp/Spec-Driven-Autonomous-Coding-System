import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFailureFingerprint,
  buildRecoveryDispatchInput,
  buildRecoveryTask,
  checkForbiddenRetry,
  handleRecoveryResult,
  listRecoveryHistory,
  persistRecoveryAttempt,
  persistRecoveryResultHandling,
  scheduleRecoveryRetry,
  type RecoveryAttempt,
  type ForbiddenRetryRecord,
} from "../src/recovery.ts";
import { initializeSchema } from "../src/schema.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stableDate = new Date("2026-04-28T12:00:00.000Z");

test("failure fingerprints normalize volatile summaries and file order", () => {
  const first = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: " npm   test ",
    summary: "Failed at /tmp/work/a.ts:99 with code 500",
    relatedFiles: ["src/z.ts", "./src/a.ts"],
  });
  const second = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "failed at /home/john/project/a.ts:42 with code 404",
    relatedFiles: ["src/a.ts", "src/z.ts"],
  });

  assert.equal(first.id, second.id);
  assert.equal(first.failedCommandOrCheck, "npm test");
  assert.deepEqual(first.relatedFiles, ["src/a.ts", "src/z.ts"]);
  assert.equal(first.normalizedErrorSummary.includes("500"), false);
  assert.equal(first.normalizedErrorSummary.includes("/tmp/work"), false);
});

test("failure fingerprints preserve stable numeric identifiers", () => {
  const first = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "Requirement REQ-043 failed in test case 17",
    relatedFiles: ["src/recovery.ts"],
  });
  const second = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "Requirement REQ-044 failed in test case 18",
    relatedFiles: ["src/recovery.ts"],
  });

  assert.notEqual(first.id, second.id);
  assert.match(first.normalizedErrorSummary, /req-043/);
  assert.match(second.normalizedErrorSummary, /18/);
});

test("failure fingerprints include concrete status check failure details", () => {
  const baseStatusCheck = {
    taskId: "TASK-010",
    summary: "Status check blocked by failed command checks.",
    executionResult: {
      diff: { files: ["src/recovery.ts"] },
      commands: [{ kind: "unit_test", command: "npm test", status: "failed", exitCode: 1, summary: "login spec failed" }],
      runner: { status: "completed", exitCode: 0 },
    },
  };
  const first = buildFailureFingerprint({
    statusCheckResult: baseStatusCheck as never,
  });
  const second = buildFailureFingerprint({
    statusCheckResult: {
      ...baseStatusCheck,
      executionResult: {
        ...baseStatusCheck.executionResult,
        commands: [{ kind: "unit_test", command: "npm test", status: "failed", exitCode: 1, summary: "checkout spec failed" }],
      },
    } as never,
  });

  assert.notEqual(first.id, second.id);
  assert.match(first.normalizedErrorSummary, /login spec failed/);
});

test("failure fingerprints include spec alignment reasons and coverage gaps", () => {
  const baseStatusCheck = {
    taskId: "TASK-010",
    summary: "Spec alignment failed; Done is blocked.",
    executionResult: {
      diff: { files: ["src/recovery.ts"] },
      commands: [],
      runner: { status: "completed", exitCode: 0 },
      specAlignment: {
        aligned: false,
        reasons: ["Missing required coverage."],
        missingTraceability: [],
        forbiddenFiles: [],
        unauthorizedFiles: [],
        coverageGaps: ["REQ-043"],
      },
    },
  };
  const first = buildFailureFingerprint({
    statusCheckResult: baseStatusCheck as never,
  });
  const second = buildFailureFingerprint({
    statusCheckResult: {
      ...baseStatusCheck,
      executionResult: {
        ...baseStatusCheck.executionResult,
        specAlignment: {
          ...baseStatusCheck.executionResult.specAlignment,
          coverageGaps: ["REQ-044"],
        },
      },
    } as never,
  });

  assert.notEqual(first.id, second.id);
  assert.match(first.normalizedErrorSummary, /coverage-gap=req-043/);
});

test("failure fingerprints ignore volatile runner logs when no command check exists", () => {
  const baseStatusCheck = {
    taskId: "TASK-010",
    summary: "Status check blocked by runner failure.",
    executionResult: {
      diff: { files: ["src/recovery.ts"] },
      commands: [],
      runner: { status: "failed", exitCode: 1, summary: "CLI runner failed.", stderr: "tmp=/tmp/run-123 at 12:00", stdout: "request id abc" },
    },
  };
  const first = buildFailureFingerprint({
    statusCheckResult: baseStatusCheck as never,
  });
  const second = buildFailureFingerprint({
    statusCheckResult: {
      ...baseStatusCheck,
      executionResult: {
        ...baseStatusCheck.executionResult,
        runner: { status: "failed", exitCode: 1, summary: "CLI runner failed.", stderr: "tmp=/tmp/run-456 at 12:01", stdout: "request id xyz" },
      },
    } as never,
  });

  assert.equal(first.id, second.id);
  assert.equal(first.normalizedErrorSummary.includes("run-123"), false);
  assert.equal(first.normalizedErrorSummary.includes("abc"), false);
});

test("recovery task builds dispatch input for recoverable failures", () => {
  const task = buildRecoveryTask({
    taskId: "TASK-010",
    featureId: "FEAT-010",
    projectId: "PROJECT-1",
    failureType: "command_failed",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    now: stableDate,
  });
  const dispatchInput = buildRecoveryDispatchInput(task);

  assert.equal(task.route, "automatic");
  assert.equal(task.requestedAction, "auto_fix");
  assert.equal(task.retrySchedule?.backoffMinutes, 2);
  assert.equal(dispatchInput.requested_action, "auto_fix");
  assert.equal(dispatchInput.failure.fingerprint_id, task.fingerprint.id);
  assert.equal(dispatchInput.failure.failed_command, "npm test");
  assert.equal(dispatchInput.recovery_plan.command, undefined);
  assert.equal(dispatchInput.retry_policy.max_retries, 3);
  assert.equal(dispatchInput.recommendations.some((item) => item.includes("Dispatch recovery action")), true);
});

test("retry scheduler records 2, 4, and 8 minute backoff and stops the fourth attempt", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test token=abc123",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const attempts = [0, 1, 2].map((index) => attempt(fingerprint.id, index + 1));

  assert.equal(scheduleRecoveryRetry({ fingerprint, historicalAttempts: [], now: stableDate }).backoffMinutes, 2);
  assert.equal(scheduleRecoveryRetry({ fingerprint, historicalAttempts: attempts.slice(0, 1), now: stableDate }).backoffMinutes, 4);
  assert.equal(scheduleRecoveryRetry({ fingerprint, historicalAttempts: attempts.slice(0, 2), now: stableDate }).backoffMinutes, 8);

  const fourth = scheduleRecoveryRetry({ fingerprint, historicalAttempts: attempts, now: stableDate });
  assert.equal(fourth.attemptNumber, 4);
  assert.equal(fourth.status, "max_retries_reached");
  assert.equal(fourth.backoffMinutes, undefined);
});

test("retry scheduler suppresses outstanding scheduled attempts until they finish", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const activeScheduled = attempt(fingerprint.id, 1, "auto_fix", "scheduled", "2026-04-28T12:01:00.000Z");
  const expiredScheduled = attempt(fingerprint.id, 1, "auto_fix", "scheduled", "2026-04-28T11:59:00.000Z");

  assert.equal(scheduleRecoveryRetry({ fingerprint, historicalAttempts: [activeScheduled], now: stableDate }).status, "already_scheduled");
  const retry = scheduleRecoveryRetry({ fingerprint, historicalAttempts: [expiredScheduled], now: stableDate });
  assert.equal(retry.status, "already_scheduled");
  assert.equal(retry.attemptNumber, 1);
  assert.equal(retry.scheduledAt, expiredScheduled.attemptedAt);
});

test("retry scheduler re-enqueues stale scheduled attempts with the same id", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const staleScheduled = attempt(fingerprint.id, 1, "auto_fix", "scheduled", "2026-04-28T11:00:00.000Z");

  const retry = scheduleRecoveryRetry({ fingerprint, historicalAttempts: [staleScheduled], now: stableDate });

  assert.equal(retry.id, staleScheduled.id);
  assert.equal(retry.status, "scheduled");
  assert.equal(retry.scheduledAt, stableDate.toISOString());
  assert.match(retry.reason, /Stale scheduled recovery attempt/);
});

test("retry scheduler excludes non-automatic attempts from retry budget", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const historicalAttempts: RecoveryAttempt[] = [
    { ...attempt(fingerprint.id, 1), action: "manual_approval", status: "completed" },
  ];

  const retry = scheduleRecoveryRetry({ fingerprint, historicalAttempts, now: stableDate });

  assert.equal(retry.attemptNumber, 1);
  assert.equal(retry.backoffMinutes, 2);
  assert.equal(retry.status, "scheduled");
});

test("retry scheduler counts completed automatic recovery attempts", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const historicalAttempts: RecoveryAttempt[] = [
    { ...attempt(fingerprint.id, 1), action: "auto_fix", status: "completed" },
    { ...attempt(fingerprint.id, 2), action: "dependency_update", status: "completed" },
    { ...attempt(fingerprint.id, 3), action: "read_only_analysis", status: "completed" },
  ];

  const retry = scheduleRecoveryRetry({ fingerprint, historicalAttempts, now: stableDate });

  assert.equal(retry.attemptNumber, 4);
  assert.equal(retry.status, "max_retries_reached");
});

test("retry scheduler counts read-only analysis as automatic recovery", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const historicalAttempts: RecoveryAttempt[] = [
    { ...attempt(fingerprint.id, 1), action: "read_only_analysis", status: "failed" },
  ];

  const retry = scheduleRecoveryRetry({ fingerprint, historicalAttempts, now: stableDate });

  assert.equal(retry.attemptNumber, 2);
  assert.equal(retry.backoffMinutes, 4);
});

test("retry scheduler counts blocked automatic recovery attempts", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const historicalAttempts: RecoveryAttempt[] = [
    { ...attempt(fingerprint.id, 1), action: "auto_fix", status: "blocked" },
    { ...attempt(fingerprint.id, 2), action: "read_only_analysis", status: "review_needed" },
  ];

  const retry = scheduleRecoveryRetry({ fingerprint, historicalAttempts, now: stableDate });

  assert.equal(retry.attemptNumber, 2);
  assert.equal(retry.backoffMinutes, 4);
});

test("recovery task blocks default duplicate file scope for automatic retries", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const forbidden: ForbiddenRetryRecord = {
    id: "FORBIDDEN-FILE",
    fingerprintId: fingerprint.id,
    taskId: "TASK-010",
    failedStrategy: "different-auto-plan",
    failedFileScope: ["src/recovery.ts"],
    reason: "same file scope failed",
    createdAt: stableDate.toISOString(),
  };

  const retry = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    forbiddenRetryItems: [forbidden],
    now: stableDate,
  });

  assert.equal(retry.route, "manual");
  assert.equal(retry.retrySchedule?.status, "blocked_by_forbidden_duplicate");
});

test("retry scheduler enforces the three attempt ceiling", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const attempts = [0, 1, 2].map((index) => attempt(fingerprint.id, index + 1));

  const fourth = scheduleRecoveryRetry({ fingerprint, historicalAttempts: attempts, maxRetries: 5, now: stableDate });

  assert.equal(fourth.maxRetries, 3);
  assert.equal(fourth.attemptNumber, 4);
  assert.equal(fourth.status, "max_retries_reached");
});

test("manual and review recovery routes do not enqueue automatic retry schedules", () => {
  const manual = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    requiresManualApproval: true,
    now: stableDate,
  });
  const review = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    requestedAction: "rollback",
    now: stableDate,
  });

  assert.equal(manual.route, "manual");
  assert.equal(manual.retrySchedule, undefined);
  assert.equal(review.route, "review_needed");
  assert.equal(review.retrySchedule, undefined);
});

test("recovery task blocks existing forbidden records until a distinct proposal is supplied", () => {
  const first = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    now: stableDate,
  });
  const failed = handleRecoveryResult({
    recoveryTask: first,
    action: "auto_fix",
    status: "failed",
    strategy: "auto_fix",
    command: "node fix.js",
    fileScope: ["src/recovery.ts"],
    summary: "automatic fix failed",
    now: stableDate,
  });

  const noProposal = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    historicalAttempts: [failed.attempt],
    forbiddenRetryItems: [failed.forbiddenRetryRecord!],
    now: stableDate,
  });
  const distinctProposal = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    historicalAttempts: [failed.attempt],
    forbiddenRetryItems: [failed.forbiddenRetryRecord!],
    proposedStrategy: "different-auto-fix",
    proposedCommand: "node safer-fix.js",
    proposedFileScope: ["src/cli-runner.ts"],
    now: stableDate,
  });

  assert.equal(noProposal.route, "manual");
  assert.equal(noProposal.retrySchedule?.status, "blocked_by_forbidden_duplicate");
  assert.equal(distinctProposal.route, "automatic");
  assert.equal(distinctProposal.retrySchedule?.attemptNumber, 2);
  assert.equal(distinctProposal.retrySchedule?.backoffMinutes, 4);
  assert.equal(distinctProposal.proposedStrategy, "different-auto-fix");
  assert.equal(distinctProposal.proposedCommand, "node safer-fix.js");
  assert.deepEqual(distinctProposal.proposedFileScope, ["src/cli-runner.ts"]);
  const dispatchInput = buildRecoveryDispatchInput(distinctProposal);
  assert.deepEqual(dispatchInput.failure.related_files, ["src/cli-runner.ts"]);
  assert.deepEqual(dispatchInput.recovery_plan, {
    strategy: "different-auto-fix",
    command: "node safer-fix.js",
    file_scope: ["src/cli-runner.ts"],
  });
  const completedWithoutOverrides = handleRecoveryResult({
    recoveryTask: distinctProposal,
    action: "auto_fix",
    status: "failed",
    strategy: "different-auto-fix",
    summary: "proposed recovery failed",
    now: stableDate,
  });
  assert.equal(completedWithoutOverrides.attempt.command, "node safer-fix.js");
  assert.deepEqual(completedWithoutOverrides.attempt.fileScope, ["src/cli-runner.ts"]);
  assert.equal(completedWithoutOverrides.forbiddenRetryRecord?.failedCommand, "node safer-fix.js");
});

test("recovery dispatch input redacts sensitive command and plan text", () => {
  const task = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test token=abc123",
    summary: "unit test failed password=hunter2",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    proposedStrategy: "auto_fix secret=topsecret",
    proposedCommand: "node safer-fix.js password=hunter2",
    proposedFileScope: ["src/recovery.ts"],
    now: stableDate,
  });

  const dispatchInput = buildRecoveryDispatchInput(task);
  const serialized = JSON.stringify(dispatchInput);

  assert.equal(serialized.includes("abc123"), false);
  assert.equal(serialized.includes("hunter2"), false);
  assert.equal(serialized.includes("topsecret"), false);
  assert.equal(dispatchInput.recovery_plan.command, "node safer-fix.js password=[REDACTED]");
});

test("recovery dispatch input redacts history and source evidence", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const task = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test token=abc123",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    historicalAttempts: [{
      ...attempt(fingerprint.id, 1),
      strategy: "auto_fix secret=topsecret",
      command: "npm test password=hunter2",
      summary: "failed with token=abc123",
    }],
    forbiddenRetryItems: [{
      id: "FORBIDDEN-SECRET",
      fingerprintId: fingerprint.id,
      taskId: "TASK-010",
      failedStrategy: "auto_fix secret=topsecret",
      failedCommand: "npm test password=hunter2",
      failedFileScope: ["src/recovery.ts"],
      reason: "failed with token=abc123",
      createdAt: stableDate.toISOString(),
    }],
    statusCheckResult: {
      executionResult: {
        commands: [{ kind: "unit_test", command: "npm test token=abc123", status: "failed", summary: "password=hunter2" }],
        runner: { status: "failed", exitCode: 1, stdout: "secret=topsecret", stderr: "token=abc123" },
      },
    } as never,
    now: stableDate,
  });

  const serialized = JSON.stringify(buildRecoveryDispatchInput(task));

  assert.equal(serialized.includes("abc123"), false);
  assert.equal(serialized.includes("hunter2"), false);
  assert.equal(serialized.includes("topsecret"), false);
});

test("recovery task proposal preserves default command and file scope for forbidden checks", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });
  const forbidden: ForbiddenRetryRecord = {
    id: "FORBIDDEN-DEFAULT-SCOPE",
    fingerprintId: fingerprint.id,
    taskId: "TASK-010",
    failedStrategy: "auto_fix",
    failedCommand: "npm test",
    failedFileScope: ["src/recovery.ts"],
    reason: "same command and file scope failed",
    createdAt: stableDate.toISOString(),
  };

  const retry = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    forbiddenRetryItems: [forbidden],
    proposedStrategy: "renamed-auto-fix",
    now: stableDate,
  });

  assert.equal(retry.route, "manual");
  assert.equal(retry.retrySchedule?.status, "blocked_by_forbidden_duplicate");
});

test("unrelated forbidden recovery actions do not block the default automatic plan", () => {
  const first = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    requestedAction: "manual_approval",
    now: stableDate,
  });
  const failedManualApproval = handleRecoveryResult({
    recoveryTask: first,
    action: "manual_approval",
    status: "failed",
    strategy: "manual_approval",
    fileScope: ["src/recovery.ts"],
    summary: "approval request failed",
    now: stableDate,
  });
  assert.equal(failedManualApproval.forbiddenRetryRecord, undefined);

  const retry = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    historicalAttempts: [failedManualApproval.attempt],
    now: stableDate,
  });

  assert.equal(retry.requestedAction, "auto_fix");
  assert.equal(retry.route, "automatic");
  assert.equal(retry.retrySchedule?.status, "scheduled");
});

test("forbidden retry guard blocks duplicate strategy, command, and file scope for one fingerprint", () => {
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts", "tests/recovery.test.ts"],
  });
  const record: ForbiddenRetryRecord = {
    id: "FORBIDDEN-1",
    fingerprintId: fingerprint.id,
    taskId: "TASK-010",
    failedStrategy: "auto_fix",
    failedCommand: "npm test",
    failedFileScope: ["tests/recovery.test.ts", "src/recovery.ts"],
    reason: "failed once",
    createdAt: stableDate.toISOString(),
  };

  const result = checkForbiddenRetry({
    fingerprint,
    action: "auto_fix",
    strategy: "auto_fix",
    command: " npm test ",
    fileScope: ["src/recovery.ts", "tests/recovery.test.ts"],
    forbiddenRetryItems: [record],
  });

  assert.equal(result.allowed, false);
  assert.deepEqual(
    result.violations.map((violation) => violation.reason).sort(),
    ["command", "file_scope", "strategy"],
  );
});

test("recovery result handler writes evidence and forbidden record for failed attempts", () => {
  const task = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    now: stableDate,
  });
  const result = handleRecoveryResult({
    recoveryTask: task,
    action: "auto_fix",
    status: "failed",
    strategy: "auto_fix token=abc123",
    command: "npm test password=hunter2",
    fileScope: ["src/recovery.ts"],
    summary: "automatic fix failed secret=topsecret",
    evidence: { log: "still failing token=abc123", nested: { password: "password=hunter2" } },
    now: stableDate,
  });

  assert.equal(result.executionResult.recoveryTaskId, task.id);
  assert.equal(result.executionResult.fingerprintId, task.fingerprint.id);
  assert.equal(JSON.stringify(result.executionResult).includes("abc123"), false);
  assert.equal(JSON.stringify(result.executionResult).includes("hunter2"), false);
  assert.equal(JSON.stringify(result.attempt).includes("topsecret"), false);
  assert.equal(result.nextStepRecommendations.some((item) => item.includes("forbidden duplicate")), true);
  assert.equal(result.boardStatus, "failed");
  assert.equal(result.forbiddenRetryRecord?.failedCommand, "npm test password=[REDACTED]");
  assert.deepEqual(result.forbiddenRetryRecord?.failedFileScope, ["src/recovery.ts"]);
});

test("recovery result persistence reloads attempts and forbidden retry records", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-recovery-history-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const task = buildRecoveryTask({
    taskId: "TASK-010",
    failureStage: "test",
    failedCommand: "npm test",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
    recoverable: true,
    now: stableDate,
  });
  const result = handleRecoveryResult({
    recoveryTask: task,
    action: "auto_fix",
    status: "failed",
    strategy: "auto_fix",
    command: "npm test",
    fileScope: ["src/recovery.ts"],
    summary: "automatic fix failed",
    now: stableDate,
  });

  persistRecoveryResultHandling(dbPath, result);
  const history = listRecoveryHistory(dbPath, { taskId: "TASK-010" });

  assert.equal(history.attempts.length, 1);
  assert.equal(history.attempts[0].fingerprintId, task.fingerprint.id);
  assert.equal(history.forbiddenRetryItems.length, 1);
  assert.equal(history.forbiddenRetryItems[0].failedCommand, "npm test");
});

test("recovery attempt persistence redacts commands, summaries, and evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "feat-010-recovery-redaction-"));
  const dbPath = join(root, ".autobuild", "autobuild.db");
  initializeSchema(dbPath);
  const fingerprint = buildFailureFingerprint({
    taskId: "TASK-010",
    stage: "test",
    failedCommand: "npm test token=abc123",
    summary: "unit test failed",
    relatedFiles: ["src/recovery.ts"],
  });

  persistRecoveryAttempt(dbPath, {
    id: "ATTEMPT-SECRET",
    fingerprintId: fingerprint.id,
    taskId: "TASK-010",
    action: "auto_fix",
    strategy: "auto_fix secret=topsecret",
    command: "npm test password=hunter2",
    fileScope: ["src/recovery.ts"],
    status: "scheduled",
    summary: "scheduled with token=abc123",
    executionResult: {
      id: "RECOVERY-EVIDENCE-SECRET",
      recoveryTaskId: "TASK-RECOVERY-010",
      fingerprintId: fingerprint.id,
      taskId: "TASK-010",
      action: "auto_fix",
      status: "scheduled",
      strategy: "auto_fix secret=topsecret",
      summary: "scheduled with password=hunter2",
      reasons: ["token=abc123"],
      recommendations: ["retry with secret=topsecret"],
      evidence: { log: "password=hunter2" },
      createdAt: stableDate.toISOString(),
    },
    attemptedAt: stableDate.toISOString(),
  });
  const history = listRecoveryHistory(dbPath, { taskId: "TASK-010" });
  const serialized = JSON.stringify(history);

  assert.equal(serialized.includes("abc123"), false);
  assert.equal(serialized.includes("hunter2"), false);
  assert.equal(serialized.includes("topsecret"), false);
  assert.equal(history.attempts[0].command, "npm test password=[REDACTED]");
});

function attempt(
  fingerprintId: string,
  number: number,
  action: RecoveryAttempt["action"] = "auto_fix",
  status: RecoveryAttempt["status"] = "failed",
  attemptedAt: string = stableDate.toISOString(),
): RecoveryAttempt {
  return {
    id: `ATTEMPT-${number}`,
    fingerprintId,
    taskId: "TASK-010",
    action,
    strategy: action,
    command: "npm test",
    fileScope: ["src/recovery.ts"],
    status,
    summary: `attempt ${number}`,
    attemptedAt,
  };
}
