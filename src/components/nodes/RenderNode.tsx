import { Rect, Ellipse, Text, Group } from 'react-konva'
import Konva from 'konva'
import type { SceneNode, FrameNode } from '../../types/scene'
import type { ThemeName } from '../../types/variable'
import { getVariableValue } from '../../types/variable'
import { useSceneStore } from '../../store/sceneStore'
import { useSelectionStore } from '../../store/selectionStore'
import { useLayoutStore } from '../../store/layoutStore'
import { useVariableStore } from '../../store/variableStore'
import { useThemeStore } from '../../store/themeStore'

interface RenderNodeProps {
  node: SceneNode
  effectiveTheme?: ThemeName // Theme inherited from parent or global
}

export function RenderNode({ node, effectiveTheme }: RenderNodeProps) {
  const updateNode = useSceneStore((state) => state.updateNode)
  const { select, addToSelection } = useSelectionStore()
  const variables = useVariableStore((state) => state.variables)
  const globalTheme = useThemeStore((state) => state.activeTheme)

  // Use effective theme from parent, or fall back to global theme
  const currentTheme = effectiveTheme ?? globalTheme

  // Resolve color from variable binding or use direct value
  const resolveColor = (color: string | undefined, binding?: { variableId: string }): string | undefined => {
    if (binding) {
      const variable = variables.find(v => v.id === binding.variableId)
      if (variable) {
        return getVariableValue(variable, currentTheme)
      }
    }
    return color
  }

  // Resolved colors for this node
  const fillColor = resolveColor(node.fill, node.fillBinding)
  const strokeColor = resolveColor(node.stroke, node.strokeBinding)

  // Don't render if node is hidden
  if (node.visible === false) {
    return null
  }

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
          fillColor={fillColor}
          strokeColor={strokeColor}
          effectiveTheme={currentTheme}
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
          fill={fillColor}
          stroke={strokeColor}
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
      return (
        <EllipseRenderer
          node={node}
          onClick={handleClick}
          fillColor={fillColor}
          strokeColor={strokeColor}
        />
      )
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
          fill={fillColor ?? '#000000'}
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
  fillColor?: string
  strokeColor?: string
}

function EllipseRenderer({ node, onClick, fillColor, strokeColor }: EllipseRendererProps) {
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
      fill={fillColor}
      stroke={strokeColor}
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
  fillColor?: string
  strokeColor?: string
  effectiveTheme: ThemeName
}

function FrameRenderer({ node, onClick, onDragEnd, onTransformEnd, fillColor, strokeColor, effectiveTheme }: FrameRendererProps) {
  const calculateLayoutForFrame = useLayoutStore((state) => state.calculateLayoutForFrame)

  // Calculate layout for children if auto-layout is enabled
  const layoutChildren = node.layout?.autoLayout
    ? calculateLayoutForFrame(node)
    : node.children

  // If this frame has a theme override, use it for children
  const childTheme = node.themeOverride ?? effectiveTheme

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
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={node.strokeWidth}
        cornerRadius={node.cornerRadius}
      />
      {layoutChildren.map((child) => (
        <RenderNode key={child.id} node={child} effectiveTheme={childTheme} />
      ))}
    </Group>
  )
}
