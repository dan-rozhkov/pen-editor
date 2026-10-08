import { create } from "zustand";
import type { LibraryAuthor, LibraryPin } from "@/lib/designSystem/types";

interface DocumentState {
  fileName: string | null;
  /** Random id of this document; created on first save or open. Persisted in the file. */
  documentId: string | null;
  /** Design-system libraries this document is linked to (pins). */
  libraries: LibraryPin[];
  /** Set when this document authors a library. */
  libraryAuthor: LibraryAuthor | null;
  setFileName: (name: string | null) => void;
  /** The id of this document, minted on first use. */
  ensureDocumentId: () => string;
  /** Replace the file-level library state (document load). */
  setLibraryState: (state: { documentId?: string; libraries?: LibraryPin[]; libraryAuthor?: LibraryAuthor }) => void;
  setLibraries: (libraries: LibraryPin[]) => void;
  /** Add a pin, or replace the pin of the same library id. */
  upsertLibraryPin: (pin: LibraryPin) => void;
  removeLibraryPin: (libraryId: string) => void;
  setLibraryAuthor: (author: LibraryAuthor | null) => void;
}

function newDocumentId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `doc_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  fileName: null,
  documentId: null,
  libraries: [],
  libraryAuthor: null,
  setFileName: (name) => set({ fileName: name }),
  ensureDocumentId: () => {
    const existing = get().documentId;
    if (existing) return existing;
    const id = newDocumentId();
    set({ documentId: id });
    return id;
  },
  setLibraryState: ({ documentId, libraries, libraryAuthor }) =>
    set({
      documentId: documentId ?? newDocumentId(),
      libraries: libraries ?? [],
      libraryAuthor: libraryAuthor ?? null,
    }),
  setLibraries: (libraries) => set({ libraries }),
  upsertLibraryPin: (pin) =>
    set((s) => ({
      libraries: s.libraries.some((p) => p.id === pin.id)
        ? s.libraries.map((p) => (p.id === pin.id ? pin : p))
        : [...s.libraries, pin],
    })),
  removeLibraryPin: (libraryId) => set((s) => ({ libraries: s.libraries.filter((p) => p.id !== libraryId) })),
  setLibraryAuthor: (author) => set({ libraryAuthor: author }),
}));
