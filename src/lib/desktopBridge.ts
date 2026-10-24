import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import type { BrowserBridge } from "@sideform/browser-agent/loop";
import { getCommands, runCommand } from "@/lib/commands/registry";
import { useDocumentStore } from "@/store/documentStore";
import type { Doc } from "@/lib/docs/docStore";
import type { CanvasHostBridge } from "@/lib/canvasLink/protocol";

/** What `traces.save` takes: `splitTraceAssets` output (frames moved out of the manifest). */
export interface BrowseTraceSavePayload {
  manifest: BrowseTrace;
  assets: { path: string; dataUrl: string; contentType: string }[];
}

/** One saved local trace as `traces.list` reports it (no frames, no steps). */
export interface StoredTraceSummary {
  id: string;
  goal: string;
  /** Epoch milliseconds. */
  startedAt: number;
  status: string;
  qaOutcome?: string;
}

/** The shell's answer to a trace save: the stored id, or an error text. Never throws. */
export type BrowseTraceSaveResult = { id: string } | { error: string };

/**
 * Bridge to the Electron shell (pen-editor-desktop). The desktop preload
 * exposes window.penDesktop; native menu items send command-palette ids
 * (e.g. "file-open") which we dispatch through the existing registry.
 * On the web window.penDesktop is absent and this is a no-op.
 */
export type DesktopBrowserBridge = BrowserBridge &
  Required<Pick<BrowserBridge, "findImages">> & {
    /**
     * browse_fill_login: fills the saved login for the current page's host
     * (docs/superpowers/specs/2026-10-16-browser-saved-logins-design.md).
     * Optional: desktop builds older than that feature lack it, and the
     * cloud (Steel) bridge never has it. The result holds no secret.
     */
    fillLogin?(args: { label?: string; submit?: boolean }): Promise<unknown>;
    /**
     * Launches an external desktop app (`open({ app })` in the shell) and
     * binds this sender's (and session's) app-bound commands to it. The
     * package executor calls it for `browse_open` with `app`.
     */
    launchApp?(args: { app: string }): Promise<unknown>;
    /**
     * Ends the external app this sender (and session, on an isolated bridge)
     * launched through `open({ app })`; app-bound commands then go back to the
     * browser tab. Optional: only shells that can drive apps have it. Together
     * with `launchApp` it is the `browseApps` client capability.
     */
    releaseApp?(): Promise<unknown>;
    /**
     * The shell can drive native macOS apps (Accessibility helper) through
     * `launchApp`. With `launchApp` and `releaseApp` it is the
     * `browseNativeApps` client capability. Set on darwin only.
     */
    nativeApps?: boolean;
  };

/** Desktop sign-in through the system browser (docs: pen-editor-backend desktop-sign-in spec). Optional: older shells lack it. */
export interface DesktopAuthApi {
  /** Opens the system browser on /auth/desktop; the token comes back through `onToken`. */
  signIn(): void;
  /** Delivers `{ token, verifier }` once per completed browser sign-in. Returns the unsubscribe. */
  onToken(cb: (payload: { token: string; verifier: string }) => void): () => void;
}

/** A markdown document as the shell stores it on disk (`<userData>/documents/<id>.json`): docStore's `Doc`. */
export type StoredDoc = Doc;

/** The shell's on-disk document store. Every method is optional: older shells lack them. */
export interface DesktopDocsDiskApi {
  list?(): Promise<{ docs: StoredDoc[] } | { error: string }>;
  /** Disk keeps the higher rev; `stale` = disk already has rev >= this one and nothing was written. */
  save?(doc: StoredDoc): Promise<{ ok: true; rev: number } | { ok: true; stale: true; rev: number } | { error: string }>;
  remove?(id: string): Promise<{ ok: true } | { error: string }>;
}

/** One canvas as the shell lists it (`<userData>/canvases/<id>.meta.json`). */
export interface StoredCanvasMeta {
  id: string;
  title: string;
  updatedAt: number;
  rev: number;
}

/** A canvas as the shell stores it: `document` is the `.pen` JSON string (`serializeDocument`). */
export interface StoredCanvas extends StoredCanvasMeta {
  document: string;
}

/**
 * The shell's on-disk canvas store (desktop editor tabs). Every method is optional: older
 * shells lack them. Ids match `^[A-Za-z0-9_-]{1,64}$`; the document is at most 64 MB.
 */
export interface DesktopCanvasesApi {
  list?(): Promise<{ canvases: StoredCanvasMeta[] } | { error: string }>;
  read?(id: string): Promise<{ canvas: StoredCanvas | null } | { error: string }>;
  /** Disk keeps the higher rev; `stale` = disk already has rev >= this one and nothing was written. */
  save?(canvas: StoredCanvas): Promise<{ ok: true; rev: number } | { ok: true; stale: true; rev: number } | { error: string }>;
  remove?(id: string): Promise<{ ok: true } | { error: string }>;
}

/** The shell's Settings tab. `section` is a SettingsSection id (src/lib/openSettings.ts). */
export interface DesktopSettingsApi {
  open?(section?: string): Promise<{ ok: boolean }> | void;
  /** Main switches an already-open Settings tab to a section without reloading it. Absent on an older shell. */
  onSection?(cb: (section: string) => void): () => void;
}

/** A saved login from the desktop app's password store. No password ever crosses the bridge back. */
export interface DesktopLoginEntry {
  id: string;
  origin: string;
  username: string;
  label: string;
  /** A data: URL favicon. */
  icon?: string;
}

export type DesktopLoginsListResult =
  | { entries: DesktopLoginEntry[]; encryptionAvailable: boolean }
  | { ok: false; error: string };

export type DesktopLoginsAddResult = { ok: true; id: string } | { ok: false; error: string; exists?: true; id?: string };

export interface DesktopLoginsApi {
  list(): Promise<DesktopLoginsListResult>;
  add(payload: { site: string; username: string; password: string; label?: string }): Promise<DesktopLoginsAddResult>;
}

export interface PenDesktopApi {
  auth?: DesktopAuthApi;
  /** Saved logins for `@` mentions in documents. Absent on the web and on an older shell. */
  logins?: DesktopLoginsApi;
  /**
   * Local browse-run traces (pen-editor-desktop traceStore). Optional: older shells lack it.
   * `read` returns `{ trace }` with data-URL frames, or `{ error }`.
   */
  traces?: {
    save(payload: BrowseTraceSavePayload): Promise<BrowseTraceSaveResult>;
    read(id: string): Promise<{ trace: BrowseTrace } | { error: string }>;
    /** Saved local traces, newest first. Optional: absent on an older shell. There is no cloud list. */
    list?(): Promise<{ traces: StoredTraceSummary[] } | { error: string }>;
  };
  /**
   * Opens a Markdown document (by its docStore id) in a Document tab. Exposed on the
   * /trace page only; older shells lack it.
   */
  docs?: DesktopDocsDiskApi & {
    open?(docId: string): Promise<{ ok: boolean; error?: string }>;
    /** Prints the current Document tab to a PDF (save dialog in the shell). Absent on an older shell. */
    exportPdf?(fileName: string): Promise<{ ok: true; path: string } | { canceled: true } | { error: string }>;
  };
  /** Canvas disk store; see src/lib/canvases/desktopCanvasPersistence.ts. Absent on the web and on an older shell. */
  canvases?: DesktopCanvasesApi;
  setDocumentTitle?(title: string): void;
  /** Opens or focuses the Settings tab (/settings), optionally on a section. Absent on an older shell. */
  settings?: DesktopSettingsApi;
  /** true when the desktop agent layout flag is on: the editor tab is chatless. */
  agentLayout?: boolean;
  /** Canvas link host bridge (desktop agent layout only); see docs/canvas-link.md. */
  canvasHost?: CanvasHostBridge;
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
   *
   * Typed as the package's `BrowserBridge` (the shape the browse_task loop
   * drives) so the two cannot drift; `findImages` is optional there but this
   * shell always provides it. `capture` (browse_capture) stays optional:
   * desktop builds older than that tool lack it.
   */
  browser?: DesktopBrowserBridge & {
      /**
       * Isolated browser session for one browse_agent QA run (pen-editor-desktop
       * docs/superpowers/specs/2026-10-17-isolated-parallel-browse-design.md).
       * Same methods as `browser`, each call targets the session. `sessionId`
       * matches `^[A-Za-z0-9_-]{1,64}$`. Optional: older shells lack it.
       */
      isolated?(sessionId: string): DesktopBrowserBridge;
      /** Closes the isolated session (tabs, fixture, storage). Idempotent. */
      closeSession?(sessionId: string): Promise<{ ok: true } | { error: string }>;
    };
}

declare global {
  interface Window {
    penDesktop?: PenDesktopApi;
    /**
     * Defined by desktopCanvasPersistence while canvas persistence is active. Forces a save of
     * unsaved content and resolves after the shell's `canvases:save` reply (at once when nothing
     * is pending). Never rejects. The shell awaits it before closing a tab and on quit.
     */
    penCanvasFlush?: () => Promise<void>;
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
