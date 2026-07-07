import type { PatternFill } from '@/types/scene'

/**
 * Pure pattern-fill math, shared by the Pixi tiling renderer
 * (`src/pixi/renderers/patternFillHelpers.ts`) and export paths. Keeping this
 * free of Pixi imports makes it fully unit-testable (the WebGL/texture side is
 * a thin layer on top, mirroring the shader-fill helpers split).
 */

export interface NormalizedPattern {
  scale: number
  spacingX: number
  spacingY: number
  offsetX: number
  offsetY: number
  rowOffset: number
}

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** Resolve a pattern's params to concrete values (defaults + clamping). */
export function normalizePattern(pattern: PatternFill): NormalizedPattern {
  const rawScale = finiteOr(pattern.scale, 1)
  const rawRowOffset = finiteOr(pattern.rowOffset, 0)
  // Row offset only matters modulo one cell; wrap into [0, 1).
  const rowOffset = ((rawRowOffset % 1) + 1) % 1
  return {
    scale: rawScale > 0 ? rawScale : 1,
    spacingX: Math.max(0, finiteOr(pattern.spacingX, 0)),
    spacingY: Math.max(0, finiteOr(pattern.spacingY, 0)),
    offsetX: finiteOr(pattern.offsetX, 0),
    offsetY: finiteOr(pattern.offsetY, 0),
    rowOffset,
  }
}

/**
 * Whether the pattern needs its repeating cell baked to an intermediate
 * texture. Plain (possibly scaled) tiling can be expressed directly with a
 * TilingSprite's `tileScale`; spacing and row stagger cannot.
 */
export function patternNeedsCellBake(pattern: PatternFill): boolean {
  const p = normalizePattern(pattern)
  return p.spacingX > 0 || p.spacingY > 0 || p.rowOffset > 0
}

export interface PatternCell {
  /** Rendered tile size (texture size × scale), px. */
  tileWidth: number
  tileHeight: number
  /** Size of the repeating cell (tile + spacing; doubled height when staggered). */
  cellWidth: number
  cellHeight: number
  /**
   * Tile draw positions inside the cell. Includes a horizontally wrapped copy
   * for the staggered row so the baked cell tiles seamlessly.
   */
  placements: { x: number; y: number }[]
}

/**
 * Compute the repeating-cell layout for a pattern given the tile texture's
 * natural size. The cell, drawn once and repeated edge-to-edge, produces the
 * full pattern including spacing and brick-style row offset.
 */
export function computePatternCell(
  pattern: PatternFill,
  textureWidth: number,
  textureHeight: number,
): PatternCell {
  const p = normalizePattern(pattern)
  const tileWidth = Math.max(1, textureWidth) * p.scale
  const tileHeight = Math.max(1, textureHeight) * p.scale
  const cellWidth = tileWidth + p.spacingX
  const rowHeight = tileHeight + p.spacingY

  if (p.rowOffset === 0) {
    return {
      tileWidth,
      tileHeight,
      cellWidth,
      cellHeight: rowHeight,
      placements: [{ x: 0, y: 0 }],
    }
  }

  // Staggered rows repeat every 2 rows; the second row is shifted by a
  // fraction of the cell width, with a wrapped copy so the cell stays seamless.
  const shift = p.rowOffset * cellWidth
  return {
    tileWidth,
    tileHeight,
    cellWidth,
    cellHeight: rowHeight * 2,
    placements: [
      { x: 0, y: 0 },
      { x: shift, y: rowHeight },
      { x: shift - cellWidth, y: rowHeight },
    ],
  }
}
