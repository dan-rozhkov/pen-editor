import type { SceneNode, FrameNode } from '../types/scene'

export interface ParentContext {
  parent: FrameNode | null
  isInsideAutoLayout: boolean
}

/**
 * Find parent Frame for a node by its ID
 * Returns parent context with isInsideAutoLayout flag
 */
export function findParentFrame(
  nodes: SceneNode[],
  targetId: string
): ParentContext {
  // Recursive search in children
  function searchInChildren(
    children: SceneNode[],
    parent: FrameNode | null
  ): ParentContext | null {
    for (const node of children) {
      if (node.id === targetId) {
        return {
          parent,
          isInsideAutoLayout: parent?.layout?.autoLayout ?? false
        }
      }

      if (node.type === 'frame') {
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

  // Search in Frame children
  for (const node of nodes) {
    if (node.type === 'frame') {
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
    if (node.type === 'frame') {
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
      if (node.type === 'frame') {
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
    if (node.type === 'frame') {
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
      }
    }
  }

  collect(nodes)
  return components
}
