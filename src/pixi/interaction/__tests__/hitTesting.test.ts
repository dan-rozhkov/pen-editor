import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Container } from "pixi.js";
import type { FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { resetStores } from "@/test/fixtures";
import { findNodeAtPoint } from "@/pixi/interaction/hitTesting";
import { createPixiSync } from "@/pixi/pixiSync";
import * as instanceUtils from "@/utils/instanceUtils";

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

describe("auto-layout child z-order", () => {
  beforeEach(() => {
    resetStores();

    const autoFrame = {
      id: "autoFrame",
      type: "frame",
      name: "Auto Frame",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: "#ffffff",
      layout: { autoLayout: true, direction: "row" },
    } as unknown as FlatSceneNode;

    const absoluteFrame = {
      id: "absoluteFrame",
      type: "frame",
      name: "Absolute Frame",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: "#ff0000",
      absolutePosition: true,
      layout: { autoLayout: false },
    } as unknown as FlatSceneNode;

    const topRect = {
      id: "topRect",
      type: "rect",
      name: "Top Rect",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: "#00ff00",
    } as unknown as FlatSceneNode;

    useSceneStore.setState({
      nodesById: { autoFrame, absoluteFrame, topRect },
      parentById: {
        autoFrame: null,
        absoluteFrame: "autoFrame",
        topRect: "autoFrame",
      },
      // Bottom-to-top: the absolute frame is behind the regular child.
      childrenById: { autoFrame: ["absoluteFrame", "topRect"] },
      rootIds: ["autoFrame"],
      componentArtifactsById: {},
      _cachedTree: null,
    });
  });

  it("hits a regular child above an overlapping absolute-positioned frame", () => {
    expect(findNodeAtPoint(50, 50, { deepSelect: true })).toBe("topRect");
  });
});

/**
 * Fixture scene for scope-chain drill tests:
 *
 *   frameA (0,0 400x400)
 *     └─ frameB (50,50 200x200)
 *          ├─ c1 (10,10 50x50)   -> abs (60,60 .. 110,110)
 *          └─ c2 (100,10 50x50) -> abs (150,60 .. 200,110)
 *   frameC (500,0 100x100)
 *     └─ d1 (10,10 50x50)        -> abs (510,10 .. 560,60)
 */
function seedDrillScopeScene(): void {
  const frameA = {
    id: "frameA",
    type: "frame",
    name: "Frame A",
    x: 0,
    y: 0,
    width: 400,
    height: 400,
    fill: "#ffffff",
    layout: { autoLayout: false },
  } as unknown as FlatSceneNode;

  const frameB = {
    id: "frameB",
    type: "frame",
    name: "Frame B",
    x: 50,
    y: 50,
    width: 200,
    height: 200,
    fill: "#eeeeee",
    layout: { autoLayout: false },
  } as unknown as FlatSceneNode;

  const c1 = {
    id: "c1",
    type: "rect",
    name: "C1",
    x: 10,
    y: 10,
    width: 50,
    height: 50,
    fill: "#ff0000",
  } as unknown as FlatSceneNode;

  const c2 = {
    id: "c2",
    type: "rect",
    name: "C2",
    x: 100,
    y: 10,
    width: 50,
    height: 50,
    fill: "#0000ff",
  } as unknown as FlatSceneNode;

  const frameC = {
    id: "frameC",
    type: "frame",
    name: "Frame C",
    x: 500,
    y: 0,
    width: 100,
    height: 100,
    fill: "#dddddd",
    layout: { autoLayout: false },
  } as unknown as FlatSceneNode;

  const d1 = {
    id: "d1",
    type: "rect",
    name: "D1",
    x: 10,
    y: 10,
    width: 50,
    height: 50,
    fill: "#00ff00",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { frameA, frameB, c1, c2, frameC, d1 },
    parentById: {
      frameA: null,
      frameB: "frameA",
      c1: "frameB",
      c2: "frameB",
      frameC: null,
      d1: "frameC",
    },
    childrenById: {
      frameA: ["frameB"],
      frameB: ["c1", "c2"],
      c1: [],
      c2: [],
      frameC: ["d1"],
      d1: [],
    },
    rootIds: ["frameA", "frameC"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("scope-chain hit testing (Figma drill scope)", () => {
  // drill state: selection c1 (inside frameA > frameB)
  beforeEach(() => {
    resetStores();
    seedDrillScopeScene();
    useSelectionStore.getState().enterContainer("frameB");
    useSelectionStore.getState().select("c1");
  });

  it("click on a deep sibling selects the sibling, not the top-level frame", () => {
    // point inside c2 (absolute ~160,70) -> findNodeAtPoint -> "c2"
    expect(findNodeAtPoint(160, 70)).toBe("c2");
  });

  it("click on the selected node keeps it", () => {
    // point inside c1 -> "c1"
    expect(findNodeAtPoint(70, 70)).toBe("c1");
  });

  it("click inside the scope but not on any child of frameB selects frameB", () => {
    // point inside frameA within frameB's bounds but outside c1/c2 -> "frameB"
    expect(findNodeAtPoint(240, 240)).toBe("frameB");
  });

  it("click on another top-level frame pops the scope and clamps to it", () => {
    // point inside d1 (inside frameC) -> "frameC" (scope does not extend there)
    expect(findNodeAtPoint(520, 20)).toBe("frameC");
  });

  it("no drill state: clicks still clamp to the top-level frame", () => {
    resetStores();
    seedDrillScopeScene();
    // point inside c1 -> "frameA"
    expect(findNodeAtPoint(70, 70)).toBe("frameA");
  });
});

/**
 * A horizontal line (0,50 .. 100,50 in absolute coords) with an endCap
 * ("triangle") whose rendered tip reaches ~3x strokeWidth past (100,50), and
 * whose bare bbox has height 0 (a plain-bbox hit test would reject almost
 * every click, including one squarely on the cap).
 */
function seedCappedLineScene(): void {
  const line1 = {
    id: "line1",
    type: "line",
    name: "Line 1",
    x: 0,
    y: 50,
    width: 100,
    height: 0,
    points: [0, 0, 100, 0],
    stroke: "#000000",
    strokeWidth: 4,
    endCap: "triangle",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { line1 },
    parentById: { line1: null },
    childrenById: { line1: [] },
    rootIds: ["line1"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("line cap hit testing", () => {
  beforeEach(() => {
    resetStores();
    seedCappedLineScene();
  });

  it("selects the line when clicking on the segment body", () => {
    expect(findNodeAtPoint(50, 50)).toBe("line1");
  });

  it("selects the line when clicking on the rendered cap tip, beyond the raw bbox endpoint", () => {
    // triangle cap at strokeWidth=4 reaches ~3*4=12 past the (100,50) endpoint.
    expect(findNodeAtPoint(108, 50)).toBe("line1");
  });

  it("still returns null well outside the segment + cap tolerance", () => {
    expect(findNodeAtPoint(50, 200)).toBeNull();
  });
});

/**
 * Fixture scene for sibling-mask hit-testing (regression: a sibling masked
 * by `isMask` shouldn't be clickable outside the masker's shape):
 *
 *   frameA (0,0 200x200, no auto-layout)
 *     ├─ maskShape "Mask Shape" (isMask:true, 20,20 60x60) -> abs (20,20..80,80)
 *     └─ content   "Content"    (0,0 200x200, covers the whole frame)
 */
function seedMaskedHitScene(): void {
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

  const maskShape = {
    id: "maskShape",
    type: "rect",
    name: "Mask Shape",
    x: 20,
    y: 20,
    width: 60,
    height: 60,
    fill: "#000000",
    isMask: true,
  } as unknown as FlatSceneNode;

  const content = {
    id: "content",
    type: "rect",
    name: "Content",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    fill: "#ff0000",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { frameA, maskShape, content },
    parentById: { frameA: null, maskShape: "frameA", content: "frameA" },
    // Bottom-to-top: maskShape first, so it masks `content` above it.
    childrenById: { frameA: ["maskShape", "content"] },
    rootIds: ["frameA"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("hit testing respects sibling masks (isMask)", () => {
  beforeEach(() => {
    resetStores();
    seedMaskedHitScene();
  });

  it("hits the masked sibling inside the masker's bounds", () => {
    expect(findNodeAtPoint(50, 50, { deepSelect: true })).toBe("content");
  });

  it("falls through the masked sibling outside the masker's bounds, hitting the parent frame instead", () => {
    // (10,10) is inside `content`'s own 0..200 bbox but outside maskShape's
    // 20..80 clip region, and outside maskShape's own bbox too — nothing
    // clickable at this point except the frame itself.
    expect(findNodeAtPoint(10, 10, { deepSelect: true })).toBe("frameA");
  });

});

/**
 * Task 11: root-level pruning via the culling index (`getCullingIndex()`,
 * exposed by `createPixiSync`). These tests build a real pixiSync instance
 * so `getCullingIndex()` returns a live, populated index instead of `null`
 * (the "no index" case is already exercised by every test above — pixiSync
 * is never constructed there).
 */
describe("Task 11: hit-testing pruned by the culling index", () => {
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.();
    dispose = null;
    vi.restoreAllMocks();
  });

  it("returns identical results to the unpruned (no-index) behavior", () => {
    resetStores();
    seedHitScene();
    dispose = createPixiSync(new Container());

    expect(findNodeAtPoint(20, 20)).toBe("frameA");
    expect(findNodeAtPoint(20, 20, { deepSelect: true })).toBe("rect1");
    expect(findNodeAtPoint(350, 50)).toBe("frameB");
    expect(findNodeAtPoint(600, 600)).toBeNull();
    expect(findNodeAtPoint(160, 160)).toBe("rectTop");
  });

  it("still hits a line's rendered cap tip beyond its raw (degenerate-height) bbox", () => {
    // Regression guard for the tolerance-inflation requirement: the culling
    // index stores the line's raw bbox (height 0), but the cap tip at
    // (108,50) is only hit-testable via the line's own stroke-aware distance
    // check — line roots must never be pruned away.
    resetStores();
    seedCappedLineScene();
    dispose = createPixiSync(new Container());

    expect(findNodeAtPoint(50, 50)).toBe("line1"); // segment body
    expect(findNodeAtPoint(108, 50)).toBe("line1"); // cap tip, beyond raw bbox
    expect(findNodeAtPoint(50, 200)).toBeNull(); // well outside tolerance
  });

  it("never prunes connector roots, even while the index is stale mid-flush", () => {
    // pixiSync updates the culling index only on its (rAF-deferred) flush —
    // see `scheduleSceneUpdate`/`flushSceneUpdate`. A connector's endpoints
    // can move (e.g. its attached node dragged) and get written to the
    // store — and read by hit-testing via `useSceneStore.getState()` —
    // before that flush runs, so the index can be stale relative to the
    // connector's *current* position for a frame. Connector roots must
    // therefore always be traversed regardless of the (possibly stale)
    // candidates set.
    resetStores();
    const connector = {
      id: "conn1",
      type: "connector",
      name: "Connector 1",
      x: -5000,
      y: -5000,
      width: 10,
      height: 10,
      points: [0, 0, 10, 10],
      startConnection: { nodeId: "a", anchor: "right" },
      endConnection: { nodeId: "b", anchor: "left" },
      stroke: "#000000",
      strokeWidth: 2,
    } as unknown as FlatSceneNode;

    useSceneStore.setState({
      nodesById: { conn1: connector },
      parentById: { conn1: null },
      childrenById: { conn1: [] },
      rootIds: ["conn1"],
      componentArtifactsById: {},
      _cachedTree: null,
    });
    // Index is built (fullRebuild) synchronously here, from the far-away position.
    dispose = createPixiSync(new Container());

    // Move the connector to a new position — store update only, no flush yet
    // (pixiSync's scene subscription defers to requestAnimationFrame).
    useSceneStore.setState((s) => ({
      nodesById: {
        ...s.nodesById,
        conn1: { ...s.nodesById.conn1, x: 500, y: 500, points: [0, 0, 10, 10] } as FlatSceneNode,
      },
      _cachedTree: null,
    }));

    // The culling index still thinks conn1 lives at (-5000,-5000) — a point
    // query at its new position would NOT return conn1 as a candidate. It
    // must still be hit because connector roots are never pruned.
    expect(findNodeAtPoint(505, 505)).toBe("conn1");
  });

  it("prunes root subtrees whose indexed AABB misses the point", () => {
    resetStores();

    const nodesById: Record<string, FlatSceneNode> = {};
    const childrenById: Record<string, string[]> = {};
    const parentById: Record<string, string | null> = {};
    const rootIds: string[] = [];

    // Target frame first (lowest z-order -> visited LAST in the reverse
    // walk), so an unpruned traversal must visit every decoy before it.
    nodesById.target = {
      id: "target",
      type: "frame",
      name: "Target",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: "#ffffff",
      layout: { autoLayout: false },
    } as unknown as FlatSceneNode;
    childrenById.target = [];
    parentById.target = null;
    rootIds.push("target");

    // 50 decoy roots, far away from the target and from each other.
    for (let i = 0; i < 50; i++) {
      const id = `decoy${i}`;
      nodesById[id] = {
        id,
        type: "rect",
        name: id,
        x: 100_000 + i * 1_000,
        y: 100_000,
        width: 100,
        height: 100,
        fill: "#ff0000",
      } as unknown as FlatSceneNode;
      childrenById[id] = [];
      parentById[id] = null;
      rootIds.push(id);
    }

    useSceneStore.setState({
      nodesById,
      parentById,
      childrenById,
      rootIds,
      componentArtifactsById: {},
      _cachedTree: null,
    });
    dispose = createPixiSync(new Container());

    // Every visited root (frame/rect) reaches this call exactly once via
    // `getHitNodeEffectiveSize` — count invocations as a proxy for "roots
    // actually traversed".
    const spy = vi.spyOn(instanceUtils, "getPreparedNodeEffectiveSize");

    expect(findNodeAtPoint(50, 50)).toBe("target");

    // Unpruned, this would be 51 (50 decoys walked first in reverse z-order,
    // then the target). Pruned via the culling index, only "target" itself
    // should be visited.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never prunes a fit_content auto-layout frame root, whose live intrinsic size exceeds its stale stored bbox", () => {
    // Regression for a reviewer-found gap: `syncAutoLayout` applies a
    // fit_content frame's Yoga-computed intrinsic size only to the Pixi
    // container, never back to the store's width/height. The culling index
    // bboxes the frame from the stale stored size, but hit-testing
    // (`getPreparedNodeEffectiveSize` -> `prepareFrameNode` ->
    // `calculateFrameIntrinsicSize`) checks against the live intrinsic size.
    // A click inside the real rendered frame but outside the stale stored
    // bbox must still hit — the frame must never be pruned by the index.
    resetStores();

    // No children: the intrinsic width comes purely from `paddingRight`
    // (`calculateFrameIntrinsicSize`'s empty-children branch sums
    // padding-left + padding-right), so nothing OTHER than the frame's own
    // (stale, small) stored bbox is indexed — a child with its own
    // accurately-stored wide bbox would otherwise leak into the culling
    // index's ancestor-inclusion and mask the bug this test targets.
    const bigFrame = {
      id: "bigFrame",
      type: "frame",
      name: "Big Frame",
      x: 0,
      y: 0,
      // Stored width is deliberately much smaller than the live intrinsic
      // width (300, from paddingRight) computed below.
      width: 10,
      height: 50,
      fill: "#ffffff",
      layout: { autoLayout: true, flexDirection: "row", paddingRight: 300 },
      sizing: { widthMode: "fit_content" },
    } as unknown as FlatSceneNode;

    useSceneStore.setState({
      nodesById: { bigFrame },
      parentById: { bigFrame: null },
      childrenById: { bigFrame: [] },
      rootIds: ["bigFrame"],
      componentArtifactsById: {},
      _cachedTree: null,
    });
    dispose = createPixiSync(new Container());

    // (200, 20) is well outside the stale stored bbox (0,0..10,50) — the
    // culling index, built from the stored width, would not return
    // "bigFrame" as a candidate for this point — but it's inside the real
    // rendered (intrinsic-width) frame.
    expect(findNodeAtPoint(200, 20)).toBe("bigFrame");
  });
});
