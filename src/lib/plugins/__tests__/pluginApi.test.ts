import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import { calculateNodesBounds } from "@/utils/viewportUtils";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import { usePluginPanelStore } from "@/store/pluginPanelStore";
import { callPluginMethod } from "../pluginApi";

vi.mock("sonner", () => ({ toast: vi.fn() }));
const { toast } = await import("sonner");

describe("callPluginMethod", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    localStorage.clear();
    vi.mocked(toast).mockClear();
  });

  it("tools.run dispatches an allowlisted read tool", async () => {
    const result = await callPluginMethod("p1", "tools.run", ["get_editor_state", {}]);
    expect(typeof result).toBe("string");
    expect(result as string).toContain("frame1");
  });

  it("tools.run rejects a non-allowlisted tool without executing it", async () => {
    await expect(
      callPluginMethod("p1", "tools.run", ["leave_comment", {}]),
    ).rejects.toThrow(/not allowed/);
  });

  it("tools.run rejects a bad tool name argument", async () => {
    await expect(callPluginMethod("p1", "tools.run", [42, {}])).rejects.toThrow();
  });

  it("scene.batch creates a node and exactly one history entry", async () => {
    const before = useHistoryStore.getState().past.length;
    await callPluginMethod("p1", "scene.batch", [
      'n=I(document, {type:"frame", name:"PluginFrame", x:900, y:900, width:100, height:100})',
    ]);
    const nodes = Object.values(useSceneStore.getState().nodesById);
    expect(nodes.some((n) => n.name === "PluginFrame")).toBe(true);
    expect(useHistoryStore.getState().past.length).toBe(before + 1);
  });

  it("selection.get / selection.set round-trip", async () => {
    const set = await callPluginMethod("p1", "selection.set", [["rect1"]]);
    expect(set).toEqual(["rect1"]);
    expect(useSelectionStore.getState().selectedIds).toEqual(["rect1"]);
    const got = await callPluginMethod("p1", "selection.get", []);
    expect(got).toEqual(["rect1"]);
  });

  it("selection.set rejects non-string-array input", async () => {
    await expect(callPluginMethod("p1", "selection.set", ["rect1"])).rejects.toThrow();
  });

  it("selection.set drops unknown ids but applies the known subset and returns it", async () => {
    const result = await callPluginMethod("p1", "selection.set", [["rect1", "ghost"]]);
    expect(result).toEqual(["rect1"]);
    expect(useSelectionStore.getState().selectedIds).toEqual(["rect1"]);
  });

  it("notify calls toast", async () => {
    await callPluginMethod("p1", "notify", ["Done!"]);
    expect(toast).toHaveBeenCalledWith("Done!");
  });

  it("storage is JSON round-tripped and namespaced per plugin", async () => {
    await callPluginMethod("p1", "storage.set", ["k", { a: 1 }]);
    expect(await callPluginMethod("p1", "storage.get", ["k"])).toEqual({ a: 1 });
    expect(await callPluginMethod("p2", "storage.get", ["k"])).toBeNull();
    expect(localStorage.getItem("pen.plugin.p1.k")).toBe('{"a":1}');
  });

  it("storage keys escape dots so pluginId/key boundaries can't collide", async () => {
    await callPluginMethod("a", "storage.set", ["b.c", { from: "a/b.c" }]);
    await callPluginMethod("a.b", "storage.set", ["c", { from: "a.b/c" }]);

    expect(await callPluginMethod("a", "storage.get", ["b.c"])).toEqual({ from: "a/b.c" });
    expect(await callPluginMethod("a.b", "storage.get", ["c"])).toEqual({ from: "a.b/c" });

    const key1 = localStorage.getItem("pen.plugin.a.b%2Ec");
    const key2 = localStorage.getItem("pen.plugin.a%2Eb.c");
    expect(key1).not.toBeNull();
    expect(key2).not.toBeNull();
    expect(key1).not.toBe(key2);
  });

  it("storage.get rejects a corrupt stored value", async () => {
    localStorage.setItem("pen.plugin.p1.k", "not-json");
    await expect(callPluginMethod("p1", "storage.get", ["k"])).rejects.toThrow(/corrupt value/);
  });

  it("viewport.zoomTo resolves nested node ids to absolute coordinates", async () => {
    const tree = useSceneStore.getState().getNodes();
    const calc = useLayoutStore.getState().calculateLayoutForFrame;
    const abs = getNodeAbsolutePositionWithLayout(tree, "rect1", calc);
    expect(abs).not.toBeNull();
    // rect1 is at (10,20) inside frame1 at (100,100) -> absolute (110,120)
    expect(abs).toEqual({ x: 110, y: 120 });

    const rect1 = useSceneStore.getState().nodesById.rect1;
    const expectedNodes = [{ ...rect1, x: abs!.x, y: abs!.y, children: [] }];
    const expectedBounds = calculateNodesBounds(expectedNodes as never);

    await callPluginMethod("p1", "viewport.zoomTo", [["rect1"]]);
    const { scale, x, y } = useViewportStore.getState();

    const expectedCenterX = expectedBounds.minX + (expectedBounds.maxX - expectedBounds.minX) / 2;
    const expectedCenterY = expectedBounds.minY + (expectedBounds.maxY - expectedBounds.minY) / 2;
    expect(x).toBeCloseTo(window.innerWidth / 2 - expectedCenterX * scale);
    expect(y).toBeCloseTo(window.innerHeight / 2 - expectedCenterY * scale);

    // The old (wrong) behavior centered on rect1's parent-relative (10,20)
    // instead of its absolute (110,120) - assert we differ from that.
    const wrongCenterX = 10 + rect1.width / 2;
    expect(expectedCenterX).not.toBeCloseTo(wrongCenterX);
  });

  it("viewport.zoomTo throws when no ids match", async () => {
    await expect(callPluginMethod("p1", "viewport.zoomTo", [["ghost"]])).rejects.toThrow(
      /no matching nodes/,
    );
  });

  it("rejects unknown methods", async () => {
    await expect(callPluginMethod("p1", "eval", ["x"])).rejects.toThrow(/Unknown pen method/);
  });

  describe("ui.resize", () => {
    beforeEach(() => {
      usePluginPanelStore.setState({ panels: {} });
    });

    it("rejects when the plugin has no open panel (headless plugin)", async () => {
      await expect(callPluginMethod("p1", "ui.resize", [500, 400])).rejects.toThrow(
        /has no open panel/,
      );
    });

    it("resizes an open panel and clamps to the sane range", async () => {
      usePluginPanelStore.getState().open(
        { id: "p1", name: "T", description: "", code: "", ui: { width: 300, height: 200 }, source: "ai", createdAt: 0, updatedAt: 0 },
        document.createElement("iframe"),
      );
      await callPluginMethod("p1", "ui.resize", [9999, 9999]);
      const panel = usePluginPanelStore.getState().panels["p1"];
      expect(panel.width).toBeLessThan(9999);
      expect(panel.height).toBeLessThan(9999);
    });

    it("rejects non-numeric width/height", async () => {
      usePluginPanelStore.getState().open(
        { id: "p1", name: "T", description: "", code: "", ui: { width: 300, height: 200 }, source: "ai", createdAt: 0, updatedAt: 0 },
        document.createElement("iframe"),
      );
      await expect(callPluginMethod("p1", "ui.resize", ["500", 400])).rejects.toThrow(
        /must be finite numbers/,
      );
    });
  });
});
