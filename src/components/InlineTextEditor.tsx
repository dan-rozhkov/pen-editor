import { useRef, useEffect, useState } from 'react'
import type { TextNode } from '../types/scene'
import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'

interface InlineTextEditorProps {
  node: TextNode
}

export function InlineTextEditor({ node }: InlineTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [editText, setEditText] = useState(node.text)
  const updateNode = useSceneStore((state) => state.updateNode)
  const stopEditing = useSelectionStore((state) => state.stopEditing)
  const { scale, x, y } = useViewportStore()

  // Calculate screen position from world coordinates
  const screenX = node.x * scale + x
  const screenY = node.y * scale + y
  const screenWidth = node.width * scale
  const screenHeight = node.height * scale
  const screenFontSize = (node.fontSize ?? 16) * scale

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

  return (
    <textarea
      ref={textareaRef}
      value={editText}
      onChange={(e) => setEditText(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        width: Math.max(screenWidth, 50),
        height: Math.max(screenHeight, 24),
        fontSize: screenFontSize,
        fontFamily: node.fontFamily ?? 'Arial',
        lineHeight: 1.2,
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
  )
}
