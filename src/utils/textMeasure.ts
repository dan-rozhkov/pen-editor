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
  const paragraphSpacing = node.paragraphSpacing ?? 0
  const ctx = getContext()
  ctx.font = buildFontString(node)

  const { lines } = layoutTextParagraphs(node, null)

  let maxWidth = 0
  let paragraphCount = 0
  for (const line of lines) {
    const metrics = ctx.measureText(line.text)
    // Account for letter spacing: (charCount - 1) * spacing, plus the line's
    // own left offset (indent + hanging indent past a list marker).
    const lineWidth = line.x + metrics.width + Math.max(0, line.text.length - 1) * letterSpacing
    maxWidth = Math.max(maxWidth, lineWidth)
    if (line.isFirstLine) paragraphCount++
  }

  // One `paragraphSpacing` gap after every paragraph but the last — same
  // formula the Pixi renderer and `measureTextFixedWidthHeight` use, so
  // auto-size can never disagree with what's actually drawn.
  const totalHeight =
    lines.length * fontSize * lineHeight + Math.max(0, paragraphCount - 1) * paragraphSpacing

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
  const paragraphSpacing = node.paragraphSpacing ?? 0
  // A maxLines cap shrinks auto-height so the box never grows past the limit.
  // The 'fixed-height' height limit is irrelevant here (that mode keeps its own
  // fixed height), so getLineLimit only contributes maxLines in 'fixed' mode.
  const limit = getLineLimit(node)
  const { lines } = layoutTextParagraphs(node, node.width)
  const keptLines = Number.isFinite(limit) ? lines.slice(0, limit) : lines
  const lineCount = Math.max(1, keptLines.length)
  // Paragraph gaps are counted from the *kept* lines only — a paragraph
  // dropped entirely by maxLines contributes no trailing gap.
  const paragraphCount = new Set(keptLines.map((line) => line.paragraphIndex)).size
  const spacingHeight = Math.max(0, paragraphCount - 1) * paragraphSpacing
  return Math.ceil(lineCount * fontSize * lineHeight + spacingHeight)
}
