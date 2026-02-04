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
  // Instance editing mode (double-click on instance to enter)
  editingInstanceId: string | null
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
  // Instance editing methods
  enterInstanceEditMode: (instanceId: string) => void
  exitInstanceEditMode: () => void
  selectDescendant: (instanceId: string, descendantId: string) => void
  clearDescendantSelection: () => void
  // Nested selection methods
  enterContainer: (containerId: string) => void
  resetContainerContext: () => void
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
    // Stop editing and exit instance mode when selection changes
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
      editingInstanceId: null,
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

  // Instance editing methods
  enterInstanceEditMode: (instanceId: string) => {
    // Enter instance edit mode - allows clicking on descendants
    set({
      editingInstanceId: instanceId,
      selectedIds: [instanceId],
      instanceContext: null
    })
  },

  exitInstanceEditMode: () => {
    const { editingInstanceId } = get()
    // Exit instance edit mode and keep instance selected
    set({
      editingInstanceId: null,
      instanceContext: null,
      selectedIds: editingInstanceId ? [editingInstanceId] : []
    })
  },

  selectDescendant: (instanceId: string, descendantId: string) => {
    // Select a descendant node inside an instance
    set({
      instanceContext: { instanceId, descendantId },
      selectedIds: [instanceId],
      editingInstanceId: instanceId
    })
  },

  clearDescendantSelection: () => {
    set({ instanceContext: null })
  },

  // Nested selection methods
  enterContainer: (containerId: string) => {
    set({ enteredContainerId: containerId })
  },

  resetContainerContext: () => {
    set({ enteredContainerId: null })
  },
}))
