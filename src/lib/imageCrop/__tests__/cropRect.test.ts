import { describe, it, expect } from "vitest";
import {
  FULL_CROP_RECT,
  clampCropRect,
  isFullCropRect,
  cropRectToPixels,
  coverPixelRect,
  containPixelRect,
  panCropRect,
  zoomCropRect,
  cropRectToBackgroundCss,
} from "@/lib/imageCrop/cropRect";

describe("clampCropRect", () => {
  it("passes through an already-valid rect unchanged", () => {
    const rect = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    expect(clampCropRect(rect)).toEqual(rect);
  });

  it("clamps negative x/y to 0", () => {
    expect(clampCropRect({ x: -0.5, y: -0.2, width: 0.5, height: 0.5 })).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
  });

  it("clamps width/height so the rect never exceeds the 0-1 source bounds", () => {
    expect(clampCropRect({ x: 0.8, y: 0.8, width: 0.5, height: 0.5 })).toEqual({
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    });
  });

  it("enforces a minimum size so the rect can't collapse to zero", () => {
    const result = clampCropRect({ x: 0, y: 0, width: 0, height: 0 });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("clamps width/height above 1 down to 1", () => {
    expect(clampCropRect({ x: 0, y: 0, width: 2, height: 3 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});

describe("isFullCropRect", () => {
  it("treats undefined as full", () => {
    expect(isFullCropRect(undefined)).toBe(true);
  });

  it("treats the identity rect as full", () => {
    expect(isFullCropRect(FULL_CROP_RECT)).toBe(true);
    expect(isFullCropRect({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  });

  it("treats a narrower rect as not full", () => {
    expect(isFullCropRect({ x: 0, y: 0, width: 0.5, height: 1 })).toBe(false);
  });
});

describe("cropRectToPixels", () => {
  it("maps the full rect to the entire source image", () => {
    expect(cropRectToPixels(undefined, 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("scales a normalized rect to source pixel coordinates", () => {
    expect(cropRectToPixels({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, 200, 100)).toEqual({
      x: 50,
      y: 50,
      width: 100,
      height: 25,
    });
  });

  it("clamps an out-of-range rect before converting to pixels", () => {
    expect(cropRectToPixels({ x: 0.9, y: 0, width: 0.5, height: 1 }, 200, 100)).toEqual({
      x: 100,
      y: 0,
      width: 100,
      height: 100,
    });
  });
});

describe("coverPixelRect", () => {
  it("returns the same rect when aspect ratios already match", () => {
    expect(coverPixelRect({ x: 0, y: 0, width: 200, height: 100 }, 400, 200)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it("crops the wider dimension to match a taller container aspect", () => {
    // 200x100 source (2:1) fit into a 1:1 container -> crop width to 100 (centered).
    const result = coverPixelRect({ x: 0, y: 0, width: 200, height: 100 }, 100, 100);
    expect(result).toEqual({ x: 50, y: 0, width: 100, height: 100 });
  });

  it("crops the taller dimension to match a wider container aspect, honoring a base offset", () => {
    const result = coverPixelRect({ x: 10, y: 10, width: 100, height: 200 }, 200, 100);
    expect(result).toEqual({ x: 10, y: 85, width: 100, height: 50 });
  });
});

describe("containPixelRect", () => {
  it("returns the same rect when aspect ratios already match", () => {
    expect(containPixelRect({ x: 0, y: 0, width: 200, height: 100 }, 400, 200)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it("pads the shorter dimension (opposite of coverPixelRect) to match a wider container aspect", () => {
    // 100x100 (1:1) source padded into a 200x100 (2:1) container -> pad width to 200 (centered).
    const result = containPixelRect({ x: 0, y: 0, width: 100, height: 100 }, 200, 100);
    expect(result).toEqual({ x: -50, y: 0, width: 200, height: 100 });
  });

  it("pads the shorter dimension to match a taller container aspect, honoring a base offset", () => {
    const result = containPixelRect({ x: 10, y: 10, width: 100, height: 100 }, 100, 200);
    expect(result).toEqual({ x: 10, y: -40, width: 100, height: 200 });
  });
});

describe("panCropRect", () => {
  it("shifts the rect by a normalized delta", () => {
    const result = panCropRect({ x: 0.2, y: 0.2, width: 0.4, height: 0.4 }, 0.1, -0.05);
    expect(result.x).toBeCloseTo(0.3);
    expect(result.y).toBeCloseTo(0.15);
    expect(result.width).toBe(0.4);
    expect(result.height).toBe(0.4);
  });

  it("clamps panning so the rect never leaves the source bounds", () => {
    const result = panCropRect({ x: 0.8, y: 0, width: 0.4, height: 0.4 }, 0.5, 0);
    expect(result.x).toBe(0.6);
  });
});

describe("zoomCropRect", () => {
  it("zooming in shrinks the rect around its own center", () => {
    const result = zoomCropRect({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 2);
    expect(result.width).toBeCloseTo(0.25);
    expect(result.height).toBeCloseTo(0.25);
    expect(result.x).toBeCloseTo(0.375);
    expect(result.y).toBeCloseTo(0.375);
  });

  it("zooming out grows the rect and clamps to source bounds", () => {
    const result = zoomCropRect({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 0.1);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});

describe("cropRectToBackgroundCss", () => {
  it("maps the full/undefined rect to 100% size and 0% position", () => {
    expect(cropRectToBackgroundCss(undefined)).toEqual({ size: "100% 100%", position: "0% 0%" });
    expect(cropRectToBackgroundCss(FULL_CROP_RECT)).toEqual({ size: "100% 100%", position: "0% 0%" });
  });

  it("maps a half-width crop starting at the origin to 200% size and 0% position", () => {
    expect(cropRectToBackgroundCss({ x: 0, y: 0, width: 0.5, height: 1 })).toEqual({
      size: "200% 100%",
      position: "0% 0%",
    });
  });

  it("maps a half-width crop at the right edge to 200% size and 100% position", () => {
    expect(cropRectToBackgroundCss({ x: 0.5, y: 0, width: 0.5, height: 1 })).toEqual({
      size: "200% 100%",
      position: "100% 0%",
    });
  });

  it("maps a centered quarter crop to 400% size and 50/50% position", () => {
    expect(cropRectToBackgroundCss({ x: 0.375, y: 0.375, width: 0.25, height: 0.25 })).toEqual({
      size: "400% 400%",
      position: "50% 50%",
    });
  });
});
