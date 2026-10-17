import { create } from "zustand";

interface DocumentState {
  fileName: string | null;
  setFileName: (name: string | null) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  fileName: null,
  setFileName: (name) => set({ fileName: name }),
}));
