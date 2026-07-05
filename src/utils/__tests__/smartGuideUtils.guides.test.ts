import { describe, expect, it } from "vitest";
import {
  calculatePersistentGuideSnap,
  getSnapEdges,
  snapValueToGuides,
  snapResizeEdge,
} from "@/utils/smartGuideUtils";
import type { Guide } from "@/store/guidesStore";

describe("calculatePersistentGuideSnap", () => {
  const guides: Guide[] = [
    { id: "v1", orientation: "vertical", position: 100 },
    { id: "h1", orientation: "horizontal", position: 50 },
  ];

  it("snaps the dragged left edge to a nearby vertical guide", () => {
    // left=98, within threshold 5 of the guide at x=100
    const edges = getSnapEdges(98, 0, 40, 40);
    const result = calculatePersistentGuideSnap(edges, guides, 5);
    expect(result.deltaX).toBe(2); // 100 - 98
    expect(result.deltaY).toBe(0);
  });

  it("snaps the dragged top edge to a nearby horizontal guide", () => {
    const edges = getSnapEdges(0, 46, 40, 40);
    const result = calculatePersistentGuideSnap(edges, guides, 5);
    expect(result.deltaY).toBe(4); // 50 - 46
    expect(result.deltaX).toBe(0);
  });

  it("does not snap when nothing is within threshold", () => {
    const edges = getSnapEdges(0, 0, 10, 10);
    const result = calculatePersistentGuideSnap(edges, guides, 5);
    expect(result.deltaX).toBe(0);
    expect(result.deltaY).toBe(0);
  });

  it("snaps the closest edge/guide pair among several candidates", () => {
    // right edge (left+width = 0+40=40) is far from guide@100; centerX (20) is
    // also far. Move left so that centerX (position + 20) is close to 100.
    const edges = getSnapEdges(78, 0, 44, 0); // centerX = 78+22=100
    const result = calculatePersistentGuideSnap(edges, guides, 5);
    expect(result.deltaX).toBe(0); // already exactly on the guide
  });

  it("returns no snap for an empty guide list", () => {
    const edges = getSnapEdges(100, 50, 10, 10);
    const result = calculatePersistentGuideSnap(edges, [], 5);
    expect(result).toEqual({ deltaX: 0, deltaY: 0 });
  });
});

describe("snapValueToGuides", () => {
  const guides: Guide[] = [
    { id: "v1", orientation: "vertical", position: 100 },
    { id: "v2", orientation: "vertical", position: 200 },
    { id: "h1", orientation: "horizontal", position: 50 },
  ];

  it("snaps to the nearest guide on the matching axis within threshold", () => {
    expect(snapValueToGuides(103, "vertical", guides, 5)).toBe(100);
    expect(snapValueToGuides(197, "vertical", guides, 5)).toBe(200);
  });

  it("ignores guides on the other axis", () => {
    expect(snapValueToGuides(100, "horizontal", guides, 5)).toBe(100); // no horizontal guide near 100
  });

  it("returns the original value when nothing is close enough", () => {
    expect(snapValueToGuides(150, "vertical", guides, 5)).toBe(150);
  });

  it("picks the closest guide when multiple are within threshold", () => {
    // Exactly between two verticals isn't possible here, but ensure nearest wins
    expect(snapValueToGuides(101, "vertical", guides, 60)).toBe(100);
    expect(snapValueToGuides(199, "vertical", guides, 60)).toBe(200);
  });
});

describe("snapResizeEdge", () => {
  const guides: Guide[] = [
    { id: "v1", orientation: "vertical", position: 100 },
    { id: "h1", orientation: "horizontal", position: 60 },
  ];

  it("does nothing when the axis is not resizing (edge = null)", () => {
    expect(snapResizeEdge(null, 80, 40, "vertical", guides, 5, 5)).toEqual({
      posDelta: 0,
      size: 40,
    });
  });

  it("far edge: grows size to reach a nearby guide, position unchanged", () => {
    // near=70, size=28 → far=98, guide at 100 within threshold 5.
    expect(snapResizeEdge("far", 70, 28, "vertical", guides, 5, 5)).toEqual({
      posDelta: 0,
      size: 30, // 28 + (100 - 98)
    });
  });

  it("far edge: clamps the snapped size to minSize", () => {
    // near=98, size=1 → far=99, snaps to 100 (+1) → 2, but minSize 5 wins.
    expect(snapResizeEdge("far", 98, 1, "vertical", guides, 5, 5)).toEqual({
      posDelta: 0,
      size: 5,
    });
  });

  it("near edge: shifts position and shrinks size to reach the guide", () => {
    // near=97, guide at 100 → delta +3, size 40 - 3 = 37 (>= minSize).
    expect(snapResizeEdge("near", 97, 40, "vertical", guides, 5, 5)).toEqual({
      posDelta: 3,
      size: 37,
    });
  });

  it("near edge: rejects the snap when it would push size below minSize", () => {
    // near=97, guide 100 → delta +3, size 6 - 3 = 3 < minSize 5 → no change.
    expect(snapResizeEdge("near", 97, 6, "vertical", guides, 5, 5)).toEqual({
      posDelta: 0,
      size: 6,
    });
  });

  it("uses the matching axis only (horizontal guide for a horizontal edge)", () => {
    expect(snapResizeEdge("far", 40, 18, "horizontal", guides, 5, 5)).toEqual({
      posDelta: 0,
      size: 20, // far=58 snaps to 60
    });
    // vertical guide at 100 is ignored on the horizontal axis
    expect(snapResizeEdge("far", 40, 58, "horizontal", guides, 5, 5)).toEqual({
      posDelta: 0,
      size: 58,
    });
  });
});
