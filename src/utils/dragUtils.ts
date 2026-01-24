import type { SceneNode, FrameNode } from '../types/scene'
import type { DropIndicatorData, InsertInfo } from '../store/dragStore'

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
      if (node.type === 'frame') {
        // Check if target is direct child
        const isChild = node.children.some(c => c.id === targetId)
        if (isChild) {
          return { x: accX + node.x, y: accY + node.y }
        }
        // Recurse into children
        const found = findParentPosition(node.children, targetId, accX + node.x, accY + node.y)
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

export interface DropPositionResult {
  indicator: DropIndicatorData
  insertInfo: InsertInfo
}

/**
 * Calculate drop position for reordering within an auto-layout frame
 * Returns indicator position and insert index
 */
export function calculateDropPosition(
  cursorPos: Point,
  parentFrame: FrameNode,
  frameAbsolutePos: Point,
  draggedId: string
): DropPositionResult | null {
  const layout = parentFrame.layout
  if (!layout?.autoLayout) return null

  const isHorizontal = layout.flexDirection === 'row'
  const gap = layout.gap ?? 0
  const paddingTop = layout.paddingTop ?? 0
  const paddingRight = layout.paddingRight ?? 0
  const paddingBottom = layout.paddingBottom ?? 0
  const paddingLeft = layout.paddingLeft ?? 0

  // Get visible children excluding the dragged one
  const children = parentFrame.children.filter(
    (c) => c.id !== draggedId && c.visible !== false
  )

  // Convert cursor to local frame coordinates
  const localCursor = {
    x: cursorPos.x - frameAbsolutePos.x,
    y: cursorPos.y - frameAbsolutePos.y,
  }

  let insertIndex = 0
  let indicatorX = frameAbsolutePos.x + paddingLeft
  let indicatorY = frameAbsolutePos.y + paddingTop

  // Calculate indicator position based on layout direction
  if (isHorizontal) {
    // Horizontal layout - check X positions
    const indicatorHeight = parentFrame.height - paddingTop - paddingBottom

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const childCenterX = child.x + child.width / 2

      if (localCursor.x < childCenterX) {
        // Insert before this child
        indicatorX = frameAbsolutePos.x + child.x - gap / 2
        indicatorY = frameAbsolutePos.y + paddingTop
        break
      }
      insertIndex = i + 1
      // If we're past the last child, indicator goes after it
      if (i === children.length - 1) {
        indicatorX = frameAbsolutePos.x + child.x + child.width + gap / 2
        indicatorY = frameAbsolutePos.y + paddingTop
      }
    }

    // Handle empty frame or first position
    if (children.length === 0) {
      indicatorX = frameAbsolutePos.x + paddingLeft
      indicatorY = frameAbsolutePos.y + paddingTop
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
    const indicatorWidth = parentFrame.width - paddingLeft - paddingRight

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const childCenterY = child.y + child.height / 2

      if (localCursor.y < childCenterY) {
        // Insert before this child
        indicatorX = frameAbsolutePos.x + paddingLeft
        indicatorY = frameAbsolutePos.y + child.y - gap / 2
        break
      }
      insertIndex = i + 1
      // If we're past the last child, indicator goes after it
      if (i === children.length - 1) {
        indicatorX = frameAbsolutePos.x + paddingLeft
        indicatorY = frameAbsolutePos.y + child.y + child.height + gap / 2
      }
    }

    // Handle empty frame or first position
    if (children.length === 0) {
      indicatorX = frameAbsolutePos.x + paddingLeft
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
