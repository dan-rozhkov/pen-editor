// Tests the Pixi-side pattern sprite construction WITHOUT initializing a
// renderer (mirrors shaderFillHelpers.test.ts): TilingSprite/Texture creation
// is pure display-list work; only the actual GPU upload needs WebGL.
import { describe, expect, it } from "vitest";
import { Texture, TilingSprite } from "pixi.js";
import { bakePatternCellTexture, buildPatternSprite } from "../patternFillHelpers";
import type { PatternFill } from "@/types/scene";

const pattern = (overrides: Partial<PatternFill> = {}): PatternFill => ({
  url: "https://example.com/tile.png",
  ...overrides,
});

/**
 * happy-dom has no real 2D canvas context (see src/test/setup.ts's fake stub,
 * which lacks scale/drawImage/etc). Install a richer fake — recording every
 * call — for the duration of `fn`, then restore.
 */
function withFakeCanvas2dContext<T>(fn: () => T): T {
  const scaleCalls: [number, number][] = [];
  const drawImageCalls: unknown[][] = [];
  const prevGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    id: string,
    ...args: unknown[]
  ) {
    if (id === "2d") {
      return {
        scale: (x: number, y: number) => scaleCalls.push([x, y]),
        drawImage: (...a: unknown[]) => drawImageCalls.push(a),
        clearRect: () => {},
      } as unknown as CanvasRenderingContext2D;
    }
    return (prevGetContext as (this: HTMLCanvasElement, id: string, ...rest: unknown[]) => unknown).call(
      this,
      id,
      ...args,
    );
  } as typeof HTMLCanvasElement.prototype.getContext;

  try {
    return fn();
  } finally {
    HTMLCanvasElement.prototype.getContext = prevGetContext;
  }
}

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

describe("bakePatternCellTexture (sub-pixel seam fix)", () => {
  it("scales the 2D context so a fractional cell maps exactly onto the rounded canvas", () => {
    withFakeCanvas2dContext(() => {
      // A canvas-drawable source texture (so getCanvasImageSource picks it up),
      // with a tile size that produces a fractional cell when scaled.
      const source = document.createElement("canvas");
      source.width = 10;
      source.height = 20;
      const texture = Texture.from(source);

      // scale = 1/3 → tileWidth = 10/3 = 3.333..., tileHeight = 20/3 = 6.666...
      const pattern: PatternFill = { url: "x", scale: 1 / 3, spacingX: 1 };
      const baked = bakePatternCellTexture(texture, pattern);
      expect(baked).not.toBeNull();

      // Canvas is rounded to integers, but the context must be scaled by
      // canvas/cell so the fractional cell draws pixel-for-pixel onto it —
      // never left at 1 (which would clip a sliver at the rounded edge).
      const cellWidth = 10 * (1 / 3) + 1; // tileWidth + spacingX
      const cellHeight = 20 * (1 / 3);
      const canvasWidth = Math.round(cellWidth);
      const canvasHeight = Math.round(cellHeight);
      expect(baked!.width).toBe(canvasWidth);
      expect(baked!.height).toBe(canvasHeight);
    });
  });
});

describe("buildPatternSprite baked-cell cache (finding #6a)", () => {
  it("reuses the same baked cell texture for the same tile + pattern params (resize fast path)", () => {
    withFakeCanvas2dContext(() => {
      const source = document.createElement("canvas");
      source.width = 10;
      source.height = 10;
      const texture = Texture.from(source);
      const p: PatternFill = { url: "https://example.com/tile.svg", spacingX: 2 };

      // Same tileCacheKey + same pattern params, different container sizes
      // (simulating a resize) — computePatternCell never depends on container
      // size, so this must be a 100% cache hit.
      const spriteA = buildPatternSprite(texture, p, 100, 100, p.url);
      const spriteB = buildPatternSprite(texture, p, 250, 60, p.url);

      expect(spriteA.texture).toBe(spriteB.texture);
      // Ownership: a cache-tracked bake is NOT destroyed by per-sprite
      // teardown — its lifetime is the bounded LRU cache's job.
      expect(
        (spriteA as TilingSprite & { _derivedImageTexture?: Texture })._derivedImageTexture,
      ).toBeUndefined();
      expect(
        (spriteB as TilingSprite & { _derivedImageTexture?: Texture })._derivedImageTexture,
      ).toBeUndefined();
    });
  });

  it("bakes a distinct texture per distinct pattern param (different scale)", () => {
    withFakeCanvas2dContext(() => {
      const source = document.createElement("canvas");
      source.width = 10;
      source.height = 10;
      const texture = Texture.from(source);

      const spriteA = buildPatternSprite(
        texture,
        { url: "https://example.com/tile2.svg", spacingX: 2, scale: 1 },
        100,
        100,
        "https://example.com/tile2.svg",
      );
      const spriteB = buildPatternSprite(
        texture,
        { url: "https://example.com/tile2.svg", spacingX: 2, scale: 2 },
        100,
        100,
        "https://example.com/tile2.svg",
      );

      expect(spriteA.texture).not.toBe(spriteB.texture);
    });
  });

  it("without a tileCacheKey, falls back to the previous per-sprite-owned bake (no caching)", () => {
    withFakeCanvas2dContext(() => {
      const source = document.createElement("canvas");
      source.width = 10;
      source.height = 10;
      const texture = Texture.from(source);
      const p: PatternFill = { url: "https://example.com/tile3.svg", spacingX: 2 };

      const sprite = buildPatternSprite(texture, p, 100, 100);
      expect(
        (sprite as TilingSprite & { _derivedImageTexture?: Texture })._derivedImageTexture,
      ).toBe(sprite.texture);
    });
  });
});
