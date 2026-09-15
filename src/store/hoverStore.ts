import { create } from 'zustand'

interface HoverState {
  hoveredNodeId: string | null
  setHoveredNode: (id: string | null) => void
  clearHovered: () => void
}

// Non-reactive world mouse position (updated on pointer move, read by overlay drawing)
export const worldMouse = { x: 0, y: 0 }

export const useHoverStore = create<HoverState>((set) => ({
  hoveredNodeId: null,
  setHoveredNode: (id: string | null) =>
    set({
      hoveredNodeId: id,
    }),
  clearHovered: () =>
    set({
      hoveredNodeId: null,
    }),
}))
