import type { DesktopLoginEntry, DesktopLoginsAddResult, DesktopLoginsApi } from "@/lib/desktopBridge";

// Saved logins for `@` mentions in documents, read through the desktop shell's password store.
// The web build and an older shell have no `window.penDesktop.logins`: the mention stays off there.

export type SavedLogin = DesktopLoginEntry;

export type LoadLoginsResult = { ok: true; entries: SavedLogin[] } | { ok: false; error: string };

export type AddLoginResult = DesktopLoginsAddResult;

export interface NewLogin {
  site: string;
  username: string;
  password: string;
  label?: string;
}

/** The chip text; the markdown form is `[<this>](login:<id>)`. */
export function loginChipLabel(username: string, host: string): string {
  return `@${username}${host ? ` · ${host}` : ""}`;
}

const iconById = new Map<string, string>();

function bridge(): DesktopLoginsApi | null {
  const logins = typeof window === "undefined" ? undefined : window.penDesktop?.logins;
  return logins && typeof logins.list === "function" && typeof logins.add === "function" ? logins : null;
}

export function savedLoginsAvailable(): boolean {
  return bridge() !== null;
}

const iconListeners = new Set<() => void>();
let iconsLoaded = false;
let iconsInFlight: Promise<unknown> | null = null;

/** The favicon of a login seen in a list, for chips that only carry the id. */
export function cachedLoginIcon(id: string): string | undefined {
  return iconById.get(id);
}

/** For `useSyncExternalStore`: called when the icon cache gains or changes an icon. */
export function subscribeLoginIcons(listener: () => void): () => void {
  iconListeners.add(listener);
  return () => void iconListeners.delete(listener);
}

/**
 * Fills the icon cache for chips in a loaded document. A success is remembered for the session; a failure is
 * not, so the next chip to mount tries again. Calls while a fetch is running share it. No-op without the bridge.
 */
export function ensureLoginIconsLoaded(): void {
  if (iconsLoaded || iconsInFlight || !bridge()) return;
  iconsInFlight = loadSavedLogins().finally(() => {
    iconsInFlight = null;
  });
}

/** Host (port kept) of an origin or URL; the input itself when it does not parse. */
export function loginHost(origin: string): string {
  try {
    return new URL(origin.includes("://") ? origin : `https://${origin}`).host || origin;
  } catch {
    return origin;
  }
}

/** Never rejects. Called on each open of the popover. */
export async function loadSavedLogins(): Promise<LoadLoginsResult> {
  const api = bridge();
  if (!api) return { ok: false, error: "Saved logins are not available here." };
  try {
    const result = await api.list();
    if ("ok" in result) return { ok: false, error: result.error || "Could not load saved logins." };
    iconsLoaded = true;
    let changed = false;
    for (const entry of result.entries) {
      if (entry.icon && iconById.get(entry.id) !== entry.icon) {
        iconById.set(entry.id, entry.icon);
        changed = true;
      }
    }
    if (changed) for (const listener of [...iconListeners]) listener();
    return { ok: true, entries: result.entries };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : "Could not load saved logins." };
  }
}

/** Never rejects. */
export async function addSavedLogin(login: NewLogin): Promise<AddLoginResult> {
  const api = bridge();
  if (!api) return { ok: false, error: "Saved logins are not available here." };
  try {
    return await api.add(login);
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : "Could not save the login." };
  }
}

/** Case-insensitive match on username, label and host; every word of the query must hit one of them. */
export function filterLogins(entries: SavedLogin[], query: string): SavedLogin[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((entry) => {
    const haystack = [entry.username, entry.label, loginHost(entry.origin), entry.origin].join("\n").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Label of the menu's last row. */
export function createRowLabel(query: string): string {
  const text = query.trim();
  return text ? `Create login “${text}”` : "Create new login";
}

/** The host to show for a login just saved or found as existing: its stored origin, else what the user typed. */
export async function resolveLoginHost(id: string, typedSite: string): Promise<string> {
  const result = await loadSavedLogins();
  const entry = result.ok ? result.entries.find((e) => e.id === id) : undefined;
  return loginHost(entry ? entry.origin : typedSite);
}

/** The desktop's answer when the user declines its confirmation: not a failure to report. */
export const LOGIN_CANCELLED = "Cancelled.";
