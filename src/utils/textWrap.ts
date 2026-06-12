import type { TextNode } from '../types/scene'
import { applyTextTransform } from './textTransform'

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
 * Wrap a TextNode's text to lines at the given maximum width.
 *
 * Single source of truth for line breaking — both measurement
 * (`measureTextFixedWidthHeight`) and the Pixi renderer derive their lines from
 * this so they can never diverge. Greedy first-fit at word boundaries; a single
 * segment wider than `maxWidth` is broken mid-word at the last fitting character
 * (CSS `overflow-wrap: break-word` semantics, no hyphen inserted).
 */
export function wrapTextToLines(node: TextNode, maxWidth: number): string[] {
  const ctx = getContext()
  ctx.font = buildFontString(node)
  const letterSpacing = node.letterSpacing ?? 0
  const text = applyTextTransform(node.text || '', node.textTransform)

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

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }

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
  }

  return lines
}

// Re-export so existing call sites keep working.
export { NBSP }
