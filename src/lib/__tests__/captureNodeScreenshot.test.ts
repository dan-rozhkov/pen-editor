import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureNodeScreenshot } from "@/lib/captureNodeScreenshot";
import { useCanvasRefStore, type PixiExportRefs } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";
import * as embedScreenshot from "@/lib/embedScreenshot";
import type { EmbedNode } from "@/types/scene";

// captureNodeScreenshot shares the downscale step with get_screenshot
// (finding B, 2026-08-14 code review) — stub it so tests don't depend on a
// real canvas/Image decode (happy-dom has neither) and can assert it runs.
const downscaleImageDataUrl = vi.fn(async (dataUrl: string, _maxSide?: number) => `${dataUrl}-downscaled`);
vi.mock("@/lib/tools/screenshotDownscale", () => ({
  downscaleImageDataUrl: (dataUrl: string, maxSide?: number) =>
    downscaleImageDataUrl(dataUrl, maxSide),
}));

beforeEach(() => {
  resetStores();
  seedScene();
  downscaleImageDataUrl.mockClear();
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

    expect(result).toBe("data:image/png;base64,EMBED-downscaled");
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: "embed1" }), undefined, "embed1");
    expect(downscaleImageDataUrl).toHaveBeenCalledWith("data:image/png;base64,EMBED", undefined);
    spy.mockRestore();
  });

  // Finding #2 (2026-07-27 review): mirrors the getScreenshot.ts fix — an
  // embed sized fill_container stores a 0-placeholder width in the flat
  // node, which used to slip straight into captureEmbedScreenshot's
  // `!node.width` guard.
  it("resolves a fill_container embed's real width before screenshotting", async () => {
    const scene = useSceneStore.getState();
    const wrapFrame = {
      id: "wrap1",
      type: "frame",
      name: "Wrap",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      layout: { autoLayout: true, flexDirection: "column" },
    } as unknown as EmbedNode;
    const fillEmbed = {
      id: "embed2",
      type: "embed",
      name: "Code",
      x: 0,
      y: 0,
      width: 0,
      height: 50,
      sizing: { widthMode: "fill_container", heightMode: "fixed" },
      htmlContent: '<img src="https://picsum.photos/200">',
    } as unknown as EmbedNode;
    useSceneStore.setState({
      nodesById: { ...scene.nodesById, wrap1: wrapFrame, embed2: fillEmbed },
      parentById: { ...scene.parentById, wrap1: null, embed2: "wrap1" },
      childrenById: { ...scene.childrenById, wrap1: ["embed2"] },
      rootIds: [...scene.rootIds, "wrap1"],
    });

    const spy = vi
      .spyOn(embedScreenshot, "captureEmbedScreenshot")
      .mockResolvedValue("data:image/png;base64,EMBED");

    const result = await captureNodeScreenshot("embed2");

    expect(result).toBe("data:image/png;base64,EMBED-downscaled");
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ width: 300, height: 50 }), undefined, "embed2");
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
      expect(result).toBe("data:image/png;base64,PIXI-downscaled");
      expect(downscaleImageDataUrl).toHaveBeenCalledWith("data:image/png;base64,PIXI", undefined);
    } finally {
      useCanvasRefStore.getState().setPixiRefs(null);
    }
  });
});
