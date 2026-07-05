import { create } from "zustand";

export interface Guide {
  id: string;
  orientation: "horizontal" | "vertical";
  /** World-space coordinate: x for a vertical guide, y for a horizontal one. */
  position: number;
}

const SHOW_RULERS_STORAGE_KEY = "show-rulers";

function getInitialShowRulers(): boolean {
  return localStorage.getItem(SHOW_RULERS_STORAGE_KEY) === "true";
}

let nextGuideId = 0;
function generateGuideId(): string {
  nextGuideId += 1;
  return `guide-${Date.now()}-${nextGuideId}`;
}

interface GuidesState {
  /** Persistent ruler guides for the current page. */
  guides: Guide[];
  showRulers: boolean;
  toggleShowRulers: () => void;
  setShowRulers: (show: boolean) => void;
  addGuide: (orientation: "horizontal" | "vertical", position: number) => string;
  removeGuide: (id: string) => void;
  updateGuidePosition: (id: string, position: number) => void;
  /** Replace the whole guides list — used when switching pages / loading a document. */
  setGuides: (guides: Guide[]) => void;
  clearGuides: () => void;
}

export const useGuidesStore = create<GuidesState>((set, get) => ({
  guides: [],
  showRulers: getInitialShowRulers(),

  toggleShowRulers: () => {
    const next = !get().showRulers;
    set({ showRulers: next });
    localStorage.setItem(SHOW_RULERS_STORAGE_KEY, String(next));
  },

  setShowRulers: (show) => {
    set({ showRulers: show });
    localStorage.setItem(SHOW_RULERS_STORAGE_KEY, String(show));
  },

  addGuide: (orientation, position) => {
    const id = generateGuideId();
    set((state) => ({
      guides: [...state.guides, { id, orientation, position }],
    }));
    return id;
  },

  removeGuide: (id) => {
    set((state) => ({ guides: state.guides.filter((g) => g.id !== id) }));
  },

  updateGuidePosition: (id, position) => {
    set((state) => ({
      guides: state.guides.map((g) =>
        g.id === id ? { ...g, position } : g,
      ),
    }));
  },

  setGuides: (guides) => set({ guides }),
  clearGuides: () => set({ guides: [] }),
}));
