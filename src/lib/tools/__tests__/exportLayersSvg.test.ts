import { describe, it, expect, beforeEach } from "vitest";
import { exportLayersSvg } from "@/lib/tools/exportLayersSvg";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { PathNode } from "@/types/scene";
import { resetStores, seedScene } from "@/test/fixtures";

function decodeDataUri(dataUri: string): string {
  const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
  return decodeURIComponent(escape(atob(base64)));
}

beforeEach(() => {
  resetStores();
  seedScene();
});

describe("export_layers_svg", () => {
  it("errors when nodeIds is omitted and nothing is selected", async () => {
    const result = JSON.parse(await exportLayersSvg({}));
    expect(result.error).toBeTruthy();
  });

  it("errors on an explicitly empty nodeIds array combined with no selection", async () => {
    const result = JSON.parse(await exportLayersSvg({ nodeIds: [] }));
    expect(result.error).toBeTruthy();
  });

  it("defaults to the current selection when nodeIds is omitted", async () => {
    useSelectionStore.setState({ selectedIds: ["rect2"] });
    const result = JSON.parse(await exportLayersSvg({}));
    expect(result.success).toBe(true);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
    expect(result.dataUri).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = decodeDataUri(result.dataUri);
    expect(svg).toContain("<rect");
  });

  it("exports an explicit multi-node selection, ignoring the current selection", async () => {
    useSelectionStore.setState({ selectedIds: ["rect2"] });
    const result = JSON.parse(await exportLayersSvg({ nodeIds: ["rect1", "text1"] }));
    expect(result.success).toBe(true);
    const svg = decodeDataUri(result.dataUri);
    expect(svg).toContain("<rect");
    expect(svg).toContain("Hello");
    expect(result.warnings).toBeUndefined();
  });

  it("exports a path node's geometry faithfully", async () => {
    const path1: PathNode = {
      id: "path1",
      type: "path",
      name: "Logo mark",
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      geometry: "M0 0 L24 0 L24 24 Z",
      fill: "#123456",
    } as unknown as PathNode;
    useSceneStore.setState((state) => ({
      nodesById: { ...state.nodesById, path1 },
      rootIds: [...state.rootIds, "path1"],
    }));

    const result = JSON.parse(await exportLayersSvg({ nodeIds: ["path1"] }));
    expect(result.success).toBe(true);
    expect(result.width).toBe(24);
    expect(result.height).toBe(24);
    const svg = decodeDataUri(result.dataUri);
    expect(svg).toContain("<path");
    expect(svg).toContain("M0 0 L24 0 L24 24 Z");
  });

  it("returns a warning (not a hard error) for an unknown node id mixed into a valid selection", async () => {
    const result = JSON.parse(await exportLayersSvg({ nodeIds: ["rect1", "does-not-exist"] }));
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(["Node not found: does-not-exist"]);
  });

  it("errors when every requested node id is unknown", async () => {
    const result = JSON.parse(await exportLayersSvg({ nodeIds: ["nope-1", "nope-2"] }));
    expect(result.error).toBeTruthy();
    expect(result.warnings).toEqual([
      "Node not found: nope-1",
      "Node not found: nope-2",
      "No matching nodes in selection",
    ]);
  });

  it("rejects an export whose serialized SVG exceeds the size cap", async () => {
    // A single rect node's SVG serialization is tiny; force it over the
    // limit via a name so pathologically large exports can't be smuggled
    // through as a "cheap" single node — this exercises the cap itself
    // rather than trying to construct a genuinely enormous scene.
    const hugeFill = "#" + "1".repeat(200_000);
    const rectHuge = {
      id: "rectHuge",
      type: "rect",
      name: "Huge",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fill: hugeFill,
    } as unknown as import("@/types/scene").RectNode;
    useSceneStore.setState((state) => ({
      nodesById: { ...state.nodesById, rectHuge },
      rootIds: [...state.rootIds, "rectHuge"],
    }));

    const result = JSON.parse(await exportLayersSvg({ nodeIds: ["rectHuge"] }));
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/too large/i);
  });
});
