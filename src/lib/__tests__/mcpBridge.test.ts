import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpBridge } from "@/lib/mcpBridge";
import { useMcpBridgeStore } from "@/store/mcpBridgeStore";
import { toolHandlers } from "@/lib/toolRegistry";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  url: string;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  emit(type: string, event: unknown): void {
    for (const l of this.listeners[type] ?? []) l(event);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  message(data: unknown): void {
    this.emit("message", { data: typeof data === "string" ? data : JSON.stringify(data) });
  }
}

function makeFactory() {
  FakeWebSocket.instances = [];
  return (url: string) => new FakeWebSocket(url) as unknown as WebSocket;
}

beforeEach(() => {
  useMcpBridgeStore.setState({ status: "off" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("McpBridge", () => {
  it("connects and marks the store connected on open", () => {
    const factory = makeFactory();
    const bridge = new McpBridge("secret-token", factory);
    bridge.start();

    expect(useMcpBridgeStore.getState().status).toBe("connecting");
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toContain("/api/mcp/ws?token=secret-token");

    socket.open();
    expect(useMcpBridgeStore.getState().status).toBe("connected");

    bridge.stop();
  });

  it("dispatches a tool_call into toolHandlers and replies tool_result", async () => {
    const factory = makeFactory();
    const bridge = new McpBridge("secret-token", factory);
    bridge.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    const originalHandler = toolHandlers.get_variables;
    toolHandlers.get_variables = vi.fn(async () => '{"variables":[]}');

    socket.message({ id: "call-1", type: "tool_call", tool: "get_variables", args: {} });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));

    expect(JSON.parse(socket.sent[0])).toEqual({
      id: "call-1",
      type: "tool_result",
      result: '{"variables":[]}',
    });

    toolHandlers.get_variables = originalHandler;
    bridge.stop();
  });

  it("replies tool_error for an unknown tool name without calling any handler", async () => {
    const factory = makeFactory();
    const bridge = new McpBridge("secret-token", factory);
    bridge.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    socket.message({ id: "call-2", type: "tool_call", tool: "not_a_real_tool", args: {} });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));

    const reply = JSON.parse(socket.sent[0]);
    expect(reply.type).toBe("tool_error");
    expect(reply.error).toContain("Unknown tool");

    bridge.stop();
  });

  it("serializes concurrent tool calls so a second call waits for the first", async () => {
    const factory = makeFactory();
    const bridge = new McpBridge("secret-token", factory);
    bridge.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    let resolveFirst: (() => void) | undefined;
    const order: string[] = [];
    const originalVariables = toolHandlers.get_variables;
    const originalStyles = toolHandlers.get_styles;
    toolHandlers.get_variables = vi.fn(async () => {
      order.push("start-1");
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      order.push("end-1");
      return "1";
    });
    toolHandlers.get_styles = vi.fn(async () => {
      order.push("start-2");
      return "2";
    });

    socket.message({ id: "call-1", type: "tool_call", tool: "get_variables", args: {} });
    socket.message({ id: "call-2", type: "tool_call", tool: "get_styles", args: {} });

    await vi.waitFor(() => expect(order).toEqual(["start-1"]));
    resolveFirst?.();
    await vi.waitFor(() => expect(order).toEqual(["start-1", "end-1", "start-2"]));

    toolHandlers.get_variables = originalVariables;
    toolHandlers.get_styles = originalStyles;
    bridge.stop();
  });

  it("reconnects with exponential backoff after a close, capped at 30s", () => {
    vi.useFakeTimers();
    const factory = makeFactory();
    const bridge = new McpBridge("secret-token", factory);
    bridge.start();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].close();

    expect(useMcpBridgeStore.getState().status).toBe("connecting");
    expect(FakeWebSocket.instances).toHaveLength(1);

    // First reconnect delay is in [1000, 2000)ms (1s base * [0.5, 1) jitter...
    // actually [0.5,1) applied to the base gives [500,1000); advancing 1000ms
    // always covers it).
    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].close();
    vi.advanceTimersByTime(2_000); // second delay is in [1000, 2000)
    expect(FakeWebSocket.instances).toHaveLength(3);

    bridge.stop();
  });

  it("caps the reconnect delay at 30s even after many failures", () => {
    vi.useFakeTimers();
    const factory = makeFactory();
    const bridge = new McpBridge("secret-token", factory);
    bridge.start();

    for (let i = 0; i < 8; i++) {
      FakeWebSocket.instances[FakeWebSocket.instances.length - 1].close();
      vi.advanceTimersByTime(30_000); // every delay is <= 30s by construction
    }
    expect(FakeWebSocket.instances.length).toBe(9);

    bridge.stop();
  });

  it("sends an activity ping on window focus while connected", () => {
    const factory = makeFactory();
    const bridge = new McpBridge("secret-token", factory);
    bridge.start();
    FakeWebSocket.instances[0].open();

    window.dispatchEvent(new Event("focus"));

    const pings = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s));
    expect(pings).toContainEqual({ type: "activity" });

    bridge.stop();
  });

  it("stop() tears down listeners, closes the socket, and sets status to off", () => {
    const factory = makeFactory();
    const bridge = new McpBridge("secret-token", factory);
    bridge.start();
    FakeWebSocket.instances[0].open();

    bridge.stop();

    expect(useMcpBridgeStore.getState().status).toBe("off");
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);

    // A focus event after stop() must not reconnect or send anything.
    const sentBefore = FakeWebSocket.instances[0].sent.length;
    window.dispatchEvent(new Event("focus"));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].sent).toHaveLength(sentBefore);
  });
});
