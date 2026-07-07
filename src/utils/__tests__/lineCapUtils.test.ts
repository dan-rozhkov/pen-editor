import { describe, it, expect } from "vitest";
import { buildCapPrimitive, capTrimLength } from "@/utils/lineCapUtils";

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
});
