import { describe, it, expect } from "vitest";
import { generatePolygonPoints, isStarRatio } from "@/utils/polygonUtils";

describe("isStarRatio", () => {
  it("is true for ratios in [0, 1)", () => {
    expect(isStarRatio(0)).toBe(true);
    expect(isStarRatio(0.5)).toBe(true);
    expect(isStarRatio(0.99)).toBe(true);
  });

  it("is false for undefined, 1, or out-of-range values", () => {
    expect(isStarRatio(undefined)).toBe(false);
    expect(isStarRatio(1)).toBe(false);
    expect(isStarRatio(-0.1)).toBe(false);
    expect(isStarRatio(1.5)).toBe(false);
    expect(isStarRatio(NaN)).toBe(false);
  });
});

describe("generatePolygonPoints", () => {
  it("generates a regular hexagon spanning exactly width/height", () => {
    const points = generatePolygonPoints(6, 100, 100);
    expect(points).toHaveLength(12);
    const xs = points.filter((_, i) => i % 2 === 0);
    const ys = points.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(100);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(100);
  });

  it("is unaffected by innerRadiusRatio === 1 (falls back to a regular polygon)", () => {
    const plain = generatePolygonPoints(5, 100, 100);
    const withRatioOne = generatePolygonPoints(5, 100, 100, 1);
    expect(withRatioOne).toEqual(plain);
  });

  it("generates a star with 2x vertices when innerRadiusRatio is set", () => {
    const points = generatePolygonPoints(5, 100, 100, 0.5);
    // 5 rays -> 10 vertices -> 20 numbers
    expect(points).toHaveLength(20);
  });

  it("star vertices alternate outer/inner radius (inner points sit closer to center)", () => {
    const size = 200;
    const points = generatePolygonPoints(5, size, size, 0.5);
    const cx = size / 2;
    const cy = size / 2;
    const dist = (i: number) =>
      Math.hypot(points[i * 2] - cx, points[i * 2 + 1] - cy);

    // Outer vertices (even index) should be farther from center than inner (odd index).
    for (let i = 0; i < 5; i++) {
      const outerDist = dist(i * 2);
      const innerDist = dist(i * 2 + 1);
      expect(outerDist).toBeGreaterThan(innerDist);
    }
  });

  it("star bounding box still spans exactly width/height", () => {
    const points = generatePolygonPoints(6, 120, 80, 0.4);
    const xs = points.filter((_, i) => i % 2 === 0);
    const ys = points.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(120);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(80);
  });
});
