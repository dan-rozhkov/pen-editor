import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";

const extractCanvas = vi.fn();
const getNodeContainer = vi.fn();

vi.mock("@/pixi/pixiSync", () => ({
  getNodeContainer: (id: string) => getNodeContainer(id),
}));
vi.mock("@/store/canvasRefStore", () => ({
  useCanvasRefStore: {
    getState: () => ({
      pixiRefs: { app: { renderer: { extract: { canvas: extractCanvas } } } },
    }),
  },
}));

import { captureLayers } from "../captureLayers";

// A fake canvas whose toBlob yields a blob so createObjectURL is exercised.
function fakeCanvas() {
  return {
    width: 100,
    height: 50,
    toBlob: (cb: (b: Blob) => void) => cb(new Blob(["x"], { type: "image/png" })),
  };
}

describe("captureLayers", () => {
  beforeEach(() => {
    resetStores();
    seedScene(); // frame1 → [rect1, text1]; rect2 is a separate root
    extractCanvas.mockReset().mockImplementation(() => fakeCanvas());
    getNodeContainer
      .mockReset()
      .mockImplementation((id: string) => ({ __id: id, getChildByLabel: () => null }));
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("emits planes in paint order with tree-depth: root=0, siblings share depth, deeper for descendants", async () => {
    const planes = await captureLayers("frame1");
    expect(planes.map((p) => p.nodeId)).toEqual(["frame1", "rect1", "text1"]);
    // frame1 is the root (depth 0); rect1 and text1 are siblings, both direct
    // children of frame1, so they share depth 1.
    expect(planes.map((p) => p.depth)).toEqual([0, 1, 1]);
  });

  it("gives a nested grandchild a greater depth than its parent", async () => {
    const { useSceneStore } = await import("@/store/sceneStore");
    const s = useSceneStore.getState();
    // Nest a grandchild under rect1: frame1(0) -> rect1(1) -> grandchild1(2).
    useSceneStore.setState({
      nodesById: {
        ...s.nodesById,
        grandchild1: {
          id: "grandchild1",
          type: "rect",
          name: "Nested",
          x: 5,
          y: 5,
          width: 10,
          height: 10,
        } as never,
      },
      parentById: { ...s.parentById, grandchild1: "rect1" },
      childrenById: { ...s.childrenById, rect1: ["grandchild1"] },
    });

    const planes = await captureLayers("frame1");
    const depthOf = (id: string) =>
      planes.find((p) => p.nodeId === id)?.depth;
    expect(depthOf("frame1")).toBe(0);
    expect(depthOf("rect1")).toBe(1);
    expect(depthOf("grandchild1")).toBe(2);
  });

  it("positions rects relative to the frame origin", async () => {
    const planes = await captureLayers("frame1");
    // frame1 is at (100,100); its own plane sits at local (0,0)
    expect(planes[0].rect).toMatchObject({ x: 0, y: 0, width: 400, height: 300 });
    // rect1 is at absolute (110,120) → local (10,20)
    expect(planes[1].rect).toMatchObject({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("uses the layout-computed size for fill text planes", async () => {
    const { useSceneStore } = await import("@/store/sceneStore");
    const state = useSceneStore.getState();
    useSceneStore.setState({
      nodesById: {
        ...state.nodesById,
        frame1: {
          ...state.nodesById.frame1,
          layout: {
            autoLayout: true,
            flexDirection: "column",
            gap: 8,
            paddingTop: 16,
            paddingRight: 16,
            paddingBottom: 16,
            paddingLeft: 16,
          },
        } as never,
        text1: {
          ...state.nodesById.text1,
          sizing: { widthMode: "fill_container", heightMode: "fixed" },
        } as never,
      },
      _cachedTree: null,
    });

    const { useLayoutStore } = await import("@/store/layoutStore");
    const frame = useSceneStore.getState().getNodes()[0];
    if (frame?.type !== "frame") throw new Error("Expected frame fixture");
    const laidOutText = useLayoutStore
      .getState()
      .calculateLayoutForFrame(frame)
      .find((node) => node.id === "text1");
    const planes = await captureLayers("frame1");
    const textPlane = planes.find((plane) => plane.nodeId === "text1");

    expect(laidOutText?.width).not.toBe(state.nodesById.text1.width);
    expect(textPlane?.rect.width).toBe(laidOutText?.width);
    expect(textPlane?.rect.height).toBe(20);
    const textContainer = getNodeContainer.mock.results.find(
      (result) => result.value?.__id === "text1",
    )?.value;
    const textExtraction = extractCanvas.mock.calls.find(
      ([options]) => options?.target === textContainer,
    )?.[0];
    expect(textExtraction?.frame).toMatchObject({
      x: 0,
      y: 0,
      width: laidOutText?.width,
      height: 20,
    });
  });

  it("skips zero-size and invisible nodes", async () => {
    resetStores();
    seedScene();
    const s = (await import("@/store/sceneStore")).useSceneStore.getState();
    s.updateNode("rect1", { visible: false });
    const planes = await captureLayers("frame1");
    expect(planes.map((p) => p.nodeId)).toEqual(["frame1", "text1"]);
  });

  it("hides the frame's children-host while extracting, then restores it", async () => {
    const childrenHost = { visible: true };
    const frameContainer = {
      getChildByLabel: (label: string) =>
        label === "frame-children" ? childrenHost : null,
    };
    getNodeContainer.mockImplementation((id: string) =>
      id === "frame1"
        ? frameContainer
        : { getChildByLabel: () => null },
    );
    let hostVisibleAtExtract: boolean | undefined;
    extractCanvas.mockImplementation((container: unknown) => {
      if (container === frameContainer) {
        hostVisibleAtExtract = childrenHost.visible;
      }
      return fakeCanvas();
    });

    await captureLayers("frame1");

    // (a) host is hidden at the exact moment the frame container is extracted
    expect(hostVisibleAtExtract).toBe(false);
    // (b) host visibility is restored afterward
    expect(childrenHost.visible).toBe(true);
  });

  it("skips nodes whose extracted canvas is degenerate (1×1), without shifting siblings' depth", async () => {
    // A content-less container (no own fill/stroke) extracts as a 1×1 canvas
    // once its children-host is hidden. Such a plane is an invisible blurry
    // stretch — drop it. Depth is computed from the actual tree during the
    // walk, so dropping rect1 must not shift text1's depth (still 1, since
    // text1 is a direct child of the root frame regardless of rect1's fate).
    // Tag each container with its id so the extract mock can vary by node.
    getNodeContainer.mockImplementation((id: string) => ({
      __id: id,
      getChildByLabel: () => null,
    }));
    // rect1's container extracts as a degenerate 1×1 canvas.
    extractCanvas.mockImplementation((container: { __id: string }) => {
      const size = container.__id === "rect1" ? 1 : 100;
      return {
        width: size,
        height: size,
        toBlob: (cb: (b: Blob) => void) => cb(new Blob(["x"])),
      };
    });

    const planes = await captureLayers("frame1");
    // rect1 dropped; frame1 (depth 0) and text1 (depth 1) remain.
    expect(planes.map((p) => p.nodeId)).toEqual(["frame1", "text1"]);
    expect(planes.map((p) => p.depth)).toEqual([0, 1]);
  });

  it("restores the children-host visibility even when extraction throws", async () => {
    const childrenHost = { visible: true };
    const frameContainer = {
      getChildByLabel: (label: string) =>
        label === "frame-children" ? childrenHost : null,
    };
    getNodeContainer.mockImplementation((id: string) =>
      id === "frame1"
        ? frameContainer
        : { getChildByLabel: () => null },
    );
    extractCanvas.mockImplementation((container: unknown) => {
      if (container === frameContainer) throw new Error("extract failed");
      return fakeCanvas();
    });

    const planes = await captureLayers("frame1");

    // frame plane skipped, but the host must be restored regardless
    expect(childrenHost.visible).toBe(true);
    expect(planes.map((p) => p.nodeId)).toEqual(["rect1", "text1"]);
  });
});
