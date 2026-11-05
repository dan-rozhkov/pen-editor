// Pure helpers of the start page's Recent list: merge, filter and the relative-time label
// (a port of the desktop shell's relativeTime.ts and recentFilter.ts).

export type RecentKind = "canvas" | "doc" | "workflow";

export interface RecentItem {
  kind: RecentKind;
  id: string;
  title: string;
  updatedAt: number;
}

export const RECENT_KIND_LABELS: Record<RecentKind, string> = {
  canvas: "Canvas",
  doc: "Document",
  workflow: "Workflow",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `then` and `now` are epoch ms. A future `then` (clock skew) reads as "just now". */
export function formatRelativeTime(then: number, now: number): string {
  const diff = now - then;
  if (!Number.isFinite(diff) || diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 12) return `${hours} h ago`;
  const a = new Date(then);
  const b = new Date(now);
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(b) - dayStart(a)) / 86_400_000);
  if (days <= 0) return `${hours} h ago`;
  if (days === 1) return "yesterday";
  const label = `${a.getDate()} ${MONTHS[a.getMonth()]}`;
  return a.getFullYear() === b.getFullYear() ? label : `${label} ${a.getFullYear()}`;
}

export type RecentKinds = Record<RecentKind, boolean>;
export const ALL_KINDS: RecentKinds = { canvas: true, doc: true, workflow: true };

/** Case-insensitive title match; an empty title matches as "Untitled". All kinds off = nothing. */
export function filterRecent(items: RecentItem[], query: string, kinds: RecentKinds): RecentItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => kinds[item.kind] && (q === "" || (item.title || "Untitled").toLowerCase().includes(q)));
}

/** Newest first; ties keep the input order. */
export function sortRecent(items: RecentItem[]): RecentItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.updatedAt - a.item.updatedAt || a.index - b.index)
    .map((x) => x.item);
}
