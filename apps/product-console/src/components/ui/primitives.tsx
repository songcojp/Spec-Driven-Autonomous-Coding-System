import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

const toneStyles = {
  default: "border-line bg-white text-ink hover:bg-slate-50",
  primary: "border-action bg-action text-white hover:bg-blue-700",
  quiet: "border-transparent bg-transparent text-muted hover:bg-slate-100 hover:text-ink",
  danger: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
} as const;

export function Button({
  tone = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof toneStyles }) {
  return (
    <button
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-action/30 disabled:cursor-not-allowed disabled:opacity-50 ${toneStyles[tone]} ${className}`}
      {...props}
    />
  );
}

export function Panel({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-lg border border-line bg-panel shadow-panel ${className}`} {...props} />;
}

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
  children: ReactNode;
}) {
  const classes = {
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
  }[tone];
  return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[12px] font-medium ${classes}`}>{children}</span>;
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between border-b border-line px-4">
      <h2 className="text-[15px] font-semibold tracking-normal text-ink">{title}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ title }: { title: string }) {
  return <div className="flex min-h-32 items-center justify-center px-4 text-center text-[13px] text-muted">{title}</div>;
}
