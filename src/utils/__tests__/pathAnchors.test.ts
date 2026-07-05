import { describe, it, expect } from "vitest";
import {
  anchorsToSVGPath,
  computeAnchorsBBox,
  svgPathToAnchors,
  mirrorHandle,
  moveAnchorPoint,
  moveHandlePoint,
  appendAnchorPoint,
  closeContourPoints,
  applyAnchorEditToNode,
  type PathAnchor,
} from "../pathAnchors";
import type { PathNode } from "@/types/scene";

describe("mirrorHandle", () => {
  it("reflects a handle through the anchor point", () => {
    expect(mirrorHandle({ x: 10, y: 10 }, { x: 20, y: 10 })).toEqual({ x: 0, y: 10 });
    expect(mirrorHandle({ x: 0, y: 0 }, { x: 5, y: -5 })).toEqual({ x: -5, y: 5 });
  });
});

describe("anchorsToSVGPath", () => {
  it("returns empty string for no points", () => {
    expect(anchorsToSVGPath([], false)).toBe("");
  });

  it("builds a straight-line polyline for corner anchors (no handles)", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(anchorsToSVGPath(points, false)).toBe("M0,0 L10,0 L10,10");
  });

  it("closes the contour with Z when closed=true", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(anchorsToSVGPath(points, true)).toBe("M0,0 L10,0 L10,10 L0,0 Z");
  });

  it("emits a cubic segment when a handle is present", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0, handleOut: { x: 5, y: 0 } },
      { x: 10, y: 0, handleIn: { x: 8, y: 5 } },
    ];
    expect(anchorsToSVGPath(points, false)).toBe("M0,0 C5,0 8,5 10,0");
  });
});

describe("svgPathToAnchors", () => {
  it("parses a simple polyline (M/L)", () => {
    const parsed = svgPathToAnchors("M0,0 L10,0 L10,10");
    expect(parsed).not.toBeNull();
    expect(parsed!.closed).toBe(false);
    expect(parsed!.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("parses a cubic path and recovers handles", () => {
    const parsed = svgPathToAnchors("M0,0 C5,0 8,5 10,0");
    expect(parsed).not.toBeNull();
    expect(parsed!.points[0]).toMatchObject({ x: 0, y: 0, handleOut: { x: 5, y: 0 } });
    expect(parsed!.points[1]).toMatchObject({ x: 10, y: 0, handleIn: { x: 8, y: 5 } });
  });

  it("detects a closed contour (Z)", () => {
    const parsed = svgPathToAnchors("M0,0 L10,0 L10,10 Z");
    expect(parsed).not.toBeNull();
    expect(parsed!.closed).toBe(true);
    // trailing duplicate of the start point should not be present
    expect(parsed!.points).toHaveLength(3);
  });

  it("round-trips through anchorsToSVGPath for a corner polyline", () => {
    const original: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const d = anchorsToSVGPath(original, false);
    const parsed = svgPathToAnchors(d);
    expect(parsed!.points).toEqual(original);
  });

  it("returns null for compound paths (multiple subpaths)", () => {
    expect(svgPathToAnchors("M0,0 L10,0 M20,20 L30,30")).toBeNull();
  });

  it("returns null for arc commands (out of scope)", () => {
    expect(svgPathToAnchors("M0,0 A5,5 0 0 1 10,10")).toBeNull();
  });
});

describe("computeAnchorsBBox", () => {
  it("computes bbox of straight segments", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: -5, y: 20 },
    ];
    expect(computeAnchorsBBox(points, false)).toEqual({ x: -5, y: 0, width: 15, height: 20 });
  });

  it("accounts for curve extrema beyond the anchor points", () => {
    // A curve that bulges well outside the x-range of its endpoints.
    const points: PathAnchor[] = [
      { x: 0, y: 0, handleOut: { x: 0, y: 50 } },
      { x: 10, y: 0, handleIn: { x: 10, y: 50 } },
    ];
    const bbox = computeAnchorsBBox(points, false);
    // Endpoints only span y in [0,0]; the curve should bulge downward well past that.
    expect(bbox.height).toBeGreaterThan(10);
  });
});

describe("moveAnchorPoint", () => {
  it("moves the anchor and its handles by the same delta", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0, handleOut: { x: 5, y: 0 } },
      { x: 10, y: 0, handleIn: { x: 8, y: 0 } },
    ];
    const next = moveAnchorPoint(points, 0, 2, 3);
    expect(next[0]).toEqual({ x: 2, y: 3, handleOut: { x: 7, y: 3 } });
    // Other anchors are untouched
    expect(next[1]).toEqual(points[1]);
  });
});

describe("moveHandlePoint", () => {
  it("mirrors the opposite handle by default (symmetric)", () => {
    const points: PathAnchor[] = [{ x: 10, y: 10 }];
    const next = moveHandlePoint(points, 0, "out", { x: 20, y: 10 }, false);
    expect(next[0].handleOut).toEqual({ x: 20, y: 10 });
    expect(next[0].handleIn).toEqual({ x: 0, y: 10 });
  });

  it("breaks symmetry when requested, leaving the opposite handle untouched", () => {
    const points: PathAnchor[] = [
      { x: 10, y: 10, handleIn: { x: 0, y: 10 } },
    ];
    const next = moveHandlePoint(points, 0, "out", { x: 20, y: 15 }, true);
    expect(next[0].handleOut).toEqual({ x: 20, y: 15 });
    expect(next[0].handleIn).toEqual({ x: 0, y: 10 });
  });
});

describe("appendAnchorPoint", () => {
  it("appends a new anchor to the end", () => {
    const points: PathAnchor[] = [{ x: 0, y: 0 }];
    const next = appendAnchorPoint(points, { x: 10, y: 10 });
    expect(next).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    expect(next).not.toBe(points);
  });
});

describe("closeContourPoints", () => {
  it("marks the contour closed", () => {
    const points: PathAnchor[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const result = closeContourPoints(points);
    expect(result.closed).toBe(true);
    expect(result.points).toHaveLength(3);
  });

  it("drops a trailing duplicate of the start anchor", () => {
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ];
    const result = closeContourPoints(points);
    expect(result.points).toHaveLength(2);
  });
});

describe("applyAnchorEditToNode", () => {
  it("recomputes geometry/bounds and keeps the node's existing scale factor", () => {
    const node: PathNode = {
      id: "p1",
      type: "path",
      name: "Path",
      x: 100,
      y: 100,
      width: 20,
      height: 10,
      geometry: "M0,0 L10,0 L10,5 L0,5 Z",
      geometryBounds: { x: 0, y: 0, width: 10, height: 5 },
    };
    const points: PathAnchor[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 5 },
      { x: 0, y: 5 },
    ];
    const updates = applyAnchorEditToNode(node, points, true);
    // Node had scaleX = width/gbWidth = 20/10 = 2, scaleY = 10/5 = 2
    expect(updates.geometryBounds).toEqual({ x: 0, y: 0, width: 20, height: 5 });
    expect(updates.width).toBe(40); // 20 * scaleX(2)
    expect(updates.height).toBe(10); // 5 * scaleY(2)
    expect(updates.x).toBe(100); // bbox.x unchanged (0 -> 0)
    expect(updates.y).toBe(100);
    expect(updates.points).toEqual(points);
    expect(updates.closed).toBe(true);
  });
});
