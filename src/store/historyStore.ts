import { create } from 'zustand'
import type { SceneNode } from '../types/scene'

const MAX_HISTORY_SIZE = 50

interface HistoryState {
  past: SceneNode[][]
  future: SceneNode[][]
  batchMode: boolean

  // Save current state to history (called before mutations)
  saveHistory: (currentNodes: SceneNode[]) => void

  // Undo: pop from past, return state to restore
  undo: (currentNodes: SceneNode[]) => SceneNode[] | null

  // Redo: pop from future, return state to restore
  redo: (currentNodes: SceneNode[]) => SceneNode[] | null

  // Check if undo/redo available
  canUndo: () => boolean
  canRedo: () => boolean

  // Clear all history
  clear: () => void

  // Batch mode: multiple mutations as single undo step
  startBatch: () => void
  endBatch: () => void
}

// Deep clone nodes array to avoid reference issues
function cloneNodes(nodes: SceneNode[]): SceneNode[] {
  return JSON.parse(JSON.stringify(nodes))
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  batchMode: false,

  saveHistory: (currentNodes) => {
    const { batchMode, past } = get()

    // Skip saving if in batch mode (will be saved at batch start)
    if (batchMode) return

    const cloned = cloneNodes(currentNodes)
    const newPast = [...past, cloned]

    // Limit history size
    if (newPast.length > MAX_HISTORY_SIZE) {
      newPast.shift()
    }

    set({
      past: newPast,
      future: [], // Clear redo stack on new action
    })
  },

  undo: (currentNodes) => {
    const { past } = get()

    if (past.length === 0) return null

    const newPast = [...past]
    const previousState = newPast.pop()!

    // Save current state to future for redo
    const clonedCurrent = cloneNodes(currentNodes)

    set({
      past: newPast,
      future: [...get().future, clonedCurrent],
    })

    return previousState
  },

  redo: (currentNodes) => {
    const { future } = get()

    if (future.length === 0) return null

    const newFuture = [...future]
    const nextState = newFuture.pop()!

    // Save current state to past for undo
    const clonedCurrent = cloneNodes(currentNodes)

    set({
      past: [...get().past, clonedCurrent],
      future: newFuture,
    })

    return nextState
  },

  canUndo: () => get().past.length > 0,

  canRedo: () => get().future.length > 0,

  clear: () => set({ past: [], future: [] }),

  startBatch: () => set({ batchMode: true }),

  endBatch: () => set({ batchMode: false }),
}))
