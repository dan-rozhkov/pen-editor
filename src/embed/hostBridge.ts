// Host side of the embedded canvas widget. The widget runs inside an MCP Apps
// host's sandboxed iframe: the ONLY thing it may talk to is the host, through
// the ext-apps postMessage transport (`App.connect()` below creates it on
// window.parent — the single place this code touches the parent). Everything
// else — tickets, reconnects, fullscreen, links — goes through that App.
import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-with-deps";
import { McpBridge, type McpBridgeTicketOptions } from "@/lib/mcpBridge";

export const BRIDGE_META_KEY = "sideform/bridge";
export const TICKET_TOOL_NAME = "sideform_bridge_ticket";
const INLINE_HEIGHT_PX = 600;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
// Hosts that do not push the `open_canvas` result to the widget never fire
// ontoolresult; after this long without a ticket the widget asks for one.
const TICKET_WAIT_MS = 2_500;

export interface BridgeTicket {
  ticket: string;
  wsUrl: string;
}

function isTicket(value: unknown): value is BridgeTicket {
  if (!value || typeof value !== "object") return false;
  const { ticket, wsUrl } = value as { ticket?: unknown; wsUrl?: unknown };
  return typeof ticket === "string" && ticket !== "" && typeof wsUrl === "string" && wsUrl !== "";
}

// Both `open_canvas` and `sideform_bridge_ticket` carry it in
// `_meta["sideform/bridge"]` (hidden from the model); structuredContent is a
// harmless fallback for hosts that drop _meta.
export function extractTicket(result: unknown): BridgeTicket | null {
  if (!result || typeof result !== "object") return null;
  const { _meta, structuredContent } = result as {
    _meta?: Record<string, unknown>;
    structuredContent?: Record<string, unknown>;
  };
  const candidates = [_meta?.[BRIDGE_META_KEY], structuredContent?.[BRIDGE_META_KEY], structuredContent];
  for (const candidate of candidates) {
    if (isTicket(candidate)) return { ticket: candidate.ticket, wsUrl: candidate.wsUrl };
  }
  return null;
}

type DisplayMode = "inline" | "fullscreen" | "pip";

export interface HostAppLike {
  ontoolresult: ((params: unknown) => void) | undefined;
  onhostcontextchanged: ((params: McpUiHostContext) => void) | undefined;
  connect(): Promise<void>;
  close(): Promise<void>;
  callServerTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  requestDisplayMode(params: { mode: DisplayMode }): Promise<{ mode: DisplayMode }>;
  openLink(params: { url: string }): Promise<unknown>;
  sendSizeChanged(params: { width?: number; height?: number }): Promise<void>;
  getHostContext(): McpUiHostContext | undefined;
}

// Identity of this widget instance on the host's shared storage origin: the
// id of the tools/call that created it. Without one (host omits toolInfo) a
// per-load random id is used — nothing is restored, nothing collides.
export function widgetKeyFromContext(ctx: McpUiHostContext | undefined): { key: string; stable: boolean } {
  const id = ctx?.toolInfo?.id;
  if (typeof id === "string" || typeof id === "number") return { key: String(id), stable: true };
  return { key: Math.random().toString(36).slice(2), stable: false };
}

export interface HostBridgeDeps {
  createApp?: () => HostAppLike;
  createBridge?: (options: McpBridgeTicketOptions) => { start(): void; stop(): void };
  random?: () => number;
}

export interface HostBridge {
  /** Per-widget storage key (see widgetKeyFromContext). `stable` = safe to restore from. */
  widgetKey: { key: string; stable: boolean };
  /** Mode the host reports now (inline until it says otherwise). */
  getDisplayMode(): DisplayMode;
  /** False when the host lists display modes and fullscreen is not among them. */
  canExpand(): boolean;
  toggleFullscreen(): Promise<DisplayMode>;
  openLink(url: string): Promise<boolean>;
  getTheme(): "light" | "dark" | undefined;
  /** Fires on every host-context change (theme, display mode). */
  onContextChange(listener: () => void): () => void;
  stop(): void;
}

function defaultCreateApp(): HostAppLike {
  // autoResize off: the widget is a fixed-height editor, and the SDK's
  // content-measuring resize would collapse an absolutely-positioned canvas.
  return new App({ name: "sideform-canvas", version: "1.0.0" }, {}, { autoResize: false }) as unknown as HostAppLike;
}

function defaultCreateBridge(options: McpBridgeTicketOptions) {
  return McpBridge.forTicket(options);
}

export async function startHostBridge(deps: HostBridgeDeps = {}): Promise<HostBridge> {
  const app = (deps.createApp ?? defaultCreateApp)();
  const createBridge = deps.createBridge ?? defaultCreateBridge;
  const random = deps.random ?? Math.random;

  let bridge: { stop(): void } | null = null;
  let stopped = false;
  let failures = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let ticketWaitTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const clearTimers = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ticketWaitTimer) clearTimeout(ticketWaitTimer);
    reconnectTimer = null;
    ticketWaitTimer = null;
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** failures);
    failures += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void reconnect();
    }, delay * (0.5 + random() * 0.5));
  };

  const connectWith = (t: BridgeTicket) => {
    if (stopped) return;
    if (ticketWaitTimer) clearTimeout(ticketWaitTimer);
    ticketWaitTimer = null;
    bridge?.stop();
    const next = createBridge({
      wsUrl: t.wsUrl,
      ticket: t.ticket,
      onOpen: () => {
        failures = 0;
      },
      onClose: () => {
        // Ignore the close of a bridge that was already replaced.
        if (bridge === next) scheduleReconnect();
      },
    });
    bridge = next;
    next.start();
  };

  // A dropped socket cannot reuse its single-use ticket: ask the server for a
  // new one through the host (app-only tool), then reconnect.
  const reconnect = async () => {
    if (stopped) return;
    try {
      const t = extractTicket(await app.callServerTool({ name: TICKET_TOOL_NAME, arguments: {} }));
      if (t) {
        connectWith(t);
        return;
      }
    } catch {
      // Host refused or the call failed — fall through to the backoff.
    }
    scheduleReconnect();
  };

  app.ontoolresult = (params) => {
    const t = extractTicket(params);
    if (t) connectWith(t);
  };
  const notify = () => {
    for (const l of listeners) l();
  };
  app.onhostcontextchanged = notify;

  await app.connect();
  ticketWaitTimer = setTimeout(() => {
    ticketWaitTimer = null;
    if (!bridge) void reconnect();
  }, TICKET_WAIT_MS);
  // Inline height is reported once; the host owns the size in fullscreen.
  void app.sendSizeChanged({ height: INLINE_HEIGHT_PX }).catch(() => {});

  // Local mode: updated from requestDisplayMode results AND host-context
  // changes, so the label and the next request never lag the host.
  let localMode: DisplayMode = app.getHostContext()?.displayMode ?? "inline";
  const syncFromContext = () => {
    const m = app.getHostContext()?.displayMode;
    if (m) localMode = m;
  };
  app.onhostcontextchanged = () => {
    syncFromContext();
    notify();
  };
  const displayMode = (): DisplayMode => localMode;

  return {
    widgetKey: widgetKeyFromContext(app.getHostContext()),
    getDisplayMode: displayMode,
    canExpand() {
      const modes = app.getHostContext()?.availableDisplayModes;
      return !modes || modes.includes("fullscreen");
    },
    async toggleFullscreen() {
      const target: DisplayMode = displayMode() === "fullscreen" ? "inline" : "fullscreen";
      try {
        const result = await app.requestDisplayMode({ mode: target });
        localMode = result.mode;
        notify();
        return result.mode;
      } catch {
        return displayMode();
      }
    },
    async openLink(url) {
      try {
        const result = (await app.openLink({ url })) as { isError?: boolean } | undefined;
        return !result?.isError;
      } catch {
        return false;
      }
    },
    getTheme: () => app.getHostContext()?.theme,
    onContextChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      clearTimers();
      bridge?.stop();
      bridge = null;
      void app.close().catch(() => {});
    },
  };
}
