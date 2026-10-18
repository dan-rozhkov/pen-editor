export type UITheme = "light" | "dark";

export const UI_THEME_STORAGE_KEY = "ui-theme";

/** The one parser for a stored/received theme value; anything but "dark" (incl. removed) is light. */
export function parseUITheme(value: string | null): UITheme {
  return value === "dark" ? "dark" : "light";
}

export function getStoredUITheme(): UITheme {
  return parseUITheme(localStorage.getItem(UI_THEME_STORAGE_KEY));
}

export function applyUITheme(theme: UITheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function getAppliedUITheme(): UITheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyStoredUITheme() {
  applyUITheme(getStoredUITheme());
}

/**
 * Switch the theme with `transition: none` in effect, so every surface flips
 * in the same frame. (Moved from uiThemeStore; see the reflow note below.)
 */
const appliedListeners = new Set<(theme: UITheme) => void>();

/** Run `fn` after every no-transition theme switch (e.g. the showcase's theme-color meta). */
export function onUIThemeApplied(fn: (theme: UITheme) => void): () => void {
  appliedListeners.add(fn);
  return () => appliedListeners.delete(fn);
}

export function applyThemeWithoutTransitions(theme: UITheme) {
  const root = document.documentElement;
  root.classList.add("disable-theme-transitions");
  // Apply the theme while transitions are disabled, then force a synchronous
  // style recalc BEFORE removing the class, so the two are not coalesced into
  // one recalc (which would let the transition run). Not dead code.
  applyUITheme(theme);
  void root.offsetHeight;
  requestAnimationFrame(() => {
    root.classList.remove("disable-theme-transitions");
  });
  appliedListeners.forEach((fn) => fn(theme));
}

let mountedEditors = 0;

/** An editor is mounted: it owns its theme. Returns the unmount cleanup (counter-safe for StrictMode). */
export function registerMountedEditor(): () => void {
  mountedEditors += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    mountedEditors -= 1;
  };
}

let stateSetter: ((theme: UITheme) => void) | null = null;
let storageSyncInstalled = false;

/**
 * uiThemeStore registers here (it is loaded on /agent too, via
 * EditorProviders). A remote theme goes through the store, which applies it
 * without transitions and does not persist it.
 */
export function setUIThemeStateSetter(fn: ((theme: UITheme) => void) | null) {
  stateSetter = fn;
}

/**
 * Editor routes (`/app`, `/c/:id`, under the configured base) own their
 * theme: `ui-theme` is also written by document-driven theme application
 * (opening a document), which must not flip other editor tabs.
 */
export function isEditorRoute(pathname: string, base: string = import.meta.env.BASE_URL || "/"): boolean {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  if (!pathname.startsWith(prefix)) return false;
  const path = pathname.slice(prefix.length) || "/";
  return path === "/app" || path.startsWith("/app/") || path.startsWith("/c/");
}

/**
 * Non-editor routes (/agent panel, showcase) follow theme changes made in
 * other same-origin documents; they never write the theme. Decided at event
 * time by the current route. `storage` fires only in the OTHER documents.
 * Idempotent.
 */
export function installUIThemeStorageSync() {
  if (storageSyncInstalled || typeof window === "undefined") return;
  storageSyncInstalled = true;
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.storageArea !== localStorage) return;
    // An editor owns its theme: while one is mounted, or the URL says one is
    // about to mount (cold /app still loading), remote changes are ignored.
    if (mountedEditors > 0 || isEditorRoute(window.location.pathname)) return;
    // key === null: localStorage.clear() in another document -> removed -> light.
    if (e.key !== null && e.key !== UI_THEME_STORAGE_KEY) return;
    const theme = parseUITheme(e.key === null ? null : e.newValue);
    if (stateSetter) stateSetter(theme);
    else applyThemeWithoutTransitions(theme);
  });
}
