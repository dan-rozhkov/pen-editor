import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const initDesktopMcpBridgeMock = vi.fn();
const startMcpBridgeIfConfiguredMock = vi.fn();
const initDesktopBridgeMock = vi.fn();

vi.mock("@/lib/desktopMcpBridge", () => ({
  initDesktopMcpBridge: initDesktopMcpBridgeMock,
}));
vi.mock("@/lib/mcpBridge", () => ({
  startMcpBridgeIfConfigured: startMcpBridgeIfConfiguredMock,
}));
vi.mock("@/lib/desktopBridge", () => ({
  initDesktopBridge: initDesktopBridgeMock,
}));

beforeEach(() => {
  initDesktopMcpBridgeMock.mockReset();
  startMcpBridgeIfConfiguredMock.mockReset();
  initDesktopBridgeMock.mockReset();
  delete (window as { penDesktop?: unknown }).penDesktop;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("startBridges", () => {
  it("starts the WebSocket bridge when configured and there is no desktop shell", async () => {
    vi.stubEnv("VITE_MCP_WS_TOKEN", "secret-token");
    const { startBridges } = await import("@/lib/bridgeBootstrap");

    startBridges();

    await vi.waitFor(() => expect(startMcpBridgeIfConfiguredMock).toHaveBeenCalledTimes(1));
    expect(initDesktopMcpBridgeMock).not.toHaveBeenCalled();
  });

  // Regression for finding 5: desktopMcpBridgeReady previously had no
  // .catch. If initDesktopMcpBridge() throws (e.g. the shell's
  // registerMcpBridge throws across IPC) or the dynamic import rejects (a
  // stale chunk after a deploy), the promise the WS-start chain awaits used
  // to reject with nothing to catch it — an unhandled rejection in a
  // production desktop build (no VITE_MCP_WS_TOKEN, so nothing else
  // subscribes) — and the WS bridge's .then would never fire even when it
  // *was* configured. Failure must fall back, not silently disable both.
  it("still starts the WebSocket bridge when initDesktopMcpBridge() throws", async () => {
    (window as { penDesktop?: unknown }).penDesktop = { onMenuCommand: () => () => {} };
    vi.stubEnv("VITE_MCP_WS_TOKEN", "secret-token");
    initDesktopMcpBridgeMock.mockImplementation(() => {
      throw new Error("registerMcpBridge failed across IPC");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { startBridges } = await import("@/lib/bridgeBootstrap");
    startBridges();

    await vi.waitFor(() => expect(initDesktopMcpBridgeMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(startMcpBridgeIfConfiguredMock).toHaveBeenCalledTimes(1));
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not start the WebSocket bridge when VITE_MCP_WS_TOKEN is unset", async () => {
    vi.stubEnv("VITE_MCP_WS_TOKEN", undefined);
    const { startBridges } = await import("@/lib/bridgeBootstrap");

    startBridges();

    // Give any pending microtasks a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(startMcpBridgeIfConfiguredMock).not.toHaveBeenCalled();
  });

  it("initializes the menu-command bridge when window.penDesktop is present", async () => {
    (window as { penDesktop?: unknown }).penDesktop = { onMenuCommand: () => () => {} };
    const { startBridges } = await import("@/lib/bridgeBootstrap");

    startBridges();

    await vi.waitFor(() => expect(initDesktopBridgeMock).toHaveBeenCalledTimes(1));
  });

  // Regression for finding 4: the file's own header reasons carefully about
  // a failed dynamic import (stale chunk after a deploy) causing an
  // unhandled rejection at boot, but that reasoning was applied only to the
  // desktopMcpBridge chain. The desktopBridge chain (this test) and the
  // inner mcpBridge chain (next test) were still bare `.then` with no
  // `.catch` — the same stale-chunk scenario there gives an unhandled
  // promise rejection at boot (nothing else awaits these chains), and for
  // desktopBridge specifically the desktop File menu silently stops
  // working with only whatever the browser does with an unhandled
  // rejection, never a caught, logged error.
  it("logs and does not throw or leave an unhandled rejection when initDesktopBridge() fails", async () => {
    (window as { penDesktop?: unknown }).penDesktop = { onMenuCommand: () => () => {} };
    initDesktopBridgeMock.mockImplementation(() => {
      throw new Error("stale chunk after deploy");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { startBridges } = await import("@/lib/bridgeBootstrap");
    expect(() => startBridges()).not.toThrow();

    await vi.waitFor(() => expect(initDesktopBridgeMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });

  it("logs and does not leave an unhandled rejection when startMcpBridgeIfConfigured() fails to load", async () => {
    vi.stubEnv("VITE_MCP_WS_TOKEN", "secret-token");
    startMcpBridgeIfConfiguredMock.mockImplementation(() => {
      throw new Error("stale chunk after deploy");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { startBridges } = await import("@/lib/bridgeBootstrap");
    expect(() => startBridges()).not.toThrow();

    await vi.waitFor(() => expect(startMcpBridgeIfConfiguredMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });
});
