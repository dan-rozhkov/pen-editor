import { create } from "zustand";
import {
  calculateFrameLayout,
  applyLayoutToChildren,
} from "../utils/yogaLayout";
import type { FrameNode, SceneNode } from "../types/scene";

interface LayoutState {
  isYogaInitialized: boolean;
  initializeYoga: () => void;
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[];
}

export const useLayoutStore = create<LayoutState>(() => ({
  isYogaInitialized: true,

  initializeYoga: () => {
    // No-op: pure TypeScript layout engine is always ready
  },

  calculateLayoutForFrame: (frame: FrameNode): SceneNode[] => {
    if (!frame.layout?.autoLayout) {
      return frame.children;
    }

    const layoutResults = calculateFrameLayout(frame);

    if (layoutResults.length === 0) {
      return frame.children;
    }

    // Apply layout results to children (including width/height for non-fixed sizing)
    return applyLayoutToChildren(frame.children, layoutResults);
  },
}));
