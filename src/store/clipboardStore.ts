import { create } from "zustand";
import type { SceneNode } from "../types/scene";

interface ClipboardState {
  copiedNodes: SceneNode[];
  copyNodes: (nodes: SceneNode[]) => void;
  clearClipboard: () => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  copiedNodes: [],

  copyNodes: (nodes) => set({ copiedNodes: nodes }),

  clearClipboard: () => set({ copiedNodes: [] }),
}));
