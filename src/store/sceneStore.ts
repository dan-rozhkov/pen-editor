import { create } from 'zustand'
import type { SceneNode } from '../types/scene'

interface SceneState {
  nodes: SceneNode[]
  addNode: (node: SceneNode) => void
  updateNode: (id: string, updates: Partial<SceneNode>) => void
  deleteNode: (id: string) => void
  clearNodes: () => void
  reorderNode: (fromIndex: number, toIndex: number) => void
  setVisibility: (id: string, visible: boolean) => void
  toggleVisibility: (id: string) => void
}

export const useSceneStore = create<SceneState>((set) => ({
  nodes: [],

  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes, node],
    })),

  updateNode: (id, updates) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? ({ ...node, ...updates } as SceneNode) : node
      ),
    })),

  deleteNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id),
    })),

  clearNodes: () => set({ nodes: [] }),

  reorderNode: (fromIndex, toIndex) =>
    set((state) => {
      const newNodes = [...state.nodes]
      const [removed] = newNodes.splice(fromIndex, 1)
      newNodes.splice(toIndex, 0, removed)
      return { nodes: newNodes }
    }),

  setVisibility: (id, visible) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? ({ ...node, visible } as SceneNode) : node
      ),
    })),

  toggleVisibility: (id) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? ({ ...node, visible: node.visible === false ? true : false } as SceneNode)
          : node
      ),
    })),
}))
