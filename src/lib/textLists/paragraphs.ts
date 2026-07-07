import type { ListType, ParagraphAttrs, TextNode } from '@/types/scene'

/** Deepest indent level a paragraph can reach (Figma allows a handful of nesting levels). */
export const MAX_INDENT_LEVEL = 8

/** Horizontal space, in px, contributed by each indent level. */
export const LIST_INDENT_WIDTH = 24

/** Gap, in px, between a marker (bullet/number) and the paragraph text that follows it. */
export const LIST_MARKER_GAP = 8

/** Bullet glyph cycled by indent level (Figma/Word convention: solid, ring, square). */
export const BULLET_GLYPHS = ['•', '◦', '▪']

export function getBulletGlyph(indentLevel: number): string {
  return BULLET_GLYPHS[((indentLevel % BULLET_GLYPHS.length) + BULLET_GLYPHS.length) % BULLET_GLYPHS.length]
}

function clampIndent(level: number | undefined): number {
  const n = Math.round(level ?? 0)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, MAX_INDENT_LEVEL)
}

/** Split a text node's content into paragraphs (hard line breaks — same boundary as `wrapTextToLines`). */
export function splitParagraphs(text: string): string[] {
  return text.split('\n')
}

/** Resolved (defaulted) attributes for one paragraph. Always returns a concrete value, never undefined. */
export function getParagraphAttrs(
  node: Pick<TextNode, 'paragraphs'>,
  index: number,
): Required<ParagraphAttrs> {
  const raw = node.paragraphs?.[index]
  return {
    listType: raw?.listType ?? 'none',
    indentLevel: clampIndent(raw?.indentLevel),
  }
}

/**
 * Resize a paragraph-attrs array to exactly `count` entries (padding with `{}`
 * defaults, truncating extras). Used whenever the paragraph count changes
 * (typing a newline, deleting a line, pasting multi-line text) to keep the
 * array index-aligned with `text.split('\n')`.
 */
export function normalizeParagraphs(
  paragraphs: ParagraphAttrs[] | undefined,
  count: number,
): ParagraphAttrs[] {
  const result: ParagraphAttrs[] = []
  for (let i = 0; i < count; i++) {
    const entry = paragraphs?.[i]
    result.push(entry ? { ...entry } : {})
  }
  return result
}

/** True if the node has at least one paragraph with an active list (bullet/number). */
export function hasActiveList(node: Pick<TextNode, 'text' | 'paragraphs'>): boolean {
  if (!node.paragraphs || node.paragraphs.length === 0) return false
  const count = splitParagraphs(node.text).length
  for (let i = 0; i < count; i++) {
    if (getParagraphAttrs(node, i).listType !== 'none') return true
  }
  return false
}

export function isListType(value: unknown): value is ListType {
  return value === 'none' || value === 'bullet' || value === 'number'
}
