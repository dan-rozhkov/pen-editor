// Tests the Pixi-side pattern sprite construction WITHOUT initializing a
// renderer (mirrors shaderFillHelpers.test.ts): TilingSprite/Texture creation
// is pure display-list work; only the actual GPU upload needs WebGL.
import { describe, expect, it } from "vitest";
import { Texture, TilingSprite } from "pixi.js";
import { buildPatternSprite } from "../patternFillHelpers";
import type { PatternFill } from "@/types/scene";

const pattern = (overrides: Partial<PatternFill> = {}): PatternFill => ({
  url: "https://example.com/tile.png",
  ...overrides,
});

describe("buildPatternSprite", () => {
  it("builds a TilingSprite covering the fill area with default tiling", () => {
    const sprite = buildPatternSprite(Texture.WHITE, pattern(), 200, 100);
    expect(sprite).toBeInstanceOf(TilingSprite);
    expect(sprite.width).toBe(200);
    expect(sprite.height).toBe(100);
    expect(sprite.texture).toBe(Texture.WHITE);
    expect(sprite.tileScale.x).toBe(1);
    expect(sprite.tileScale.y).toBe(1);
    expect(sprite.tilePosition.x).toBe(0);
    expect(sprite.tilePosition.y).toBe(0);
  });

  it("applies scale via tileScale when no cell bake is needed", () => {
    const sprite = buildPatternSprite(Texture.WHITE, pattern({ scale: 0.5 }), 100, 100);
    expect(sprite.texture).toBe(Texture.WHITE);
    expect(sprite.tileScale.x).toBe(0.5);
    expect(sprite.tileScale.y).toBe(0.5);
  });

  it("applies whole-pattern offsets via tilePosition", () => {
    const sprite = buildPatternSprite(
      Texture.WHITE,
      pattern({ offsetX: 12, offsetY: -4 }),
      100,
      100,
    );
    expect(sprite.tilePosition.x).toBe(12);
    expect(sprite.tilePosition.y).toBe(-4);
  });

  it("degrades gracefully when a cell bake is needed but the texture source is not canvas-drawable", () => {
    // Texture.WHITE is buffer-backed — no HTMLImageElement/canvas/ImageBitmap
    // resource — so spacing cannot be baked; plain scaled tiling is the fallback.
    const sprite = buildPatternSprite(
      Texture.WHITE,
      pattern({ spacingX: 8, scale: 2 }),
      100,
      100,
    );
    expect(sprite.texture).toBe(Texture.WHITE);
    expect(
      (sprite as TilingSprite & { _derivedImageTexture?: Texture })._derivedImageTexture,
    ).toBeUndefined();
    expect(sprite.tileScale.x).toBe(2);
  });
});
