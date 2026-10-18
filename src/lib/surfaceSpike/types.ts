// SPIKE(ipc-streaming): wire types of docs/spike-ipc-streaming-contract.md.
// Keep in sync with the desktop preload (pen-editor-desktop src/preload/tab.ts).

export type SpikeRole = "chat" | "canvas";
export type SpikeFormat = "full" | "append";

export type SpikeMsg =
  | { kind: "stream"; toolCallId: string; toolName: string; seq: number; format: "full"; input: unknown }
  | {
      kind: "stream";
      toolCallId: string;
      toolName: string;
      seq: number;
      format: "append";
      field: string;
      offset: number;
      append: string;
      rest?: Record<string, unknown>;
    }
  | { kind: "resync"; toolCallId: string }
  | { kind: "stream-end"; toolCallId: string; reason: "complete" | "abandoned" }
  | { kind: "call"; callId: string; toolName: string; input: unknown }
  | { kind: "result"; callId: string; result: string }
  | { kind: "context-request"; reqId: string }
  | { kind: "context-response"; reqId: string; canvasContext: string }
  | { kind: "error"; refId: string; error: string }
  | { kind: "peer-gone"; role: SpikeRole };

export type SpikeKind = SpikeMsg["kind"];
export type SpikeEnvelope = { id: string; sentAt: number; msg: SpikeMsg };
export type SpikeDelivered = SpikeEnvelope & { relayedAt: number };

export interface SurfaceSpikeBridge {
  setRole(role: SpikeRole | null): void;
  post(env: SpikeEnvelope): void;
  onMessage(cb: (env: SpikeDelivered) => void): () => void;
}

/** Epoch milliseconds with sub-ms precision; the clock all three hops use. */
export function spikeNow(): number {
  return performance.timeOrigin + performance.now();
}

/** Session id the canvas tab uses for adapters and handlers it drives remotely. */
export const SPIKE_REMOTE_SESSION = "spike-remote";

export function errorResult(message: string): string {
  return JSON.stringify({ error: message });
}

/**
 * The one place that says which tools the chat tab forwards to the canvas tab.
 * Everything except the browser tools (they need the tab's own desktop
 * browser), QA tools, ask_user (answered by the chat form) and analyze_image
 * (backend-executed image reading).
 */
export function isCanvasTool(toolName: string): boolean {
  if (toolName.startsWith("browse_") || toolName.startsWith("qa_")) return false;
  return toolName !== "ask_user" && toolName !== "analyze_image";
}
