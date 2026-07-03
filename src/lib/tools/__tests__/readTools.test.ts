import { describe, it, expect, beforeEach } from "vitest";
import { batchGet } from "@/lib/tools/batchGet";
import { getEditorState } from "@/lib/tools/getEditorState";
import { snapshotLayout } from "@/lib/tools/snapshotLayout";
import { findEmptySpace } from "@/lib/tools/findEmptySpace";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { resetStores, seedScene, seedVariables } from "@/test/fixtures";
import type { FlatFrameNode } from "@/types/scene";

beforeEach(() => {
  resetStores();
  seedScene();
});

describe("batch_get", () => {
  it("returns top-level nodes when called without arguments", async () => {
    const results = JSON.parse(await batchGet({}));
    expect(results.map((r: { id: string }) => r.id)).toEqual([
      "frame1",
      "rect2",
    ]);
  });

  it("reads specific nodes by id", async () => {
    const results = JSON.parse(await batchGet({ nodeIds: ["rect1", "ghost"] }));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "rect1",
      type: "rect",
      name: "Box",
      fill: "#ff0000",
    });
  });

  it("searches recursively by type and name patterns", async () => {
    const byType = JSON.parse(
      await batchGet({ patterns: [{ type: "text" }] })
    );
    expect(byType.map((r: { id: string }) => r.id)).toEqual(["text1"]);

    const byName = JSON.parse(
      await batchGet({ patterns: [{ name: "^box$" }] })
    );
    expect(byName.map((r: { id: string }) => r.id)).toEqual(["rect1"]);
  });

  it("limits serialization depth via readDepth", async () => {
    const shallow = JSON.parse(
      await batchGet({ nodeIds: ["frame1"], readDepth: 0 })
    );
    expect(shallow[0].children).toBe("...");

    const deep = JSON.parse(
      await batchGet({ nodeIds: ["frame1"], readDepth: 1 })
    );
    expect(deep[0].children).toHaveLength(2);
    expect(deep[0].children[0].id).toBe("rect1");
  });

  it('aliases wire type "rectangle" to internal "rect" nodes', async () => {
    const byWireType = JSON.parse(
      await batchGet({ patterns: [{ type: "rectangle" }] })
    );
    expect(byWireType.map((r: { id: string }) => r.id).sort()).toEqual([
      "rect1",
      "rect2",
    ]);

    const byBogusType = JSON.parse(
      await batchGet({ patterns: [{ type: "nonexistent" }] })
    );
    expect(byBogusType).toEqual([]);
  });

  it("resolves variable bindings when resolveVariables is set", async () => {
    seedVariables();
    useSceneStore.setState((state) => ({
      nodesById: {
        ...state.nodesById,
        rect1: {
          ...state.nodesById["rect1"],
          fillBinding: { variableId: "var-primary" },
        },
      },
    }));

    const results = JSON.parse(
      await batchGet({ nodeIds: ["rect1"], resolveVariables: true })
    );
    expect(results[0].fill).toBe("#3366ff");
  });
});

describe("get_editor_state", () => {
  it("serializes roots, selection, viewport and pages", async () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] });
    useViewportStore.setState({ scale: 2, x: -10, y: 30 });

    const state = JSON.parse(await getEditorState({}));

    expect(state.roots).toEqual([
      { id: "frame1", type: "frame", name: "Screen" },
      { id: "rect2", type: "rect", name: "Floating" },
    ]);
    expect(state.selectedIds).toEqual(["rect1"]);
    expect(state.selectedNodes).toEqual([
      {
        id: "rect1",
        type: "rect",
        name: "Box",
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      },
    ]);
    expect(state.viewport).toEqual({ scale: 2, x: -10, y: 30 });
    expect(Array.isArray(state.pages)).toBe(true);
    expect(state.pages.length).toBeGreaterThan(0);
    expect(typeof state.activePageId).toBe("string");
  });

  it("lists reusable frames as document components", async () => {
    useSceneStore.setState((state) => ({
      nodesById: {
        ...state.nodesById,
        frame1: {
          ...(state.nodesById["frame1"] as FlatFrameNode),
          reusable: true,
        },
      },
    }));

    const state = JSON.parse(await getEditorState({}));
    expect(state.documentComponents).toEqual([
      expect.objectContaining({
        id: "frame1",
        name: "Screen",
        tag: "c-screen",
        width: 400,
        height: 300,
      }),
    ]);
    expect(state.reusableComponents[0]).toMatchObject({
      id: "frame1",
      syncState: "missing",
    });
  });
});

describe("snapshot_layout", () => {
  it("reports absolute positions for nested nodes", async () => {
    const rects = JSON.parse(await snapshotLayout({}));

    expect(rects).toHaveLength(2);
    const frame = rects[0];
    expect(frame).toMatchObject({ id: "frame1", x: 100, y: 100, width: 400, height: 300 });
    const child = frame.children.find((c: { id: string }) => c.id === "rect1");
    // absolute = parent (100,100) + relative (10,20)
    expect(child).toMatchObject({ x: 110, y: 120, width: 100, height: 50 });
  });

  it("truncates children beyond maxDepth", async () => {
    const rects = JSON.parse(await snapshotLayout({ maxDepth: 0 }));
    expect(rects[0].children).toBe("...");
  });

  it("scopes to a parent and skips invisible nodes", async () => {
    useSceneStore.setState((state) => ({
      nodesById: {
        ...state.nodesById,
        text1: { ...state.nodesById["text1"], visible: false },
      },
    }));

    const rects = JSON.parse(await snapshotLayout({ parentId: "frame1" }));
    expect(rects).toHaveLength(1);
    expect(rects[0].id).toBe("frame1");
    expect(rects[0].children.map((c: { id: string }) => c.id)).toEqual([
      "rect1",
    ]);
  });

  it("only reports clipped children in problemsOnly mode", async () => {
    // rect overflowing the right edge of frame1
    useSceneStore.setState((state) => ({
      nodesById: {
        ...state.nodesById,
        clipped: {
          id: "clipped",
          type: "rect",
          name: "Clipped",
          x: 390,
          y: 0,
          width: 100,
          height: 40,
        },
      },
      parentById: { ...state.parentById, clipped: "frame1" },
      childrenById: {
        ...state.childrenById,
        frame1: [...state.childrenById["frame1"], "clipped"],
      },
    }));

    const rects = JSON.parse(await snapshotLayout({ problemsOnly: true }));
    const frame = rects.find((r: { id: string }) => r.id === "frame1");
    expect(frame.children.map((c: { id: string }) => c.id)).toEqual([
      "clipped",
    ]);
  });
});

describe("find_empty_space_on_canvas", () => {
  // Fixture bounds: frame1 (100,100,400x300) + rect2 (600,100,200x100)
  // → minX 100, minY 100, maxX 800, maxY 400, center (450, 250)

  it("requires width and height", async () => {
    const result = JSON.parse(await findEmptySpace({}));
    expect(result.error).toMatch(/width and height are required/);
  });

  it("places to the right of all content by default", async () => {
    const result = JSON.parse(
      await findEmptySpace({ width: 200, height: 100 })
    );
    expect(result).toEqual({ x: 850, y: 200 });
  });

  it("supports left/bottom/top directions and custom padding", async () => {
    expect(
      JSON.parse(
        await findEmptySpace({ width: 200, height: 100, direction: "left", padding: 10 })
      )
    ).toEqual({ x: -110, y: 200 });

    expect(
      JSON.parse(
        await findEmptySpace({ width: 200, height: 100, direction: "bottom" })
      )
    ).toEqual({ x: 350, y: 450 });

    expect(
      JSON.parse(
        await findEmptySpace({ width: 200, height: 100, direction: "top" })
      )
    ).toEqual({ x: 350, y: -50 });
  });

  it("anchors to a specific node when nodeId is given", async () => {
    const result = JSON.parse(
      await findEmptySpace({ width: 100, height: 100, nodeId: "rect2" })
    );
    // right of rect2: 600+200+50 = 850, centered on rect2's y-center (150)
    expect(result).toEqual({ x: 850, y: 100 });
  });

  it("returns an error for unknown nodeId", async () => {
    const result = JSON.parse(
      await findEmptySpace({ width: 10, height: 10, nodeId: "ghost" })
    );
    expect(result.error).toMatch(/not found/);
  });

  it("places at origin on an empty canvas", async () => {
    resetStores();
    const result = JSON.parse(
      await findEmptySpace({ width: 100, height: 100 })
    );
    expect(result).toEqual({ x: 0, y: 0 });
  });
});
