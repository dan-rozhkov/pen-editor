import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'
import { findNodeById } from '../utils/nodeUtils'
import type { FrameNode } from '../types/scene'

/**
 * Hook for common node placement logic
 * Used by PrimitivesPanel and ComponentsPanel
 */
export function useNodePlacement() {
  const nodes = useSceneStore((state) => state.getNodes())
  const { selectedIds } = useSelectionStore()
  const { scale, x, y } = useViewportStore()

  // Check if a Frame is selected (to add node as child)
  const getSelectedFrame = (): FrameNode | null => {
    if (selectedIds.length !== 1) return null
    const node = findNodeById(nodes, selectedIds[0])
    return node?.type === 'frame' ? (node as FrameNode) : null
  }

  // Get center of viewport in canvas coordinates
  const getViewportCenter = () => {
    const centerX = (window.innerWidth / 2 - x) / scale
    const centerY = (window.innerHeight / 2 - y) / scale
    return { centerX, centerY }
  }

  return {
    getSelectedFrame,
    getViewportCenter,
  }
}
