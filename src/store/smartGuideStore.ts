import { create } from "zustand";

export interface GuideLine {
  orientation: "horizontal" | "vertical";
  position: number; // x for vertical, y for horizontal (world coords)
  start: number; // min extent of the line
  end: number; // max extent of the line
}

interface SmartGuideState {
  guides: GuideLine[];
  setGuides: (guides: GuideLine[]) => void;
  clearGuides: () => void;
}

export const useSmartGuideStore = create<SmartGuideState>((set) => ({
  guides: [],
  setGuides: (guides) => set({ guides }),
  clearGuides: () => set({ guides: [] }),
}));
