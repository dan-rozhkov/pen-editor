import { create } from "zustand";
import { deriveChatTitle } from "@/lib/chatTitle";
import { canUseModel, getDefaultModel } from "@/lib/chatModels";
import { subscribeOpenCodeKey } from "@/lib/opencodeKey";
import type { AttachedImage, ChatLaunchPayload, QueuedChatMessage } from "@/types/chat";

/** Stable empty reference so the per-session selector never returns a fresh
 * array for chats without attachments (which would re-render on every store
 * change). Never mutated — the store always writes fresh arrays. */
export const NO_ATTACHED_IMAGES: AttachedImage[] = [];

/** Stable empty reference for sessions with no queued messages, for the same
 * reason as NO_ATTACHED_IMAGES. Never mutated. */
export const NO_QUEUED_MESSAGES: QueuedChatMessage[] = [];

export interface ChatSummary {
  id: string;
  title: string;
  /**
   * The model this chat's turns run on. Per chat, not global: `model` below
   * is only the ACTIVE chat's value, and openChat overwrites it on every
   * switch — a background chat mid-stream must keep sending its own model on
   * each auto-continuation rather than inherit whatever the user is looking
   * at now.
   */
  model: string;
  parallelCount: ParallelCount;
  /**
   * True while `title` is still the default "Chat N" placeholder and hasn't
   * been set explicitly. `applyAutoTitle` may still overwrite the title while
   * this is true (once, from the first user message); `setChatTitle` always
   * clears it, so a later auto-title attempt is a no-op.
   */
  titleIsAuto: boolean;
  /** True when this chat has activity the user hasn't looked at yet — set by
   * markChatUnread, cleared by openChat/markChatRead. Never set for the chat
   * that is currently active. */
  unread: boolean;
  /** True when the agent is waiting on the user (e.g. an ask_user form). */
  needsAnswer: boolean;
  /** True while a turn is in flight for this chat. */
  isBusy: boolean;
  /** Last time this chat's list-relevant state changed, for sorting the chat
   * list by recency. */
  updatedAt: number;
}

export type ParallelCount = 1 | 2 | 3;

/** Actions published by a mounted chat session so the chat list can drive it. */
export interface ChatSessionActions {
  hasMessages: boolean;
  exportChat: () => void;
  clearChat: () => void;
}

interface ChatState {
  isOpen: boolean;
  isExpanded: boolean;
  /** The active chat's model — see ChatSummary.model. */
  model: string;
  parallelCount: ParallelCount;
  chats: ChatSummary[];
  /** The chat currently shown in the panel, or null to show the chat list
   * with no chat open. */
  activeChatId: string | null;
  /** AbortControllers keyed by chat id — managed outside React */
  abortControllers: Record<string, AbortController>;
  launchQueue: Record<string, ChatLaunchPayload | undefined>;
  /**
   * Messages the user submitted while the agent was busy (chat status
   * "submitted"/"streaming"), keyed by chat id, in FIFO send order. Distinct
   * from `launchQueue` (a one-shot payload used to fan a single send out to
   * extra parallel chats) — this is a genuine per-chat queue that can hold
   * several pending messages, drained one at a time as the session returns
   * to "ready".
   */
  messageQueue: Record<string, QueuedChatMessage[]>;
  /** Export/clear handlers published by each mounted session, keyed by chat id */
  sessionActions: Record<string, ChatSessionActions>;
  /**
   * Composer image attachments keyed by chat id. Lifted out of ChatInput so a
   * partially-composed message survives the input unmounting when its chat
   * goes inactive (inactive ChatSessions render null for performance).
   */
  attachedImages: Record<string, AttachedImage[]>;
  /**
   * The last completed turn's actual input-token count for a chat, keyed by
   * chat id — set from the `/api/chat` `finish` chunk's `messageMetadata.
   * contextTokens` (useDesignChat's onFinish). Per chat, not global, for the
   * same reason as `model`: a background session finishing a turn must not
   * overwrite the meter the user is currently looking at. Drives
   * ContextMeter (components/chat/ContextMeter.tsx) alongside
   * chatModels.ts's `getModelContextWindow`.
   */
  contextTokens: Record<string, number>;
  toggleOpen: () => void;
  open: () => void;
  close: () => void;
  toggleExpanded: () => void;
  setModel: (model: string) => void;
  setParallelCount: (count: ParallelCount) => void;

  createChat: (opts?: { activate?: boolean; parallelCount?: ParallelCount }) => string;
  closeChat: (chatId: string) => void;
  /** Makes a chat active, restores its parallelCount, and clears unread. */
  openChat: (chatId: string) => void;
  /** Returns to the chat list — no chat is active. */
  showChatList: () => void;
  setChatTitle: (chatId: string, title: string) => void;
  /**
   * Derives a title from the chat's first user message and applies it, but
   * only while the chat still carries the default auto title — a no-op once
   * `titleIsAuto` is false (either a previous auto-title already landed, or
   * the user set one explicitly), and a no-op when no title can be derived.
   */
  applyAutoTitle: (chatId: string, text: string) => void;
  /** Flags a chat as having unseen activity, unless it is the active chat. */
  markChatUnread: (chatId: string) => void;
  markChatRead: (chatId: string) => void;
  setChatActivity: (
    chatId: string,
    patch: { needsAnswer?: boolean; isBusy?: boolean },
  ) => void;
  queueLaunchPayload: (chatId: string, payload: ChatLaunchPayload) => void;
  consumeLaunchPayload: (chatId: string) => ChatLaunchPayload | undefined;

  enqueueMessage: (chatId: string, payload: ChatLaunchPayload) => void;
  peekNextMessage: (chatId: string) => QueuedChatMessage | undefined;
  removeQueuedMessage: (chatId: string, id: string) => void;
  clearMessageQueue: (chatId: string) => void;

  registerAbortController: (chatId: string, controller: AbortController) => void;
  unregisterAbortController: (chatId: string) => void;

  registerSessionActions: (chatId: string, actions: ChatSessionActions) => void;
  unregisterSessionActions: (chatId: string) => void;

  setAttachedImages: (
    chatId: string,
    update: AttachedImage[] | ((prev: AttachedImage[]) => AttachedImage[]),
  ) => void;

  setContextTokens: (chatId: string, tokens: number) => void;
  /** Drops a chat's context-usage reading — called wherever a fresh context
   * begins for that chat (closeChat's replacement, and clearing a chat's
   * messages), so a stale percentage doesn't linger over an empty transcript. */
  clearContextTokens: (chatId: string) => void;

}

const DEFAULT_PARALLEL_COUNT: ParallelCount = 1;

function normalizeModel(model: string | null): string {
  // The backend-served list is the authority and isn't loaded yet at init, so
  // accept any saved id here rather than rejecting it against the fallback
  // list. reconcileModels() below resets ids the backend doesn't offer, once
  // it answers. A saved id the backend no longer knows is harmless in the
  // meantime: /api/chat ignores an unknown id and runs its own default.
  return model || getDefaultModel();
}

// Re-validate the active/per-chat models against the freshly loaded backend
// list. Called after loadModels() resolves; resets any selection the backend
// no longer offers, so the picker can't keep showing a model nobody runs.
// Also resets a selection that IS still offered but requires an OpenCode key
// this browser doesn't have — otherwise a user who deletes their key (or
// loads a fresh browser with an old saved chat) would hit a 400 on every
// turn instead of falling back to a model that actually works. canUseModel
// (chatModels.ts) is the single rule for "is this selection usable right
// now" — the picker's disabled/lock state follows the exact same function.
export function reconcileModels() {
  const { model, chats, setModel } = useChatStore.getState();
  const isValid = canUseModel;
  if (chats.some((c) => !isValid(c.model)) || !isValid(model)) {
    useChatStore.setState((s) => ({
      chats: s.chats.map((c) => (isValid(c.model) ? c : { ...c, model: getDefaultModel() })),
    }));
    if (!isValid(model)) setModel(getDefaultModel());
  }
}

// Re-run reconcileModels() on EVERY change to the OpenCode key — saved or
// removed, from the dialog or anywhere else that ever calls
// setOpenCodeKey/clearOpenCodeKey (opencodeKey.ts is the single point of
// truth for both). A key removal is exactly the case reconcileModels()'s own
// comment calls out ("a user who deletes their key... would hit a 400 on
// every turn instead of falling back"), but before this subscription that
// guarantee only held at app boot (App.tsx's loadModels().then(...) call) —
// nothing re-ran it when the key changed mid-session. Subscribing here,
// rather than having OpenCodeKeyDialog's "Remove key" button call
// reconcileModels() directly, means the guarantee holds for every future
// caller of clearOpenCodeKey too, not just today's one button.
subscribeOpenCodeKey(reconcileModels);

function normalizeParallelCount(count: string | null): ParallelCount {
  if (count === "2") return 2;
  if (count === "3") return 3;
  return DEFAULT_PARALLEL_COUNT;
}

let nextChatCounter = 1;

function generateChatId(): string {
  return `tab-${Date.now()}-${nextChatCounter++}`;
}

let nextMessageIdCounter = 1;

function generateQueuedMessageId(): string {
  return `qmsg-${Date.now()}-${nextMessageIdCounter++}`;
}

function makeChat(
  id: string,
  title: string,
  model: string,
  parallelCount: ParallelCount,
): ChatSummary {
  return {
    id,
    title,
    model,
    parallelCount,
    titleIsAuto: true,
    unread: false,
    needsAnswer: false,
    isBusy: false,
    updatedAt: Date.now(),
  };
}

const initialChatId = generateChatId();

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  isExpanded: localStorage.getItem("chat-expanded") === "true",
  model: normalizeModel(localStorage.getItem("chat-model")),
  parallelCount: normalizeParallelCount(localStorage.getItem("chat-parallel-count")),
  chats: [
    makeChat(
      initialChatId,
      "Chat 1",
      normalizeModel(localStorage.getItem("chat-model")),
      normalizeParallelCount(localStorage.getItem("chat-parallel-count")),
    ),
  ],
  activeChatId: initialChatId,
  abortControllers: {},
  launchQueue: {},
  messageQueue: {},
  sessionActions: {},
  attachedImages: {},
  contextTokens: {},

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
    const { activeChatId } = get();
    set((s) => ({
      model,
      chats: s.chats.map((c) => (c.id === activeChatId ? { ...c, model } : c)),
    }));
  },

  setParallelCount: (parallelCount) => {
    localStorage.setItem("chat-parallel-count", String(parallelCount));
    const { activeChatId } = get();
    set((s) => ({
      parallelCount,
      chats: s.chats.map((c) => c.id === activeChatId ? { ...c, parallelCount } : c),
    }));
  },

  createChat: (opts) => {
    const activate = opts?.activate ?? true;
    const { chats } = get();
    const id = generateChatId();
    const title = `Chat ${chats.length + 1}`;
    // A caller fanning a single send out to extra parallel chats passes an
    // explicit parallelCount (always 1) instead of restoring localStorage's
    // last choice — those chats are twins created *because of* an x2/x3 send,
    // and stamping them with that same count would silently re-fan-out the
    // next message sent from one of them.
    const parallelCount =
      opts?.parallelCount ?? normalizeParallelCount(localStorage.getItem("chat-parallel-count"));
    const model = normalizeModel(localStorage.getItem("chat-model"));
    set({
      chats: [...chats, makeChat(id, title, model, parallelCount)],
      ...(activate ? { activeChatId: id, model, parallelCount } : {}),
    });
    return id;
  },

  closeChat: (chatId: string) => {
    const {
      chats,
      activeChatId,
      abortControllers,
      launchQueue,
      messageQueue,
      attachedImages,
      contextTokens,
    } = get();

    // Abort any ongoing request for this chat
    const controller = abortControllers[chatId];
    if (controller) {
      controller.abort();
    }

    // If only one chat remains, replace it with a new empty chat
    if (chats.length <= 1) {
      const newId = generateChatId();
      const newControllers = { ...abortControllers };
      delete newControllers[chatId];
      const parallelCount = normalizeParallelCount(localStorage.getItem("chat-parallel-count"));
      const model = normalizeModel(localStorage.getItem("chat-model"));
      const newLaunchQueue = { ...launchQueue };
      delete newLaunchQueue[chatId];
      const newMessageQueue = { ...messageQueue };
      delete newMessageQueue[chatId];
      const newAttachedImages = { ...attachedImages };
      delete newAttachedImages[chatId];
      const newContextTokens = { ...contextTokens };
      delete newContextTokens[chatId];
      set({
        chats: [makeChat(newId, "Chat 1", model, parallelCount)],
        // Only jump into the replacement chat if the user was already looking
        // at one — deleting the last chat from the *list* view must leave
        // them on the list, not yank them into a new empty chat.
        activeChatId: activeChatId === null ? null : newId,
        model,
        parallelCount,
        abortControllers: newControllers,
        launchQueue: newLaunchQueue,
        messageQueue: newMessageQueue,
        attachedImages: newAttachedImages,
        contextTokens: newContextTokens,
      });
      return;
    }

    const newChats = chats.filter((c) => c.id !== chatId);
    const newControllers = { ...abortControllers };
    const newLaunchQueue = { ...launchQueue };
    const newMessageQueue = { ...messageQueue };
    const newAttachedImages = { ...attachedImages };
    const newContextTokens = { ...contextTokens };
    delete newControllers[chatId];
    delete newLaunchQueue[chatId];
    delete newMessageQueue[chatId];
    delete newAttachedImages[chatId];
    delete newContextTokens[chatId];

    // Closing the open chat returns to the chat list rather than jumping to a
    // sibling chat.
    const newActiveChatId = activeChatId === chatId ? null : activeChatId;

    set({
      chats: newChats,
      activeChatId: newActiveChatId,
      abortControllers: newControllers,
      launchQueue: newLaunchQueue,
      messageQueue: newMessageQueue,
      attachedImages: newAttachedImages,
      contextTokens: newContextTokens,
    });
  },

  openChat: (chatId: string) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat) return;
    set((s) => ({
      activeChatId: chatId,
      model: chat.model,
      parallelCount: chat.parallelCount,
      chats: chat.unread
        ? s.chats.map((c) => (c.id === chatId ? { ...c, unread: false } : c))
        : s.chats,
    }));
  },

  showChatList: () => set({ activeChatId: null }),

  setChatTitle: (chatId: string, title: string) => {
    set((s) => ({
      chats: s.chats.map((c) =>
        c.id === chatId ? { ...c, title, titleIsAuto: false } : c,
      ),
    }));
  },

  applyAutoTitle: (chatId, text) => {
    set((s) => {
      const chat = s.chats.find((c) => c.id === chatId);
      if (!chat || !chat.titleIsAuto) return s;
      const title = deriveChatTitle(text);
      if (title === null) return s;
      return {
        chats: s.chats.map((c) =>
          c.id === chatId ? { ...c, title, titleIsAuto: false } : c,
        ),
      };
    });
  },

  markChatUnread: (chatId) => {
    set((s) => {
      if (chatId === s.activeChatId) {
        // Still bump updatedAt so recency ordering reflects the activity, but
        // never mark the open chat unread.
        return {
          chats: s.chats.map((c) =>
            c.id === chatId ? { ...c, updatedAt: Date.now() } : c,
          ),
        };
      }
      return {
        chats: s.chats.map((c) =>
          c.id === chatId ? { ...c, unread: true, updatedAt: Date.now() } : c,
        ),
      };
    });
  },

  markChatRead: (chatId) => {
    set((s) => {
      const chat = s.chats.find((c) => c.id === chatId);
      if (!chat || !chat.unread) return s;
      return {
        chats: s.chats.map((c) => (c.id === chatId ? { ...c, unread: false } : c)),
      };
    });
  },

  setChatActivity: (chatId, patch) => {
    set((s) => {
      const chat = s.chats.find((c) => c.id === chatId);
      if (!chat) return s;
      const nextNeedsAnswer = patch.needsAnswer ?? chat.needsAnswer;
      const nextIsBusy = patch.isBusy ?? chat.isBusy;
      if (nextNeedsAnswer === chat.needsAnswer && nextIsBusy === chat.isBusy) {
        return s;
      }
      return {
        chats: s.chats.map((c) =>
          c.id === chatId
            ? { ...c, needsAnswer: nextNeedsAnswer, isBusy: nextIsBusy }
            : c,
        ),
      };
    });
  },

  queueLaunchPayload: (chatId, payload) => {
    set((s) => ({
      launchQueue: {
        ...s.launchQueue,
        [chatId]: payload,
      },
    }));
  },

  consumeLaunchPayload: (chatId) => {
    const payload = get().launchQueue[chatId];
    if (!payload) {
      return undefined;
    }
    set((s) => {
      const nextQueue = { ...s.launchQueue };
      delete nextQueue[chatId];
      return { launchQueue: nextQueue };
    });
    return payload;
  },

  enqueueMessage: (chatId, payload) => {
    const queued: QueuedChatMessage = { id: generateQueuedMessageId(), payload };
    set((s) => ({
      messageQueue: {
        ...s.messageQueue,
        [chatId]: [...(s.messageQueue[chatId] ?? []), queued],
      },
    }));
  },

  peekNextMessage: (chatId) => {
    const queue = get().messageQueue[chatId];
    return queue && queue.length > 0 ? queue[0] : undefined;
  },

  removeQueuedMessage: (chatId, id) => {
    set((s) => {
      const queue = s.messageQueue[chatId];
      if (!queue) return s;
      const next = queue.filter((m) => m.id !== id);
      if (next.length === queue.length) return s;
      const nextQueue = { ...s.messageQueue };
      if (next.length === 0) {
        delete nextQueue[chatId];
      } else {
        nextQueue[chatId] = next;
      }
      return { messageQueue: nextQueue };
    });
  },

  clearMessageQueue: (chatId) => {
    set((s) => {
      if (!s.messageQueue[chatId]) return s;
      const nextQueue = { ...s.messageQueue };
      delete nextQueue[chatId];
      return { messageQueue: nextQueue };
    });
  },

  registerAbortController: (chatId: string, controller: AbortController) => {
    set((s) => ({
      abortControllers: { ...s.abortControllers, [chatId]: controller },
    }));
  },

  unregisterAbortController: (chatId: string) => {
    set((s) => {
      const newControllers = { ...s.abortControllers };
      delete newControllers[chatId];
      return { abortControllers: newControllers };
    });
  },

  registerSessionActions: (chatId: string, actions: ChatSessionActions) => {
    set((s) => ({
      sessionActions: { ...s.sessionActions, [chatId]: actions },
    }));
  },

  unregisterSessionActions: (chatId: string) => {
    set((s) => {
      const newActions = { ...s.sessionActions };
      delete newActions[chatId];
      return { sessionActions: newActions };
    });
  },

  setAttachedImages: (chatId, update) => {
    set((s) => {
      const prev = s.attachedImages[chatId] ?? [];
      const next = typeof update === "function" ? update(prev) : update;
      if (next === prev) return s;
      const nextMap = { ...s.attachedImages };
      if (next.length === 0) {
        delete nextMap[chatId];
      } else {
        nextMap[chatId] = next;
      }
      return { attachedImages: nextMap };
    });
  },

  setContextTokens: (chatId, tokens) => {
    set((s) => ({
      contextTokens: { ...s.contextTokens, [chatId]: tokens },
    }));
  },

  clearContextTokens: (chatId) => {
    set((s) => {
      if (!(chatId in s.contextTokens)) return s;
      const next = { ...s.contextTokens };
      delete next[chatId];
      return { contextTokens: next };
    });
  },

}));
