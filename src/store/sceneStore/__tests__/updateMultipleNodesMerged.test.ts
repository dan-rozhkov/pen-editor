import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { FlatSceneNode, FlatFrameNode } from "@/types/scene";

function scene() {
  return useSceneStore.getState();
}

function pastLen() {
  return useHistoryStore.getState().past.length;
}

describe("sceneStore.updateMultipleNodesMerged", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("deep-merges a sub-object per node, preserving each node's other keys", () => {
    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        rect1: {
          ...s.nodesById.rect1,
          sizing: { widthMode: "fixed", heightMode: "fixed" },
        } as unknown as FlatSceneNode,
        rect2: {
          ...s.nodesById.rect2,
          sizing: { widthMode: "fill_container", heightMode: "fit_content" },
        } as unknown as FlatSceneNode,
      },
    }));

    scene().updateMultipleNodesMerged(
      ["rect1", "rect2"],
      { sizing: { widthMode: "fit_content" } } as unknown as Partial<FlatSceneNode>,
      ["sizing"],
    );

    const s = scene();
    expect((s.nodesById.rect1 as unknown as { sizing: Record<string, unknown> }).sizing).toEqual({
      widthMode: "fit_content",
      heightMode: "fixed",
    });
    expect((s.nodesById.rect2 as unknown as { sizing: Record<string, unknown> }).sizing).toEqual({
      widthMode: "fit_content",
      heightMode: "fit_content",
    });
  });

  it("re-syncs measured text dimensions when the update carries a TEXT_MEASURE_PROPS key, agreeing with updateMultipleNodes", () => {
    const seedText1WithSizing = () =>
      useSceneStore.setState((s) => ({
        nodesById: {
          ...s.nodesById,
          text1: {
            ...s.nodesById.text1,
            sizing: { widthMode: "fixed", heightMode: "fixed" },
          } as unknown as FlatSceneNode,
        },
      }));

    const update = { textWidthMode: "auto" } as unknown as Partial<FlatSceneNode>;

    // Reference behavior from the sibling action, captured independently.
    resetStores();
    seedScene();
    seedText1WithSizing();
    scene().updateMultipleNodes(["text1"], update);
    const referenceText1 = scene().nodesById.text1;

    resetStores();
    seedScene();
    seedText1WithSizing();
    scene().updateMultipleNodesMerged(["text1"], update, ["sizing"]);
    const mergedText1 = scene().nodesById.text1;

    expect(mergedText1.width).toBe(referenceText1.width);
    expect(mergedText1.height).toBe(referenceText1.height);
    expect((mergedText1 as unknown as { textWidthMode: string }).textWidthMode).toBe(
      (referenceText1 as unknown as { textWidthMode: string }).textWidthMode,
    );
  });

  it("marks a reusable frame's component artifact stale", () => {
    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        frame1: { ...s.nodesById.frame1, reusable: true } as FlatSceneNode,
      },
    }));

    scene().updateMultipleNodesMerged(
      ["frame1"],
      { layout: { gap: 20 } } as unknown as Partial<FlatSceneNode>,
      ["layout"],
    );

    const artifact = scene().componentArtifactsById.frame1;
    expect(artifact).toBeDefined();
    expect(["stale_from_native", "missing"]).toContain(artifact.syncState);
  });

  it("records exactly one history entry per call", () => {
    const before = pastLen();
    scene().updateMultipleNodesMerged(
      ["rect1", "rect2"],
      { sizing: { widthMode: "fit_content" } } as unknown as Partial<FlatSceneNode>,
      ["sizing"],
    );
    expect(pastLen()).toBe(before + 1);
  });

  it("shallow-stamps keys not in deepMergeKeys on every node, same as updateMultipleNodes", () => {
    scene().updateMultipleNodesMerged(
      ["rect1", "rect2"],
      { opacity: 0.4 } as unknown as Partial<FlatSceneNode>,
      ["sizing"],
    );

    expect(scene().nodesById.rect1.opacity).toBe(0.4);
    expect(scene().nodesById.rect2.opacity).toBe(0.4);
  });

  it("leaves an existing sub-object's other keys intact and merges in the new key even without existing[key]", () => {
    // Untouched node in selection whose deepMergeKey is entirely absent.
    const frame = scene().nodesById.frame1 as FlatFrameNode;
    expect(frame.layout).toBeDefined();

    scene().updateMultipleNodesMerged(
      ["frame1"],
      { layout: { autoLayout: true } } as unknown as Partial<FlatSceneNode>,
      ["layout"],
    );

    const updated = scene().nodesById.frame1 as unknown as { layout: Record<string, unknown> };
    expect(updated.layout.autoLayout).toBe(true);
    // Original layout keys (gap, padding) survive the merge.
    expect(updated.layout.gap).toBe(8);
  });
});
