import { create } from "zustand";

interface ChatState {
  isOpen: boolean;
  toggleOpen: () => void;
  open: () => void;
  close: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
