import { create } from 'zustand'
import type { SceneNode, FrameNode, RefNode, TextNode, DescendantOverride } from '../types/scene'
import { useHistoryStore } from './historyStore'
import { measureTextAutoSize, measureTextFixedWidthHeight } from '../utils/textMeasure'

interface SceneState {
  nodes: SceneNode[]
  expandedFrameIds: Set<string>
  addNode: (node: SceneNode) => void
  addChildToFrame: (frameId: string, child: SceneNode) => void
  updateNode: (id: string, updates: Partial<SceneNode>) => void
  deleteNode: (id: string) => void
  clearNodes: () => void
  setNodes: (nodes: SceneNode[]) => void
  setNodesWithoutHistory: (nodes: SceneNode[]) => void
  reorderNode: (fromIndex: number, toIndex: number) => void
  setVisibility: (id: string, visible: boolean) => void
  toggleVisibility: (id: string) => void
  toggleFrameExpanded: (id: string) => void
  setFrameExpanded: (id: string, expanded: boolean) => void
  moveNode: (nodeId: string, newParentId: string | null, newIndex: number) => void
  // Descendant override methods for component instances
  updateDescendantOverride: (instanceId: string, descendantId: string, updates: DescendantOverride) => void
  resetDescendantOverride: (instanceId: string, descendantId: string, property?: keyof DescendantOverride) => void
}

// Recursively sync text node dimensions throughout the tree
function syncAllTextDimensions(nodes: SceneNode[]): SceneNode[] {
  return nodes.map(node => {
    if (node.type === 'text') {
      return syncTextDimensions(node)
    }
    if (node.type === 'frame') {
      return {
        ...node,
        children: syncAllTextDimensions(node.children),
      } as FrameNode
    }
    return node
  })
}

// Helper to recursively add child to a frame
function addChildToFrameRecursive(nodes: SceneNode[], frameId: string, child: SceneNode): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === frameId && node.type === 'frame') {
      return {
        ...node,
        children: [...node.children, child],
      } as FrameNode
    }
    if (node.type === 'frame') {
      return {
        ...node,
        children: addChildToFrameRecursive(node.children, frameId, child),
      } as FrameNode
    }
    return node
  })
}

// Properties that affect text measurement
const TEXT_MEASURE_PROPS = new Set([
  'text', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle',
  'letterSpacing', 'lineHeight', 'textWidthMode',
])

// Sync a text node's width/height based on its textWidthMode
function syncTextDimensions(node: SceneNode): SceneNode {
  if (node.type !== 'text') return node
  const textNode = node as TextNode
  const mode = textNode.textWidthMode

  if (!mode || mode === 'auto') {
    // Auto mode: compute both width and height from content
    const measured = measureTextAutoSize(textNode)
    return { ...textNode, width: measured.width, height: measured.height }
  } else if (mode === 'fixed') {
    // Fixed width mode: only recompute height (wrapping)
    const measuredHeight = measureTextFixedWidthHeight(textNode)
    return { ...textNode, height: measuredHeight }
  }
  // fixed-height: both are manual, no sync
  return textNode
}

// Check if updates contain properties that affect text measurement
function hasTextMeasureProps(updates: Partial<SceneNode>): boolean {
  return Object.keys(updates).some(k => TEXT_MEASURE_PROPS.has(k))
}

// Helper to recursively update a node anywhere in the tree
function updateNodeRecursive(nodes: SceneNode[], id: string, updates: Partial<SceneNode>): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      let updated = { ...node, ...updates } as SceneNode
      // Auto-sync text dimensions when relevant properties change
      if (updated.type === 'text' && hasTextMeasureProps(updates)) {
        updated = syncTextDimensions(updated)
      }
      return updated
    }
    if (node.type === 'frame') {
      return {
        ...node,
        children: updateNodeRecursive(node.children, id, updates),
      } as FrameNode
    }
    return node
  })
}

// Helper to recursively delete a node anywhere in the tree
function deleteNodeRecursive(nodes: SceneNode[], id: string): SceneNode[] {
  return nodes.reduce<SceneNode[]>((acc, node) => {
    // Skip the node to delete
    if (node.id === id) return acc
    // Recursively process frame children
    if (node.type === 'frame') {
      acc.push({
        ...node,
        children: deleteNodeRecursive(node.children, id),
      } as FrameNode)
    } else {
      acc.push(node)
    }
    return acc
  }, [])
}

// Helper to recursively toggle visibility of a node anywhere in the tree
function toggleVisibilityRecursive(nodes: SceneNode[], id: string): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, visible: node.visible === false ? true : false } as SceneNode
    }
    if (node.type === 'frame') {
      return {
        ...node,
        children: toggleVisibilityRecursive(node.children, id),
      } as FrameNode
    }
    return node
  })
}

// Helper to recursively set visibility of a node anywhere in the tree
function setVisibilityRecursive(nodes: SceneNode[], id: string, visible: boolean): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, visible } as SceneNode
    }
    if (node.type === 'frame') {
      return {
        ...node,
        children: setVisibilityRecursive(node.children, id, visible),
      } as FrameNode
    }
    return node
  })
}

// Helper to find and extract a node from the tree (returns node and tree without it)
function extractNodeRecursive(nodes: SceneNode[], id: string): { node: SceneNode | null; remaining: SceneNode[] } {
  let foundNode: SceneNode | null = null

  const remaining = nodes.reduce<SceneNode[]>((acc, node) => {
    if (node.id === id) {
      foundNode = node
      return acc
    }
    if (node.type === 'frame') {
      const result = extractNodeRecursive(node.children, id)
      if (result.node) {
        foundNode = result.node
      }
      acc.push({
        ...node,
        children: result.remaining,
      } as FrameNode)
    } else {
      acc.push(node)
    }
    return acc
  }, [])

  return { node: foundNode, remaining }
}

// Helper to insert a node at a specific index in a parent (or root if parentId is null)
function insertNodeRecursive(nodes: SceneNode[], nodeToInsert: SceneNode, parentId: string | null, index: number): SceneNode[] {
  if (parentId === null) {
    // Insert at root level
    const newNodes = [...nodes]
    newNodes.splice(index, 0, nodeToInsert)
    return newNodes
  }

  return nodes.map((node) => {
    if (node.id === parentId && node.type === 'frame') {
      const newChildren = [...node.children]
      newChildren.splice(index, 0, nodeToInsert)
      return { ...node, children: newChildren } as FrameNode
    }
    if (node.type === 'frame') {
      return {
        ...node,
        children: insertNodeRecursive(node.children, nodeToInsert, parentId, index),
      } as FrameNode
    }
    return node
  })
}

// Generic helper to recursively process nodes in the tree
function mapNodesRecursive(
  nodes: SceneNode[],
  processFn: (node: SceneNode, recurse: (children: SceneNode[]) => SceneNode[]) => SceneNode
): SceneNode[] {
  const recurse = (children: SceneNode[]) => mapNodesRecursive(children, processFn)
  return nodes.map(node => processFn(node, recurse))
}

// Helper to update descendant override in a RefNode
function updateDescendantOverrideRecursive(
  nodes: SceneNode[],
  instanceId: string,
  descendantId: string,
  updates: DescendantOverride
): SceneNode[] {
  return mapNodesRecursive(nodes, (node, recurse) => {
    if (node.id === instanceId && node.type === 'ref') {
      const refNode = node as RefNode
      const existingOverrides = refNode.descendants || {}
      const existingDescendant = existingOverrides[descendantId] || {}

      return {
        ...refNode,
        descendants: {
          ...existingOverrides,
          [descendantId]: { ...existingDescendant, ...updates }
        }
      } as RefNode
    }
    if (node.type === 'frame') {
      return {
        ...node,
        children: recurse(node.children),
      } as FrameNode
    }
    return node
  })
}

// Helper to reset descendant override (remove property or entire override)
function resetDescendantOverrideRecursive(
  nodes: SceneNode[],
  instanceId: string,
  descendantId: string,
  property?: keyof DescendantOverride
): SceneNode[] {
  return mapNodesRecursive(nodes, (node, recurse) => {
    if (node.id === instanceId && node.type === 'ref') {
      const refNode = node as RefNode
      const existingOverrides = refNode.descendants || {}

      if (!existingOverrides[descendantId]) {
        return node
      }

      if (property) {
        // Reset specific property
        const { [property]: _, ...remainingProps } = existingOverrides[descendantId]
        // If no properties left, remove the entire override
        if (Object.keys(remainingProps).length === 0) {
          const { [descendantId]: __, ...remainingOverrides } = existingOverrides
          return {
            ...refNode,
            descendants: Object.keys(remainingOverrides).length > 0 ? remainingOverrides : undefined
          } as RefNode
        }
        return {
          ...refNode,
          descendants: {
            ...existingOverrides,
            [descendantId]: remainingProps
          }
        } as RefNode
      } else {
        // Reset entire override for this descendant
        const { [descendantId]: _, ...remainingOverrides } = existingOverrides
        return {
          ...refNode,
          descendants: Object.keys(remainingOverrides).length > 0 ? remainingOverrides : undefined
        } as RefNode
      }
    }
    if (node.type === 'frame') {
      return {
        ...node,
        children: recurse(node.children),
      } as FrameNode
    }
    return node
  })
}

export const useSceneStore = create<SceneState>((set) => ({
  nodes: [],
  expandedFrameIds: new Set<string>(),

  addNode: (node) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes)
      const synced = node.type === 'text' ? syncTextDimensions(node) : node
      return { nodes: [...state.nodes, synced] }
    }),

  addChildToFrame: (frameId, child) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes)
      return { nodes: addChildToFrameRecursive(state.nodes, frameId, child) }
    }),

  updateNode: (id, updates) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes)
      return { nodes: updateNodeRecursive(state.nodes, id, updates) }
    }),

  deleteNode: (id) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes)
      return { nodes: deleteNodeRecursive(state.nodes, id) }
    }),

  clearNodes: () => set({ nodes: [] }),

  setNodes: (nodes) => {
    useHistoryStore.getState().saveHistory(useSceneStore.getState().nodes)
    // Sync text dimensions on load to fix any stale width/height
    set({ nodes: syncAllTextDimensions(nodes) })
  },

  // Set nodes without saving to history (used by undo/redo)
  setNodesWithoutHistory: (nodes) => set({ nodes }),

  reorderNode: (fromIndex, toIndex) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes)
      const newNodes = [...state.nodes]
      const [removed] = newNodes.splice(fromIndex, 1)
      newNodes.splice(toIndex, 0, removed)
      return { nodes: newNodes }
    }),

  setVisibility: (id, visible) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes)
      return { nodes: setVisibilityRecursive(state.nodes, id, visible) }
    }),

  toggleVisibility: (id) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes)
      return { nodes: toggleVisibilityRecursive(state.nodes, id) }
    }),

  toggleFrameExpanded: (id) =>
    set((state) => {
      const newSet = new Set(state.expandedFrameIds)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return { expandedFrameIds: newSet }
    }),

  setFrameExpanded: (id, expanded) =>
    set((state) => {
      const newSet = new Set(state.expandedFrameIds)
      if (expanded) {
        newSet.add(id)
      } else {
        newSet.delete(id)
      }
      return { expandedFrameIds: newSet }
    }),

  moveNode: (nodeId, newParentId, newIndex) =>
    set((state) => {
      // Extract the node from its current position
      const { node, remaining } = extractNodeRecursive(state.nodes, nodeId)
      if (!node) return state

      useHistoryStore.getState().saveHistory(state.nodes)
      // Insert the node at the new position
      const newNodes = insertNodeRecursive(remaining, node, newParentId, newIndex)
      return { nodes: newNodes }
    }),

  updateDescendantOverride: (instanceId, descendantId, updates) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes)
      return { nodes: updateDescendantOverrideRecursive(state.nodes, instanceId, descendantId, updates) }
    }),

  resetDescendantOverride: (instanceId, descendantId, property) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes)
      return { nodes: resetDescendantOverrideRecursive(state.nodes, instanceId, descendantId, property) }
    }),
}))
