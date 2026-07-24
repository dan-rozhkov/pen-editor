import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "@/store/chatStore";

describe("chatStore — message queue", () => {
  beforeEach(() => {
    useChatStore.setState({
      messageQueue: {},
      launchQueue: {},
      attachedImages: {},
      dismissedSelection: {},
    });
  });

  it("enqueueMessage appends to the end, keyed by tab id", () => {
    const { enqueueMessage } = useChatStore.getState();
    enqueueMessage("tab-A", { text: "first" });
    enqueueMessage("tab-A", { text: "second" });

    const queue = useChatStore.getState().messageQueue["tab-A"];
    expect(queue).toHaveLength(2);
    expect(queue?.map((m) => m.payload.text)).toEqual(["first", "second"]);
    // Distinct, stable ids.
    expect(queue?.[0].id).not.toBe(queue?.[1].id);
  });

  it("keeps separate queues per tab", () => {
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
    expect(peekNextMessage("no-such-tab")).toBeUndefined();
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

  it("clearMessageQueue empties the queue for a tab", () => {
    const { enqueueMessage, clearMessageQueue } = useChatStore.getState();
    enqueueMessage("tab-A", { text: "one" });
    enqueueMessage("tab-A", { text: "two" });

    clearMessageQueue("tab-A");

    expect(useChatStore.getState().messageQueue["tab-A"]).toBeUndefined();
  });

  describe("closeTab cleanup", () => {
    it("clears the message queue when closing one of several tabs", () => {
      useChatStore.setState({
        tabs: [
          { id: "tab-A", title: "A", model: "m", parallelCount: 1 },
          { id: "tab-B", title: "B", model: "m", parallelCount: 1 },
        ],
        activeTabId: "tab-A",
      });
      useChatStore.getState().enqueueMessage("tab-A", { text: "queued" });

      useChatStore.getState().closeTab("tab-A");

      expect(useChatStore.getState().messageQueue["tab-A"]).toBeUndefined();
    });

    it("clears the message queue when closing the last remaining tab", () => {
      useChatStore.setState({
        tabs: [{ id: "tab-only", title: "Only", model: "m", parallelCount: 1 }],
        activeTabId: "tab-only",
      });
      useChatStore.getState().enqueueMessage("tab-only", { text: "queued" });

      useChatStore.getState().closeTab("tab-only");

      expect(useChatStore.getState().messageQueue["tab-only"]).toBeUndefined();
      // A fresh replacement tab was created with no leftover queue.
      const newTabId = useChatStore.getState().activeTabId;
      expect(useChatStore.getState().messageQueue[newTabId]).toBeUndefined();
    });
  });
});
