import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AiVectorPreviewDraft,
  useAiVectorPreviewStore,
  vectorPreviewKey,
} from "@/store/aiVectorPreviewStore";

function makeDraft(
  sessionId = "session-a",
  toolCallId = "call-1",
  overrides: Partial<AiVectorPreviewDraft> = {},
): AiVectorPreviewDraft {
  return {
    sessionId,
    toolCallId,
    name: "AI vector",
    commandText: "M(10, 20)\nC(15, 20, 25, 30, 30, 40)\n",
    phase: "streaming",
    receivedDuringStreaming: true,
    points: [
      { x: 10, y: 20, handleOut: { x: 15, y: 20 } },
      { x: 30, y: 40, handleIn: { x: 25, y: 30 } },
    ],
    geometry: "M 10 20 C 15 20 25 30 30 40",
    bounds: { x: 10, y: 20, width: 20, height: 20 },
    closed: false,
    stroke: { color: "#123456", width: 2 },
    ended: false,
    ...overrides,
  };
}

describe("aiVectorPreviewStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAiVectorPreviewStore.getState().reset();
  });

  afterEach(() => {
    useAiVectorPreviewStore.getState().reset();
    localStorage.clear();
  });

  it("isolates drafts by session and tool call", () => {
    const store = useAiVectorPreviewStore.getState();
    store.upsert(makeDraft("session-a", "call-1"));
    store.upsert(makeDraft("session-b", "call-1"));
    store.upsert(makeDraft("session-a", "call-2"));

    const { drafts } = useAiVectorPreviewStore.getState();
    expect(Object.keys(drafts)).toHaveLength(3);
    expect(drafts[vectorPreviewKey("session-a", "call-1")]).toMatchObject({
      sessionId: "session-a",
      toolCallId: "call-1",
    });
    expect(drafts[vectorPreviewKey("session-b", "call-1")]).toMatchObject({
      sessionId: "session-b",
      toolCallId: "call-1",
    });
    expect(vectorPreviewKey("session-a", "call-1")).toBe("session-a:call-1");
  });

  it("owns cloned points, handles, bounds, and stroke", () => {
    const input = makeDraft();
    useAiVectorPreviewStore.getState().upsert(input);
    const key = vectorPreviewKey(input.sessionId, input.toolCallId);
    const stored = useAiVectorPreviewStore.getState().drafts[key];

    expect(stored).not.toBe(input);
    expect(stored.points).not.toBe(input.points);
    expect(stored.points[0]).not.toBe(input.points[0]);
    expect(stored.points[0].handleOut).not.toBe(input.points[0].handleOut);
    expect(stored.points[1].handleIn).not.toBe(input.points[1].handleIn);
    expect(stored.bounds).not.toBe(input.bounds);
    expect(stored.stroke).not.toBe(input.stroke);

    input.points[0].x = 999;
    input.points[0].handleOut!.x = 999;
    input.points[1].handleIn!.y = 999;
    input.bounds.width = 999;
    input.stroke!.width = 99;

    expect(stored.points[0].x).toBe(10);
    expect(stored.points[0].handleOut!.x).toBe(15);
    expect(stored.points[1].handleIn!.y).toBe(30);
    expect(stored.bounds.width).toBe(20);
    expect(stored.stroke!.width).toBe(2);
  });

  it("preserves the stored draft object for a semantically identical upsert", () => {
    const key = vectorPreviewKey("session-a", "call-1");
    useAiVectorPreviewStore.getState().upsert(makeDraft());
    const first = useAiVectorPreviewStore.getState().drafts[key];

    useAiVectorPreviewStore.getState().upsert(makeDraft());

    expect(useAiVectorPreviewStore.getState().drafts[key]).toBe(first);
  });

  it("tracks replaying, failed, and committing phases without changing other fields", () => {
    const key = vectorPreviewKey("session-a", "call-1");
    const replaying = makeDraft("session-a", "call-1", {
      phase: "replaying",
      receivedDuringStreaming: false,
    });
    useAiVectorPreviewStore.getState().upsert(replaying);
    expect(useAiVectorPreviewStore.getState().drafts[key].phase).toBe("replaying");

    useAiVectorPreviewStore.getState().upsert({ ...replaying, phase: "failed" });
    const failed = useAiVectorPreviewStore.getState().drafts[key];
    expect(failed.phase).toBe("failed");

    useAiVectorPreviewStore.getState().markCommitting(key);
    const committing = useAiVectorPreviewStore.getState().drafts[key];
    expect(committing).toEqual({ ...failed, phase: "committing" });
  });

  it("markCommitting is a no-op for absent and finalized keys", () => {
    const absentKey = vectorPreviewKey("session-a", "absent");
    const stateBeforeAbsent = useAiVectorPreviewStore.getState();
    stateBeforeAbsent.markCommitting(absentKey);
    expect(useAiVectorPreviewStore.getState()).toBe(stateBeforeAbsent);

    const finalizedKey = vectorPreviewKey("session-a", "call-1");
    useAiVectorPreviewStore.getState().finalizeCall(finalizedKey);
    const stateBeforeFinalized = useAiVectorPreviewStore.getState();
    stateBeforeFinalized.markCommitting(finalizedKey);
    expect(useAiVectorPreviewStore.getState()).toBe(stateBeforeFinalized);
  });

  it("clearDraft removes only the draft and permits a later upsert", () => {
    const firstKey = vectorPreviewKey("session-a", "call-1");
    const secondKey = vectorPreviewKey("session-a", "call-2");
    const store = useAiVectorPreviewStore.getState();
    store.upsert(makeDraft("session-a", "call-1"));
    store.upsert(makeDraft("session-a", "call-2"));

    store.clearDraft(firstKey);
    expect(useAiVectorPreviewStore.getState().drafts[firstKey]).toBeUndefined();
    expect(useAiVectorPreviewStore.getState().drafts[secondKey]).toBeDefined();
    expect(useAiVectorPreviewStore.getState().finalizedKeys.has(firstKey)).toBe(false);

    store.upsert(makeDraft("session-a", "call-1"));
    expect(useAiVectorPreviewStore.getState().drafts[firstKey]).toBeDefined();
  });

  it("clearSession removes that session's drafts and finalized keys only", () => {
    const sessionDraft = vectorPreviewKey("session-a", "draft");
    const sessionFinalized = vectorPreviewKey("session-a", "finalized");
    const otherDraft = vectorPreviewKey("session-ab", "draft");
    const otherFinalized = vectorPreviewKey("session-ab", "finalized");
    const store = useAiVectorPreviewStore.getState();
    store.upsert(makeDraft("session-a", "draft"));
    store.upsert(makeDraft("session-a", "finalized"));
    store.finalizeCall(sessionFinalized);
    store.upsert(makeDraft("session-ab", "draft"));
    store.upsert(makeDraft("session-ab", "finalized"));
    store.finalizeCall(otherFinalized);

    store.clearSession("session-a");
    const state = useAiVectorPreviewStore.getState();
    expect(state.drafts[sessionDraft]).toBeUndefined();
    expect(state.finalizedKeys.has(sessionFinalized)).toBe(false);
    expect(state.drafts[otherDraft]).toBeDefined();
    expect(state.finalizedKeys.has(otherFinalized)).toBe(true);

    state.upsert(makeDraft("session-a", "finalized"));
    expect(useAiVectorPreviewStore.getState().drafts[sessionFinalized]).toBeDefined();
  });

  it("finalizeCall atomically removes a draft and prevents resurrection", () => {
    const key = vectorPreviewKey("session-a", "call-1");
    const store = useAiVectorPreviewStore.getState();
    store.upsert(makeDraft("session-a", "call-1"));

    store.finalizeCall(key);
    const finalizedState = useAiVectorPreviewStore.getState();
    expect(finalizedState.drafts[key]).toBeUndefined();
    expect(finalizedState.finalizedKeys.has(key)).toBe(true);

    finalizedState.upsert(makeDraft("session-a", "call-1", { phase: "replaying" }));
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeUndefined();
    expect(useAiVectorPreviewStore.getState().finalizedKeys.has(key)).toBe(true);
  });

  it("reset clears every draft and finalized key", () => {
    const finalizedKey = vectorPreviewKey("session-a", "call-1");
    const store = useAiVectorPreviewStore.getState();
    store.upsert(makeDraft("session-a", "call-1"));
    store.finalizeCall(finalizedKey);
    store.upsert(makeDraft("session-b", "call-2"));

    store.reset();

    const state = useAiVectorPreviewStore.getState();
    expect(state.drafts).toEqual({});
    expect(state.finalizedKeys.size).toBe(0);
  });

  it("does not persist preview data to localStorage", () => {
    const store = useAiVectorPreviewStore.getState();
    store.upsert(makeDraft());
    store.finalizeCall(vectorPreviewKey("session-b", "call-2"));

    expect(localStorage.length).toBe(0);
  });
});
