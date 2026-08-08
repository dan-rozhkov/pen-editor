import { resolveApiUrl } from "@/lib/apiBase";
import { isDesktopMcpBridgeActive } from "@/lib/desktopMcpBridge";
import { createToolDispatcher, isToolCallMessage, type ToolDispatchOutcome } from "@/lib/mcpDispatch";
import { useMcpBridgeStore } from "@/store/mcpBridgeStore";

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function resolveWsUrl(token: string): string {
  // VITE_MCP_WS_URL is set (dev-only, via vite.config.ts's define) when the
  // token came from the ~/.pen-editor/mcp.json handshake file, and is
  // derived from that handshake's own url/port — the backend instance that
  // actually issued the token. VITE_AI_API_URL/VITE_DESIGN_AGENT_BACKEND_URL
  // configure where the *chat* backend is, which can point at a different
  // port (e.g. a backend started with PORT=3002 while VITE_AI_API_URL still
  // hardcodes :3001) and would otherwise send this token to the wrong
  // endpoint.
  const handshakeWsUrl = import.meta.env.VITE_MCP_WS_URL as string | undefined;
  const wsUrl =
    handshakeWsUrl ??
    // Same backend base resolution useDesignChat uses (VITE_AI_API_URL /
    // VITE_DESIGN_AGENT_BACKEND_URL), http(s) swapped for ws(s).
    resolveApiUrl("/api/mcp/ws").replace(/^http/, "ws");
  return `${wsUrl}?token=${encodeURIComponent(token)}`;
}

// WebSocket client for the browser tab side of the MCP bridge. Started once
// from app bootstrap when VITE_MCP_WS_TOKEN is set (see
// startMcpBridgeIfConfigured below). Dispatches incoming tool_call messages
// through the SAME executeToolCall()/toolHandlers path the built-in chat
// uses, so a bridged call has identical semantics (including its own 30s
// timeout) to a chat-originated one.
export class McpBridge {
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private readonly token: string;
  private readonly wsFactory: (url: string) => WebSocket;
  // Bumped in connect() every time a new socket is created. Used to pin a
  // queued call's liveness check to the socket it actually arrived on —
  // see originGenerationByCallId below.
  private generation = 0;
  // The generation that was current when each in-flight/queued call's
  // message arrived, keyed by call id. A call queued behind an in-flight
  // one can sit for seconds; if its socket drops and a reconnect brings up
  // a new one before the queue reaches it, `this.socket` alone would report
  // "live" again (matching the *new* socket) even though this call arrived
  // on the socket that died. isLive below compares the captured generation
  // against the current one so a reconnect cannot resurrect a call that
  // belongs to a dead connection.
  private originGenerationByCallId = new Map<string, number>();
  private readonly dispatcher = createToolDispatcher({
    send: (message) => this.sendOutcome(message),
    // Re-checked immediately before a queued call executes, not only before
    // sending its outcome: a call queued behind an in-flight one must not
    // run at all if the socket died in the meantime, since its result would
    // be silently dropped by sendOutcome while its scene mutation would
    // still land. Pinned to the *originating* socket's generation, not just
    // "is some socket open now" — a reconnect between queueing and
    // execution must not make a call queued on the old socket look live.
    isLive: (message) => {
      const originGeneration = this.originGenerationByCallId.get(message.id);
      this.originGenerationByCallId.delete(message.id);
      return (
        originGeneration === this.generation &&
        this.socket !== null &&
        this.socket.readyState === WebSocket.OPEN
      );
    },
  });

  constructor(token: string, wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url)) {
    this.token = token;
    this.wsFactory = wsFactory;
  }

  start(): void {
    this.stopped = false;
    window.addEventListener("focus", this.sendActivityPing);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("focus", this.sendActivityPing);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    useMcpBridgeStore.getState().setStatus("off");
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") this.sendActivityPing();
  };

  private sendActivityPing = (): void => {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "activity" }));
    }
  };

  private connect(): void {
    if (this.stopped) return;
    useMcpBridgeStore.getState().setStatus("connecting");

    let socket: WebSocket;
    try {
      socket = this.wsFactory(resolveWsUrl(this.token));
    } catch {
      // e.g. an unsupported/relative API base resolving to a URL the
      // WebSocket constructor rejects synchronously — protects app boot.
      // stop() tears down the focus/visibilitychange listeners start()
      // registered and sets status "off"; no reconnect loop, since retrying
      // the same bad URL can't succeed.
      this.stop();
      return;
    }
    this.socket = socket;
    this.generation += 1;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      useMcpBridgeStore.getState().setStatus("connected");
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      this.onMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      useMcpBridgeStore.getState().setStatus("connecting");
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  private scheduleReconnect(): void {
    const delay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** this.reconnectAttempt);
    const jitter = delay * (0.5 + Math.random() * 0.5);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), jitter);
  }

  private onMessage(data: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return;
    }
    if (!isToolCallMessage(parsed)) return;

    // Capture which socket this call arrived on *now*, at message-arrival
    // time — not when the queue eventually reaches it — so the isLive check
    // above can tell a call queued on a since-replaced socket from one that
    // truly arrived on the currently-open connection.
    this.originGenerationByCallId.set(parsed.id, this.generation);

    // Serial queue (createToolDispatcher): concurrent bridged calls must
    // never interleave scene mutations mid-call.
    this.dispatcher.dispatch(parsed);
  }

  private sendOutcome(message: ToolDispatchOutcome): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }
}

let activeBridge: McpBridge | null = null;

// Starts the MCP bridge iff VITE_MCP_WS_TOKEN is set at build time. No-op
// (including on repeat calls) otherwise — the bridge never attempts a
// WebSocket connection when unconfigured. Also a no-op when the desktop IPC
// bridge has already registered (see desktopMcpBridge.ts) — running both at
// once would give the same toolHandlers two independent serial queues, and
// concurrent calls on each could interleave scene mutations.
export function startMcpBridgeIfConfigured(): void {
  const token = import.meta.env.VITE_MCP_WS_TOKEN as string | undefined;
  if (!token || activeBridge || isDesktopMcpBridgeActive()) return;
  activeBridge = new McpBridge(token);
  activeBridge.start();
}
