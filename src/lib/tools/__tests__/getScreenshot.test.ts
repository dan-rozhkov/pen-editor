import { describe, it, expect, beforeEach, vi } from "vitest";
import { getScreenshot } from "@/lib/tools/getScreenshot";
import { useCanvasRefStore, type PixiExportRefs } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores, seedScene } from "@/test/fixtures";
import * as embedScreenshot from "@/lib/embedScreenshot";
import type { EmbedNode } from "@/types/scene";

beforeEach(() => {
  resetStores();
  seedScene();
});

function seedEmbedNode(overrides: Partial<EmbedNode> = {}): void {
  const embed = {
    id: "embed1",
    type: "embed",
    name: "Code",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    htmlContent: '<img src="https://picsum.photos/200">',
    ...overrides,
  } as unknown as EmbedNode;
  const scene = useSceneStore.getState();
  useSceneStore.setState({
    nodesById: { ...scene.nodesById, embed1: embed },
    parentById: { ...scene.parentById, embed1: null },
    rootIds: [...scene.rootIds, "embed1"],
  });
}

describe("get_screenshot", () => {
  it("errors when no nodeId is given and nothing is selected", async () => {
    const result = JSON.parse(await getScreenshot({}));
    expect(result.error).toMatch(/nodeId is required/);
  });

  it("errors when no nodeId is given and multiple nodes are selected", async () => {
    useSelectionStore.getState().setSelectedIds(["frame1", "rect1"]);
    const result = JSON.parse(await getScreenshot({}));
    expect(result.error).toMatch(/multiple nodes are selected/);
  });

  it("falls back to the single selected node when nodeId is omitted", async () => {
    useSelectionStore.getState().setSelectedIds(["frame1"]);
    const result = JSON.parse(await getScreenshot({}));
    // No PixiJS renderer is initialized in this unit test environment (per
    // repo convention, get_screenshot's WebGL path is e2e-only) — falling
    // through to the existing "no canvas renderer" branch proves the
    // selected node id (not a validation error) was resolved and used.
    expect(result.error).toBe("No canvas renderer available");
  });

  it("still errors when an explicit nodeId does not exist", async () => {
    const result = JSON.parse(await getScreenshot({ nodeId: "ghost" }));
    expect(result.error).toBe("Node not found: ghost");
  });

  // Regression: Pixi's extract.base64 already returns a full data URL —
  // the handler must not prepend a second "data:image/png;base64," prefix
  // (found live: MCP clients rejected the doubled prefix as invalid base64).
  it("does not double the data-URL prefix from extract.base64", async () => {
    const fakeRefs = {
      app: {
        renderer: {
          extract: { base64: async () => "data:image/png;base64,AAAA" },
        },
      },
      sceneRoot: { label: "frame1", children: [] },
    } as unknown as PixiExportRefs;
    useCanvasRefStore.getState().setPixiRefs(fakeRefs);
    try {
      const result = JSON.parse(await getScreenshot({ nodeId: "frame1" }));
      expect(result.imageData).toBe("data:image/png;base64,AAAA");
    } finally {
      useCanvasRefStore.getState().setPixiRefs(null);
    }
  });

  it("adds the data-URL prefix when the renderer returns bare base64", async () => {
    const fakeRefs = {
      app: {
        renderer: { extract: { base64: async () => "AAAA" } },
      },
      sceneRoot: { label: "frame1", children: [] },
    } as unknown as PixiExportRefs;
    useCanvasRefStore.getState().setPixiRefs(fakeRefs);
    try {
      const result = JSON.parse(await getScreenshot({ nodeId: "frame1" }));
      expect(result.imageData).toBe("data:image/png;base64,AAAA");
    } finally {
      useCanvasRefStore.getState().setPixiRefs(null);
    }
  });

  // FIR-56: embeds render as a live Shadow-DOM overlay, not PixiJS scene
  // content — their PixiJS container is intentionally empty (embedRenderer.ts),
  // so extract.base64 on an embed node always returns a blank image regardless
  // of whether its own (possibly image-heavy) HTML actually rendered. This is
  // the root cause repeatedly misread across sessions as "images don't load
  // inside the embed". These tests lock in that embeds bypass PixiJS
  // extraction entirely and go through the HTML-rendering path instead —
  // never falling into the "blank screenshot" trap, even with no PixiJS
  // renderer registered at all.
  describe("embed nodes (FIR-56)", () => {
    it("renders the embed's own HTML instead of extracting from PixiJS", async () => {
      seedEmbedNode();
      const spy = vi
        .spyOn(embedScreenshot, "captureEmbedScreenshot")
        .mockResolvedValue("data:image/png;base64,EMBED");
      // No PixiJS renderer registered at all — proves the embed path never
      // reaches (and never needs) app.renderer.extract.
      const result = JSON.parse(await getScreenshot({ nodeId: "embed1" }));
      expect(result.imageData).toBe("data:image/png;base64,EMBED");
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "embed1", htmlContent: expect.stringContaining("picsum") }),
      );
      spy.mockRestore();
    });

    it("returns a descriptive error instead of a silent blank image when the embed can't be rendered", async () => {
      seedEmbedNode();
      const spy = vi.spyOn(embedScreenshot, "captureEmbedScreenshot").mockResolvedValue(null);
      const result = JSON.parse(await getScreenshot({ nodeId: "embed1" }));
      expect(result.imageData).toBeUndefined();
      expect(result.error).toMatch(/embed1.*could not be rendered/i);
      spy.mockRestore();
    });
  });
});
