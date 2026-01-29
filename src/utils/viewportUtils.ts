import type { SceneNode } from '../types/scene'

export interface ViewportBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Calculate the visible world bounds based on viewport state
 */
export function getViewportBounds(
  scale: number,
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): ViewportBounds {
  return {
    minX: -x / scale,
    maxX: (-x + viewportWidth) / scale,
    minY: -y / scale,
    maxY: (-y + viewportHeight) / scale,
  }
}

/**
 * Check if a node is visible within the viewport bounds
 */
export function isNodeVisible(node: SceneNode, bounds: ViewportBounds): boolean {
  // Early return if node is explicitly hidden
  if (node.visible === false) {
    return false;
  }

  const nodeRight = node.x + node.width
  const nodeBottom = node.y + node.height

  // Node is NOT visible if it's completely outside the bounds
  return !(
    nodeRight < bounds.minX ||
    node.x > bounds.maxX ||
    nodeBottom < bounds.minY ||
    node.y > bounds.maxY
  )
}

export interface ContentBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  isEmpty: boolean
}

/**
 * Calculate the bounding box of all nodes (recursively)
 */
export function calculateNodesBounds(nodes: SceneNode[]): ContentBounds {
  if (nodes.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, isEmpty: true }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  function processNode(node: SceneNode, offsetX = 0, offsetY = 0) {
    const absoluteX = node.x + offsetX
    const absoluteY = node.y + offsetY

    minX = Math.min(minX, absoluteX)
    minY = Math.min(minY, absoluteY)
    maxX = Math.max(maxX, absoluteX + node.width)
    maxY = Math.max(maxY, absoluteY + node.height)

    // Process children for frames
    if (node.type === 'frame' && node.children) {
      for (const child of node.children) {
        processNode(child, absoluteX, absoluteY)
      }
    }
  }

  for (const node of nodes) {
    processNode(node)
  }

  return { minX, maxX, minY, maxY, isEmpty: false }
}
