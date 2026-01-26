import { Group, Rect, Text } from 'react-konva'
import { useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import type { SceneNode } from '../../types/scene'
import { useViewportStore } from '../../store/viewportStore'

interface NodeSizeLabelProps {
  node: SceneNode
  absoluteX: number
  absoluteY: number
  effectiveWidth: number
  effectiveHeight: number
}

const LABEL_FONT_SIZE = 11
const LABEL_OFFSET_Y = 6
const LABEL_PADDING_X = 6
const LABEL_PADDING_Y = 3
const LABEL_CORNER_RADIUS = 3
const LABEL_BG_COLOR = '#0d99ff' // Blue background
const LABEL_TEXT_COLOR = '#ffffff' // White text

export function NodeSizeLabel({
  node,
  absoluteX,
  absoluteY,
  effectiveWidth,
  effectiveHeight,
}: NodeSizeLabelProps) {
  const { scale } = useViewportStore()
  const textRef = useRef<Konva.Text>(null)
  const groupRef = useRef<Konva.Group>(null)
  const [textWidth, setTextWidth] = useState(0)
  const [dragState, setDragState] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)

  // Update text width for centering
  useEffect(() => {
    if (textRef.current) {
      setTextWidth(textRef.current.width())
    }
  })

  // Track the node's real-time position and size during drag/transform
  useEffect(() => {
    const stage = groupRef.current?.getStage()
    if (!stage) return

    const konvaNode = stage.findOne(`#${node.id}`)
    if (!konvaNode) return

    const updateDragState = () => {
      const pos = konvaNode.position()
      setDragState({
        x: pos.x,
        y: pos.y,
        width: konvaNode.width() * konvaNode.scaleX(),
        height: konvaNode.height() * konvaNode.scaleY(),
      })
    }

    const handleEnd = () => {
      setDragState(null)
    }

    konvaNode.on('dragmove', updateDragState)
    konvaNode.on('transform', updateDragState)
    konvaNode.on('dragend', handleEnd)
    konvaNode.on('transformend', handleEnd)

    return () => {
      konvaNode.off('dragmove', updateDragState)
      konvaNode.off('transform', updateDragState)
      konvaNode.off('dragend', handleEnd)
      konvaNode.off('transformend', handleEnd)
    }
  }, [node.id])

  const safeScale = scale || 1
  const worldOffsetY = LABEL_OFFSET_Y / safeScale

  // Use drag state if available, otherwise use props
  const currentX = dragState ? dragState.x : absoluteX
  const currentY = dragState ? dragState.y : absoluteY
  const currentWidth = dragState ? dragState.width : effectiveWidth
  const currentHeight = dragState ? dragState.height : effectiveHeight

  // Position at bottom center of the node
  const labelX = currentX + currentWidth / 2
  const labelY = currentY + currentHeight + worldOffsetY

  // Format dimensions
  const displayText = `${Math.round(currentWidth)} × ${Math.round(currentHeight)}`

  // Calculate background dimensions
  const bgWidth = textWidth + LABEL_PADDING_X * 2
  const bgHeight = LABEL_FONT_SIZE + LABEL_PADDING_Y * 2

  return (
    <Group
      ref={groupRef}
      x={labelX}
      y={labelY}
      scaleX={1 / safeScale}
      scaleY={1 / safeScale}
      offsetX={bgWidth / 2}
      listening={false}
    >
      {/* Background */}
      <Rect
        width={bgWidth}
        height={bgHeight}
        fill={LABEL_BG_COLOR}
        cornerRadius={LABEL_CORNER_RADIUS}
      />
      {/* Text */}
      <Text
        ref={textRef}
        x={LABEL_PADDING_X}
        y={LABEL_PADDING_Y}
        text={displayText}
        fontSize={LABEL_FONT_SIZE}
        fontFamily="system-ui, -apple-system, sans-serif"
        fill={LABEL_TEXT_COLOR}
      />
    </Group>
  )
}
