import { create } from "zustand";
import type { PendingScreenHeader } from "@/lib/streamingTools/pendingScreenHeaders";
import { clearDraftReducer, clearSessionReducer, finalizeCallReducer } from "./keyedDraftLifecycle";

/**
 * Transient dashed-placeholder state for `batch_design` screens whose
 * position/size header has streamed in but whose (much larger)
 * `htmlContent` has not landed yet — see `pendingScreenHeaders.ts` for why
 * the header alone is enough to place a box, and
 * `batchDesignAdapter.ts`'s `onFrame` for which headers get shown once
 * progressive application has already turned some of them into real nodes.
 *
 * Mirrors `aiSvgPreviewStore`'s shape and invariants: one draft per
 * `${sessionId}:${toolCallId}`, and a finalized key can never be revived
 * (see `finalizeCall`'s note there, copied below).
 */
export interface AiPendingScreenDraft {
  sessionId: string;
  toolCallId: string;
  /** Headers not yet backed by a real node, in source order. */
  screens: PendingScreenHeader[];
}

interface AiPendingScreenState {
  drafts: Record<string, AiPendingScreenDraft>;
  finalizedKeys: ReadonlySet<string>;
  upsert: (draft: AiPendingScreenDraft) => void;
  clearDraft: (key: string) => void;
  clearSession: (sessionId: string) => void;
  finalizeCall: (key: string) => void;
  reset: () => void;
}

export function pendingScreenKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

function screensEqual(a: PendingScreenHeader[], b: PendingScreenHeader[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((screen, i) => {
    const other = b[i];
    return (
      screen.name === other.name &&
      screen.x === other.x &&
      screen.y === other.y &&
      screen.width === other.width &&
      screen.height === other.height
    );
  });
}

export const useAiPendingScreenStore = create<AiPendingScreenState>((set) => ({
  drafts: {},
  finalizedKeys: new Set<string>(),

  upsert: (draft) =>
    set((state) => {
      const key = pendingScreenKey(draft.sessionId, draft.toolCallId);
      // A finalized call must never be revived — see aiSvgPreviewStore's
      // `upsert` for the exact race this guards against (a late frame
      // arriving after the tool call has already resolved).
      if (state.finalizedKeys.has(key)) return state;
      const existing = state.drafts[key];
      // Identity-stable no-op: the layer re-renders off store changes, so an
      // unchanged screen list (the common case — most frames advance
      // htmlContent, not the header) must not trigger one.
      if (existing && screensEqual(existing.screens, draft.screens)) return state;
      if (draft.screens.length === 0) {
        if (!existing) return state;
        const next = { ...state.drafts };
        delete next[key];
        return { drafts: next };
      }
      return { drafts: { ...state.drafts, [key]: { ...draft, screens: draft.screens } } };
    }),

  clearDraft: (key) => set((state) => clearDraftReducer(state, key)),

  clearSession: (sessionId) => set((state) => clearSessionReducer(state, sessionId)),

  finalizeCall: (key) => set((state) => finalizeCallReducer(state, key)),

  reset: () => set({ drafts: {}, finalizedKeys: new Set<string>() }),
}));
