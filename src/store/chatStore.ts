import { create } from "zustand";

export interface ChatTab {
  id: string;
  title: string;
  model: string;
  agentMode: AgentMode;
}

export type AgentMode = "edits" | "prototype" | "research";

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

const DEFAULT_MODEL = "google/gemini-3-flash-preview";
const DEFAULT_AGENT_MODE: AgentMode = "prototype";

function normalizeAgentMode(mode: string | null): AgentMode {
  if (mode === "prototype") return mode;
  if (mode === "edits") return mode;
  if (mode === "research") return mode;
  if (mode === "fast") return "prototype";
  return DEFAULT_AGENT_MODE;
}

let nextTabCounter = 1;

function generateTabId(): string {
  return `tab-${Date.now()}-${nextTabCounter++}`;
}

const initialTabId = generateTabId();

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  model: localStorage.getItem("chat-model") ?? DEFAULT_MODEL,
  agentMode: normalizeAgentMode(localStorage.getItem("chat-agent-mode")),
  tabs: [{ id: initialTabId, title: "Chat 1", model: localStorage.getItem("chat-model") ?? DEFAULT_MODEL, agentMode: normalizeAgentMode(localStorage.getItem("chat-agent-mode")) }],
  activeTabId: initialTabId,
  abortControllers: {},

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setModel: (model) => {
    localStorage.setItem("chat-model", model);
    const { activeTabId } = get();
    set((s) => ({
      model,
      tabs: s.tabs.map((t) => t.id === activeTabId ? { ...t, model } : t),
    }));
  },
  setAgentMode: (mode) => {
    localStorage.setItem("chat-agent-mode", mode);
    const { activeTabId } = get();
    set((s) => ({
      agentMode: mode,
      tabs: s.tabs.map((t) => t.id === activeTabId ? { ...t, agentMode: mode } : t),
    }));
  },

  createTab: () => {
    const id = generateTabId();
    const { tabs } = get();
    const title = `Chat ${tabs.length + 1}`;
    const model = localStorage.getItem("chat-model") ?? DEFAULT_MODEL;
    const agentMode = normalizeAgentMode(localStorage.getItem("chat-agent-mode"));
    set({
      tabs: [...tabs, { id, title, model, agentMode }],
      activeTabId: id,
      model,
      agentMode,
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
      const model = localStorage.getItem("chat-model") ?? DEFAULT_MODEL;
      const agentMode = normalizeAgentMode(localStorage.getItem("chat-agent-mode"));
      set({
        tabs: [{ id: newId, title: "Chat 1", model, agentMode }],
        activeTabId: newId,
        model,
        agentMode,
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

    const switchToTab = newTabs.find((t) => t.id === newActiveTabId);
    set({
      tabs: newTabs,
      activeTabId: newActiveTabId,
      model: switchToTab?.model ?? get().model,
      agentMode: switchToTab?.agentMode ?? get().agentMode,
      abortControllers: newControllers,
    });
  },

  setActiveTab: (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (tab) {
      set({ activeTabId: tabId, model: tab.model, agentMode: tab.agentMode });
    }
  },

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
