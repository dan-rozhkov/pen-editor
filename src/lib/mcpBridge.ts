import { executeToolCall } from "@/hooks/useDesignChat";
import { resolveApiUrl } from "@/lib/apiBase";
import { toolHandlers } from "@/lib/toolRegistry";
import { useMcpBridgeStore } from "@/store/mcpBridgeStore";

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

interface ToolCallMessage {
  id: string;
  type: "tool_call";
  tool: string;
  args: unknown;
}

function isToolCallMessage(value: unknown): value is ToolCallMessage {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "tool_call" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { tool?: unknown }).tool === "string"
  );
}

function resolveWsUrl(token: string): string {
  // Same backend base resolution useDesignChat uses (VITE_AI_API_URL /
  // VITE_DESIGN_AGENT_BACKEND_URL), http(s) swapped for ws(s).
  const httpUrl = resolveApiUrl("/api/mcp/ws");
  const wsUrl = httpUrl.replace(/^http/, "ws");
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
  private queue: Promise<void> = Promise.resolve();
  private readonly token: string;
  private readonly wsFactory: (url: string) => WebSocket;

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

    // Serial queue: concurrent bridged calls must never interleave scene
    // mutations mid-call.
    this.queue = this.queue.then(() => this.handleToolCall(parsed));
  }

  private async handleToolCall(message: ToolCallMessage): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    if (!(message.tool in toolHandlers)) {
      socket.send(
        JSON.stringify({ id: message.id, type: "tool_error", error: `Unknown tool: ${message.tool}` })
      );
      return;
    }

    const result = await executeToolCall(message.tool, message.args);
    socket.send(JSON.stringify({ id: message.id, type: "tool_result", result }));
  }
}

let activeBridge: McpBridge | null = null;

// Starts the MCP bridge iff VITE_MCP_WS_TOKEN is set at build time. No-op
// (including on repeat calls) otherwise — the bridge never attempts a
// WebSocket connection when unconfigured.
export function startMcpBridgeIfConfigured(): void {
  const token = import.meta.env.VITE_MCP_WS_TOKEN as string | undefined;
  if (!token || activeBridge) return;
  activeBridge = new McpBridge(token);
  activeBridge.start();
}
