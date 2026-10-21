import type { BrowseTraceSavePayload, BrowseTraceSaveResult, DesktopAuthApi, DesktopDocsDiskApi, PenDesktopApi } from "@/lib/desktopBridge";
import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import type { AgentPanelCanvasBridge } from "@/lib/canvasLink/protocol";

/** Preload API of the agent panel view (docs/canvas-link.md). */
export interface PenAgentPanelApi {
  version: number;
  /** Desktop sign-in through the system browser; same shape as `window.penDesktop.auth`. Absent on an older shell. */
  auth?: DesktopAuthApi;
  /** version >= 2: the link to the canvas tabs. Absent on an older shell. */
  canvas?: AgentPanelCanvasBridge;
  /** version >= 2: the shell's built-in browser, the same shape as `window.penDesktop.browser`. */
  browser?: NonNullable<PenDesktopApi["browser"]> & {
    /**
     * Makes the tab the agent drives the active one: undefined = the shared browser, a string = an
     * isolated QA session id. Resolves false when there is no such tab (closed). Absent on an older shell.
     */
    revealAgentTab?(sessionId?: string): Promise<unknown>;
  };
  /** The shell's markdown document tabs (/doc). Absent on a shell without doc tabs. */
  docs?: AgentPanelDocsBridge;
  /** Local browse-run traces. Absent on a shell without trace tabs. */
  traces?: {
    save(payload: BrowseTraceSavePayload): Promise<BrowseTraceSaveResult>;
    /** Opens or focuses the trace tab for `id`. */
    open(id: string): Promise<{ ok: boolean; error?: string }>;
    /** Open trace tabs in strip order. Absent on a shell that cannot list them. */
    listTabs?(): Promise<{ tabs: { traceId: string; title: string; active: boolean }[] } | { error: string }>;
    /**
     * The stored trace (the shape `penDesktop.traces.read` returns). `{ frames: false }` skips the frame
     * images: `frame.src` stays the stored asset path. Absent on an older shell.
     */
    read?(id: string, opts?: { frames?: boolean }): Promise<{ trace: BrowseTrace } | { error: string }>;
  };
}

/** Opens or activates the doc tab that shows `docId`. Resolves after the tab exists. */
export interface AgentPanelDocsBridge extends DesktopDocsDiskApi {
  open(docId: string): Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    /** Exposed by the desktop shell's preload ONLY inside the agent panel view. */
    penAgentPanel?: PenAgentPanelApi;
  }
}

/** The panel's markdown-document bridge, or undefined (web, dev build, shell without doc tabs). */
export function getAgentPanelDocsBridge(): AgentPanelDocsBridge | undefined {
  const docs = window.penAgentPanel?.docs;
  return typeof docs?.open === "function" ? docs : undefined;
}

type PanelTraces = NonNullable<PenAgentPanelApi["traces"]>;
/** `traces` with `listTabs` and `read` both present. */
export type TraceTabsBridge = PanelTraces & Required<Pick<PanelTraces, "listTabs" | "read">>;

/** The panel's trace-tab bridge (list + read), or undefined when the shell lacks either function. */
export function getAgentPanelTraceTabsBridge(): TraceTabsBridge | undefined {
  const traces = window.penAgentPanel?.traces;
  return typeof traces?.listTabs === "function" && typeof traces.read === "function" ? (traces as TraceTabsBridge) : undefined;
}

/** The panel's canvas bridge, or undefined (web, dev build, shell older than panel version 2). */
export function getAgentPanelCanvasBridge(): AgentPanelCanvasBridge | undefined {
  return window.penAgentPanel?.canvas;
}

/**
 * True where the standalone /agent chat may run: the desktop shell's agent
 * panel (its preload exposes `window.penAgentPanel`) or a dev build. On the
 * public web the page is a dead end until canvas tools are routed to a canvas
 * tab (tool calls would mutate an empty in-memory scene and vanish).
 */
export function isAgentPanelHost(): boolean {
  return import.meta.env.DEV || typeof window.penAgentPanel !== "undefined";
}

function isRoutePath(pathname: string, name: string, base: string): boolean {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  return pathname === `${prefix}/${name}` || pathname === `${prefix}/${name}/`;
}

/** True when `pathname` is the canvas-less /agent route (basename-aware). */
export function isAgentRoutePath(pathname: string, base: string = import.meta.env.BASE_URL || "/"): boolean {
  return isRoutePath(pathname, "agent", base);
}

/** True when `pathname` is the canvas-less /doc route (basename-aware). */
export function isDocRoutePath(pathname: string, base: string = import.meta.env.BASE_URL || "/"): boolean {
  return isRoutePath(pathname, "doc", base);
}

/** True when `pathname` is the canvas-less /trace/<id> or /trace (open a file) route (basename-aware). */
export function isTraceRoutePath(pathname: string, base: string = import.meta.env.BASE_URL || "/"): boolean {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  return pathname === `${prefix}/trace` || pathname.startsWith(`${prefix}/trace/`);
}

/** True when `pathname` is the canvas-less /auth/desktop hand-off page (basename-aware). */
export function isAuthDesktopRoutePath(pathname: string, base: string = import.meta.env.BASE_URL || "/"): boolean {
  return isRoutePath(pathname, "auth/desktop", base);
}
