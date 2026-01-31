import { create } from "zustand";

export interface MeasureLine {
  orientation: "horizontal" | "vertical";
  x: number; // start x (world coords)
  y: number; // start y (world coords)
  length: number; // signed length in px
  label: string; // e.g. "24"
}

interface MeasureState {
  lines: MeasureLine[];
  modifierHeld: boolean;
  setLines: (lines: MeasureLine[]) => void;
  clearLines: () => void;
  setModifierHeld: (held: boolean) => void;
}

export const useMeasureStore = create<MeasureState>((set) => ({
  lines: [],
  modifierHeld: false,
  setLines: (lines) => set({ lines }),
  clearLines: () => set({ lines: [] }),
  setModifierHeld: (held) => set({ modifierHeld: held }),
}));
