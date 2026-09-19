import { describe, expect, it } from "vitest";
import { computeRasterScale } from "../aiSvgPreviewLayer";

// Finding 4 regression: MAX_RASTER_PX (2048) must be a genuine cap on the
// rasterized canvas's pixel size, not just a factor multiplied by dpr
// afterward. Before the fix, `Math.min(1, MAX_RASTER_PX / max(w,h)) * dpr`
// let dpr push the result back over the cap: width=4000 on a 2x display gave
// scale=1.024 (min(1, 2048/4000)=0.512, *2), i.e. a 4096px canvas (~67MB)
// re-created on every finished element — the cap did nothing.
describe("computeRasterScale", () => {
  it("keeps small artwork crisp at high dpr (scale == dpr, unaffected by the cap)", () => {
    const scale = computeRasterScale(100, 100, 2);
    expect(scale).toBe(2);
  });

  it("caps large artwork so the final pixel size never exceeds MAX_RASTER_PX, even at high dpr", () => {
    const width = 4000;
    const height = 4000;
    const dpr = 2;
    const scale = computeRasterScale(width, height, dpr);
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);

    expect(pixelWidth).toBeLessThanOrEqual(2048);
    expect(pixelHeight).toBeLessThanOrEqual(2048);
    // Regression check: the old formula produced scale=1.024 (pixelWidth
    // 4096) for these exact inputs.
    expect(scale).toBeLessThan(1.024);
  });

  it("still respects the cap at dpr=1", () => {
    const scale = computeRasterScale(4000, 2000, 1);
    // Limiting dimension is width (4000): 2048/4000.
    expect(scale).toBeCloseTo(2048 / 4000, 5);
  });

  it("falls back to dpr=1 for a non-finite or non-positive devicePixelRatio", () => {
    expect(computeRasterScale(100, 100, 0)).toBe(1);
    expect(computeRasterScale(100, 100, NaN)).toBe(1);
    expect(computeRasterScale(100, 100, -2)).toBe(1);
  });
});
