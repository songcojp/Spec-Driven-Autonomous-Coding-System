import type { CliAdapterConfig, RunnerReasoningEffort } from "./cli-adapter.ts";
import type { ExecutionAdapterInvocationV1 } from "./execution-adapter-contracts.ts";

const CODEX_DEFAULT_MODEL = "gpt-5.5";
const CODEX_DEFAULT_REASONING_EFFORT: RunnerReasoningEffort = "medium";
const CODEX_CLI_IMAGE_ARTIFACT_RULES = [
  "- Expected image artifacts must be real raster image files generated through the Codex CLI-specific image generation feature. In Codex CLI, explicitly invoke the built-in $imagegen skill when generating these PNGs.",
  "- Do not satisfy expected image artifacts with SVG, HTML/CSS, Mermaid, ASCII wireframes, base64 text, or Markdown descriptions.",
  "- The policy text/reasoning model may draft the image prompt, but it is not the image generator. Built-in Codex CLI image generation uses gpt-image-2; do not claim that the active text model produced a PNG unless $imagegen created the file.",
  "- Do not use another adapter's image command syntax, such as Gemini Nano Banana slash commands, while running through Codex CLI.",
  "- If this Codex CLI runtime does not expose $imagegen, return status blocked with nextAction explaining that Codex CLI image generation is required for the listed image artifacts.",
];

export const CODEX_CLI_ADAPTER_CONFIG: CliAdapterConfig = {
  id: "codex-cli",
  displayName: "Codex CLI",
  schemaVersion: 3,
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
      { path: "imageGeneration", label: "Image generation", type: "object" },
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
  imageGeneration: {
    provider: "codex-imagegen",
    invocation: "codex-skill",
    operations: ["generate", "edit"],
    commands: {
      generate: "$imagegen",
      edit: "$imagegen",
    },
    defaultModel: "gpt-image-2",
    outputFormats: ["png"],
    notes: [
      "Use the Codex CLI built-in $imagegen skill for raster image artifacts.",
      "The text model drafts prompts; gpt-image-2 produces image files.",
    ],
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

export function applyCodexCliAdapterPromptRules(
  prompt: string,
  invocation?: ExecutionAdapterInvocationV1,
): string {
  const hasImageArtifact = invocation?.skillInstruction.expectedArtifacts.some((artifact) => artifact.kind === "image") ?? false;
  if (!hasImageArtifact) return prompt;
  return [
    prompt,
    "",
    "Codex CLI image artifact rules:",
    ...CODEX_CLI_IMAGE_ARTIFACT_RULES,
  ].join("\n");
}
