import type { Locale } from "./i18n";

export const statusTone: Record<string, "neutral" | "green" | "amber" | "red" | "blue"> = {
  approved: "green",
  done: "green",
  completed: "green",
  ready: "green",
  running: "blue",
  scheduled: "blue",
  queued: "blue",
  pending: "amber",
  review_needed: "amber",
  transition: "blue",
  evidence: "blue",
  approval: "green",
  recorded: "neutral",
  blocked: "red",
  failed: "red",
};

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatPrecisePercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export function formatRelativeTime(isoString: string | undefined, locale: Locale): string {
  if (!isoString) {
    return locale === "zh-CN" ? "未知" : "unknown";
  }
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) {
    return locale === "zh-CN" ? "刚刚" : "just now";
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return locale === "zh-CN" ? `${diffMinutes} 分钟前` : `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return locale === "zh-CN" ? `${diffHours} 小时前` : `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return locale === "zh-CN" ? `${diffDays} 天前` : `${diffDays}d ago`;
}

export function formatAuditTime(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(11, 19);
}

export function humanizeSpecKey(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function joinDisplayPath(root: string, path: string): string {
  const normalizedRoot = root.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  return normalizedRoot ? `${normalizedRoot}/${normalizedPath}` : normalizedPath;
}

export function normalizeSpecItems(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(formatSpecValue);
  if (value === undefined || value === null || value === "") return [];
  return [formatSpecValue(value)];
}

export function formatSpecValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function slugifyProjectName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "new-project"
  );
}

export function inferProjectNameFromPath(value: string): string {
  return (
    value
      .trim()
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

export function metricIconBg(tone: string): string {
  if (tone === "red") return "bg-red-50";
  if (tone === "amber") return "bg-amber-50";
  if (tone === "blue") return "bg-blue-50";
  if (tone === "green") return "bg-emerald-50";
  return "bg-slate-50";
}

export function metricIconColor(tone: string): string {
  if (tone === "red") return "text-red-600";
  if (tone === "amber") return "text-amber-600";
  if (tone === "blue") return "text-action";
  if (tone === "green") return "text-emerald-600";
  return "text-slate-600";
}
