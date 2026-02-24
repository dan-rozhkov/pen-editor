import { create } from 'zustand'
import type { HistorySnapshot } from '../types/scene'

const MAX_HISTORY_SIZE = 50

interface HistoryState {
  past: HistorySnapshot[]
  future: HistorySnapshot[]
  batchMode: boolean

  // Save current state to history (called before mutations)
  saveHistory: (currentSnapshot: HistorySnapshot) => void

  // Undo: pop from past, return snapshot to restore
  undo: (currentSnapshot: HistorySnapshot) => HistorySnapshot | null

  // Redo: pop from future, return snapshot to restore
  redo: (currentSnapshot: HistorySnapshot) => HistorySnapshot | null

  // Check if undo/redo available
  canUndo: () => boolean
  canRedo: () => boolean

  // Clear all history
  clear: () => void

  // Batch mode: multiple mutations as single undo step
  startBatch: () => void
  endBatch: () => void
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  batchMode: false,

  saveHistory: (currentSnapshot) => {
    const { batchMode, past } = get()

    // Skip saving if in batch mode (will be saved at batch start)
    if (batchMode) return

    // Snapshot is already a shallow clone from createSnapshot() - safe to store directly
    const newPast = [...past, currentSnapshot]

    // Limit history size
    if (newPast.length > MAX_HISTORY_SIZE) {
      newPast.shift()
    }

    set({
      past: newPast,
      future: [], // Clear redo stack on new action
    })
  },

  undo: (currentSnapshot) => {
    const { past } = get()

    if (past.length === 0) return null

    const newPast = [...past]
    const previousState = newPast.pop()!

    // Save current state to future for redo
    set({
      past: newPast,
      future: [...get().future, currentSnapshot],
    })

    return previousState
  },

  redo: (currentSnapshot) => {
    const { future } = get()

    if (future.length === 0) return null

    const newFuture = [...future]
    const nextState = newFuture.pop()!

    // Save current state to past for undo
    set({
      past: [...get().past, currentSnapshot],
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
