import { beforeEach, describe, expect, it } from "vitest";
import {
  svgPreviewKey,
  useAiSvgPreviewStore,
  type AiSvgPreviewDraft,
} from "@/store/aiSvgPreviewStore";

function draft(overrides: Partial<AiSvgPreviewDraft> = {}): AiSvgPreviewDraft {
  return {
    sessionId: "s1",
    toolCallId: "call-1",
    svg: '<svg viewBox="0 0 10 10"><rect width="4" height="4"/></svg>',
    completeElements: 1,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    phase: "streaming",
    ...overrides,
  };
}

beforeEach(() => {
  useAiSvgPreviewStore.getState().reset();
});

describe("aiSvgPreviewStore", () => {
  it("stores a draft under its session/call key", () => {
    useAiSvgPreviewStore.getState().upsert(draft());
    const key = svgPreviewKey("s1", "call-1");
    expect(useAiSvgPreviewStore.getState().drafts[key].completeElements).toBe(1);
  });

  it("keeps the same object identity when nothing changed", () => {
    const store = useAiSvgPreviewStore.getState();
    store.upsert(draft());
    const first = useAiSvgPreviewStore.getState().drafts;
    store.upsert(draft());
    // The layer re-renders off store changes; an identical frame must not
    // trigger a rasterization.
    expect(useAiSvgPreviewStore.getState().drafts).toBe(first);
  });

  it("replaces the draft when a new element arrives", () => {
    const store = useAiSvgPreviewStore.getState();
    store.upsert(draft());
    store.upsert(draft({ svg: "<svg/>", completeElements: 2 }));
    const key = svgPreviewKey("s1", "call-1");
    expect(useAiSvgPreviewStore.getState().drafts[key].completeElements).toBe(2);
  });

  it("does not revive a finalized call", () => {
    const store = useAiSvgPreviewStore.getState();
    const key = svgPreviewKey("s1", "call-1");
    store.upsert(draft());
    store.finalizeCall(key);
    store.upsert(draft({ completeElements: 9 }));
    // A frame arriving after commit would otherwise stage a preview that
    // nothing is left to clear, leaving it drawn forever.
    expect(useAiSvgPreviewStore.getState().drafts[key]).toBeUndefined();
  });

  it("finalizing removes the draft and remembers the key", () => {
    const store = useAiSvgPreviewStore.getState();
    const key = svgPreviewKey("s1", "call-1");
    store.upsert(draft());
    store.finalizeCall(key);
    expect(useAiSvgPreviewStore.getState().drafts[key]).toBeUndefined();
    expect(useAiSvgPreviewStore.getState().finalizedKeys.has(key)).toBe(true);
  });

  it("marks a draft committing without dropping it", () => {
    const store = useAiSvgPreviewStore.getState();
    const key = svgPreviewKey("s1", "call-1");
    store.upsert(draft());
    store.markCommitting(key);
    expect(useAiSvgPreviewStore.getState().drafts[key].phase).toBe("committing");
  });

  it("clears only the requested session", () => {
    const store = useAiSvgPreviewStore.getState();
    store.upsert(draft());
    store.upsert(draft({ sessionId: "s2", toolCallId: "call-2" }));
    store.clearSession("s1");
    const { drafts } = useAiSvgPreviewStore.getState();
    expect(drafts[svgPreviewKey("s1", "call-1")]).toBeUndefined();
    expect(drafts[svgPreviewKey("s2", "call-2")]).toBeDefined();
  });

  it("clearSession is a no-op when the session has no drafts", () => {
    const store = useAiSvgPreviewStore.getState();
    store.upsert(draft());
    const before = useAiSvgPreviewStore.getState().drafts;
    store.clearSession("nope");
    expect(useAiSvgPreviewStore.getState().drafts).toBe(before);
  });

  // Finding 8: clearSession must also finalize the keys it clears, matching
  // the invariant `upsert`'s own comment states ("a finalized call must
  // never be revived"). Without this, a call whose tool part never rendered
  // with state:"input-streaming" (so it's absent from
  // seenStreamingCallsRef and cleanup only ever goes through clearSession,
  // never finalizeCall) could have a late in-flight frame `upsert` a fresh
  // draft right back in after the session was "cleared", repainting a
  // preview nothing is left to clear until the ~90s generation itself ends.
  it("clearSession finalizes the keys it clears, so a late frame cannot revive them", () => {
    const store = useAiSvgPreviewStore.getState();
    const key = svgPreviewKey("s1", "call-1");
    store.upsert(draft());
    store.clearSession("s1");

    expect(useAiSvgPreviewStore.getState().finalizedKeys.has(key)).toBe(true);

    // A frame from the abandoned generation, still in flight, arrives after
    // the session was cleared.
    store.upsert(draft({ completeElements: 9 }));
    expect(useAiSvgPreviewStore.getState().drafts[key]).toBeUndefined();
  });
});
