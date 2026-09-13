/**
 * Streaming tool adapters — progressive ("brush by brush") application of AI
 * tool calls while their input is still streaming.
 *
 * AI SDK v6 exposes a tool UI part with `state: "input-streaming"` and a
 * partial-JSON-parsed `input` for every delta it receives. An adapter turns
 * those frames into something visible: a transient Pixi preview
 * (`draw_vector`) or a real, rollback-able scene mutation (`batch_design`,
 * `edit_embed_html`).
 *
 * Design: docs/superpowers/specs/2026-09-13-streaming-tool-mutations-design.md
 */

export interface StreamingToolFrame {
  sessionId: string;
  toolCallId: string;
  /** Partial-JSON-parsed tool input as of this delta. Fields may be missing or truncated. */
  input: Record<string, unknown>;
}

export interface StreamingToolCallRef {
  sessionId: string;
  toolCallId: string;
}

export interface StreamingToolAdapter {
  /** Tool name exactly as it appears in `toolRegistry.ts` / backend `penTools`. */
  readonly toolName: string;
  /** One frame of partial input. Must be cheap, idempotent and never throw. */
  onFrame(frame: StreamingToolFrame): void;
  /**
   * The call will never complete (abort, chat error, unmount, or a completed
   * handler taking over). Drop the preview / roll the mutation back and
   * finalize the key so a late frame cannot resurrect it.
   */
  onAbandon(ref: StreamingToolCallRef): void;
  /** Drop everything belonging to a chat session. */
  onSessionClear(sessionId: string): void;
}

/**
 * Kill switch for progressive application of *real* mutations
 * (`batch_design`, `edit_embed_html`). Transient previews (`draw_vector`) are
 * not gated by it — they cannot leave anything behind.
 *
 * `localStorage.pen.streamingMutations = "off"` disables them.
 */
export function isStreamingMutationsEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem("pen.streamingMutations") !== "off";
  } catch {
    // Private mode / blocked storage: the feature stays on.
    return true;
  }
}
