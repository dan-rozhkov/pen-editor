import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSelectionStore } from "@/store/selectionStore";
import { runPlugin, stopPlugin, getRunningPlugin, stopAllPlugins } from "../pluginHost";
import type { PenPlugin } from "../types";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const plugin = (id = "p1"): PenPlugin => ({
  id, name: "Test", description: "", code: "/* noop */",
  source: "ai", createdAt: 0, updatedAt: 0,
});

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
});
