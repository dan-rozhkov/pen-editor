import { describe, it, expect, beforeEach } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores } from "@/test/fixtures";
import { findNodeAtPoint } from "@/pixi/interaction/hitTesting";

// `pointToSegmentDistance` is module-private; we re-derive its expected
// behavior here through the public characterization cases. The pure-math
// cases below are checked against a local reference implementation that
// mirrors the source (hitTesting.ts:29-42).
function refPointToSegmentDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/**
 * Fixture scene (built via store setters, mirroring src/test/fixtures.ts):
 *
 *   frameA "Frame A" (0,0 200x200, no auto-layout)
 *     └─ rect1 "Rect 1" (10,10 50x50)
 *   frameB "Frame B" (300,0 100x100)
 *   rectTop "Rect Top" (150,150 100x100)   <- highest z-order, overlaps frameA corner
 */
function seedHitScene(): void {
  const frameA = {
    id: "frameA",
    type: "frame",
    name: "Frame A",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    fill: "#ffffff",
    layout: { autoLayout: false },
  } as unknown as FlatSceneNode;

  const rect1 = {
    id: "rect1",
    type: "rect",
    name: "Rect 1",
    x: 10,
    y: 10,
    width: 50,
    height: 50,
    fill: "#ff0000",
  } as unknown as FlatSceneNode;

  const frameB = {
    id: "frameB",
    type: "frame",
    name: "Frame B",
    x: 300,
    y: 0,
    width: 100,
    height: 100,
    fill: "#eeeeee",
    layout: { autoLayout: false },
  } as unknown as FlatSceneNode;

  const rectTop = {
    id: "rectTop",
    type: "rect",
    name: "Rect Top",
    x: 150,
    y: 150,
    width: 100,
    height: 100,
    fill: "#00ff00",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { frameA, rect1, frameB, rectTop },
    parentById: { frameA: null, rect1: "frameA", frameB: null, rectTop: null },
    childrenById: { frameA: ["rect1"], frameB: [], rectTop: [] },
    // rectTop added last -> highest z-order (walked first in reverse).
    rootIds: ["frameA", "frameB", "rectTop"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("pointToSegmentDistance (characterization via reference impl)", () => {
  it("returns 0 for a point on the segment", () => {
    expect(refPointToSegmentDistance(0, 5, 0, 0, 0, 10)).toBe(0);
  });

  it("returns perpendicular distance", () => {
    expect(refPointToSegmentDistance(5, 5, 0, 0, 0, 10)).toBe(5);
  });

  it("clamps to the endpoint when projection is off the segment", () => {
    expect(refPointToSegmentDistance(0, -5, 0, 0, 0, 10)).toBe(5);
  });
});

describe("findNodeAtPoint", () => {
  beforeEach(() => {
    resetStores();
    seedHitScene();
  });

  it("returns the top-level ancestor for a child hit when nothing is selected/entered", () => {
    // Point (20,20) is inside rect1 (abs 10,10 .. 60,60), which lives in frameA.
    expect(findNodeAtPoint(20, 20)).toBe("frameA");
  });

  it("returns the child directly with deepSelect", () => {
    expect(findNodeAtPoint(20, 20, { deepSelect: true })).toBe("rect1");
  });

  it("returns a selected child directly", () => {
    useSelectionStore.getState().select("rect1");
    expect(findNodeAtPoint(20, 20)).toBe("rect1");
  });

  it("hits a second root frame", () => {
    expect(findNodeAtPoint(350, 50)).toBe("frameB");
  });

  it("returns null when nothing is under the point", () => {
    expect(findNodeAtPoint(600, 600)).toBeNull();
  });

  it("returns the top-most root on overlap (roots walked in reverse z-order)", () => {
    // (160,160) is inside both frameA (0,0..200,200) and rectTop (150,150..250,250).
    // rectTop was added last -> wins.
    expect(findNodeAtPoint(160, 160)).toBe("rectTop");
  });

  it("never hits a node with visible:false", () => {
    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        rectTop: { ...s.nodesById.rectTop, visible: false } as FlatSceneNode,
      },
      _cachedTree: null,
    }));
    // With rectTop hidden, (160,160) now falls through to frameA.
    expect(findNodeAtPoint(160, 160)).toBe("frameA");
  });
});
