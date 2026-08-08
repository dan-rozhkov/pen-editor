import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  replayVectorPreview,
  upsertStreamingVectorPreview,
} from "@/lib/tools/drawVector/previewController";
import {
  useAiVectorPreviewStore,
  vectorPreviewKey,
} from "@/store/aiVectorPreviewStore";

const sessionId = "session-a";
const name = "AI vector";

function streamingInput(toolCallId: string, commands: string) {
  return { sessionId, toolCallId, name, commands };
}

function replayInput(toolCallId: string, commands: string, maxDurationMs?: number) {
  return { sessionId, toolCallId, name, commands, maxDurationMs };
}

const replayCommands = [
  "M(0, 0)",
  "L(10, 0)",
  "L(10, 10)",
  "STROKE(\"#123456\", 2)",
  "END()",
].join("\n");

describe("drawVector preview controller", () => {
  beforeEach(() => {
    vi.useRealTimers();
    useAiVectorPreviewStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    useAiVectorPreviewStore.getState().reset();
  });

  it("handles valid, incomplete, and invalid streaming snapshots", () => {
    const validKey = vectorPreviewKey(sessionId, "valid");
    upsertStreamingVectorPreview(streamingInput("valid", "M(1, 2)\n"));

    expect(useAiVectorPreviewStore.getState().drafts[validKey]).toMatchObject({
      sessionId,
      toolCallId: "valid",
      name,
      commandText: "M(1, 2)\n",
      phase: "streaming",
      receivedDuringStreaming: true,
      points: [{ x: 1, y: 2 }],
    });

    upsertStreamingVectorPreview(
      streamingInput("valid", "M(1, 2)\nL(unfinished"),
    );
    const incomplete = useAiVectorPreviewStore.getState();
    expect(incomplete.drafts[validKey]?.points).toHaveLength(1);
    expect(incomplete.finalizedKeys.has(validKey)).toBe(false);

    const incompleteOnlyKey = vectorPreviewKey(sessionId, "incomplete-only");
    upsertStreamingVectorPreview(
      streamingInput("incomplete-only", "M(unfinished"),
    );
    expect(
      useAiVectorPreviewStore.getState().drafts[incompleteOnlyKey],
    ).toBeUndefined();

    const invalidKey = vectorPreviewKey(sessionId, "invalid");
    upsertStreamingVectorPreview(streamingInput("invalid", "M(1, 2)\n"));
    upsertStreamingVectorPreview(
      streamingInput("invalid", "M(1, 2)\nNOT_A_COMMAND()\n"),
    );
    const invalid = useAiVectorPreviewStore.getState();
    expect(invalid.drafts[invalidKey]).toBeUndefined();
    expect(invalid.finalizedKeys.has(invalidKey)).toBe(true);
  });

  it("preserves draft identity for the same streaming input", () => {
    const key = vectorPreviewKey(sessionId, "same-input");
    const input = streamingInput("same-input", "M(5, 6)\n");

    upsertStreamingVectorPreview(input);
    const first = useAiVectorPreviewStore.getState().drafts[key];
    upsertStreamingVectorPreview(input);

    expect(useAiVectorPreviewStore.getState().drafts[key]).toBe(first);
    expect(first.receivedDuringStreaming).toBe(true);
  });

  it("publishes the first replay frame synchronously and later frames in order", async () => {
    vi.useFakeTimers();
    const key = vectorPreviewKey(sessionId, "ordered");

    const replay = replayVectorPreview(replayInput("ordered", replayCommands));
    const first = useAiVectorPreviewStore.getState().drafts[key];
    expect(first.points.map(({ x, y }) => [x, y])).toEqual([[0, 0]]);
    expect(first.phase).toBe("replaying");
    expect(first.receivedDuringStreaming).toBe(false);

    await vi.advanceTimersByTimeAsync(59);
    expect(useAiVectorPreviewStore.getState().drafts[key].points).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(
      useAiVectorPreviewStore.getState().drafts[key].points.map(({ x, y }) => [x, y]),
    ).toEqual([[0, 0], [10, 0]]);

    await vi.advanceTimersByTimeAsync(60);
    expect(
      useAiVectorPreviewStore.getState().drafts[key].points.map(({ x, y }) => [x, y]),
    ).toEqual([[0, 0], [10, 0], [10, 10]]);

    await vi.runAllTimersAsync();
    await replay;
    expect(useAiVectorPreviewStore.getState().drafts[key]).toMatchObject({
      phase: "replaying",
      receivedDuringStreaming: false,
      stroke: { color: "#123456", width: 2 },
    });
  });

  it("caps replay duration at 600ms", async () => {
    vi.useFakeTimers();
    const commands = [
      "M(0, 0)",
      ...Array.from({ length: 24 }, (_, index) => `L(${index + 1}, ${index + 1})`),
      "END()",
    ].join("\n");
    const startedAt = Date.now();
    let completedAt: number | undefined;

    const replay = replayVectorPreview(
      replayInput("bounded", commands, 10_000),
    ).then(() => {
      completedAt = Date.now();
    });

    await vi.advanceTimersByTimeAsync(600);
    await replay;

    expect(completedAt).toBeDefined();
    expect(completedAt! - startedAt).toBeLessThanOrEqual(600);
  });

  it("does nothing for invalid replay input", async () => {
    vi.useFakeTimers();
    const before = useAiVectorPreviewStore.getState();

    await replayVectorPreview(
      replayInput("invalid-replay", "M(0, 0)\nL(10, 10)"),
    );

    expect(useAiVectorPreviewStore.getState()).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not resurrect a call finalized during replay", async () => {
    vi.useFakeTimers();
    const key = vectorPreviewKey(sessionId, "finalized-mid-replay");

    const replay = replayVectorPreview(
      replayInput("finalized-mid-replay", replayCommands),
    );
    expect(useAiVectorPreviewStore.getState().drafts[key]).toBeDefined();

    useAiVectorPreviewStore.getState().finalizeCall(key);
    await vi.runAllTimersAsync();
    await replay;

    const state = useAiVectorPreviewStore.getState();
    expect(state.drafts[key]).toBeUndefined();
    expect(state.finalizedKeys.has(key)).toBe(true);
  });
});
