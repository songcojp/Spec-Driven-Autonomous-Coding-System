import { CheckCircle2, FileText, Play, Settings, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { UiStrings } from "../lib/i18n";
import type { CommandReceipt, ConsoleData } from "../types";
import { Button, Chip, Panel, SectionTitle } from "../components/ui/primitives";
import { FactList } from "../components/ui/helpers";

type OnCommand = (
  action: CommandReceipt["action"],
  entityType: string,
  entityId: string,
  payload?: Record<string, unknown>,
) => void;

function SettingsInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[12px] text-muted">
      <span className="font-medium">{label}</span>
      <input
        className="mt-1 h-9 w-full rounded-md border border-line bg-white px-3 text-[13px] text-ink outline-none focus:border-action"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function SettingsPage({
  data,
  text,
  onCommand,
  busy,
}: {
  data: ConsoleData;
  text: UiStrings;
  onCommand: OnCommand;
  busy: boolean;
}) {
  const source = data.settings.cliAdapter.draft ?? data.settings.cliAdapter.active;
  const [jsonText, setJsonText] = useState(() => JSON.stringify(source, null, 2));
  const parsed = useMemo(() => {
    try {
      return { config: JSON.parse(jsonText) as Record<string, unknown>, error: undefined as string | undefined };
    } catch (error) {
      return { config: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  }, [jsonText]);

  useEffect(() => {
    setJsonText(JSON.stringify(source, null, 2));
  }, [source.id, source.updatedAt]);

  function updateConfig(mutator: (config: Record<string, unknown>) => Record<string, unknown>) {
    const base = parsed.config ?? (source as unknown as Record<string, unknown>);
    setJsonText(JSON.stringify(mutator({ ...base }), null, 2));
  }

  function updateDefaults(key: string, value: string) {
    updateConfig((config) => ({
      ...config,
      defaults: {
        ...((typeof config.defaults === "object" && config.defaults !== null)
          ? (config.defaults as Record<string, unknown>)
          : {}),
        [key]: value,
      },
    }));
  }

  function submit(action: CommandReceipt["action"]) {
    if (!parsed.config) {
      return;
    }
    const adapterId = String(parsed.config.id ?? source.id);
    onCommand(action, "cli_adapter", adapterId, { adapterId, config: parsed.config });
  }

  const validation = data.settings.cliAdapter.validation;
  const lastDryRun = data.settings.cliAdapter.lastDryRun;
  const defaults = parsed.config?.defaults as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="border-b border-line bg-white px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-semibold text-ink">{text.systemSettings}</h2>
              <p className="mt-1 text-[13px] text-muted">{text.systemSettingsSubtitle}</p>
            </div>
            <Chip tone={validation.valid && !parsed.error ? "green" : "red"}>
              {validation.valid && !parsed.error ? text.dryRunPassed : text.dryRunFailed}
            </Chip>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-0 max-xl:grid-cols-1">
          <div className="min-w-0 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[15px] font-semibold">{text.cliConfig}</h3>
                <p className="mt-1 text-[13px] text-muted">{text.cliConfigSubtitle}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || Boolean(parsed.error)}
                  onClick={() => submit("validate_cli_adapter_config")}
                >
                  <CheckCircle2 size={14} />
                  {text.validateConfig}
                </Button>
                <Button
                  disabled={busy || Boolean(parsed.error)}
                  onClick={() => submit("save_cli_adapter_config")}
                >
                  <FileText size={14} />
                  {text.saveDraft}
                </Button>
                <Button
                  tone="primary"
                  disabled={busy || Boolean(parsed.error)}
                  onClick={() => submit("activate_cli_adapter_config")}
                >
                  <Play size={14} />
                  {text.activateConfig}
                </Button>
                {data.settings.cliAdapter.draft ? (
                  <Button
                    disabled={busy}
                    onClick={() => submit("disable_cli_adapter_config")}
                  >
                    <XCircle size={14} />
                    {text.disableConfig}
                  </Button>
                ) : null}
              </div>
            </div>
            <label className="text-[12px] font-medium text-muted">{text.adapterJson}</label>
            <textarea
              className="mt-2 min-h-[520px] w-full resize-y rounded-md border border-line bg-slate-950 p-4 font-mono text-[12px] leading-5 text-slate-100 outline-none focus:border-action"
              value={jsonText}
              spellCheck={false}
              onChange={(event) => setJsonText(event.target.value)}
            />
            {parsed.error ? (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {text.jsonParseError}: {parsed.error}
              </div>
            ) : null}
          </div>
          <aside className="border-l border-line bg-slate-50/70 p-4 max-xl:border-l-0 max-xl:border-t">
            <div className="space-y-4">
              <div className="rounded-lg border border-line bg-white">
                <SectionTitle
                  title={text.activeAdapter}
                  action={<Chip tone="green">{data.settings.cliAdapter.active.status}</Chip>}
                />
                <div className="space-y-3 p-4">
                  <FactList
                    rows={[
                      [text.displayName, data.settings.cliAdapter.active.displayName],
                      [text.executable, data.settings.cliAdapter.active.executable],
                      [text.schemaVersion, String(data.settings.cliAdapter.active.schemaVersion)],
                    ]}
                  />
                  {!data.settings.cliAdapter.draft ? (
                    <div className="text-[12px] text-muted">{text.noDraftAdapter}</div>
                  ) : null}
                </div>
              </div>
              <div className="rounded-lg border border-line bg-white">
                <SectionTitle title={text.adapterForm} />
                <div className="space-y-3 p-4">
                  <SettingsInput
                    label={text.displayName}
                    value={String(parsed.config?.displayName ?? "")}
                    onChange={(value) => updateConfig((config) => ({ ...config, displayName: value }))}
                  />
                  <SettingsInput
                    label={text.executable}
                    value={String(parsed.config?.executable ?? "")}
                    onChange={(value) => updateConfig((config) => ({ ...config, executable: value }))}
                  />
                  <SettingsInput
                    label={text.defaultModel}
                    value={String(defaults?.model ?? "")}
                    onChange={(value) => updateDefaults("model", value)}
                  />
                  <SettingsInput
                    label={text.defaultSandbox}
                    value={String(defaults?.sandbox ?? "")}
                    onChange={(value) => updateDefaults("sandbox", value)}
                  />
                  <SettingsInput
                    label={text.defaultApproval}
                    value={String(defaults?.approval ?? "")}
                    onChange={(value) => updateDefaults("approval", value)}
                  />
                </div>
              </div>
              <div className="rounded-lg border border-line bg-white">
                <SectionTitle
                  title={text.lastDryRun}
                  action={
                    <Chip
                      tone={
                        lastDryRun?.status === "passed"
                          ? "green"
                          : lastDryRun?.status
                            ? "red"
                            : "neutral"
                      }
                    >
                      {lastDryRun?.status ?? text.none}
                    </Chip>
                  }
                />
                <div className="space-y-3 p-4 text-[12px]">
                  <FactList
                    rows={[
                      [text.command, lastDryRun?.command ?? text.none],
                      [text.receivedAt, lastDryRun?.at ?? text.none],
                    ]}
                  />
                  {(lastDryRun?.args ?? []).length > 0 ? (
                    <div className="rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
                      {lastDryRun?.args?.join(" ")}
                    </div>
                  ) : null}
                  {[...validation.errors, ...(lastDryRun?.errors ?? [])].map((error) => (
                    <div key={error} className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                      {error}
                    </div>
                  ))}
                  {(validation.warnings ?? []).map((warning) => (
                    <div
                      key={warning}
                      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700"
                    >
                      {warning}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
        <div className="border-t border-line bg-white px-4 py-3 text-[12px] text-muted">
          {data.settings.factSources.join("、")}
        </div>
      </Panel>
    </div>
  );
}
