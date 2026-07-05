import { create } from 'zustand'
import type { SelectionSnapshot } from '../types/scene'
import { buildHistorySnapshot } from './historySnapshot'
import { useGuidesStore } from './guidesStore'
import { useHistoryStore } from './historyStore'
import { useSceneStore } from './sceneStore'
import { useVariableStore } from './variableStore'

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
  // Depth within an entered ref instance (e.g. "childId/grandchildId")
  enteredInstanceDescendantPath: string | null
  // Last selected node ID for range selection
  lastSelectedId: string | null
  // The embed currently "entered" for live interaction (pointer-events: auto)
  activeEmbedId: string | null

  select: (id: string) => void
  setSelectedIds: (ids: string[]) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  clearSelection: () => void
  setActiveEmbed: (id: string | null) => void
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
  enterInstanceDescendant: (path: string) => void
  exitContainer: () => boolean
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
  const snapshot = buildHistorySnapshot(
    scene,
    useVariableStore.getState().variables,
    current,
    useGuidesStore.getState().guides,
  )
  useHistoryStore.getState().saveHistory(snapshot)
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: [],
  editingNodeId: null,
  editingMode: null,
  editingInstanceId: null,
  instanceContext: null,
  enteredContainerId: null,
  enteredInstanceDescendantPath: null,
  lastSelectedId: null,
  activeEmbedId: null,

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
      lastSelectedId: id,
      activeEmbedId: null,
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
      lastSelectedId: ids.length > 0 ? ids[ids.length - 1] : null,
      activeEmbedId: null,
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
      set({ selectedIds: [...selectedIds, id], activeEmbedId: null })
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
    set({ selectedIds: selectedIds.filter((sid) => sid !== id), activeEmbedId: null })
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
      enteredContainerId: null,
      enteredInstanceDescendantPath: null,
      activeEmbedId: null,
    })
  },

  setActiveEmbed: (id: string | null) => set({ activeEmbedId: id }),

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
      set({ selectedIds: [toId], lastSelectedId: toId, activeEmbedId: null })
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
      lastSelectedId: toId,
      activeEmbedId: null,
    })
  },

  startEditing: (id: string, mode: EditingMode = 'text') => {
    const state = get()
    // Allow editing for regular selected nodes or instance descendants
    if (state.selectedIds.includes(id) || (state.instanceContext && state.instanceContext.descendantPath === id)) {
      set({ editingNodeId: id, editingMode: mode })
    }
  },

  stopEditing: () => {
    set({ editingNodeId: null, editingMode: null, activeEmbedId: null })
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
    set({ enteredContainerId: containerId, enteredInstanceDescendantPath: null })
  },

  enterInstanceDescendant: (path: string) => {
    set({ enteredInstanceDescendantPath: path })
  },

  exitContainer: () => {
    const { enteredContainerId, instanceContext, editingNodeId, enteredInstanceDescendantPath, activeEmbedId } = get()
    // Step 0: Exit an active (interactive) embed first
    if (activeEmbedId) {
      set({ activeEmbedId: null })
      return true
    }
    // Step 1: Stop editing
    if (editingNodeId) {
      set({ editingNodeId: null, editingMode: null })
      return true
    }
    // Step 2: Exit descendant selection within instance
    if (instanceContext) {
      set({
        instanceContext: null,
        editingInstanceId: null,
        selectedIds: enteredContainerId ? [enteredContainerId] : [],
      })
      return true
    }
    // Step 3: Exit one level within entered instance
    if (enteredInstanceDescendantPath) {
      const lastSlash = enteredInstanceDescendantPath.lastIndexOf("/")
      set({
        enteredInstanceDescendantPath: lastSlash >= 0
          ? enteredInstanceDescendantPath.slice(0, lastSlash)
          : null,
      })
      return true
    }
    // Step 4: Exit entered container
    if (enteredContainerId) {
      const current = getSelectionSnapshot(get())
      const next = { ...current, enteredContainerId: null }
      saveSelectionHistoryIfChanged(current, next)
      set({ enteredContainerId: null, selectedIds: [enteredContainerId] })
      return true
    }
    return false
  },

  resetContainerContext: () => {
    const current = getSelectionSnapshot(get())
    const next: SelectionSnapshot = {
      ...current,
      enteredContainerId: null,
    }
    saveSelectionHistoryIfChanged(current, next)
    set({ enteredContainerId: null, enteredInstanceDescendantPath: null })
  },
}))
