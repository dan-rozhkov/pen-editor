import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RootErrorBoundary } from "@/components/RootErrorBoundary";
import { EmbedApp } from "./EmbedApp";
import { startHostBridge, type HostBridge } from "./hostBridge";
import { setShareCredentialsKeySuffix } from "@/lib/shareCanvas";
import { restoreEmbedDocument, startEmbedAutosave } from "./persistence";
import { syncDefaultPageBackground } from "@/store/uiThemeStore";

export interface BootDeps {
  connectHost?: () => Promise<HostBridge>;
}

// Boots the widget into `container`. Deliberately NOT main.tsx's bootstrap:
// no router, analytics, WebMCP, desktop bridge, cookie/token bridge or
// service worker. The editor renders immediately; the host connection (and
// with it the agent bridge) attaches when the handshake finishes.
export function bootEmbed(container: HTMLElement, deps: BootDeps = {}): () => void {
  // The UI theme is not read from storage here: EmbedApp applies the host's
  // theme (or prefers-color-scheme) as a non-persisted override.
  // Storage is namespaced per widget instance, which is only known once the
  // host has answered — so restore/autosave start after the handshake.
  let stopAutosave = () => {};

  const root = createRoot(container);
  const render = (host: HostBridge | null) =>
    root.render(
      <StrictMode>
        <RootErrorBoundary>
          <EmbedApp host={host} />
        </RootErrorBoundary>
      </StrictMode>,
    );
  render(null);

  let host: HostBridge | null = null;
  let disposed = false;
  (deps.connectHost ?? startHostBridge)()
    .then((connected) => {
      if (disposed) {
        connected.stop();
        return;
      }
      host = connected;
      const { key, stable } = connected.widgetKey;
      setShareCredentialsKeySuffix(key);
      if (stable && restoreEmbedDocument(key)) syncDefaultPageBackground();
      stopAutosave = startEmbedAutosave(key);
      render(connected);
    })
    .catch((error) => {
      // Not inside an MCP Apps host (opened directly): the editor still works.
      console.warn("[embed] host connection failed", error);
      // No host identity: keep this load's storage private (random key, no restore).
      const key = Math.random().toString(36).slice(2);
      setShareCredentialsKeySuffix(key);
      stopAutosave = startEmbedAutosave(key);
    });

  return () => {
    disposed = true;
    stopAutosave();
    host?.stop();
    root.unmount();
  };
}
