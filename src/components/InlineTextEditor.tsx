import { useRef, useEffect, useState } from 'react'
import type { TextNode } from '../types/scene'
import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'

interface InlineTextEditorProps {
  node: TextNode
  absoluteX: number
  absoluteY: number
}

const MIN_WIDTH = 50
const MIN_HEIGHT = 24
const PADDING = 8

export function InlineTextEditor({ node, absoluteX, absoluteY }: InlineTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [editText, setEditText] = useState(node.text)
  const [dimensions, setDimensions] = useState({ width: MIN_WIDTH, height: MIN_HEIGHT })
  const updateNode = useSceneStore((state) => state.updateNode)
  const stopEditing = useSelectionStore((state) => state.stopEditing)
  const { scale, x, y } = useViewportStore()

  // Calculate screen position from absolute world coordinates
  const screenX = absoluteX * scale + x
  const screenY = absoluteY * scale + y
  const screenFontSize = (node.fontSize ?? 16) * scale
  const screenLetterSpacing = (node.letterSpacing ?? 0) * scale

  // For fixed width mode, use node width scaled to screen
  const isAutoWidth = node.textWidthMode === 'auto'
  const fixedScreenWidth = node.width * scale

  // Measure content dimensions
  useEffect(() => {
    if (measureRef.current) {
      const width = measureRef.current.offsetWidth + PADDING
      const height = measureRef.current.offsetHeight + PADDING
      setDimensions({
        width: isAutoWidth ? Math.max(MIN_WIDTH, width) : fixedScreenWidth,
        height: Math.max(MIN_HEIGHT, height),
      })
    }
  }, [editText, screenFontSize, isAutoWidth, fixedScreenWidth])

  // Auto-focus and select all text on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [])

  const handleSubmit = () => {
    const trimmed = editText.trim()
    if (trimmed && trimmed !== node.text) {
      updateNode(node.id, { text: trimmed })
    }
    stopEditing()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      stopEditing()
    }
  }

  const handleBlur = () => {
    handleSubmit()
  }

  const fontStyle = {
    fontSize: screenFontSize,
    fontFamily: node.fontFamily ?? 'Arial',
    lineHeight: node.lineHeight ?? 1.2,
    letterSpacing: screenLetterSpacing,
    textAlign: (node.textAlign ?? 'left') as React.CSSProperties['textAlign'],
  }

  return (
    <>
      {/* Hidden div for measuring content dimensions */}
      <div
        ref={measureRef}
        style={{
          ...fontStyle,
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          pointerEvents: 'none',
        }}
      >
        {editText || ' '}
      </div>
      <textarea
        ref={textareaRef}
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        style={{
          ...fontStyle,
          position: 'absolute',
          left: screenX,
          top: screenY,
          width: dimensions.width,
          height: dimensions.height,
          padding: 0,
          margin: 0,
          border: '2px solid #0d99ff',
          borderRadius: 2,
          outline: 'none',
          background: 'transparent',
          color: '#000000',
          resize: 'none',
          overflow: 'hidden',
          zIndex: 100,
          boxSizing: 'border-box',
        }}
      />
    </>
  )
}
