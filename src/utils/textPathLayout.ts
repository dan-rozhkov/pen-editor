import type { PathAnchor, TextNode } from '../types/scene'
import { preparePath } from './pathMeasure'
import { reverseAnchors } from './pathAnchors'
import { measureTextWidth } from './textWrap'
import { applyTextTransform } from './textTransform'

/** One positioned glyph along a `TextNode.textPath` curve. */
export interface TextPathGlyph {
  char: string
  /** Anchor point on the curve (glyph's advance origin), in the node's local space. */
  x: number
  y: number
  /** Rotation to apply to the glyph, in radians (the tangent angle of the effective — post-`flip` — direction of travel, from `resolveTextPathDirection`). */
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
 * Single source of truth for what `flip` means, shared by the Pixi renderer
 * (via `layoutTextOnPath` below), the SVG exporter
 * (`@/lib/designToSvg/convertNode.ts`'s `convertTextOnPathToSvg`), and the
 * on-canvas start-offset handle (`@/pixi/interaction/textPathOffsetGeometry.ts`)
 * — all three must agree on which points the text travels over and what
 * `startOffset` means relative to that travel, or they drift the way they
 * did before (see history below).
 *
 * Reversing the anchor list is sufficient to flip the tangent too: walking a
 * cubic backward negates its derivative at every shared point, so
 * `getPointAtLength` on the reversed points naturally returns `angle + PI`
 * relative to the forward path — no separate `+ Math.PI` adjustment needed
 * once the direction itself is reversed.
 *
 * `startOffset` is passed through unchanged — it is a fraction along the
 * *effective* (post-flip) direction of travel, so `0` always means "the
 * start of wherever the text currently reads from" in both flip states.
 * An earlier version remapped it to `1 - startOffset` on the theory that the
 * glyphs should still start from the same point on the curve the user picked
 * before the path was reversed; that's self-defeating, because anchoring at
 * the *original* start point while travelling in the *reversed* direction
 * means travelling immediately off the path — with the default
 * `startOffset: 0`, `1 - 0 = 1` places the entire string's start at the very
 * end of the path, so only one glyph (if that) ever fits before overflow
 * cuts the rest. Passing `startOffset` through keeps `flip` doing only what
 * its name says (reverse the direction of travel / which side the text
 * sits on) without also silently relocating the start point.
 */
export function resolveTextPathDirection(
  tp: NonNullable<TextNode['textPath']>,
): { points: PathAnchor[]; closed: boolean; startOffset: number } {
  const closed = tp.closed ?? false
  const startOffset = tp.startOffset ?? 0
  if (!tp.flip) return { points: tp.points, closed, startOffset }
  return { points: reverseAnchors(tp.points), closed, startOffset }
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

  const flip = !!tp.flip
  const effectiveSide: 'left' | 'right' = flip ? (tp.side === 'left' ? 'right' : 'left') : tp.side
  const { points, closed, startOffset: startOffsetFrac } = resolveTextPathDirection(tp)

  // Built once and reused for every glyph — rebuilding the arc-length LUT
  // per glyph (and per drag/hover probe elsewhere) is the exact class of
  // per-event/per-glyph recomputation this codebase already paid for once
  // (see `bug-01`, the pen-tool-lag fix) and doesn't want to reintroduce.
  const prepared = preparePath(points, closed)
  const totalLength = prepared.totalLength

  const text = applyTextTransform(node.text ?? '', node.textTransform)
  const letterSpacing = node.letterSpacing ?? 0
  const startOffset = Math.max(0, Math.min(1, startOffsetFrac))

  let advance = startOffset * totalLength
  let overflow = false
  const glyphs: TextPathGlyph[] = []

  for (const char of Array.from(text)) {
    if (advance > totalLength) {
      overflow = true
      break
    }
    // `measureTextWidth` bakes in `(text.length - 1) * letterSpacing` using
    // UTF-16 code-unit length, meant for measuring whole strings. `char` here
    // is one `Array.from` grapheme/code-point, which is 1 code unit for BMP
    // characters (the `- 1` term is 0, a no-op) but 2 for astral characters
    // like emoji — so for those, `measureTextWidth` already adds one
    // glyph's worth of letterSpacing on top of the raw glyph width.
    // Subtracting that same term back out yields the pure glyph width, so
    // `advance += width + letterSpacing` below is the only place spacing is
    // applied, exactly once per glyph regardless of code-unit width.
    const width = measureTextWidth(node, char) - Math.max(0, char.length - 1) * letterSpacing
    const { x, y, angle } = prepared.getPointAtLength(advance)
    glyphs.push({ char, x, y, angle, width })
    advance += width + letterSpacing
  }

  return { glyphs, totalLength, overflow, effectiveSide }
}
