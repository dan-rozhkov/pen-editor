import type { PenDesktopApi } from "@/lib/desktopBridge";
import type { AgentPanelCanvasBridge } from "@/lib/canvasLink/protocol";

/** Preload API of the agent panel view (docs/canvas-link.md). */
export interface PenAgentPanelApi {
  version: number;
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
}

/** Opens or activates the doc tab that shows `docId`. Resolves after the tab exists. */
export interface AgentPanelDocsBridge {
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
