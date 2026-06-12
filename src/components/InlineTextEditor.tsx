import { useRef, useEffect, useCallback } from 'react'
import type { TextNode } from '../types/scene'
import { useSceneStore, createSnapshot } from '../store/sceneStore'
import { useHistoryStore } from '../store/historyStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'
import { useVariableStore } from '../store/variableStore'
import { resolveColor } from '../utils/colorUtils'
import type { ThemeName } from '../types/variable'

interface InlineTextEditorProps {
  node: TextNode
  absoluteX: number
  absoluteY: number
  effectiveTheme?: ThemeName
  onUpdateText?: (text: string) => void
  isInsideAutoLayoutParent?: boolean
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
    if (n.tagName === 'BR') {
      const parent = n.parentElement
      const isPlaceholder = parent !== root && parent?.childNodes.length === 1
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

/**
 * Set editor content mirroring Chrome's native contentEditable structure
 * (one <div> per line, <br> placeholder for empty lines) so it round-trips
 * exactly through extractEditorText — including trailing newlines, which the
 * innerText setter would drop.
 */
function setEditorText(root: HTMLElement, text: string) {
  root.textContent = ''
  for (const line of text.split('\n')) {
    const div = document.createElement('div')
    if (line) div.textContent = line
    else div.appendChild(document.createElement('br'))
    root.appendChild(div)
  }
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

  const commitText = useCallback(
    (text: string) => {
      if (text === lastCommittedRef.current) return
      lastCommittedRef.current = text
      if (onUpdateText) {
        onUpdateText(text)
      } else {
        updateNodeWithoutHistory(node.id, { text })
      }
    },
    [node.id, updateNodeWithoutHistory, onUpdateText],
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
    setEditorText(el, node.text)
    currentTextRef.current = node.text
    el.focus()
    // Select all text
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
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
    if (node.text !== currentTextRef.current) {
      setEditorText(el, node.text)
      currentTextRef.current = node.text
    }
    lastCommittedRef.current = node.text
  }, [node.text])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Figma parity: Enter inserts a line break; Esc commits.
    // (Both plain Enter and Shift+Enter fall through to contentEditable.)
    if (e.key === 'Escape') {
      e.preventDefault()
      submit()
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
  const lineHeightPx = `${(node.lineHeight ?? 1.2) * screenFontSize}px`

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
        outline: '2px solid #0d99ff',
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
      }}
    />
  )
}
