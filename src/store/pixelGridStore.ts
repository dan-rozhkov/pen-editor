import { create } from 'zustand'

const STORAGE_KEY = 'show-pixel-grid'

function getInitialState(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'false') return false
  return true
}

interface PixelGridState {
  showPixelGrid: boolean
  togglePixelGrid: () => void
}

export const usePixelGridStore = create<PixelGridState>((set, get) => ({
  showPixelGrid: getInitialState(),
  togglePixelGrid: () => {
    const next = !get().showPixelGrid
    set({ showPixelGrid: next })
    localStorage.setItem(STORAGE_KEY, String(next))
  },
}))
