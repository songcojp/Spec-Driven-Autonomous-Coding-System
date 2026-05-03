import type { AdapterSettingsSection, SystemSettingsViewModel } from "../types";
import {
  commandButton,
  emptyState,
  escapeAttr,
  escapeHtml,
  renderWorkbenchPage,
  statusClass,
  webviewNonce,
} from "./shared";

type AdapterKind = "cli" | "rpc";

export function renderSystemSettingsWebview(settings: SystemSettingsViewModel | undefined): string {
  const nonce = webviewNonce();
  const factSources = settings?.factSources ?? [];
  return renderWorkbenchPage("System Settings", nonce, `
    <section class="toolbar">
      ${commandButton("Refresh", "refresh", {})}
      <span id="workbench-status" class="status-text" role="status" aria-live="polite"></span>
    </section>
    ${settings ? `
      <main class="grid settings-grid">
        ${renderAdapterSection("CLI Adapter", "cli", settings.cliAdapter)}
        ${renderAdapterSection("RPC Adapter", "rpc", settings.rpcAdapter)}
        <section class="panel span-12 settings-facts">
          <div class="panel-title"><h2>Fact Sources</h2><span>${factSources.length}</span></div>
          ${factSources.length === 0 ? emptyState("No settings fact sources returned.") : factSources.map((source) => `<span class="badge">${escapeHtml(source)}</span>`).join(" ")}
        </section>
      </main>
    ` : emptyState("System settings are unavailable.")}
  `);
}

function renderAdapterSection(title: string, kind: AdapterKind, section: AdapterSettingsSection | undefined): string {
  if (!section) {
    return `<section class="panel span-6">
      <div class="panel-title"><h2>${escapeHtml(title)}</h2><span class="muted">unavailable</span></div>
      ${emptyState(`${title} settings are unavailable from the current Control Plane response.`)}
    </section>`;
  }
  const editorId = `${kind}-adapter-json`;
  const source = section.draft ?? section.active ?? {};
  const activeId = stringField(section.active, "id");
  const draftId = section.draft ? stringField(section.draft, "id") : undefined;
  const presets = section.presets ?? [];
  const validation = section.validation ?? { valid: false, errors: ["Settings validation result is unavailable."] };
  const entityType = kind === "cli" ? "cli_adapter" : "rpc_adapter";
  const validateAction = kind === "cli" ? "validate_cli_adapter_config" : "validate_rpc_adapter_config";
  const saveAction = kind === "cli" ? "save_cli_adapter_config" : "save_rpc_adapter_config";
  const activateAction = kind === "cli" ? "activate_cli_adapter_config" : "activate_rpc_adapter_config";
  const disableAction = kind === "cli" ? "disable_cli_adapter_config" : "disable_rpc_adapter_config";
  return `<section class="panel span-6">
    <div class="panel-title">
      <h2>${escapeHtml(title)}</h2>
      <span class="${statusClass(validation.valid ? "passed" : "failed")}">${validation.valid ? "valid" : "invalid"}</span>
    </div>
    <div class="row"><span>Active</span><span><code>${escapeHtml(activeId ?? "none")}</code></span></div>
    <div class="row"><span>Draft</span><span><code>${escapeHtml(draftId ?? "none")}</code></span></div>
    <div class="row"><span>Status</span><span class="${statusClass(stringField(source, "status"))}">${escapeHtml(stringField(source, "status") ?? "unknown")}</span></div>
    <div class="row"><span>Schema Version</span><span>${escapeHtml(String(source.schemaVersion ?? source.schema_version ?? "unknown"))}</span></div>
    ${renderLastCheck(kind, section)}
    <h3>Presets</h3>
    <div class="toolbar">
      ${presets.map((preset) => commandButton(stringField(preset, "displayName") ?? stringField(preset, "id") ?? "Preset", "loadSettingsPreset", {
        editorId,
        presetJson: JSON.stringify(preset, null, 2),
      })).join("") || emptyState("No presets returned.")}
    </div>
    <h3>Validation Errors</h3>
    ${renderErrors(validation.errors)}
    <h3>JSON Config</h3>
    <textarea id="${editorId}" class="settings-editor" spellcheck="false" aria-label="${escapeAttr(title)} JSON">${escapeHtml(JSON.stringify(source, null, 2))}</textarea>
    <div class="toolbar">
      ${settingsCommandButton("Validate", validateAction, entityType, editorId)}
      ${settingsCommandButton("Save Draft", saveAction, entityType, editorId)}
      ${settingsCommandButton("Activate", activateAction, entityType, editorId)}
      ${settingsCommandButton("Disable", disableAction, entityType, editorId)}
    </div>
  </section>`;
}

function settingsCommandButton(label: string, action: string, entityType: string, editorId: string): string {
  return commandButton(label, "settingsCommand", {
    action,
    entityType,
    editorId,
    reason: `${label} ${entityType} from VSCode System Settings.`,
  });
}

function renderLastCheck(kind: AdapterKind, section: AdapterSettingsSection): string {
  const check = kind === "cli" ? section.lastDryRun : section.lastProbe;
  if (!check) return `<div class="row"><span>${kind === "cli" ? "Last Dry Run" : "Last Probe"}</span><span class="muted">none</span></div>`;
  const command = [check.command, ...(check.args ?? [])].filter(Boolean).join(" ");
  return `<div class="row"><span>${kind === "cli" ? "Last Dry Run" : "Last Probe"}</span><span class="${statusClass(check.status)}">${escapeHtml(check.status)}</span></div>
    ${command ? `<div class="row"><span>Command</span><span><code>${escapeHtml(command)}</code></span></div>` : ""}`;
}

function renderErrors(errors: string[] | undefined): string {
  const values = errors ?? [];
  if (values.length === 0) return emptyState("No validation errors.");
  return values.map((error) => `<div class="issue bad">${escapeHtml(error)}</div>`).join("");
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!value) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}
