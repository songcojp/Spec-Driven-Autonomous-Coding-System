import { CODEX_CLI_ADAPTER_CONFIG } from "./codex-cli-adapter.ts";
import type { CliAdapterConfig, RunnerApprovalPolicy, RunnerReasoningEffort } from "./cli-adapter.ts";
import { GEMINI_3_PRO_PREVIEW_STANDARD_COST_RATE } from "./gemini-pricing.ts";

const GEMINI_DEFAULT_MODEL = "gemini-3-pro-preview";
const GEMINI_DEFAULT_REASONING_EFFORT: RunnerReasoningEffort = "medium";
const GEMINI_NANOBANANA_DEFAULT_MODEL = "gemini-3.1-flash-image-preview";

export const GEMINI_CLI_ADAPTER_CONFIG: CliAdapterConfig = {
  id: "gemini-cli",
  displayName: "Google Gemini CLI",
  schemaVersion: 3,
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
    costRates: {
      [GEMINI_DEFAULT_MODEL]: GEMINI_3_PRO_PREVIEW_STANDARD_COST_RATE,
    },
  },
  imageGeneration: {
    provider: "gemini-nanobanana",
    invocation: "gemini-extension-command",
    operations: ["generate", "edit", "restore", "icon", "pattern", "story", "diagram", "natural_language"],
    commands: {
      generate: "/generate",
      edit: "/edit",
      restore: "/restore",
      icon: "/icon",
      pattern: "/pattern",
      story: "/story",
      diagram: "/diagram",
      natural_language: "/nanobanana",
    },
    defaultModel: GEMINI_NANOBANANA_DEFAULT_MODEL,
    modelEnvVar: "NANOBANANA_MODEL",
    requiredEnv: ["NANOBANANA_API_KEY"],
    outputFormats: ["png", "jpeg"],
    maxVariations: 8,
    inputImageArgument: "<image-path>",
    countArgument: "--count",
    notes: [
      "Requires the gemini-cli-extensions/nanobanana Gemini CLI extension.",
      "Nano Banana 2 uses gemini-3.1-flash-image-preview by default; NANOBANANA_MODEL can select another supported image model.",
    ],
  },
  environmentAllowlist: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_GENAI_USE_VERTEXAI", "NANOBANANA_API_KEY", "NANOBANANA_MODEL"],
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
