import { describe, it, expect } from "vitest";
import type { ImageAdjustments, ImageFill } from "@/types/scene";
import {
  DEFAULT_ADJUSTMENTS,
  clampAdjustments,
  isDefaultAdjustments,
  buildAdjustmentColorMatrix,
  adjustmentsToCssFilter,
} from "../imageAdjustments";

describe("DEFAULT_ADJUSTMENTS", () => {
  it("is all-zero (no visual change)", () => {
    expect(DEFAULT_ADJUSTMENTS).toEqual({
      brightness: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
    });
  });
});

describe("clampAdjustments", () => {
  it("fills in defaults for missing fields", () => {
    expect(clampAdjustments({ brightness: 20 })).toEqual({
      brightness: 20,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
    });
  });

  it("fills in defaults for an undefined input", () => {
    expect(clampAdjustments(undefined)).toEqual(DEFAULT_ADJUSTMENTS);
  });

  it("clamps values above 100 down to 100", () => {
    expect(clampAdjustments({ brightness: 500 }).brightness).toBe(100);
  });

  it("clamps values below -100 up to -100", () => {
    expect(clampAdjustments({ contrast: -500 }).contrast).toBe(-100);
  });

  it("passes through in-range values unchanged", () => {
    const partial: Partial<ImageAdjustments> = {
      brightness: 10,
      contrast: -25,
      saturation: 50,
      temperature: -10,
      tint: 15,
    };
    expect(clampAdjustments(partial)).toEqual(partial);
  });

  it("treats NaN/non-finite values as 0", () => {
    expect(clampAdjustments({ saturation: NaN }).saturation).toBe(0);
  });
});

describe("isDefaultAdjustments", () => {
  it("is true for undefined", () => {
    expect(isDefaultAdjustments(undefined)).toBe(true);
  });

  it("is true for the all-zero default object", () => {
    expect(isDefaultAdjustments(DEFAULT_ADJUSTMENTS)).toBe(true);
  });

  it("is false when any field is non-zero", () => {
    expect(isDefaultAdjustments({ ...DEFAULT_ADJUSTMENTS, tint: 1 })).toBe(false);
  });
});

describe("buildAdjustmentColorMatrix", () => {
  const IDENTITY = [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0,
  ];

  it("returns the identity matrix for default (no-op) adjustments", () => {
    expect(buildAdjustmentColorMatrix(DEFAULT_ADJUSTMENTS)).toEqual(IDENTITY);
  });

  it("returns a 20-length flat array", () => {
    const matrix = buildAdjustmentColorMatrix({ ...DEFAULT_ADJUSTMENTS, brightness: 40 });
    expect(matrix).toHaveLength(20);
  });

  it("keeps the alpha row/column as pure passthrough regardless of adjustments", () => {
    const matrix = buildAdjustmentColorMatrix({
      brightness: 30,
      contrast: -20,
      saturation: 60,
      temperature: -40,
      tint: 25,
    });
    // Row 3 (alpha out) = [0,0,0,1,0]
    expect(matrix.slice(15, 20)).toEqual([0, 0, 0, 1, 0]);
    // Column 3 (alpha in) contributes nothing to R/G/B out
    expect(matrix[3]).toBe(0);
    expect(matrix[8]).toBe(0);
    expect(matrix[13]).toBe(0);
  });

  it("positive brightness increases the additive offset on R/G/B", () => {
    const matrix = buildAdjustmentColorMatrix({ ...DEFAULT_ADJUSTMENTS, brightness: 100 });
    // Offsets are matrix[4], matrix[9], matrix[14] for R,G,B rows.
    expect(matrix[4]).toBeGreaterThan(0);
    expect(matrix[9]).toBeGreaterThan(0);
    expect(matrix[14]).toBeGreaterThan(0);
  });

  it("negative brightness decreases the additive offset on R/G/B", () => {
    const matrix = buildAdjustmentColorMatrix({ ...DEFAULT_ADJUSTMENTS, brightness: -100 });
    expect(matrix[4]).toBeLessThan(0);
    expect(matrix[9]).toBeLessThan(0);
    expect(matrix[14]).toBeLessThan(0);
  });

  it("full negative contrast collapses R/G/B scale toward a flat mid-gray", () => {
    const matrix = buildAdjustmentColorMatrix({ ...DEFAULT_ADJUSTMENTS, contrast: -100 });
    // factor = (100 + -100) / 100 = 0 -> diagonal terms go to 0, offset -> 0.5
    expect(matrix[0]).toBeCloseTo(0);
    expect(matrix[6]).toBeCloseTo(0);
    expect(matrix[12]).toBeCloseTo(0);
  });

  it("full negative saturation desaturates toward luma weights (grayscale)", () => {
    const matrix = buildAdjustmentColorMatrix({ ...DEFAULT_ADJUSTMENTS, saturation: -100 });
    // s = 0 -> every output channel = same luma-weighted mix of R,G,B.
    expect(matrix[0]).toBeCloseTo(matrix[5]);
    expect(matrix[1]).toBeCloseTo(matrix[6]);
    expect(matrix[2]).toBeCloseTo(matrix[7]);
    expect(matrix[0]).toBeCloseTo(matrix[10]);
  });

  it("positive temperature warms: increases the red offset and decreases the blue offset", () => {
    const matrix = buildAdjustmentColorMatrix({ ...DEFAULT_ADJUSTMENTS, temperature: 100 });
    expect(matrix[4]).toBeGreaterThan(0); // R offset
    expect(matrix[14]).toBeLessThan(0); // B offset
  });

  it("positive tint shifts toward magenta: decreases the green offset", () => {
    const matrix = buildAdjustmentColorMatrix({ ...DEFAULT_ADJUSTMENTS, tint: 100 });
    expect(matrix[9]).toBeLessThan(0); // G offset
  });

  it("composes multiple non-zero adjustments without throwing and stays a 20-length array", () => {
    const matrix = buildAdjustmentColorMatrix({
      brightness: 10,
      contrast: 15,
      saturation: -30,
      temperature: 20,
      tint: -10,
    });
    expect(matrix).toHaveLength(20);
    expect(matrix.every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe("adjustmentsToCssFilter", () => {
  it("returns undefined for default (or absent) adjustments", () => {
    expect(adjustmentsToCssFilter(undefined)).toBeUndefined();
    expect(adjustmentsToCssFilter(DEFAULT_ADJUSTMENTS)).toBeUndefined();
  });

  it("maps brightness/contrast/saturation to the matching CSS filter functions", () => {
    expect(
      adjustmentsToCssFilter({ brightness: 20, contrast: 0, saturation: 0, temperature: 0, tint: 0 }),
    ).toBe("brightness(1.2) contrast(1) saturate(1)");
    expect(
      adjustmentsToCssFilter({ brightness: 0, contrast: -50, saturation: 100, temperature: 0, tint: 0 }),
    ).toBe("brightness(1) contrast(0.5) saturate(2)");
  });

  it("ignores temperature/tint (no direct CSS filter equivalent) but still emits a filter", () => {
    const withTempOnly = adjustmentsToCssFilter({
      brightness: 0,
      contrast: 0,
      saturation: 0,
      temperature: 50,
      tint: 0,
    });
    // No brightness/contrast/saturation change, so temperature alone still
    // produces the identity filter string (documented simplification).
    expect(withTempOnly).toBe("brightness(1) contrast(1) saturate(1)");
  });
});

describe("ImageFill.adjustments is optional and backward-compatible", () => {
  it("an ImageFill without adjustments round-trips through JSON unchanged", () => {
    const fill: ImageFill = { url: "data:image/png;base64,abc", mode: "fill" };
    const roundTripped = JSON.parse(JSON.stringify(fill)) as ImageFill;
    expect(roundTripped.adjustments).toBeUndefined();
    expect(roundTripped).toEqual(fill);
  });

  it("an ImageFill with adjustments round-trips through JSON unchanged", () => {
    const fill: ImageFill = {
      url: "data:image/png;base64,abc",
      mode: "fill",
      adjustments: { brightness: 10, contrast: -5, saturation: 20, temperature: -15, tint: 5 },
    };
    const roundTripped = JSON.parse(JSON.stringify(fill)) as ImageFill;
    expect(roundTripped).toEqual(fill);
  });
});
