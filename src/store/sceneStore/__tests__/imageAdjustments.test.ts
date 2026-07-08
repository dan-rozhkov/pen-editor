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

describe("image fill adjustments persist in the scene graph", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("stores an adjustments object on a node's paint stack via updateNode", () => {
    scene().updateNode("rect1", {
      fills: [
        {
          id: "p1",
          type: "image",
          image: {
            url: "data:image/png;base64,abc",
            mode: "fill",
            adjustments: { brightness: 10, contrast: -5, saturation: 20, temperature: -15, tint: 5 },
          },
        },
      ],
    });

    const node = scene().nodesById.rect1 as RectNode;
    expect(node.fills?.[0]).toMatchObject({
      type: "image",
      image: {
        url: "data:image/png;base64,abc",
        adjustments: { brightness: 10, contrast: -5, saturation: 20, temperature: -15, tint: 5 },
      },
    });
  });

  it("undo reverts an adjustments change and redo re-applies it", () => {
    scene().updateNode("rect1", {
      fills: [{ id: "p1", type: "image", image: { url: "data:image/x.png", mode: "fill" } }],
    });

    scene().updateNode("rect1", {
      fills: [
        {
          id: "p1",
          type: "image",
          image: {
            url: "data:image/x.png",
            mode: "fill",
            adjustments: { brightness: 30, contrast: 0, saturation: 0, temperature: 0, tint: 0 },
          },
        },
      ],
    });

    const adjusted = (scene().nodesById.rect1 as RectNode).fills?.[0];
    expect(adjusted?.type).toBe("image");
    expect(adjusted && adjusted.type === "image" ? adjusted.image.adjustments?.brightness : undefined).toBe(30);

    undo();
    const reverted = (scene().nodesById.rect1 as RectNode).fills?.[0];
    expect(reverted?.type).toBe("image");
    expect(reverted && reverted.type === "image" ? reverted.image.adjustments : "sentinel").toBeUndefined();

    redo();
    const reapplied = (scene().nodesById.rect1 as RectNode).fills?.[0];
    expect(reapplied && reapplied.type === "image" ? reapplied.image.adjustments?.brightness : undefined).toBe(30);
  });

  it("resetting adjustments to undefined restores the original (unadjusted) look", () => {
    scene().updateNode("rect1", {
      fills: [
        {
          id: "p1",
          type: "image",
          image: {
            url: "data:image/x.png",
            mode: "fill",
            adjustments: { brightness: 40, contrast: 40, saturation: 40, temperature: 40, tint: 40 },
          },
        },
      ],
    });

    scene().updateNode("rect1", {
      fills: [{ id: "p1", type: "image", image: { url: "data:image/x.png", mode: "fill", adjustments: undefined } }],
    });

    const reset = (scene().nodesById.rect1 as RectNode).fills?.[0];
    expect(reset && reset.type === "image" ? reset.image.adjustments : "sentinel").toBeUndefined();
  });

  it("round-trips adjustments through flattenTree/buildTree (the .pen serialization shape)", async () => {
    const { flattenTree, buildTree } = await import("@/types/scene");
    const nodeWithAdjustments = {
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
            adjustments: { brightness: 12, contrast: -8, saturation: 33, temperature: -20, tint: 7 },
          },
        },
      ],
    };

    const flat = flattenTree([nodeWithAdjustments]);
    const rebuilt = buildTree(flat.rootIds, flat.nodesById, flat.childrenById);
    const rebuiltNode = rebuilt[0] as RectNode;

    expect(rebuiltNode.fills?.[0]).toMatchObject({
      type: "image",
      image: { adjustments: { brightness: 12, contrast: -8, saturation: 33, temperature: -20, tint: 7 } },
    });

    // Also verify a plain JSON round-trip (what actually happens saving/loading a .pen file).
    const json = JSON.parse(JSON.stringify(rebuiltNode)) as RectNode;
    expect(json.fills?.[0]).toMatchObject({
      type: "image",
      image: { adjustments: { brightness: 12, contrast: -8, saturation: 33, temperature: -20, tint: 7 } },
    });
  });

  it("a node with no adjustments (legacy .pen file) keeps loading with adjustments undefined", async () => {
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

    expect(rebuiltNode.imageFill?.adjustments).toBeUndefined();
  });
});
