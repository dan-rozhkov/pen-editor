import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { reconcileModels, useChatStore, type ChatSummary } from "@/store/chatStore";
import { getDefaultModel, getModelOptions } from "@/lib/chatModels";
import { clearOpenCodeKey, setOpenCodeKey } from "@/lib/opencodeKey";
import { assertDefined } from "@/test/assertions";

function makeChat(overrides: Partial<ChatSummary> & { id: string }): ChatSummary {
  return {
    title: "Chat",
    model: "deepseek/deepseek-v4.1-flash",
    parallelCount: 1,
    titleIsAuto: true,
    unread: false,
    needsAnswer: false,
    isBusy: false,
    updatedAt: 0,
    ...overrides,
  };
}

describe("chatStore — message queue", () => {
  beforeEach(() => {
    useChatStore.setState({
      messageQueue: {},
      launchQueue: {},
      attachedImages: {},
    });
  });

  it("enqueueMessage appends to the end, keyed by chat id", () => {
    const { enqueueMessage } = useChatStore.getState();
    enqueueMessage("tab-A", { text: "first" });
    enqueueMessage("tab-A", { text: "second" });

    const queue = useChatStore.getState().messageQueue["tab-A"];
    expect(queue).toHaveLength(2);
    expect(queue?.map((m) => m.payload.text)).toEqual(["first", "second"]);
    // Distinct, stable ids.
    expect(queue?.[0].id).not.toBe(queue?.[1].id);
  });

  it("keeps separate queues per chat", () => {
    const { enqueueMessage } = useChatStore.getState();
    enqueueMessage("tab-A", { text: "a1" });
    enqueueMessage("tab-B", { text: "b1" });

    expect(useChatStore.getState().messageQueue["tab-A"]).toHaveLength(1);
    expect(useChatStore.getState().messageQueue["tab-B"]).toHaveLength(1);
  });

  it("peekNextMessage returns the first item without removing it from the queue", () => {
    const { enqueueMessage, peekNextMessage } = useChatStore.getState();
    enqueueMessage("tab-A", { text: "first" });
    enqueueMessage("tab-A", { text: "second" });
    enqueueMessage("tab-A", { text: "third" });

    const first = peekNextMessage("tab-A");
    expect(first?.payload.text).toBe("first");
    // Nothing was removed — peeking again returns the same item, and the
    // queue is untouched.
    expect(useChatStore.getState().messageQueue["tab-A"]?.map((m) => m.payload.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(peekNextMessage("tab-A")?.id).toBe(first?.id);
  });

  it("peekNextMessage returns undefined for an empty or unknown queue", () => {
    const { peekNextMessage } = useChatStore.getState();
    expect(peekNextMessage("no-such-chat")).toBeUndefined();
  });

  it("removeQueuedMessage removes only the targeted item", () => {
    const { enqueueMessage, removeQueuedMessage } = useChatStore.getState();
    enqueueMessage("tab-A", { text: "keep-1" });
    enqueueMessage("tab-A", { text: "remove-me" });
    enqueueMessage("tab-A", { text: "keep-2" });

    const [, toRemove] = useChatStore.getState().messageQueue["tab-A"]!;
    removeQueuedMessage("tab-A", toRemove.id);

    const remaining = useChatStore.getState().messageQueue["tab-A"];
    expect(remaining?.map((m) => m.payload.text)).toEqual(["keep-1", "keep-2"]);
  });

  it("removeQueuedMessage removing the last item cleans up the queue entry", () => {
    const { enqueueMessage, removeQueuedMessage } = useChatStore.getState();
    enqueueMessage("tab-A", { text: "only" });
    const [only] = useChatStore.getState().messageQueue["tab-A"]!;

    removeQueuedMessage("tab-A", only.id);

    expect(useChatStore.getState().messageQueue["tab-A"]).toBeUndefined();
  });

  it("removeQueuedMessage is a no-op for an unknown id", () => {
    const { enqueueMessage, removeQueuedMessage } = useChatStore.getState();
    enqueueMessage("tab-A", { text: "keep" });
    removeQueuedMessage("tab-A", "does-not-exist");
    expect(useChatStore.getState().messageQueue["tab-A"]).toHaveLength(1);
  });

  it("clearMessageQueue empties the queue for a chat", () => {
    const { enqueueMessage, clearMessageQueue } = useChatStore.getState();
    enqueueMessage("tab-A", { text: "one" });
    enqueueMessage("tab-A", { text: "two" });

    clearMessageQueue("tab-A");

    expect(useChatStore.getState().messageQueue["tab-A"]).toBeUndefined();
  });

  describe("closeChat cleanup", () => {
    it("clears the message queue when closing one of several chats", () => {
      useChatStore.setState({
        chats: [makeChat({ id: "tab-A" }), makeChat({ id: "tab-B" })],
        activeChatId: "tab-A",
      });
      useChatStore.getState().enqueueMessage("tab-A", { text: "queued" });

      useChatStore.getState().closeChat("tab-A");

      expect(useChatStore.getState().messageQueue["tab-A"]).toBeUndefined();
    });

    it("clears the message queue when closing the last remaining chat", () => {
      useChatStore.setState({
        chats: [makeChat({ id: "tab-only" })],
        activeChatId: "tab-only",
      });
      useChatStore.getState().enqueueMessage("tab-only", { text: "queued" });

      useChatStore.getState().closeChat("tab-only");

      expect(useChatStore.getState().messageQueue["tab-only"]).toBeUndefined();
      // A fresh replacement chat was created with no leftover queue.
      const newChatId = useChatStore.getState().activeChatId!;
      expect(useChatStore.getState().messageQueue[newChatId]).toBeUndefined();
    });
  });
});

describe("chatStore — chat list state", () => {
  beforeEach(() => {
    useChatStore.setState({
      chats: [
        makeChat({ id: "tab-A", title: "A" }),
        makeChat({ id: "tab-B", title: "B" }),
      ],
      activeChatId: "tab-A",
      messageQueue: {},
      launchQueue: {},
      abortControllers: {},
      attachedImages: {},
      sessionActions: {},
    });
  });

  it("openChat resets unread for the opened chat", () => {
    useChatStore.setState((s) => ({
      chats: s.chats.map((c) => (c.id === "tab-B" ? { ...c, unread: true } : c)),
    }));

    useChatStore.getState().openChat("tab-B");

    const state = useChatStore.getState();
    expect(state.activeChatId).toBe("tab-B");
    expect(state.chats.find((c) => c.id === "tab-B")?.unread).toBe(false);
  });

  it("markChatUnread does not mark the active chat", () => {
    useChatStore.getState().markChatUnread("tab-A");
    expect(useChatStore.getState().chats.find((c) => c.id === "tab-A")?.unread).toBe(false);
  });

  it("markChatUnread marks a background chat", () => {
    useChatStore.getState().markChatUnread("tab-B");
    expect(useChatStore.getState().chats.find((c) => c.id === "tab-B")?.unread).toBe(true);
  });

  it("closeChat on the open chat returns activeChatId to null", () => {
    useChatStore.getState().closeChat("tab-A");
    expect(useChatStore.getState().activeChatId).toBeNull();
    expect(useChatStore.getState().chats.map((c) => c.id)).toEqual(["tab-B"]);
  });

  it("closing the last chat replaces it with a new active empty chat", () => {
    useChatStore.setState({ chats: [makeChat({ id: "tab-only" })], activeChatId: "tab-only" });

    useChatStore.getState().closeChat("tab-only");

    const state = useChatStore.getState();
    expect(state.chats).toHaveLength(1);
    expect(state.activeChatId).toBe(state.chats[0].id);
    expect(state.activeChatId).not.toBe("tab-only");
  });

  // Regression: this branch used to unconditionally set activeChatId to the
  // new replacement chat, even when the user had been on the chat list
  // (activeChatId === null) and deleted the sole chat from there — jumping
  // them into a new empty chat instead of leaving the list showing.
  it("closing the last chat from the list view (no chat open) leaves activeChatId null", () => {
    useChatStore.setState({ chats: [makeChat({ id: "tab-only" })], activeChatId: null });

    useChatStore.getState().closeChat("tab-only");

    const state = useChatStore.getState();
    expect(state.chats).toHaveLength(1);
    expect(state.chats[0].id).not.toBe("tab-only");
    expect(state.activeChatId).toBeNull();
  });

  it("applyAutoTitle sets the title once and ignores a second call", () => {
    useChatStore.getState().applyAutoTitle("tab-A", "make a login screen please");

    let chat = useChatStore.getState().chats.find((c) => c.id === "tab-A");
    expect(chat?.title).toBe("make a login screen please");
    expect(chat?.titleIsAuto).toBe(false);

    useChatStore.getState().applyAutoTitle("tab-A", "a completely different message");

    chat = useChatStore.getState().chats.find((c) => c.id === "tab-A");
    expect(chat?.title).toBe("make a login screen please");
  });

  it("setChatTitle clears titleIsAuto", () => {
    useChatStore.getState().setChatTitle("tab-A", "Renamed");

    const chat = useChatStore.getState().chats.find((c) => c.id === "tab-A");
    expect(chat?.title).toBe("Renamed");
    expect(chat?.titleIsAuto).toBe(false);

    // A later auto-title attempt is now a no-op.
    useChatStore.getState().applyAutoTitle("tab-A", "some user message");
    expect(useChatStore.getState().chats.find((c) => c.id === "tab-A")?.title).toBe("Renamed");
  });

  it("setChatActivity does not change the state reference for an identical patch", () => {
    useChatStore.getState().setChatActivity("tab-A", { isBusy: true });
    const afterFirst = useChatStore.getState();

    useChatStore.getState().setChatActivity("tab-A", { isBusy: true });
    const afterSecond = useChatStore.getState();

    expect(afterSecond).toBe(afterFirst);
  });

  it("createChat defaults to activating the new chat with localStorage's parallelCount", () => {
    localStorage.setItem("chat-parallel-count", "2");

    const newId = useChatStore.getState().createChat();

    const state = useChatStore.getState();
    expect(state.activeChatId).toBe(newId);
    expect(state.parallelCount).toBe(2);
    expect(state.chats.find((c) => c.id === newId)?.parallelCount).toBe(2);

    localStorage.removeItem("chat-parallel-count");
  });

  it("createChat({ activate: false, parallelCount: 1 }) adds the chat without touching activeChatId", () => {
    useChatStore.setState({ parallelCount: 3 });

    const newId = useChatStore.getState().createChat({ activate: false, parallelCount: 1 });

    const state = useChatStore.getState();
    expect(state.activeChatId).toBe("tab-A");
    expect(state.parallelCount).toBe(3); // untouched — still the pre-call global value
    expect(state.chats.find((c) => c.id === newId)?.parallelCount).toBe(1);
  });

  it("setChatActivity merges flags that did change", () => {
    useChatStore.getState().setChatActivity("tab-A", { isBusy: true });
    useChatStore.getState().setChatActivity("tab-A", { needsAnswer: true });

    const chat = useChatStore.getState().chats.find((c) => c.id === "tab-A");
    expect(chat?.isBusy).toBe(true);
    expect(chat?.needsAnswer).toBe(true);
  });
});

describe("chatStore — model selection", () => {
  beforeEach(() => {
    localStorage.removeItem("chat-model");
    useChatStore.setState({
      chats: [
        makeChat({ id: "tab-A", title: "A" }),
        makeChat({ id: "tab-B", title: "B" }),
      ],
      activeChatId: "tab-A",
      model: "deepseek/deepseek-v4.1-flash",
    });
  });

  it("setModel writes the active chat's model, not every chat's", () => {
    useChatStore.getState().setModel("qwen/qwen3.8-flash");

    const state = useChatStore.getState();
    expect(state.model).toBe("qwen/qwen3.8-flash");
    expect(state.chats.find((c) => c.id === "tab-A")?.model).toBe("qwen/qwen3.8-flash");
    // A background chat keeps its own model — it may be mid-stream, and its
    // auto-continuations must not switch models under it.
    expect(state.chats.find((c) => c.id === "tab-B")?.model).toBe(
      "deepseek/deepseek-v4.1-flash",
    );
    expect(localStorage.getItem("chat-model")).toBe("qwen/qwen3.8-flash");
  });

  it("openChat restores that chat's model as the active one", () => {
    useChatStore.setState((s) => ({
      chats: s.chats.map((c) =>
        c.id === "tab-B" ? { ...c, model: "z-ai/glm-5.3-flash" } : c,
      ),
    }));

    useChatStore.getState().openChat("tab-B");

    expect(useChatStore.getState().model).toBe("z-ai/glm-5.3-flash");
  });

  it("reconcileModels resets a selection the backend does not offer", () => {
    useChatStore.setState((s) => ({
      model: "gone/retired-model",
      chats: s.chats.map((c) =>
        c.id === "tab-B" ? { ...c, model: "gone/retired-model" } : c,
      ),
    }));

    reconcileModels();

    const state = useChatStore.getState();
    expect(state.model).toBe(getDefaultModel());
    expect(state.chats.every((c) => c.model === getDefaultModel() ||
      getModelOptions().some((o) => o.value === c.model))).toBe(true);
  });

  it("reconcileModels leaves a valid selection alone", () => {
    const valid = getModelOptions()[0].value;
    useChatStore.setState((s) => ({
      model: valid,
      chats: s.chats.map((c) => ({ ...c, model: valid })),
    }));

    reconcileModels();

    expect(useChatStore.getState().model).toBe(valid);
  });

  // Defect 2 (code review): removing the OpenCode key used to leave an
  // opencode-* selection active, so the very next turn hit the backend's
  // 400 opencode_key_required instead of falling back — the exact scenario
  // reconcileModels()'s own header comment claims is prevented. The fix
  // subscribes reconcileModels to opencodeKey.ts's change notifications
  // (chatStore.ts, module scope) rather than relying on a specific button
  // handler to call it, so ANY clearOpenCodeKey() caller is covered.
  describe("reacts to OpenCode key changes (defect 2)", () => {
    afterEach(() => {
      clearOpenCodeKey();
    });

    it("falls back to the default model when the key backing the active selection is removed", () => {
      const opencodeModel = getModelOptions().find((o) => o.requiresUserKey)?.value;
      assertDefined(opencodeModel, "fixture assumes a requiresUserKey model exists");

      setOpenCodeKey("sk-test-defect2");
      useChatStore.setState((s) => ({
        model: opencodeModel,
        chats: s.chats.map((c) => ({ ...c, model: opencodeModel })),
      }));
      expect(useChatStore.getState().model).toBe(opencodeModel);

      // No direct reconcileModels() call here — clearOpenCodeKey() alone
      // must trigger it via the subscription.
      clearOpenCodeKey();

      const state = useChatStore.getState();
      expect(state.model).toBe(getDefaultModel());
      expect(state.chats.every((c) => c.model === getDefaultModel())).toBe(true);
    });

    it("leaves the current selection alone when a key is saved", () => {
      const valid = getModelOptions().find((o) => !o.requiresUserKey)?.value;
      assertDefined(valid, "fixture assumes a non-opencode model exists");

      useChatStore.setState((s) => ({
        model: valid,
        chats: s.chats.map((c) => ({ ...c, model: valid })),
      }));

      setOpenCodeKey("sk-test-defect2-save");

      expect(useChatStore.getState().model).toBe(valid);
    });
  });
});
