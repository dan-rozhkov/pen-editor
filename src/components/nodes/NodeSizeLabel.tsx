import { Text } from 'react-konva'
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
const LABEL_OFFSET_Y = 4
const LABEL_COLOR = '#0d99ff' // Blue color for selected

export function NodeSizeLabel({
  node,
  absoluteX,
  absoluteY,
  effectiveWidth,
  effectiveHeight,
}: NodeSizeLabelProps) {
  const { scale } = useViewportStore()
  const textRef = useRef<Konva.Text>(null)
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
    const stage = textRef.current?.getStage()
    if (!stage) return

    const konvaNode = stage.findOne(`#${node.id}`)
    if (!konvaNode) return

    const handleDragMove = () => {
      const pos = konvaNode.position()
      setDragState({
        x: pos.x,
        y: pos.y,
        width: konvaNode.width() * konvaNode.scaleX(),
        height: konvaNode.height() * konvaNode.scaleY(),
      })
    }

    const handleTransform = () => {
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

    konvaNode.on('dragmove', handleDragMove)
    konvaNode.on('transform', handleTransform)
    konvaNode.on('dragend', handleEnd)
    konvaNode.on('transformend', handleEnd)

    return () => {
      konvaNode.off('dragmove', handleDragMove)
      konvaNode.off('transform', handleTransform)
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

  return (
    <Text
      ref={textRef}
      x={labelX}
      y={labelY}
      text={displayText}
      fontSize={LABEL_FONT_SIZE}
      scaleX={1 / safeScale}
      scaleY={1 / safeScale}
      fontFamily="system-ui, -apple-system, sans-serif"
      fill={LABEL_COLOR}
      offsetX={textWidth / 2}
      listening={false}
    />
  )
}
