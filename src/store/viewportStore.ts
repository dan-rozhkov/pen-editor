import { create } from 'zustand'

interface ViewportState {
  scale: number
  x: number
  y: number
  isPanning: boolean
  setScale: (scale: number) => void
  setPosition: (x: number, y: number) => void
  setIsPanning: (isPanning: boolean) => void
  zoomAtPoint: (newScale: number, pointX: number, pointY: number) => void
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
}))
