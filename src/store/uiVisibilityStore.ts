import { create } from "zustand";

interface UIVisibilityState {
  isUIHidden: boolean;
  toggleUI: () => void;
}

export const useUIVisibilityStore = create<UIVisibilityState>((set) => ({
  isUIHidden: false,
  toggleUI: () => set((s) => ({ isUIHidden: !s.isUIHidden })),
}));
