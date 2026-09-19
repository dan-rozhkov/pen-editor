import { create } from "zustand";
import { clearDraftReducer, clearSessionReducer, finalizeCallReducer } from "./keyedDraftLifecycle";

/**
 * Transient previews for `generate_vector`, one per in-flight tool call.
 *
 * Deliberately separate from `aiVectorPreviewStore`, which backs `draw_vector`:
 * that store holds a single `ParsedVectorDraft` — one shape, one fill, one
 * anchor list — whereas a QuiverAI illustration is dozens of independently
 * painted paths plus gradient definitions. Widening the older store to carry
 * both would complicate the shape `draw_vector`'s preview layer depends on.
 *
 * Nothing here is scene state: previews are drawn from a rasterized SVG and are
 * discarded when the call finalizes. The committed nodes come from the final
 * document alone, so a generation is one history entry.
 */
export interface AiSvgPreviewDraft {
  sessionId: string;
  toolCallId: string;
  /**
   * A well-formed SVG document covering every element that has arrived, or an
   * empty string while `phase` is "waiting" and nothing has been drawn yet.
   */
  svg: string;
  /** Grows as elements finish; the layer redraws only when it changes. */
  completeElements: number;
  /** Where the artwork sits on the canvas, in scene coordinates. */
  bounds: { x: number; y: number; width: number; height: number };
  /**
   * "waiting" covers the dead time before the model emits anything — for
   * arrow-2 that is ~18 seconds of total silence (no keepalive, no reasoning
   * event), during which the canvas would otherwise sit empty with no hint
   * that anything is coming or where it will land.
   */
  phase: "waiting" | "streaming" | "committing";
}

interface AiSvgPreviewState {
  drafts: Record<string, AiSvgPreviewDraft>;
  finalizedKeys: ReadonlySet<string>;
  upsert: (draft: AiSvgPreviewDraft) => void;
  markCommitting: (key: string) => void;
  clearDraft: (key: string) => void;
  clearSession: (sessionId: string) => void;
  finalizeCall: (key: string) => void;
  reset: () => void;
}

export function svgPreviewKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

function boundsEqual(
  a: AiSvgPreviewDraft["bounds"],
  b: AiSvgPreviewDraft["bounds"],
): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function draftsEqual(a: AiSvgPreviewDraft, b: AiSvgPreviewDraft): boolean {
  return (
    a.svg === b.svg &&
    a.completeElements === b.completeElements &&
    a.phase === b.phase &&
    boundsEqual(a.bounds, b.bounds)
  );
}

export const useAiSvgPreviewStore = create<AiSvgPreviewState>((set) => ({
  drafts: {},
  finalizedKeys: new Set<string>(),

  upsert: (draft) =>
    set((state) => {
      const key = svgPreviewKey(draft.sessionId, draft.toolCallId);
      // A finalized call must never be revived. A late frame arriving after
      // commit would otherwise re-stage a preview that nothing will clear.
      if (state.finalizedKeys.has(key)) return state;
      const existing = state.drafts[key];
      if (existing && draftsEqual(existing, draft)) return state;
      return { drafts: { ...state.drafts, [key]: { ...draft } } };
    }),

  markCommitting: (key) =>
    set((state) => {
      const existing = state.drafts[key];
      if (!existing || existing.phase === "committing") return state;
      return { drafts: { ...state.drafts, [key]: { ...existing, phase: "committing" } } };
    }),

  clearDraft: (key) => set((state) => clearDraftReducer(state, key)),

  // Must also finalize, matching `finalizeCall`'s invariant ("a finalized
  // call must never be revived"): a call that never rendered an
  // `input-streaming` tool part (so it's absent from
  // `seenStreamingCallsRef`) reaches cleanup only through this method,
  // never through `onAbandon`'s `finalizeCall`. Deleting without finalizing
  // left its key open, so a `generate_vector` frame still in flight from
  // the abandoned generation could `upsert` a fresh draft right back in —
  // repainting a preview nothing would ever clear again until the ~90s
  // generation itself finished. See `clearSessionReducer` for the shared
  // implementation this and `aiPendingScreenStore` both rely on.
  clearSession: (sessionId) => set((state) => clearSessionReducer(state, sessionId)),

  finalizeCall: (key) => set((state) => finalizeCallReducer(state, key)),

  reset: () => set({ drafts: {}, finalizedKeys: new Set<string>() }),
}));
