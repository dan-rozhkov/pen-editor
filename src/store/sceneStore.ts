import { create } from 'zustand'
import type { SceneNode, FrameNode } from '../types/scene'

interface SceneState {
  nodes: SceneNode[]
  expandedFrameIds: Set<string>
  addNode: (node: SceneNode) => void
  addChildToFrame: (frameId: string, child: SceneNode) => void
  updateNode: (id: string, updates: Partial<SceneNode>) => void
  deleteNode: (id: string) => void
  clearNodes: () => void
  setNodes: (nodes: SceneNode[]) => void
  reorderNode: (fromIndex: number, toIndex: number) => void
  setVisibility: (id: string, visible: boolean) => void
  toggleVisibility: (id: string) => void
  toggleFrameExpanded: (id: string) => void
  setFrameExpanded: (id: string, expanded: boolean) => void
  moveNode: (nodeId: string, newParentId: string | null, newIndex: number) => void
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

// Helper to recursively update a node anywhere in the tree
function updateNodeRecursive(nodes: SceneNode[], id: string, updates: Partial<SceneNode>): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, ...updates } as SceneNode
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

export const useSceneStore = create<SceneState>((set) => ({
  nodes: [],
  expandedFrameIds: new Set<string>(),

  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),

  addChildToFrame: (frameId, child) =>
    set((state) => ({
      nodes: addChildToFrameRecursive(state.nodes, frameId, child),
    })),

  updateNode: (id, updates) =>
    set((state) => ({
      nodes: updateNodeRecursive(state.nodes, id, updates),
    })),

  deleteNode: (id) =>
    set((state) => ({
      nodes: deleteNodeRecursive(state.nodes, id),
    })),

  clearNodes: () => set({ nodes: [] }),

  setNodes: (nodes) => set({ nodes }),

  reorderNode: (fromIndex, toIndex) =>
    set((state) => {
      const newNodes = [...state.nodes]
      const [removed] = newNodes.splice(fromIndex, 1)
      newNodes.splice(toIndex, 0, removed)
      return { nodes: newNodes }
    }),

  setVisibility: (id, visible) =>
    set((state) => ({
      nodes: setVisibilityRecursive(state.nodes, id, visible),
    })),

  toggleVisibility: (id) =>
    set((state) => ({
      nodes: toggleVisibilityRecursive(state.nodes, id),
    })),

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

      // Insert the node at the new position
      const newNodes = insertNodeRecursive(remaining, node, newParentId, newIndex)
      return { nodes: newNodes }
    }),
}))
