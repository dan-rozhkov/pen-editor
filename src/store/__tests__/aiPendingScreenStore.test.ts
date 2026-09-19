import { beforeEach, describe, expect, it } from "vitest";
import {
  pendingScreenKey,
  useAiPendingScreenStore,
  type AiPendingScreenDraft,
} from "@/store/aiPendingScreenStore";

function draft(overrides: Partial<AiPendingScreenDraft> = {}): AiPendingScreenDraft {
  return {
    sessionId: "s1",
    toolCallId: "call-1",
    screens: [{ name: "Login", x: 0, y: 0, width: 390, height: 844 }],
    ...overrides,
  };
}

beforeEach(() => {
  useAiPendingScreenStore.getState().reset();
});

describe("aiPendingScreenStore", () => {
  it("stores a draft under its session/call key", () => {
    useAiPendingScreenStore.getState().upsert(draft());
    const key = pendingScreenKey("s1", "call-1");
    expect(useAiPendingScreenStore.getState().drafts[key].screens).toHaveLength(1);
  });

  it("keeps the same object identity when nothing changed", () => {
    const store = useAiPendingScreenStore.getState();
    store.upsert(draft());
    const first = useAiPendingScreenStore.getState().drafts;
    store.upsert(draft());
    // The layer re-renders off store changes; an identical frame (the
    // common case — most frames only advance htmlContent, not the header
    // list) must not trigger a redraw.
    expect(useAiPendingScreenStore.getState().drafts).toBe(first);
  });

  it("replaces the draft when a new screen's header becomes available", () => {
    const store = useAiPendingScreenStore.getState();
    store.upsert(draft());
    store.upsert(
      draft({
        screens: [
          { name: "Login", x: 0, y: 0, width: 390, height: 844 },
          { name: "Feed", x: 440, y: 0, width: 390, height: 844 },
        ],
      }),
    );
    const key = pendingScreenKey("s1", "call-1");
    expect(useAiPendingScreenStore.getState().drafts[key].screens).toHaveLength(2);
  });

  it("upserting an empty screen list removes the draft instead of storing an empty entry", () => {
    const store = useAiPendingScreenStore.getState();
    store.upsert(draft());
    store.upsert(draft({ screens: [] }));
    const key = pendingScreenKey("s1", "call-1");
    expect(useAiPendingScreenStore.getState().drafts[key]).toBeUndefined();
  });

  it("does not revive a finalized call", () => {
    const store = useAiPendingScreenStore.getState();
    const key = pendingScreenKey("s1", "call-1");
    store.upsert(draft());
    store.finalizeCall(key);
    store.upsert(draft({ screens: [{ name: "Late", x: 0, y: 0, width: 10, height: 10 }] }));
    expect(useAiPendingScreenStore.getState().drafts[key]).toBeUndefined();
  });

  it("finalizing removes the draft and remembers the key", () => {
    const store = useAiPendingScreenStore.getState();
    const key = pendingScreenKey("s1", "call-1");
    store.upsert(draft());
    store.finalizeCall(key);
    expect(useAiPendingScreenStore.getState().drafts[key]).toBeUndefined();
    expect(useAiPendingScreenStore.getState().finalizedKeys.has(key)).toBe(true);
  });

  it("clears only the requested session", () => {
    const store = useAiPendingScreenStore.getState();
    store.upsert(draft());
    store.upsert(draft({ sessionId: "s2", toolCallId: "call-2" }));
    store.clearSession("s1");
    const { drafts } = useAiPendingScreenStore.getState();
    expect(drafts[pendingScreenKey("s1", "call-1")]).toBeUndefined();
    expect(drafts[pendingScreenKey("s2", "call-2")]).toBeDefined();
  });

  it("clearSession finalizes the keys it clears, so a late frame cannot revive them", () => {
    const store = useAiPendingScreenStore.getState();
    const key = pendingScreenKey("s1", "call-1");
    store.upsert(draft());
    store.clearSession("s1");

    expect(useAiPendingScreenStore.getState().finalizedKeys.has(key)).toBe(true);

    store.upsert(draft({ screens: [{ name: "Late", x: 0, y: 0, width: 10, height: 10 }] }));
    expect(useAiPendingScreenStore.getState().drafts[key]).toBeUndefined();
  });
});
