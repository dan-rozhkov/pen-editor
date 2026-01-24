import { create } from 'zustand'

interface SelectionState {
  selectedIds: string[]

  select: (id: string) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  clearSelection: () => void
  isSelected: (id: string) => boolean
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: [],

  select: (id: string) => {
    set({ selectedIds: [id] })
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
    set({ selectedIds: [] })
  },

  isSelected: (id: string) => {
    return get().selectedIds.includes(id)
  },
}))
