import { describe, it, expect, vi } from "vitest";
import { getTotalLength, getPointAtLength, getClosestPointOnPath, preparePath } from "../pathMeasure";
import * as pathAnchorsModule from "../pathAnchors";
import type { PathAnchor } from "../pathAnchors";

describe("getTotalLength", () => {
  it("returns 0 for a single point", () => {
    expect(getTotalLength([{ x: 0, y: 0 }], false)).toBe(0);
  });

  it("returns 0 for an empty path", () => {
    expect(getTotalLength([], false)).toBe(0);
  });

  it("measures a straight horizontal line exactly", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(getTotalLength(points, false)).toBeCloseTo(100, 3);
  });

  it("measures a straight diagonal line exactly (3-4-5 triangle)", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
    ];
    expect(getTotalLength(points, false)).toBeCloseTo(50, 2);
  });

  it("sums multiple straight segments", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(getTotalLength(points, false)).toBeCloseTo(20, 2);
  });

  it("adds the closing segment when closed=true", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    // Open: 10 + 10 = 20. Closed: + distance back to (0,0) = 10*sqrt(2).
    const open = getTotalLength(points, false);
    const closed = getTotalLength(points, true);
    expect(closed).toBeCloseTo(open + Math.sqrt(200), 1);
  });

  it("approximates a quarter-circle cubic bezier to within reference tolerance", () => {
    // Standard cubic bezier approximation of a quarter circle, radius 100,
    // centered at origin, from (100, 0) to (0, 100). Kappa ~= 0.5522847498.
    const r = 100;
    const k = 0.5522847498;
    const points: PathAnchor[] = [
      { x: r, y: 0, handleOut: { x: r, y: r * k } },
      { x: 0, y: r, handleIn: { x: r * k, y: r } },
    ];
    const length = getTotalLength(points, false);
    const reference = (Math.PI / 2) * r; // ~157.08
    expect(length).toBeCloseTo(reference, 0);
    expect(Math.abs(length - reference)).toBeLessThan(0.5);
  });
});

describe("getPointAtLength", () => {
  it("returns the start point at len=0 on a straight line", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const p = getPointAtLength(points, false, 0);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.angle).toBeCloseTo(0, 5);
  });

  it("returns the end point at len=total on a straight line", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const total = getTotalLength(points, false);
    const p = getPointAtLength(points, false, total);
    expect(p.x).toBeCloseTo(100, 3);
    expect(p.y).toBeCloseTo(0, 3);
  });

  it("returns the midpoint at len=total/2 on a straight diagonal line", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    const total = getTotalLength(points, false);
    const p = getPointAtLength(points, false, total / 2);
    expect(p.x).toBeCloseTo(50, 1);
    expect(p.y).toBeCloseTo(50, 1);
    expect(p.angle).toBeCloseTo(Math.PI / 4, 2);
  });

  it("clamps length below 0 to the start point", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const p = getPointAtLength(points, false, -50);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("clamps length beyond total to the end point", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const total = getTotalLength(points, false);
    const p = getPointAtLength(points, false, total + 1000);
    expect(p.x).toBeCloseTo(100, 3);
    expect(p.y).toBeCloseTo(0, 3);
  });

  it("computes a tangent-correct point on a quarter-circle cubic bezier", () => {
    const r = 100;
    const k = 0.5522847498;
    const points: PathAnchor[] = [
      { x: r, y: 0, handleOut: { x: r, y: r * k } },
      { x: 0, y: r, handleIn: { x: r * k, y: r } },
    ];
    const total = getTotalLength(points, false);
    // Midpoint along the arc (by length) should be close to the geometric
    // 45-degree point on a true circle of radius r: (r*cos45, r*sin45).
    const mid = getPointAtLength(points, false, total / 2);
    expect(mid.x).toBeCloseTo(r * Math.cos(Math.PI / 4), 0);
    expect(mid.y).toBeCloseTo(r * Math.sin(Math.PI / 4), 0);
    // Tangent at the very start of a circle arc going from (r,0) toward
    // (0,r) points in the +y direction (angle = PI/2).
    const start = getPointAtLength(points, false, 0);
    expect(start.angle).toBeCloseTo(Math.PI / 2, 1);
  });

  it("handles a closed contour's wraparound segment", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const total = getTotalLength(points, true);
    const end = getPointAtLength(points, true, total);
    // Wraps back to the start point.
    expect(end.x).toBeCloseTo(0, 3);
    expect(end.y).toBeCloseTo(0, 3);
  });

  it("returns a sane angle for a single-point path", () => {
    const p = getPointAtLength([{ x: 5, y: 5 }], false, 0);
    expect(p.x).toBe(5);
    expect(p.y).toBe(5);
    expect(p.angle).toBe(0);
  });
});

describe("getClosestPointOnPath", () => {
  it("finds the closest point on a straight horizontal line", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const res = getClosestPointOnPath(points, false, 40, 10);
    expect(res).not.toBeNull();
    expect(res!.x).toBeCloseTo(40, 1);
    expect(res!.y).toBeCloseTo(0, 1);
    expect(res!.length).toBeCloseTo(40, 1);
    expect(res!.distance).toBeCloseTo(10, 1);
  });

  it("clamps to the nearest endpoint when the query point projects outside the segment", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const res = getClosestPointOnPath(points, false, -50, 5);
    expect(res!.length).toBeCloseTo(0, 1);
    expect(res!.x).toBeCloseTo(0, 1);
  });

  it("finds a point on a circular closed path", () => {
    const r = 100;
    const k = 0.5522847498;
    const points = [
      { x: r, y: 0, handleOut: { x: r, y: r * k }, handleIn: { x: r, y: -r * k } },
      { x: 0, y: r, handleIn: { x: r * k, y: r }, handleOut: { x: -r * k, y: r } },
      { x: -r, y: 0, handleIn: { x: -r, y: r * k }, handleOut: { x: -r, y: -r * k } },
      { x: 0, y: -r, handleIn: { x: -r * k, y: -r }, handleOut: { x: r * k, y: -r } },
    ];
    // Query point far outside near the top of the circle (0, r).
    const res = getClosestPointOnPath(points, true, 0, r + 20);
    expect(res).not.toBeNull();
    expect(res!.x).toBeCloseTo(0, 0);
    expect(res!.y).toBeCloseTo(r, 0);
  });

  it("returns the single point for a one-anchor path", () => {
    const res = getClosestPointOnPath([{ x: 5, y: 5 }], false, 100, 100);
    expect(res).toEqual({ x: 5, y: 5, angle: 0, length: 0, distance: Math.hypot(95, 95) });
  });
});

describe("preparePath — LUT reuse (finding 3 regression)", () => {
  // `buildSegments` samples every segment via `cubicValue` (2 calls per
  // sample: one per axis) — the number of `cubicValue` calls is a direct
  // proxy for "did the segment LUT get rebuilt". A query that re-evaluates
  // the *exact* cubic at an interpolated `t` (not a re-sample) costs exactly
  // 2 `cubicValue` calls (x and y) regardless of the LUT's sample count.
  it("builds the LUT once and every subsequent getPointAtLength call costs exactly 2 cubicValue calls (no re-sampling)", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const spy = vi.spyOn(pathAnchorsModule, "cubicValue");
    spy.mockClear();

    const prepared = preparePath(points, false);
    const buildCallCount = spy.mock.calls.length;
    // Two straight segments, each sampled — real sampling work happened.
    expect(buildCallCount).toBeGreaterThan(0);

    spy.mockClear();
    const probeCount = 250;
    for (let i = 0; i < probeCount; i++) {
      prepared.getPointAtLength((i / probeCount) * prepared.totalLength);
    }

    // If each query rebuilt the LUT, this would be `probeCount * buildCallCount`
    // (tens of thousands of calls for 250 probes); reusing the prepared LUT
    // costs exactly 2 calls per query.
    expect(spy.mock.calls.length).toBe(probeCount * 2);
  });

  it("getClosestPointOnPath (the start-offset drag handle's hot path) does not rebuild the LUT per internal probe", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];

    // Cost of building this path's LUT exactly once, for comparison.
    let spy = vi.spyOn(pathAnchorsModule, "cubicValue");
    spy.mockClear();
    preparePath(points, false);
    const singleBuildCost = spy.mock.calls.length;
    expect(singleBuildCost).toBeGreaterThan(0);

    spy = vi.spyOn(pathAnchorsModule, "cubicValue");
    spy.mockClear();
    // `getClosestPointOnPath` probes ~200 coarse samples + a golden-section
    // refinement (~10s more) internally — dragging the start-offset handle
    // calls this once per pointermove.
    getClosestPointOnPath(points, false, 40, 10, 200);

    // Before the fix, each internal probe rebuilt the whole LUT from
    // scratch, so total cost would be on the order of
    // `~250 * singleBuildCost`. Reusing one `PreparedPath` for the whole
    // call keeps it to a small constant multiple of a single build.
    expect(spy.mock.calls.length).toBeLessThan(singleBuildCost * 5);
  });
});
