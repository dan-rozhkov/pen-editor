import { useSelectionStore } from "@/store/selectionStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { usePluginPanelStore } from "@/store/pluginPanelStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { buildSrcdoc, buildThemeMessage, buildThemePayload } from "./bootstrap";
import { handlePluginMessage, isPluginReadyMessage } from "./pluginBridge";
import type { PenPlugin } from "./types";

export interface PluginInstance {
  plugin: PenPlugin;
  iframe: HTMLIFrameElement;
  isUiPlugin: boolean;
  dispose: () => void;
  /** Module-internal plumbing (not meant for callers outside this file) —
   * kept on the instance so `teardownInstance` can tear either an active
   * instance or a re-run's stale predecessor down identically. */
  onMessage: (event: MessageEvent) => void;
  unsubscribeSelection: () => void;
}

const instances = new Map<string, PluginInstance>();

/**
 * Theme fan-out, shared across every running UI-plugin instance instead of
 * one `useUIThemeStore.subscribe` per instance (the old per-instance wiring
 * also fired for headless plugins, which have no panel and no use for
 * `data-theme`/CSS vars — dead traffic). Lazily subscribed when the first UI
 * instance starts, torn down with the last one; `lastBroadcastTheme` seeds
 * from the current theme each time it (re)subscribes so a toggle that
 * happened while no UI plugin was running doesn't get replayed as a
 * spurious "change" the moment one starts.
 */
let themeUnsubscribe: (() => void) | null = null;
let lastBroadcastTheme = useUIThemeStore.getState().uiTheme;

function ensureThemeBroadcaster(): void {
  if (themeUnsubscribe) return;
  lastBroadcastTheme = useUIThemeStore.getState().uiTheme;
  themeUnsubscribe = useUIThemeStore.subscribe((state) => {
    if (state.uiTheme === lastBroadcastTheme) return;
    lastBroadcastTheme = state.uiTheme;
    const message = buildThemeMessage(state.uiTheme);
    for (const instance of instances.values()) {
      if (!instance.isUiPlugin) continue;
      instance.iframe.contentWindow?.postMessage(message, "*");
    }
  });
}

function teardownThemeBroadcasterIfIdle(): void {
  if (!themeUnsubscribe) return;
  const anyUiRunning = [...instances.values()].some((instance) => instance.isUiPlugin);
  if (anyUiRunning) return;
  themeUnsubscribe();
  themeUnsubscribe = null;
}

/**
 * Start (or restart) a plugin: builds a sandboxed iframe running the plugin
 * code and wires its RPC traffic to the host facade. Headless plugins
 * (`ui` null/absent) get a hidden iframe appended to `document.body`, as in
 * v1. UI plugins (`ui` set) get a visible, panel-sized iframe and an entry
 * in `pluginPanelStore`; `PluginPanels` re-parents the iframe into the
 * panel's body DOM node once it mounts.
 */
export function runPlugin(plugin: PenPlugin): PluginInstance {
  // Re-running an already-open UI plugin (e.g. Manager Run on a plugin
  // that's still running) must keep its panel's on-screen position/size —
  // only the OLD instance's listeners/iframe are torn down here, not its
  // panel entry. `open()` below reuses that entry (swaps the iframe, keeps
  // geometry) *if it's still there* — going through the public `stopPlugin`
  // instead would close the panel first and defeat that reuse before
  // `open()` ever runs (plg-04: this used to snap the panel back to the
  // cascade default on every re-run).
  //
  // Exception: if the plugin was edited between runs to drop its `ui`
  // (going from a UI plugin to headless — e.g. an AI update to an existing
  // plugin's code), the new instance below will never call `open()` again,
  // so the old panel entry — and its now-detached iframe — must be closed
  // here instead of left orphaned in `pluginPanelStore`.
  const existing = instances.get(plugin.id);
  if (existing) {
    const staysUiPanel = existing.isUiPlugin && plugin.ui != null;
    teardownInstance(existing, { closePanel: !staysUiPanel });
  }

  const isUiPlugin = plugin.ui != null;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  if (isUiPlugin) {
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.style.display = "block";
  } else {
    iframe.style.display = "none";
  }
  iframe.srcdoc = buildSrcdoc(plugin, buildThemePayload(useUIThemeStore.getState().uiTheme));
  document.body.appendChild(iframe);

  if (isUiPlugin) usePluginPanelStore.getState().open(plugin.id, plugin.ui, iframe);

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    // One-time readiness handshake (plg-04): reply with the CURRENT theme
    // instead of relying on the srcdoc-baked initial payload staying valid —
    // this is what closes the race where a themechange posted right on load
    // could otherwise beat the iframe's listener registration and be lost.
    // Headless instances have no panel/data-theme to keep in sync, so this
    // (like the broadcaster above) only replies to UI instances.
    if (isUiPlugin && isPluginReadyMessage(event.data)) {
      iframe.contentWindow?.postMessage(buildThemeMessage(useUIThemeStore.getState().uiTheme), "*");
      return;
    }
    void handlePluginMessage(
      plugin.id,
      event.data,
      (response) => iframe.contentWindow?.postMessage(response, "*"),
      () => stopPlugin(plugin.id),
    );
  };
  window.addEventListener("message", onMessage);

  let lastSelection = useSelectionStore.getState().selectedIds;
  const unsubscribeSelection = useSelectionStore.subscribe((state) => {
    if (state.selectedIds === lastSelection) return;
    lastSelection = state.selectedIds;
    iframe.contentWindow?.postMessage(
      { kind: "pen-host-event", event: "selectionchange", payload: [...state.selectedIds] },
      "*",
    );
  });

  if (isUiPlugin) ensureThemeBroadcaster();

  // `dispose()` is the public teardown path (`stopPlugin`/`stopAllPlugins`):
  // it always closes the panel too. The re-run path above bypasses this and
  // calls `teardownInstance` directly with `closePanel: false` instead.
  const dispose = () => teardownInstance(instance, { closePanel: true });

  const instance: PluginInstance = {
    plugin,
    iframe,
    isUiPlugin,
    dispose,
    onMessage,
    unsubscribeSelection,
  };
  instances.set(plugin.id, instance);
  return instance;
}

/** Shared teardown for both the public stop path and the internal re-run
 * path above — the only difference is whether the panel entry itself is
 * removed (`closePanel`) or left for the caller to reuse. The broadcaster
 * idle-check is also skipped on the re-run path: it's always immediately
 * followed by a new instance for the same id in the same `runPlugin` call,
 * so tearing the (possibly still-needed) broadcaster down here would just
 * mean re-subscribing a moment later. */
function teardownInstance(instance: PluginInstance, { closePanel }: { closePanel: boolean }): void {
  window.removeEventListener("message", instance.onMessage);
  instance.unsubscribeSelection();
  if (closePanel && instance.isUiPlugin) usePluginPanelStore.getState().close(instance.plugin.id);
  instance.iframe.remove();
  instances.delete(instance.plugin.id);
  if (closePanel) teardownThemeBroadcasterIfIdle();
}

export function stopPlugin(pluginId: string): void {
  instances.get(pluginId)?.dispose();
}

export function getRunningPlugin(pluginId: string): PluginInstance | undefined {
  return instances.get(pluginId);
}

export function stopAllPlugins(): void {
  for (const instance of [...instances.values()]) instance.dispose();
}

// Plugins only make sense in edit mode — `PluginPanels`, the manager panel,
// and the command-palette entries that run them are all gated to
// `mode === "edit"` in App.tsx. Leaving edit used to just unmount that DOM
// (detaching each panel's iframe) without disposing the underlying
// instances, leaking their message listeners/store subscriptions against a
// now-detached iframe and resurrecting stale panel state if the user
// re-entered edit. Stopping everything here — the one place that already
// owns the full instance lifecycle — closes that gap for every mode
// transition, not just the ones App.tsx happens to gate today.
useEditorModeStore.subscribe((state, prevState) => {
  if (prevState.mode === "edit" && state.mode !== "edit") stopAllPlugins();
});
