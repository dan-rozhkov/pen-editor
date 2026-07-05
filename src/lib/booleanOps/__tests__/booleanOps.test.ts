import { describe, expect, it } from "vitest";
import type { EllipseNode, PolygonNode, RectNode } from "@/types/scene";
import { computeBooleanOp } from "../index";
import type { NodeTransform } from "../transform";

function rect(x: number, y: number, width: number, height: number, overrides: Partial<RectNode> = {}): RectNode {
  return { id: `rect-${x}-${y}`, type: "rect", x, y, width, height, ...overrides };
}

function ellipse(x: number, y: number, width: number, height: number): EllipseNode {
  return { id: `ellipse-${x}-${y}`, type: "ellipse", x, y, width, height };
}

function boundsOf(node: { x: number; y: number; width: number; height: number }): NodeTransform {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

/** Bounding box of an SVG path "d" made only of M/L/Z commands (as produced by polygonsToPath). */
function bboxOf(d: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]);
    maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]);
    maxY = Math.max(maxY, nums[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

describe("computeBooleanOp", () => {
  it("unions two non-overlapping rects into a bbox spanning both", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(20, 0, 10, 10);
    const result = computeBooleanOp("union", [
      { node: a, bounds: boundsOf(a) },
      { node: b, bounds: boundsOf(b) },
    ]);
    expect(result).not.toBeNull();
    expect(result!.bounds).toEqual({ x: 0, y: 0, width: 30, height: 10 });
    // Two disjoint rects -> two separate "M..Z" subpaths.
    expect(result!.geometry.match(/M/g)?.length).toBe(2);
  });

  it("unions two overlapping rects into a single merged outline", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 0, 10, 10);
    const result = computeBooleanOp("union", [
      { node: a, bounds: boundsOf(a) },
      { node: b, bounds: boundsOf(b) },
    ]);
    expect(result).not.toBeNull();
    expect(result!.bounds).toEqual({ x: 0, y: 0, width: 15, height: 10 });
    expect(result!.geometry.match(/M/g)?.length).toBe(1);
  });

  it("subtracts a fully-contained circle from a square, leaving a hole", () => {
    const square = rect(0, 0, 100, 100);
    const circle = ellipse(35, 35, 30, 30); // centered inside the square
    const result = computeBooleanOp("subtract", [
      { node: square, bounds: boundsOf(square) },
      { node: circle, bounds: boundsOf(circle) },
    ]);
    expect(result).not.toBeNull();
    // Exterior ring (the square) + one hole ring (the circle) -> 2 subpaths.
    expect(result!.geometry.match(/M/g)?.length).toBe(2);
    const box = bboxOf(result!.geometry);
    // Outer bbox should still match the square (the hole is interior).
    expect(box.minX).toBeCloseTo(0, 1);
    expect(box.minY).toBeCloseTo(0, 1);
    expect(box.maxX).toBeCloseTo(100, 1);
    expect(box.maxY).toBeCloseTo(100, 1);
  });

  it("subtracting an overlapping shape that fully covers the base returns null", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(-5, -5, 20, 20);
    const result = computeBooleanOp("subtract", [
      { node: a, bounds: boundsOf(a) },
      { node: b, bounds: boundsOf(b) },
    ]);
    expect(result).toBeNull();
  });

  it("intersects two overlapping rects into just the overlap region", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 0, 10, 10);
    const result = computeBooleanOp("intersect", [
      { node: a, bounds: boundsOf(a) },
      { node: b, bounds: boundsOf(b) },
    ]);
    expect(result).not.toBeNull();
    expect(result!.bounds).toEqual({ x: 5, y: 0, width: 5, height: 10 });
  });

  it("returns null when intersecting disjoint shapes", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(20, 0, 10, 10);
    const result = computeBooleanOp("intersect", [
      { node: a, bounds: boundsOf(a) },
      { node: b, bounds: boundsOf(b) },
    ]);
    expect(result).toBeNull();
  });

  it("excludes (xor) the overlap of two overlapping rects", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 0, 10, 10);
    const result = computeBooleanOp("exclude", [
      { node: a, bounds: boundsOf(a) },
      { node: b, bounds: boundsOf(b) },
    ]);
    expect(result).not.toBeNull();
    expect(result!.bounds).toEqual({ x: 0, y: 0, width: 15, height: 10 });
    // Overlap removed -> two disjoint pieces left and right of the middle.
    expect(result!.geometry.match(/M/g)?.length).toBe(2);
  });

  it("flatten behaves like union for a polygon + rect combo", () => {
    const tri: PolygonNode = { id: "tri", type: "polygon", x: 0, y: 0, width: 10, height: 10, points: [0, 10, 5, 0, 10, 10] };
    const square = rect(0, 0, 10, 10);
    const result = computeBooleanOp("flatten", [
      { node: square, bounds: boundsOf(square) },
      { node: tri, bounds: boundsOf(tri) },
    ]);
    expect(result).not.toBeNull();
    expect(result!.bounds).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it("handles a rounded rect combined with an ellipse", () => {
    const a = rect(0, 0, 40, 40, { cornerRadius: 8 });
    const b = ellipse(20, 20, 30, 30);
    const result = computeBooleanOp("union", [
      { node: a, bounds: boundsOf(a) },
      { node: b, bounds: boundsOf(b) },
    ]);
    expect(result).not.toBeNull();
    expect(result!.bounds.width).toBeGreaterThan(40);
  });

  it("supports a path node with a fillRule-independent evenodd hole (donut geometry)", () => {
    const donut = {
      id: "donut",
      type: "path" as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      geometry: "M0,50 A50,50 0 1 1 100,50 A50,50 0 1 1 0,50 Z M25,50 A25,25 0 1 1 75,50 A25,25 0 1 1 25,50 Z",
      geometryBounds: { x: 0, y: 0, width: 100, height: 100 },
    };
    const box: RectNode = rect(30, 30, 40, 40);
    const result = computeBooleanOp("union", [
      { node: donut, bounds: boundsOf(donut) },
      { node: box, bounds: boundsOf(box) },
    ]);
    expect(result).not.toBeNull();
  });
});
