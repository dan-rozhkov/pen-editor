import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractTicket, startHostBridge, widgetKeyFromContext, type HostAppLike } from "../hostBridge";
import type { McpBridgeTicketOptions } from "@/lib/mcpBridge";

const ticket = { ticket: "tk1", wsUrl: "wss://api.example.test/api/mcp/ws" };

function makeApp(overrides: Partial<HostAppLike> = {}) {
  const app = {
    ontoolresult: undefined,
    onhostcontextchanged: undefined,
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    callServerTool: vi.fn(async () => ({ _meta: { "sideform/bridge": { ticket: "tk2", wsUrl: ticket.wsUrl } } })),
    requestDisplayMode: vi.fn(async ({ mode }: { mode: "inline" | "fullscreen" | "pip" }) => ({ mode })),
    openLink: vi.fn(async () => ({})),
    sendSizeChanged: vi.fn(async () => {}),
    getHostContext: vi.fn(() => ({ displayMode: "inline" as const })),
    ...overrides,
  } as unknown as HostAppLike & { callServerTool: ReturnType<typeof vi.fn> };
  return app;
}

function makeBridges() {
  const created: Array<McpBridgeTicketOptions & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const createBridge = (options: McpBridgeTicketOptions) => {
    const entry = { ...options, start: vi.fn(), stop: vi.fn() };
    created.push(entry);
    return entry;
  };
  return { created, createBridge };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("extractTicket", () => {
  it.each([
    ["_meta", { _meta: { "sideform/bridge": ticket } }],
    ["structuredContent under the meta key", { structuredContent: { "sideform/bridge": ticket } }],
    ["bare structuredContent", { structuredContent: ticket }],
  ])("reads the ticket from %s", (_name, result) => {
    expect(extractTicket(result)).toEqual(ticket);
  });

  it.each([null, undefined, "x", {}, { _meta: { "sideform/bridge": { ticket: "", wsUrl: "w" } } }, { _meta: { "sideform/bridge": { ticket: "t" } } }])(
    "returns null for %j",
    (result) => {
      expect(extractTicket(result)).toBeNull();
    },
  );
});

describe("startHostBridge", () => {
  it("starts a ticket bridge from the open_canvas tool result", async () => {
    const app = makeApp();
    const { created, createBridge } = makeBridges();
    await startHostBridge({ createApp: () => app, createBridge });

    app.ontoolresult?.({ _meta: { "sideform/bridge": ticket } });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ ticket: "tk1", wsUrl: ticket.wsUrl });
    expect(created[0].start).toHaveBeenCalled();
    expect(app.callServerTool).not.toHaveBeenCalled();
  });

  it("asks for a new ticket through the host after the socket closes, then reconnects", async () => {
    const app = makeApp();
    const { created, createBridge } = makeBridges();
    await startHostBridge({ createApp: () => app, createBridge, random: () => 1 });
    app.ontoolresult?.({ _meta: { "sideform/bridge": ticket } });

    created[0].onClose?.();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(app.callServerTool).toHaveBeenCalledWith({ name: "sideform_bridge_ticket", arguments: {} });
    expect(created).toHaveLength(2);
    expect(created[0].stop).toHaveBeenCalled();
    expect(created[1].ticket).toBe("tk2");
  });

  it("backs off when the ticket call fails and keeps retrying", async () => {
    const app = makeApp({ callServerTool: vi.fn().mockRejectedValue(new Error("nope")) as never });
    const { created, createBridge } = makeBridges();
    await startHostBridge({ createApp: () => app, createBridge, random: () => 1 });
    app.ontoolresult?.({ _meta: { "sideform/bridge": ticket } });

    created[0].onClose?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(app.callServerTool).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(app.callServerTool).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(app.callServerTool).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(1);
  });

  it("asks for a ticket itself when the host never delivers the tool result", async () => {
    const app = makeApp();
    const { created, createBridge } = makeBridges();
    await startHostBridge({ createApp: () => app, createBridge });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(app.callServerTool).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
  });

  it("toggles fullscreen and opens links through the host", async () => {
    const app = makeApp();
    const host = await startHostBridge({ createApp: () => app, createBridge: makeBridges().createBridge });
    expect(await host.toggleFullscreen()).toBe("fullscreen");
    expect(app.requestDisplayMode).toHaveBeenCalledWith({ mode: "fullscreen" });
    expect(await host.openLink("https://x.test/c/1")).toBe(true);
    expect(app.sendSizeChanged).toHaveBeenCalledWith({ height: 600 });
  });

  it("hides Expand when the host does not offer fullscreen", async () => {
    const app = makeApp({
      getHostContext: vi.fn(() => ({ availableDisplayModes: ["inline" as const] })) as never,
    });
    const host = await startHostBridge({ createApp: () => app, createBridge: makeBridges().createBridge });
    expect(host.canExpand()).toBe(false);
  });

  it("stop() tears the bridge down and cancels reconnects", async () => {
    const app = makeApp();
    const { created, createBridge } = makeBridges();
    const host = await startHostBridge({ createApp: () => app, createBridge });
    app.ontoolresult?.({ _meta: { "sideform/bridge": ticket } });
    created[0].onClose?.();
    host.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(created[0].stop).toHaveBeenCalled();
    expect(app.callServerTool).not.toHaveBeenCalled();
    expect(app.close).toHaveBeenCalled();
  });
});

describe("widget key", () => {
  it("uses the tools/call id when the host gives one, else a random unstable key", () => {
    expect(widgetKeyFromContext({ toolInfo: { id: 7, tool: {} as never } })).toEqual({ key: "7", stable: true });
    const a = widgetKeyFromContext(undefined);
    expect(a.stable).toBe(false);
    expect(a.key).not.toBe(widgetKeyFromContext(undefined).key);
  });
});

describe("display mode tracking", () => {
  it("follows requestDisplayMode results and host-context changes", async () => {
    let ctxMode: "inline" | "fullscreen" = "inline";
    const app = makeApp({ getHostContext: vi.fn(() => ({ displayMode: ctxMode })) as never });
    const host = await startHostBridge({ createApp: () => app, createBridge: makeBridges().createBridge });

    expect(await host.toggleFullscreen()).toBe("fullscreen");
    expect(host.getDisplayMode()).toBe("fullscreen");
    expect(await host.toggleFullscreen()).toBe("inline");
    expect(app.requestDisplayMode).toHaveBeenLastCalledWith({ mode: "inline" });

    ctxMode = "fullscreen";
    app.onhostcontextchanged?.({});
    expect(host.getDisplayMode()).toBe("fullscreen");
  });
});
