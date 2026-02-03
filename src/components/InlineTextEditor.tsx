import { useRef, useEffect, useCallback } from 'react'
import type { TextNode } from '../types/scene'
import { useSceneStore } from '../store/sceneStore'
import { useHistoryStore } from '../store/historyStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'
import { useVariableStore } from '../store/variableStore'
import { useThemeStore } from '../store/themeStore'
import { resolveColor } from '../utils/colorUtils'

interface InlineTextEditorProps {
  node: TextNode
  absoluteX: number
  absoluteY: number
}

export function InlineTextEditor({ node, absoluteX, absoluteY }: InlineTextEditorProps) {
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
  const fillColor = resolveColor(node.fill, node.fillBinding, variables, activeTheme) ?? '#000000'

  // Calculate screen position from absolute world coordinates
  const screenX = absoluteX * scale + x
  const screenY = absoluteY * scale + y
  const screenFontSize = (node.fontSize ?? 16) * scale
  const screenLetterSpacing = (node.letterSpacing ?? 0) * scale

  // Width mode
  const isAutoWidth = node.textWidthMode === 'auto' || !node.textWidthMode
  const isFixedHeight = node.textWidthMode === 'fixed-height'
  const fixedScreenWidth = node.width * scale
  const fixedScreenHeight = node.height * scale

  // Build text decoration string
  const textDecorationParts: string[] = []
  if (node.underline) textDecorationParts.push('underline')
  if (node.strikethrough) textDecorationParts.push('line-through')

  const commitText = useCallback(
    (text: string) => {
      if (text === lastCommittedRef.current) return
      lastCommittedRef.current = text
      updateNodeWithoutHistory(node.id, { text })
    },
    [node.id, updateNodeWithoutHistory],
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
    useHistoryStore.getState().saveHistory(useSceneStore.getState().nodes)
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
        scheduleCommit(text)
      }
    }
  }

  const handleBlur = () => {
    submit()
  }

  // Compute dimensions
  const widthStyle: React.CSSProperties['width'] = isAutoWidth ? 'max-content' : fixedScreenWidth
  const minWidth = isAutoWidth ? 50 : undefined
  const heightStyle: React.CSSProperties['height'] = isFixedHeight ? fixedScreenHeight : 'auto'
  const minHeight = isFixedHeight ? undefined : 24

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
        minWidth,
        height: heightStyle,
        minHeight,
        // Font styles matching Konva
        fontSize: screenFontSize,
        fontFamily: node.fontFamily ?? 'Arial',
        fontWeight: (node.fontWeight ?? 'normal') as React.CSSProperties['fontWeight'],
        fontStyle: (node.fontStyle ?? 'normal') as React.CSSProperties['fontStyle'],
        textDecoration: textDecorationParts.join(' ') || undefined,
        lineHeight: node.lineHeight ?? 1.2,
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
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: isFixedHeight ? 'hidden' : 'visible',
        cursor: 'text',
        // Reset any inherited styles
        textIndent: 0,
      }}
    />
  )
}
