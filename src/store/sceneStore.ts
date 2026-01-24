import { create } from 'zustand'
import type { SceneNode } from '../types/scene'

interface SceneState {
  nodes: SceneNode[]
  addNode: (node: SceneNode) => void
  updateNode: (id: string, updates: Partial<SceneNode>) => void
  deleteNode: (id: string) => void
  clearNodes: () => void
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
}))
