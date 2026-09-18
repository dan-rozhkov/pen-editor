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
  /**
   * Preload surface for the desktop shell's built-in browser tab (docs/
   * superpowers/specs/2026-09-18-builtin-browser-design.md §5). Optional —
   * absent on the web and on desktop builds older than this feature; the
   * three browse_* tool handlers (src/lib/tools/browser/) guard with `?.`
   * and degrade to a documented error string when it's missing. Each call
   * is `ipcRenderer.invoke("browser:command", ...)` under the hood and
   * always resolves (main is the trust boundary and validates everything),
   * never rejects with anything the handler needs to catch specially — but
   * the handlers still wrap every call in try/catch defensively, matching
   * every other ToolHandler's "always resolves" contract.
   */
  browser?: {
    open(args: { url: string }): Promise<unknown>;
    act(args: Record<string, unknown>): Promise<unknown>;
    findImages(args: Record<string, unknown>): Promise<unknown>;
    /**
     * browse_read (docs/superpowers/specs/2026-09-18-browse-task-jev-loop-
     * design.md, Addendum 2 §2) — a readable digest of the current page:
     * headings, capped visible text, and links.
     */
    read(args: Record<string, unknown>): Promise<unknown>;
    /**
     * browse_task loop internals (docs/superpowers/specs/
     * 2026-09-18-browse-task-jev-loop-design.md §1/§3). Not exposed as their
     * own chat tools — `snapshot` returns the page's element table stamped
     * with a `snapshotId`, and `perform` acts by index against that same
     * snapshot, rejecting a stale id. Only `src/lib/tools/browser/
     * browseTask.ts` calls these; the model never sees them directly.
     */
    snapshot(): Promise<unknown>;
    perform(args: {
      snapshotId: string;
      index?: number;
      operation: string;
      text?: string;
    }): Promise<unknown>;
  };
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
