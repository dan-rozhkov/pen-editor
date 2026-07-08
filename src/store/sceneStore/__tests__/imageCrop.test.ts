import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { RectNode } from "@/types/scene";

function scene() {
  return useSceneStore.getState();
}

// Replicate the real undo/redo cycle from useCanvasKeyboardShortcuts:
// snapshot current -> ask history for the target -> restore it if present.
function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
  return prev;
}

function redo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const next = useHistoryStore.getState().redo(snapshot);
  if (next) useSceneStore.getState().restoreSnapshot(next);
  return next;
}

describe("image fill crop persists in the scene graph", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("stores a crop rect on a node's paint stack via updateNode", () => {
    scene().updateNode("rect1", {
      fills: [
        {
          id: "p1",
          type: "image",
          image: { url: "data:image/png;base64,abc", mode: "fill", crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } },
        },
      ],
    });

    const node = scene().nodesById.rect1 as RectNode;
    expect(node.fills?.[0]).toMatchObject({
      type: "image",
      image: {
        url: "data:image/png;base64,abc",
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
      },
    });
  });

  it("undo reverts a crop change and redo re-applies it", () => {
    scene().updateNode("rect1", {
      fills: [{ id: "p1", type: "image", image: { url: "data:image/x.png", mode: "fill" } }],
    });

    scene().updateNode("rect1", {
      fills: [
        {
          id: "p1",
          type: "image",
          image: { url: "data:image/x.png", mode: "fill", crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
        },
      ],
    });

    const cropped = (scene().nodesById.rect1 as RectNode).fills?.[0];
    expect(cropped?.type).toBe("image");
    expect(cropped && cropped.type === "image" ? cropped.image.crop : undefined).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    });

    undo();
    const uncropped = (scene().nodesById.rect1 as RectNode).fills?.[0];
    expect(uncropped?.type).toBe("image");
    expect(uncropped && uncropped.type === "image" ? uncropped.image.crop : "sentinel").toBeUndefined();

    redo();
    const recropped = (scene().nodesById.rect1 as RectNode).fills?.[0];
    expect(recropped && recropped.type === "image" ? recropped.image.crop : undefined).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    });
  });

  it("round-trips a crop rect through flattenTree/buildTree (the .pen serialization shape)", async () => {
    const { flattenTree, buildTree } = await import("@/types/scene");
    const nodeWithCrop = {
      id: "img1",
      type: "rect" as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fills: [
        {
          id: "p1",
          type: "image" as const,
          image: {
            url: "data:image/png;base64,zzz",
            mode: "fill" as const,
            crop: { x: 0.1, y: 0.15, width: 0.6, height: 0.7 },
          },
        },
      ],
    };

    const flat = flattenTree([nodeWithCrop]);
    const rebuilt = buildTree(flat.rootIds, flat.nodesById, flat.childrenById);
    const rebuiltNode = rebuilt[0] as RectNode;

    expect(rebuiltNode.fills?.[0]).toMatchObject({
      type: "image",
      image: { crop: { x: 0.1, y: 0.15, width: 0.6, height: 0.7 } },
    });

    // Also verify a plain JSON round-trip (what actually happens saving/loading a .pen file).
    const json = JSON.parse(JSON.stringify(rebuiltNode)) as RectNode;
    expect(json.fills?.[0]).toMatchObject({
      type: "image",
      image: { crop: { x: 0.1, y: 0.15, width: 0.6, height: 0.7 } },
    });
  });

  it("a node with no crop (legacy .pen file) keeps loading with crop undefined", async () => {
    const { flattenTree, buildTree } = await import("@/types/scene");
    const legacyNode = {
      id: "img2",
      type: "rect" as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      imageFill: { url: "data:image/png;base64,legacy", mode: "fill" as const },
    };

    const flat = flattenTree([legacyNode]);
    const rebuilt = buildTree(flat.rootIds, flat.nodesById, flat.childrenById);
    const rebuiltNode = rebuilt[0] as RectNode;

    expect(rebuiltNode.imageFill?.crop).toBeUndefined();
  });
});
