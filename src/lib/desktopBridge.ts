import { getCommands, runCommand } from "@/lib/commands/registry";
import { useDocumentStore } from "@/store/documentStore";

/**
 * Bridge to the Electron shell (pen-editor-desktop). The desktop preload
 * exposes window.penDesktop; native menu items send command-palette ids
 * (e.g. "file-open") which we dispatch through the existing registry.
 * On the web window.penDesktop is absent and this is a no-op.
 */
export interface PenDesktopApi {
  setDocumentTitle?(title: string): void;
  onMenuCommand(cb: (commandId: string) => void): () => void;
  /**
   * Registers this tab as the target for the desktop shell's loopback MCP
   * endpoint. Optional — absent on the web and on desktop builds older than
   * this feature, so callers must guard with `?.`. See
   * src/lib/desktopMcpBridge.ts for the page-side registration and
   * ../plans/desktop-mcp-bridge.md §2 for the full handshake/versioning
   * design.
   */
  registerMcpBridge?(handler: {
    /**
     * Call-envelope version, bumped only when the shape of `onCall`
     * changes. Adding/removing tools does not bump it — the desktop shell
     * reconciles by intersecting its manifest with `tools`.
     */
    protocol: number;
    /** The MCP tool-name subset of toolHandlers this tab can execute. */
    tools: string[];
    /** Routes a call through executeToolCall; resolves, never rejects. */
    onCall(name: string, args: unknown): Promise<string>;
  }): () => void;
}

declare global {
  interface Window {
    penDesktop?: PenDesktopApi;
  }
}

export function initDesktopBridge(): () => void {
  const api = window.penDesktop;
  if (!api) return () => {};
  const publishDocumentTitle = (fileName: string | null) => {
    const title = fileName?.replace(/\.[^.]+$/, "").trim() || "Untitled";
    api.setDocumentTitle?.(title);
  };
  publishDocumentTitle(useDocumentStore.getState().fileName);
  const unsubscribeDocument = useDocumentStore.subscribe((state, previous) => {
    if (state.fileName !== previous.fileName) publishDocumentTitle(state.fileName);
  });
  const unsubscribeMenu = api.onMenuCommand((commandId) => {
    const command = getCommands().find((c) => c.id === commandId);
    if (command) {
      runCommand(command);
    } else {
      console.warn(`[desktopBridge] unknown menu command id: ${commandId}`);
    }
  });
  return () => {
    unsubscribeMenu();
    unsubscribeDocument();
  };
}
