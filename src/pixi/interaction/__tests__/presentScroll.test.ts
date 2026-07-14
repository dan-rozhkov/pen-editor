import { describe, expect, it } from "vitest";
import { clampPresentScrollY, computePresentScrollRange } from "@/pixi/interaction/presentScroll";

describe("computePresentScrollRange", () => {
  it("returns null when the scaled frame fits within the viewport (no scroll)", () => {
    // frame height 300 at scale 2 = 600 <= viewport height 1000
    expect(computePresentScrollRange(0, 300, 2, 1000)).toBeNull();
  });

  it("returns a range when the scaled frame is taller than the viewport", () => {
    // frame height 4000 at scale 2 = 8000 > viewport height 1000
    const range = computePresentScrollRange(0, 4000, 2, 1000);
    expect(range).not.toBeNull();
    expect(range!.maxY).toBeCloseTo(0, 5); // top-aligned (frame top at screen y=0)
    expect(range!.minY).toBeCloseTo(1000 - 8000, 5); // frame bottom at screen bottom
    expect(range!.minY).toBeLessThan(range!.maxY);
  });

  it("accounts for a non-zero frame top offset", () => {
    const range = computePresentScrollRange(50, 4000, 2, 1000);
    // maxY places world y=50 at screen y=0 -> maxY = -50*2 = -100
    expect(range!.maxY).toBeCloseTo(-100, 5);
  });
});

describe("clampPresentScrollY", () => {
  it("passes values already inside the range through unchanged", () => {
    const range = { minY: -7000, maxY: 0 };
    expect(clampPresentScrollY(-500, range)).toBe(-500);
  });

  it("clamps to maxY (top) when scrolling past the top", () => {
    const range = { minY: -7000, maxY: 0 };
    expect(clampPresentScrollY(500, range)).toBe(0);
  });

  it("clamps to minY (bottom) when scrolling past the bottom", () => {
    const range = { minY: -7000, maxY: 0 };
    expect(clampPresentScrollY(-8000, range)).toBe(-7000);
  });
});
