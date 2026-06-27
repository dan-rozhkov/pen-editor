import { create } from "zustand";

const STORAGE_KEY = "left-sidebar-section";

export type LeftSection = "pages" | "agents" | "components";

interface LeftSidebarState {
  activeSection: LeftSection;
  setActiveSection: (section: LeftSection) => void;
  // Whether the expanded panel is visible. Only meaningful on mobile, where the
  // panel is an overlay that the rail toggles; on desktop it is always shown.
  isPanelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
}

function getInitial(): LeftSection {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "pages" || stored === "agents" || stored === "components") {
    return stored;
  }
  return "pages";
}

export const useLeftSidebarStore = create<LeftSidebarState>((set) => ({
  activeSection: getInitial(),
  setActiveSection: (section) => {
    set({ activeSection: section });
    localStorage.setItem(STORAGE_KEY, section);
  },
  // Closed by default so mobile starts with only the rail visible.
  isPanelOpen: false,
  setPanelOpen: (open) => set({ isPanelOpen: open }),
}));
