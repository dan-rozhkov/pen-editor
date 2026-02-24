import { useRef, useEffect, useCallback } from 'react'
import type { TextNode } from '../types/scene'
import { useSceneStore, createSnapshot } from '../store/sceneStore'
import { useHistoryStore } from '../store/historyStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'
import { useVariableStore } from '../store/variableStore'
import { useThemeStore } from '../store/themeStore'
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
  const activeTheme = useThemeStore((state) => state.activeTheme)

  // Resolve the fill color (matching Konva rendering)
  const fillColor = resolveColor(
    node.fill,
    node.fillBinding,
    variables,
    effectiveTheme ?? activeTheme,
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
  const isFixedHeight = node.textWidthMode === 'fixed-height'
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
    // Extract plain text from contentEditable (preserving newlines from <br>/<div>)
    const text = el.innerText ?? el.textContent ?? ''
    const trimmed = text.trim()
    if (trimmed && trimmed !== node.text) {
      flushPendingText(trimmed)
    }
    stopEditing()
  }, [node.text, stopEditing, flushPendingText])

  // Save on unmount (DOM element is already gone, so read from ref)
  useEffect(() => {
    return () => {
      flushPendingText()
      const trimmed = currentTextRef.current.trim()
      if (trimmed && trimmed !== node.text) {
        commitText(trimmed)
      }
    }
  }, [node.text, commitText, flushPendingText])

  // Focus and select all text on mount
  useEffect(() => {
    useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()))
    const el = editorRef.current
    if (!el) return
    el.innerText = node.text
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
      el.innerText = node.text
      currentTextRef.current = node.text
    }
    lastCommittedRef.current = node.text
  }, [node.text])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      stopEditing()
    }
    // Stop propagation so canvas shortcuts don't fire
    e.stopPropagation()
  }

  const handleInput = () => {
    const el = editorRef.current
    if (el) {
      const text = el.innerText ?? el.textContent ?? ''
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
  const shouldUseDynamicAutoSize =
    shouldUseAutoTextBehavior &&
    (!isInsideAutoLayoutParent || isFitContentInAutoLayout)
  const shouldClipToBox =
    isInsideAutoLayoutParent && shouldUseAutoTextBehavior && !isFitContentInAutoLayout
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
        wordBreak: isWrappedWidth ? 'break-word' : 'normal',
        overflow: isFixedHeight || shouldClipToBox ? 'hidden' : 'visible',
        cursor: 'text',
        // Reset any inherited styles
        textIndent: 0,
      }}
    />
  )
}
