import { create } from 'zustand'
import type Konva from 'konva'
import type { Application, Container } from 'pixi.js'

export interface PixiExportRefs {
  app: Application
  viewport: Container
  sceneRoot: Container
  overlayContainer: Container
  selectionContainer: Container
}

interface CanvasRefStore {
  stageRef: Konva.Stage | null
  pixiRefs: PixiExportRefs | null
  setStageRef: (ref: Konva.Stage | null) => void
  setPixiRefs: (refs: PixiExportRefs | null) => void
}

export const useCanvasRefStore = create<CanvasRefStore>((set) => ({
  stageRef: null,
  pixiRefs: null,
  setStageRef: (ref) => set({ stageRef: ref }),
  setPixiRefs: (refs) => set({ pixiRefs: refs }),
}))
