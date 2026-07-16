import { create } from "zustand";
import { usePageStore } from "./pageStore";
import { nextOrder } from "@/lib/comments/commentsLogic";

/**
 * A comment thread's anchor: either pinned to a node (offset stored as
 * fractions of the node's rect, so the pin re-tracks move/resize/auto-layout)
 * or a bare canvas point.
 */
export type CommentAnchor =
  | { kind: "node"; nodeId: string; ox: number; oy: number }
  | { kind: "canvas"; x: number; y: number };

export interface CommentMessage {
  id: string;
  author: "me" | "agent";
  text: string;
  createdAt: number;
  editedAt?: number;
}

/** `messages[0]` is the thread root; the rest are flat replies (two levels, like Figma). */
export interface CommentThread {
  id: string;
  order: number;
  anchor: CommentAnchor;
  messages: CommentMessage[];
  resolvedAt?: number;
}

let nextThreadId = 0;
function generateThreadId(): string {
  nextThreadId += 1;
  return `comment-thread-${Date.now()}-${nextThreadId}`;
}

let nextMessageId = 0;
function generateMessageId(): string {
  nextMessageId += 1;
  return `comment-message-${Date.now()}-${nextMessageId}`;
}

interface CommentsState {
  /** Persistent comment threads for the current page. */
  threads: CommentThread[];
  /**
   * An in-progress "place a pin" gesture that hasn't been committed to a
   * thread yet (no message typed/submitted). Cleared on submit or cancel —
   * never persisted, never touches undo/redo.
   */
  draftAnchor: CommentAnchor | null;
  /**
   * Session-only pin visibility toggle (Shift+C). Not per-page, not
   * serialized — purely a viewing preference for the current session.
   */
  pinsHidden: boolean;
  togglePinsHidden: () => void;

  startDraft: (anchor: CommentAnchor) => void;
  cancelDraft: () => void;
  /** Commit the current draft as a new thread with `text` as its root message. Returns the new thread id, or null if there's no draft. */
  submitDraft: (text: string) => string | null;

  addReply: (threadId: string, author: "me" | "agent", text: string) => void;
  /** Edit a message's text — only ever affects messages authored "me" (agent replies are not user-editable). */
  editMessage: (threadId: string, messageId: string, text: string) => void;
  /**
   * Delete a single reply (never the thread root — deleting the root is
   * "delete thread", a distinct, confirmed action). Only affects messages
   * authored "me". No-op otherwise.
   */
  deleteMessage: (threadId: string, messageId: string) => void;
  deleteThread: (threadId: string) => void;
  resolveThread: (threadId: string) => void;
  unresolveThread: (threadId: string) => void;
  /** Reposition a thread's pin (drag) — may re-anchor to a different node or to a bare canvas point. */
  updateAnchor: (threadId: string, anchor: CommentAnchor) => void;
  /** Bulk replace — used when switching pages / loading a document. Not an undoable user edit (comments live outside undo/redo entirely). */
  setThreads: (threads: CommentThread[]) => void;
}

/**
 * Comments are deliberately OUTSIDE undo/redo (see cmt-01 spec, key decision
 * #1) — unlike `measurementsStore`, nothing here calls `saveHistory`/
 * `withHistoryBatch`, and `historySnapshot.ts` never touches this store.
 *
 * Computing a thread's `order` needs the document-wide max across *all*
 * pages, not just the current page's live threads — so this store reaches
 * into `pageStore` for the inactive pages' stored `comments`. That makes
 * `commentsStore` <-> `pageStore` a circular module import; it's safe the
 * same way `devModeStore` <-> `measureToolController` is (see devModeStore.ts):
 * `usePageStore` is only ever touched lazily, inside a function body invoked
 * after both modules have finished loading — never at this module's top level.
 */
export const useCommentsStore = create<CommentsState>((set, get) => ({
  threads: [],
  draftAnchor: null,
  pinsHidden: false,

  togglePinsHidden: () => set((state) => ({ pinsHidden: !state.pinsHidden })),

  startDraft: (anchor) => set({ draftAnchor: anchor }),
  cancelDraft: () => set({ draftAnchor: null }),

  submitDraft: (text) => {
    const anchor = get().draftAnchor;
    const trimmed = text.trim();
    if (!anchor || !trimmed) return null;

    const otherPagesOrders = usePageStore
      .getState()
      .pages.flatMap((p) => p.comments ?? [])
      .map((t) => t.order);
    const order = nextOrder([...otherPagesOrders, ...get().threads.map((t) => t.order)]);

    const id = generateThreadId();
    const message: CommentMessage = {
      id: generateMessageId(),
      author: "me",
      text: trimmed,
      createdAt: Date.now(),
    };
    const thread: CommentThread = { id, order, anchor, messages: [message] };
    set((state) => ({ threads: [...state.threads, thread], draftAnchor: null }));
    return id;
  },

  addReply: (threadId, author, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: [
                ...t.messages,
                { id: generateMessageId(), author, text: trimmed, createdAt: Date.now() },
              ],
            }
          : t,
      ),
    }));
  },

  editMessage: (threadId, messageId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((state) => ({
      threads: state.threads.map((t) => {
        if (t.id !== threadId) return t;
        return {
          ...t,
          messages: t.messages.map((m) =>
            m.id === messageId && m.author === "me"
              ? { ...m, text: trimmed, editedAt: Date.now() }
              : m,
          ),
        };
      }),
    }));
  },

  deleteMessage: (threadId, messageId) => {
    set((state) => ({
      threads: state.threads.map((t) => {
        if (t.id !== threadId) return t;
        const rootId = t.messages[0]?.id;
        if (messageId === rootId) return t; // deleting the root is "delete thread", not this
        const target = t.messages.find((m) => m.id === messageId);
        if (!target || target.author !== "me") return t;
        return { ...t, messages: t.messages.filter((m) => m.id !== messageId) };
      }),
    }));
  },

  deleteThread: (threadId) => {
    set((state) => ({ threads: state.threads.filter((t) => t.id !== threadId) }));
  },

  resolveThread: (threadId) => {
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, resolvedAt: Date.now() } : t,
      ),
    }));
  },

  unresolveThread: (threadId) => {
    set((state) => ({
      threads: state.threads.map((t): CommentThread =>
        t.id === threadId
          ? { id: t.id, order: t.order, anchor: t.anchor, messages: t.messages }
          : t,
      ),
    }));
  },

  updateAnchor: (threadId, anchor) => {
    set((state) => ({
      threads: state.threads.map((t) => (t.id === threadId ? { ...t, anchor } : t)),
    }));
  },

  setThreads: (threads) => set({ threads }),
}));
