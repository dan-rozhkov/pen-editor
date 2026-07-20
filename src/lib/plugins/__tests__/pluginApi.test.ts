import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
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
    await callPluginMethod("p1", "selection.set", [["rect1"]]);
    expect(useSelectionStore.getState().selectedIds).toEqual(["rect1"]);
    const got = await callPluginMethod("p1", "selection.get", []);
    expect(got).toEqual(["rect1"]);
  });

  it("selection.set rejects non-string-array input", async () => {
    await expect(callPluginMethod("p1", "selection.set", ["rect1"])).rejects.toThrow();
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

  it("rejects unknown methods", async () => {
    await expect(callPluginMethod("p1", "eval", ["x"])).rejects.toThrow(/Unknown pen method/);
  });
});
