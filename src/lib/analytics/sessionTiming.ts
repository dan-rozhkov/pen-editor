/**
 * Tiny shared timer for the `first_prompt_sent` event. `markEditorOpened()`
 * is called once per mount from App.tsx's mount effect (which itself fires
 * `editor_opened` on every mount — going back to `/` and returning to
 * `/app` is a fresh editor session); `msSinceEditorOpen()` is read from
 * `useDesignChat` when the first chat message of the session is sent.
 * Module-level (not a store) since it's pure timing state, not something any
 * UI renders from.
 */
let editorOpenedAt: number | null = null;
let firstPromptTracked = false;

/**
 * Resets the clock on every call (not just the first) — `editor_opened`
 * fires on every `App` mount, and each mount is a new editor session for
 * the purposes of `ms_since_open`. Without resetting, browsing away and
 * back inflates the reported duration by however long the visitor spent
 * elsewhere. `firstPromptTracked` is untouched here so `first_prompt_sent`
 * still fires at most once per page load, per its own doc below.
 */
export function markEditorOpened(): void {
  editorOpenedAt = performance.now();
}

/**
 * Returns elapsed ms since `markEditorOpened()`, and true if this is the
 * first call to report it — the caller should only emit `first_prompt_sent`
 * when `isFirst` is true, since the event is meant to fire once per editor
 * session regardless of how many chat tabs send messages.
 */
export function consumeFirstPromptTiming(): { msSinceOpen: number; isFirst: boolean } {
  const msSinceOpen = editorOpenedAt === null ? 0 : performance.now() - editorOpenedAt;
  const isFirst = !firstPromptTracked;
  firstPromptTracked = true;
  return { msSinceOpen, isFirst };
}

/** Test-only: resets module state between tests. */
export function __resetSessionTimingForTests(): void {
  editorOpenedAt = null;
  firstPromptTracked = false;
}
