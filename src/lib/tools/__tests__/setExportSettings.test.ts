import { describe, it, expect, beforeEach } from "vitest";
import { setExportSettings } from "@/lib/tools/setExportSettings";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import type { RectNode, TextNode } from "@/types/scene";
import { resetStores, seedScene } from "@/test/fixtures";

function rect1(): RectNode {
  return useSceneStore.getState().nodesById["rect1"] as unknown as RectNode;
}
function rect2(): RectNode {
  return useSceneStore.getState().nodesById["rect2"] as unknown as RectNode;
}
function text1(): TextNode {
  return useSceneStore.getState().nodesById["text1"] as unknown as TextNode;
}

beforeEach(() => {
  resetStores();
  seedScene();
});

describe("set_export_settings", () => {
  it("errors when nodeIds is missing or empty", async () => {
    expect(JSON.parse(await setExportSettings({ format: "png" })).error).toBeTruthy();
    expect(JSON.parse(await setExportSettings({ nodeIds: [], format: "png" })).error).toBeTruthy();
  });

  it("errors on a missing or invalid format", async () => {
    expect(JSON.parse(await setExportSettings({ nodeIds: ["rect1"] })).error).toBeTruthy();
    expect(
      JSON.parse(await setExportSettings({ nodeIds: ["rect1"], format: "bmp" })).error,
    ).toBeTruthy();
  });

  it("adds an export setting to a single node, defaulting scale to 1", async () => {
    const result = JSON.parse(
      await setExportSettings({ nodeIds: ["rect1"], format: "png" }),
    );
    expect(result).toEqual({ success: true, updatedCount: 1 });
    expect(rect1().exportSettings).toHaveLength(1);
    expect(rect1().exportSettings![0]).toMatchObject({ format: "png", scale: 1 });
  });

  it("passes through scale/suffix/quality", async () => {
    await setExportSettings({
      nodeIds: ["rect1"],
      format: "jpg",
      scale: 2,
      suffix: "@2x",
      quality: 0.8,
    });
    expect(rect1().exportSettings![0]).toMatchObject({
      format: "jpg",
      scale: 2,
      suffix: "@2x",
      quality: 0.8,
    });
  });

  it("appends to existing exportSettings by default (mode: add)", async () => {
    await setExportSettings({ nodeIds: ["rect1"], format: "png", scale: 1 });
    await setExportSettings({ nodeIds: ["rect1"], format: "svg" });

    expect(rect1().exportSettings).toHaveLength(2);
    expect(rect1().exportSettings!.map((s) => s.format)).toEqual(["png", "svg"]);
  });

  it("replaces existing exportSettings when mode is 'replace'", async () => {
    await setExportSettings({ nodeIds: ["rect1"], format: "png", scale: 1 });
    await setExportSettings({ nodeIds: ["rect1"], format: "pdf", mode: "replace" });

    expect(rect1().exportSettings).toHaveLength(1);
    expect(rect1().exportSettings![0].format).toBe("pdf");
  });

  it("applies the same setting to multiple nodes and reports unknown ids", async () => {
    const result = JSON.parse(
      await setExportSettings({ nodeIds: ["rect1", "rect2", "text1", "does-not-exist"], format: "webp" }),
    );

    expect(result).toEqual({ success: true, updatedCount: 3, missingNodeIds: ["does-not-exist"] });
    expect(rect1().exportSettings).toHaveLength(1);
    expect(rect2().exportSettings).toHaveLength(1);
    expect(text1().exportSettings).toHaveLength(1);
    // Each node gets its own setting instance (distinct ids), not a shared reference.
    expect(rect1().exportSettings![0].id).not.toBe(rect2().exportSettings![0].id);
  });

  it("omits missingNodeIds when every node resolved", async () => {
    const result = JSON.parse(
      await setExportSettings({ nodeIds: ["rect1", "rect2"], format: "png" }),
    );
    expect(result).toEqual({ success: true, updatedCount: 2 });
    expect(result.missingNodeIds).toBeUndefined();
  });

  it("records a single undo step for the whole call", async () => {
    const pastBefore = useHistoryStore.getState().past.length;

    await setExportSettings({ nodeIds: ["rect1", "rect2"], format: "png" });

    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
  });
});
