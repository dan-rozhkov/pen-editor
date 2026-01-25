import { useRef, useEffect, useState } from 'react'
import type { FrameNode } from '../types/scene'
import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'

interface InlineNameEditorProps {
  node: FrameNode
  absoluteX: number
  absoluteY: number
}

const LABEL_FONT_SIZE = 11
const LABEL_OFFSET_Y = 4

export function InlineNameEditor({ node, absoluteX, absoluteY }: InlineNameEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [editName, setEditName] = useState(node.name || 'Frame')
  const updateNode = useSceneStore((state) => state.updateNode)
  const stopEditing = useSelectionStore((state) => state.stopEditing)
  const { scale, x, y } = useViewportStore()

  // Calculate screen position
  // Label is ABOVE frame: y - fontSize - offset
  const labelWorldY = absoluteY - LABEL_FONT_SIZE - LABEL_OFFSET_Y
  const screenX = absoluteX * scale + x
  const screenY = labelWorldY * scale + y
  const screenFontSize = LABEL_FONT_SIZE * scale

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  const handleSubmit = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== node.name) {
      updateNode(node.id, { name: trimmed })
    }
    stopEditing()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
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
    <input
      ref={inputRef}
      type="text"
      value={editName}
      onChange={(e) => setEditName(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={{
        position: 'absolute',
        left: screenX,
        top: screenY,
        minWidth: 50,
        fontSize: screenFontSize,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        lineHeight: 1.2,
        padding: '0 2px',
        margin: 0,
        border: '1px solid #0d99ff',
        borderRadius: 2,
        outline: 'none',
        background: '#ffffff',
        color: '#333333',
        zIndex: 100,
        boxSizing: 'border-box',
      }}
    />
  )
}
