import { create } from "zustand";

interface StylesDialogState {
  open: boolean;
  setOpen: (value: boolean) => void;
}

export const useStylesDialogStore = create<StylesDialogState>((set) => ({
  open: false,
  setOpen: (value) => set({ open: value }),
}));
