import { describe, it, expect } from "vitest";
import { applyConstraintAxis, computeConstrainedRect } from "../constraintsLayout";

describe("applyConstraintAxis", () => {
  const oldParentSize = 200;
  const newParentSize = 300; // parent grew by 100

  it("min (fixed to start edge): position and size stay put", () => {
    const result = applyConstraintAxis("min", { pos: 10, size: 50 }, oldParentSize, newParentSize);
    expect(result).toEqual({ pos: 10, size: 50 });
  });

  it("min is also the default when mode is undefined", () => {
    const result = applyConstraintAxis(undefined, { pos: 10, size: 50 }, oldParentSize, newParentSize);
    expect(result).toEqual({ pos: 10, size: 50 });
  });

  it("max (fixed to end edge): position shifts by the full delta, size stays put", () => {
    const result = applyConstraintAxis("max", { pos: 10, size: 50 }, oldParentSize, newParentSize);
    expect(result).toEqual({ pos: 110, size: 50 }); // 10 + (300-200)
  });

  it("center: keeps the offset from the parent's midpoint, size stays put", () => {
    // child center at 10+25=35, old parent mid=100 -> offset -65
    const result = applyConstraintAxis("center", { pos: 10, size: 50 }, oldParentSize, newParentSize);
    // new parent mid=150, new pos = 150 + (-65) - 25 = 60
    expect(result).toEqual({ pos: 60, size: 50 });
  });

  it("stretch: keeps both edge margins fixed, size grows/shrinks with the parent", () => {
    const result = applyConstraintAxis("stretch", { pos: 10, size: 50 }, oldParentSize, newParentSize);
    expect(result).toEqual({ pos: 10, size: 150 }); // 50 + (300-200)
  });

  it("stretch clamps to zero size when the parent shrinks past it", () => {
    const result = applyConstraintAxis("stretch", { pos: 10, size: 50 }, 200, 50);
    expect(result.size).toBe(0);
  });

  it("scale: position and size both scale proportionally", () => {
    const result = applyConstraintAxis("scale", { pos: 10, size: 50 }, oldParentSize, newParentSize);
    // scale factor = 300/200 = 1.5
    expect(result).toEqual({ pos: 15, size: 75 });
  });

  it("scale is a no-op when the old parent size is zero", () => {
    const result = applyConstraintAxis("scale", { pos: 10, size: 50 }, 0, 300);
    expect(result).toEqual({ pos: 10, size: 50 });
  });
});

describe("computeConstrainedRect", () => {
  it("combines independent horizontal/vertical modes", () => {
    const rect = computeConstrainedRect(
      { x: 10, y: 20, width: 100, height: 50 },
      { horizontal: "stretch", vertical: "max" },
      { width: 400, height: 300 },
      { width: 600, height: 500 },
    );
    // horizontal stretch: width += 200 -> 300, x unchanged
    // vertical max: y += 200 -> 220, height unchanged
    expect(rect).toEqual({ x: 10, y: 220, width: 300, height: 50 });
  });

  it("defaults to min/min (fixed) when constraints are unset", () => {
    const rect = computeConstrainedRect(
      { x: 10, y: 20, width: 100, height: 50 },
      undefined,
      { width: 400, height: 300 },
      { width: 600, height: 500 },
    );
    expect(rect).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });
});
