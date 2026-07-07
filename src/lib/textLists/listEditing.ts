import type { ParagraphAttrs } from '@/types/scene'
import { MAX_INDENT_LEVEL, normalizeParagraphs } from './paragraphs'

export interface EnterResult {
  /** The full paragraph-attrs array after the split, one entry longer than before. */
  paragraphs: ParagraphAttrs[]
  /** True when Enter was pressed on an empty list paragraph, exiting the list instead of continuing it. */
  exitedList: boolean
}

/**
 * Compute the paragraph-attrs array after pressing Enter inside paragraph
 * `atIndex` (splitting it into two paragraphs — the caller is responsible for
 * splitting the text itself the same way).
 *
 * Figma/Notion parity: pressing Enter on a non-empty list paragraph continues
 * the list (the new paragraph inherits `listType`/`indentLevel`). Pressing
 * Enter on an *empty* list paragraph exits the list instead (clears that
 * paragraph's own list formatting rather than creating another empty bullet).
 */
export function continueListOnEnter(
  paragraphs: ParagraphAttrs[] | undefined,
  count: number,
  atIndex: number,
  currentParagraphTextIsEmpty: boolean,
): EnterResult {
  const normalized = normalizeParagraphs(paragraphs, count)
  const current = normalized[atIndex] ?? {}
  const currentListType = current.listType ?? 'none'
  const currentIndentLevel = current.indentLevel ?? 0

  const next = [...normalized]

  if (currentListType !== 'none' && currentParagraphTextIsEmpty) {
    next[atIndex] = { listType: 'none', indentLevel: 0 }
    next.splice(atIndex + 1, 0, {})
    return { paragraphs: next, exitedList: true }
  }

  next.splice(atIndex + 1, 0, { listType: currentListType, indentLevel: currentIndentLevel })
  return { paragraphs: next, exitedList: false }
}

/**
 * Compute the paragraph-attrs array after Tab (`direction: 1`, indent) or
 * Shift+Tab (`direction: -1`, outdent) on paragraph `atIndex`. Clamped to
 * [0, MAX_INDENT_LEVEL].
 */
export function changeIndentLevel(
  paragraphs: ParagraphAttrs[] | undefined,
  count: number,
  atIndex: number,
  direction: 1 | -1,
): ParagraphAttrs[] {
  const normalized = normalizeParagraphs(paragraphs, count)
  const current = normalized[atIndex] ?? {}
  const currentIndentLevel = current.indentLevel ?? 0
  const indentLevel = Math.max(0, Math.min(MAX_INDENT_LEVEL, currentIndentLevel + direction))
  normalized[atIndex] = { ...current, indentLevel }
  return normalized
}

/**
 * Toggle a list type on/off for a set of paragraphs (used by the panel
 * buttons + hotkeys). If every targeted paragraph already has `listType`,
 * toggles it off (back to 'none'); otherwise turns it on for all of them
 * (mirrors typical bullet/numbered toggle-button semantics).
 */
export function toggleListType(
  paragraphs: ParagraphAttrs[] | undefined,
  count: number,
  fromIndex: number,
  toIndex: number,
  listType: 'bullet' | 'number',
): ParagraphAttrs[] {
  const normalized = normalizeParagraphs(paragraphs, count)
  const lo = Math.max(0, Math.min(fromIndex, toIndex))
  const hi = Math.min(count - 1, Math.max(fromIndex, toIndex))

  let allAlreadySet = true
  for (let i = lo; i <= hi; i++) {
    if ((normalized[i]?.listType ?? 'none') !== listType) {
      allAlreadySet = false
      break
    }
  }

  for (let i = lo; i <= hi; i++) {
    const current = normalized[i] ?? {}
    normalized[i] = allAlreadySet
      ? { ...current, listType: 'none' }
      : { ...current, listType, indentLevel: current.indentLevel ?? 0 }
  }

  return normalized
}
