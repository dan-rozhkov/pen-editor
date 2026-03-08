import { create } from "zustand";
import type { SceneNode } from "../types/scene";

interface ClipboardState {
  copiedNodes: SceneNode[];
  lastCopiedAt: number;
  copyNodes: (nodes: SceneNode[]) => void;
  clearClipboard: () => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  copiedNodes: [],
  lastCopiedAt: 0,

  copyNodes: (nodes) => set({ copiedNodes: nodes, lastCopiedAt: Date.now() }),

  clearClipboard: () => set({ copiedNodes: [], lastCopiedAt: 0 }),
}));
