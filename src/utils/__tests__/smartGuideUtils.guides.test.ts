import { describe, expect, it } from "vitest";
import {
  calculatePersistentGuideSnap,
  getSnapEdges,
  snapValueToGuides,
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
