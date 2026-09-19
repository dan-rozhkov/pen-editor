import { beforeEach, describe, expect, it } from "vitest";
import { generateVectorStreamingAdapter } from "../generateVectorAdapter";
import { streamingToolAdapters, getStreamingToolAdapter } from "../index";
import { useAiSvgPreviewStore, svgPreviewKey } from "@/store/aiSvgPreviewStore";

function stage(sessionId: string, toolCallId: string): void {
  useAiSvgPreviewStore.getState().upsert({
    sessionId,
    toolCallId,
    svg: '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    completeElements: 1,
    bounds: { x: 0, y: 0, width: 80, height: 80 },
    phase: "streaming",
  });
}

beforeEach(() => {
  useAiSvgPreviewStore.getState().reset();
});

describe("generate_vector streaming adapter", () => {
  it("is registered so useDesignChat's terminal paths reach it", () => {
    expect(streamingToolAdapters).toContain(generateVectorStreamingAdapter);
    expect(getStreamingToolAdapter("generate_vector")).toBe(generateVectorStreamingAdapter);
  });

  it("draws nothing from streamed input", () => {
    generateVectorStreamingAdapter.onFrame({
      sessionId: "s1",
      toolCallId: "call-1",
      input: { prompt: "a fox" },
    });
    expect(useAiSvgPreviewStore.getState().drafts).toEqual({});
  });

  it("drops an abandoned call's preview and keeps it dropped", () => {
    stage("s1", "call-1");
    generateVectorStreamingAdapter.onAbandon({ sessionId: "s1", toolCallId: "call-1" });
    expect(useAiSvgPreviewStore.getState().drafts).toEqual({});

    // A frame still in flight from the stopped generation must not repaint it.
    stage("s1", "call-1");
    expect(useAiSvgPreviewStore.getState().drafts).toEqual({});
  });

  it("clears only the ended session", () => {
    stage("s1", "call-1");
    stage("s2", "call-2");
    generateVectorStreamingAdapter.onSessionClear("s1");
    const { drafts } = useAiSvgPreviewStore.getState();
    expect(drafts[svgPreviewKey("s1", "call-1")]).toBeUndefined();
    expect(drafts[svgPreviewKey("s2", "call-2")]).toBeDefined();
  });
});
