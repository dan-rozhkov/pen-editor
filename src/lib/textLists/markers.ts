import type { TextNode } from '@/types/scene'
import { MAX_INDENT_LEVEL, getBulletGlyph, getParagraphAttrs, splitParagraphs } from './paragraphs'

export interface ParagraphMarkerInfo {
  listType: 'bullet' | 'number'
  indentLevel: number
  /** Rendered marker text: a bullet glyph, or "N." for numbered lists. */
  text: string
}

/**
 * Compute the marker (bullet glyph / running number) for every paragraph in a
 * text node, or `null` for paragraphs that aren't list items.
 *
 * Numbering restarts per indent level and resets deeper levels whenever a
 * shallower-or-equal paragraph interrupts the run — this is the usual nested
 * outline behavior (a bullet or plain paragraph at level 0 resets numbering
 * at level 0 and everything nested under it, but leaves a still-open level-1
 * counter elsewhere untouched only if it's genuinely a different branch;
 * kept intentionally simple: any paragraph at level N resets counters for
 * levels > N, and a non-numbered paragraph at level N also resets the
 * counter at level N itself).
 */
export function computeParagraphMarkerInfos(
  node: Pick<TextNode, 'text' | 'paragraphs'>,
): (ParagraphMarkerInfo | null)[] {
  const paragraphs = splitParagraphs(node.text)
  const counters = new Array<number>(MAX_INDENT_LEVEL + 1).fill(0)

  return paragraphs.map((_, index) => {
    const attrs = getParagraphAttrs(node, index)

    // Any paragraph "closes" deeper nesting levels' running counters.
    for (let level = attrs.indentLevel + 1; level <= MAX_INDENT_LEVEL; level++) {
      counters[level] = 0
    }

    if (attrs.listType === 'none') {
      counters[attrs.indentLevel] = 0
      return null
    }

    if (attrs.listType === 'bullet') {
      counters[attrs.indentLevel] = 0
      return {
        listType: 'bullet',
        indentLevel: attrs.indentLevel,
        text: getBulletGlyph(attrs.indentLevel),
      }
    }

    // Numbered — continue the running counter at this indent level.
    counters[attrs.indentLevel] += 1
    return {
      listType: 'number',
      indentLevel: attrs.indentLevel,
      text: `${counters[attrs.indentLevel]}.`,
    }
  })
}
