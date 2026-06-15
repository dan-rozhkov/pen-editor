import type { TextNode } from '../types/scene'
import { applyTextTransform } from './textTransform'
import { buildFontString, getLineLimit, wrapTextToLines } from './textWrap'

// Re-export the shared helpers so existing call sites keep their import path.
export { applyTextTransform } from './textTransform'
export { wrapTextToLines, buildFontString, truncateLines, getLineLimit } from './textWrap'

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
 */
export function measureTextAutoSize(node: TextNode): { width: number; height: number } {
  const ctx = getContext()
  const fontSize = node.fontSize ?? 16
  const lineHeight = node.lineHeight ?? 1.2
  const letterSpacing = node.letterSpacing ?? 0

  ctx.font = buildFontString(node)

  const text = applyTextTransform(node.text || '', node.textTransform)
  const lines = text.split('\n')

  let maxWidth = 0
  for (const line of lines) {
    const metrics = ctx.measureText(line)
    // Account for letter spacing: (charCount - 1) * spacing
    const lineWidth = metrics.width + Math.max(0, line.length - 1) * letterSpacing
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
 * Derived from `wrapTextToLines` so the measured height can never disagree with
 * the rendered/edited wrapping.
 */
export function measureTextFixedWidthHeight(node: TextNode): number {
  const fontSize = node.fontSize ?? 16
  const lineHeight = node.lineHeight ?? 1.2
  // A maxLines cap shrinks auto-height so the box never grows past the limit.
  // The 'fixed-height' height limit is irrelevant here (that mode keeps its own
  // fixed height), so getLineLimit only contributes maxLines in 'fixed' mode.
  const limit = getLineLimit(node)
  let lineCount = wrapTextToLines(node, node.width).length
  if (Number.isFinite(limit)) lineCount = Math.min(lineCount, limit)
  return Math.ceil(Math.max(1, lineCount) * fontSize * lineHeight)
}
