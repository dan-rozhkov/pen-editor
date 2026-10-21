import { toast } from "sonner";

// Doc side of "show this frame on the canvas". The canvas side lives in
// src/lib/canvasFocus/canvasFocusListener.ts (it imports the scene stores, which /doc must not).

export const CANVAS_FOCUS_CHANNEL = "pen.canvas-focus";
export const CANVAS_FOCUS_ACK_TIMEOUT_MS = 1500;
export const NO_CANVAS_MESSAGE = "Open the canvas that has this frame.";

export type CanvasFocusMessage =
  | { type: "focus-node"; nodeId: string; requestId: string }
  | { type: "focus-node-ack"; requestId: string };

export function isCanvasFocusMessage(value: unknown): value is CanvasFocusMessage {
  const m = value as Partial<Record<string, unknown>> | null;
  return !!m && typeof m.requestId === "string" && (m.type === "focus-node-ack" || (m.type === "focus-node" && typeof m.nodeId === "string"));
}

/** Asks every open canvas tab to select and show `nodeId`. The first ack wins; silence toasts. */
export function requestCanvasFocus(nodeId: string): void {
  try {
    if (typeof BroadcastChannel === "undefined") {
      toast(NO_CANVAS_MESSAGE);
      return;
    }
    const channel = new BroadcastChannel(CANVAS_FOCUS_CHANNEL);
    const requestId = `focus_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (timer) clearTimeout(timer);
      channel.onmessage = null;
      channel.close();
    };
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (isCanvasFocusMessage(message) && message.type === "focus-node-ack" && message.requestId === requestId) finish();
    };
    timer = setTimeout(() => {
      finish();
      toast(NO_CANVAS_MESSAGE);
    }, CANVAS_FOCUS_ACK_TIMEOUT_MS);
    channel.postMessage({ type: "focus-node", nodeId, requestId } satisfies CanvasFocusMessage);
  } catch {
    toast(NO_CANVAS_MESSAGE);
  }
}
