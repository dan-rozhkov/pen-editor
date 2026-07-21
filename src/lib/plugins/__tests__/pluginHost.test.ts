import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSelectionStore } from "@/store/selectionStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { usePluginPanelStore } from "@/store/pluginPanelStore";
import { runPlugin, stopPlugin, getRunningPlugin, stopAllPlugins } from "../pluginHost";
import type { PenPlugin } from "../types";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const plugin = (id = "p1", ui: PenPlugin["ui"] = undefined): PenPlugin => ({
  id, name: "Test", description: "", code: "/* noop */",
  ui, source: "ai", createdAt: 0, updatedAt: 0,
});

const uiPlugin = (id = "p1"): PenPlugin => plugin(id, { width: 400, height: 300 });

describe("pluginHost", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });
  afterEach(() => {
    stopAllPlugins();
  });

  it("creates a hidden, script-sandboxed iframe attached to the document", () => {
    const instance = runPlugin(plugin());
    expect(instance.iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(instance.iframe.style.display).toBe("none");
    expect(document.body.contains(instance.iframe)).toBe(true);
    expect(instance.iframe.srcdoc).toContain("pen-rpc-request");
    expect(getRunningPlugin("p1")).toBe(instance);
  });

  it("re-running the same plugin disposes the previous instance", () => {
    const first = runPlugin(plugin());
    const second = runPlugin(plugin());
    expect(first).not.toBe(second);
    expect(document.body.contains(first.iframe)).toBe(false);
    expect(document.body.contains(second.iframe)).toBe(true);
    expect(getRunningPlugin("p1")).toBe(second);
  });

  it("stopPlugin removes the iframe and forgets the instance", () => {
    const instance = runPlugin(plugin());
    stopPlugin("p1");
    expect(document.body.contains(instance.iframe)).toBe(false);
    expect(getRunningPlugin("p1")).toBeUndefined();
  });

  it("stopPlugin unsubscribes from selection changes (no dangling listeners)", () => {
    const instance = runPlugin(plugin());
    const post = vi.fn();
    // happy-dom iframes may not expose a live contentWindow; stub the post path.
    Object.defineProperty(instance.iframe, "contentWindow", {
      value: { postMessage: post }, configurable: true,
    });
    useSelectionStore.getState().setSelectedIds(["rect1"]);
    const callsWhileRunning = post.mock.calls.length;
    expect(callsWhileRunning).toBeGreaterThan(0);
    stopPlugin("p1");
    useSelectionStore.getState().setSelectedIds([]);
    expect(post.mock.calls.length).toBe(callsWhileRunning);
  });

  it("selectionchange events carry the selected ids", () => {
    const instance = runPlugin(plugin());
    const post = vi.fn();
    Object.defineProperty(instance.iframe, "contentWindow", {
      value: { postMessage: post }, configurable: true,
    });
    useSelectionStore.getState().setSelectedIds(["rect1"]);
    expect(post).toHaveBeenCalledWith(
      { kind: "pen-host-event", event: "selectionchange", payload: ["rect1"] },
      "*",
    );
  });

  describe("UI plugins (plg-04)", () => {
    afterEach(() => {
      useUIThemeStore.setState({ uiTheme: "light" });
    });

    it("a headless plugin (ui absent) never opens a panel", () => {
      runPlugin(plugin());
      expect(usePluginPanelStore.getState().panels["p1"]).toBeUndefined();
    });

    it("a UI plugin opens a panel sized from PenPlugin.ui and renders its iframe visibly", () => {
      const instance = runPlugin(uiPlugin());
      expect(instance.iframe.style.display).not.toBe("none");
      const panel = usePluginPanelStore.getState().panels["p1"];
      expect(panel).toBeDefined();
      expect(panel.iframe).toBe(instance.iframe);
      expect(panel.width).toBe(400);
      expect(panel.height).toBe(300);
    });

    it("re-running a UI plugin replaces its panel entry with the new instance's iframe", () => {
      const first = runPlugin(uiPlugin());
      const second = runPlugin(uiPlugin());
      const panel = usePluginPanelStore.getState().panels["p1"];
      expect(panel.iframe).toBe(second.iframe);
      expect(panel.iframe).not.toBe(first.iframe);
    });

    it("stopPlugin on a UI plugin closes its panel and removes the iframe (no leaks)", () => {
      const instance = runPlugin(uiPlugin());
      expect(usePluginPanelStore.getState().panels["p1"]).toBeDefined();
      stopPlugin("p1");
      expect(usePluginPanelStore.getState().panels["p1"]).toBeUndefined();
      expect(document.body.contains(instance.iframe)).toBe(false);
    });

    it("theme changes propagate a themechange event to running plugin iframes", () => {
      const instance = runPlugin(uiPlugin());
      const post = vi.fn();
      Object.defineProperty(instance.iframe, "contentWindow", {
        value: { postMessage: post }, configurable: true,
      });
      useUIThemeStore.getState().setUITheme("dark");
      expect(post).toHaveBeenCalledTimes(1);
      const [message] = post.mock.calls[0] as [{ kind: string; event: string; payload: { theme: string; cssVars: Record<string, string> } }];
      expect(message.kind).toBe("pen-host-event");
      expect(message.event).toBe("themechange");
      expect(message.payload.theme).toBe("dark");
      expect(typeof message.payload.cssVars).toBe("object");
    });

    it("theme propagation is silent on a no-op theme set and stops after teardown", () => {
      const instance = runPlugin(uiPlugin());
      const post = vi.fn();
      Object.defineProperty(instance.iframe, "contentWindow", {
        value: { postMessage: post }, configurable: true,
      });
      useUIThemeStore.getState().setUITheme("light"); // already light: no-op
      expect(post).not.toHaveBeenCalled();
      stopPlugin("p1");
      useUIThemeStore.getState().setUITheme("dark");
      expect(post).not.toHaveBeenCalled();
    });
  });
});
