import type { PenPlugin, PluginHostEvent, PluginTheme, PluginThemePayload } from "./types";
import { PLUGIN_UI_KIT_STYLES } from "./uiKitStyles";

/** CSS custom properties (`src/index.css`) mirrored into a plugin iframe so
 * its own markup can read `var(--color-surface-panel)` etc. Read live via
 * `getComputedStyle` rather than hardcoded, so a future palette edit doesn't
 * need a matching change here.
 *
 * Includes the app's un-prefixed `--primary`/`--secondary`/`--input` family
 * (declared directly on `:root`/`.dark`, alongside the `--color-*` tokens)
 * because `.pen-button-primary`/`.pen-input`/`.pen-select` (`uiKitStyles.ts`)
 * are keyed off those to match `src/components/ui/button.tsx`, `input.tsx`
 * and `select.tsx`'s actual recipes, rather than the `--color-*` family. */
export const THEME_CSS_VARS = [
  "--color-surface-base",
  "--color-surface-panel",
  "--color-surface-elevated",
  "--color-surface-hover",
  "--color-surface-active",
  "--color-border-default",
  "--color-border-light",
  "--color-border-hover",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-muted",
  "--color-text-disabled",
  "--color-accent-primary",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--input",
] as const;

/** Snapshot the editor's current theme tokens off `<html>`. */
export function readThemeVars(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of THEME_CSS_VARS) {
    const value = computed.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return vars;
}

export function buildThemePayload(theme: PluginTheme): PluginThemePayload {
  return { theme, cssVars: readThemeVars() };
}

/** Host→iframe `themechange` event, posted on theme toggle to every running
 * plugin instance (see `pluginHost.ts`). */
export function buildThemeMessage(theme: PluginTheme): PluginHostEvent {
  return { kind: "pen-host-event", event: "themechange", payload: buildThemePayload(theme) };
}

/**
 * Runs INSIDE the sandbox iframe. Serialized with .toString() into srcdoc —
 * therefore it must be fully self-contained: no imports, no outer-scope
 * references, no TS-only constructs that don't erase cleanly.
 */
export function pluginBootstrap(): void {
  const RPC_TIMEOUT_MS = 30_000;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const listeners: Record<string, Array<(payload: unknown) => void>> = {};
  let nextCallId = 1;

  function call(method: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const callId = nextCallId++;
      const timer = setTimeout(() => {
        pending.delete(callId);
        reject(new Error("pen RPC timeout: " + method));
      }, RPC_TIMEOUT_MS);
      pending.set(callId, { resolve, reject, timer });
      window.parent.postMessage({ kind: "pen-rpc-request", callId, method, args }, "*");
    });
  }

  // Applies a `themechange` payload directly to this document — independent
  // of whether the plugin itself calls `pen.on("themechange", ...)` — so a
  // plugin's own markup can rely on `[data-theme]`/`var(--color-*)` for free,
  // matching the initial values srcdoc already injects at load.
  function applyThemePayload(payload: unknown): void {
    const p = (payload ?? {}) as { theme?: unknown; cssVars?: unknown };
    const theme = typeof p.theme === "string" ? p.theme : "light";
    document.documentElement.setAttribute("data-theme", theme);
    let style = document.getElementById("pen-theme-vars") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "pen-theme-vars";
      document.head.appendChild(style);
    }
    const cssVars = (p.cssVars ?? {}) as Record<string, unknown>;
    const decls: string[] = [];
    for (const key in cssVars) {
      const value = cssVars[key];
      if (typeof value === "string") decls.push(key + ":" + value + ";");
    }
    style.textContent = ":root{" + decls.join("") + "}";
  }

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const data = event.data as { kind?: string; callId?: number; ok?: boolean; result?: unknown; error?: unknown; event?: string; payload?: unknown } | null;
    if (!data || typeof data !== "object") return;
    if (data.kind === "pen-rpc-response" && typeof data.callId === "number") {
      const entry = pending.get(data.callId);
      if (!entry) return;
      pending.delete(data.callId);
      clearTimeout(entry.timer);
      if (data.ok) entry.resolve(data.result);
      else entry.reject(new Error(String(data.error)));
    } else if (data.kind === "pen-host-event" && typeof data.event === "string") {
      if (data.event === "themechange") applyThemePayload(data.payload);
      for (const cb of listeners[data.event] ?? []) cb(data.payload);
    }
  });

  // One-time readiness handshake: without this, a `themechange` the host
  // posts immediately on iframe load can arrive before this very listener
  // above finishes registering (the srcdoc's initial theme is baked in
  // separately, so the *first* paint is always right — but a toggle that
  // races the listener would otherwise be silently dropped with no retry).
  // The host replies with the CURRENT theme once this arrives (pluginHost.ts).
  window.parent.postMessage({ kind: "pen-plugin-ready" }, "*");

  (window as unknown as Record<string, unknown>).pen = {
    tools: { run: (name: string, args: unknown) => call("tools.run", name, args) },
    scene: {
      batch: (operations: string) => call("scene.batch", operations),
      get: (ids?: string[]) => call("scene.get", ids ?? null),
    },
    selection: {
      get: () => call("selection.get"),
      set: (ids: string[]) => call("selection.set", ids),
    },
    viewport: { zoomTo: (ids: string[]) => call("viewport.zoomTo", ids) },
    ui: {
      /** Ask the host to resize this plugin's panel (no-op for headless
       * plugins — the host rejects the RPC if there's no open panel). */
      resize: (width: number, height: number) => call("ui.resize", width, height),
    },
    notify: (message: string) => { call("notify", message).catch(() => {}); },
    storage: {
      get: (key: string) => call("storage.get", key),
      set: (key: string, value: unknown) => call("storage.set", key, value),
    },
    on: (event: string, cb: (payload: unknown) => void) => {
      (listeners[event] ??= []).push(cb);
    },
    close: () => { call("close").catch(() => {}); },
  };
}

/** Full srcdoc HTML for a plugin's sandbox iframe. `initialTheme` is baked in
 * directly (not delivered via postMessage) so the very first paint already
 * has the right tokens/`data-theme` — no same-origin access needed, no flash
 * of the wrong theme while the first RPC round-trip is in flight. */
export function buildSrcdoc(plugin: PenPlugin, initialTheme?: PluginThemePayload): string {
  // A literal "</script>" inside plugin code would terminate our script tag.
  const safeCode = plugin.code.replace(/<\/script/gi, "<\\/script");
  const theme = initialTheme ?? { theme: "light" as const, cssVars: {} };
  const decls = Object.entries(theme.cssVars)
    .map(([key, value]) => `${key}:${value};`)
    .join("");
  return [
    `<!doctype html><html data-theme="${theme.theme}"><head><meta charset="utf-8">`,
    `<style id="pen-theme-vars">:root{${decls}}</style>`,
    // Always included, even for headless plugins with no visible panel: it's
    // invisible dead CSS in that case, and keeping buildSrcdoc's output shape
    // uniform is simpler than branching on `plugin.ui` here.
    `<style id="pen-ui-kit">${PLUGIN_UI_KIT_STYLES}</style>`,
    "</head><body>",
    `<script>(${pluginBootstrap.toString()})();</script>`,
    `<script type="module">${safeCode}</script>`,
    "</body></html>",
  ].join("\n");
}
