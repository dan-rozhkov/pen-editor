import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureNodeScreenshot } from "@/lib/captureNodeScreenshot";
import { useCanvasRefStore, type PixiExportRefs } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";
import * as embedScreenshot from "@/lib/embedScreenshot";
import type { EmbedNode } from "@/types/scene";

beforeEach(() => {
  resetStores();
  seedScene();
});

function seedEmbedNode(): void {
  const embed = {
    id: "embed1",
    type: "embed",
    name: "Code",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    htmlContent: '<img src="https://images.unsplash.com/photo-1">',
  } as unknown as EmbedNode;
  const scene = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...scene.nodesById, embed1: embed },
    parentById: { ...scene.parentById, embed1: null },
    rootIds: [...scene.rootIds, "embed1"],
  });
}

describe("captureNodeScreenshot (FIR-56)", () => {
  it("returns null for a missing node", async () => {
    expect(await captureNodeScreenshot("ghost")).toBeNull();
  });

  it("renders embed nodes via their HTML instead of the (empty) PixiJS container", async () => {
    seedEmbedNode();
    const spy = vi
      .spyOn(embedScreenshot, "captureEmbedScreenshot")
      .mockResolvedValue("data:image/png;base64,EMBED");

    // No PixiJS renderer registered — proves the embed path doesn't depend on it.
    const result = await captureNodeScreenshot("embed1");

    expect(result).toBe("data:image/png;base64,EMBED");
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: "embed1" }));
    spy.mockRestore();
  });

  it("still uses PixiJS extraction for non-embed nodes", async () => {
    const extractBase64 = vi.fn(async () => "data:image/png;base64,PIXI");
    const fakeRefs = {
      app: { renderer: { extract: { base64: extractBase64 } } },
      sceneRoot: { label: "frame1", children: [] },
    } as unknown as PixiExportRefs;
    useCanvasRefStore.getState().setPixiRefs(fakeRefs);
    try {
      const result = await captureNodeScreenshot("frame1");
      expect(result).toBe("data:image/png;base64,PIXI");
    } finally {
      useCanvasRefStore.getState().setPixiRefs(null);
    }
  });
});
