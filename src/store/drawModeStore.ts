import { create } from 'zustand'

export type DrawToolType = 'cursor' | 'frame' | 'rect' | 'ellipse' | 'text' | 'line' | 'polygon'

interface DrawModeState {
  activeTool: DrawToolType | null
  isDrawing: boolean
  drawStart: { x: number; y: number } | null
  drawCurrent: { x: number; y: number } | null

  setActiveTool: (tool: DrawToolType | null) => void
  toggleTool: (tool: DrawToolType) => void
  startDrawing: (pos: { x: number; y: number }) => void
  updateDrawing: (pos: { x: number; y: number }) => void
  endDrawing: () => void
  cancelDrawing: () => void
}

export const useDrawModeStore = create<DrawModeState>((set) => ({
  activeTool: null,
  isDrawing: false,
  drawStart: null,
  drawCurrent: null,

  setActiveTool: (tool) => set({ activeTool: tool, isDrawing: false, drawStart: null, drawCurrent: null }),

  toggleTool: (tool) => set((state) => {
    if (state.activeTool === tool) {
      return { activeTool: null, isDrawing: false, drawStart: null, drawCurrent: null }
    }
    return { activeTool: tool, isDrawing: false, drawStart: null, drawCurrent: null }
  }),

  startDrawing: (pos) => set({ isDrawing: true, drawStart: pos, drawCurrent: pos }),

  updateDrawing: (pos) => set({ drawCurrent: pos }),

  endDrawing: () => set({ activeTool: null, isDrawing: false, drawStart: null, drawCurrent: null }),

  cancelDrawing: () => set({ activeTool: null, isDrawing: false, drawStart: null, drawCurrent: null }),
}))
