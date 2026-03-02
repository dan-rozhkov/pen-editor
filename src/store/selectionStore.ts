import { create } from 'zustand'
import type { HistorySnapshot, SelectionSnapshot } from '../types/scene'
import { useHistoryStore } from './historyStore'
import { useSceneStore } from './sceneStore'

type EditingMode = 'text' | 'name' | 'embed' | null

// Context for editing a descendant node inside an instance
export interface InstanceContext {
  instanceId: string    // ID of the instance (RefNode)
  descendantId: string  // ID of the descendant node being edited
  // Optional unique path inside resolved instance tree (used by Pixi to disambiguate duplicate IDs)
  descendantPath?: string
}

interface SelectionState {
  selectedIds: string[]
  editingNodeId: string | null
  editingMode: EditingMode
  // Currently selected descendant inside an instance
  instanceContext: InstanceContext | null
  // Range selection of descendants inside current instance context
  selectedDescendantIds: string[]
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
  // Instance interaction methods
  selectDescendant: (instanceId: string, descendantId: string, descendantPath?: string) => void
  selectDescendantRange: (
    instanceId: string,
    fromDescendantId: string,
    toDescendantId: string,
    flatDescendantIds: string[],
  ) => void
  startDescendantEditing: () => void
  clearDescendantSelection: () => void
  clearInstanceContext: () => void
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

function isInstanceContextEqual(
  a: SelectionSnapshot['instanceContext'],
  b: SelectionSnapshot['instanceContext'],
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.instanceId === b.instanceId &&
    a.descendantId === b.descendantId &&
    a.descendantPath === b.descendantPath
  )
}

function getSelectionSnapshot(state: SelectionState): SelectionSnapshot {
  return {
    selectedIds: [...state.selectedIds],
    instanceContext: state.instanceContext ? { ...state.instanceContext } : null,
    selectedDescendantIds: [...state.selectedDescendantIds],
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
    isInstanceContextEqual(current.instanceContext, next.instanceContext) &&
    areArraysEqual(current.selectedDescendantIds, next.selectedDescendantIds) &&
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
  instanceContext: null,
  selectedDescendantIds: [],
  enteredContainerId: null,
  lastSelectedId: null,

  select: (id: string) => {
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      selectedIds: [id],
      instanceContext: null,
      selectedDescendantIds: [],
      lastSelectedId: id,
    }
    saveSelectionHistoryIfChanged(current, next)
    // Stop editing and clear instance context when selection changes
    set({
      selectedIds: [id],
      editingNodeId: null,
      editingMode: null,
      instanceContext: null,
      selectedDescendantIds: [],
      lastSelectedId: id
    })
  },

  setSelectedIds: (ids: string[]) => {
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      selectedIds: [...ids],
      instanceContext: null,
      selectedDescendantIds: [],
      lastSelectedId: ids.length > 0 ? ids[ids.length - 1] : null,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({
      selectedIds: ids,
      editingNodeId: null,
      editingMode: null,
      instanceContext: null,
      selectedDescendantIds: [],
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
      instanceContext: null,
      selectedDescendantIds: [],
      enteredContainerId: null,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({
      selectedIds: [],
      editingNodeId: null,
      editingMode: null,
      instanceContext: null,
      selectedDescendantIds: [],
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
      // One of the IDs not found in the flat list, fall back to single selection
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
      instanceContext: null,
      selectedDescendantIds: [],
      lastSelectedId: toId,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({
      selectedIds: rangeIds,
      editingNodeId: null,
      editingMode: null,
      instanceContext: null,
      selectedDescendantIds: [],
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

  // Instance interaction methods
  selectDescendant: (instanceId: string, descendantId: string, descendantPath?: string) => {
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      instanceContext: {
        instanceId,
        descendantId,
        descendantPath,
      },
      selectedIds: [instanceId],
      selectedDescendantIds: [descendantId],
      lastSelectedId: instanceId,
    }
    saveSelectionHistoryIfChanged(current, next)
    // Select a descendant node inside an instance
    set({
      instanceContext: {
        instanceId,
        descendantId,
        descendantPath,
      },
      selectedIds: [instanceId],
      selectedDescendantIds: [descendantId],
      lastSelectedId: instanceId,
    })
  },

  selectDescendantRange: (
    instanceId: string,
    fromDescendantId: string,
    toDescendantId: string,
    flatDescendantIds: string[],
  ) => {
    const fromIndex = flatDescendantIds.indexOf(fromDescendantId)
    const toIndex = flatDescendantIds.indexOf(toDescendantId)

    if (fromIndex === -1 || toIndex === -1) {
      const current = getSelectionSnapshot(get())
      const next: SelectionSnapshot = {
        ...current,
        instanceContext: { instanceId, descendantId: toDescendantId },
        selectedIds: [instanceId],
        selectedDescendantIds: [toDescendantId],
        lastSelectedId: instanceId,
      }
      saveSelectionHistoryIfChanged(current, next)
      set({
        instanceContext: { instanceId, descendantId: toDescendantId },
        selectedIds: [instanceId],
        selectedDescendantIds: [toDescendantId],
        lastSelectedId: instanceId,
      })
      return
    }

    const minIndex = Math.min(fromIndex, toIndex)
    const maxIndex = Math.max(fromIndex, toIndex)
    const rangeIds = flatDescendantIds.slice(minIndex, maxIndex + 1)

    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      instanceContext: { instanceId, descendantId: toDescendantId },
      selectedIds: [instanceId],
      selectedDescendantIds: rangeIds,
      lastSelectedId: instanceId,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({
      instanceContext: { instanceId, descendantId: toDescendantId },
      selectedIds: [instanceId],
      selectedDescendantIds: rangeIds,
      lastSelectedId: instanceId,
    })
  },

  startDescendantEditing: () => {
    const { instanceContext } = get()
    if (instanceContext) {
      set({ editingMode: 'text' })
    }
  },

  clearDescendantSelection: () => {
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      instanceContext: null,
      selectedDescendantIds: [],
    }
    saveSelectionHistoryIfChanged(current, next)
    set({ instanceContext: null, selectedDescendantIds: [] })
  },

  clearInstanceContext: () => {
    const { instanceContext } = get()
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      instanceContext: null,
      selectedDescendantIds: [],
      selectedIds: instanceContext ? [instanceContext.instanceId] : [],
    }
    saveSelectionHistoryIfChanged(current, next)
    // Clear instance context and keep instance selected
    set({
      instanceContext: null,
      selectedDescendantIds: [],
      selectedIds: instanceContext ? [instanceContext.instanceId] : []
    })
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
