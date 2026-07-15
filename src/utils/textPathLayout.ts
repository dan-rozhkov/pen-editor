import type { TextNode } from '../types/scene'
import { getPointAtLength, getTotalLength } from './pathMeasure'
import { measureTextWidth } from './textWrap'
import { applyTextTransform } from './textTransform'

/** One positioned glyph along a `TextNode.textPath` curve. */
export interface TextPathGlyph {
  char: string
  /** Anchor point on the curve (glyph's advance origin), in the node's local space. */
  x: number
  y: number
  /** Rotation to apply to the glyph, in radians (tangent angle, plus PI when `flip`). */
  angle: number
  /** Measured advance width of this glyph (letter-spacing not included). */
  width: number
}

export interface TextPathLayoutResult {
  glyphs: TextPathGlyph[]
  totalLength: number
  /** True when one or more trailing characters could not be placed because their start position ran past the path's end. */
  overflow: boolean
  /** `side` after accounting for `flip` (flip swaps which side of the path the text sits on). */
  effectiveSide: 'left' | 'right'
}

/**
 * Pure per-glyph layout for text-on-a-path (no Pixi/DOM dependency beyond the
 * shared measurement canvas `measureTextWidth` already uses elsewhere in this
 * module family). Single source of truth shared by the Pixi renderer
 * (`pixi/renderers/textRenderer.ts`) and the properties-panel overflow
 * indicator (`TypographySection`), so they can never disagree about which
 * glyphs got cut off.
 *
 * Text-on-path renders a single logical line — the node's `text` is not
 * paragraph-split or wrapped (wrapping requires a rectangular box, which a
 * curve doesn't have); newlines are rendered as literal characters advancing
 * along the curve like any other glyph, matching SVG `<textPath>` behavior.
 *
 * Overflow policy: a glyph is drawn only if its *start* position (the
 * accumulated advance before this glyph) is within `[0, totalLength]`. A
 * glyph starting exactly at the end, or whose width would carry it past the
 * end, still gets drawn (its start is in range) — only glyphs whose start is
 * past the end are dropped. No wraparound on a closed path (explicit
 * out-of-scope decision — see the task spec).
 */
export function layoutTextOnPath(node: TextNode): TextPathLayoutResult | null {
  const tp = node.textPath
  if (!tp) return null

  const totalLength = getTotalLength(tp.points, tp.closed ?? false)
  const flip = !!tp.flip
  const effectiveSide: 'left' | 'right' = flip ? (tp.side === 'left' ? 'right' : 'left') : tp.side

  const text = applyTextTransform(node.text ?? '', node.textTransform)
  const letterSpacing = node.letterSpacing ?? 0
  const startOffset = Math.max(0, Math.min(1, tp.startOffset ?? 0))

  let advance = startOffset * totalLength
  let overflow = false
  const glyphs: TextPathGlyph[] = []

  for (const char of Array.from(text)) {
    if (advance > totalLength) {
      overflow = true
      break
    }
    const width = measureTextWidth(node, char)
    const { x, y, angle } = getPointAtLength(tp.points, tp.closed ?? false, advance)
    glyphs.push({
      char,
      x,
      y,
      angle: flip ? angle + Math.PI : angle,
      width,
    })
    advance += width + letterSpacing
  }

  return { glyphs, totalLength, overflow, effectiveSide }
}
