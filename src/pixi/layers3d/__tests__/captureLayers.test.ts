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
    getNodeContainer.mockReset().mockImplementation(() => ({}));
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
});
