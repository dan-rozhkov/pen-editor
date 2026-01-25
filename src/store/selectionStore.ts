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

  select: (id: string) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  clearSelection: () => void
  isSelected: (id: string) => boolean
  startEditing: (id: string) => void
  startNameEditing: (id: string) => void
  stopEditing: () => void
  // Instance editing methods
  enterInstanceEditMode: (instanceId: string) => void
  exitInstanceEditMode: () => void
  selectDescendant: (instanceId: string, descendantId: string) => void
  clearDescendantSelection: () => void
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: [],
  editingNodeId: null,
  editingMode: null,
  editingInstanceId: null,
  instanceContext: null,

  select: (id: string) => {
    // Stop editing and exit instance mode when selection changes
    set({
      selectedIds: [id],
      editingNodeId: null,
      editingMode: null,
      editingInstanceId: null,
      instanceContext: null
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
      instanceContext: null
    })
  },

  isSelected: (id: string) => {
    return get().selectedIds.includes(id)
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
}))
