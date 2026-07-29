import { create } from "zustand";

// Tracks which single showcase screen (if any) currently has its hover/tap
// overlay open. Global rather than per-`ShowcaseCard` state because the
// touch-device contract (FIR-62) is "at most one overlay open across the
// whole showcase" — a second tap on a different screen must close the first
// one, which two independent `useState`s in sibling `ShowcaseCard`s can't
// coordinate on their own.
//
// Deliberately its own tiny store rather than reusing a scene/editor store:
// this is imported from showcase code (ShowcaseCard/ShowcaseAppCarousel),
// and the showcase entry chunk must never pull in the editor's stores —
// AppRouter lazy-loads the editor specifically to keep them apart.
interface ShowcaseOverlayState {
  openScreenId: string | null;
  setOpenScreenId: (id: string | null) => void;
}

export const useShowcaseOverlayStore = create<ShowcaseOverlayState>((set) => ({
  openScreenId: null,
  setOpenScreenId: (id) => set({ openScreenId: id }),
}));
