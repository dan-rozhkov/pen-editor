import { create } from "zustand";
import type { AttachedImage, ChatLaunchPayload } from "@/types/chat";
import { getDefaultModel, getModelOptions } from "@/lib/chatModels";

/** Stable empty reference so the per-session selector never returns a fresh
 * array for tabs without attachments (which would re-render on every store
 * change). Never mutated — the store always writes fresh arrays. */
export const NO_ATTACHED_IMAGES: AttachedImage[] = [];

/** Stable empty reference for sessions with no dismissed selection previews,
 * for the same reason as NO_ATTACHED_IMAGES. Never mutated. */
export const NO_DISMISSED_SELECTION: ReadonlySet<string> = new Set<string>();

export interface ChatTab {
  id: string;
  title: string;
  model: string;
  agentMode: AgentMode;
  parallelCount: ParallelCount;
}

export type AgentMode = "edits" | "prototype" | "research";
export type ParallelCount = 1 | 2 | 3;

/** Actions published by a mounted chat session so the tab bar can drive it. */
export interface ChatSessionActions {
  hasMessages: boolean;
  exportChat: () => void;
  clearChat: () => void;
}

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
  /** Export/clear handlers published by each mounted session, keyed by tab id */
  sessionActions: Record<string, ChatSessionActions>;
  /**
   * Composer image attachments keyed by tab id. Lifted out of ChatInput so a
   * partially-composed message survives the input unmounting when its tab goes
   * inactive (inactive ChatSessions render null for performance).
   */
  attachedImages: Record<string, AttachedImage[]>;
  /**
   * Per-message-dismissed canvas-selection previews, keyed by tab id. Lifted
   * out of ChatInput for the same reason as attachedImages, so the user's
   * "remove from context" choices survive the input unmounting.
   */
  dismissedSelection: Record<string, Set<string>>;

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
  /**
   * Set a single tab's agent mode without touching the persisted global
   * default. Used by on-canvas quick actions that need a specific mode
   * (e.g. research) for one launched chat only.
   */
  setTabAgentMode: (tabId: string, mode: AgentMode) => void;
  queueLaunchPayload: (tabId: string, payload: ChatLaunchPayload) => void;
  consumeLaunchPayload: (tabId: string) => ChatLaunchPayload | undefined;

  registerAbortController: (tabId: string, controller: AbortController) => void;
  unregisterAbortController: (tabId: string) => void;

  registerSessionActions: (tabId: string, actions: ChatSessionActions) => void;
  unregisterSessionActions: (tabId: string) => void;

  setAttachedImages: (
    tabId: string,
    update: AttachedImage[] | ((prev: AttachedImage[]) => AttachedImage[]),
  ) => void;
  setDismissedSelection: (
    tabId: string,
    update: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void;
}

const DEFAULT_AGENT_MODE: AgentMode = "prototype";
const DEFAULT_PARALLEL_COUNT: ParallelCount = 1;

function normalizeModel(model: string | null): string {
  // The backend-served list is the authority and isn't loaded yet at init, so
  // accept any saved id here rather than rejecting it against the fallback list.
  // reconcileModels() resets ids the backend actually rejects, once it responds.
  return model || getDefaultModel();
}

// Re-validate the active/tab models against the freshly loaded backend list.
// Called after loadModels() resolves; resets any selection the backend rejects.
export function reconcileModels() {
  const { model, tabs, setModel } = useChatStore.getState();
  const known = getModelOptions();
  const isValid = (m: string) => known.some((option) => option.value === m);
  if (tabs.some((t) => !isValid(t.model)) || !isValid(model)) {
    useChatStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        isValid(t.model) ? t : { ...t, model: getDefaultModel() },
      ),
    }));
    if (!isValid(model)) setModel(getDefaultModel());
  }
}

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
  model: normalizeModel(localStorage.getItem("chat-model")),
  agentMode: normalizeAgentMode(localStorage.getItem("chat-agent-mode")),
  parallelCount: normalizeParallelCount(localStorage.getItem("chat-parallel-count")),
  tabs: [{
    id: initialTabId,
    title: "Chat 1",
    model: normalizeModel(localStorage.getItem("chat-model")),
    agentMode: normalizeAgentMode(localStorage.getItem("chat-agent-mode")),
    parallelCount: normalizeParallelCount(localStorage.getItem("chat-parallel-count")),
  }],
  activeTabId: initialTabId,
  abortControllers: {},
  launchQueue: {},
  sessionActions: {},
  attachedImages: {},
  dismissedSelection: {},

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
    const model = normalizeModel(localStorage.getItem("chat-model"));
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
    const {
      tabs,
      activeTabId,
      abortControllers,
      launchQueue,
      attachedImages,
      dismissedSelection,
    } = get();

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
      const model = normalizeModel(localStorage.getItem("chat-model"));
      const agentMode = normalizeAgentMode(localStorage.getItem("chat-agent-mode"));
      const parallelCount = normalizeParallelCount(localStorage.getItem("chat-parallel-count"));
      const newLaunchQueue = { ...launchQueue };
      delete newLaunchQueue[tabId];
      const newAttachedImages = { ...attachedImages };
      delete newAttachedImages[tabId];
      const newDismissedSelection = { ...dismissedSelection };
      delete newDismissedSelection[tabId];
      set({
        tabs: [{ id: newId, title: "Chat 1", model, agentMode, parallelCount }],
        activeTabId: newId,
        model,
        agentMode,
        parallelCount,
        abortControllers: newControllers,
        launchQueue: newLaunchQueue,
        attachedImages: newAttachedImages,
        dismissedSelection: newDismissedSelection,
      });
      return;
    }

    const newTabs = tabs.filter((t) => t.id !== tabId);
    const newControllers = { ...abortControllers };
    const newLaunchQueue = { ...launchQueue };
    const newAttachedImages = { ...attachedImages };
    const newDismissedSelection = { ...dismissedSelection };
    delete newControllers[tabId];
    delete newLaunchQueue[tabId];
    delete newAttachedImages[tabId];
    delete newDismissedSelection[tabId];

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
      attachedImages: newAttachedImages,
      dismissedSelection: newDismissedSelection,
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

  setTabAgentMode: (tabId, mode) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, agentMode: mode } : t)),
      // Mirror onto the global field only while this tab is active, so the
      // mode selector reflects reality. localStorage (the saved default) is
      // intentionally left untouched.
      agentMode: s.activeTabId === tabId ? mode : s.agentMode,
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

  registerSessionActions: (tabId: string, actions: ChatSessionActions) => {
    set((s) => ({
      sessionActions: { ...s.sessionActions, [tabId]: actions },
    }));
  },

  unregisterSessionActions: (tabId: string) => {
    set((s) => {
      const newActions = { ...s.sessionActions };
      delete newActions[tabId];
      return { sessionActions: newActions };
    });
  },

  setAttachedImages: (tabId, update) => {
    set((s) => {
      const prev = s.attachedImages[tabId] ?? [];
      const next = typeof update === "function" ? update(prev) : update;
      if (next === prev) return s;
      const nextMap = { ...s.attachedImages };
      if (next.length === 0) {
        delete nextMap[tabId];
      } else {
        nextMap[tabId] = next;
      }
      return { attachedImages: nextMap };
    });
  },

  setDismissedSelection: (tabId, update) => {
    set((s) => {
      const prev = s.dismissedSelection[tabId] ?? new Set<string>();
      const next = typeof update === "function" ? update(prev) : update;
      if (next === prev) return s;
      const nextMap = { ...s.dismissedSelection };
      if (next.size === 0) {
        delete nextMap[tabId];
      } else {
        nextMap[tabId] = next;
      }
      return { dismissedSelection: nextMap };
    });
  },
}));
