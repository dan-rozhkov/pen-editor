// The single point of contact for the user's OpenCode BYOK key
// (docs/specs/2026-09-18-opencode-byok-design.md, pen-editor-backend). The
// key is never sent to our own server except as the `X-OpenCode-Key` header
// on a turn that actually runs an opencode-* model (see useDesignChat.ts),
// and it is never stored anywhere but this browser's localStorage.
//
// Why one file, one set of functions, instead of each caller touching
// localStorage directly: src/lib/shareCanvas.ts already lived through the
// alternative once (see its own header comment) — credential cleanup that
// wasn't centralized meant a stray call site could forget to clear
// something, and the bug wasn't caught until it leaked stale state into an
// unrelated document. A key is a more sensitive value than a share token, so
// the same lesson applies harder here: every read/write/clear goes through
// this module, nowhere else.
//
// try/catch around EVERY localStorage access, not just the obvious ones:
// Safari private browsing and a handful of locked-down embeds/extensions
// make `localStorage.getItem`/`setItem`/`removeItem` throw (a real
// exception, not a quiet no-op) rather than degrade gracefully. Swallow and
// behave as if there is no key, on both read and write — a thrown write must
// not surface as if the key were saved when it silently wasn't.

const OPENCODE_KEY_STORAGE_KEY = "pen.opencode.key.v1";

let cachedKey: string | null | undefined; // undefined = not read yet this "session"
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function readFromStorage(): string | null {
  try {
    const raw = localStorage.getItem(OPENCODE_KEY_STORAGE_KEY);
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  } catch {
    // Private mode / blocked site data / disabled storage — treat as "no
    // key" rather than letting the exception escape into a caller that
    // isn't expecting one.
    return null;
  }
}

/** The stored OpenCode key, or `null` if none is saved (including when
 * localStorage itself is unavailable). Never throws. */
export function getOpenCodeKey(): string | null {
  // Re-read every call rather than trusting a cache indefinitely: another
  // tab (or this same OpenCodeKeyDialog after a save/remove) can change
  // localStorage out from under an already-mounted component, and the cost
  // of a synchronous localStorage read is negligible next to correctness
  // here.
  cachedKey = readFromStorage();
  return cachedKey;
}

/** Whether a (non-blank) OpenCode key is currently stored. */
export function hasOpenCodeKey(): boolean {
  return getOpenCodeKey() !== null;
}

/**
 * Saves `key`, trimmed. A blank/whitespace-only value is treated as "no
 * key" — it clears the stored value instead of writing an empty string, so
 * `hasOpenCodeKey()` stays consistent with what a human would call "has a
 * key". Never throws.
 */
export function setOpenCodeKey(key: string): void {
  const trimmed = key.trim();
  try {
    if (trimmed) {
      localStorage.setItem(OPENCODE_KEY_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(OPENCODE_KEY_STORAGE_KEY);
    }
  } catch {
    // Write failed (private mode / locked-down embed). The in-memory cache
    // below is not updated to "trimmed" in this case — getOpenCodeKey()
    // always re-reads storage, so a failed write correctly continues to
    // report "no key" rather than lying about having saved one.
  }
  notify();
}

/**
 * The one path that removes the key — UI code must call this rather than
 * reaching for `localStorage.removeItem` itself (see the module header for
 * why). Never throws.
 */
export function clearOpenCodeKey(): void {
  try {
    localStorage.removeItem(OPENCODE_KEY_STORAGE_KEY);
  } catch {
    // Nothing to do — see setOpenCodeKey's catch.
  }
  notify();
}

/**
 * Subscribe to changes made through `setOpenCodeKey`/`clearOpenCodeKey` in
 * THIS tab (e.g. `useSyncExternalStore` in a component that needs to
 * re-render when the key appears/disappears — the picker's lock icons,
 * the key dialog itself). Does not observe another tab's `storage` event;
 * nothing in this feature needs cross-tab sync.
 */
export function subscribeOpenCodeKey(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
