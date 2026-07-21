import { useSelectionStore } from "@/store/selectionStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { usePluginPanelStore } from "@/store/pluginPanelStore";
import { buildSrcdoc, buildThemeMessage, buildThemePayload } from "./bootstrap";
import { handlePluginMessage } from "./pluginBridge";
import type { PenPlugin } from "./types";

export interface PluginInstance {
  plugin: PenPlugin;
  iframe: HTMLIFrameElement;
  dispose: () => void;
}

const instances = new Map<string, PluginInstance>();

/**
 * Start (or restart) a plugin: builds a sandboxed iframe running the plugin
 * code and wires its RPC traffic to the host facade. Headless plugins
 * (`ui` null/absent) get a hidden iframe appended to `document.body`, as in
 * v1. UI plugins (`ui` set) get a visible, panel-sized iframe and an entry
 * in `pluginPanelStore`; `PluginPanels` re-parents the iframe into the
 * panel's body DOM node once it mounts.
 */
export function runPlugin(plugin: PenPlugin): PluginInstance {
  stopPlugin(plugin.id);

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

  if (isUiPlugin) usePluginPanelStore.getState().open(plugin, iframe);

  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
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

  let lastTheme = useUIThemeStore.getState().uiTheme;
  const unsubscribeTheme = useUIThemeStore.subscribe((state) => {
    if (state.uiTheme === lastTheme) return;
    lastTheme = state.uiTheme;
    iframe.contentWindow?.postMessage(buildThemeMessage(state.uiTheme), "*");
  });

  const dispose = () => {
    window.removeEventListener("message", onMessage);
    unsubscribeSelection();
    unsubscribeTheme();
    if (isUiPlugin) usePluginPanelStore.getState().close(plugin.id);
    iframe.remove();
    instances.delete(plugin.id);
  };

  const instance: PluginInstance = { plugin, iframe, dispose };
  instances.set(plugin.id, instance);
  return instance;
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
