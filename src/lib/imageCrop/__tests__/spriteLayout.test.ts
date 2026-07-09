import { describe, it, expect } from "vitest";
import { computeFillSpriteLayout } from "../spriteLayout";

describe("computeFillSpriteLayout", () => {
  // 200x100 source into a 100x100 box (source wider than box).
  describe("no crop", () => {
    it("stretch → full texture stretched to the box", () => {
      const l = computeFillSpriteLayout("stretch", undefined, 200, 100, 100, 100);
      expect(l.frame).toBeNull();
      expect(l.dest).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it("fill (cover) → center-cropped square frame, sprite fills the box", () => {
      const l = computeFillSpriteLayout("fill", undefined, 200, 100, 100, 100);
      // cover of a 200x100 source into a square: take a 100x100 region centered.
      expect(l.frame).toEqual({ x: 50, y: 0, width: 100, height: 100 });
      expect(l.dest).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it("fit (contain) → full texture, letterboxed and centered", () => {
      const l = computeFillSpriteLayout("fit", undefined, 200, 100, 100, 100);
      expect(l.frame).toBeNull();
      // aspect 2 > 1 → width fills, height halved, centered vertically.
      expect(l.dest).toEqual({ x: 0, y: 25, width: 100, height: 50 });
    });
  });

  describe("with crop", () => {
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 }; // middle 100px-wide strip

    it("stretch → samples the crop frame, fills the box", () => {
      const l = computeFillSpriteLayout("stretch", crop, 200, 100, 100, 100);
      expect(l.frame).toEqual({ x: 50, y: 0, width: 100, height: 100 });
      expect(l.dest).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it("fill → cover computed within the crop rect", () => {
      const l = computeFillSpriteLayout("fill", crop, 200, 100, 100, 100);
      // crop is 100x100 already square → cover is the whole crop.
      expect(l.frame).toEqual({ x: 50, y: 0, width: 100, height: 100 });
      expect(l.dest).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it("fit → samples the crop frame, letterboxed", () => {
      const l = computeFillSpriteLayout("fit", crop, 200, 100, 100, 100);
      expect(l.frame).toEqual({ x: 50, y: 0, width: 100, height: 100 });
      // crop aspect 1 == box aspect 1 → fills exactly.
      expect(l.dest).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });
  });
});
