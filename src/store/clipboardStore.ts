import { create } from "zustand";
import type { SceneNode } from "../types/scene";

interface ClipboardState {
  copiedNode: SceneNode | null;
  copyNode: (node: SceneNode) => void;
  clearClipboard: () => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  copiedNode: null,

  copyNode: (node) => set({ copiedNode: node }),

  clearClipboard: () => set({ copiedNode: null }),
}));
