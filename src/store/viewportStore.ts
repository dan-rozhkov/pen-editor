import { create } from 'zustand'
import type { SceneNode } from '../types/scene'
import { calculateNodesBounds } from '../utils/viewportUtils'

interface ViewportState {
  scale: number
  x: number
  y: number
  isPanning: boolean
  setScale: (scale: number) => void
  setPosition: (x: number, y: number) => void
  setIsPanning: (isPanning: boolean) => void
  zoomAtPoint: (newScale: number, pointX: number, pointY: number) => void
  fitToContent: (nodes: SceneNode[], viewportWidth: number, viewportHeight: number) => void
}

const MIN_SCALE = 0.1
const MAX_SCALE = 10

export const useViewportStore = create<ViewportState>((set, get) => ({
  scale: 1,
  x: 0,
  y: 0,
  isPanning: false,

  setScale: (scale) => set({ scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) }),

  setPosition: (x, y) => set({ x, y }),

  setIsPanning: (isPanning) => set({ isPanning }),

  zoomAtPoint: (newScale, pointX, pointY) => {
    const { scale, x, y } = get()
    const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale))

    // Calculate the point in world coordinates before zoom
    const worldX = (pointX - x) / scale
    const worldY = (pointY - y) / scale

    // After zoom, we want the same world point to be under the cursor
    // newX + worldX * newScale = pointX
    const newX = pointX - worldX * clampedScale
    const newY = pointY - worldY * clampedScale

    set({ scale: clampedScale, x: newX, y: newY })
  },

  fitToContent: (nodes, viewportWidth, viewportHeight) => {
    const bounds = calculateNodesBounds(nodes)

    // If no content, reset to default view
    if (bounds.isEmpty) {
      set({ scale: 1, x: viewportWidth / 2, y: viewportHeight / 2 })
      return
    }

    const padding = 50 // Padding around content

    const contentWidth = bounds.maxX - bounds.minX + padding * 2
    const contentHeight = bounds.maxY - bounds.minY + padding * 2

    // Calculate scale to fit content
    const scaleX = viewportWidth / contentWidth
    const scaleY = viewportHeight / contentHeight
    const newScale = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_SCALE), MAX_SCALE)

    // Center the content
    const centerX = bounds.minX + (bounds.maxX - bounds.minX) / 2
    const centerY = bounds.minY + (bounds.maxY - bounds.minY) / 2

    const newX = viewportWidth / 2 - centerX * newScale
    const newY = viewportHeight / 2 - centerY * newScale

    set({ scale: newScale, x: newX, y: newY })
  },
}))
