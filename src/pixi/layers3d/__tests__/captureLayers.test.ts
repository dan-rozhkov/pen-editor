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
      .mockImplementation(() => ({ getChildByLabel: () => null }));
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("emits planes in paint order with monotonic depthIndex", async () => {
    const planes = await captureLayers("frame1");
    expect(planes.map((p) => p.nodeId)).toEqual(["frame1", "rect1", "text1"]);
    expect(planes.map((p) => p.depthIndex)).toEqual([0, 1, 2]);
  });

  it("positions rects relative to the frame origin", async () => {
    const planes = await captureLayers("frame1");
    // frame1 is at (100,100); its own plane sits at local (0,0)
    expect(planes[0].rect).toMatchObject({ x: 0, y: 0, width: 400, height: 300 });
    // rect1 is at absolute (110,120) → local (10,20)
    expect(planes[1].rect).toMatchObject({ x: 10, y: 20, width: 100, height: 50 });
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

  it("skips nodes whose extracted canvas is degenerate (1×1), keeping depthIndex consecutive", async () => {
    // A content-less container (no own fill/stroke) extracts as a 1×1 canvas
    // once its children-host is hidden. Such a plane is an invisible blurry
    // stretch — drop it, and don't let it consume a depthIndex slot.
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
    // rect1 dropped; frame1 and text1 remain with consecutive depthIndex.
    expect(planes.map((p) => p.nodeId)).toEqual(["frame1", "text1"]);
    expect(planes.map((p) => p.depthIndex)).toEqual([0, 1]);
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
