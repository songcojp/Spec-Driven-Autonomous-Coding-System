export class BootstrapError extends Error {
  readonly step: string;
  readonly detail?: unknown;

  constructor(step: string, message: string, detail?: unknown) {
    super(message);
    this.name = "BootstrapError";
    this.step = step;
    this.detail = detail;
  }
}

export type StepLog = {
  step: string;
  status: "ok" | "error";
  durationMs: number;
  detail?: unknown;
};

export function formatBootstrapError(error: unknown): {
  status: "error";
  step: string;
  error: string;
  detail?: unknown;
} {
  if (error instanceof BootstrapError) {
    return {
      status: "error",
      step: error.step,
      error: error.message,
      detail: error.detail,
    };
  }

  if (error instanceof Error) {
    return {
      status: "error",
      step: "unknown",
      error: error.message,
    };
  }

  return {
    status: "error",
    step: "unknown",
    error: String(error),
  };
}
