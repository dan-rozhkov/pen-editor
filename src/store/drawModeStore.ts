import { create } from 'zustand'

export type DrawToolType = 'cursor' | 'frame' | 'rect' | 'ellipse' | 'text' | 'line' | 'polygon' | 'embed' | 'pencil'

interface DrawModeState {
  activeTool: DrawToolType | null
  isDrawing: boolean
  drawStart: { x: number; y: number } | null
  drawCurrent: { x: number; y: number } | null
  pencilPoints: { x: number; y: number }[]

  setActiveTool: (tool: DrawToolType | null) => void
  toggleTool: (tool: DrawToolType) => void
  startDrawing: (pos: { x: number; y: number }) => void
  updateDrawing: (pos: { x: number; y: number }) => void
  addPencilPoint: (pt: { x: number; y: number }) => void
  endDrawing: () => void
  cancelDrawing: () => void
}

export const useDrawModeStore = create<DrawModeState>((set) => ({
  activeTool: null,
  isDrawing: false,
  drawStart: null,
  drawCurrent: null,
  pencilPoints: [],

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
}))
