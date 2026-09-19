import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import type { PathNode } from "@/types/scene";
import { addDrawnNodeWithAutoParenting } from "../autoParentPlacement";

beforeEach(() => {
  resetStores();
});

function makePathNode(overrides: Partial<PathNode> & Pick<PathNode, "id" | "x" | "y" | "width" | "height">): PathNode {
  return {
    type: "path",
    name: "Vector",
    geometry: "M0,0 L1,1",
    ...overrides,
  } as PathNode;
}

describe("addDrawnNodeWithAutoParenting", () => {
  it("auto-parents into a containing frame using the caller's bbox when node.x/y match it", () => {
    seedScene(); // frame1 at (100,100) 400x300
    const node = makePathNode({ id: "n1", x: 150, y: 150, width: 40, height: 40 });
    const bbox = { x: 150, y: 150, width: 40, height: 40 };

    addDrawnNodeWithAutoParenting(node, bbox, node.id);

    const scene = useSceneStore.getState();
    expect(scene.parentById[node.id]).toBe("frame1");
    expect(scene.nodesById[node.id].x).toBe(50);
    expect(scene.nodesById[node.id].y).toBe(50);
  });

  // Finding 10 regression: a node whose baked x/y differ from the hit-test
  // bbox (e.g. `generate_vector`'s intra-SVG offset baked in by
  // `scaleAndOffsetNode`) must keep that offset when it lands inside a
  // frame, not have it silently discarded in favor of the bbox's own
  // top-left corner.
  it("preserves a node.x/y offset that differs from the hit-test bbox", () => {
    seedScene(); // frame1 at (100,100) 400x300
    // bbox is the target box used only to find which frame contains it;
    // node.x/y (already absolute) carries an extra +20,+20 baked offset the
    // bbox knows nothing about.
    const bbox = { x: 150, y: 150, width: 80, height: 80 };
    const node = makePathNode({ id: "n2", x: 170, y: 170, width: 40, height: 40 });

    addDrawnNodeWithAutoParenting(node, bbox, node.id);

    const scene = useSceneStore.getState();
    expect(scene.parentById[node.id]).toBe("frame1");
    // Relative to frame1's absolute origin (100,100): (170-100, 170-100).
    expect(scene.nodesById[node.id].x).toBe(70);
    expect(scene.nodesById[node.id].y).toBe(70);
  });

  it("adds as a root node when nothing contains the bbox", () => {
    seedScene();
    const node = makePathNode({ id: "n3", x: 900, y: 900, width: 10, height: 10 });
    const bbox = { x: 900, y: 900, width: 10, height: 10 };

    addDrawnNodeWithAutoParenting(node, bbox, node.id);

    const scene = useSceneStore.getState();
    expect(scene.parentById[node.id] ?? null).toBeNull();
    expect(scene.rootIds).toContain(node.id);
  });
});
