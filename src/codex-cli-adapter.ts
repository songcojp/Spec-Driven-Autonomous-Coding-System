import type { CliAdapterConfig, RunnerReasoningEffort } from "./cli-adapter.ts";

const CODEX_DEFAULT_MODEL = "gpt-5.3-codex-spark";
const CODEX_DEFAULT_REASONING_EFFORT: RunnerReasoningEffort = "medium";

export const CODEX_CLI_ADAPTER_CONFIG: CliAdapterConfig = {
  id: "codex-cli",
  displayName: "Codex CLI",
  schemaVersion: 2,
  executable: "codex",
  argumentTemplate: [
    "-a",
    "{{approval}}",
    "-c",
    "model_reasoning_effort=\"{{reasoning_effort}}\"",
    "--cd",
    "{{workspace}}",
    "exec",
    "--ignore-user-config",
    "--json",
    "--sandbox",
    "{{sandbox}}",
    "--model",
    "{{model}}",
    "--output-schema",
    "{{output_schema}}",
    "{{prompt}}",
  ],
  resumeArgumentTemplate: [
    "-a",
    "{{approval}}",
    "--sandbox",
    "{{sandbox}}",
    "-c",
    "model_reasoning_effort=\"{{reasoning_effort}}\"",
    "--cd",
    "{{workspace}}",
    "{{profile_flag}}",
    "{{profile}}",
    "exec",
    "resume",
    "--ignore-user-config",
    "--json",
    "-m",
    "{{model}}",
    "{{resume_session_id}}",
    "{{resume_prompt}}",
  ],
  configSchema: {
    type: "object",
    required: ["id", "executable", "argumentTemplate", "outputMapping"],
  },
  formSchema: {
    fields: [
      { path: "executable", label: "Executable", type: "text" },
      { path: "argumentTemplate", label: "Arguments", type: "list" },
      { path: "defaults.model", label: "Default model", type: "text" },
      { path: "defaults.reasoningEffort", label: "Default reasoning effort", type: "select" },
      { path: "defaults.sandbox", label: "Sandbox", type: "select" },
      { path: "defaults.approval", label: "Approval", type: "select" },
      { path: "defaults.costRates", label: "Token cost rates", type: "object" },
      { path: "outputMapping.sessionIdPath", label: "Session id path", type: "text" },
    ],
  },
  defaults: {
    model: CODEX_DEFAULT_MODEL,
    reasoningEffort: CODEX_DEFAULT_REASONING_EFFORT,
    sandbox: "danger-full-access",
    approval: "never",
    costRates: {},
  },
  environmentAllowlist: [],
  outputMapping: {
    eventStream: "json",
    outputSchema: "skill-output.schema.json",
    sessionIdPath: "session_id",
  },
  status: "active",
  updatedAt: new Date(0).toISOString(),
};

export const DEFAULT_CLI_ADAPTER_CONFIG = CODEX_CLI_ADAPTER_CONFIG;
