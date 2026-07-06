import { create } from "zustand";

interface TextStylesDialogState {
  open: boolean;
  setOpen: (value: boolean) => void;
}

export const useTextStylesDialogStore = create<TextStylesDialogState>((set) => ({
  open: false,
  setOpen: (value) => set({ open: value }),
}));
