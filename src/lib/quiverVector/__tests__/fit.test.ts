import { describe, expect, it } from "vitest";
import { computeUniformFit } from "../fit";

describe("computeUniformFit", () => {
  it("anchors at the box's top-left corner", () => {
    const fit = computeUniformFit(80, 80, { x: 10, y: 20, width: 80, height: 80 });
    expect(fit.x).toBe(10);
    expect(fit.y).toBe(20);
  });

  it("scales uniformly (never stretches) into a non-square box", () => {
    // Finding 2 regression: the preview used to stretch non-uniformly to
    // fill `bounds.width x bounds.height` directly, while the commit path
    // always fit uniformly via Math.min. A 400x200 box around an 80x80
    // (square) drawing must produce a square result (min(400/80, 200/80) =
    // 2.5), not a 400x200 stretched one.
    const fit = computeUniformFit(80, 80, { x: 0, y: 0, width: 400, height: 200 });
    expect(fit.scale).toBeCloseTo(2.5, 5);
    expect(fit.width).toBeCloseTo(200, 5);
    expect(fit.height).toBeCloseTo(200, 5);
  });

  it("fits by the limiting axis when the intrinsic aspect ratio differs from the box's", () => {
    // A tall 40x100 intrinsic size into a 200x200 box: height is the
    // limiting axis (200/100=2 < 200/40=5), so scale=2, width=80.
    const fit = computeUniformFit(40, 100, { x: 0, y: 0, width: 200, height: 200 });
    expect(fit.scale).toBeCloseTo(2, 5);
    expect(fit.width).toBeCloseTo(80, 5);
    expect(fit.height).toBeCloseTo(200, 5);
  });

  it("falls back to scale 1 for a degenerate (zero/negative) intrinsic size", () => {
    const fit = computeUniformFit(0, 0, { x: 5, y: 5, width: 100, height: 100 });
    expect(fit.scale).toBe(1);
    expect(fit.width).toBe(0);
    expect(fit.height).toBe(0);
  });
});
