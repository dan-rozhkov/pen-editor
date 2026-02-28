import { useRef, useEffect, useState } from 'react'
import type { FlatSceneNode } from '../types/scene'
import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'

interface InlineNameEditorProps {
  node: FlatSceneNode
  absoluteX: number
  absoluteY: number
}

const LABEL_FONT_SIZE = 11
const LABEL_OFFSET_Y = 4
const MIN_WIDTH = 20
const PADDING = 4

function getDefaultNodeName(node: FlatSceneNode): string {
  if (node.type === 'group') return 'Group'
  if (node.type === 'embed') return 'Embed'
  return 'Frame'
}

export function InlineNameEditor({ node, absoluteX, absoluteY }: InlineNameEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [editName, setEditName] = useState(node.name || getDefaultNodeName(node))
  const [inputWidth, setInputWidth] = useState(MIN_WIDTH)
  const editNameRef = useRef(editName) // Track current value
  const updateNode = useSceneStore((state) => state.updateNode)
  const stopEditing = useSelectionStore((state) => state.stopEditing)
  const { scale, x, y } = useViewportStore()

  // Calculate screen position with fixed-size label
  const screenX = absoluteX * scale + x
  const screenY = absoluteY * scale + y - (LABEL_FONT_SIZE + LABEL_OFFSET_Y)
  const screenFontSize = LABEL_FONT_SIZE

  // Keep ref in sync with state
  useEffect(() => {
    editNameRef.current = editName
  }, [editName])

  // Save on unmount (blur/clearSelection case)
  useEffect(() => {
    return () => {
      const trimmed = editNameRef.current.trim()
      if (trimmed && trimmed !== node.name) {
        updateNode(node.id, { name: trimmed })
      }
    }
  }, [node.id, node.name, updateNode])

  // Measure text width and update input width
  useEffect(() => {
    if (measureRef.current) {
      const width = measureRef.current.offsetWidth + PADDING
      setInputWidth(Math.max(MIN_WIDTH, width))
    }
  }, [editName, screenFontSize])

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

  const fontStyle = {
    fontSize: screenFontSize,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    lineHeight: 1.2,
  }

  return (
    <>
      {/* Hidden span for measuring text width */}
      <span
        ref={measureRef}
        style={{
          ...fontStyle,
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'pre',
          pointerEvents: 'none',
        }}
      >
        {editName || ' '}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        style={{
          ...fontStyle,
          position: 'absolute',
          left: screenX,
          top: screenY,
          width: inputWidth,
          padding: '0 2px',
          margin: 0,
          border: '1px solid #0d99ff',
          borderRadius: 2,
          outline: 'none',
          background: 'transparent',
          color: '#333333',
          zIndex: 100,
          boxSizing: 'border-box',
        }}
      />
    </>
  )
}
