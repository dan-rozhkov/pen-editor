import { create } from 'zustand'

interface HoverState {
  hoveredNodeId: string | null
  setHoveredNode: (id: string | null) => void
}

export const useHoverStore = create<HoverState>((set) => ({
  hoveredNodeId: null,
  setHoveredNode: (id: string | null) => set({ hoveredNodeId: id }),
}))
