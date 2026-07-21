import { describe, it, expect, beforeEach } from "vitest";
import {
  usePluginPanelStore,
  clampPanelSize,
  fitPanelSize,
  PLUGIN_PANEL_MIN_WIDTH,
  PLUGIN_PANEL_MIN_HEIGHT,
  PLUGIN_PANEL_MAX_WIDTH,
  PLUGIN_PANEL_MAX_HEIGHT,
} from "../pluginPanelStore";
import type { PenPlugin } from "@/lib/plugins/types";

const ui = (width = 400, height = 300): PenPlugin["ui"] => ({ width, height });
const iframe = () => document.createElement("iframe");

describe("clampPanelSize", () => {
  it("clamps below the minimum", () => {
    expect(clampPanelSize(10, 10)).toEqual({
      width: PLUGIN_PANEL_MIN_WIDTH,
      height: PLUGIN_PANEL_MIN_HEIGHT,
    });
  });

  it("clamps above the maximum", () => {
    expect(clampPanelSize(9999, 9999)).toEqual({
      width: PLUGIN_PANEL_MAX_WIDTH,
      height: PLUGIN_PANEL_MAX_HEIGHT,
    });
  });

  it("rounds and passes through in-range sizes", () => {
    expect(clampPanelSize(400.4, 300.6)).toEqual({ width: 400, height: 301 });
  });
});

describe("fitPanelSize", () => {
  it("passes through a size that already fits the viewport", () => {
    expect(fitPanelSize(400, 300, { width: 1200, height: 800 })).toEqual({ width: 400, height: 300 });
  });

  it("shrinks a size that overflows a smaller viewport", () => {
    expect(fitPanelSize(400, 300, { width: 300, height: 250 })).toEqual({ width: 300, height: 250 });
  });

  it("never returns below the sane minimum when the viewport is roomy enough", () => {
    expect(fitPanelSize(10, 10, { width: 1200, height: 800 })).toEqual({
      width: PLUGIN_PANEL_MIN_WIDTH,
      height: PLUGIN_PANEL_MIN_HEIGHT,
    });
  });

  it("shrinks below the sane minimum rather than overflow a viewport smaller than it", () => {
    const result = fitPanelSize(400, 300, { width: 100, height: 80 });
    expect(result.width).toBe(100);
    expect(result.height).toBe(80);
  });
});

describe("pluginPanelStore", () => {
  beforeEach(() => {
    usePluginPanelStore.setState({ panels: {} });
  });

  it("open() creates an entry sized from PenPlugin.ui", () => {
    const f = iframe();
    usePluginPanelStore.getState().open("p1", ui(), f);
    const panel = usePluginPanelStore.getState().panels["p1"];
    expect(panel).toBeDefined();
    expect(panel.pluginId).toBe("p1");
    expect(panel.iframe).toBe(f);
    expect(panel.width).toBe(400);
    expect(panel.height).toBe(300);
  });

  it("open() falls back to a default size and clamps an undersized ui", () => {
    usePluginPanelStore.getState().open("p1", ui(10, 10), iframe());
    const panel = usePluginPanelStore.getState().panels["p1"];
    expect(panel.width).toBe(PLUGIN_PANEL_MIN_WIDTH);
    expect(panel.height).toBe(PLUGIN_PANEL_MIN_HEIGHT);
  });

  it("open() keeps the initial position within the viewport", () => {
    usePluginPanelStore.getState().open("p1", ui(), iframe());
    const panel = usePluginPanelStore.getState().panels["p1"];
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(window.innerWidth);
    expect(panel.y + panel.height).toBeLessThanOrEqual(window.innerHeight);
  });

  it("close() removes the entry; closing an unknown id is a no-op", () => {
    usePluginPanelStore.getState().open("p1", ui(), iframe());
    usePluginPanelStore.getState().close("p1");
    expect(usePluginPanelStore.getState().panels["p1"]).toBeUndefined();
    expect(() => usePluginPanelStore.getState().close("nope")).not.toThrow();
  });

  it("resize() updates and clamps size; no-ops for an unknown id", () => {
    usePluginPanelStore.getState().open("p1", ui(), iframe());
    usePluginPanelStore.getState().resize("p1", 9999, 9999);
    expect(usePluginPanelStore.getState().panels["p1"]).toMatchObject({
      width: PLUGIN_PANEL_MAX_WIDTH,
      height: PLUGIN_PANEL_MAX_HEIGHT,
    });
    usePluginPanelStore.getState().resize("nope", 500, 500);
    expect(usePluginPanelStore.getState().panels["nope"]).toBeUndefined();
  });

  it("resize() re-clamps position so growing near a viewport edge can't push the panel (or its resize handle) off-screen", () => {
    usePluginPanelStore.getState().open("p1", ui(200, 150), iframe());
    // Move it flush against the bottom-right corner, then grow it — without
    // re-clamping x/y this would push the panel (and its resize handle,
    // bottom-right) past the viewport edge.
    usePluginPanelStore
      .getState()
      .move("p1", window.innerWidth - 200, window.innerHeight - 150);
    usePluginPanelStore.getState().resize("p1", 600, 500);
    const panel = usePluginPanelStore.getState().panels["p1"];
    expect(panel.x + panel.width).toBeLessThanOrEqual(window.innerWidth);
    expect(panel.y + panel.height).toBeLessThanOrEqual(window.innerHeight);
  });

  it("move() updates x/y; no-ops for an unknown id", () => {
    usePluginPanelStore.getState().open("p1", ui(), iframe());
    usePluginPanelStore.getState().move("p1", 50, 60);
    expect(usePluginPanelStore.getState().panels["p1"]).toMatchObject({ x: 50, y: 60 });
    expect(() => usePluginPanelStore.getState().move("nope", 1, 1)).not.toThrow();
  });

  it("fitToViewport() shrinks an oversized panel to fit a shrunk viewport, then clamps position; no-ops for an unknown id", () => {
    usePluginPanelStore.getState().open("p1", ui(400, 300), iframe());
    usePluginPanelStore.getState().move("p1", 700, 500);
    usePluginPanelStore.getState().fitToViewport("p1", 800, 600);
    const panel = usePluginPanelStore.getState().panels["p1"];
    expect(panel.width).toBeLessThanOrEqual(800);
    expect(panel.height).toBeLessThanOrEqual(600);
    expect(panel.x + panel.width).toBeLessThanOrEqual(800);
    expect(panel.y + panel.height).toBeLessThanOrEqual(600);
    expect(() => usePluginPanelStore.getState().fitToViewport("nope", 800, 600)).not.toThrow();
  });

  it("fitToViewport() is a no-op when the panel already fits", () => {
    usePluginPanelStore.getState().open("p1", ui(400, 300), iframe());
    const before = usePluginPanelStore.getState().panels["p1"];
    usePluginPanelStore.getState().fitToViewport("p1", window.innerWidth, window.innerHeight);
    expect(usePluginPanelStore.getState().panels["p1"]).toBe(before);
  });

  it("re-opening the same plugin id swaps only the iframe, keeping geometry (plg-04 fix)", () => {
    const first = iframe();
    const second = iframe();
    usePluginPanelStore.getState().open("p1", ui(), first);
    usePluginPanelStore.getState().move("p1", 111, 222);
    usePluginPanelStore.getState().resize("p1", 500, 350);
    const before = usePluginPanelStore.getState().panels["p1"];

    usePluginPanelStore.getState().open("p1", ui(), second);
    const after = usePluginPanelStore.getState().panels["p1"];

    expect(Object.keys(usePluginPanelStore.getState().panels)).toEqual(["p1"]);
    expect(after.iframe).toBe(second);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });
});
