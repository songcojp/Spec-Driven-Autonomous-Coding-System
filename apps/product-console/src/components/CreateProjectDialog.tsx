import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { scanProjectDirectory } from "../lib/api";
import type { UiStrings } from "../lib/i18n";
import { inferProjectNameFromPath, slugifyProjectName } from "../lib/utils";
import type { ProjectCreateForm, ProjectDirectoryScan } from "../types";
import { Button } from "./ui/primitives";

export function CreateProjectDialog({ text, onCreate }: { text: UiStrings; onCreate: (form: ProjectCreateForm) => void }) {
  const [form, setForm] = useState<ProjectCreateForm>({
    mode: "import_existing",
    name: "",
    goal: "",
    projectType: "autobuild-project",
    techPreferences: "",
    existingProjectPath: "",
    workspaceSlug: "",
    repositoryUrl: "",
    defaultBranch: "main",
    automationEnabled: false,
  });
  const [scan, setScan] = useState<ProjectDirectoryScan | undefined>();
  const [scanError, setScanError] = useState<string | undefined>();
  const [isScanning, setIsScanning] = useState(false);
  const updateForm = (patch: Partial<ProjectCreateForm>) => setForm((previous) => ({ ...previous, ...patch }));

  const remoteRepositoryField = (
    <label className="block text-[13px] font-medium">
      {text.repositoryUrl}
      <input
        className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
        value={form.repositoryUrl}
        onChange={(event) => updateForm({ repositoryUrl: event.target.value })}
        placeholder={text.repositoryUrlPlaceholder}
      />
    </label>
  );

  useEffect(() => {
    if (form.mode !== "import_existing") {
      setScan(undefined);
      setScanError(undefined);
      setIsScanning(false);
      return;
    }
    const targetRepoPath = form.existingProjectPath.trim();
    if (!targetRepoPath) {
      setScan(undefined);
      setScanError(undefined);
      setIsScanning(false);
      return;
    }

    let cancelled = false;
    setIsScanning(true);
    setScanError(undefined);
    const scanTimer = window.setTimeout(() => {
      scanProjectDirectory(targetRepoPath)
        .then((nextScan) => {
          if (cancelled) return;
          setScan(nextScan);
          setForm((previous) => ({
            ...previous,
            name: nextScan.name,
            defaultBranch: nextScan.defaultBranch,
            projectType: nextScan.projectType,
            techPreferences: nextScan.techPreferences.join(", "),
            repositoryUrl:
              nextScan.repository && nextScan.repository !== nextScan.targetRepoPath
                ? nextScan.repository
                : previous.repositoryUrl,
          }));
        })
        .catch((error: Error) => {
          if (cancelled) return;
          setScan(undefined);
          setScanError(error.message);
          setForm((previous) => ({
            ...previous,
            name: inferProjectNameFromPath(targetRepoPath),
            defaultBranch: previous.defaultBranch || "main",
            projectType: previous.projectType || "imported-project",
          }));
        })
        .finally(() => {
          if (!cancelled) setIsScanning(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(scanTimer);
    };
  }, [form.existingProjectPath, form.mode]);

  const createNewFields = (
    <>
      <label className="block text-[13px] font-medium">
        {text.projectName}
        <input
          className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
          value={form.name}
          onChange={(event) =>
            updateForm({ name: event.target.value, workspaceSlug: form.workspaceSlug || slugifyProjectName(event.target.value) })
          }
          placeholder="SpecDrive Demo"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] font-medium">
          {text.defaultBranch}
          <input
            className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
            value={form.defaultBranch}
            onChange={(event) => updateForm({ defaultBranch: event.target.value })}
          />
        </label>
        <label className="flex items-end gap-2 pb-2 text-[13px]">
          <input
            type="checkbox"
            checked={form.automationEnabled}
            onChange={(event) => updateForm({ automationEnabled: event.target.checked })}
          />
          {text.automationEnabled}
        </label>
      </div>
    </>
  );

  const scanSummaryItems: Array<[string, string]> = scan
    ? [
        [text.detectedProjectName, scan.name],
        [text.detectedDefaultBranch, scan.defaultBranch],
        [text.detectedPackageManager, scan.packageManager ?? text.none],
        [text.detectedRepository, scan.repository],
      ]
    : [];

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button className="h-9 whitespace-nowrap" aria-label={text.createProject}>
          <Plus size={15} />
          {text.createProject}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/20" />
        <Dialog.Content className="fixed left-1/2 top-6 max-h-[calc(100vh-48px)] w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-auto rounded-lg border border-line bg-white p-5 shadow-panel">
          <Dialog.Title className="text-[16px] font-semibold">{text.createProject}</Dialog.Title>
          <Dialog.Description className="mt-2 text-[13px] text-muted">{text.createProjectDescription}</Dialog.Description>
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
              <button
                type="button"
                className={`h-9 rounded-md text-[13px] font-medium ${form.mode === "import_existing" ? "bg-white shadow-sm" : "text-muted"}`}
                onClick={() => updateForm({ mode: "import_existing" })}
              >
                {text.importExistingProject}
              </button>
              <button
                type="button"
                className={`h-9 rounded-md text-[13px] font-medium ${form.mode === "create_new" ? "bg-white shadow-sm" : "text-muted"}`}
                onClick={() => updateForm({ mode: "create_new" })}
              >
                {text.createNewProject}
              </button>
            </div>
            {form.mode === "import_existing" ? (
              <>
                <label className="block text-[13px] font-medium">
                  {text.existingProjectPath}
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                    value={form.existingProjectPath}
                    onChange={(event) => updateForm({ existingProjectPath: event.target.value })}
                    placeholder="/home/john/Projects/existing-app"
                  />
                </label>
                {remoteRepositoryField}
                <div className="rounded-md border border-line bg-slate-50 p-3 text-[13px]">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    {isScanning ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
                    {text.scanRepository}
                  </div>
                  {isScanning ? (
                    <div className="text-muted">{text.scanningRepository}</div>
                  ) : scan ? (
                    <dl className="grid gap-2">
                      {scanSummaryItems.map(([label, value]) => (
                        <div key={label} className="grid gap-1 sm:grid-cols-[120px_1fr]">
                          <dt className="text-muted">{label}</dt>
                          <dd className="break-all">{value}</dd>
                        </div>
                      ))}
                      {scan.errors.length > 0 ? <dd className="text-amber-700">{scan.errors.join(", ")}</dd> : null}
                    </dl>
                  ) : scanError ? (
                    <div className="text-red-700">
                      {text.scanRepositoryFailed}: {scanError}
                    </div>
                  ) : (
                    <div className="text-muted">{text.noScanYet}</div>
                  )}
                </div>
              </>
            ) : (
              <>
                {createNewFields}
                <label className="block text-[13px] font-medium">
                  {text.projectGoal}
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                    value={form.goal}
                    onChange={(event) => updateForm({ goal: event.target.value })}
                    placeholder="Automate spec-driven delivery"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-[13px] font-medium">
                    {text.projectType}
                    <input
                      className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                      value={form.projectType}
                      onChange={(event) => updateForm({ projectType: event.target.value })}
                    />
                  </label>
                  <label className="block text-[13px] font-medium">
                    {text.workspaceSlug}
                    <input
                      className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                      value={form.workspaceSlug}
                      onChange={(event) => updateForm({ workspaceSlug: slugifyProjectName(event.target.value) })}
                      placeholder="new-client-app"
                    />
                  </label>
                </div>
                <label className="block text-[13px] font-medium">
                  {text.techPreferences}
                  <input
                    className="mt-2 h-10 w-full rounded-md border border-line px-3 text-[13px]"
                    value={form.techPreferences}
                    onChange={(event) => updateForm({ techPreferences: event.target.value })}
                    placeholder="TypeScript, React, Node.js"
                  />
                </label>
                {remoteRepositoryField}
              </>
            )}
            <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end border-t border-line bg-white p-5">
              <Dialog.Close asChild>
                <Button tone="primary" className="w-full sm:w-auto" onClick={() => onCreate(form)}>
                  {text.submitCommand}
                </Button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
