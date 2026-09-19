/**
 * Shared reducer logic for the "keyed transient draft, keyed by
 * `${sessionId}:${toolCallId}`, with a permanently-finalized key set" shape
 * used by `aiSvgPreviewStore`, `aiVectorPreviewStore` and
 * `aiPendingScreenStore`. Factored out so a new store with this same shape
 * doesn't have to duplicate `clearDraft`/`clearSession`/`finalizeCall`
 * verbatim — each store still owns its own `drafts` value type and its own
 * `upsert`, which is where the actual per-store logic lives.
 *
 * Invariant every caller relies on: once a key is in `finalizedKeys`, no
 * draft under it is ever revived — enforced by each store's own `upsert`,
 * not here.
 */
export interface KeyedDraftState<T> {
  drafts: Record<string, T>;
  finalizedKeys: ReadonlySet<string>;
}

export function clearDraftReducer<T>(
  state: KeyedDraftState<T>,
  key: string,
): Partial<KeyedDraftState<T>> | KeyedDraftState<T> {
  if (!(key in state.drafts)) return state;
  const next = { ...state.drafts };
  delete next[key];
  return { drafts: next };
}

export function clearSessionReducer<T>(
  state: KeyedDraftState<T>,
  sessionId: string,
): Partial<KeyedDraftState<T>> | KeyedDraftState<T> {
  const prefix = `${sessionId}:`;
  const keys = Object.keys(state.drafts).filter((key) => key.startsWith(prefix));
  if (keys.length === 0) return state;
  const next = { ...state.drafts };
  // Also finalize, matching `finalizeCall`'s invariant ("a finalized call
  // must never be revived"): a call that never went through the ordinary
  // `onAbandon` path (e.g. the whole session was torn down first) only
  // passes through here, and must be closed off the same way — otherwise a
  // frame still in flight from the abandoned call could `upsert` a fresh
  // draft right back in with nothing left to ever clear it.
  const finalizedKeys = new Set(state.finalizedKeys);
  for (const key of keys) {
    delete next[key];
    finalizedKeys.add(key);
  }
  return { drafts: next, finalizedKeys };
}

export function finalizeCallReducer<T>(
  state: KeyedDraftState<T>,
  key: string,
): Partial<KeyedDraftState<T>> {
  const finalizedKeys = new Set(state.finalizedKeys);
  finalizedKeys.add(key);
  if (!(key in state.drafts)) return { finalizedKeys };
  const next = { ...state.drafts };
  delete next[key];
  return { drafts: next, finalizedKeys };
}
