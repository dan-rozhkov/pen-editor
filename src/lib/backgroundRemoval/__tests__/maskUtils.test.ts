import { describe, it, expect } from "vitest";
import {
  maskDimsFromTensor,
  maskToAlpha,
  assertImageSizeWithinLimit,
} from "@/lib/backgroundRemoval/maskUtils";
import { REMOVE_BG_MAX_DIMENSION } from "@/lib/backgroundRemoval/constants";

describe("maskDimsFromTensor", () => {
  it("accepts the canonical [1,1,H,W] shape", () => {
    expect(maskDimsFromTensor([1, 1, 1024, 1024])).toEqual({
      height: 1024,
      width: 1024,
    });
    expect(maskDimsFromTensor([1, 1, 320, 640])).toEqual({
      height: 320,
      width: 640,
    });
  });

  it("accepts squeezed [1,H,W] and [H,W] shapes", () => {
    expect(maskDimsFromTensor([1, 512, 256])).toEqual({ height: 512, width: 256 });
    expect(maskDimsFromTensor([512, 256])).toEqual({ height: 512, width: 256 });
  });

  it("rejects shapes with a non-1 batch/channel dim", () => {
    expect(() => maskDimsFromTensor([2, 1, 64, 64])).toThrow(/unexpected output shape/i);
    expect(() => maskDimsFromTensor([1, 3, 64, 64])).toThrow(/unexpected output shape/i);
  });

  it("rejects too-short, too-long, and non-positive shapes", () => {
    expect(() => maskDimsFromTensor([64])).toThrow(/unexpected output shape/i);
    expect(() => maskDimsFromTensor([1, 1, 1, 64, 64])).toThrow(/unexpected output shape/i);
    expect(() => maskDimsFromTensor([1, 1, 0, 64])).toThrow(/unexpected output shape/i);
    expect(() => maskDimsFromTensor([])).toThrow(/unexpected output shape/i);
  });
});

describe("maskToAlpha", () => {
  it("min-max stretches the mask to the 0-255 alpha range", () => {
    // 2x2 mask onto a 2x2 image: identity resample.
    const mask = new Float32Array([0, 0.25, 0.5, 1]);
    const alpha = maskToAlpha(mask, 2, 2, 2, 2);
    expect(Array.from(alpha)).toEqual([0, 64, 128, 255]);
  });

  it("stretches relative to the mask's own min/max (logit scale independent)", () => {
    const mask = new Float32Array([-4, 0, 4, 12]);
    const alpha = maskToAlpha(mask, 2, 2, 2, 2);
    expect(alpha[0]).toBe(0);
    expect(alpha[3]).toBe(255);
    expect(alpha[1]).toBe(Math.round((4 / 16) * 255));
  });

  it("treats a flat (degenerate) mask as fully opaque instead of NaN", () => {
    const mask = new Float32Array([0.7, 0.7, 0.7, 0.7]);
    const alpha = maskToAlpha(mask, 2, 2, 2, 2);
    expect(Array.from(alpha)).toEqual([255, 255, 255, 255]);
  });

  it("resamples nearest-neighbor when mask and image sizes differ", () => {
    // 2x2 mask (min 0, max 1) upsampled onto a 4x4 image: each mask cell
    // covers a 2x2 block of the image.
    const mask = new Float32Array([0, 1, 1, 0]);
    const alpha = maskToAlpha(mask, 2, 2, 4, 4);
    expect(alpha).toHaveLength(16);
    // top-left block ← mask[0,0]=0, top-right block ← mask[0,1]=1
    expect(alpha[0]).toBe(0);
    expect(alpha[1]).toBe(0);
    expect(alpha[2]).toBe(255);
    expect(alpha[3]).toBe(255);
    // bottom-left block ← mask[1,0]=1, bottom-right block ← mask[1,1]=0
    expect(alpha[12]).toBe(255);
    expect(alpha[15]).toBe(0);
  });
});

describe("assertImageSizeWithinLimit", () => {
  it("allows images up to the limit", () => {
    expect(() => assertImageSizeWithinLimit(1024, 768)).not.toThrow();
    expect(() =>
      assertImageSizeWithinLimit(REMOVE_BG_MAX_DIMENSION, REMOVE_BG_MAX_DIMENSION),
    ).not.toThrow();
  });

  it("rejects oversized images with a clear user-facing message", () => {
    expect(() => assertImageSizeWithinLimit(REMOVE_BG_MAX_DIMENSION + 1, 100)).toThrow(
      /too large/i,
    );
    expect(() => assertImageSizeWithinLimit(100, REMOVE_BG_MAX_DIMENSION + 1)).toThrow(
      /too large/i,
    );
  });
});
