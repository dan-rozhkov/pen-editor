import { useAiSvgPreviewStore, svgPreviewKey } from "@/store/aiSvgPreviewStore";
import type { StreamingToolAdapter } from "@/lib/streamingTools/types";

/**
 * Cleanup-only adapter for `generate_vector`.
 *
 * Unlike every other adapter here, this one draws nothing from streamed tool
 * input: `generate_vector`'s input is just a prompt, and the picture arrives
 * later, from QuiverAI's own stream inside the handler. What the registry is
 * needed for is the other half of the contract — `useDesignChat` clears
 * per-session adapter state on every terminal path (abort, chat error,
 * unmount), and a preview owned only by the handler would otherwise stay
 * painted on the canvas until a generation the user already stopped finally
 * returns, up to ~90 seconds later.
 */
export const generateVectorStreamingAdapter: StreamingToolAdapter = {
  toolName: "generate_vector",

  onFrame() {
    // Nothing to show yet. The prompt alone is not a drawing, and partial
    // input carries no artwork.
  },

  onAbandon(ref) {
    // finalizeCall, not clearDraft: the key must stay finalized so a frame
    // still in flight from the abandoned generation cannot re-stage it.
    useAiSvgPreviewStore
      .getState()
      .finalizeCall(svgPreviewKey(ref.sessionId, ref.toolCallId));
  },

  onSessionClear(sessionId) {
    useAiSvgPreviewStore.getState().clearSession(sessionId);
  },
};
