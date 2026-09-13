/**
 * `draw_vector`'s `StreamingToolAdapter` — a transient Pixi preview, not a
 * real scene mutation. Moved here unchanged from `useDesignChat.ts`'s
 * previous vector-only wiring: same preview controller call, same
 * abandon/session-clear behavior, just behind the generic adapter interface
 * so `useDesignChat` no longer needs a `draw_vector`-specific effect.
 *
 * Not gated by `isStreamingMutationsEnabled()` — see that function's doc
 * comment in `./types.ts`.
 */
import type {
  StreamingToolAdapter,
  StreamingToolCallRef,
  StreamingToolFrame,
} from "@/lib/streamingTools/types";
import { upsertStreamingVectorPreview } from "@/lib/tools/drawVector/previewController";
import {
  useAiVectorPreviewStore,
  vectorPreviewKey,
} from "@/store/aiVectorPreviewStore";

function coerceCommands(input: Record<string, unknown>): string | undefined {
  return typeof input.commands === "string" ? input.commands : undefined;
}

function coerceName(input: Record<string, unknown>): string {
  return typeof input.name === "string" ? input.name : "Vector";
}

export const vectorStreamingToolAdapter: StreamingToolAdapter = {
  toolName: "draw_vector",

  onFrame(frame: StreamingToolFrame) {
    const commands = coerceCommands(frame.input);
    // Missing/non-string `commands` almost always just means the model
    // hasn't streamed that field yet — upsertStreamingVectorPreview already
    // tolerates a parse failure the same way; there is nothing to draw yet.
    if (commands === undefined) return;

    upsertStreamingVectorPreview({
      sessionId: frame.sessionId,
      toolCallId: frame.toolCallId,
      name: coerceName(frame.input),
      commands,
    });
  },

  onAbandon(ref: StreamingToolCallRef) {
    // The `onSessionClear` call that follows this on every terminal path
    // (abort/error/unmount) already wipes every draft and finalizedKey for
    // the whole session, including this one — this per-call drop is a
    // defensive no-op in that common case, and keeps the adapter correct on
    // its own if it is ever invoked without a following session clear.
    useAiVectorPreviewStore
      .getState()
      .clearDraft(vectorPreviewKey(ref.sessionId, ref.toolCallId));
  },

  onSessionClear(sessionId: string) {
    useAiVectorPreviewStore.getState().clearSession(sessionId);
  },
};
