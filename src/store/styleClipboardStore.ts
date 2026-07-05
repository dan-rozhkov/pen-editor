import { create } from "zustand";
import type { NodeStyleSnapshot } from "@/utils/styleClipboard";

interface StyleClipboardState {
  copiedStyle: NodeStyleSnapshot | null;
  copyStyle: (style: NodeStyleSnapshot) => void;
  clearStyle: () => void;
}

/** Internal clipboard for "copy/paste properties" (Cmd+Opt+C / Cmd+Opt+V) —
 * mirrors {@link file://./clipboardStore.ts} but holds a single style
 * snapshot instead of copied nodes. */
export const useStyleClipboardStore = create<StyleClipboardState>((set) => ({
  copiedStyle: null,

  copyStyle: (style) => set({ copiedStyle: style }),

  clearStyle: () => set({ copiedStyle: null }),
}));
