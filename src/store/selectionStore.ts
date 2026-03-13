import { create } from 'zustand'
import type { HistorySnapshot, SelectionSnapshot } from '../types/scene'
import { useHistoryStore } from './historyStore'
import { useSceneStore } from './sceneStore'

type EditingMode = 'text' | 'name' | 'embed' | null

export interface InstanceContext {
  instanceId: string
  descendantPath: string
}

interface SelectionState {
  selectedIds: string[]
  editingNodeId: string | null
  editingMode: EditingMode
  editingInstanceId: string | null
  instanceContext: InstanceContext | null
  // Nested selection: the container the user has drilled into via double-click
  enteredContainerId: string | null
  // Last selected node ID for range selection
  lastSelectedId: string | null

  select: (id: string) => void
  setSelectedIds: (ids: string[]) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  clearSelection: () => void
  isSelected: (id: string) => boolean
  selectRange: (fromId: string, toId: string, flatIds: string[]) => void
  startEditing: (id: string, mode?: EditingMode) => void
  stopEditing: () => void
  enterInstanceEditMode: (instanceId: string) => void
  exitInstanceEditMode: () => void
  selectDescendant: (instanceId: string, descendantPath: string) => void
  clearDescendantSelection: () => void
  // Nested selection methods
  enterContainer: (containerId: string) => void
  resetContainerContext: () => void
}

function areArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function getSelectionSnapshot(state: SelectionState): SelectionSnapshot {
  return {
    selectedIds: [...state.selectedIds],
    enteredContainerId: state.enteredContainerId,
    lastSelectedId: state.lastSelectedId,
  }
}

function saveSelectionHistoryIfChanged(
  current: SelectionSnapshot,
  next: SelectionSnapshot,
): void {
  const same =
    areArraysEqual(current.selectedIds, next.selectedIds) &&
    current.enteredContainerId === next.enteredContainerId &&
    current.lastSelectedId === next.lastSelectedId

  if (same) return

  const scene = useSceneStore.getState()
  const snapshot: HistorySnapshot = {
    nodesById: { ...scene.nodesById },
    parentById: { ...scene.parentById },
    childrenById: { ...scene.childrenById },
    rootIds: [...scene.rootIds],
    selection: current,
  }
  useHistoryStore.getState().saveHistory(snapshot)
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: [],
  editingNodeId: null,
  editingMode: null,
  editingInstanceId: null,
  instanceContext: null,
  enteredContainerId: null,
  lastSelectedId: null,

  select: (id: string) => {
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      selectedIds: [id],
      lastSelectedId: id,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({
      selectedIds: [id],
      editingNodeId: null,
      editingMode: null,
      editingInstanceId: null,
      instanceContext: null,
      lastSelectedId: id
    })
  },

  setSelectedIds: (ids: string[]) => {
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      selectedIds: [...ids],
      lastSelectedId: ids.length > 0 ? ids[ids.length - 1] : null,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({
      selectedIds: ids,
      editingNodeId: null,
      editingMode: null,
      editingInstanceId: null,
      instanceContext: null,
      lastSelectedId: ids.length > 0 ? ids[ids.length - 1] : null
    })
  },

  addToSelection: (id: string) => {
    const { selectedIds } = get()
    if (!selectedIds.includes(id)) {
      const current = getSelectionSnapshot(get())
      const next: SelectionSnapshot = {
        ...current,
        selectedIds: [...selectedIds, id],
      }
      saveSelectionHistoryIfChanged(current, next)
      set({ selectedIds: [...selectedIds, id] })
    }
  },

  removeFromSelection: (id: string) => {
    const { selectedIds } = get()
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      selectedIds: selectedIds.filter((sid) => sid !== id),
    }
    saveSelectionHistoryIfChanged(current, next)
    set({ selectedIds: selectedIds.filter((sid) => sid !== id) })
  },

  clearSelection: () => {
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      selectedIds: [],
      enteredContainerId: null,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({
      selectedIds: [],
      editingNodeId: null,
      editingMode: null,
      editingInstanceId: null,
      instanceContext: null,
      enteredContainerId: null
    })
  },

  isSelected: (id: string) => {
    return get().selectedIds.includes(id)
  },

  selectRange: (fromId: string, toId: string, flatIds: string[]) => {
    const fromIndex = flatIds.indexOf(fromId)
    const toIndex = flatIds.indexOf(toId)

    if (fromIndex === -1 || toIndex === -1) {
      const current = getSelectionSnapshot(get())
      const next: SelectionSnapshot = {
        ...current,
        selectedIds: [toId],
        lastSelectedId: toId,
      }
      saveSelectionHistoryIfChanged(current, next)
      set({ selectedIds: [toId], lastSelectedId: toId })
      return
    }

    const minIndex = Math.min(fromIndex, toIndex)
    const maxIndex = Math.max(fromIndex, toIndex)
    const rangeIds = flatIds.slice(minIndex, maxIndex + 1)

    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      selectedIds: rangeIds,
      lastSelectedId: toId,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({
      selectedIds: rangeIds,
      editingNodeId: null,
      editingMode: null,
      editingInstanceId: null,
      instanceContext: null,
      lastSelectedId: toId
    })
  },

  startEditing: (id: string, mode: EditingMode = 'text') => {
    if (get().selectedIds.includes(id)) {
      set({ editingNodeId: id, editingMode: mode })
    }
  },

  stopEditing: () => {
    set({ editingNodeId: null, editingMode: null })
  },

  enterInstanceEditMode: (instanceId: string) => {
    set({
      editingInstanceId: instanceId,
      instanceContext: null,
      selectedIds: [instanceId],
      editingNodeId: null,
      editingMode: null,
    })
  },

  exitInstanceEditMode: () => {
    const { editingInstanceId } = get()
    set({
      editingInstanceId: null,
      instanceContext: null,
      selectedIds: editingInstanceId ? [editingInstanceId] : [],
    })
  },

  selectDescendant: (instanceId: string, descendantPath: string) => {
    set({
      selectedIds: [instanceId],
      editingInstanceId: instanceId,
      instanceContext: { instanceId, descendantPath },
      editingNodeId: null,
      editingMode: null,
    })
  },

  clearDescendantSelection: () => {
    set({ instanceContext: null })
  },

  // Nested selection methods
  enterContainer: (containerId: string) => {
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      enteredContainerId: containerId,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({ enteredContainerId: containerId })
  },

  resetContainerContext: () => {
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      enteredContainerId: null,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({ enteredContainerId: null })
  },
}))
