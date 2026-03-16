import { create } from 'zustand'
import type { AnchorPosition } from '@/types/scene'

interface ConnectorDrawState {
  sourceNodeId: string | null
  sourceAnchor: AnchorPosition | null
  previewEndPoint: { x: number; y: number } | null
  hoveredNodeId: string | null
  hoveredAnchor: AnchorPosition | null

  startConnectorDraw: (nodeId: string, anchor: AnchorPosition) => void
  updatePreview: (point: { x: number; y: number }) => void
  setHoveredAnchor: (nodeId: string | null, anchor: AnchorPosition | null) => void
  endConnectorDraw: () => void
  cancelConnectorDraw: () => void
}

const IDLE_STATE = {
  sourceNodeId: null,
  sourceAnchor: null,
  previewEndPoint: null,
  hoveredNodeId: null,
  hoveredAnchor: null,
} as const;

export const useConnectorStore = create<ConnectorDrawState>((set) => ({
  ...IDLE_STATE,

  startConnectorDraw: (nodeId, anchor) => set({
    ...IDLE_STATE,
    sourceNodeId: nodeId,
    sourceAnchor: anchor,
  }),

  updatePreview: (point) => set({ previewEndPoint: point }),

  setHoveredAnchor: (nodeId, anchor) => set({
    hoveredNodeId: nodeId,
    hoveredAnchor: anchor,
  }),

  endConnectorDraw: () => set(IDLE_STATE),
  cancelConnectorDraw: () => set(IDLE_STATE),
}))
