import { create } from 'zustand'

const STORAGE_KEY = 'floating-panels'

interface FloatingPanelsState {
  isFloating: boolean
  toggleFloating: () => void
  setFloating: (value: boolean) => void
}

function getInitial(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'true'
}

export const useFloatingPanelsStore = create<FloatingPanelsState>((set, get) => ({
  isFloating: getInitial(),
  toggleFloating: () => {
    const next = !get().isFloating
    set({ isFloating: next })
    localStorage.setItem(STORAGE_KEY, String(next))
  },
  setFloating: (value) => {
    set({ isFloating: value })
    localStorage.setItem(STORAGE_KEY, String(value))
  },
}))
