import type { TextNode } from '../types/scene'

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
 * Build a CSS font string from TextNode properties.
 * Format: "[style] [weight] <size>px <family>"
 */
function buildFontString(node: TextNode): string {
  const style = node.fontStyle ?? 'normal'
  const weight = node.fontWeight ?? 'normal'
  const size = node.fontSize ?? 16
  const family = node.fontFamily ?? 'Arial'
  return `${style} ${weight} ${size}px ${family}`
}

/**
 * Measure the rendered dimensions of a text node in "auto" mode
 * (single line, no wrapping).
 */
export function measureTextAutoSize(node: TextNode): { width: number; height: number } {
  const ctx = getContext()
  const fontSize = node.fontSize ?? 16
  const lineHeight = node.lineHeight ?? 1.2
  const letterSpacing = node.letterSpacing ?? 0

  ctx.font = buildFontString(node)

  const text = node.text || ''
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
 */
export function measureTextFixedWidthHeight(node: TextNode): number {
  const fontSize = node.fontSize ?? 16
  const lineHeight = node.lineHeight ?? 1.2
  const letterSpacing = node.letterSpacing ?? 0
  const ctx = getContext()
  ctx.font = buildFontString(node)

  const text = node.text || ''
  const maxWidth = node.width

  let totalLines = 0

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      totalLines++
      continue
    }
    const words = paragraph.split(/\s+/)
    let currentLine = ''
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const metrics = ctx.measureText(testLine)
      const testWidth = metrics.width + Math.max(0, testLine.length - 1) * letterSpacing
      if (testWidth > maxWidth && currentLine) {
        totalLines++
        currentLine = word
      } else {
        currentLine = testLine
      }
    }
    totalLines++
  }

  return Math.ceil(Math.max(1, totalLines) * fontSize * lineHeight)
}
