import type { TextNode } from '../types/scene'
import { buildFontString, getLineLimit, layoutTextParagraphs } from './textWrap'

// Re-export the shared helpers so existing call sites keep their import path.
export { applyTextTransform } from './textTransform'
export {
  wrapTextToLines,
  buildFontString,
  truncateLines,
  getLineLimit,
  layoutTextParagraphs,
} from './textWrap'

// Shared offscreen canvas for text measurement
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
 * Measure the rendered dimensions of a text node in "auto" mode
 * (single line per paragraph, no wrapping).
 *
 * List paragraphs (bullet/numbered) widen their line by the marker + hanging
 * indent (`layoutTextParagraphs` with `maxWidth: null` — one line per
 * paragraph, no wrap — reports each line's `x` offset for exactly this).
 */
export function measureTextAutoSize(node: TextNode): { width: number; height: number } {
  const fontSize = node.fontSize ?? 16
  const lineHeight = node.lineHeight ?? 1.2
  const letterSpacing = node.letterSpacing ?? 0
  const ctx = getContext()
  ctx.font = buildFontString(node)

  const { lines } = layoutTextParagraphs(node, null)

  let maxWidth = 0
  for (const line of lines) {
    const metrics = ctx.measureText(line.text)
    // Account for letter spacing: (charCount - 1) * spacing, plus the line's
    // own left offset (indent + hanging indent past a list marker).
    const lineWidth = line.x + metrics.width + Math.max(0, line.text.length - 1) * letterSpacing
    maxWidth = Math.max(maxWidth, lineWidth)
  }

  const totalHeight = lines.length * fontSize * lineHeight

  return {
    width: Math.ceil(maxWidth),
    height: Math.ceil(totalHeight),
  }
}

/**
 * Measure the height of wrapped text for "fixed" mode (fixed width, auto height).
 *
 * Derived from `layoutTextParagraphs` (the list-aware superset of
 * `wrapTextToLines`) so the measured height can never disagree with the
 * rendered/edited wrapping, including the extra wrapping a marker + indent
 * causes on narrow list paragraphs.
 */
export function measureTextFixedWidthHeight(node: TextNode): number {
  const fontSize = node.fontSize ?? 16
  const lineHeight = node.lineHeight ?? 1.2
  // A maxLines cap shrinks auto-height so the box never grows past the limit.
  // The 'fixed-height' height limit is irrelevant here (that mode keeps its own
  // fixed height), so getLineLimit only contributes maxLines in 'fixed' mode.
  const limit = getLineLimit(node)
  let lineCount = layoutTextParagraphs(node, node.width).lines.length
  if (Number.isFinite(limit)) lineCount = Math.min(lineCount, limit)
  return Math.ceil(Math.max(1, lineCount) * fontSize * lineHeight)
}
