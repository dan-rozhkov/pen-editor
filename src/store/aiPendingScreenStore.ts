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
 * Geometry and streamed html live in SEPARATE slots on purpose: the html
 * advances on every frame while geometry almost never does, and the Pixi
 * layer / render scheduler subscribe on `drafts` identity alone. `drafts`
 * therefore holds geometry only and keeps its identity across html-only
 * frames; the streamed html sits in `html`, keyed `${draftKey}:${index}`
 * (see `pendingHtmlKey`), read by the DOM preview layer.
 *
 * Mirrors `aiSvgPreviewStore`'s shape and invariants: one draft per
 * `${sessionId}:${toolCallId}`, and a finalized key can never be revived
 * (see `finalizeCall`'s note there, copied below).
 */
export type PendingScreenGeometry = Pick<
  PendingScreenHeader,
  "index" | "name" | "x" | "y" | "width" | "height"
>;

export interface AiPendingScreenDraft {
  sessionId: string;
  toolCallId: string;
  /** Geometry of headers not yet backed by a real node, in source order. */
  screens: PendingScreenGeometry[];
}

/** What callers hand to `upsert`: full headers, split into geometry + html by the store. */
export interface AiPendingScreenInput {
  sessionId: string;
  toolCallId: string;
  screens: PendingScreenHeader[];
}

interface AiPendingScreenState {
  drafts: Record<string, AiPendingScreenDraft>;
  /** Streamed html per screen, keyed by `pendingHtmlKey`. */
  html: Record<string, string>;
  finalizedKeys: ReadonlySet<string>;
  upsert: (draft: AiPendingScreenInput) => void;
  clearDraft: (key: string) => void;
  clearSession: (sessionId: string) => void;
  finalizeCall: (key: string) => void;
  reset: () => void;
}

export function pendingScreenKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

export function pendingHtmlKey(draftKey: string, index: number): string {
  return `${draftKey}:${index}`;
}

function geometryEqual(a: PendingScreenGeometry[], b: PendingScreenHeader[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((screen, i) => {
    const other = b[i];
    return (
      screen.index === other.index &&
      screen.name === other.name &&
      screen.x === other.x &&
      screen.y === other.y &&
      screen.width === other.width &&
      screen.height === other.height
    );
  });
}

/** `html` without every entry belonging to a draft key for which `drop` holds. */
function pruneHtml(
  html: Record<string, string>,
  drop: (htmlKey: string) => boolean,
): Record<string, string> {
  let next: Record<string, string> | null = null;
  for (const k of Object.keys(html)) {
    if (!drop(k)) continue;
    next ??= { ...html };
    delete next[k];
  }
  return next ?? html;
}

/** Fold a lifecycle reducer's result together with the matching html prune. */
function withHtmlPruned(
  state: AiPendingScreenState,
  result: Partial<AiPendingScreenState>,
  drop: (htmlKey: string) => boolean,
): Partial<AiPendingScreenState> {
  const html = pruneHtml(state.html, drop);
  return html === state.html ? result : { ...result, html };
}

export const useAiPendingScreenStore = create<AiPendingScreenState>((set) => ({
  drafts: {},
  html: {},
  finalizedKeys: new Set<string>(),

  upsert: (draft) =>
    set((state) => {
      const key = pendingScreenKey(draft.sessionId, draft.toolCallId);
      // A finalized call must never be revived — see aiSvgPreviewStore's
      // `upsert` for the exact race this guards against (a late frame
      // arriving after the tool call has already resolved).
      if (state.finalizedKeys.has(key)) return state;
      const existing = state.drafts[key];

      if (draft.screens.length === 0) {
        if (!existing) return state;
        const next = { ...state.drafts };
        delete next[key];
        return { drafts: next, html: pruneHtml(state.html, (k) => k.startsWith(`${key}:`)) };
      }

      // Html first: only a string that actually changed produces a new record.
      let html = state.html;
      const live = new Set<string>();
      for (const screen of draft.screens) {
        const hk = pendingHtmlKey(key, screen.index);
        live.add(hk);
        if (screen.html !== "" && html[hk] !== screen.html) {
          if (html === state.html) html = { ...html };
          html[hk] = screen.html;
        }
      }
      html = pruneHtml(html, (k) => k.startsWith(`${key}:`) && !live.has(k));
      const htmlChanged = html !== state.html;

      // Identity-stable geometry: `drafts` keeps its reference on html-only
      // (and no-op) frames, so identity-comparing subscribers stay quiet.
      if (existing && geometryEqual(existing.screens, draft.screens)) {
        return htmlChanged ? { html } : state;
      }
      const screens: PendingScreenGeometry[] = draft.screens.map(
        ({ index, name, x, y, width, height }) => ({ index, name, x, y, width, height }),
      );
      const nextDraft: AiPendingScreenDraft = {
        sessionId: draft.sessionId,
        toolCallId: draft.toolCallId,
        screens,
      };
      return { drafts: { ...state.drafts, [key]: nextDraft }, ...(htmlChanged ? { html } : {}) };
    }),

  clearDraft: (key) =>
    set((state) => {
      const result = clearDraftReducer(state, key);
      return result === state ? state : withHtmlPruned(state, result, (k) => k.startsWith(`${key}:`));
    }),

  clearSession: (sessionId) =>
    set((state) => {
      const result = clearSessionReducer(state, sessionId);
      return result === state
        ? state
        : withHtmlPruned(state, result, (k) => k.startsWith(`${sessionId}:`));
    }),

  finalizeCall: (key) =>
    set((state) =>
      withHtmlPruned(state, finalizeCallReducer(state, key), (k) => k.startsWith(`${key}:`)),
    ),

  reset: () => set({ drafts: {}, html: {}, finalizedKeys: new Set<string>() }),
}));
