import { describe, it, expect, beforeEach } from "vitest";
import {
  usePluginPanelStore,
  clampPanelSize,
  PLUGIN_PANEL_MIN_WIDTH,
  PLUGIN_PANEL_MIN_HEIGHT,
  PLUGIN_PANEL_MAX_WIDTH,
  PLUGIN_PANEL_MAX_HEIGHT,
} from "../pluginPanelStore";
import type { PenPlugin } from "@/lib/plugins/types";

const plugin = (id = "p1", ui: PenPlugin["ui"] = { width: 400, height: 300 }): PenPlugin => ({
  id,
  name: "Test",
  description: "",
  code: "",
  ui,
  source: "ai",
  createdAt: 0,
  updatedAt: 0,
});

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

describe("pluginPanelStore", () => {
  beforeEach(() => {
    usePluginPanelStore.setState({ panels: {} });
  });

  it("open() creates an entry sized from PenPlugin.ui", () => {
    const p = plugin();
    const f = iframe();
    usePluginPanelStore.getState().open(p, f);
    const panel = usePluginPanelStore.getState().panels["p1"];
    expect(panel).toBeDefined();
    expect(panel.iframe).toBe(f);
    expect(panel.width).toBe(400);
    expect(panel.height).toBe(300);
  });

  it("open() falls back to a default size and clamps an undersized ui", () => {
    usePluginPanelStore.getState().open(plugin("p1", { width: 10, height: 10 }), iframe());
    const panel = usePluginPanelStore.getState().panels["p1"];
    expect(panel.width).toBe(PLUGIN_PANEL_MIN_WIDTH);
    expect(panel.height).toBe(PLUGIN_PANEL_MIN_HEIGHT);
  });

  it("open() keeps the initial position within the viewport", () => {
    usePluginPanelStore.getState().open(plugin(), iframe());
    const panel = usePluginPanelStore.getState().panels["p1"];
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(window.innerWidth);
    expect(panel.y + panel.height).toBeLessThanOrEqual(window.innerHeight);
  });

  it("close() removes the entry; closing an unknown id is a no-op", () => {
    usePluginPanelStore.getState().open(plugin(), iframe());
    usePluginPanelStore.getState().close("p1");
    expect(usePluginPanelStore.getState().panels["p1"]).toBeUndefined();
    expect(() => usePluginPanelStore.getState().close("nope")).not.toThrow();
  });

  it("resize() updates and clamps size; no-ops for an unknown id", () => {
    usePluginPanelStore.getState().open(plugin(), iframe());
    usePluginPanelStore.getState().resize("p1", 9999, 9999);
    expect(usePluginPanelStore.getState().panels["p1"]).toMatchObject({
      width: PLUGIN_PANEL_MAX_WIDTH,
      height: PLUGIN_PANEL_MAX_HEIGHT,
    });
    usePluginPanelStore.getState().resize("nope", 500, 500);
    expect(usePluginPanelStore.getState().panels["nope"]).toBeUndefined();
  });

  it("move() updates x/y; no-ops for an unknown id", () => {
    usePluginPanelStore.getState().open(plugin(), iframe());
    usePluginPanelStore.getState().move("p1", 50, 60);
    expect(usePluginPanelStore.getState().panels["p1"]).toMatchObject({ x: 50, y: 60 });
    expect(() => usePluginPanelStore.getState().move("nope", 1, 1)).not.toThrow();
  });

  it("re-opening the same plugin id replaces its entry", () => {
    const first = iframe();
    const second = iframe();
    usePluginPanelStore.getState().open(plugin(), first);
    usePluginPanelStore.getState().open(plugin(), second);
    expect(Object.keys(usePluginPanelStore.getState().panels)).toEqual(["p1"]);
    expect(usePluginPanelStore.getState().panels["p1"].iframe).toBe(second);
  });
});
