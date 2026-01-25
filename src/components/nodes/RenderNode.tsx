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
import { useDragStore } from '../../store/dragStore'
import { findParentFrame } from '../../utils/nodeUtils'
import { calculateDropPosition, isPointInsideRect, getFrameAbsoluteRect } from '../../utils/dragUtils'

interface RenderNodeProps {
  node: SceneNode
  effectiveTheme?: ThemeName // Theme inherited from parent or global
}

export function RenderNode({ node, effectiveTheme }: RenderNodeProps) {
  const nodes = useSceneStore((state) => state.nodes)
  const updateNode = useSceneStore((state) => state.updateNode)
  const moveNode = useSceneStore((state) => state.moveNode)
  const { select, addToSelection, startEditing, editingNodeId } = useSelectionStore()
  const variables = useVariableStore((state) => state.variables)
  const globalTheme = useThemeStore((state) => state.activeTheme)
  const { startDrag, updateDrop, endDrag } = useDragStore()
  const calculateLayoutForFrame = useLayoutStore((state) => state.calculateLayoutForFrame)

  // Use effective theme from parent, or fall back to global theme
  const currentTheme = effectiveTheme ?? globalTheme

  // Find parent context to check if inside auto-layout
  const parentContext = findParentFrame(nodes, node.id)
  const isInAutoLayout = parentContext.isInsideAutoLayout
  const parentFrame = parentContext.parent

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

  const handleDragStart = () => {
    if (isInAutoLayout) {
      startDrag(node.id)
    }
  }

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (!isInAutoLayout || !parentFrame) return

    const stage = e.target.getStage()
    if (!stage) return

    const pointerPos = stage.getRelativePointerPosition()
    if (!pointerPos) return

    // Get absolute position of parent frame
    const frameRect = getFrameAbsoluteRect(parentFrame, nodes)

    // Check if cursor is inside parent frame
    const isInsideParent = isPointInsideRect(pointerPos, frameRect)

    if (isInsideParent) {
      // Get layout-calculated children positions (from Yoga) for correct indicator placement
      // This is important when justify is center/end - raw children have x=0, y=0
      const layoutChildren = parentFrame.layout?.autoLayout
        ? calculateLayoutForFrame(parentFrame)
        : parentFrame.children

      // Calculate drop position for reordering
      const dropResult = calculateDropPosition(
        pointerPos,
        parentFrame,
        { x: frameRect.x, y: frameRect.y },
        node.id,
        layoutChildren
      )

      if (dropResult) {
        updateDrop(dropResult.indicator, dropResult.insertInfo, false)
      }
    } else {
      // Outside parent - will move to root level
      updateDrop(null, null, true)
    }
  }

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target

    if (isInAutoLayout && parentFrame) {
      const { insertInfo, isOutsideParent } = useDragStore.getState()

      if (isOutsideParent) {
        // Drag out of auto-layout frame - move to root level
        const stage = target.getStage()
        if (stage) {
          const pointerPos = stage.getRelativePointerPosition()
          if (pointerPos) {
            // Move to root level first
            moveNode(node.id, null, 0)
            // Then set position in world coordinates
            updateNode(node.id, {
              x: pointerPos.x - node.width / 2,
              y: pointerPos.y - node.height / 2,
            })
          }
        }
        // Don't reset position - updateNode already set the new position
      } else if (insertInfo) {
        // Reorder within the frame
        moveNode(node.id, insertInfo.parentId, insertInfo.index)
        // Don't reset position here - let React re-render with new layout positions
        // Resetting to old position causes double jump: dragged → old → new
      }

      endDrag()
    } else {
      // Normal behavior - update position
      updateNode(node.id, {
        x: target.x(),
        y: target.y(),
      })
    }
  }

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const target = e.target
    const scaleX = target.scaleX()
    const scaleY = target.scaleY()
    const rotation = target.rotation()

    // Reset scale and apply to width/height
    target.scaleX(1)
    target.scaleY(1)

    updateNode(node.id, {
      x: target.x(),
      y: target.y(),
      width: Math.max(5, target.width() * scaleX),
      height: Math.max(5, target.height() * scaleY),
      rotation: rotation,
    })
  }

  switch (node.type) {
    case 'frame':
      return (
        <FrameRenderer
          node={node}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
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
          rotation={node.rotation ?? 0}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={node.strokeWidth}
          cornerRadius={node.cornerRadius}
          draggable
          onClick={handleClick}
          onTap={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      )
    case 'ellipse':
      return (
        <EllipseRenderer
          node={node}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          fillColor={fillColor}
          strokeColor={strokeColor}
          isInAutoLayout={isInAutoLayout}
          parentFrame={parentFrame}
        />
      )
    case 'text': {
      const isEditing = editingNodeId === node.id
      const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
        e.cancelBubble = true
        startEditing(node.id)
      }
      return (
        <Text
          id={node.id}
          name="selectable"
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rotation={node.rotation ?? 0}
          text={node.text}
          fontSize={node.fontSize ?? 16}
          fontFamily={node.fontFamily ?? 'Arial'}
          fill={fillColor ?? '#000000'}
          opacity={isEditing ? 0 : 1}
          draggable={!isEditing}
          onClick={handleClick}
          onTap={handleClick}
          onDblClick={handleDblClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      )
    }
    default:
      return null
  }
}

interface EllipseRendererProps {
  node: SceneNode & { type: 'ellipse' }
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragStart: () => void
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void
  fillColor?: string
  strokeColor?: string
  isInAutoLayout: boolean
  parentFrame: FrameNode | null
}

function EllipseRenderer({
  node,
  onClick,
  onDragStart,
  onDragMove,
  fillColor,
  strokeColor,
  isInAutoLayout,
  parentFrame,
}: EllipseRendererProps) {
  const updateNode = useSceneStore((state) => state.updateNode)
  const moveNode = useSceneStore((state) => state.moveNode)
  const { endDrag } = useDragStore()

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target

    if (isInAutoLayout && parentFrame) {
      const { insertInfo, isOutsideParent } = useDragStore.getState()

      if (isOutsideParent) {
        // Drag out of auto-layout frame
        const stage = target.getStage()
        if (stage) {
          const pointerPos = stage.getRelativePointerPosition()
          if (pointerPos) {
            moveNode(node.id, null, 0)
            updateNode(node.id, {
              x: pointerPos.x - node.width / 2,
              y: pointerPos.y - node.height / 2,
            })
          }
        }
      } else if (insertInfo) {
        moveNode(node.id, insertInfo.parentId, insertInfo.index)
      }

      // Reset position - Ellipse uses center
      target.x(node.x + node.width / 2)
      target.y(node.y + node.height / 2)
      endDrag()
    } else {
      // Ellipse position is center, convert back to top-left
      updateNode(node.id, {
        x: target.x() - node.width / 2,
        y: target.y() - node.height / 2,
      })
    }
  }

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const target = e.target as Konva.Ellipse
    const scaleX = target.scaleX()
    const scaleY = target.scaleY()
    const rotation = target.rotation()

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
      rotation: rotation,
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
      rotation={node.rotation ?? 0}
      fill={fillColor}
      stroke={strokeColor}
      strokeWidth={node.strokeWidth}
      draggable
      onClick={onClick}
      onTap={onClick}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={handleDragEnd}
      onTransformEnd={handleTransformEnd}
    />
  )
}

interface FrameRendererProps {
  node: FrameNode
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragStart: () => void
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void
  fillColor?: string
  strokeColor?: string
  effectiveTheme: ThemeName
}

function FrameRenderer({
  node,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  fillColor,
  strokeColor,
  effectiveTheme,
}: FrameRendererProps) {
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
      rotation={node.rotation ?? 0}
      draggable
      onClick={onClick}
      onTap={onClick}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
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
