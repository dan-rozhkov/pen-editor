import { create } from 'zustand'
import type Konva from 'konva'

interface CanvasRefStore {
  stageRef: Konva.Stage | null
  setStageRef: (ref: Konva.Stage | null) => void
}

export const useCanvasRefStore = create<CanvasRefStore>((set) => ({
  stageRef: null,
  setStageRef: (ref) => set({ stageRef: ref }),
}))
