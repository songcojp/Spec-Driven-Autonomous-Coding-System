import type { ReactNode } from "react";

export function StatusDot({ status }: { status: string }) {
  const color =
    status === "done" || status === "approved" || status === "ready"
      ? "bg-emerald-500"
      : status === "blocked" || status === "failed"
        ? "bg-red-500"
        : status === "pending" || status === "scheduled"
          ? "bg-amber-500"
          : "bg-blue-500";
  return <span className={`inline-block size-2 rounded-full ${color}`} />;
}

export function FactList({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="mt-4 space-y-2 text-[13px]">
      {rows.map(([key, value]) => (
        <div key={key} className="flex justify-between gap-4">
          <dt className="text-muted">{key}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FactBox({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-line bg-slate-50 p-4">
      <div className="mb-2 font-semibold">{title}</div>
      <ul className="space-y-2 text-[13px] text-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function DiffCell({ value }: { value: unknown }) {
  const diff = value as { additions?: number; deletions?: number } | undefined;
  return (
    <div>
      <div className="text-emerald-600">+{diff?.additions ?? 0}</div>
      <div className="text-red-600">-{diff?.deletions ?? 0}</div>
    </div>
  );
}

export function TestCell({ value }: { value: unknown }) {
  const result = value as { passed?: boolean; total?: number } | undefined;
  const passed = result?.passed === true;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${passed ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: passed ? "100%" : "55%" }}
        />
      </div>
      <span>{result?.total ?? "--"}</span>
    </div>
  );
}

export function InspectorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}
