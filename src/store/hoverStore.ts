import { create } from 'zustand'

interface HoverState {
  hoveredNodeId: string | null
  /** When hovering a descendant inside an instance, this is the instance ID */
  hoveredInstanceId: string | null
  setHoveredNode: (id: string | null, instanceId?: string | null) => void
}

export const useHoverStore = create<HoverState>((set) => ({
  hoveredNodeId: null,
  hoveredInstanceId: null,
  setHoveredNode: (id: string | null, instanceId?: string | null) =>
    set({ hoveredNodeId: id, hoveredInstanceId: instanceId ?? null }),
}))
