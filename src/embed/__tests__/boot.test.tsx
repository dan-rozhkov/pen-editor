import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/test/fixtures";
import type { HostBridge } from "../hostBridge";

// Anything the widget must NOT load throws on import, so a regression that
// pulls the router / chat / WebMCP into the embed graph fails here.
vi.mock("react-router", () => {
  throw new Error("embed must not load the router");
});
vi.mock("@/components/chat/ChatPanel", () => {
  throw new Error("embed must not load the chat panel");
});
vi.mock("@/lib/webmcp", () => {
  throw new Error("embed must not load WebMCP");
});
// PixiJS needs WebGL (e2e territory).
vi.mock("@/pixi/PixiCanvas", () => ({ PixiCanvas: () => <div data-testid="canvas" /> }));

import { bootEmbed } from "../boot";
import { embedDocKey } from "../persistence";
import { seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";

function fakeHost(overrides: Partial<HostBridge> = {}): HostBridge {
  return {
    widgetKey: { key: "w1", stable: true },
    getDisplayMode: () => "inline",
    canExpand: () => true,
    toggleFullscreen: vi.fn(async () => "fullscreen" as const),
    openLink: vi.fn(async () => true),
    getTheme: () => "dark",
    onContextChange: () => () => {},
    stop: vi.fn(),
    ...overrides,
  };
}

let container: HTMLElement;
beforeEach(() => {
  resetStores();
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => container.remove());

describe("bootEmbed", () => {
  it("renders the editor shell (canvas, layers, properties, top bar) without router or chat", async () => {
    const connectHost = vi.fn(async () => fakeHost());
    let dispose = () => {};
    await act(async () => {
      dispose = bootEmbed(container, { connectHost });
    });

    expect(container.querySelector('[data-testid="embed-topbar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="canvas"]')).not.toBeNull();
    expect(container.textContent).toContain("Open in Sideform");
    expect(container.textContent).toContain("Expand");
    expect(container.querySelector('[data-testid="embed-topbar"]')?.getAttribute("data-theme")).toBe("dark");
    expect(connectHost).toHaveBeenCalledTimes(1);

    await act(async () => dispose());
  });

  it("restores only the document saved under this widget's key, after the host connects", async () => {
    seedScene();
    const { saveEmbedDocument } = await import("../persistence");
    saveEmbedDocument("w1");
    resetStores();
    saveEmbedDocument("other");
    resetStores();
    expect(localStorage.getItem(embedDocKey("w1"))).not.toBeNull();

    await act(async () => {
      bootEmbed(container, { connectHost: async () => fakeHost() });
    });
    expect(Object.values(useSceneStore.getState().nodesById).map((n) => n.name)).toContain("Screen");
  });

  it("does not restore for a host without a stable widget id", async () => {
    seedScene();
    const { saveEmbedDocument } = await import("../persistence");
    saveEmbedDocument("w1");
    resetStores();
    await act(async () => {
      bootEmbed(container, { connectHost: async () => fakeHost({ widgetKey: { key: "w1", stable: false } }) });
    });
    expect(Object.keys(useSceneStore.getState().nodesById)).toHaveLength(0);
  });

  it("disables Open in Sideform when the API base is empty", async () => {
    await act(async () => {
      bootEmbed(container, { connectHost: async () => fakeHost() });
    });
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Open in Sideform"));
    expect(button?.hasAttribute("disabled")).toBe(true);
  });

  it("still renders the editor when no MCP Apps host answers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await act(async () => {
      bootEmbed(container, { connectHost: async () => Promise.reject(new Error("no host")) });
    });
    expect(container.querySelector('[data-testid="canvas"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Expand");
    expect(warn).toHaveBeenCalled();
  });

  it("stops the host connection on dispose", async () => {
    const host = fakeHost();
    let dispose = () => {};
    await act(async () => {
      dispose = bootEmbed(container, { connectHost: async () => host });
    });
    await act(async () => dispose());
    expect(host.stop).toHaveBeenCalled();
  });
});
