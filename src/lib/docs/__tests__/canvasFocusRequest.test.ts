import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: vi.fn() }));

import { toast } from "sonner";
import { stubBroadcastChannel } from "@/test/fakeBroadcastChannel";
import { CANVAS_FOCUS_ACK_TIMEOUT_MS, CANVAS_FOCUS_CHANNEL, NO_CANVAS_MESSAGE, requestCanvasFocus } from "../canvasFocusRequest";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  stubBroadcastChannel();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("requestCanvasFocus", () => {
  it("toasts when no canvas answers within the timeout", () => {
    requestCanvasFocus("n1");
    vi.advanceTimersByTime(CANVAS_FOCUS_ACK_TIMEOUT_MS - 1);
    expect(toast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(toast).toHaveBeenCalledWith(NO_CANVAS_MESSAGE);
  });

  it("stays silent after the first ack (later acks are ignored)", () => {
    const canvas = new BroadcastChannel(CANVAS_FOCUS_CHANNEL);
    canvas.onmessage = (event) => {
      const { requestId } = event.data as { requestId: string };
      canvas.postMessage({ type: "focus-node-ack", requestId });
      canvas.postMessage({ type: "focus-node-ack", requestId });
    };
    requestCanvasFocus("n1");
    vi.advanceTimersByTime(CANVAS_FOCUS_ACK_TIMEOUT_MS * 2);
    expect(toast).not.toHaveBeenCalled();
  });

  it("toasts when BroadcastChannel is missing", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    requestCanvasFocus("n1");
    expect(toast).toHaveBeenCalledWith(NO_CANVAS_MESSAGE);
  });
});
