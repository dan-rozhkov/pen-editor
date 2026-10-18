declare global {
  interface Window {
    /** Exposed by the desktop shell's preload ONLY inside the agent panel view. */
    penAgentPanel?: { version: number };
  }
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

/** True when `pathname` is the canvas-less /agent route (basename-aware). */
export function isAgentRoutePath(pathname: string, base: string = import.meta.env.BASE_URL || "/"): boolean {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  return pathname === `${prefix}/agent` || pathname === `${prefix}/agent/`;
}
