import { create } from "zustand";
import type { ChatLaunchPayload } from "@/types/chat";

export interface ChatTab {
  id: string;
  title: string;
  model: string;
  agentMode: AgentMode;
  parallelCount: ParallelCount;
}

export type AgentMode = "edits" | "prototype" | "research";
export type ParallelCount = 1 | 2 | 3;

interface ChatState {
  isOpen: boolean;
  isExpanded: boolean;
  model: string;
  agentMode: AgentMode;
  parallelCount: ParallelCount;
  tabs: ChatTab[];
  activeTabId: string;
  /** AbortControllers keyed by tab id — managed outside React */
  abortControllers: Record<string, AbortController>;
  launchQueue: Record<string, ChatLaunchPayload | undefined>;

  toggleOpen: () => void;
  open: () => void;
  close: () => void;
  toggleExpanded: () => void;
  setModel: (model: string) => void;
  setAgentMode: (mode: AgentMode) => void;
  setParallelCount: (count: ParallelCount) => void;

  createTab: () => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setTabTitle: (tabId: string, title: string) => void;
  queueLaunchPayload: (tabId: string, payload: ChatLaunchPayload) => void;
  consumeLaunchPayload: (tabId: string) => ChatLaunchPayload | undefined;

  registerAbortController: (tabId: string, controller: AbortController) => void;
  unregisterAbortController: (tabId: string) => void;
}

const DEFAULT_MODEL = "google/gemini-3-flash-preview";
const DEFAULT_AGENT_MODE: AgentMode = "prototype";
const DEFAULT_PARALLEL_COUNT: ParallelCount = 1;

function normalizeAgentMode(mode: string | null): AgentMode {
  if (mode === "prototype") return mode;
  if (mode === "edits") return mode;
  if (mode === "research") return mode;
  if (mode === "fast") return "prototype";
  return DEFAULT_AGENT_MODE;
}

function normalizeParallelCount(count: string | null): ParallelCount {
  if (count === "2") return 2;
  if (count === "3") return 3;
  return DEFAULT_PARALLEL_COUNT;
}

let nextTabCounter = 1;

function generateTabId(): string {
  return `tab-${Date.now()}-${nextTabCounter++}`;
}

const initialTabId = generateTabId();

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  isExpanded: localStorage.getItem("chat-expanded") === "true",
  model: localStorage.getItem("chat-model") ?? DEFAULT_MODEL,
  agentMode: normalizeAgentMode(localStorage.getItem("chat-agent-mode")),
  parallelCount: normalizeParallelCount(localStorage.getItem("chat-parallel-count")),
  tabs: [{
    id: initialTabId,
    title: "Chat 1",
    model: localStorage.getItem("chat-model") ?? DEFAULT_MODEL,
    agentMode: normalizeAgentMode(localStorage.getItem("chat-agent-mode")),
    parallelCount: normalizeParallelCount(localStorage.getItem("chat-parallel-count")),
  }],
  activeTabId: initialTabId,
  abortControllers: {},
  launchQueue: {},

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggleExpanded: () => {
    const next = !get().isExpanded;
    localStorage.setItem("chat-expanded", String(next));
    set({ isExpanded: next });
  },
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
  setParallelCount: (parallelCount) => {
    localStorage.setItem("chat-parallel-count", String(parallelCount));
    const { activeTabId } = get();
    set((s) => ({
      parallelCount,
      tabs: s.tabs.map((t) => t.id === activeTabId ? { ...t, parallelCount } : t),
    }));
  },

  createTab: () => {
    const id = generateTabId();
    const { tabs } = get();
    const title = `Chat ${tabs.length + 1}`;
    const model = localStorage.getItem("chat-model") ?? DEFAULT_MODEL;
    const agentMode = normalizeAgentMode(localStorage.getItem("chat-agent-mode"));
    const parallelCount = normalizeParallelCount(localStorage.getItem("chat-parallel-count"));
    set({
      tabs: [...tabs, { id, title, model, agentMode, parallelCount }],
      activeTabId: id,
      model,
      agentMode,
      parallelCount,
    });
    return id;
  },

  closeTab: (tabId: string) => {
    const { tabs, activeTabId, abortControllers, launchQueue } = get();

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
      const parallelCount = normalizeParallelCount(localStorage.getItem("chat-parallel-count"));
      const newLaunchQueue = { ...launchQueue };
      delete newLaunchQueue[tabId];
      set({
        tabs: [{ id: newId, title: "Chat 1", model, agentMode, parallelCount }],
        activeTabId: newId,
        model,
        agentMode,
        parallelCount,
        abortControllers: newControllers,
        launchQueue: newLaunchQueue,
      });
      return;
    }

    const newTabs = tabs.filter((t) => t.id !== tabId);
    const newControllers = { ...abortControllers };
    const newLaunchQueue = { ...launchQueue };
    delete newControllers[tabId];
    delete newLaunchQueue[tabId];

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
      parallelCount: switchToTab?.parallelCount ?? get().parallelCount,
      abortControllers: newControllers,
      launchQueue: newLaunchQueue,
    });
  },

  setActiveTab: (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (tab) {
      set({
        activeTabId: tabId,
        model: tab.model,
        agentMode: tab.agentMode,
        parallelCount: tab.parallelCount,
      });
    }
  },

  setTabTitle: (tabId: string, title: string) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    }));
  },

  queueLaunchPayload: (tabId, payload) => {
    set((s) => ({
      launchQueue: {
        ...s.launchQueue,
        [tabId]: payload,
      },
    }));
  },

  consumeLaunchPayload: (tabId) => {
    const payload = get().launchQueue[tabId];
    if (!payload) {
      return undefined;
    }
    set((s) => {
      const nextQueue = { ...s.launchQueue };
      delete nextQueue[tabId];
      return { launchQueue: nextQueue };
    });
    return payload;
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
