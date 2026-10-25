// Desktop shell only: keeps the agent panel's chats on disk through
// `window.penAgentPanel.chats` and shows them again after a restart.
// Without that bridge (web, dev build, older shell) every function here is a no-op.
// Spec: pen-editor-desktop/docs/superpowers/specs/2026-10-25-agent-chat-storage-design.md
//
// Eager design: at startup every stored chat is read once, sanitized and parked in `initialMessages`;
// the session that later builds the chat's `Chat` takes its history with `takeInitialMessages`.

import type { UIMessage } from "ai";
import type { AgentPanelChatsBridge, StoredChat } from "@/lib/agentPanel";
import { sanitizeStoredMessages } from "@/lib/chats/sanitizeStoredMessages";
import { areModelsLoaded } from "@/lib/chatModels";
import { nextChatTitle, reconcileModels, useChatStore, type ChatSummary } from "@/store/chatStore";

export const CHAT_SAVE_DEBOUNCE_MS = 300;
export const CHAT_IO_TIMEOUT_MS = 10_000;
const READ_CONCURRENCY = 6;

/** The part of the AI SDK `Chat` this module needs. The register functions are optional (test fakes). */
export interface PersistedChatHandle {
  messages: UIMessage[];
  status: string;
  "~registerMessagesCallback"?: (onChange: () => void, throttleWaitMs?: number) => () => void;
  "~registerStatusCallback"?: (onChange: () => void) => () => void;
}

interface Snapshot {
  messages: UIMessage[];
  title: string;
  titleIsAuto: boolean;
  model: string;
  updatedAt: number;
}

interface MetaKey {
  title: string;
  titleIsAuto: boolean;
  model: string;
}

/** Sanitized history of restored chats. Kept until the chat is deleted: a rebuilt Chat (remount, HMR) needs it again. */
const initialMessages = new Map<string, UIMessage[]>();
/** Handles that held at least one message; only such a handle may later cause a removal-on-empty. */
const hadMessages = new WeakSet<PersistedChatHandle>();
const handles = new Map<string, PersistedChatHandle>();
const unsubscribers = new Map<string, Array<() => void>>();
const knownRev = new Map<string, number>();
/** What disk holds (or what was loaded from it). */
const lastSaved = new Map<string, Snapshot>();
/** A save in flight. */
const pending = new Map<string, Snapshot>();
/** Chats a save was attempted for: a timed-out save may still have landed. Cleared by a successful remove. */
const attempted = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const chains = new Map<string, Promise<unknown>>();
let started = false;
let unsubscribeStore: (() => void) | undefined;
let knownMetas = new Map<string, MetaKey>();
let knownIds = new Set<string>();

/**
 * The restored history of a chat; `undefined` when there is none. It does NOT forget it: React
 * StrictMode builds the `Chat` twice in dev and a remount rebuilds it, so the entry lives until the
 * chat is deleted (the Chat stores this very array, so it costs no extra memory).
 */
export function takeInitialMessages(chatId: string): UIMessage[] | undefined {
  return initialMessages.get(chatId);
}

export function getChatsBridge(): AgentPanelChatsBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const chats = window.penAgentPanel?.chats;
  if (
    chats &&
    typeof chats.list === "function" &&
    typeof chats.read === "function" &&
    typeof chats.save === "function" &&
    typeof chats.remove === "function"
  ) {
    return chats;
  }
  return undefined;
}

function warn(what: string, detail: unknown): void {
  console.warn(`desktopChatPersistence: ${what}`, detail);
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Runs `task` after the previous disk operation of this chat id, so save/remove never overtake each other. */
function enqueue<T>(chatId: string, task: () => Promise<T>): Promise<T | undefined> {
  const prev = chains.get(chatId) ?? Promise.resolve();
  const next = prev.then(task, task).catch((e: unknown) => {
    warn("operation threw", e);
    return undefined;
  });
  chains.set(chatId, next);
  void next.then(() => {
    if (chains.get(chatId) === next) chains.delete(chatId);
  });
  return next;
}

function chatSummary(chatId: string): ChatSummary | undefined {
  return useChatStore.getState().chats.find((c) => c.id === chatId);
}

function isSettled(status: string): boolean {
  return status === "ready" || status === "error";
}

function differs(target: Snapshot | undefined, messages: UIMessage[], summary: ChatSummary): boolean {
  if (!target) return true;
  return (
    target.messages !== messages || target.title !== summary.title ||
    target.titleIsAuto !== summary.titleIsAuto || target.model !== summary.model
  );
}

function needsSave(chatId: string, messages: UIMessage[], summary: ChatSummary): boolean {
  return differs(pending.get(chatId) ?? lastSaved.get(chatId), messages, summary);
}

function schedule(chatId: string): void {
  if (!getChatsBridge()) return;
  const existing = timers.get(chatId);
  if (existing) clearTimeout(existing);
  timers.set(
    chatId,
    setTimeout(() => {
      timers.delete(chatId);
      void settle(chatId);
    }, CHAT_SAVE_DEBOUNCE_MS),
  );
}

function saveNow(chatId: string, force = false): Promise<unknown> | undefined {
  const bridge = getChatsBridge();
  const summary = chatSummary(chatId);
  if (!bridge || !summary) return undefined;
  const handle = handles.get(chatId);
  const saved = lastSaved.get(chatId);
  // Without a live handle only the last snapshot is left; it is enough for a rename.
  const messages = handle?.messages ?? saved?.messages;
  const status = handle?.status ?? "ready";
  if (!messages || messages.length === 0) return undefined;
  if (!force && !isSettled(status)) return undefined;
  if (!needsSave(chatId, messages, summary)) return undefined;

  const snapshot: Snapshot = {
    messages,
    title: summary.title,
    titleIsAuto: summary.titleIsAuto,
    model: summary.model,
    updatedAt: summary.updatedAt ?? Date.now(),
  };
  pending.set(chatId, snapshot);
  attempted.add(chatId);
  return enqueue(chatId, async () => {
    try {
      // At most one retry. The desktop has one main window, so the panel is the only writer; a stale reply
      // means our rev bookkeeping drifted, and rev + 1 of the reply heals it.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const body: StoredChat = {
          id: chatId,
          title: snapshot.title,
          titleIsAuto: snapshot.titleIsAuto,
          model: snapshot.model,
          updatedAt: snapshot.updatedAt,
          rev: (knownRev.get(chatId) ?? 0) + 1,
          messages,
        };
        try {
          const reply = await withTimeout(bridge.save(body), CHAT_IO_TIMEOUT_MS, "save");
          if (reply && "error" in reply) {
            warn("save failed", reply.error);
            return;
          }
          if (typeof reply?.rev === "number") knownRev.set(chatId, reply.rev);
          if (!reply?.stale) {
            lastSaved.set(chatId, snapshot);
            return;
          }
        } catch (e) {
          warn("save rejected", e);
          return;
        }
      }
    } finally {
      if (pending.get(chatId) === snapshot) pending.delete(chatId);
    }
  });
}

/** Something may be on disk: a known rev, a save attempt (it may have landed after a timeout), or a loaded copy. */
function wasWritten(chatId: string): boolean {
  return knownRev.has(chatId) || attempted.has(chatId) || lastSaved.has(chatId);
}

function removeFromDisk(chatId: string): void {
  const bridge = getChatsBridge();
  const timer = timers.get(chatId);
  if (timer) clearTimeout(timer);
  timers.delete(chatId);
  if (!bridge || !wasWritten(chatId)) return;
  void enqueue(chatId, async () => {
    try {
      const reply = await withTimeout(bridge.remove(chatId), CHAT_IO_TIMEOUT_MS, "remove");
      if (reply && "error" in reply) {
        warn("remove failed", reply.error);
        return;
      }
      // Only a successful remove forgets the rev; otherwise later saves would be stale forever.
      // lastSaved is cleared here (not earlier) because a save queued before this task sets it.
      knownRev.delete(chatId);
      lastSaved.delete(chatId);
      attempted.delete(chatId);
    } catch (e) {
      warn("remove rejected", e);
    }
  });
}

/** Runs when the debounce fires (or on flush): removes a chat that settled empty, else saves. */
function settle(chatId: string, force = false): Promise<unknown> | undefined {
  const handle = handles.get(chatId);
  if (handle && handle.messages.length === 0 && hadMessages.has(handle)) {
    // A cleared chat is not stored. A transient empty list (regenerate) is not settled, so it never gets here.
    if (!isSettled(handle.status)) return undefined;
    removeFromDisk(chatId);
    return undefined;
  }
  return saveNow(chatId, force);
}

function evaluate(chatId: string): void {
  const handle = handles.get(chatId);
  if (!handle || !isSettled(handle.status)) return;
  const summary = chatSummary(chatId);
  if (!summary) return;
  if (handle.messages.length === 0) {
    // Only a handle that had messages can empty a stored chat; the removal waits for the debounce.
    if (hadMessages.has(handle)) schedule(chatId);
    return;
  }
  hadMessages.add(handle);
  if (needsSave(chatId, handle.messages, summary)) schedule(chatId);
}

function subscribe(chatId: string, chat: PersistedChatHandle): void {
  const unsubs: Array<() => void> = [];
  const onChange = () => {
    if (handles.get(chatId) === chat) notifyChatState(chatId, chat);
  };
  try {
    const m = chat["~registerMessagesCallback"]?.(onChange, 0);
    if (m) unsubs.push(m);
    const s = chat["~registerStatusCallback"]?.(onChange);
    if (s) unsubs.push(s);
  } catch (e) {
    warn("subscribe failed", e);
  }
  unsubscribers.set(chatId, unsubs);
}

function dropHandle(chatId: string): void {
  for (const u of unsubscribers.get(chatId) ?? []) u();
  unsubscribers.delete(chatId);
  handles.delete(chatId);
}

/**
 * Called by a chat session on mount and whenever its status or messages change. The handle is kept
 * until the chat is deleted (a turn can finish after the session unmounted): the module also subscribes
 * to the `Chat` itself, so a later settle still schedules a save.
 */
export function notifyChatState(chatId: string, chat: PersistedChatHandle): void {
  if (!getChatsBridge()) return;
  if (handles.get(chatId) !== chat) {
    if (handles.has(chatId)) dropHandle(chatId);
    handles.set(chatId, chat);
    subscribe(chatId, chat);
  }
  evaluate(chatId);
}

/** Saves every chat with pending work now (streaming or not) and waits for all disk operations. Never rejects. */
export async function flushChats(): Promise<void> {
  try {
    const ids = new Set<string>([...timers.keys(), ...handles.keys()]);
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    // Untouched chats are skipped by the snapshot comparison inside saveNow.
    for (const id of ids) void settle(id, true);
    for (let i = 0; i < 5 && chains.size > 0; i += 1) {
      await Promise.all([...chains.values()]);
    }
  } catch (e) {
    warn("flush failed", e);
  }
}

function metaOf(c: ChatSummary): MetaKey {
  return { title: c.title, titleIsAuto: c.titleIsAuto, model: c.model };
}

function onChatListChanged(chats: ChatSummary[]): void {
  const ids = new Set(chats.map((c) => c.id));
  for (const id of knownIds) {
    if (!ids.has(id)) {
      removeFromDisk(id);
      dropHandle(id);
      pending.delete(id);
      initialMessages.delete(id);
    }
  }
  for (const c of chats) {
    const prev = knownMetas.get(c.id);
    if (prev && (prev.title !== c.title || prev.titleIsAuto !== c.titleIsAuto || prev.model !== c.model)) {
      const handle = handles.get(c.id);
      if (handle ? handle.messages.length > 0 : lastSaved.has(c.id)) schedule(c.id);
    }
  }
  knownIds = ids;
  knownMetas = new Map(chats.map((c) => [c.id, metaOf(c)]));
}

/** Reads every id with a small pool of workers; a failed read leaves `undefined` in its slot. */
async function readAll(bridge: AgentPanelChatsBridge, ids: string[]): Promise<Array<StoredChat | undefined>> {
  const results: Array<StoredChat | undefined> = new Array(ids.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      try {
        const reply = await withTimeout(bridge.read(ids[i]), CHAT_IO_TIMEOUT_MS, "read");
        if (!reply || "error" in reply) warn(`read failed for ${ids[i]}`, reply && "error" in reply ? reply.error : "no reply");
        else if (!reply.chat || !Array.isArray(reply.chat.messages)) warn(`stored chat unreadable: ${ids[i]}`, "missing or malformed");
        else results[i] = reply.chat;
      } catch (e) {
        warn(`read rejected for ${ids[i]}`, e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, ids.length) }, worker));
  return results;
}

/**
 * Starts the disk store for this page. Idempotent. Lists the stored chats, reads them all, and adds the
 * readable ones to `chatStore.chats`. A chat that cannot be read is left out and its disk copy untouched.
 */
export async function startDesktopChatPersistence(): Promise<void> {
  const bridge = getChatsBridge();
  if (!bridge || started) return;
  started = true;
  window.penChatsFlush = flushChats;
  const initial = useChatStore.getState().chats;
  knownIds = new Set(initial.map((c) => c.id));
  knownMetas = new Map(initial.map((c) => [c.id, metaOf(c)]));
  unsubscribeStore = useChatStore.subscribe((s, prev) => {
    if (s.chats !== prev.chats) onChatListChanged(s.chats);
  });
  try {
    const reply = await withTimeout(bridge.list(), CHAT_IO_TIMEOUT_MS, "list");
    if (!reply || "error" in reply) {
      warn("list failed", reply && "error" in reply ? reply.error : "no reply");
      return;
    }
    const present = new Set(useChatStore.getState().chats.map((c) => c.id));
    const metas = (Array.isArray(reply.chats) ? reply.chats : []).filter((m) => m && typeof m.id === "string" && !present.has(m.id));
    if (metas.length === 0) return;
    const loaded = await readAll(bridge, metas.map((m) => m.id));
    const nowPresent = new Set(useChatStore.getState().chats.map((c) => c.id));
    const summaries: ChatSummary[] = [];
    metas.forEach((m, i) => {
      const chat = loaded[i];
      if (!chat || nowPresent.has(m.id)) return;
      const messages = sanitizeStoredMessages(chat.messages);
      initialMessages.set(m.id, messages);
      knownRev.set(m.id, Math.max(m.rev, typeof chat.rev === "number" ? chat.rev : 0));
      lastSaved.set(m.id, { messages, title: m.title, titleIsAuto: m.titleIsAuto, model: m.model, updatedAt: m.updatedAt });
      summaries.push({
        id: m.id,
        title: m.title,
        titleIsAuto: m.titleIsAuto,
        model: m.model,
        updatedAt: m.updatedAt,
        parallelCount: 1,
        unread: false,
        needsAnswer: false,
        isBusy: false,
      });
    });
    if (summaries.length > 0) {
      useChatStore.setState((s) => {
        const restoredTitles = new Set(summaries.map((c) => c.title));
        // The untouched start chat must not share a title ("Chat 1") with a restored one.
        const merged = [...s.chats, ...summaries];
        const chats = s.chats.map((c) =>
          c.titleIsAuto && !c.isBusy && restoredTitles.has(c.title) && !handles.get(c.id)?.messages.length && !initialMessages.has(c.id)
            ? { ...c, title: nextChatTitle(merged) }
            : c,
        );
        return { chats: [...chats, ...summaries] };
      });
      // Restored chats may carry a model the backend no longer offers; skip until the list is final.
      if (areModelsLoaded()) reconcileModels();
    }
  } catch (e) {
    warn("startup failed", e);
  }
}

export function resetDesktopChatPersistenceForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  chains.clear();
  pending.clear();
  attempted.clear();
  for (const id of [...handles.keys()]) dropHandle(id);
  initialMessages.clear();
  knownRev.clear();
  lastSaved.clear();
  unsubscribeStore?.();
  unsubscribeStore = undefined;
  started = false;
  knownIds = new Set();
  knownMetas = new Map();
  if (typeof window !== "undefined") delete window.penChatsFlush;
}
