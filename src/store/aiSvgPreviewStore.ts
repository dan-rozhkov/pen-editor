import { create } from "zustand";

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
  /** A well-formed SVG document covering every element that has arrived. */
  svg: string;
  /** Grows as elements finish; the layer redraws only when it changes. */
  completeElements: number;
  /** Where the artwork sits on the canvas, in scene coordinates. */
  bounds: { x: number; y: number; width: number; height: number };
  phase: "streaming" | "committing";
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

  clearDraft: (key) =>
    set((state) => {
      if (!(key in state.drafts)) return state;
      const next = { ...state.drafts };
      delete next[key];
      return { drafts: next };
    }),

  clearSession: (sessionId) =>
    set((state) => {
      const prefix = `${sessionId}:`;
      const keys = Object.keys(state.drafts).filter((key) => key.startsWith(prefix));
      if (keys.length === 0) return state;
      const next = { ...state.drafts };
      // Must also finalize, matching `finalizeCall`'s invariant ("a
      // finalized call must never be revived"): a call that never rendered
      // an `input-streaming` tool part (so it's absent from
      // `seenStreamingCallsRef`) reaches cleanup only through this method,
      // never through `onAbandon`'s `finalizeCall`. Deleting without
      // finalizing left its key open, so a `generate_vector` frame still in
      // flight from the abandoned generation could `upsert` a fresh draft
      // right back in — repainting a preview nothing would ever clear again
      // until the ~90s generation itself finished.
      const finalizedKeys = new Set(state.finalizedKeys);
      for (const key of keys) {
        delete next[key];
        finalizedKeys.add(key);
      }
      return { drafts: next, finalizedKeys };
    }),

  finalizeCall: (key) =>
    set((state) => {
      const finalizedKeys = new Set(state.finalizedKeys);
      finalizedKeys.add(key);
      if (!(key in state.drafts)) return { finalizedKeys };
      const next = { ...state.drafts };
      delete next[key];
      return { drafts: next, finalizedKeys };
    }),

  reset: () => set({ drafts: {}, finalizedKeys: new Set<string>() }),
}));
