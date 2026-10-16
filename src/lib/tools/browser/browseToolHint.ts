type Rec = Record<string, unknown>;

const asRecord = (v: unknown): Rec | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined;

const SEGMENT_MAX_CHARS = 24;
const HINT_MAX_CHARS = 48;

/**
 * host + pathname for display: no scheme, query or hash, a bare "/" dropped,
 * any path segment over 24 chars replaced by "…" (reset tokens, magic-link
 * ids), the whole string clipped to 48 chars. Undefined for a missing or
 * invalid URL. Never throws.
 */
export function urlSummary(url: unknown): string | undefined {
  if (typeof url !== "string" || url.trim() === "") return undefined;
  try {
    const u = new URL(url.trim());
    if (!u.host) return undefined;
    const path = u.pathname === "/"
      ? ""
      : u.pathname
          .split("/")
          .map((seg) => (seg.length > SEGMENT_MAX_CHARS ? "…" : seg))
          .join("/");
    const out = u.host + path;
    return out.length > HINT_MAX_CHARS ? `${out.slice(0, HINT_MAX_CHARS)}…` : out;
  } catch {
    return undefined;
  }
}

/**
 * Short muted hint for a browse_* chip: the URL summary for the tools that
 * take a `url`, nothing for the rest (browse_act included). Pure and never
 * throws.
 */
export function browseToolHint(toolName: string, input: unknown): string | undefined {
  try {
    const rec = asRecord(input);
    if (!rec) return undefined;
    switch (toolName) {
      case "browse_agent":
      case "browse_open":
      case "browse_task":
        return urlSummary(rec.url);
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}
