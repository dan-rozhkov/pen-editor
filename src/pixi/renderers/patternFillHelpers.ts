import { Texture, TilingSprite } from "pixi.js";
import type { PatternFill } from "@/types/scene";
import {
  computePatternCell,
  normalizePattern,
  patternNeedsCellBake,
} from "@/utils/patternUtils";

/**
 * Pixi side of pattern fills: turns a loaded tile texture into a TilingSprite
 * covering the node's fill area. All layout math is pure and lives in
 * `@/utils/patternUtils` (unit-tested); this module only touches canvas/Pixi.
 *
 * Plain (optionally scaled) tiling uses the tile texture directly with
 * `tileScale`. Spacing / row-stagger patterns bake one repeating cell to an
 * intermediate canvas texture first (`computePatternCell` provides the
 * layout), which is recorded as `_derivedImageTexture` so the shared sprite
 * teardown in imageFillHelpers destroys it with the sprite.
 */

/** Extract a canvas-drawable source from a Pixi texture, if possible. */
function getCanvasImageSource(texture: Texture): CanvasImageSource | null {
  const resource = (texture.source as { resource?: unknown }).resource;
  if (
    typeof HTMLImageElement !== "undefined" && resource instanceof HTMLImageElement
  ) {
    return resource;
  }
  if (
    typeof HTMLCanvasElement !== "undefined" && resource instanceof HTMLCanvasElement
  ) {
    return resource;
  }
  if (typeof ImageBitmap !== "undefined" && resource instanceof ImageBitmap) {
    return resource;
  }
  return null;
}

/** Bake one repeating pattern cell (tile + spacing + stagger) to a texture. */
function bakePatternCellTexture(
  texture: Texture,
  pattern: PatternFill,
): Texture | null {
  const source = getCanvasImageSource(texture);
  if (!source) return null;

  const cell = computePatternCell(pattern, texture.width, texture.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cell.cellWidth));
  canvas.height = Math.max(1, Math.round(cell.cellHeight));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  for (const placement of cell.placements) {
    ctx.drawImage(source, placement.x, placement.y, cell.tileWidth, cell.tileHeight);
  }
  return Texture.from(canvas);
}

/**
 * Build the TilingSprite for a pattern paint from its loaded tile texture.
 * The sprite covers `width` × `height`; masking/opacity/blend/z-placement are
 * applied by the caller (shared with image sprites in imageFillHelpers).
 */
export function buildPatternSprite(
  texture: Texture,
  pattern: PatternFill,
  width: number,
  height: number,
): TilingSprite {
  const p = normalizePattern(pattern);

  let tileTexture = texture;
  let derived: Texture | undefined;
  if (patternNeedsCellBake(pattern)) {
    const baked = bakePatternCellTexture(texture, pattern);
    if (baked) {
      tileTexture = baked;
      derived = baked;
    }
  }

  const sprite = new TilingSprite({ texture: tileTexture, width, height });
  // A baked cell already has scale folded in; direct tiling scales the texture.
  if (!derived && p.scale !== 1) {
    sprite.tileScale.set(p.scale, p.scale);
  }
  sprite.tilePosition.set(p.offsetX, p.offsetY);
  (sprite as TilingSprite & { _derivedImageTexture?: Texture })._derivedImageTexture =
    derived;
  return sprite;
}
