import { create } from "zustand";

const STORAGE_KEY = "left-sidebar-section";
const EXPANDED_STORAGE_KEY = "left-sidebar-expanded";

export type LeftSection =
  | "pages"
  | "slides"
  | "agents"
  | "components"
  | "toolbox"
  | "variables"
  | "textStyles"
  | "styles"
  | "comments";

const LEFT_SECTIONS: LeftSection[] = [
  "pages",
  "slides",
  "agents",
  "components",
  "toolbox",
  "variables",
  "textStyles",
  "styles",
  "comments",
];

interface LeftSidebarState {
  activeSection: LeftSection;
  setActiveSection: (section: LeftSection) => void;
  // Whether the expanded panel is visible. Only meaningful on mobile, where the
  // panel is an overlay that the rail toggles; on desktop it is always shown.
  isPanelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  // Full-screen expanded mode for the active section (mirrors chatStore's
  // isExpanded for Agents). Only meaningful for sections that support it
  // (currently variables/textStyles/styles).
  isExpanded: boolean;
  toggleExpanded: () => void;
}

function getInitial(): LeftSection {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (LEFT_SECTIONS as string[]).includes(stored)) {
    return stored as LeftSection;
  }
  return "pages";
}

export const useLeftSidebarStore = create<LeftSidebarState>((set, get) => ({
  activeSection: getInitial(),
  setActiveSection: (section) => {
    set({ activeSection: section });
    localStorage.setItem(STORAGE_KEY, section);
  },
  // Closed by default so mobile starts with only the rail visible.
  isPanelOpen: false,
  setPanelOpen: (open) => set({ isPanelOpen: open }),
  // Expanded by default; only a previously persisted "false" collapses it.
  isExpanded: localStorage.getItem(EXPANDED_STORAGE_KEY) !== "false",
  toggleExpanded: () => {
    const next = !get().isExpanded;
    localStorage.setItem(EXPANDED_STORAGE_KEY, String(next));
    set({ isExpanded: next });
  },
}));
