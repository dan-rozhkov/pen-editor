import { create } from 'zustand'

interface SelectionState {
  selectedIds: string[]
  editingNodeId: string | null

  select: (id: string) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  clearSelection: () => void
  isSelected: (id: string) => boolean
  startEditing: (id: string) => void
  stopEditing: () => void
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: [],
  editingNodeId: null,

  select: (id: string) => {
    // Stop editing when selection changes
    set({ selectedIds: [id], editingNodeId: null })
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
    set({ selectedIds: [], editingNodeId: null })
  },

  isSelected: (id: string) => {
    return get().selectedIds.includes(id)
  },

  startEditing: (id: string) => {
    // Can only edit if node is selected
    if (get().selectedIds.includes(id)) {
      set({ editingNodeId: id })
    }
  },

  stopEditing: () => {
    set({ editingNodeId: null })
  },
}))
