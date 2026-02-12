import { create } from 'zustand'

type EditingMode = 'text' | 'name' | null

// Context for editing a descendant node inside an instance
export interface InstanceContext {
  instanceId: string    // ID of the instance (RefNode)
  descendantId: string  // ID of the descendant node being edited
}

interface SelectionState {
  selectedIds: string[]
  editingNodeId: string | null
  editingMode: EditingMode
  // Currently selected descendant inside an instance
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
  startEditing: (id: string) => void
  startNameEditing: (id: string) => void
  stopEditing: () => void
  // Instance interaction methods
  selectDescendant: (instanceId: string, descendantId: string) => void
  startDescendantEditing: () => void
  clearDescendantSelection: () => void
  clearInstanceContext: () => void
  // Nested selection methods
  enterContainer: (containerId: string) => void
  resetContainerContext: () => void
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: [],
  editingNodeId: null,
  editingMode: null,
  instanceContext: null,
  enteredContainerId: null,
  lastSelectedId: null,

  select: (id: string) => {
    // Stop editing and clear instance context when selection changes
    set({
      selectedIds: [id],
      editingNodeId: null,
      editingMode: null,
      instanceContext: null,
      lastSelectedId: id
    })
  },

  setSelectedIds: (ids: string[]) => {
    set({
      selectedIds: ids,
      editingNodeId: null,
      editingMode: null,
      instanceContext: null,
      lastSelectedId: ids.length > 0 ? ids[ids.length - 1] : null
    })
  },

  addToSelection: (id: string) => {
    const { selectedIds } = get()
    if (!selectedIds.includes(id)) {
      set({ selectedIds: [...selectedIds, id] })
    }
  },

  removeFromSelection: (id: string) => {
    const { selectedIds } = get()
    set({ selectedIds: selectedIds.filter((sid) => sid !== id) })
  },

  clearSelection: () => {
    set({
      selectedIds: [],
      editingNodeId: null,
      editingMode: null,
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
      // One of the IDs not found in the flat list, fall back to single selection
      set({ selectedIds: [toId], lastSelectedId: toId })
      return
    }

    const minIndex = Math.min(fromIndex, toIndex)
    const maxIndex = Math.max(fromIndex, toIndex)
    const rangeIds = flatIds.slice(minIndex, maxIndex + 1)

    set({
      selectedIds: rangeIds,
      editingNodeId: null,
      editingMode: null,
      instanceContext: null,
      lastSelectedId: toId
    })
  },

  startEditing: (id: string) => {
    // Can only edit text content if node is selected
    if (get().selectedIds.includes(id)) {
      set({ editingNodeId: id, editingMode: 'text' })
    }
  },

  startNameEditing: (id: string) => {
    // Can only edit frame name if node is selected
    if (get().selectedIds.includes(id)) {
      set({ editingNodeId: id, editingMode: 'name' })
    }
  },

  stopEditing: () => {
    set({ editingNodeId: null, editingMode: null })
  },

  // Instance interaction methods
  selectDescendant: (instanceId: string, descendantId: string) => {
    // Select a descendant node inside an instance
    set({
      instanceContext: { instanceId, descendantId },
      selectedIds: [instanceId],
    })
  },

  startDescendantEditing: () => {
    const { instanceContext } = get()
    if (instanceContext) {
      set({ editingMode: 'text' })
    }
  },

  clearDescendantSelection: () => {
    set({ instanceContext: null })
  },

  clearInstanceContext: () => {
    const { instanceContext } = get()
    // Clear instance context and keep instance selected
    set({
      instanceContext: null,
      selectedIds: instanceContext ? [instanceContext.instanceId] : []
    })
  },

  // Nested selection methods
  enterContainer: (containerId: string) => {
    set({ enteredContainerId: containerId })
  },

  resetContainerContext: () => {
    set({ enteredContainerId: null })
  },
}))
