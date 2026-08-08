import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initDesktopMcpBridge, isDesktopMcpBridgeActive } from "@/lib/desktopMcpBridge";
import type { PenDesktopApi } from "@/lib/desktopBridge";
import { DESKTOP_MCP_TOOL_NAMES } from "@/lib/mcpToolNames";
import { useMcpBridgeStore } from "@/store/mcpBridgeStore";
import * as useDesignChatModule from "@/hooks/useDesignChat";

type McpBridgeHandler = Parameters<NonNullable<PenDesktopApi["registerMcpBridge"]>>[0];

let dispose: (() => void) | undefined;

function installFakePenDesktop() {
  const unregister = vi.fn();
  const registerMcpBridge = vi.fn((_handler: McpBridgeHandler) => unregister);
  (window as { penDesktop?: unknown }).penDesktop = {
    onMenuCommand: () => () => {},
    registerMcpBridge,
  };
  return { registerMcpBridge, unregister };
}

beforeEach(() => {
  useMcpBridgeStore.setState({ status: "off" });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  delete (window as { penDesktop?: unknown }).penDesktop;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("initDesktopMcpBridge", () => {
  it("is a no-op on the web (no window.penDesktop)", () => {
    expect(() => {
      dispose = initDesktopMcpBridge();
    }).not.toThrow();
    expect(isDesktopMcpBridgeActive()).toBe(false);
    expect(useMcpBridgeStore.getState().status).toBe("off");
  });

  it("is a no-op on an older desktop build without registerMcpBridge", () => {
    (window as { penDesktop?: unknown }).penDesktop = { onMenuCommand: () => () => {} };
    dispose = initDesktopMcpBridge();
    expect(isDesktopMcpBridgeActive()).toBe(false);
    expect(useMcpBridgeStore.getState().status).toBe("off");
  });

  it("registers with protocol 1 and exactly the MCP tool-name subset, marking the store connected", () => {
    const { registerMcpBridge } = installFakePenDesktop();

    dispose = initDesktopMcpBridge();

    expect(registerMcpBridge).toHaveBeenCalledTimes(1);
    const handler = registerMcpBridge.mock.calls[0][0];
    expect(handler.protocol).toBe(1);
    // Derived from the same shared source (mcpToolNames.ts) the production
    // code reads, rather than a hand-copied third list — see finding 4.
    expect([...handler.tools].sort()).toEqual([...DESKTOP_MCP_TOOL_NAMES].sort());
    expect(typeof handler.onCall).toBe("function");
    expect(isDesktopMcpBridgeActive()).toBe(true);
    expect(useMcpBridgeStore.getState().status).toBe("connected");
  });

  it("routes onCall through executeToolCall", async () => {
    const { registerMcpBridge } = installFakePenDesktop();
    const executeSpy = vi.spyOn(useDesignChatModule, "executeToolCall").mockResolvedValue('"ok"');

    dispose = initDesktopMcpBridge();
    const handler = registerMcpBridge.mock.calls[0][0];

    const result = await handler.onCall("get_variables", { foo: 1 });

    expect(executeSpy).toHaveBeenCalledWith("get_variables", { foo: 1 });
    expect(result).toBe('"ok"');
  });

  // Regression for finding 2: onCall used to bypass createToolDispatcher
  // entirely, so two overlapping mcp:call IPC messages could interleave
  // scene mutations. It must now serialize through the shared dispatch
  // core, the same as the WebSocket bridge.
  it("serializes two overlapping onCall invocations so the second does not start before the first resolves", async () => {
    const { registerMcpBridge } = installFakePenDesktop();
    dispose = initDesktopMcpBridge();
    const handler = registerMcpBridge.mock.calls[0][0];

    // Both tool names must be in the desktop bridge's advertised allow-list
    // (src/lib/mcpToolNames.ts) — get_variables and get_editor_state are.
    const { toolHandlers } = await import("@/lib/toolRegistry");
    const originalVariables = toolHandlers.get_variables;
    const originalEditorState = toolHandlers.get_editor_state;

    let resolveFirst: (() => void) | undefined;
    const order: string[] = [];
    toolHandlers.get_variables = vi.fn(async () => {
      order.push("start-1");
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      order.push("end-1");
      return "1";
    });
    toolHandlers.get_editor_state = vi.fn(async () => {
      order.push("start-2");
      return "2";
    });

    const call1 = handler.onCall("get_variables", {});
    const call2 = handler.onCall("get_editor_state", {});

    await vi.waitFor(() => expect(order).toEqual(["start-1"]));
    // The second overlapping call must not have started while the first is
    // still in flight.
    expect(order).not.toContain("start-2");

    resolveFirst?.();
    await vi.waitFor(() => expect(order).toEqual(["start-1", "end-1", "start-2"]));

    expect(await call1).toBe("1");
    expect(await call2).toBe("2");

    toolHandlers.get_variables = originalVariables;
    toolHandlers.get_editor_state = originalEditorState;
  });

  // Regression for finding 3: the advertised `tools` list is not
  // authoritative unless onCall itself enforces it — toolHandlers contains
  // deliberately excluded tools (create_plugin, ask_user, ...) that this
  // bridge must never reach even if the shell asks for one by name.
  it("refuses a non-advertised tool name without calling executeToolCall", async () => {
    const { registerMcpBridge } = installFakePenDesktop();
    const executeSpy = vi.spyOn(useDesignChatModule, "executeToolCall");

    dispose = initDesktopMcpBridge();
    const handler = registerMcpBridge.mock.calls[0][0];

    // create_plugin exists in toolHandlers (see toolContract.test.ts) but is
    // deliberately excluded from the desktop MCP tool surface.
    const result = await handler.onCall("create_plugin", {});

    expect(JSON.parse(result)).toEqual({ error: "Unknown tool: create_plugin" });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("calling init twice is a no-op — registerMcpBridge is called only once", () => {
    const { registerMcpBridge, unregister } = installFakePenDesktop();

    const first = initDesktopMcpBridge();
    const second = initDesktopMcpBridge();

    expect(registerMcpBridge).toHaveBeenCalledTimes(1);

    // The second dispose is a no-op: it must not unregister the real
    // registration or throw.
    expect(() => second()).not.toThrow();
    expect(unregister).not.toHaveBeenCalled();
    expect(isDesktopMcpBridgeActive()).toBe(true);

    first();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(isDesktopMcpBridgeActive()).toBe(false);
    expect(useMcpBridgeStore.getState().status).toBe("off");
  });

  // Regression for finding 2: teardown used to only unregister and reset
  // the store, leaving `pending` and the dispatcher queue alive in the
  // closure. An onCall promise already handed to the shell for an in-flight
  // call would never settle, and a call still queued behind it would go on
  // to execute (and mutate the scene) after teardown.
  it("settles outstanding onCall promises and stops the queue on teardown", async () => {
    const { registerMcpBridge } = installFakePenDesktop();
    dispose = initDesktopMcpBridge();
    const handler = registerMcpBridge.mock.calls[0][0];

    const { toolHandlers } = await import("@/lib/toolRegistry");
    const originalVariables = toolHandlers.get_variables;
    const originalEditorState = toolHandlers.get_editor_state;

    let resolveFirst: (() => void) | undefined;
    toolHandlers.get_variables = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      return "1";
    });
    const editorStateHandler = vi.fn(async () => "2");
    toolHandlers.get_editor_state = editorStateHandler;

    // call-1 is in flight (its handler is awaiting resolveFirst); call-2 is
    // still queued behind it and has not started executing.
    const call1 = handler.onCall("get_variables", {});
    const call2 = handler.onCall("get_editor_state", {});

    await vi.waitFor(() => expect(toolHandlers.get_variables).toHaveBeenCalledTimes(1));

    dispose();
    dispose = undefined;

    // Both promises settle immediately on teardown, without waiting for the
    // in-flight handler to finish.
    await expect(call1).resolves.toContain("torn down");
    await expect(call2).resolves.toContain("torn down");

    // Only after teardown does the in-flight handler's own promise resolve
    // (its background work isn't cancellable) — but the queued call-2 must
    // never have executed, before or after this point.
    resolveFirst?.();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(editorStateHandler).not.toHaveBeenCalled();

    toolHandlers.get_variables = originalVariables;
    toolHandlers.get_editor_state = originalEditorState;
  });

  // Regression for finding 3: this module exists because of version skew
  // between the deployed bundle and the shell, so `registerMcpBridge`
  // returning something that is not a function is a real scenario, not a
  // hypothetical. Before the fix, `unregister()` threw a TypeError and
  // `teardown = null` (after that call) never ran, leaving
  // isDesktopMcpBridgeActive() stuck true forever and the WS bridge
  // permanently suppressed.
  it("does not get stuck active when the shell's registerMcpBridge returns a non-function", () => {
    const registerMcpBridge = vi.fn(() => undefined as unknown as () => void);
    (window as { penDesktop?: unknown }).penDesktop = {
      onMenuCommand: () => () => {},
      registerMcpBridge,
    };

    dispose = initDesktopMcpBridge();
    expect(isDesktopMcpBridgeActive()).toBe(true);

    expect(() => dispose?.()).not.toThrow();
    dispose = undefined;

    expect(isDesktopMcpBridgeActive()).toBe(false);
    expect(useMcpBridgeStore.getState().status).toBe("off");
  });

  it("teardown unregisters and clears active state", () => {
    const { unregister } = installFakePenDesktop();

    dispose = initDesktopMcpBridge();
    expect(isDesktopMcpBridgeActive()).toBe(true);

    dispose();
    dispose = undefined;

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(isDesktopMcpBridgeActive()).toBe(false);
    expect(useMcpBridgeStore.getState().status).toBe("off");
  });

  it("suppresses the WebSocket bridge once the desktop bridge has registered", async () => {
    installFakePenDesktop();
    dispose = initDesktopMcpBridge();
    expect(isDesktopMcpBridgeActive()).toBe(true);

    const wsConstructor = vi.fn();
    vi.stubGlobal("WebSocket", wsConstructor);
    vi.stubEnv("VITE_MCP_WS_TOKEN", "secret-token");

    const { startMcpBridgeIfConfigured } = await import("@/lib/mcpBridge");
    startMcpBridgeIfConfigured();

    expect(wsConstructor).not.toHaveBeenCalled();
  });
});
