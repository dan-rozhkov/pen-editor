import { useRef, useEffect, useCallback, useMemo } from 'react'
import type { ParagraphAttrs, TextNode } from '../types/scene'
import { measureTextEditorVerticalOffset } from '../utils/textEditorMetrics'
import { useSceneStore, createSnapshot } from '../store/sceneStore'
import { useHistoryStore } from '../store/historyStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'
import { useVariableStore } from '../store/variableStore'
import { resolveColor } from '../utils/colorUtils'
import type { ThemeName } from '../types/variable'
import {
  LIST_INDENT_WIDTH,
  LIST_MARKER_GAP,
  getParagraphAttrs,
  normalizeParagraphs,
  splitParagraphs,
} from '../lib/textLists/paragraphs'
import { computeParagraphMarkerInfos } from '../lib/textLists/markers'
import { changeIndentLevel, continueListOnEnter, toggleListType } from '../lib/textLists/listEditing'
import { measureTextWidth } from '../utils/textWrap'

interface InlineTextEditorProps {
  node: TextNode
  absoluteX: number
  absoluteY: number
  effectiveTheme?: ThemeName
  onUpdateText?: (text: string, paragraphs?: ParagraphAttrs[]) => void
  isInsideAutoLayoutParent?: boolean
}

/** Marks a line-prefix span (bullet glyph / number) as non-editable content, so text extraction can skip it. */
const MARKER_ATTR = 'data-text-list-marker'

/** True for a list-marker prefix span — not "real" editable content. Shared predicate so extractEditorText/getCaretPosition/setCaretPosition can never disagree on what to skip. */
function isMarkerSpan(n: Node): boolean {
  return n instanceof HTMLElement && n.hasAttribute(MARKER_ATTR)
}

/**
 * Depth-first walk over `root`'s descendants, skipping list-marker spans
 * (and their subtree). `visit` runs on every non-marker node in document
 * order; returning `true` stops the walk early (used to locate a specific
 * node/offset). Shared by `getCaretPosition`/`setCaretPosition`/
 * `locateEditorPosition` so caret math can't drift between them.
 */
function walkEditableNodes(root: Node, visit: (n: Node) => boolean | void): boolean {
  const walk = (n: Node): boolean => {
    if (isMarkerSpan(n)) return false
    if (visit(n)) return true
    for (const child of Array.from(n.childNodes)) {
      if (walk(child)) return true
    }
    return false
  }
  return walk(root)
}

function toCssFontFamily(fontFamily: string): string {
  return fontFamily
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const isQuoted =
        (part.startsWith('"') && part.endsWith('"')) ||
        (part.startsWith("'") && part.endsWith("'"))
      const isGeneric =
        part === 'serif' ||
        part === 'sans-serif' ||
        part === 'monospace' ||
        part === 'cursive' ||
        part === 'fantasy' ||
        part === 'system-ui'
      if (isQuoted || isGeneric || !/\s/.test(part)) return part
      return `"${part}"`
    })
    .join(', ')
}

/**
 * Extract plain text from the contentEditable DOM with exact newline semantics.
 * `innerText` doubles empty lines (Chrome represents them as `<div><br></div>`,
 * which innerText renders as two newlines), so we walk the tree ourselves:
 * each block element starts a new line; a `<br>` that is the sole content of a
 * block is the empty-line placeholder, not an extra break.
 */
function extractEditorText(root: HTMLElement): string {
  const lines: string[] = []
  let current: string | null = null

  const visit = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      current = (current ?? '') + (n.textContent ?? '')
      return
    }
    if (!(n instanceof HTMLElement)) return
    if (isMarkerSpan(n)) return // list marker prefix — not real content
    if (n.tagName === 'BR') {
      const parent = n.parentElement
      // A marker span (if any) doesn't count as "real" sibling content — the
      // <br> is still the sole content placeholder for an empty list line.
      const realSiblingCount = parent
        ? Array.from(parent.childNodes).filter((c) => !isMarkerSpan(c)).length
        : 0
      const isPlaceholder = parent !== root && realSiblingCount === 1
      if (isPlaceholder) {
        current = current ?? ''
      } else {
        lines.push(current ?? '')
        current = null
      }
      return
    }
    if (n.tagName === 'DIV' || n.tagName === 'P') {
      if (current !== null) {
        lines.push(current)
        current = null
      }
      n.childNodes.forEach(visit)
      if (current === null) current = ''
      return
    }
    n.childNodes.forEach(visit)
  }

  root.childNodes.forEach(visit)
  if (current !== null) lines.push(current)
  return lines.join('\n')
}

/** Minimal font-relevant subset of TextNode needed to measure marker glyph widths. */
type MeasurableTextNode = Pick<
  TextNode,
  'text' | 'paragraphs' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle' | 'letterSpacing'
>

/**
 * Measure each paragraph's marker text width in px (0 for non-list
 * paragraphs), same font as the node. Reuses `measureTextWidth` (the same
 * shared measurement canvas `wrapTextToLines`/`layoutTextParagraphs` use) so
 * the marker width includes letter-spacing exactly like the Pixi renderer's
 * `layoutTextParagraphs` — a separate ad hoc measurement here would drift.
 */
function measureMarkerWidths(node: MeasurableTextNode): number[] {
  const markers = computeParagraphMarkerInfos(node)
  return markers.map((m) => (m ? measureTextWidth(node, m.text) : 0))
}

/**
 * Set editor content mirroring Chrome's native contentEditable structure
 * (one <div> per line, <br> placeholder for empty lines) so it round-trips
 * exactly through extractEditorText — including trailing newlines, which the
 * innerText setter would drop.
 *
 * List paragraphs additionally get a non-editable marker `<span>` (bullet
 * glyph / number) prefixed to the line, plus a CSS hanging-indent
 * (`padding-left` + negative `text-indent`) so wrapped continuation lines
 * align under the text rather than under the marker — mirrors the Pixi
 * renderer's `layoutTextParagraphs` geometry closely enough for editing.
 */
function setEditorText(root: HTMLElement, node: MeasurableTextNode) {
  root.textContent = ''
  const lines = splitParagraphs(node.text)
  const markers = computeParagraphMarkerInfos(node)
  const markerWidths = measureMarkerWidths(node)

  lines.forEach((line, i) => {
    const div = document.createElement('div')
    const marker = markers[i]

    if (marker) {
      const hangingPx = markerWidths[i] + LIST_MARKER_GAP
      const indentPx = marker.indentLevel * LIST_INDENT_WIDTH
      div.style.paddingLeft = `${indentPx + hangingPx}px`
      div.style.textIndent = `${-hangingPx}px`

      const markerSpan = document.createElement('span')
      markerSpan.setAttribute(MARKER_ATTR, 'true')
      markerSpan.contentEditable = 'false'
      markerSpan.style.userSelect = 'none'
      markerSpan.style.display = 'inline-block'
      markerSpan.textContent = marker.text
      div.appendChild(markerSpan)

      if (line) div.appendChild(document.createTextNode(line))
      else div.appendChild(document.createElement('br'))
    } else {
      if (line) div.textContent = line
      else div.appendChild(document.createElement('br'))
    }

    root.appendChild(div)
  })
}

/**
 * Locate which paragraph (line div) a DOM (container, offset) position falls
 * in, and its character offset within that paragraph's real text (marker
 * span excluded). Returns null if `container` isn't inside `root`. Shared by
 * `getCaretPosition` (collapsed caret) and `getSelectionExtent` (full
 * selection, which needs both endpoints).
 */
function locateEditorPosition(
  root: HTMLElement,
  container: Node,
  containerOffset: number,
): { paragraphIndex: number; offset: number } | null {
  let lineDiv: Node | null = container
  while (lineDiv && lineDiv.parentNode !== root) lineDiv = lineDiv.parentNode
  if (!lineDiv || !(lineDiv instanceof HTMLElement)) return null

  const paragraphIndex = Array.prototype.indexOf.call(root.childNodes, lineDiv)
  if (paragraphIndex < 0) return null

  let offset = 0
  let found = false
  walkEditableNodes(lineDiv, (n) => {
    if (n === container) {
      offset += containerOffset
      found = true
      return true
    }
    if (n.nodeType === Node.TEXT_NODE) {
      offset += n.textContent?.length ?? 0
    }
    return false
  })

  return { paragraphIndex, offset: found ? offset : 0 }
}

/** Find which paragraph (line div) the caret is in, and the caret's character offset within that paragraph's real text (marker span excluded). Returns null if there's no selection inside `root`. */
function getCaretPosition(root: HTMLElement): { paragraphIndex: number; offset: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  return locateEditorPosition(root, range.startContainer, range.startOffset)
}

/**
 * Full (possibly non-collapsed) selection as start/end paragraph+offset
 * positions, in DOM range order (start === anchor-or-focus whichever comes
 * first). Returns null if there's no selection inside `root`, or if either
 * endpoint can't be resolved to a paragraph.
 */
function getSelectionExtent(root: HTMLElement): {
  start: { paragraphIndex: number; offset: number }
  end: { paragraphIndex: number; offset: number }
  collapsed: boolean
} | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const start = locateEditorPosition(root, range.startContainer, range.startOffset)
  const end = locateEditorPosition(root, range.endContainer, range.endOffset)
  if (!start || !end) return null
  return { start, end, collapsed: range.collapsed }
}

/** Place the caret at `offset` characters into paragraph `paragraphIndex`'s real text (marker span excluded). */
function setCaretPosition(root: HTMLElement, paragraphIndex: number, offset: number): void {
  const lineDiv = root.childNodes[paragraphIndex]
  if (!lineDiv || !(lineDiv instanceof HTMLElement)) return

  let remaining = offset
  let target: Node = lineDiv
  let targetOffset = 0

  const found = walkEditableNodes(lineDiv, (n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = n.textContent?.length ?? 0
      if (remaining <= len) {
        target = n
        targetOffset = remaining
        return true
      }
      remaining -= len
    }
    return false
  })

  if (!found) {
    target = lineDiv
    targetOffset = lineDiv.childNodes.length
  }

  const range = document.createRange()
  range.setStart(target, targetOffset)
  range.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export function InlineTextEditor({
  node,
  absoluteX,
  absoluteY,
  effectiveTheme,
  onUpdateText,
  isInsideAutoLayoutParent = false,
}: InlineTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const currentTextRef = useRef(node.text) // Track current value for unmount save
  const currentParagraphsRef = useRef<ParagraphAttrs[]>(
    normalizeParagraphs(node.paragraphs, splitParagraphs(node.text).length),
  )
  const pendingTextRef = useRef<string | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const lastCommittedRef = useRef(node.text)
  const updateNodeWithoutHistory = useSceneStore(
    (state) => state.updateNodeWithoutHistory,
  )
  const stopEditing = useSelectionStore((state) => state.stopEditing)
  const { scale, x, y } = useViewportStore()
  const variables = useVariableStore((state) => state.variables)

  // Resolve the fill color (matching Konva rendering)
  const fillColor = resolveColor(
    node.fill,
    node.fillBinding,
    variables,
    effectiveTheme ?? 'light',
  ) ?? '#000000'

  // Calculate screen position from absolute world coordinates and snap to device pixels.
  const dpr = window.devicePixelRatio || 1
  const screenX = Math.round((absoluteX * scale + x) * dpr) / dpr
  const screenY = Math.round((absoluteY * scale + y) * dpr) / dpr
  const screenFontSize = (node.fontSize ?? 16) * scale
  const screenLetterSpacing = (node.letterSpacing ?? 0) * scale
  const fontStyle = node.fontStyle ?? 'normal'
  const fontWeight = String(node.fontWeight ?? 'normal')
  const fontFamily = toCssFontFamily(node.fontFamily ?? 'Arial')
  const editorFontShorthand = `${fontStyle} normal ${fontWeight} ${screenFontSize}px ${fontFamily}`

  // Width mode
  const isAutoWidth = node.textWidthMode === 'auto' || !node.textWidthMode
  const fixedScreenWidth = node.width * scale
  const fixedScreenHeight = node.height * scale
  const isFitContentInAutoLayout =
    isInsideAutoLayoutParent && node.sizing?.widthMode === 'fit_content'
  const shouldUseAutoTextBehavior = isAutoWidth || isFitContentInAutoLayout
  const isWrappedWidth = !shouldUseAutoTextBehavior

  // Build text decoration string
  const textDecorationParts: string[] = []
  if (node.underline) textDecorationParts.push('underline')
  if (node.strikethrough) textDecorationParts.push('line-through')

  const commitTextAndParagraphs = useCallback(
    (text: string, paragraphs?: ParagraphAttrs[]) => {
      if (text === lastCommittedRef.current && paragraphs === undefined) return
      lastCommittedRef.current = text
      if (onUpdateText) {
        onUpdateText(text, paragraphs)
      } else {
        const updates: Partial<TextNode> = { text }
        if (paragraphs !== undefined) updates.paragraphs = paragraphs
        updateNodeWithoutHistory(node.id, updates)
      }
    },
    [node.id, updateNodeWithoutHistory, onUpdateText],
  )

  // Always resolves `paragraphs` alongside `text` (via the same normalize
  // helper the discrete list actions use below), rather than omitting it.
  // Native contentEditable edits that change the line count — backspace
  // merging two lines, a multi-line paste (there is no onPaste handler, so
  // pasted newlines fall through to native insertion), a cross-line cut, or
  // the blur/unmount save path — all go through this single commit path, so
  // without re-deriving here the paragraphs array would silently desync
  // (stale length / index-shifted) from the new text.
  const commitText = useCallback(
    (text: string) => {
      const paragraphs = normalizeParagraphs(currentParagraphsRef.current, splitParagraphs(text).length)
      currentParagraphsRef.current = paragraphs
      commitTextAndParagraphs(text, paragraphs)
    },
    [commitTextAndParagraphs],
  )

  /** Rebuild the whole contentEditable DOM from `text`/`paragraphs` (list markers + hanging indent recomputed), restore the caret, and commit both fields. Used by the discrete Enter/Tab list actions below — simpler and safer than trying to patch the DOM incrementally. */
  const rebuildAndCommit = useCallback(
    (text: string, paragraphs: ParagraphAttrs[], caretParagraphIndex: number, caretOffset: number) => {
      const el = editorRef.current
      if (!el) return
      setEditorText(el, { ...node, text, paragraphs })
      setCaretPosition(el, caretParagraphIndex, caretOffset)
      currentTextRef.current = text
      currentParagraphsRef.current = paragraphs
      commitTextAndParagraphs(text, paragraphs)
    },
    [node, commitTextAndParagraphs],
  )

  const handleTabKey = useCallback(
    (direction: 1 | -1) => {
      const el = editorRef.current
      if (!el) return
      const caret = getCaretPosition(el)
      if (!caret) return
      const text = currentTextRef.current
      const lineCount = splitParagraphs(text).length
      const updated = changeIndentLevel(
        currentParagraphsRef.current,
        lineCount,
        caret.paragraphIndex,
        direction,
      )
      rebuildAndCommit(text, updated, caret.paragraphIndex, caret.offset)
    },
    [rebuildAndCommit],
  )

  const handleEnterKey = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    const extent = getSelectionExtent(el)
    if (!extent) return

    let lines = splitParagraphs(currentTextRef.current)
    let paragraphs = currentParagraphsRef.current
    let paragraphIndex = extent.start.paragraphIndex
    let offset = extent.start.offset

    if (!extent.collapsed) {
      // A non-collapsed selection (possibly spanning multiple lines) must be
      // deleted before splitting, matching native contentEditable Enter
      // semantics (which replace the selection rather than splitting around
      // it — plain Enter used to fall through to native behavior pre-lists,
      // so this preserves that for the common case of selecting text and
      // pressing Enter to replace it with a line break).
      const { start, end } = extent
      const mergedLine =
        (lines[start.paragraphIndex] ?? '').slice(0, start.offset) +
        (lines[end.paragraphIndex] ?? '').slice(end.offset)
      lines = [...lines.slice(0, start.paragraphIndex), mergedLine, ...lines.slice(end.paragraphIndex + 1)]
      paragraphs = normalizeParagraphs(paragraphs, lines.length)
      paragraphIndex = start.paragraphIndex
      offset = start.offset
    }

    const lineText = lines[paragraphIndex] ?? ''
    const before = lineText.slice(0, offset)
    const after = lineText.slice(offset)
    const isEmpty = lineText.trim() === ''

    const { paragraphs: updatedParagraphs } = continueListOnEnter(
      paragraphs,
      lines.length,
      paragraphIndex,
      isEmpty,
    )

    const newLines = [...lines]
    newLines.splice(paragraphIndex, 1, before, after)
    const text = newLines.join('\n')

    rebuildAndCommit(text, updatedParagraphs, paragraphIndex + 1, 0)
  }, [rebuildAndCommit])

  /** Cmd/Ctrl+Shift+8 (bullet) / +7 (numbered) — Figma parity — toggles the list type of the current paragraph only. */
  const handleToggleListHotkey = useCallback(
    (listType: 'bullet' | 'number') => {
      const el = editorRef.current
      if (!el) return
      const caret = getCaretPosition(el)
      if (!caret) return
      const text = currentTextRef.current
      const lineCount = splitParagraphs(text).length
      const updated = toggleListType(
        currentParagraphsRef.current,
        lineCount,
        caret.paragraphIndex,
        caret.paragraphIndex,
        listType,
      )
      rebuildAndCommit(text, updated, caret.paragraphIndex, caret.offset)
    },
    [rebuildAndCommit],
  )

  const flushPendingText = useCallback(
    (textOverride?: string) => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      const text = textOverride ?? pendingTextRef.current
      pendingTextRef.current = null
      if (text !== undefined && text !== null) {
        commitText(text)
      }
    },
    [commitText],
  )

  const scheduleCommit = useCallback(
    (text: string) => {
      pendingTextRef.current = text
      if (rafIdRef.current !== null) return
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        const pending = pendingTextRef.current
        pendingTextRef.current = null
        if (pending !== null) {
          commitText(pending)
        }
      })
    },
    [commitText],
  )

  const submit = useCallback(() => {
    const el = editorRef.current
    if (!el) {
      stopEditing()
      return
    }
    const text = extractEditorText(el)
    // Commit untrimmed (trailing newlines are real content, as in Figma);
    // whitespace-only edits are not committed.
    if (text.trim() && text !== node.text) {
      flushPendingText(text)
    }
    stopEditing()
  }, [node.text, stopEditing, flushPendingText])

  // Save on unmount (DOM element is already gone, so read from ref)
  useEffect(() => {
    return () => {
      flushPendingText()
      const text = currentTextRef.current
      if (text.trim() && text !== node.text) {
        commitText(text)
      }
    }
  }, [node.text, commitText, flushPendingText])

  // Focus and select all text on mount
  useEffect(() => {
    useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()))
    const el = editorRef.current
    if (!el) return
    setEditorText(el, node)
    currentTextRef.current = node.text
    currentParagraphsRef.current = normalizeParagraphs(node.paragraphs, splitParagraphs(node.text).length)
    el.focus()
    // Select all text
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // Mount-only: intentionally does not react to `node` changes (that's the
    // sync effect below); only reads the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external text updates without resetting caret
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (document.activeElement === el) {
      // While user is actively typing, avoid forcing innerText from store
      // to prevent cursor jumping to start.
      lastCommittedRef.current = node.text
      return
    }
    const normalizedIncoming = normalizeParagraphs(node.paragraphs, splitParagraphs(node.text).length)
    if (node.text !== currentTextRef.current) {
      setEditorText(el, node)
      currentTextRef.current = node.text
      currentParagraphsRef.current = normalizedIncoming
    } else if (JSON.stringify(normalizedIncoming) !== JSON.stringify(currentParagraphsRef.current)) {
      // Text is unchanged but paragraphs (list formatting) changed externally
      // (e.g. a properties-panel edit while not focused) — rebuild so markers
      // reflect it, and keep the ref in sync either way.
      setEditorText(el, node)
      currentParagraphsRef.current = normalizedIncoming
    }
    lastCommittedRef.current = node.text
  }, [node])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Figma parity: Enter inserts a line break; Esc commits.
    // Cmd/Ctrl+Enter also commits and exits editing.
    if (e.key === 'Escape') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Enter') {
      // Custom split (rather than falling through to contentEditable) so the
      // paragraph-attrs array (list continuation) stays in sync with the new
      // line — see handleEnterKey.
      e.preventDefault()
      handleEnterKey()
    } else if (e.key === 'Tab') {
      // Only hijack Tab to indent/outdent when the current paragraph is
      // actually part of a list — on plain text, let native Tab behavior
      // proceed (e.g. blur out of the editor), and never persist an
      // indentLevel onto a listType: 'none' paragraph.
      const el = editorRef.current
      const caret = el ? getCaretPosition(el) : null
      const attrs = caret
        ? getParagraphAttrs({ paragraphs: currentParagraphsRef.current }, caret.paragraphIndex)
        : null
      if (attrs && attrs.listType !== 'none') {
        e.preventDefault()
        handleTabKey(e.shiftKey ? -1 : 1)
      }
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === 'Digit8' || e.code === 'Digit7')) {
      // Figma parity: Cmd/Ctrl+Shift+8 = bulleted list, +7 = numbered list.
      // `code` (physical key) rather than `key` so it's layout-independent
      // (Shift+8 is '*' on a US layout, not the literal character "8").
      e.preventDefault()
      handleToggleListHotkey(e.code === 'Digit8' ? 'bullet' : 'number')
    }
    // Stop propagation so canvas shortcuts don't fire
    e.stopPropagation()
  }

  const handleInput = () => {
    const el = editorRef.current
    if (el) {
      const text = extractEditorText(el)
      currentTextRef.current = text
      if (text !== node.text) {
        // Never live-commit while editing inside auto-layout:
        // avoid parent/ancestor reflow (visible frame shift) on each keystroke.
        if (isInsideAutoLayoutParent) {
          pendingTextRef.current = text
        } else {
          scheduleCommit(text)
        }
      }
    }
  }

  const handleBlur = () => {
    submit()
  }

  // Compute dimensions
  const shouldUseDynamicAutoSize = shouldUseAutoTextBehavior
  const widthStyle: React.CSSProperties['width'] = shouldUseDynamicAutoSize ? 'max-content' : fixedScreenWidth
  const heightStyle: React.CSSProperties['height'] = shouldUseDynamicAutoSize ? 'auto' : fixedScreenHeight
  const minWidthStyle: React.CSSProperties['minWidth'] = shouldUseDynamicAutoSize ? fixedScreenWidth : undefined
  const lineHeightValue = (node.lineHeight ?? 1.2) * screenFontSize
  const lineHeightPx = `${lineHeightValue}px`

  // Reconcile the DOM line-box centering with Pixi's baseline placement so the
  // text does not "jump" vertically when entering/leaving edit mode (most
  // visible at tight line-heights, e.g. lineHeight = 1). See the util for the
  // full explanation. Recomputed whenever the font metrics or zoom change.
  const textYOffset = useMemo(
    () => measureTextEditorVerticalOffset(editorFontShorthand, lineHeightValue),
    [editorFontShorthand, lineHeightValue],
  )

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onKeyDown={handleKeyDown}
      onInput={handleInput}
      onBlur={handleBlur}
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        width: widthStyle,
        height: heightStyle,
        minWidth: minWidthStyle,
        // Font styles matching Konva
        font: editorFontShorthand,
        fontSynthesis: 'none',
        textDecoration: textDecorationParts.join(' ') || undefined,
        lineHeight: lineHeightPx,
        letterSpacing: screenLetterSpacing,
        textAlign: (node.textAlign ?? 'left') as React.CSSProperties['textAlign'],
        color: fillColor,
        // Layout
        padding: 0,
        margin: 0,
        border: 'none',
        outline: '2px solid var(--color-accent-light)',
        outlineOffset: 0,
        background: 'transparent',
        zIndex: 100,
        boxSizing: 'content-box',
        display: 'inline-block',
        whiteSpace: isWrappedWidth ? 'pre-wrap' : 'pre',
        // overflowWrap: break-word breaks only words wider than the box;
        // wordBreak: normal keeps word-boundary wrapping (the old break-word
        // over-broke). Matches wrapTextToLines as closely as the browser allows.
        overflowWrap: isWrappedWidth ? 'break-word' : 'normal',
        wordBreak: 'normal',
        // Fixed-size overflow renders outside the box (Figma parity), not clipped.
        overflow: 'visible',
        cursor: 'text',
        textTransform: node.textTransform === 'capitalize' ? 'capitalize'
          : node.textTransform === 'uppercase' ? 'uppercase'
          : node.textTransform === 'lowercase' ? 'lowercase'
          : undefined,
        // Reset any inherited styles
        textIndent: 0,
        // Align the DOM text baseline with Pixi's (see textEditorMetrics).
        transform: textYOffset ? `translateY(${textYOffset}px)` : undefined,
      }}
    />
  )
}
