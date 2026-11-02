import { create } from "zustand";

interface DocumentState {
  fileName: string | null;
  setFileName: (name: string | null) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  fileName: null,
  setFileName: (name) => set({ fileName: name }),
}));

/** Document file extensions the editor adds or opens (`.pen` canvases, `.json` opened files). */
export const DOCUMENT_EXTENSION_RE = /\.(pen|json)$/i;

/** `fileName` without a trailing `.pen` / `.json`; any other dot ("v1.2 final") is part of the name. */
export function stripDocumentExtension(fileName: string): string {
  return fileName.trimEnd().replace(DOCUMENT_EXTENSION_RE, "");
}
