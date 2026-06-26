import { create } from "zustand";

interface VariablesDialogState {
  open: boolean;
  setOpen: (value: boolean) => void;
}

export const useVariablesDialogStore = create<VariablesDialogState>((set) => ({
  open: false,
  setOpen: (value) => set({ open: value }),
}));
