import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { batchDesignStreamingAdapter } from "../batchDesignAdapter";
import { streamingToolAdapters, getStreamingToolAdapter } from "../index";
import {
  useAiPendingScreenStore,
  pendingScreenKey,
} from "@/store/aiPendingScreenStore";
import { resetStores, seedScene } from "@/test/fixtures";

// Realistic two-screen fixture matching the prescribed key order from
// CLAUDE.md's batch_design system-prompt excerpt: type, name, x, y, width,
// height, then htmlContent last.
const SCREEN_1_COMPLETE =
  's1=I(document, {type: "embed", name: "Login", x: 0, y: 0, width: 390, height: 844, htmlContent: "<div style=\\"width: 100%\\">ok</div>"})\n';
const SCREEN_2_MID_HTML =
  's2=I(document, {type: "embed", name: "Feed", x: 440, y: 0, width: 390, height: 844, htmlContent: "<div class="card">still typing';

describe("batch_design streaming adapter", () => {
  let sessionId: string;
  let toolCallId: string;
  let idCounter = 0;

  beforeEach(() => {
    idCounter++;
    sessionId = `session-${idCounter}`;
    toolCallId = `call-${idCounter}`;
    resetStores();
    seedScene();
    useAiPendingScreenStore.getState().reset();
  });

  afterEach(() => {
    try {
      globalThis.localStorage?.removeItem("pen.streamingMutations");
    } catch {
      // ignore
    }
  });

  it("is registered so useDesignChat's terminal paths reach it", () => {
    expect(streamingToolAdapters).toContain(batchDesignStreamingAdapter);
    expect(getStreamingToolAdapter("batch_design")).toBe(batchDesignStreamingAdapter);
  });

  it("shows exactly one placeholder (the second, still-streaming screen) when progressive application is on", () => {
    batchDesignStreamingAdapter.onFrame({
      sessionId,
      toolCallId,
      input: { operations: SCREEN_1_COMPLETE + SCREEN_2_MID_HTML },
    });

    const key = pendingScreenKey(sessionId, toolCallId);
    const draft = useAiPendingScreenStore.getState().drafts[key];
    expect(draft?.screens).toEqual([{ name: "Feed", x: 440, y: 0, width: 390, height: 844 }]);
  });

  it("shows both placeholders when progressive application is disabled by the kill switch", () => {
    globalThis.localStorage?.setItem("pen.streamingMutations", "off");

    batchDesignStreamingAdapter.onFrame({
      sessionId,
      toolCallId,
      input: { operations: SCREEN_1_COMPLETE + SCREEN_2_MID_HTML },
    });

    const key = pendingScreenKey(sessionId, toolCallId);
    const draft = useAiPendingScreenStore.getState().drafts[key];
    expect(draft?.screens).toEqual([
      { name: "Login", x: 0, y: 0, width: 390, height: 844 },
      { name: "Feed", x: 440, y: 0, width: 390, height: 844 },
    ]);
  });

  it("clears the placeholder once the screen's own htmlContent finishes and it becomes a real node", () => {
    batchDesignStreamingAdapter.onFrame({
      sessionId,
      toolCallId,
      input: { operations: SCREEN_1_COMPLETE + SCREEN_2_MID_HTML },
    });
    const key = pendingScreenKey(sessionId, toolCallId);
    expect(useAiPendingScreenStore.getState().drafts[key]?.screens).toHaveLength(1);

    const screen2Complete =
      SCREEN_1_COMPLETE +
      's2=I(document, {type: "embed", name: "Feed", x: 440, y: 0, width: 390, height: 844, htmlContent: "<div>done</div>"})\n';
    batchDesignStreamingAdapter.onFrame({
      sessionId,
      toolCallId,
      input: { operations: screen2Complete },
    });

    // Both screens are now complete statements, so applyStreamingBatchDesign
    // has turned them into real nodes and no header remains "pending".
    expect(useAiPendingScreenStore.getState().drafts[key]).toBeUndefined();
  });

  it("stages nothing when no operations field is present in the frame", () => {
    batchDesignStreamingAdapter.onFrame({ sessionId, toolCallId, input: {} });
    const key = pendingScreenKey(sessionId, toolCallId);
    expect(useAiPendingScreenStore.getState().drafts[key]).toBeUndefined();
  });

  it("onAbandon finalizes the pending-screen key so a late frame cannot revive it", () => {
    batchDesignStreamingAdapter.onFrame({
      sessionId,
      toolCallId,
      input: { operations: SCREEN_2_MID_HTML },
    });
    const key = pendingScreenKey(sessionId, toolCallId);
    expect(useAiPendingScreenStore.getState().drafts[key]).toBeDefined();

    batchDesignStreamingAdapter.onAbandon({ sessionId, toolCallId });
    expect(useAiPendingScreenStore.getState().drafts[key]).toBeUndefined();
    expect(useAiPendingScreenStore.getState().finalizedKeys.has(key)).toBe(true);

    batchDesignStreamingAdapter.onFrame({
      sessionId,
      toolCallId,
      input: { operations: SCREEN_2_MID_HTML },
    });
    expect(useAiPendingScreenStore.getState().drafts[key]).toBeUndefined();
  });

  it("onSessionClear drops only the ended session's pending screens", () => {
    batchDesignStreamingAdapter.onFrame({
      sessionId: "s1",
      toolCallId: "call-1",
      input: { operations: SCREEN_2_MID_HTML },
    });
    batchDesignStreamingAdapter.onFrame({
      sessionId: "s2",
      toolCallId: "call-2",
      input: { operations: SCREEN_2_MID_HTML },
    });

    batchDesignStreamingAdapter.onSessionClear("s1");

    expect(useAiPendingScreenStore.getState().drafts[pendingScreenKey("s1", "call-1")]).toBeUndefined();
    expect(useAiPendingScreenStore.getState().drafts[pendingScreenKey("s2", "call-2")]).toBeDefined();
  });
});
