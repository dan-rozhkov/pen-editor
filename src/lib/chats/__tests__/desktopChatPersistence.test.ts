import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { AgentPanelChatsBridge, StoredChat, StoredChatMeta } from "@/lib/agentPanel";
import { useChatStore } from "@/store/chatStore";
import * as chatModels from "@/lib/chatModels";
import {
  CHAT_IO_TIMEOUT_MS,
  CHAT_SAVE_DEBOUNCE_MS,
  flushChats,
  notifyChatState,
  resetDesktopChatPersistenceForTests,
  startDesktopChatPersistence,
  takeInitialMessages,
  type PersistedChatHandle,
} from "../desktopChatPersistence";
import { INTERRUPTED_TOOL_ERROR } from "../sanitizeStoredMessages";

const meta = (id: string, over: Partial<StoredChatMeta> = {}): StoredChatMeta => ({
  id,
  title: `T ${id}`,
  titleIsAuto: false,
  model: "m1",
  updatedAt: 1000,
  rev: 3,
  messageCount: 2,
  ...over,
});
const userMsg = (id = "u1"): UIMessage => ({ id, role: "user", parts: [{ type: "text", text: "hi" }] });
const stored = (id: string, messages: UIMessage[], over: Partial<StoredChatMeta> = {}): StoredChat => {
  const { messageCount: _count, ...m } = meta(id, over);
  void _count;
  return { ...m, messages };
};

function fakeBridge(metas: StoredChatMeta[] = [], chats: Record<string, StoredChat> = {}) {
  const bridge = {
    list: vi.fn(async () => ({ chats: metas })),
    read: vi.fn(async (id: string): Promise<{ chat: StoredChat | null } | { error: string }> => ({ chat: chats[id] ?? null })),
    save: vi.fn(async (chat: StoredChat): Promise<{ ok: boolean; rev: number; stale?: boolean }> => ({ ok: true, rev: chat.rev })),
    remove: vi.fn(async () => ({ ok: true })),
  } satisfies AgentPanelChatsBridge;
  window.penAgentPanel = { version: 2, chats: bridge };
  return bridge;
}

/** A stand-in for the AI SDK Chat: plain fields plus the register hooks the module subscribes to. */
function handle(over: Partial<PersistedChatHandle> = {}) {
  const cbs = new Set<() => void>();
  const h = {
    messages: [] as UIMessage[],
    status: "ready",
    "~registerMessagesCallback": (cb: () => void) => {
      cbs.add(cb);
      return () => cbs.delete(cb);
    },
    "~registerStatusCallback": (cb: () => void) => {
      cbs.add(cb);
      return () => cbs.delete(cb);
    },
    emit: () => cbs.forEach((cb) => cb()),
    ...over,
  };
  return h;
}

/** Makes `save` wait until the returned `finish()` is called (every call replaces the gate). */
function gateSaves(bridge: ReturnType<typeof fakeBridge>, once = false) {
  const gate = { finish: () => {} };
  const impl = (chat: StoredChat) => new Promise<{ ok: boolean; rev: number }>((r) => { gate.finish = () => r({ ok: true, rev: chat.rev }); });
  if (once) bridge.save.mockImplementationOnce(impl);
  else bridge.save.mockImplementation(impl);
  return gate;
}

/** A started module with one streaming chat that has a message and was notified once; nothing is saved yet. */
async function streamingChat() {
  const bridge = fakeBridge();
  await startDesktopChatPersistence();
  const id = useChatStore.getState().chats[0].id;
  const chat = handle({ messages: [userMsg()], status: "streaming" });
  notifyChatState(id, chat);
  await vi.advanceTimersByTimeAsync(1000);
  expect(bridge.save).not.toHaveBeenCalled();
  return { bridge, id, chat };
}

const startId = () => useChatStore.getState().chats[0].id;
const ms = (n: number) => vi.advanceTimersByTimeAsync(n);

describe("desktopChatPersistence (eager)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDesktopChatPersistenceForTests();
    useChatStore.setState(useChatStore.getInitialState());
  });
  afterEach(() => {
    vi.useRealTimers();
    resetDesktopChatPersistenceForTests();
    delete window.penAgentPanel;
    vi.restoreAllMocks();
  });

  it("is a no-op without the bridge", async () => {
    window.penAgentPanel = { version: 2 };
    const before = useChatStore.getState().chats;
    await startDesktopChatPersistence();
    expect(useChatStore.getState().chats).toBe(before);
    expect(window.penChatsFlush).toBeUndefined();
    notifyChatState(before[0].id, handle({ messages: [userMsg()] }));
    await ms(1000);
    await expect(flushChats()).resolves.toBeUndefined();
  });

  it("startup reads every chat, seeds sanitized initial messages, then adds closed idle chats", async () => {
    const bad = { id: "x", role: "assistant", parts: [{ type: "tool-t", toolCallId: "1", state: "input-available", input: {} }] } as unknown as UIMessage;
    const bridge = fakeBridge(
      [meta("a"), meta("b", { title: "Bee", titleIsAuto: true })],
      { a: stored("a", [userMsg("a1"), bad]), b: stored("b", [userMsg("b1")]) },
    );
    const first = startId();
    await startDesktopChatPersistence();
    expect(bridge.read).toHaveBeenCalledTimes(2);
    const chats = useChatStore.getState().chats;
    expect(chats.map((c) => c.id)).toEqual([first, "a", "b"]);
    expect(chats[2]).toMatchObject({ title: "Bee", titleIsAuto: true, model: "m1", updatedAt: 1000, parallelCount: 1, unread: false, needsAnswer: false, isBusy: false });
    const a = takeInitialMessages("a")!;
    expect(a).toHaveLength(2);
    expect(a[1].parts[0]).toMatchObject({ state: "output-error", errorText: INTERRUPTED_TOOL_ERROR });
    // A second or rebuilt Chat still gets the history, even after a Chat registered.
    expect(takeInitialMessages("a")).toBe(a);
    notifyChatState("a", handle({ messages: a }));
    expect(takeInitialMessages("a")).toBe(a);
    expect(takeInitialMessages("zzz")).toBeUndefined();
    expect(typeof window.penChatsFlush).toBe("function");
  });

  it("skips ids already in the store", async () => {
    const id = startId();
    const bridge = fakeBridge([meta(id)], { [id]: stored(id, [userMsg()]) });
    await startDesktopChatPersistence();
    expect(useChatStore.getState().chats).toHaveLength(1);
    expect(bridge.read).not.toHaveBeenCalled();
  });

  it("reads with bounded concurrency", async () => {
    const metas = Array.from({ length: 14 }, (_, i) => meta(`c${i}`));
    const bridge = fakeBridge(metas);
    let active = 0;
    let peak = 0;
    bridge.read.mockImplementation(async (id: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { chat: stored(id, [userMsg()]) };
    });
    const p = startDesktopChatPersistence();
    await ms(100);
    await p;
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
    expect(useChatStore.getState().chats).toHaveLength(15);
  });

  it("a failed, missing or timed-out read leaves the chat out and never saves or removes it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = fakeBridge(
      [meta("ok"), meta("err"), meta("null"), meta("hang")],
      { ok: stored("ok", [userMsg()]) },
    );
    bridge.read.mockImplementation(async (id: string) => {
      if (id === "err") return { error: "disk" };
      if (id === "hang") return new Promise(() => {});
      return { chat: id === "ok" ? stored("ok", [userMsg()]) : null };
    });
    const p = startDesktopChatPersistence();
    await ms(CHAT_IO_TIMEOUT_MS + 1);
    await p;
    expect(useChatStore.getState().chats.map((c) => c.id)).not.toEqual(expect.arrayContaining(["err"]));
    expect(useChatStore.getState().chats.map((c) => c.id).slice(1)).toEqual(["ok"]);
    expect(warn).toHaveBeenCalledTimes(3);
    notifyChatState("err", handle({ messages: [userMsg()] }));
    await ms(1000);
    await flushChats();
    expect(bridge.save).not.toHaveBeenCalled();
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it("never rewrites an untouched restored chat, not even on flush", async () => {
    const bridge = fakeBridge([meta("a")], { a: stored("a", [userMsg("s1"), userMsg("s2")]) });
    await startDesktopChatPersistence();
    const chat = handle({ messages: takeInitialMessages("a")! });
    notifyChatState("a", chat);
    await ms(1000);
    await flushChats();
    expect(bridge.save).not.toHaveBeenCalled();
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it("a restored chat that sanitizes to empty is not removed from disk", async () => {
    const bridge = fakeBridge([meta("a")], { a: stored("a", [{ id: "e", role: "assistant", parts: [] }]) });
    await startDesktopChatPersistence();
    const chat = handle({ messages: takeInitialMessages("a")! });
    expect(chat.messages).toEqual([]);
    notifyChatState("a", chat);
    await flushChats();
    expect(bridge.remove).not.toHaveBeenCalled();
    expect(bridge.save).not.toHaveBeenCalled();
  });

  it("saves a restored chat after new messages settle: debounced, rev = meta rev + 1, full history", async () => {
    const bridge = fakeBridge([meta("a", { rev: 3 })], { a: stored("a", [userMsg("old")]) });
    await startDesktopChatPersistence();
    const chat = handle({ messages: takeInitialMessages("a")! });
    notifyChatState("a", chat);
    chat.messages = [...chat.messages, userMsg("u2")];
    notifyChatState("a", chat);
    notifyChatState("a", chat);
    await ms(CHAT_SAVE_DEBOUNCE_MS - 1);
    expect(bridge.save).not.toHaveBeenCalled();
    await ms(2);
    expect(bridge.save).toHaveBeenCalledTimes(1);
    expect(bridge.save.mock.calls[0][0]).toMatchObject({ id: "a", rev: 4, title: "T a", model: "m1" });
    expect(bridge.save.mock.calls[0][0].messages.map((m: UIMessage) => m.id)).toEqual(["old", "u2"]);
    notifyChatState("a", chat);
    await ms(1000);
    expect(bridge.save).toHaveBeenCalledTimes(1);
    chat.messages = [...chat.messages, userMsg("u3")];
    notifyChatState("a", chat);
    await ms(1000);
    expect(bridge.save.mock.calls[1][0].rev).toBe(5);
  });

  it("never saves while streaming, saves once it settles", async () => {
    const { bridge, id, chat } = await streamingChat();
    chat.status = "ready";
    notifyChatState(id, chat);
    await ms(1000);
    expect(bridge.save).toHaveBeenCalledTimes(1);
    expect(bridge.save.mock.calls[0][0].rev).toBe(1);
  });

  it("a rename or model change saves with the handle's messages", async () => {
    const bridge = fakeBridge();
    await startDesktopChatPersistence();
    const id = startId();
    const chat = handle({ messages: [userMsg()] });
    notifyChatState(id, chat);
    await ms(1000);
    useChatStore.getState().setChatTitle(id, "Renamed");
    await ms(1000);
    expect(bridge.save).toHaveBeenCalledTimes(2);
    expect(bridge.save.mock.calls[1][0]).toMatchObject({ title: "Renamed", titleIsAuto: false, rev: 2 });
    expect(bridge.save.mock.calls[1][0].messages).toBe(chat.messages);
    useChatStore.setState((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, model: "m9" } : c)) }));
    await ms(1000);
    expect(bridge.save).toHaveBeenCalledTimes(3);
    expect(bridge.save.mock.calls[2][0].model).toBe("m9");
  });

  it("a rename of a restored chat with no session saves the loaded messages", async () => {
    const bridge = fakeBridge([meta("a")], { a: stored("a", [userMsg("s1"), userMsg("s2")]) });
    await startDesktopChatPersistence();
    useChatStore.getState().setChatTitle("a", "Renamed");
    await ms(1000);
    expect(bridge.save).toHaveBeenCalledTimes(1);
    expect(bridge.save.mock.calls[0][0]).toMatchObject({ id: "a", title: "Renamed", rev: 4 });
    expect(bridge.save.mock.calls[0][0].messages).toHaveLength(2);
  });

  it("a rename never saves a chat without messages", async () => {
    const bridge = fakeBridge();
    await startDesktopChatPersistence();
    useChatStore.getState().setChatTitle(startId(), "Renamed");
    await ms(1000);
    expect(bridge.save).not.toHaveBeenCalled();
  });

  it("retries a stale save once with the reply rev", async () => {
    const bridge = fakeBridge();
    bridge.save.mockResolvedValue({ ok: true, rev: 9, stale: true });
    await startDesktopChatPersistence();
    notifyChatState(startId(), handle({ messages: [userMsg()] }));
    await ms(1000);
    expect(bridge.save).toHaveBeenCalledTimes(2);
    expect(bridge.save.mock.calls.map((c) => c[0].rev)).toEqual([1, 10]);
  });

  it("warns when a save fails and does not throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = fakeBridge();
    bridge.save.mockRejectedValueOnce(new Error("boom"));
    await startDesktopChatPersistence();
    notifyChatState(startId(), handle({ messages: [userMsg()] }));
    await ms(1000);
    expect(warn).toHaveBeenCalled();
  });

  it("flush saves a streaming chat and awaits the reply; normal saves still wait", async () => {
    const bridge = fakeBridge();
    const gate = gateSaves(bridge);
    await startDesktopChatPersistence();
    notifyChatState(startId(), handle({ messages: [userMsg()], status: "streaming" }));
    await ms(1000);
    expect(bridge.save).not.toHaveBeenCalled();
    let done = false;
    const p = window.penChatsFlush!().then(() => { done = true; });
    await ms(0);
    expect(bridge.save).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    gate.finish();
    await p;
    expect(done).toBe(true);
  });

  it("flush does not save the same state twice while that save is in flight", async () => {
    const bridge = fakeBridge();
    const gate = gateSaves(bridge);
    await startDesktopChatPersistence();
    notifyChatState(startId(), handle({ messages: [userMsg()] }));
    await ms(CHAT_SAVE_DEBOUNCE_MS + 1);
    const p = flushChats();
    await ms(0);
    gate.finish();
    await p;
    expect(bridge.save).toHaveBeenCalledTimes(1);
  });

  it("closeChat removes a written chat; a never-written one is not removed", async () => {
    const bridge = fakeBridge([meta("a")], { a: stored("a", [userMsg()]) });
    await startDesktopChatPersistence();
    const fresh = useChatStore.getState().createChat({ activate: false });
    useChatStore.getState().closeChat(fresh);
    await ms(0);
    expect(bridge.remove).not.toHaveBeenCalled();
    useChatStore.getState().closeChat("a");
    await ms(0);
    expect(bridge.remove).toHaveBeenCalledWith("a");
  });

  it("closeChat cancels a pending save", async () => {
    const bridge = fakeBridge();
    await startDesktopChatPersistence();
    const id = startId();
    useChatStore.getState().createChat({ activate: false });
    notifyChatState(id, handle({ messages: [userMsg()] }));
    useChatStore.getState().closeChat(id);
    await ms(1000);
    await flushChats();
    expect(bridge.save).not.toHaveBeenCalled();
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it("clearing a written chat removes it from disk", async () => {
    const bridge = fakeBridge([meta("b")], { b: stored("b", [userMsg("o")]) });
    await startDesktopChatPersistence();
    const chat = handle({ messages: takeInitialMessages("b")! });
    notifyChatState("b", chat);
    chat.messages = [];
    notifyChatState("b", chat);
    await ms(CHAT_SAVE_DEBOUNCE_MS + 1);
    expect(bridge.remove).toHaveBeenCalledWith("b");
  });

  it("removes a chat cleared while its first save is in flight, after that save", async () => {
    const bridge = fakeBridge();
    const order: string[] = [];
    const gate = gateSaves(bridge, true);
    bridge.remove.mockImplementation(async () => { order.push("remove"); return { ok: true }; });
    await startDesktopChatPersistence();
    const id = startId();
    const chat = handle({ messages: [userMsg()] });
    notifyChatState(id, chat);
    await ms(CHAT_SAVE_DEBOUNCE_MS + 1);
    chat.messages = [];
    notifyChatState(id, chat);
    await ms(CHAT_SAVE_DEBOUNCE_MS + 1);
    expect(bridge.remove).not.toHaveBeenCalled();
    order.push("save");
    gate.finish();
    await ms(0);
    expect(order).toEqual(["save", "remove"]);
  });

  it("keeps the rev when a remove fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = fakeBridge([meta("b", { rev: 5 })], { b: stored("b", [userMsg("o")], { rev: 5 }) });
    await startDesktopChatPersistence();
    const chat = handle({ messages: takeInitialMessages("b")! });
    notifyChatState("b", chat);
    bridge.remove.mockRejectedValueOnce(new Error("nope"));
    chat.messages = [];
    notifyChatState("b", chat);
    await ms(CHAT_SAVE_DEBOUNCE_MS + 1);
    expect(bridge.remove).toHaveBeenCalledTimes(1);
    chat.messages = [userMsg("n")];
    notifyChatState("b", chat);
    await ms(1000);
    expect(bridge.save.mock.calls[0][0].rev).toBe(6);
  });

  it("keeps the handle after the session unmounts: a later settle still saves", async () => {
    const { bridge, chat } = await streamingChat(); // the session never notifies again after this
    chat.messages = [...chat.messages, { id: "asst", role: "assistant", parts: [{ type: "text", text: "done" }] }];
    chat.status = "ready";
    chat.emit(); // the Chat's own callback fires with no React around
    await ms(CHAT_SAVE_DEBOUNCE_MS + 1);
    expect(bridge.save).toHaveBeenCalledTimes(1);
    expect(bridge.save.mock.calls[0][0].messages).toHaveLength(2);
  });

  it("stops listening to a deleted chat", async () => {
    const bridge = fakeBridge();
    await startDesktopChatPersistence();
    const id = startId();
    const chat = handle({ messages: [userMsg()] });
    notifyChatState(id, chat);
    useChatStore.getState().closeChat(id);
    chat.messages = [userMsg("late")];
    chat.emit();
    await ms(1000);
    await flushChats();
    expect(bridge.save).not.toHaveBeenCalled();
  });

  it("a rebuilt Chat for a restored chat gets the history again and never wipes the disk copy", async () => {
    const bridge = fakeBridge([meta("a")], { a: stored("a", [userMsg("s1")]) });
    await startDesktopChatPersistence();
    notifyChatState("a", handle({ messages: takeInitialMessages("a")! }));
    const rebuilt = handle({ messages: takeInitialMessages("a") ?? [] });
    expect(rebuilt.messages).toHaveLength(1);
    notifyChatState("a", rebuilt);
    await ms(1000);
    await flushChats();
    expect(bridge.remove).not.toHaveBeenCalled();
    expect(bridge.save).not.toHaveBeenCalled();
  });

  it("a new handle that starts empty never removes a stored chat", async () => {
    const bridge = fakeBridge([meta("a")], { a: stored("a", [userMsg("s1")]) });
    await startDesktopChatPersistence();
    notifyChatState("a", handle({ messages: takeInitialMessages("a")! }));
    notifyChatState("a", handle({ messages: [] }));
    await ms(1000);
    await flushChats();
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it("a transient empty list (regenerate) is not removed; the new messages are saved", async () => {
    const bridge = fakeBridge([meta("a", { rev: 3 })], { a: stored("a", [userMsg("s1")]) });
    await startDesktopChatPersistence();
    const chat = handle({ messages: takeInitialMessages("a")! });
    notifyChatState("a", chat);
    chat.messages = [];
    notifyChatState("a", chat);
    await ms(CHAT_SAVE_DEBOUNCE_MS - 10);
    chat.messages = [userMsg("n1")];
    notifyChatState("a", chat);
    await ms(CHAT_SAVE_DEBOUNCE_MS + 1);
    expect(bridge.remove).not.toHaveBeenCalled();
    expect(bridge.save).toHaveBeenCalledTimes(1);
    expect(bridge.save.mock.calls[0][0].messages.map((m: UIMessage) => m.id)).toEqual(["n1"]);
  });

  it("an empty list while the chat is streaming is not removed even on flush", async () => {
    const bridge = fakeBridge([meta("a")], { a: stored("a", [userMsg("s1")]) });
    await startDesktopChatPersistence();
    const chat = handle({ messages: takeInitialMessages("a")! });
    notifyChatState("a", chat);
    chat.messages = [];
    chat.status = "submitted";
    notifyChatState("a", chat);
    await flushChats();
    expect(bridge.remove).not.toHaveBeenCalled();
  });

  it("clearing a chat whose first save timed out still removes it (same predicate as delete)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = fakeBridge();
    bridge.save.mockImplementationOnce(() => new Promise(() => {}));
    await startDesktopChatPersistence();
    const id = startId();
    const chat = handle({ messages: [userMsg()] });
    notifyChatState(id, chat);
    await ms(CHAT_SAVE_DEBOUNCE_MS + CHAT_IO_TIMEOUT_MS + 10);
    chat.messages = [];
    notifyChatState(id, chat);
    await ms(CHAT_SAVE_DEBOUNCE_MS + 1);
    expect(bridge.remove).toHaveBeenCalledWith(id);
  });

  it("saves the summary's updatedAt, not the clock", async () => {
    const bridge = fakeBridge();
    await startDesktopChatPersistence();
    const id = startId();
    useChatStore.setState((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, updatedAt: 4242 } : c)) }));
    notifyChatState(id, handle({ messages: [userMsg()] }));
    await ms(1000);
    expect(bridge.save.mock.calls[0][0].updatedAt).toBe(4242);
  });

  it("reconciles restored chats' models once the model list is loaded, not before", async () => {
    const loaded = vi.spyOn(chatModels, "areModelsLoaded");
    loaded.mockReturnValue(false);
    fakeBridge([meta("a", { model: "ghost" })], { a: stored("a", [userMsg()]) });
    await startDesktopChatPersistence();
    expect(useChatStore.getState().chats.find((c) => c.id === "a")?.model).toBe("ghost");
    resetDesktopChatPersistenceForTests();
    useChatStore.setState(useChatStore.getInitialState());
    loaded.mockReturnValue(true);
    fakeBridge([meta("a", { model: "ghost" })], { a: stored("a", [userMsg()]) });
    await startDesktopChatPersistence();
    expect(useChatStore.getState().chats.find((c) => c.id === "a")?.model).toBe(chatModels.getDefaultModel());
  });

  it("renames the untouched start chat when a restored chat has the same title", async () => {
    fakeBridge([meta("a", { title: "Chat 1", titleIsAuto: true })], { a: stored("a", [userMsg()]) });
    const first = startId();
    expect(useChatStore.getState().chats[0].title).toBe("Chat 1");
    await startDesktopChatPersistence();
    const chats = useChatStore.getState().chats;
    expect(chats.find((c) => c.id === "a")?.title).toBe("Chat 1");
    expect(chats.find((c) => c.id === first)?.title).toBe("Chat 2");
  });

  it("keeps the start chat's title when it already has messages", async () => {
    fakeBridge([meta("a", { title: "Chat 1", titleIsAuto: true })], { a: stored("a", [userMsg()]) });
    const first = startId();
    notifyChatState(first, handle({ messages: [userMsg()] }));
    await startDesktopChatPersistence();
    expect(useChatStore.getState().chats.find((c) => c.id === first)?.title).toBe("Chat 1");
  });
});
