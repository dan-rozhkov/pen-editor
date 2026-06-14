// Text-node conversion, including font-weight inference and the resolution of
// Figma's per-character style overrides down to a single dominant style.

import type {
  TextAlign,
  TextAlignVertical,
  TextNode,
  TextTransform,
  TextWidthMode,
} from '@/types/scene'
import type { FigNodeChange } from '../figTypes'
import { buildBase } from './base'
import { mergeChange } from './overrides'
import type { ConvertContext } from './types'

const FONT_WEIGHTS: [RegExp, string][] = [
  [/extra\s*black|ultra\s*black/, '950'],
  [/black|heavy/, '900'],
  [/extra\s*bold|ultra\s*bold/, '800'],
  [/semi\s*bold|demi\s*bold|demi/, '600'],
  [/bold/, '700'],
  [/medium/, '500'],
  [/extra\s*light|ultra\s*light/, '200'],
  [/light/, '300'],
  [/thin|hairline/, '100'],
]

function fontWeightFromStyle(style: string): string | undefined {
  const normalized = style.toLowerCase()
  for (const [pattern, weight] of FONT_WEIGHTS) {
    if (pattern.test(normalized)) return weight
  }
  return undefined
}

const TEXT_ALIGN_MAP: Record<string, TextAlign> = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
  JUSTIFIED: 'left',
}

const TEXT_ALIGN_VERTICAL_MAP: Record<string, TextAlignVertical> = {
  TOP: 'top',
  CENTER: 'middle',
  BOTTOM: 'bottom',
}

const TEXT_CASE_MAP: Partial<Record<string, TextTransform>> = {
  UPPER: 'uppercase',
  LOWER: 'lowercase',
  TITLE: 'capitalize',
}

const TEXT_WIDTH_MODE_MAP: Record<string, TextWidthMode> = {
  WIDTH_AND_HEIGHT: 'auto',
  HEIGHT: 'fixed',
  NONE: 'fixed-height',
}

/**
 * Figma keeps the style a text node was created with in the top-level fields
 * and records later edits as per-character overrides: characterStyleIDs maps
 * each character to a styleOverrideTable entry (0 = base style). A text whose
 * font was changed after creation therefore still carries the stale base font
 * (typically Inter). Resolve the style covering the most characters and merge
 * it over the base so the visible style wins.
 */
function resolveTextStyle(change: FigNodeChange): { change: FigNodeChange; mixed: boolean } {
  const ids = change.textData?.characterStyleIDs ?? []
  if (ids.length === 0) return { change, mixed: false }

  // Characters beyond the ids array keep the base style (id 0)
  const baseCount = Math.max((change.textData?.characters?.length ?? 0) - ids.length, 0)
  const counts = new Map([[0, baseCount]])
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  if (counts.get(0) === 0) counts.delete(0)

  // Base style wins ties (it was inserted first)
  let dominantId = 0
  let dominantCount = 0
  for (const [id, count] of counts) {
    if (count > dominantCount) {
      dominantId = id
      dominantCount = count
    }
  }

  const override =
    dominantId !== 0
      ? change.textData?.styleOverrideTable?.find((entry) => entry.styleID === dominantId)
      : undefined
  return { change: override ? mergeChange(change, override) : change, mixed: counts.size > 1 }
}

export function convertText(rawChange: FigNodeChange, ctx: ConvertContext): TextNode {
  const { change, mixed } = resolveTextStyle(rawChange)
  const base = buildBase(change, ctx)
  const node: TextNode = {
    type: 'text',
    ...base,
    text: change.textData?.characters ?? '',
  }
  if (change.fontSize) node.fontSize = change.fontSize
  if (change.fontName?.family) node.fontFamily = change.fontName.family
  const style = change.fontName?.style ?? ''
  const weight = fontWeightFromStyle(style)
  if (weight) node.fontWeight = weight
  if (/italic|oblique/i.test(style)) node.fontStyle = 'italic'

  const fontSize = change.fontSize ?? 12
  if (change.lineHeight) {
    if (change.lineHeight.units === 'PIXELS' && fontSize > 0) {
      node.lineHeight = change.lineHeight.value / fontSize
    } else if (change.lineHeight.units === 'PERCENT') {
      node.lineHeight = change.lineHeight.value / 100
    }
    // RAW means "auto" — leave the renderer default
  }
  if (change.letterSpacing && change.letterSpacing.value !== 0) {
    node.letterSpacing =
      change.letterSpacing.units === 'PERCENT'
        ? (fontSize * change.letterSpacing.value) / 100
        : change.letterSpacing.value
  }

  if (change.textAlignHorizontal && change.textAlignHorizontal !== 'LEFT') {
    node.textAlign = TEXT_ALIGN_MAP[change.textAlignHorizontal] ?? 'left'
  }
  if (change.textAlignVertical && change.textAlignVertical !== 'TOP') {
    node.textAlignVertical = TEXT_ALIGN_VERTICAL_MAP[change.textAlignVertical] ?? 'top'
  }
  const transform = change.textCase ? TEXT_CASE_MAP[change.textCase] : undefined
  if (transform) node.textTransform = transform
  if (change.textDecoration === 'UNDERLINE') node.underline = true
  if (change.textDecoration === 'STRIKETHROUGH') node.strikethrough = true

  node.textWidthMode = TEXT_WIDTH_MODE_MAP[change.textAutoResize ?? 'NONE'] ?? 'fixed-height'

  if (mixed) {
    ctx.warnings.push(
      `Text "${change.name ?? node.text.slice(0, 20)}" has mixed styles; the dominant style was applied`,
    )
  }
  return node
}
