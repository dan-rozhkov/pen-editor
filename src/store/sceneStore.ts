import { create } from 'zustand'
import type { SceneNode, FrameNode, GroupNode, RefNode, TextNode, DescendantOverride } from '../types/scene'
import { isContainerNode, generateId } from '../types/scene'
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
  // Group/ungroup operations
  groupNodes: (ids: string[]) => string | null
  ungroupNodes: (ids: string[]) => string[]
  // Page-level properties
  pageBackground: string
  setPageBackground: (color: string) => void
}

// Helper to recurse into container children
function mapContainerChildren(node: SceneNode, mapFn: (nodes: SceneNode[]) => SceneNode[]): SceneNode {
  if (isContainerNode(node)) {
    return { ...node, children: mapFn(node.children) } as FrameNode | GroupNode
  }
  return node
}

// Recursively sync text node dimensions throughout the tree
function syncAllTextDimensions(nodes: SceneNode[]): SceneNode[] {
  return nodes.map(node => {
    if (node.type === 'text') {
      return syncTextDimensions(node)
    }
    if (isContainerNode(node)) {
      return { ...node, children: syncAllTextDimensions(node.children) } as FrameNode | GroupNode
    }
    return node
  })
}

// Helper to recursively add child to a container (frame or group)
function addChildToFrameRecursive(nodes: SceneNode[], frameId: string, child: SceneNode): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === frameId && isContainerNode(node)) {
      return { ...node, children: [...node.children, child] } as FrameNode | GroupNode
    }
    if (isContainerNode(node)) {
      return { ...node, children: addChildToFrameRecursive(node.children, frameId, child) } as FrameNode | GroupNode
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
    if (isContainerNode(node)) {
      return { ...node, children: updateNodeRecursive(node.children, id, updates) } as FrameNode | GroupNode
    }
    return node
  })
}

// Helper to recursively delete a node anywhere in the tree
function deleteNodeRecursive(nodes: SceneNode[], id: string): SceneNode[] {
  return nodes.reduce<SceneNode[]>((acc, node) => {
    // Skip the node to delete
    if (node.id === id) return acc
    // Recursively process container children
    if (isContainerNode(node)) {
      acc.push({ ...node, children: deleteNodeRecursive(node.children, id) } as FrameNode | GroupNode)
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
    if (isContainerNode(node)) {
      return { ...node, children: toggleVisibilityRecursive(node.children, id) } as FrameNode | GroupNode
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
    if (isContainerNode(node)) {
      return { ...node, children: setVisibilityRecursive(node.children, id, visible) } as FrameNode | GroupNode
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
    if (isContainerNode(node)) {
      const result = extractNodeRecursive(node.children, id)
      if (result.node) {
        foundNode = result.node
      }
      acc.push({ ...node, children: result.remaining } as FrameNode | GroupNode)
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
    if (node.id === parentId && isContainerNode(node)) {
      const newChildren = [...node.children]
      newChildren.splice(index, 0, nodeToInsert)
      return { ...node, children: newChildren } as FrameNode | GroupNode
    }
    if (isContainerNode(node)) {
      return { ...node, children: insertNodeRecursive(node.children, nodeToInsert, parentId, index) } as FrameNode | GroupNode
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
    if (isContainerNode(node)) {
      return { ...node, children: recurse(node.children) } as FrameNode | GroupNode
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
    if (isContainerNode(node)) {
      return { ...node, children: recurse(node.children) } as FrameNode | GroupNode
    }
    return node
  })
}

// Helper to find the index and parent of a node
function findNodePosition(nodes: SceneNode[], id: string, parentId: string | null = null): { parentId: string | null; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) {
      return { parentId, index: i }
    }
    const node = nodes[i]
    if (isContainerNode(node)) {
      const found = findNodePosition(node.children, id, node.id)
      if (found) return found
    }
  }
  return null
}

// Helper to find a node by ID recursively
function findNodeInTree(nodes: SceneNode[], id: string): SceneNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (isContainerNode(node)) {
      const found = findNodeInTree(node.children, id)
      if (found) return found
    }
  }
  return null
}

// Group selected nodes into a new GroupNode
function groupNodesInTree(nodes: SceneNode[], ids: string[]): { nodes: SceneNode[]; groupId: string } | null {
  if (ids.length < 2) return null

  // Find positions of all nodes - they must all be in the same parent
  const positions = ids.map(id => findNodePosition(nodes, id))
  if (positions.some(p => p === null)) return null
  const validPositions = positions as { parentId: string | null; index: number }[]

  // All nodes must share the same parent
  const parentId = validPositions[0].parentId
  if (!validPositions.every(p => p.parentId === parentId)) return null

  // Get the actual node objects
  const selectedNodes = ids.map(id => findNodeInTree(nodes, id)!).filter(Boolean)
  if (selectedNodes.length !== ids.length) return null

  // Calculate bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const node of selectedNodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }

  // Create group with children at relative positions
  const groupId = generateId()
  const groupNode: GroupNode = {
    id: groupId,
    type: 'group',
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    children: selectedNodes.map(node => ({
      ...node,
      x: node.x - minX,
      y: node.y - minY,
    } as SceneNode)),
  }

  // Find the insertion index (smallest index among selected nodes)
  const insertIndex = Math.min(...validPositions.map(p => p.index))

  // Remove selected nodes and insert group
  const idSet = new Set(ids)

  function processLevel(levelNodes: SceneNode[], levelParentId: string | null): SceneNode[] {
    if (levelParentId !== parentId) {
      // Not the target level, recurse into containers
      return levelNodes.map(node => {
        if (isContainerNode(node)) {
          return { ...node, children: processLevel(node.children, node.id) } as FrameNode | GroupNode
        }
        return node
      })
    }

    // This is the target level - remove selected nodes and insert group
    const filtered = levelNodes.filter(n => !idSet.has(n.id))
    const adjustedIndex = Math.min(insertIndex, filtered.length)
    filtered.splice(adjustedIndex, 0, groupNode)
    return filtered
  }

  return { nodes: processLevel(nodes, null), groupId }
}

// Ungroup a group node, placing its children back at the group's level
function ungroupNodeInTree(nodes: SceneNode[], groupId: string): SceneNode[] | null {
  const pos = findNodePosition(nodes, groupId)
  if (!pos) return null

  const groupNode = findNodeInTree(nodes, groupId)
  if (!groupNode || groupNode.type !== 'group') return null

  const group = groupNode as GroupNode

  // Adjust children positions to be absolute (relative to the group's parent)
  const absoluteChildren = group.children.map(child => ({
    ...child,
    x: child.x + group.x,
    y: child.y + group.y,
  } as SceneNode))

  function processLevel(levelNodes: SceneNode[], levelParentId: string | null): SceneNode[] {
    if (levelParentId !== pos!.parentId) {
      return levelNodes.map(node => {
        if (isContainerNode(node)) {
          return { ...node, children: processLevel(node.children, node.id) } as FrameNode | GroupNode
        }
        return node
      })
    }

    // Replace group with its children
    const result: SceneNode[] = []
    for (const node of levelNodes) {
      if (node.id === groupId) {
        result.push(...absoluteChildren)
      } else {
        result.push(node)
      }
    }
    return result
  }

  return processLevel(nodes, null)
}

export const useSceneStore = create<SceneState>((set) => ({
  nodes: [],
  expandedFrameIds: new Set<string>(),
  pageBackground: '#f5f5f5',

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

  groupNodes: (ids) => {
    const state = useSceneStore.getState()
    const result = groupNodesInTree(state.nodes, ids)
    if (!result) return null
    useHistoryStore.getState().saveHistory(state.nodes)
    useSceneStore.setState({ nodes: result.nodes })
    return result.groupId
  },

  ungroupNodes: (ids) => {
    const state = useSceneStore.getState()
    let currentNodes = state.nodes
    const childIds: string[] = []

    useHistoryStore.getState().saveHistory(state.nodes)
    for (const id of ids) {
      const node = findNodeInTree(currentNodes, id)
      if (node && node.type === 'group') {
        const group = node as GroupNode
        childIds.push(...group.children.map(c => c.id))
        const result = ungroupNodeInTree(currentNodes, id)
        if (result) {
          currentNodes = result
        }
      }
    }
    useSceneStore.setState({ nodes: currentNodes })
    return childIds
  },

  setPageBackground: (color) =>
    set(() => {
      return { pageBackground: color }
    }),
}))
