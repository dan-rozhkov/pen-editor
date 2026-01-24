import { create } from 'zustand'
import { initYoga, isYogaReady, calculateFrameLayout } from '../utils/yogaLayout'
import type { FrameNode, SceneNode } from '../types/scene'

interface LayoutState {
  isYogaInitialized: boolean
  initializeYoga: () => Promise<void>
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[]
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  isYogaInitialized: false,

  initializeYoga: async () => {
    if (get().isYogaInitialized) return

    try {
      await initYoga()
      set({ isYogaInitialized: true })
      console.log('[LayoutStore] Yoga initialized successfully')
    } catch (error) {
      console.error('[LayoutStore] Failed to initialize Yoga:', error)
    }
  },

  calculateLayoutForFrame: (frame: FrameNode): SceneNode[] => {
    if (!isYogaReady()) {
      return frame.children
    }

    if (!frame.layout?.autoLayout) {
      return frame.children
    }

    const layoutResults = calculateFrameLayout(frame)

    if (layoutResults.length === 0) {
      return frame.children
    }

    // Apply layout results to children
    const resultMap = new Map(layoutResults.map(r => [r.id, r]))
    return frame.children.map(child => {
      const result = resultMap.get(child.id)
      if (result) {
        return {
          ...child,
          x: result.x,
          y: result.y,
        } as SceneNode
      }
      return child
    })
  },
}))
