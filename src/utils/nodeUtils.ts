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
