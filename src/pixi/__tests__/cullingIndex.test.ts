import { describe, expect, it } from "vitest";
import { generatePerfScene } from "@/dev/perfScene";
import { createCullingIndex } from "../cullingIndex";
import { computeViewportRenderability } from "./legacyCullingOracle";

describe("cullingIndex", () => {
  it("queryVisible matches computeViewportRenderability's renderable set for unrotated scenes", () => {
    const scene = generatePerfScene(20, 30);
    const state = scene as never;
    const index = createCullingIndex();
    index.rebuild(state);
    const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 1200 };
    const legacy = computeViewportRenderability({ ...scene, bounds, margin: 0 });
    const legacyVisible = new Set([...legacy].filter(([, v]) => v).map(([id]) => id));
    expect(index.queryVisible(bounds)).toEqual(legacyVisible);
  });

  it("a rotated node is culled by its rotated AABB (legacy never culls it)", () => {
    const scene = generatePerfScene(1, 1);
    scene.nodesById["perf-0-0"] = { ...scene.nodesById["perf-0-0"], rotation: 45, x: 100000, y: 100000 };
    const index = createCullingIndex();
    index.rebuild(scene as never);
    expect(index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 }).has("perf-0-0")).toBe(false);
  });

  it("updateForChanged moves a node between cells", () => {
    const scene = generatePerfScene(2, 5);
    const index = createCullingIndex();
    index.rebuild(scene as never);
    const moved = { ...scene.nodesById["perf-0-0"], x: 50000 };
    const next = { ...scene, nodesById: { ...scene.nodesById, "perf-0-0": moved } };
    index.updateForChanged(next as never, new Set(["perf-0-0"]));
    expect(index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 }).has("perf-0-0")).toBe(false);
  });

  it("queryVisible includes the full ancestor chain of a hit", () => {
    const scene = generatePerfScene(1, 1);
    const index = createCullingIndex();
    index.rebuild(scene as never);
    const visible = index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 });
    expect(visible.has("perf-0-0")).toBe(true);
    expect(visible.has("perf-frame-0")).toBe(true);
  });

  it("a rotated, fully off-screen node hides its whole subtree (no per-descendant grid hits)", () => {
    const scene = generatePerfScene(1, 3);
    scene.nodesById["perf-frame-0"] = { ...scene.nodesById["perf-frame-0"], rotation: 45, x: 500000, y: 500000 };
    const index = createCullingIndex();
    index.rebuild(scene as never);
    const visible = index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 });
    expect(visible.has("perf-frame-0")).toBe(false);
    expect(visible.has("perf-0-0")).toBe(false);
    expect(visible.has("perf-0-1")).toBe(false);
    expect(visible.has("perf-0-2")).toBe(false);
  });

  it("a rotated node that IS on-screen makes its whole subtree visible, even though children are indexed nowhere", () => {
    const scene = generatePerfScene(1, 3);
    scene.nodesById["perf-frame-0"] = { ...scene.nodesById["perf-frame-0"], rotation: 45 };
    const index = createCullingIndex();
    index.rebuild(scene as never);
    const visible = index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 });
    expect(visible.has("perf-frame-0")).toBe(true);
    expect(visible.has("perf-0-0")).toBe(true);
    expect(visible.has("perf-0-1")).toBe(true);
    expect(visible.has("perf-0-2")).toBe(true);
  });

  it("removing a rotated ancestor's rotation re-indexes descendants individually (scroll-away-and-back doesn't leave them stuck)", () => {
    const scene = generatePerfScene(1, 1);
    scene.nodesById["perf-frame-0"] = { ...scene.nodesById["perf-frame-0"], rotation: 45, x: 500000, y: 500000 };
    const index = createCullingIndex();
    index.rebuild(scene as never);
    // Off-screen while rotated far away.
    expect(index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 }).has("perf-0-0")).toBe(false);

    // Un-rotate and move back on-screen.
    const restored = { ...scene.nodesById["perf-frame-0"], rotation: 0, x: 0, y: 0 };
    const next = { ...scene, nodesById: { ...scene.nodesById, "perf-frame-0": restored } };
    index.updateForChanged(next as never, new Set(["perf-frame-0"]));
    const visible = index.queryVisible({ minX: 0, minY: 0, maxX: 2000, maxY: 1200 });
    expect(visible.has("perf-frame-0")).toBe(true);
    expect(visible.has("perf-0-0")).toBe(true);
  });

  it("a nested-rotated descendant inflates the covering AABB beyond the naive (unrotated) box", () => {
    // rotParent (rotated 45°, at world origin) covers its subtree with a
    // single AABB. rotChild sits near rotParent's raw (unrotated) edge and
    // is itself rotated 45° — its true rotated footprint pokes further out
    // than its raw x/y/width/height rect would suggest. If the covering box
    // were built from rotChild's raw rect (the bug), the AABB would stop
    // short of this corner; accounting for rotChild's own rotation extends
    // it far enough to include this viewport.
    const nodesById = {
      rotParent: {
        id: "rotParent",
        type: "frame",
        name: "Rotated parent",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 45,
      },
      rotChild: {
        id: "rotChild",
        type: "rect",
        name: "Rotated child",
        x: 90,
        y: 90,
        width: 20,
        height: 20,
        rotation: 45,
      },
    };
    const state = {
      nodesById,
      parentById: { rotParent: null, rotChild: "rotParent" },
      childrenById: { rotParent: ["rotChild"], rotChild: [] },
      rootIds: ["rotParent"],
    } as never;

    const index = createCullingIndex();
    index.rebuild(state);

    // Intersects only the region the rotation-aware covering AABB pokes
    // into (~x:[-83.6,73.6], y:[0,157.3]) and NOT the naive unrotated-child
    // AABB (~x:[-77.8,77.8], y:[0,155.6]) — see the arithmetic in the task
    // report for the derivation.
    const protrudingCorner = { minX: -83, minY: 156, maxX: -80, maxY: 157 };
    expect(index.queryVisible(protrudingCorner).has("rotParent")).toBe(true);
  });

  // Regression: moveNode-to-root leaves the moved node's nodesById reference
  // unchanged; the fix lives in syncDiff.ts's root-membership diff, but this
  // asserts the actual consumer (cullingIndex.updateForChanged) picks up the
  // new position once that diff correctly includes the moved id.
  it("a node moved to root is reindexed at its new position", () => {
    const scene = generatePerfScene(2, 3);
    const movedId = "perf-0-1";
    const oldParentId = "perf-frame-0";
    const index = createCullingIndex();
    index.rebuild(scene as never);

    // Before the move: querying far outside the frame's origin misses it.
    expect(index.queryVisible({ minX: 90000, minY: 90000, maxX: 91000, maxY: 91000 }).has(movedId)).toBe(false);

    const parentById = { ...scene.parentById, [movedId]: null };
    const childrenById = {
      ...scene.childrenById,
      [oldParentId]: scene.childrenById[oldParentId].filter((id) => id !== movedId),
    };
    const rootIds = [...scene.rootIds, movedId];
    // Simulate moveNode: the moved node keeps its stored x/y (unrelated to
    // this test) but is now a root — relocate it far away so a query at its
    // new absolute position only hits if it was actually reindexed there.
    const movedNode = { ...scene.nodesById[movedId], x: 90000, y: 90000 };
    const nodesById = { ...scene.nodesById, [movedId]: movedNode };
    const next = { ...scene, nodesById, parentById, childrenById, rootIds };

    // Mirrors the fixed syncDiff output: the moved id (and its old parent,
    // whose childrenById entry changed) are in changedIds.
    index.updateForChanged(next as never, new Set([movedId, oldParentId]));

    const visible = index.queryVisible({ minX: 90000, minY: 90000, maxX: 91000, maxY: 91000 });
    expect(visible.has(movedId)).toBe(true);
  });

  // bug-19 mechanism 3: culling rects were built from node geometry only,
  // ignoring shadow/blur overhang — a node whose own rect is off-screen but
  // whose shadow/blur bleeds onto the viewport was wrongly hidden entirely.
  it("a node's drop-shadow overhang keeps it visible even when its own rect is just off-screen", () => {
    const nodesById = {
      root: { id: "root", type: "frame", name: "root", x: 0, y: 0, width: 100, height: 100 },
      shadowNode: {
        id: "shadowNode",
        type: "rect",
        name: "shadowed",
        x: 2010, // just past the 2000-wide viewport used below
        y: 0,
        width: 50,
        height: 50,
        effects: [
          { type: "shadow", shadowType: "outer", color: "#00000080", offset: { x: -30, y: 0 }, blur: 20, spread: 0 },
        ],
      },
    };
    const state = {
      nodesById,
      parentById: { root: null, shadowNode: "root" },
      childrenById: { root: ["shadowNode"], shadowNode: [] },
      rootIds: ["root"],
    } as never;

    const index = createCullingIndex();
    index.rebuild(state);
    const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 1200 };
    // Raw rect [2010,2060] is fully past maxX=2000 — without the margin fix
    // this node (and its shadow) would be culled. With margin
    // (|offset.x|=30 + blur=20 = 50), the effective rect starts at 2010-50=1960,
    // which intersects the viewport.
    expect(index.queryVisible(bounds).has("shadowNode")).toBe(true);
  });

  it("a node with no effects gets the same rect as before (unchanged)", () => {
    const nodesById = {
      root: { id: "root", type: "frame", name: "root", x: 0, y: 0, width: 100, height: 100 },
      plain: { id: "plain", type: "rect", name: "plain", x: 2010, y: 0, width: 50, height: 50 },
    };
    const state = {
      nodesById,
      parentById: { root: null, plain: "root" },
      childrenById: { root: ["plain"], plain: [] },
      rootIds: ["root"],
    } as never;

    const index = createCullingIndex();
    index.rebuild(state);
    const bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 1200 };
    // Fully off-screen, no effects — still culled.
    expect(index.queryVisible(bounds).has("plain")).toBe(false);
  });

  it("removed ids are dropped from the index", () => {
    const scene = generatePerfScene(1, 1);
    const index = createCullingIndex();
    index.rebuild(scene as never);
    const remainingNodes = { ...scene.nodesById };
    delete remainingNodes["perf-0-0"];
    const remainingChildren = { ...scene.childrenById, "perf-frame-0": [] };
    const next = { ...scene, nodesById: remainingNodes, childrenById: remainingChildren };
    index.updateForChanged(next as never, new Set(["perf-0-0"]));
    expect(index.queryVisible({ minX: -100000, minY: -100000, maxX: 100000, maxY: 100000 }).has("perf-0-0")).toBe(false);
  });
});
