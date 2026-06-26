import { create } from "zustand";

const STORAGE_KEY = "left-sidebar-section";

export type LeftSection = "pages" | "agents" | "components";

interface LeftSidebarState {
  activeSection: LeftSection;
  setActiveSection: (section: LeftSection) => void;
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
}));
