import { create } from 'zustand'

export type RendererMode = 'konva' | 'pixi'

const STORAGE_KEY = 'use-pixi'

function getInitialMode(): RendererMode {
  return localStorage.getItem(STORAGE_KEY) === '1' ? 'pixi' : 'konva'
}

interface RendererState {
  rendererMode: RendererMode
  setRendererMode: (mode: RendererMode) => void
}

export const useRendererStore = create<RendererState>((set) => ({
  rendererMode: getInitialMode(),
  setRendererMode: (mode) => {
    set({ rendererMode: mode })
    localStorage.setItem(STORAGE_KEY, mode === 'pixi' ? '1' : '0')
  },
}))
