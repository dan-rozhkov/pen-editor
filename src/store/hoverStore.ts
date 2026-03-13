import { create } from 'zustand'

interface HoverState {
  hoveredNodeId: string | null
  hoveredInstanceId: string | null
  hoveredDescendantPath: string | null
  setHoveredNode: (id: string | null) => void
  setHoveredDescendant: (instanceId: string | null, descendantPath: string | null) => void
  clearHovered: () => void
}

export const useHoverStore = create<HoverState>((set) => ({
  hoveredNodeId: null,
  hoveredInstanceId: null,
  hoveredDescendantPath: null,
  setHoveredNode: (id: string | null) =>
    set({
      hoveredNodeId: id,
      hoveredInstanceId: null,
      hoveredDescendantPath: null,
    }),
  setHoveredDescendant: (instanceId: string | null, descendantPath: string | null) =>
    set({
      hoveredNodeId: null,
      hoveredInstanceId: instanceId,
      hoveredDescendantPath: descendantPath,
    }),
  clearHovered: () =>
    set({
      hoveredNodeId: null,
      hoveredInstanceId: null,
      hoveredDescendantPath: null,
    }),
}))
