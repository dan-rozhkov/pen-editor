import type { SceneNode, FrameNode, GroupNode } from '../types/scene'
import { isContainerNode, getNodeChildren } from '../types/scene'

export interface ParentContext {
  parent: FrameNode | GroupNode | null
  isInsideAutoLayout: boolean
}

/**
 * Find parent container (Frame or Group) for a node by its ID
 * Returns parent context with isInsideAutoLayout flag
 */
export function findParentFrame(
  nodes: SceneNode[],
  targetId: string
): ParentContext {
  // Recursive search in children
  function searchInChildren(
    children: SceneNode[],
    parent: FrameNode | GroupNode | null
  ): ParentContext | null {
    for (const node of children) {
      if (node.id === targetId) {
        return {
          parent,
          isInsideAutoLayout: (parent?.type === 'frame' && parent?.layout?.autoLayout) ?? false
        }
      }

      if (isContainerNode(node)) {
        const found = searchInChildren(node.children, node)
        if (found) return found
      }
    }
    return null
  }

  // First check top level
  for (const node of nodes) {
    if (node.id === targetId) {
      return { parent: null, isInsideAutoLayout: false }
    }
  }

  // Search in container children
  for (const node of nodes) {
    if (isContainerNode(node)) {
      const found = searchInChildren(node.children, node)
      if (found) return found
    }
  }

  return { parent: null, isInsideAutoLayout: false }
}

/**
 * Recursively find a node by ID in the scene tree
 */
export function findNodeById(nodes: SceneNode[], id: string): SceneNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (isContainerNode(node)) {
      const found = findNodeById(node.children, id)
      if (found) return found
    }
  }
  return null
}

/**
 * Get absolute position of a node by traversing parent chain
 * Returns the accumulated x,y from all parent frames
 */
export function getNodeAbsolutePosition(
  nodes: SceneNode[],
  targetId: string
): { x: number; y: number } | null {
  function findWithPath(
    searchNodes: SceneNode[],
    accX: number,
    accY: number
  ): { x: number; y: number } | null {
    for (const node of searchNodes) {
      if (node.id === targetId) {
        return { x: accX + node.x, y: accY + node.y }
      }
      if (isContainerNode(node)) {
        const found = findWithPath(node.children, accX + node.x, accY + node.y)
        if (found) return found
      }
    }
    return null
  }

  return findWithPath(nodes, 0, 0)
}

/**
 * Find a component (reusable FrameNode) by ID
 * Searches the entire tree for a FrameNode with matching ID and reusable: true
 */
export function findComponentById(nodes: SceneNode[], id: string): FrameNode | null {
  for (const node of nodes) {
    if (node.type === 'frame' && node.id === id && node.reusable) {
      return node
    }
    if (isContainerNode(node)) {
      const found = findComponentById(node.children, id)
      if (found) return found
    }
  }
  return null
}

/**
 * Get all components (reusable FrameNodes) from the scene tree
 */
export function getAllComponents(nodes: SceneNode[]): FrameNode[] {
  const components: FrameNode[] = []

  function collect(searchNodes: SceneNode[]) {
    for (const node of searchNodes) {
      if (node.type === 'frame') {
        if (node.reusable) {
          components.push(node)
        }
        collect(node.children)
      } else if (node.type === 'group') {
        collect(node.children)
      }
    }
  }

  collect(nodes)
  return components
}

/**
 * Get absolute position of a node, taking into account Yoga layout calculations
 * for auto-layout frames. This is necessary because children inside auto-layout
 * frames have their positions computed by Yoga, not stored in node.x/y.
 */
export function getNodeAbsolutePositionWithLayout(
  nodes: SceneNode[],
  targetId: string,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[]
): { x: number; y: number } | null {
  function findWithPath(
    searchNodes: SceneNode[],
    accX: number,
    accY: number,
    parentFrame: FrameNode | null
  ): { x: number; y: number } | null {
    // If parent is an auto-layout frame, get layout-calculated positions
    let effectiveNodes = searchNodes
    if (parentFrame?.layout?.autoLayout) {
      effectiveNodes = calculateLayoutForFrame(parentFrame)
    }

    for (const node of effectiveNodes) {
      if (node.id === targetId) {
        return { x: accX + node.x, y: accY + node.y }
      }
      if (isContainerNode(node)) {
        const found = findWithPath(
          node.children,
          accX + node.x,
          accY + node.y,
          node.type === 'frame' ? node : null
        )
        if (found) return found
      }
    }
    return null
  }

  return findWithPath(nodes, 0, 0, null)
}
