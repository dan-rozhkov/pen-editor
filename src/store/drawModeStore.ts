import { create } from 'zustand'

export type DrawToolType = 'cursor' | 'frame' | 'rect' | 'ellipse' | 'text' | 'line' | 'polygon' | 'embed' | 'pencil' | 'connector'

export interface PencilSettings {
  color: string
  thickness: number
  opacity: number
  cap: 'round' | 'butt' | 'square'
  smoothing: number
}

const DEFAULT_PENCIL_SETTINGS: PencilSettings = {
  color: '#000000',
  thickness: 2,
  opacity: 1,
  cap: 'round',
  smoothing: 50,
}

interface DrawModeState {
  activeTool: DrawToolType | null
  isDrawing: boolean
  drawStart: { x: number; y: number } | null
  drawCurrent: { x: number; y: number } | null
  pencilPoints: { x: number; y: number }[]
  pencilSettings: PencilSettings

  setActiveTool: (tool: DrawToolType | null) => void
  toggleTool: (tool: DrawToolType) => void
  startDrawing: (pos: { x: number; y: number }) => void
  updateDrawing: (pos: { x: number; y: number }) => void
  addPencilPoint: (pt: { x: number; y: number }) => void
  endDrawing: () => void
  cancelDrawing: () => void
  setPencilSettings: (updates: Partial<PencilSettings>) => void
}

export const useDrawModeStore = create<DrawModeState>((set) => ({
  activeTool: null,
  isDrawing: false,
  drawStart: null,
  drawCurrent: null,
  pencilPoints: [],
  pencilSettings: { ...DEFAULT_PENCIL_SETTINGS },

  setActiveTool: (tool) => set({ activeTool: tool, isDrawing: false, drawStart: null, drawCurrent: null, pencilPoints: [] }),

  toggleTool: (tool) => set((state) => {
    if (state.activeTool === tool) {
      return { activeTool: null, isDrawing: false, drawStart: null, drawCurrent: null, pencilPoints: [] }
    }
    return { activeTool: tool, isDrawing: false, drawStart: null, drawCurrent: null, pencilPoints: [] }
  }),

  startDrawing: (pos) => set({ isDrawing: true, drawStart: pos, drawCurrent: pos }),

  updateDrawing: (pos) => set({ drawCurrent: pos }),

  addPencilPoint: (pt) => set((state) => ({ pencilPoints: [...state.pencilPoints, pt] })),

  endDrawing: () => set({ activeTool: null, isDrawing: false, drawStart: null, drawCurrent: null, pencilPoints: [] }),

  cancelDrawing: () => set({ activeTool: null, isDrawing: false, drawStart: null, drawCurrent: null, pencilPoints: [] }),

  setPencilSettings: (updates) => set((state) => ({
    pencilSettings: { ...state.pencilSettings, ...updates },
  })),
}))
