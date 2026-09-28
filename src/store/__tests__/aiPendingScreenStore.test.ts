import { beforeEach, describe, expect, it } from "vitest";
import {
  pendingScreenKey,
  useAiPendingScreenStore,
  pendingHtmlKey,
  type AiPendingScreenInput,
} from "@/store/aiPendingScreenStore";

function draft(overrides: Partial<AiPendingScreenInput> = {}): AiPendingScreenInput {
  return {
    sessionId: "s1",
    toolCallId: "call-1",
    screens: [{ index: 0, start: 0, htmlComplete: false, name: "Login", x: 0, y: 0, width: 390, height: 844, html: "" }],
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
    // Subscribers re-run off store changes; an identical frame must not
    // trigger one.
    expect(useAiPendingScreenStore.getState().drafts).toBe(first);
  });

  it("html-only frames keep `drafts` identity and update the separate html slot", () => {
    const store = useAiPendingScreenStore.getState();
    store.upsert(draft());
    const first = useAiPendingScreenStore.getState().drafts;
    const key = pendingScreenKey("s1", "call-1");
    const geo = { index: 0, start: 0, htmlComplete: false, name: "Login", x: 0, y: 0, width: 390, height: 844 };
    store.upsert(draft({ screens: [{ ...geo, html: "<p>hi" }] }));
    const s1 = useAiPendingScreenStore.getState();
    expect(s1.drafts).toBe(first);
    expect(s1.html[pendingHtmlKey(key, 0)]).toBe("<p>hi");
    expect(s1.drafts[key].screens[0]).not.toHaveProperty("html");

    // Identical html again: nothing changes at all.
    store.upsert(draft({ screens: [{ ...geo, html: "<p>hi" }] }));
    expect(useAiPendingScreenStore.getState().html).toBe(s1.html);
  });

  it("geometry change replaces drafts", () => {
    const store = useAiPendingScreenStore.getState();
    store.upsert(draft());
    const first = useAiPendingScreenStore.getState().drafts;
    store.upsert(draft({ screens: [{ index: 0, start: 0, htmlComplete: false, name: "Login", x: 5, y: 0, width: 390, height: 844, html: "" }] }));
    expect(useAiPendingScreenStore.getState().drafts).not.toBe(first);
  });

  it("clearDraft, clearSession, finalizeCall and reset drop matching html", () => {
    const store = useAiPendingScreenStore.getState();
    const withHtml = (sessionId: string, toolCallId: string) =>
      draft({
        sessionId,
        toolCallId,
        screens: [{ index: 0, start: 0, htmlComplete: false, name: "A", x: 0, y: 0, width: 1, height: 1, html: "<i>" }],
      });
    store.upsert(withHtml("s1", "c1"));
    store.upsert(withHtml("s1", "c2"));
    store.upsert(withHtml("s2", "c3"));
    const k = (s: string, c: string) => pendingHtmlKey(pendingScreenKey(s, c), 0);
    store.clearDraft(pendingScreenKey("s1", "c1"));
    expect(Object.keys(useAiPendingScreenStore.getState().html).sort()).toEqual([k("s1", "c2"), k("s2", "c3")]);
    store.finalizeCall(pendingScreenKey("s1", "c2"));
    expect(Object.keys(useAiPendingScreenStore.getState().html)).toEqual([k("s2", "c3")]);
    store.clearSession("s2");
    expect(useAiPendingScreenStore.getState().html).toEqual({});
    store.upsert(withHtml("s9", "c9"));
    store.reset();
    expect(useAiPendingScreenStore.getState().html).toEqual({});
  });

  it("replaces the draft when a new screen's header becomes available", () => {
    const store = useAiPendingScreenStore.getState();
    store.upsert(draft());
    store.upsert(
      draft({
        screens: [
          { index: 0, start: 0, htmlComplete: false, name: "Login", x: 0, y: 0, width: 390, height: 844, html: "" },
          { index: 1, start: 0, htmlComplete: false, name: "Feed", x: 440, y: 0, width: 390, height: 844, html: "" },
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
    store.upsert(draft({ screens: [{ index: 0, start: 0, htmlComplete: false, name: "Late", x: 0, y: 0, width: 10, height: 10, html: "" }] }));
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

    store.upsert(draft({ screens: [{ index: 0, start: 0, htmlComplete: false, name: "Late", x: 0, y: 0, width: 10, height: 10, html: "" }] }));
    expect(useAiPendingScreenStore.getState().drafts[key]).toBeUndefined();
  });
});
