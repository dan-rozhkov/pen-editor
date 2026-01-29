import type { SceneNode, FrameNode, GroupNode } from '../types/scene'
import type { DropIndicatorData, InsertInfo } from '../store/dragStore'
import type Konva from 'konva'

interface Point {
  x: number
  y: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Check if two rectangles intersect (AABB overlap)
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

/**
 * Check if a point is inside a rectangle
 */
export function isPointInsideRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/**
 * Get absolute position of a node (accounting for parent frame offsets)
 */
export function getAbsolutePosition(node: SceneNode, _nodes: SceneNode[]): Point {
  // For now, assume nodes at root level have absolute positions
  // For children of frames, we need to add parent's position
  // This will be called with layout-calculated positions which are relative to parent
  return { x: node.x, y: node.y }
}

/**
 * Get absolute position of a frame (for checking if cursor is inside)
 */
export function getFrameAbsoluteRect(frame: FrameNode, nodes: SceneNode[]): Rect {
  // Recursively find parent frames and sum up positions
  let x = frame.x
  let y = frame.y

  function findParentPosition(searchNodes: SceneNode[], targetId: string, accX: number, accY: number): Point | null {
    for (const node of searchNodes) {
      if (node.type === 'frame' || node.type === 'group') {
        const children = (node as FrameNode | GroupNode).children
        // Check if target is direct child
        const isChild = children.some(c => c.id === targetId)
        if (isChild) {
          return { x: accX + node.x, y: accY + node.y }
        }
        // Recurse into children
        const found = findParentPosition(children, targetId, accX + node.x, accY + node.y)
        if (found) return found
      }
    }
    return null
  }

  const parentPos = findParentPosition(nodes, frame.id, 0, 0)
  if (parentPos) {
    x += parentPos.x
    y += parentPos.y
  }

  return { x, y, width: frame.width, height: frame.height }
}

type LayoutCalculator = (frame: FrameNode) => SceneNode[]

function getNodeAbsoluteRectWithLayout(
  nodes: SceneNode[],
  targetId: string,
  calculateLayoutForFrame: LayoutCalculator
): Rect | null {
  function search(searchNodes: SceneNode[], accX: number, accY: number): Rect | null {
    for (const node of searchNodes) {
      const nodeX = accX + node.x
      const nodeY = accY + node.y

      if (node.id === targetId) {
        return { x: nodeX, y: nodeY, width: node.width, height: node.height }
      }

      if (node.type === 'frame') {
        const childNodes = node.layout?.autoLayout
          ? calculateLayoutForFrame(node)
          : node.children
        const found = search(childNodes, nodeX, nodeY)
        if (found) return found
      } else if (node.type === 'group') {
        const found = search((node as GroupNode).children, nodeX, nodeY)
        if (found) return found
      }
    }
    return null
  }

  return search(nodes, 0, 0)
}

export function getFrameAbsoluteRectWithLayout(
  frame: FrameNode,
  nodes: SceneNode[],
  calculateLayoutForFrame: LayoutCalculator
): Rect {
  const layoutRect = getNodeAbsoluteRectWithLayout(
    nodes,
    frame.id,
    calculateLayoutForFrame
  )

  if (layoutRect) {
    return layoutRect
  }

  return getFrameAbsoluteRect(frame, nodes)
}

export interface DropPositionResult {
  indicator: DropIndicatorData
  insertInfo: InsertInfo
}

/**
 * Calculate drop position for reordering within an auto-layout frame
 * Returns indicator position and insert index
 * @param layoutChildren - Layout-calculated children with actual positions (from Yoga)
 */
export function calculateDropPosition(
  cursorPos: Point,
  parentFrame: FrameNode,
  frameAbsolutePos: Point,
  draggedId: string,
  layoutChildren?: SceneNode[]
): DropPositionResult | null {
  const layout = parentFrame.layout
  if (!layout?.autoLayout) return null

  // Default flexDirection is 'row' (horizontal) when undefined
  const isHorizontal = layout.flexDirection === 'row' || layout.flexDirection === undefined
  const gap = layout.gap ?? 0
  const paddingTop = layout.paddingTop ?? 0
  const paddingRight = layout.paddingRight ?? 0
  const paddingBottom = layout.paddingBottom ?? 0
  const paddingLeft = layout.paddingLeft ?? 0

  // Use layout-calculated children if provided, otherwise fall back to raw children
  // Layout children have correct x/y positions from Yoga (important for justify center/end)
  const sourceChildren = layoutChildren ?? parentFrame.children

  // Get visible children excluding the dragged one
  const children = sourceChildren.filter(
    (c) => c.id !== draggedId && c.visible !== false
  )

  // Convert cursor to local frame coordinates
  const localCursor = {
    x: cursorPos.x - frameAbsolutePos.x,
    y: cursorPos.y - frameAbsolutePos.y,
  }

  let insertIndex = 0
  const draggedChild = sourceChildren.find(c => c.id === draggedId)
  const referenceChildWidth = draggedChild?.width ?? (children.length > 0 ? children[0].width : undefined)
  const referenceChildHeight = draggedChild?.height ?? (children.length > 0 ? children[0].height : undefined)

  const innerWidth = parentFrame.width - paddingLeft - paddingRight
  const innerHeight = parentFrame.height - paddingTop - paddingBottom
  const alignItems = layout.alignItems ?? 'flex-start'

  const getCrossOffset = (innerSize: number, itemSize: number): number => {
    switch (alignItems) {
      case 'center':
        return (innerSize - itemSize) / 2
      case 'flex-end':
        return innerSize - itemSize
      case 'stretch':
      case 'flex-start':
      default:
        return 0
    }
  }

  let indicatorX = frameAbsolutePos.x + paddingLeft
  let indicatorY = frameAbsolutePos.y + paddingTop

  // Calculate indicator position based on layout direction
  if (isHorizontal) {
    // Horizontal layout - check X positions
    const indicatorHeight =
      alignItems === 'stretch'
        ? innerHeight
        : referenceChildHeight ?? innerHeight
    const baseIndicatorY =
      frameAbsolutePos.y + paddingTop + getCrossOffset(innerHeight, indicatorHeight)

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const childCenterX = child.x + child.width / 2

      if (localCursor.x < childCenterX) {
        // Insert before this child
        indicatorX = frameAbsolutePos.x + child.x - gap / 2
        indicatorY = baseIndicatorY
        break
      }
      insertIndex = i + 1
      // If we're past the last child, indicator goes after it
      if (i === children.length - 1) {
        indicatorX = frameAbsolutePos.x + child.x + child.width + gap / 2
        indicatorY = baseIndicatorY
      }
    }

    // Handle empty frame or first position
    if (children.length === 0) {
      indicatorX = frameAbsolutePos.x + paddingLeft
      indicatorY = baseIndicatorY
    }

    return {
      indicator: {
        x: indicatorX,
        y: indicatorY,
        length: indicatorHeight,
        direction: 'vertical',
      },
      insertInfo: {
        parentId: parentFrame.id,
        index: insertIndex,
      },
    }
  } else {
    // Vertical layout - check Y positions
    const indicatorWidth =
      alignItems === 'stretch'
        ? innerWidth
        : referenceChildWidth ?? innerWidth
    const baseIndicatorX =
      frameAbsolutePos.x + paddingLeft + getCrossOffset(innerWidth, indicatorWidth)

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const childCenterY = child.y + child.height / 2

      if (localCursor.y < childCenterY) {
        // Insert before this child
        indicatorX = baseIndicatorX
        indicatorY = frameAbsolutePos.y + child.y - gap / 2
        break
      }
      insertIndex = i + 1
      // If we're past the last child, indicator goes after it
      if (i === children.length - 1) {
        indicatorX = baseIndicatorX
        indicatorY = frameAbsolutePos.y + child.y + child.height + gap / 2
      }
    }

    // Handle empty frame or first position
    if (children.length === 0) {
      indicatorX = baseIndicatorX
      indicatorY = frameAbsolutePos.y + paddingTop
    }

    return {
      indicator: {
        x: indicatorX,
        y: indicatorY,
        length: indicatorWidth,
        direction: 'horizontal',
      },
      insertInfo: {
        parentId: parentFrame.id,
        index: insertIndex,
      },
    }
  }
}

/**
 * Handle drag end for nodes in auto-layout frames
 * Centralizes the logic for moving nodes out of or within auto-layout frames
 */
export function handleAutoLayoutDragEnd(
  target: Konva.Node,
  nodeId: string,
  nodeWidth: number,
  nodeHeight: number,
  insertInfo: InsertInfo | null,
  isOutsideParent: boolean,
  moveNode: (nodeId: string, parentId: string | null, index: number) => void,
  updateNode: (nodeId: string, updates: Partial<SceneNode>) => void,
  getPositionFromTarget?: (target: Konva.Node) => Point
): void {
  if (isOutsideParent) {
    // Drag out of auto-layout frame - move to root level
    const stage = target.getStage()
    if (stage) {
      const pointerPos = stage.getRelativePointerPosition()
      if (pointerPos) {
        // Move to root level first
        moveNode(nodeId, null, 0)
        // Then set position in world coordinates
        updateNode(nodeId, {
          x: pointerPos.x - nodeWidth / 2,
          y: pointerPos.y - nodeHeight / 2,
        })
      }
    }
    // Don't reset position - updateNode already set the new position
  } else if (insertInfo) {
    // Reorder within the frame
    moveNode(nodeId, insertInfo.parentId, insertInfo.index)
  }

  // Reset Konva target position to let React re-render with layout-calculated positions
  if (getPositionFromTarget) {
    const pos = getPositionFromTarget(target)
    target.x(pos.x)
    target.y(pos.y)
  }
}
