import { Text } from 'react-konva'
import { useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import type { FrameNode, GroupNode } from '../../types/scene'
import { useSelectionStore } from '../../store/selectionStore'
import { useViewportStore } from '../../store/viewportStore'

interface FrameNameLabelProps {
  node: FrameNode | GroupNode
  isSelected: boolean
  absoluteX: number
  absoluteY: number
}

const LABEL_FONT_SIZE = 11
const LABEL_OFFSET_Y = 4
const LABEL_COLOR_NORMAL = '#666666'
const LABEL_COLOR_SELECTED = '#0d99ff'
const LABEL_COLOR_COMPONENT = '#9747ff' // Purple for components

export function FrameNameLabel({ node, isSelected, absoluteX, absoluteY }: FrameNameLabelProps) {
  const { startNameEditing, editingNodeId, editingMode, select } = useSelectionStore()
  const { scale } = useViewportStore()
  const textRef = useRef<Konva.Text>(null)
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDblClickRef = useRef(false)

  // Track the frame node's real-time position during drag
  useEffect(() => {
    const stage = textRef.current?.getStage()
    if (!stage) return

    const frameNode = stage.findOne(`#${node.id}`)
    if (!frameNode) return

    const handleDragMove = () => {
      // Get the current drag position
      const pos = frameNode.position()
      setDragPosition({ x: pos.x, y: pos.y })
    }

    const handleDragEnd = () => {
      // Clear drag position so we use the prop values again
      setDragPosition(null)
    }

    frameNode.on('dragmove', handleDragMove)
    frameNode.on('dragend', handleDragEnd)

    return () => {
      frameNode.off('dragmove', handleDragMove)
      frameNode.off('dragend', handleDragEnd)
    }
  }, [node.id])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current)
      }
    }
  }, [])

  // Hide if this frame's name is being edited
  const isEditingThisName = editingNodeId === node.id && editingMode === 'name'
  if (isEditingThisName) {
    return null
  }

  const defaultName = node.type === 'group' ? 'Group' : 'Frame'
  const displayName = node.name || defaultName

  // Determine label color: purple for components, blue for selected, gray for normal
  const isReusable = node.type === 'frame' && node.reusable
  const labelColor = isReusable
    ? LABEL_COLOR_COMPONENT
    : isSelected
      ? LABEL_COLOR_SELECTED
      : LABEL_COLOR_NORMAL

  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true
    // Set flag to prevent drag from starting
    isDblClickRef.current = true
    // Cancel any pending drag
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current)
      dragTimeoutRef.current = null
    }
    // Open name editor
    startNameEditing(node.id)
    // Reset flag after a short delay
    setTimeout(() => {
      isDblClickRef.current = false
    }, 300)
  }

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true
    select(node.id)
  }

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true
    
    // Don't start drag if this is part of a double-click
    if (isDblClickRef.current) {
      return
    }

    // Select the frame immediately
    select(node.id)

    // Delay drag start to allow double-click to be detected
    const stage = textRef.current?.getStage()
    if (!stage) return

    const frameNode = stage.findOne(`#${node.id}`)
    if (frameNode && frameNode.draggable()) {
      // Store the event for later use
      const savedEvent = e.evt
      
      dragTimeoutRef.current = setTimeout(() => {
        if (!isDblClickRef.current) {
          // Start dragging the frame after delay
          frameNode.startDrag(savedEvent)
        }
        dragTimeoutRef.current = null
      }, 200) // 200ms delay to detect double-click
    }
  }

  const handleMouseUp = () => {
    // Clear timeout if mouse is released before drag starts
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current)
      dragTimeoutRef.current = null
    }
  }

  const safeScale = scale || 1
  const worldOffsetY = (LABEL_FONT_SIZE + LABEL_OFFSET_Y) / safeScale

  // Use drag position if available, otherwise use absoluteX/Y
  const labelX = dragPosition ? dragPosition.x : absoluteX
  const labelY = dragPosition ? dragPosition.y - worldOffsetY : absoluteY - worldOffsetY

  return (
    <Text
      ref={textRef}
      x={labelX}
      y={labelY}
      text={displayName}
      fontSize={LABEL_FONT_SIZE}
      scaleX={1 / safeScale}
      scaleY={1 / safeScale}
      fontFamily="system-ui, -apple-system, sans-serif"
      fill={labelColor}
      listening={true}
      onClick={handleClick}
      onDblClick={handleDblClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    />
  )
}
