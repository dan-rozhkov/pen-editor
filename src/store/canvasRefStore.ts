import { create } from 'zustand'
import type { Application, Container } from 'pixi.js'

export interface PixiExportRefs {
  app: Application
  viewport: Container
  sceneRoot: Container
  overlayContainer: Container
  selectionContainer: Container
}

interface CanvasRefStore {
  pixiRefs: PixiExportRefs | null
  setPixiRefs: (refs: PixiExportRefs | null) => void
}

export const useCanvasRefStore = create<CanvasRefStore>((set) => ({
  pixiRefs: null,
  setPixiRefs: (refs) => set({ pixiRefs: refs }),
}))
