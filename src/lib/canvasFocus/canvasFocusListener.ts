import { goToNode } from "@/lib/componentPanelActions";
import { CANVAS_FOCUS_CHANNEL, isCanvasFocusMessage, type CanvasFocusMessage } from "@/lib/docs/canvasFocusRequest";

/** Selects `nodeId` on whichever page holds it and fits the viewport. False when this document does not have the node. */
export function focusCanvasNode(nodeId: string): boolean {
  return goToNode(nodeId);
}

/**
 * Canvas side of a /doc link to a frame: answers "focus-node" on the shared channel when this
 * tab holds the node. Returns the cleanup. Never throws (no BroadcastChannel = no listener).
 */
export function startCanvasFocusListener(): () => void {
  try {
    if (typeof BroadcastChannel === "undefined") return () => {};
    const channel = new BroadcastChannel(CANVAS_FOCUS_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      try {
        const message = event.data;
        if (!isCanvasFocusMessage(message) || message.type !== "focus-node") return;
        if (!focusCanvasNode(message.nodeId)) return;
        channel.postMessage({ type: "focus-node-ack", requestId: message.requestId } satisfies CanvasFocusMessage);
      } catch {
        // a malformed message must not take the listener down
      }
    };
    return () => {
      channel.onmessage = null;
      channel.close();
    };
  } catch {
    return () => {};
  }
}
