const TARGET_MAX_CHARS = 40;

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

function actHint(input: Rec): string | undefined {
  const { actions, action } = input;
  const target =
    typeof input.target === "string" && input.target !== ""
      ? input.target
      : typeof input.element === "string" && input.element !== ""
        ? input.element
        : typeof input.index === "number"
          ? `#${input.index}`
          : undefined;
  if (Array.isArray(actions) && actions.length > 0) {
    return `${actions.length} ${actions.length === 1 ? "action" : "actions"}`;
  }
  if (typeof action !== "string" || action === "") return undefined;
  if (target === undefined) return action;
  const clipped = target.length > TARGET_MAX_CHARS ? `${target.slice(0, TARGET_MAX_CHARS)}…` : target;
  return `${action} ${clipped}`;
}

/**
 * Short muted hint for a browse_* chip. Pure and never throws. It reads only
 * the URL (without query/hash) and, for browse_act, the action name and its
 * target: never `text`, `key` or any other value, since typed text can be a
 * password.
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
      case "browse_act":
        return actHint(rec);
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}
