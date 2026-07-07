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

/** Bake one repeating pattern cell (tile + spacing + stagger) to a texture.
 *  Exported for unit testing the sub-pixel seam fix (canvas scale math) —
 *  Pixi's `Texture.from(canvas)` is pure display-list work, no renderer needed. */
export function bakePatternCellTexture(
  texture: Texture,
  pattern: PatternFill,
): Texture | null {
  const source = getCanvasImageSource(texture);
  if (!source) return null;

  const cell = computePatternCell(pattern, texture.width, texture.height);
  // The canvas must have integer dimensions, but the cell's placements/tile
  // sizes are generally fractional (tile size × scale, plus spacing). Rounding
  // the canvas size while drawing at the fractional cell size clips a sliver
  // off the edge tile(s) — a visible seam when the baked texture repeats.
  // Fix: draw at the fractional cell size, then scale the whole 2D context so
  // that exact fractional cell maps onto the integer canvas pixel-for-pixel;
  // the baked texture then tiles exactly regardless of rounding.
  const canvasWidth = Math.max(1, Math.round(cell.cellWidth));
  const canvasHeight = Math.max(1, Math.round(cell.cellHeight));
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(canvasWidth / cell.cellWidth, canvasHeight / cell.cellHeight);
  for (const placement of cell.placements) {
    ctx.drawImage(source, placement.x, placement.y, cell.tileWidth, cell.tileHeight);
  }
  return Texture.from(canvas);
}

// ---------------------------------------------------------------------------
// Baked-cell cache
//
// `computePatternCell`/`bakePatternCellTexture` depend only on the pattern's
// own params (tile identity, scale, spacing, row offset) and the tile
// texture's *natural* size — never on the node's fill area. That means every
// resize tick would otherwise re-bake the identical cell from scratch. Cache
// it keyed on (tile cache key/url, scale, spacingX, spacingY, rowOffset),
// mirroring imageFillHelpers' `textureCache`: a bounded LRU that is never
// force-destroyed (other sprites may still reference an entry — the safe
// "keep-alive" approach that textureCache's own comment documents), relying
// on Pixi's texture GC to reclaim it once truly unreferenced.
// ---------------------------------------------------------------------------

const BAKED_CELL_CACHE_MAX_ENTRIES = 64;
const bakedCellCache = new Map<string, Texture>();

function getCachedCellTexture(key: string): Texture | undefined {
  const texture = bakedCellCache.get(key);
  if (texture) {
    bakedCellCache.delete(key);
    bakedCellCache.set(key, texture);
  }
  return texture;
}

function setCachedCellTexture(key: string, texture: Texture): void {
  bakedCellCache.delete(key);
  bakedCellCache.set(key, texture);
  while (bakedCellCache.size > BAKED_CELL_CACHE_MAX_ENTRIES) {
    const oldestKey = bakedCellCache.keys().next().value;
    if (oldestKey === undefined) break;
    bakedCellCache.delete(oldestKey);
  }
}

/** Build the baked-cell cache key for a pattern given its tile's identity. */
export function getPatternCellCacheKey(tileCacheKey: string, pattern: PatternFill): string {
  const p = normalizePattern(pattern);
  return `${tileCacheKey}|${p.scale}|${p.spacingX}|${p.spacingY}|${p.rowOffset}`;
}

/**
 * Build the TilingSprite for a pattern paint from its loaded tile texture.
 * The sprite covers `width` × `height`; masking/opacity/blend/z-placement are
 * applied by the caller (shared with image sprites in imageFillHelpers).
 *
 * `tileCacheKey` (typically the tile's own URL / texture-cache key) enables
 * the baked-cell cache above. Without it (e.g. direct unit-test calls) the
 * bake falls back to the previous per-sprite-owned behavior.
 */
export function buildPatternSprite(
  texture: Texture,
  pattern: PatternFill,
  width: number,
  height: number,
  tileCacheKey?: string,
): TilingSprite {
  const p = normalizePattern(pattern);

  let tileTexture = texture;
  let derived: Texture | undefined;
  let cached = false;
  if (patternNeedsCellBake(pattern)) {
    const cellKey = tileCacheKey ? getPatternCellCacheKey(tileCacheKey, pattern) : undefined;
    const existing = cellKey ? getCachedCellTexture(cellKey) : undefined;
    if (existing) {
      tileTexture = existing;
      derived = existing;
      cached = true;
    } else {
      const baked = bakePatternCellTexture(texture, pattern);
      if (baked) {
        tileTexture = baked;
        derived = baked;
        if (cellKey) {
          setCachedCellTexture(cellKey, baked);
          cached = true;
        }
      }
    }
  }

  const sprite = new TilingSprite({ texture: tileTexture, width, height });
  // A baked cell already has scale folded in; direct tiling scales the texture.
  if (!derived && p.scale !== 1) {
    sprite.tileScale.set(p.scale, p.scale);
  }
  sprite.tilePosition.set(p.offsetX, p.offsetY);
  // A cache-tracked bake is owned by the cache, not this sprite: per-sprite
  // teardown (`destroyMultiImageSprites`) must not destroy it, since another
  // sprite (e.g. the same pattern reapplied after a resize) may still be
  // using the exact same cached Texture instance.
  (sprite as TilingSprite & { _derivedImageTexture?: Texture })._derivedImageTexture =
    cached ? undefined : derived;
  return sprite;
}
