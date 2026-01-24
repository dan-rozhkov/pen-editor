import { Rect, Ellipse, Text, Group } from 'react-konva'
import Konva from 'konva'
import type { SceneNode, FrameNode } from '../../types/scene'
import { useSceneStore } from '../../store/sceneStore'
import { useSelectionStore } from '../../store/selectionStore'

interface RenderNodeProps {
  node: SceneNode
}

export function RenderNode({ node }: RenderNodeProps) {
  const updateNode = useSceneStore((state) => state.updateNode)
  const { select, addToSelection } = useSelectionStore()

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true
    const isShift = 'shiftKey' in e.evt && e.evt.shiftKey
    if (isShift) {
      addToSelection(node.id)
    } else {
      select(node.id)
    }
  }

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target
    updateNode(node.id, {
      x: target.x(),
      y: target.y(),
    })
  }

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const target = e.target
    const scaleX = target.scaleX()
    const scaleY = target.scaleY()

    // Reset scale and apply to width/height
    target.scaleX(1)
    target.scaleY(1)

    updateNode(node.id, {
      x: target.x(),
      y: target.y(),
      width: Math.max(5, target.width() * scaleX),
      height: Math.max(5, target.height() * scaleY),
    })
  }

  switch (node.type) {
    case 'frame':
      return (
        <FrameRenderer
          node={node}
          onClick={handleClick}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      )
    case 'rect':
      return (
        <Rect
          id={node.id}
          name="selectable"
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          fill={node.fill}
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
          cornerRadius={node.cornerRadius}
          draggable
          onClick={handleClick}
          onTap={handleClick}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      )
    case 'ellipse':
      return <EllipseRenderer node={node} onClick={handleClick} />
    case 'text':
      return (
        <Text
          id={node.id}
          name="selectable"
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          text={node.text}
          fontSize={node.fontSize ?? 16}
          fontFamily={node.fontFamily ?? 'Arial'}
          fill={node.fill ?? '#000000'}
          draggable
          onClick={handleClick}
          onTap={handleClick}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      )
    default:
      return null
  }
}

interface EllipseRendererProps {
  node: SceneNode & { type: 'ellipse' }
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
}

function EllipseRenderer({ node, onClick }: EllipseRendererProps) {
  const updateNode = useSceneStore((state) => state.updateNode)

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target
    // Ellipse position is center, convert back to top-left
    updateNode(node.id, {
      x: target.x() - node.width / 2,
      y: target.y() - node.height / 2,
    })
  }

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const target = e.target as Konva.Ellipse
    const scaleX = target.scaleX()
    const scaleY = target.scaleY()

    const newWidth = Math.max(5, target.radiusX() * 2 * scaleX)
    const newHeight = Math.max(5, target.radiusY() * 2 * scaleY)

    // Reset scale
    target.scaleX(1)
    target.scaleY(1)

    // Update radiuses
    target.radiusX(newWidth / 2)
    target.radiusY(newHeight / 2)

    updateNode(node.id, {
      x: target.x() - newWidth / 2,
      y: target.y() - newHeight / 2,
      width: newWidth,
      height: newHeight,
    })
  }

  return (
    <Ellipse
      id={node.id}
      name="selectable"
      x={node.x + node.width / 2}
      y={node.y + node.height / 2}
      radiusX={node.width / 2}
      radiusY={node.height / 2}
      fill={node.fill}
      stroke={node.stroke}
      strokeWidth={node.strokeWidth}
      draggable
      onClick={onClick}
      onTap={onClick}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
    />
  )
}

interface FrameRendererProps {
  node: FrameNode
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void
}

function FrameRenderer({ node, onClick, onDragEnd, onTransformEnd }: FrameRendererProps) {
  return (
    <Group
      id={node.id}
      name="selectable"
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      draggable
      onClick={onClick}
      onTap={onClick}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    >
      <Rect
        width={node.width}
        height={node.height}
        fill={node.fill}
        stroke={node.stroke}
        strokeWidth={node.strokeWidth}
        cornerRadius={node.cornerRadius}
      />
      {node.children.map((child) => (
        <RenderNode key={child.id} node={child} />
      ))}
    </Group>
  )
}
