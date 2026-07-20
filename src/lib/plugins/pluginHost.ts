import { useSelectionStore } from "@/store/selectionStore";
import { buildSrcdoc } from "./bootstrap";
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
 * code and wires its RPC traffic to the host facade. v1 iframes are always
 * hidden (headless); visible panels arrive with plg-04.
 */
export function runPlugin(plugin: PenPlugin): PluginInstance {
  stopPlugin(plugin.id);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.style.display = "none";
  iframe.srcdoc = buildSrcdoc(plugin);
  document.body.appendChild(iframe);

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

  const dispose = () => {
    window.removeEventListener("message", onMessage);
    unsubscribeSelection();
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
