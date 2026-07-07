import type { TextNode } from '../types/scene'
import { applyTextTransform } from './textTransform'
import { LIST_INDENT_WIDTH, LIST_MARKER_GAP, getParagraphAttrs } from '../lib/textLists/paragraphs'
import { computeParagraphMarkerInfos } from '../lib/textLists/markers'

// Shared offscreen canvas for text measurement.
let measureCanvas: HTMLCanvasElement | null = null
let measureCtx: CanvasRenderingContext2D | null = null

function getContext(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCanvas = document.createElement('canvas')
    measureCtx = measureCanvas.getContext('2d')!
  }
  return measureCtx
}

/**
 * Build a CSS font string from TextNode properties.
 * Format: "[style] [weight] <size>px <family>"
 */
export function buildFontString(node: TextNode): string {
  const style = node.fontStyle ?? 'normal'
  const weight = node.fontWeight ?? 'normal'
  const size = node.fontSize ?? 16
  const family = node.fontFamily ?? 'Arial'
  return `${style} ${weight} ${size}px ${family}`
}

/**
 * Measure a single string's rendered width (letter-spacing aware) using the
 * node's font, via the same shared measurement canvas as `wrapTextToLines` /
 * `layoutTextParagraphs`. Single source of truth for "how wide is this text"
 * so callers outside this module (e.g. the inline editor's marker-width
 * measurement) can't drift from the wrapping/layout math by omitting
 * letter-spacing or using a second canvas context.
 */
export function measureTextWidth(
  node: Pick<TextNode, 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'letterSpacing'>,
  text: string,
): number {
  if (text.length === 0) return 0
  const ctx = getContext()
  ctx.font = buildFontString(node as TextNode)
  const letterSpacing = node.letterSpacing ?? 0
  return ctx.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing
}

const NBSP = ' '

/** True if the character is a CJK ideograph / kana / hangul (wraps char-by-char). */
function isCJK(ch: string): boolean {
  const cp = ch.codePointAt(0)
  if (cp === undefined) return false
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
    (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
    (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) // CJK Compatibility Ideographs
  )
}

/**
 * Split a paragraph into atomic segments separated by break opportunities.
 * Break opportunities (per Figma/CSS): the space character, after a hyphen `-`,
 * and between CJK characters. NBSP (U+00A0) is *not* a break point. The space
 * that follows a segment is attached to that segment so it is preserved when the
 * segments are re-joined on the same line.
 */
function splitSegments(paragraph: string): string[] {
  const segments: string[] = []
  let current = ''
  for (let i = 0; i < paragraph.length; i++) {
    const ch = paragraph[i]
    if (ch === ' ') {
      // Attach the trailing space to the current segment, then break.
      current += ch
      segments.push(current)
      current = ''
    } else if (ch === '-') {
      // Hyphen is a break opportunity *after* it.
      current += ch
      segments.push(current)
      current = ''
    } else if (isCJK(ch)) {
      if (current) segments.push(current)
      segments.push(ch)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) segments.push(current)
  return segments
}

/**
 * Wrap a single paragraph's text to lines at the given maximum width. Greedy
 * first-fit at word boundaries; a single segment wider than `maxWidth` is
 * broken mid-word at the last fitting character (CSS `overflow-wrap:
 * break-word` semantics, no hyphen inserted). Shared by `wrapTextToLines` and
 * the list-aware `layoutTextParagraphs` so both can never diverge.
 */
function wrapParagraphText(
  paragraph: string,
  maxWidth: number,
  ctx: CanvasRenderingContext2D,
  letterSpacing: number,
): string[] {
  if (paragraph === '') return ['']

  // Width of a string including letter spacing.
  const widthOf = (s: string): number =>
    s.length === 0
      ? 0
      : ctx.measureText(s).width + Math.max(0, s.length - 1) * letterSpacing

  // Break a single over-long segment into pieces that each fit maxWidth.
  // Returns the pieces; the last piece may be shorter than maxWidth.
  const breakLongSegment = (seg: string): string[] => {
    const pieces: string[] = []
    let start = 0
    while (start < seg.length) {
      // Find the largest end such that seg[start..end) fits maxWidth.
      let end = start + 1
      while (end < seg.length && widthOf(seg.slice(start, end + 1)) <= maxWidth) {
        end++
      }
      pieces.push(seg.slice(start, end))
      start = end
    }
    return pieces
  }

  const lines: string[] = []
  const segments = splitSegments(paragraph)
  let currentLine = ''

  for (const segment of segments) {
    const testLine = currentLine + segment
    // A trailing space on the segment doesn't count against the fit check
    // (mirrors CSS: trailing whitespace can overflow).
    const measured = testLine.endsWith(' ') ? testLine.slice(0, -1) : testLine
    if (widthOf(measured) <= maxWidth || currentLine === '') {
      // Segment fits, or the line is empty and we must place at least part of it.
      if (currentLine === '' && widthOf(segment.trimEnd()) > maxWidth) {
        // Segment alone is wider than the box — break it mid-word.
        const pieces = breakLongSegment(segment)
        for (let i = 0; i < pieces.length - 1; i++) {
          lines.push(pieces[i])
        }
        currentLine = pieces[pieces.length - 1]
      } else {
        currentLine = testLine
      }
    } else {
      // Doesn't fit — wrap. Push the current line and start a new one.
      lines.push(currentLine)
      if (widthOf(segment.trimEnd()) > maxWidth) {
        const pieces = breakLongSegment(segment)
        for (let i = 0; i < pieces.length - 1; i++) {
          lines.push(pieces[i])
        }
        currentLine = pieces[pieces.length - 1]
      } else {
        currentLine = segment
      }
    }
  }
  lines.push(currentLine)

  return lines
}

/**
 * Wrap a TextNode's text to lines at the given maximum width.
 *
 * Single source of truth for line breaking — both measurement
 * (`measureTextFixedWidthHeight`) and the Pixi renderer derive their lines from
 * this so they can never diverge. See `wrapParagraphText` for the per-paragraph
 * algorithm; list markers/indent are not reflected in the returned strings
 * (they never affect a non-list paragraph's width, and list rendering uses
 * `layoutTextParagraphs` instead, which does account for them).
 */
export function wrapTextToLines(node: TextNode, maxWidth: number): string[] {
  const ctx = getContext()
  ctx.font = buildFontString(node)
  const letterSpacing = node.letterSpacing ?? 0
  const text = applyTextTransform(node.text || '', node.textTransform)

  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    lines.push(...wrapParagraphText(paragraph, maxWidth, ctx, letterSpacing))
  }
  return lines
}

export interface LaidOutLine {
  text: string
  paragraphIndex: number
  isFirstLine: boolean
  /** Left offset, in px, from the node's left edge (indent + hanging indent past a marker, plus any center/right alignment shift). */
  x: number
}

export interface ParagraphMarkerLayout {
  paragraphIndex: number
  text: string
  /** Left offset, in px, from the node's left edge (where the marker glyph itself is drawn). */
  x: number
  /** Measured width, in px, of the marker text (used to compute the hanging indent). */
  width: number
}

/**
 * List/indent-aware line layout: like `wrapTextToLines`, but reduces the
 * available width for list paragraphs by their indent + marker width, and
 * reports each line's paragraph index / left offset plus one marker entry per
 * list paragraph (positioned at its first line). `maxWidth === null` means
 * unwrapped ("auto") mode — one line per paragraph, no wrapping.
 *
 * This is the single source of truth `measureTextAutoSize` /
 * `measureTextFixedWidthHeight` / the Pixi text renderer all derive from, so
 * auto-size and rendering can never disagree about how much room a marker
 * takes up.
 */
export function layoutTextParagraphs(
  node: TextNode,
  maxWidth: number | null,
): { lines: LaidOutLine[]; markers: ParagraphMarkerLayout[] } {
  const ctx = getContext()
  ctx.font = buildFontString(node)
  const letterSpacing = node.letterSpacing ?? 0
  const text = applyTextTransform(node.text || '', node.textTransform)
  const paragraphs = text.split('\n')
  const markerInfos = computeParagraphMarkerInfos(node)

  const widthOf = (s: string): number =>
    s.length === 0 ? 0 : ctx.measureText(s).width + Math.max(0, s.length - 1) * letterSpacing

  const lines: LaidOutLine[] = []
  const markers: ParagraphMarkerLayout[] = []

  const align = node.textAlign ?? 'left'

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const markerInfo = markerInfos[paragraphIndex]
    const attrs = getParagraphAttrs(node, paragraphIndex)
    const indentPx = markerInfo ? attrs.indentLevel * LIST_INDENT_WIDTH : 0
    const markerWidth = markerInfo ? widthOf(markerInfo.text) : 0
    const hangingPx = markerInfo ? markerWidth + LIST_MARKER_GAP : 0
    const xOffset = indentPx + hangingPx

    const availWidth = maxWidth !== null ? Math.max(1, maxWidth - xOffset) : Infinity
    const wrapped =
      maxWidth !== null ? wrapParagraphText(paragraph, availWidth, ctx, letterSpacing) : [paragraph]

    // Center/right alignment shifts a line + its marker (if any) as a unit
    // within the space left after the hanging indent — each wrapped line
    // aligns independently on its own measured width, same as plain wrapped
    // text (see `positionTextBlock` for the single-Text-object equivalent).
    // Left alignment (the default) never shifts anything, so this is a no-op
    // whenever textAlign is unset — matching pre-existing layout exactly.
    const alignOffset = (lineText: string): number => {
      if (maxWidth === null || align === 'left') return 0
      const trimmed = lineText.endsWith(' ') ? lineText.slice(0, -1) : lineText
      const lineWidth = widthOf(trimmed)
      const factor = align === 'center' ? 0.5 : 1
      return Math.max(0, availWidth - lineWidth) * factor
    }

    if (markerInfo) {
      const offset = alignOffset(wrapped[0] ?? '')
      markers.push({ paragraphIndex, text: markerInfo.text, x: indentPx + offset, width: markerWidth })
    }

    wrapped.forEach((lineText, i) => {
      lines.push({ text: lineText, paragraphIndex, isFirstLine: i === 0, x: xOffset + alignOffset(lineText) })
    })
  })

  return { lines, markers }
}

const ELLIPSIS = '…'

/**
 * Compute how many wrapped lines are allowed to render given the node's
 * truncation settings. Returns `Infinity` when no limit applies.
 *
 * Truncation only applies to wrapped modes ('fixed' / 'fixed-height'): 'auto'
 * (auto-width) lays text out without a width to wrap against, so neither
 * `maxLines` nor `truncateText` constrains it (mirrors the UI, which hides both
 * controls there).
 *
 * - `maxLines` (if a positive number) caps the line count.
 * - `truncateText` in 'fixed-height' mode additionally caps by how many lines
 *   fit the box height (`floor(height / lineHeight)`, at least 1). Plain 'fixed'
 *   (auto-height) has no height limit, so only `maxLines` constrains it.
 */
export function getLineLimit(node: TextNode): number {
  let limit = Infinity

  const isWrapped =
    node.textWidthMode === 'fixed' || node.textWidthMode === 'fixed-height'
  if (!isWrapped) return limit

  if (typeof node.maxLines === 'number' && node.maxLines >= 1) {
    limit = Math.floor(node.maxLines)
  }

  if (node.truncateText && node.textWidthMode === 'fixed-height') {
    const fontSize = node.fontSize ?? 16
    const lineHeight = (node.lineHeight ?? 1.2) * fontSize
    const fit = lineHeight > 0 ? Math.max(1, Math.floor(node.height / lineHeight)) : 1
    limit = Math.min(limit, fit)
  }

  return limit
}

/**
 * Apply ellipsis truncation to a list of already-wrapped lines.
 *
 * Keeps at most `getLineLimit(node)` lines. When lines are dropped (or the last
 * kept line itself overflows the box width), the last kept line is shortened
 * character-by-character until `line + "…"` fits within `maxWidth`, then the
 * ellipsis is appended. Mirrors the measurement used in `wrapTextToLines`
 * (letter-spacing aware) so canvas pixels match.
 *
 * A no-op (returns `lines` unchanged) when the limit is not exceeded.
 */
export function truncateLines(node: TextNode, lines: string[], maxWidth: number): string[] {
  const limit = getLineLimit(node)
  if (!Number.isFinite(limit) || lines.length <= limit) return lines

  const ctx = getContext()
  ctx.font = buildFontString(node)
  const letterSpacing = node.letterSpacing ?? 0
  const widthOf = (s: string): number =>
    s.length === 0
      ? 0
      : ctx.measureText(s).width + Math.max(0, s.length - 1) * letterSpacing

  const kept = lines.slice(0, limit)
  let last = (kept[kept.length - 1] ?? '').replace(/\s+$/, '')

  // Trim characters off the end until the ellipsis fits. Allow dropping the
  // whole line content (bare "…") as a last resort for very narrow boxes.
  while (last.length > 0 && widthOf(last + ELLIPSIS) > maxWidth) {
    last = last.slice(0, -1).replace(/\s+$/, '')
  }

  kept[kept.length - 1] = last + ELLIPSIS
  return kept
}

// Re-export so existing call sites keep working.
export { NBSP }
