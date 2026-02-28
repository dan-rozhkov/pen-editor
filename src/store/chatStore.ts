import { create } from "zustand";

export interface ChatTab {
  id: string;
  title: string;
}

export type AgentMode = "edits" | "fast";

interface ChatState {
  isOpen: boolean;
  model: string;
  agentMode: AgentMode;
  tabs: ChatTab[];
  activeTabId: string;
  /** AbortControllers keyed by tab id — managed outside React */
  abortControllers: Record<string, AbortController>;

  toggleOpen: () => void;
  open: () => void;
  close: () => void;
  setModel: (model: string) => void;
  setAgentMode: (mode: AgentMode) => void;

  createTab: () => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setTabTitle: (tabId: string, title: string) => void;

  registerAbortController: (tabId: string, controller: AbortController) => void;
  unregisterAbortController: (tabId: string) => void;
}

const DEFAULT_MODEL = "moonshotai/kimi-k2.5";
const DEFAULT_AGENT_MODE: AgentMode = "edits";

let nextTabCounter = 1;

function generateTabId(): string {
  return `tab-${Date.now()}-${nextTabCounter++}`;
}

const initialTabId = generateTabId();

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  model: localStorage.getItem("chat-model") ?? DEFAULT_MODEL,
  agentMode:
    (localStorage.getItem("chat-agent-mode") as AgentMode | null) ??
    DEFAULT_AGENT_MODE,
  tabs: [{ id: initialTabId, title: "Chat 1" }],
  activeTabId: initialTabId,
  abortControllers: {},

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setModel: (model) => {
    localStorage.setItem("chat-model", model);
    set({ model });
  },
  setAgentMode: (mode) => {
    localStorage.setItem("chat-agent-mode", mode);
    set({ agentMode: mode });
  },

  createTab: () => {
    const id = generateTabId();
    const { tabs } = get();
    const title = `Chat ${tabs.length + 1}`;
    set({
      tabs: [...tabs, { id, title }],
      activeTabId: id,
    });
    return id;
  },

  closeTab: (tabId: string) => {
    const { tabs, activeTabId, abortControllers } = get();

    // Abort any ongoing request for this tab
    const controller = abortControllers[tabId];
    if (controller) {
      controller.abort();
    }

    // If only one tab remains, replace it with a new empty tab
    if (tabs.length <= 1) {
      const newId = generateTabId();
      const newControllers = { ...abortControllers };
      delete newControllers[tabId];
      set({
        tabs: [{ id: newId, title: "Chat 1" }],
        activeTabId: newId,
        abortControllers: newControllers,
      });
      return;
    }

    const newTabs = tabs.filter((t) => t.id !== tabId);
    const newControllers = { ...abortControllers };
    delete newControllers[tabId];

    let newActiveTabId = activeTabId;
    if (activeTabId === tabId) {
      // Switch to the tab that was next to the closed one
      const closedIndex = tabs.findIndex((t) => t.id === tabId);
      const newIndex = Math.min(closedIndex, newTabs.length - 1);
      newActiveTabId = newTabs[newIndex].id;
    }

    set({
      tabs: newTabs,
      activeTabId: newActiveTabId,
      abortControllers: newControllers,
    });
  },

  setActiveTab: (tabId: string) => set({ activeTabId: tabId }),

  setTabTitle: (tabId: string, title: string) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    }));
  },

  registerAbortController: (tabId: string, controller: AbortController) => {
    set((s) => ({
      abortControllers: { ...s.abortControllers, [tabId]: controller },
    }));
  },

  unregisterAbortController: (tabId: string) => {
    set((s) => {
      const newControllers = { ...s.abortControllers };
      delete newControllers[tabId];
      return { abortControllers: newControllers };
    });
  },
}));
