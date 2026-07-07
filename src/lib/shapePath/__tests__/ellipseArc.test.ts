import { describe, it, expect } from "vitest";
import { buildEllipseArcGeometry, hasCustomEllipseArc } from "@/lib/shapePath/ellipseArc";

describe("hasCustomEllipseArc", () => {
  it("is false for a plain full ellipse (defaults)", () => {
    expect(hasCustomEllipseArc({})).toBe(false);
    expect(hasCustomEllipseArc({ startAngle: 0, sweepAngle: 360, innerRadiusRatio: 0 })).toBe(false);
  });

  it("is true when startAngle, sweep, or ratio deviate from defaults", () => {
    expect(hasCustomEllipseArc({ startAngle: 10 })).toBe(true);
    expect(hasCustomEllipseArc({ sweepAngle: 180 })).toBe(true);
    expect(hasCustomEllipseArc({ innerRadiusRatio: 0.5 })).toBe(true);
  });

  it("treats innerRadiusRatio 1 as no hole (falls back to plain)", () => {
    expect(hasCustomEllipseArc({ innerRadiusRatio: 1 })).toBe(false);
  });
});

describe("buildEllipseArcGeometry", () => {
  it("returns no contours for a plain full ellipse", () => {
    const geo = buildEllipseArcGeometry(100, 100, {});
    expect(geo.isPlainEllipse).toBe(true);
    expect(geo.contours).toHaveLength(0);
  });

  it("builds a pie-slice contour (partial sweep, no hole) starting at the center", () => {
    const geo = buildEllipseArcGeometry(100, 100, { sweepAngle: 90 });
    expect(geo.isPlainEllipse).toBe(false);
    expect(geo.contours).toHaveLength(1);
    const [first] = geo.contours[0].points;
    expect(first.x).toBeCloseTo(50);
    expect(first.y).toBeCloseTo(50);
  });

  it("treats explicit ratio 0 + defaults as the plain-ellipse fast path", () => {
    const geo = buildEllipseArcGeometry(100, 100, { innerRadiusRatio: 0 });
    expect(geo.isPlainEllipse).toBe(true);
  });

  it("builds two opposite-wound contours for a full donut", () => {
    const geo = buildEllipseArcGeometry(100, 100, { innerRadiusRatio: 0.5 });
    expect(geo.contours).toHaveLength(2);
    const [outer, inner] = geo.contours;
    const cx = 50;
    const cy = 50;
    const outerDist = Math.hypot(outer.points[0].x - cx, outer.points[0].y - cy);
    const innerDist = Math.hypot(inner.points[0].x - cx, inner.points[0].y - cy);
    expect(outerDist).toBeGreaterThan(innerDist);
  });

  it("builds a single ring-segment contour for a partial-sweep donut", () => {
    const geo = buildEllipseArcGeometry(100, 100, { sweepAngle: 90, innerRadiusRatio: 0.5 });
    expect(geo.contours).toHaveLength(1);
  });

  it("clamps sweepAngle beyond [-360, 360]", () => {
    const over = buildEllipseArcGeometry(100, 100, { sweepAngle: 720, startAngle: 5 });
    const full = buildEllipseArcGeometry(100, 100, { sweepAngle: 360, startAngle: 5 });
    expect(over.contours[0].points.length).toBe(full.contours[0].points.length);
  });
});
