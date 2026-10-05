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
vi.mock("@/components/LeftSidebar", () => {
  throw new Error("embed must use LeftSidebarBase, not the app sidebar that statically imports chat");
});
vi.mock("@/components/Toolbar", () => {
  throw new Error("embed must not load the app toolbar (auth menu)");
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
import { useLeftSidebarStore } from "@/store/leftSidebarStore";

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
afterEach(() => {
  container.remove();
  document.documentElement.classList.remove("dark");
});

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

  it("shows the left rail with every section except Agents, and the properties panel open by default", async () => {
    await act(async () => {
      bootEmbed(container, { connectHost: async () => fakeHost() });
    });
    const ids = [...container.querySelectorAll('[data-testid^="rail-"]')].map((e) => e.getAttribute("data-testid"));
    expect(ids).toEqual(["rail-pages", "rail-slides", "rail-toolbox", "rail-comments", "rail-variables", "rail-text-styles", "rail-styles"]);
    expect(container.querySelector('[aria-label="Toggle properties"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back to Pages when the persisted left section is Agents", async () => {
    useLeftSidebarStore.setState({ activeSection: "agents" });
    await act(async () => {
      bootEmbed(container, { connectHost: async () => fakeHost() });
    });
    const active = container.querySelector('[data-testid="rail-pages"] > span');
    expect(active?.className).toContain("bg-accent-selection");
  });

  it("applies the host theme to the whole UI, follows context changes, and never persists it", async () => {
    let theme: "light" | "dark" | undefined = "dark";
    const listeners = new Set<() => void>();
    const host = fakeHost({
      getTheme: () => theme,
      onContextChange: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    });
    localStorage.setItem("ui-theme", "light");
    await act(async () => {
      bootEmbed(container, { connectHost: async () => host });
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await act(async () => {
      theme = "light";
      listeners.forEach((l) => l());
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await act(async () => {
      theme = "dark";
      listeners.forEach((l) => l());
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("ui-theme")).toBe("light");
  });

  it("follows prefers-color-scheme when the host gives no theme", async () => {
    const mm = vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query.includes("prefers-color-scheme"),
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    await act(async () => {
      bootEmbed(container, { connectHost: async () => fakeHost({ getTheme: () => undefined }) });
    });
    mm.mockRestore();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
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
