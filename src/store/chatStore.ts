import { create } from "zustand";
import type { AttachedImage, ChatLaunchPayload, QueuedChatMessage } from "@/types/chat";
import { getDefaultModel, getModelOptions } from "@/lib/chatModels";

/** Stable empty reference so the per-session selector never returns a fresh
 * array for tabs without attachments (which would re-render on every store
 * change). Never mutated — the store always writes fresh arrays. */
export const NO_ATTACHED_IMAGES: AttachedImage[] = [];

/** Stable empty reference for sessions with no dismissed selection previews,
 * for the same reason as NO_ATTACHED_IMAGES. Never mutated. */
export const NO_DISMISSED_SELECTION: ReadonlySet<string> = new Set<string>();

/** Stable empty reference for sessions with no queued messages, for the same
 * reason as NO_ATTACHED_IMAGES. Never mutated. */
export const NO_QUEUED_MESSAGES: QueuedChatMessage[] = [];

export interface ChatTab {
  id: string;
  title: string;
  model: string;
  parallelCount: ParallelCount;
}

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
  parallelCount: ParallelCount;
  tabs: ChatTab[];
  activeTabId: string;
  /** AbortControllers keyed by tab id — managed outside React */
  abortControllers: Record<string, AbortController>;
  launchQueue: Record<string, ChatLaunchPayload | undefined>;
  /**
   * Messages the user submitted while the agent was busy (chat status
   * "submitted"/"streaming"), keyed by tab id, in FIFO send order. Distinct
   * from `launchQueue` (a one-shot payload used to fan a single send out to
   * extra parallel tabs) — this is a genuine per-tab queue that can hold
   * several pending messages, drained one at a time as the session returns
   * to "ready".
   */
  messageQueue: Record<string, QueuedChatMessage[]>;
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
  setParallelCount: (count: ParallelCount) => void;

  createTab: () => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setTabTitle: (tabId: string, title: string) => void;
  queueLaunchPayload: (tabId: string, payload: ChatLaunchPayload) => void;
  consumeLaunchPayload: (tabId: string) => ChatLaunchPayload | undefined;

  enqueueMessage: (tabId: string, payload: ChatLaunchPayload) => void;
  peekNextMessage: (tabId: string) => QueuedChatMessage | undefined;
  removeQueuedMessage: (tabId: string, id: string) => void;
  clearMessageQueue: (tabId: string) => void;

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

function normalizeParallelCount(count: string | null): ParallelCount {
  if (count === "2") return 2;
  if (count === "3") return 3;
  return DEFAULT_PARALLEL_COUNT;
}

let nextTabCounter = 1;

function generateTabId(): string {
  return `tab-${Date.now()}-${nextTabCounter++}`;
}

let nextMessageIdCounter = 1;

function generateQueuedMessageId(): string {
  return `qmsg-${Date.now()}-${nextMessageIdCounter++}`;
}

const initialTabId = generateTabId();

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  isExpanded: localStorage.getItem("chat-expanded") === "true",
  model: normalizeModel(localStorage.getItem("chat-model")),
  parallelCount: normalizeParallelCount(localStorage.getItem("chat-parallel-count")),
  tabs: [{
    id: initialTabId,
    title: "Chat 1",
    model: normalizeModel(localStorage.getItem("chat-model")),
    parallelCount: normalizeParallelCount(localStorage.getItem("chat-parallel-count")),
  }],
  activeTabId: initialTabId,
  abortControllers: {},
  launchQueue: {},
  messageQueue: {},
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
    const parallelCount = normalizeParallelCount(localStorage.getItem("chat-parallel-count"));
    set({
      tabs: [...tabs, { id, title, model, parallelCount }],
      activeTabId: id,
      model,
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
      messageQueue,
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
      const parallelCount = normalizeParallelCount(localStorage.getItem("chat-parallel-count"));
      const newLaunchQueue = { ...launchQueue };
      delete newLaunchQueue[tabId];
      const newMessageQueue = { ...messageQueue };
      delete newMessageQueue[tabId];
      const newAttachedImages = { ...attachedImages };
      delete newAttachedImages[tabId];
      const newDismissedSelection = { ...dismissedSelection };
      delete newDismissedSelection[tabId];
      set({
        tabs: [{ id: newId, title: "Chat 1", model, parallelCount }],
        activeTabId: newId,
        model,
        parallelCount,
        abortControllers: newControllers,
        launchQueue: newLaunchQueue,
        messageQueue: newMessageQueue,
        attachedImages: newAttachedImages,
        dismissedSelection: newDismissedSelection,
      });
      return;
    }

    const newTabs = tabs.filter((t) => t.id !== tabId);
    const newControllers = { ...abortControllers };
    const newLaunchQueue = { ...launchQueue };
    const newMessageQueue = { ...messageQueue };
    const newAttachedImages = { ...attachedImages };
    const newDismissedSelection = { ...dismissedSelection };
    delete newControllers[tabId];
    delete newLaunchQueue[tabId];
    delete newMessageQueue[tabId];
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
      parallelCount: switchToTab?.parallelCount ?? get().parallelCount,
      abortControllers: newControllers,
      launchQueue: newLaunchQueue,
      messageQueue: newMessageQueue,
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

  enqueueMessage: (tabId, payload) => {
    const queued: QueuedChatMessage = { id: generateQueuedMessageId(), payload };
    set((s) => ({
      messageQueue: {
        ...s.messageQueue,
        [tabId]: [...(s.messageQueue[tabId] ?? []), queued],
      },
    }));
  },

  peekNextMessage: (tabId) => {
    const queue = get().messageQueue[tabId];
    return queue && queue.length > 0 ? queue[0] : undefined;
  },

  removeQueuedMessage: (tabId, id) => {
    set((s) => {
      const queue = s.messageQueue[tabId];
      if (!queue) return s;
      const next = queue.filter((m) => m.id !== id);
      if (next.length === queue.length) return s;
      const nextQueue = { ...s.messageQueue };
      if (next.length === 0) {
        delete nextQueue[tabId];
      } else {
        nextQueue[tabId] = next;
      }
      return { messageQueue: nextQueue };
    });
  },

  clearMessageQueue: (tabId) => {
    set((s) => {
      if (!s.messageQueue[tabId]) return s;
      const nextQueue = { ...s.messageQueue };
      delete nextQueue[tabId];
      return { messageQueue: nextQueue };
    });
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
