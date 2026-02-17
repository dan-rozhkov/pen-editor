import { create } from "zustand";

interface ChatState {
  isOpen: boolean;
  model: string;
  toggleOpen: () => void;
  open: () => void;
  close: () => void;
  setModel: (model: string) => void;
}

const DEFAULT_MODEL = "moonshotai/kimi-k2.5";

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  model: localStorage.getItem("chat-model") ?? DEFAULT_MODEL,
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setModel: (model) => {
    localStorage.setItem("chat-model", model);
    set({ model });
  },
}));
