import { describe, it, expect } from "vitest";
import {
  buildCapMarkerDef,
  buildCapPrimitive,
  capPrimitiveBounds,
  capTrimLength,
} from "@/utils/lineCapUtils";

describe("buildCapPrimitive", () => {
  it("returns null for 'none'", () => {
    expect(buildCapPrimitive("none", 2)).toBeNull();
  });

  it("builds an open chevron for 'arrow'", () => {
    const prim = buildCapPrimitive("arrow", 2);
    expect(prim?.kind).toBe("lines");
    if (prim?.kind === "lines") {
      expect(prim.segments).toHaveLength(2);
      // Every segment starts at the local origin (the endpoint).
      for (const [x1, y1] of prim.segments) {
        expect(x1).toBe(0);
        expect(y1).toBe(0);
      }
    }
  });

  it("builds a filled triangle for 'triangle' with the tip at the origin", () => {
    const prim = buildCapPrimitive("triangle", 4);
    expect(prim?.kind).toBe("polygon");
    if (prim?.kind === "polygon") {
      expect(prim.points[0]).toBe(0);
      expect(prim.points[1]).toBe(0);
      expect(prim.points).toHaveLength(6);
    }
  });

  it("builds a circle for 'circle' offset backward from the origin", () => {
    const prim = buildCapPrimitive("circle", 3);
    expect(prim?.kind).toBe("circle");
    if (prim?.kind === "circle") {
      expect(prim.cx).toBeLessThan(0);
      expect(prim.radius).toBeGreaterThan(0);
    }
  });

  it("builds a perpendicular bar for 'bar'", () => {
    const prim = buildCapPrimitive("bar", 2);
    expect(prim?.kind).toBe("lines");
    if (prim?.kind === "lines") {
      const [x1, y1, x2, y2] = prim.segments[0];
      expect(x1).toBe(0);
      expect(x2).toBe(0);
      expect(y1).toBeLessThan(0);
      expect(y2).toBeGreaterThan(0);
    }
  });

  it("scales geometry with strokeWidth", () => {
    const thin = buildCapPrimitive("triangle", 1);
    const thick = buildCapPrimitive("triangle", 5);
    if (thin?.kind === "polygon" && thick?.kind === "polygon") {
      expect(Math.abs(thick.points[2])).toBeGreaterThan(Math.abs(thin.points[2]));
    }
  });
});

describe("capTrimLength", () => {
  it("is zero for open/no caps", () => {
    expect(capTrimLength("none", 2)).toBe(0);
    expect(capTrimLength("arrow", 2)).toBe(0);
    expect(capTrimLength("bar", 2)).toBe(0);
  });

  it("is positive for solid caps that would otherwise be pierced by the line", () => {
    expect(capTrimLength("triangle", 2)).toBeGreaterThan(0);
    expect(capTrimLength("circle", 2)).toBeGreaterThan(0);
  });

  it("stays derived from (never drifts from) buildCapPrimitive's own geometry", () => {
    for (const strokeWidth of [1, 2, 5]) {
      const triangle = buildCapPrimitive("triangle", strokeWidth);
      const circle = buildCapPrimitive("circle", strokeWidth);
      if (triangle?.kind === "polygon") {
        expect(capTrimLength("triangle", strokeWidth)).toBe(-Math.min(...triangle.points.filter((_, i) => i % 2 === 0)));
      }
      if (circle?.kind === "circle") {
        expect(capTrimLength("circle", strokeWidth)).toBe(circle.radius - circle.cx);
      }
    }
  });
});

describe("capPrimitiveBounds", () => {
  it("pads 'lines'-kind (stroked) primitives by half the stroke width", () => {
    const strokeWidth = 4;
    const primitive = buildCapPrimitive("bar", strokeWidth)!;
    const unpadded = capPrimitiveBounds(primitive, 0);
    const padded = capPrimitiveBounds(primitive, strokeWidth);
    expect(padded.width).toBeGreaterThan(unpadded.width);
    expect(padded.height).toBe(unpadded.height + strokeWidth);
  });

  it("never reports a zero-size box for the 'bar' cap (would suppress marker rendering)", () => {
    const primitive = buildCapPrimitive("bar", 3)!;
    const bounds = capPrimitiveBounds(primitive, 3);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it("does not pad filled ('polygon'/'circle') primitives", () => {
    const strokeWidth = 4;
    const triangle = buildCapPrimitive("triangle", strokeWidth)!;
    expect(capPrimitiveBounds(triangle, 0)).toEqual(capPrimitiveBounds(triangle, strokeWidth));
  });
});

describe("buildCapMarkerDef", () => {
  it("returns null for 'none'", () => {
    expect(buildCapMarkerDef("m1", "none", 2, "#000", "auto")).toBeNull();
  });

  it("anchors refX/refY at 0,0 (the primitive tip), in viewBox coordinates", () => {
    const def = buildCapMarkerDef("m1", "triangle", 4, "#000", "auto")!;
    expect(def).toMatch(/refX="0"/);
    expect(def).toMatch(/refY="0"/);
  });

  it("produces a non-zero-size marker for the 'bar' cap", () => {
    const def = buildCapMarkerDef("m1", "bar", 4, "#000", "auto")!;
    const widthMatch = def.match(/markerWidth="([^"]+)"/);
    const heightMatch = def.match(/markerHeight="([^"]+)"/);
    expect(Number(widthMatch?.[1])).toBeGreaterThan(0);
    expect(Number(heightMatch?.[1])).toBeGreaterThan(0);
  });

  it("is overflow-visible so a stroke-padded viewBox isn't clipped", () => {
    const def = buildCapMarkerDef("m1", "arrow", 4, "#000", "auto")!;
    expect(def).toMatch(/overflow="visible"/);
  });
});
