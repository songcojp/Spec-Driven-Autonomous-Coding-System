import { CODEX_CLI_ADAPTER_CONFIG } from "./codex-cli-adapter.ts";
import type { CliAdapterConfig, RunnerApprovalPolicy, RunnerReasoningEffort } from "./cli-adapter.ts";

const GEMINI_DEFAULT_MODEL = "gemini-3-pro-preview";
const GEMINI_DEFAULT_REASONING_EFFORT: RunnerReasoningEffort = "medium";

export const GEMINI_CLI_ADAPTER_CONFIG: CliAdapterConfig = {
  id: "gemini-cli",
  displayName: "Google Gemini CLI",
  schemaVersion: 2,
  executable: "gemini",
  argumentTemplate: [
    "--model",
    "{{model}}",
    "--output-format",
    "stream-json",
    "--skip-trust",
    "--approval-mode",
    "{{gemini_approval_mode}}",
    "-p",
    "{{prompt}}",
  ],
  resumeArgumentTemplate: [
    "--model",
    "{{model}}",
    "--output-format",
    "stream-json",
    "--skip-trust",
    "--approval-mode",
    "{{gemini_approval_mode}}",
    "--resume",
    "{{resume_session_id}}",
    "-p",
    "{{resume_prompt}}",
  ],
  configSchema: {
    type: "object",
    required: ["id", "executable", "argumentTemplate", "outputMapping"],
  },
  formSchema: CODEX_CLI_ADAPTER_CONFIG.formSchema,
  defaults: {
    model: GEMINI_DEFAULT_MODEL,
    reasoningEffort: GEMINI_DEFAULT_REASONING_EFFORT,
    sandbox: "danger-full-access",
    approval: "never",
    costRates: {},
  },
  environmentAllowlist: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_GENAI_USE_VERTEXAI"],
  outputMapping: {
    eventStream: "json",
    outputSchema: "skill-output.schema.json",
    sessionIdPath: "session_id",
    responseTextPaths: ["response", "result.response", "message.content", "content", "text"],
  },
  status: "draft",
  updatedAt: new Date(0).toISOString(),
};

export function geminiApprovalMode(approval: RunnerApprovalPolicy): "default" | "auto_edit" | "yolo" | "plan" {
  if (approval === "never" || approval === "bypass") return "yolo";
  return "default";
}
