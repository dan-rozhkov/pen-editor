// A stable, client-generated anonymous id. It is NOT auth: it exists only so
// the backend can scope the agent's persistent memory to one person's browser
// instead of sharing one memory store across every visitor. Sent as `userId`
// in the /api/chat body; the backend treats an absent id as "memory off".
const USER_ID_KEY = "pen.userId";

// Private-mode Safari and locked-down embeddings throw on localStorage. A
// per-process fallback keeps memory working for the life of the tab without
// ever handing two different browsers the same id (a constant like
// "anonymous" would merge their memories).
let fallbackId: string | undefined;

// crypto.randomUUID is secure-context-only; a dev server opened over LAN http
// (the standard mobile-Safari repro setup) doesn't have it, and chat must not
// break there.
export function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The stored anonymous id WITHOUT creating one (null if none). Used to decide
 * whether there is anything to claim into an account. */
export function peekUserId(): string | null {
  try {
    return localStorage.getItem(USER_ID_KEY);
  } catch {
    return fallbackId ?? null;
  }
}

/** Forget the anonymous id (its data now belongs to an account). */
export function clearUserId(): void {
  fallbackId = undefined;
  try {
    localStorage.removeItem(USER_ID_KEY);
  } catch {
    // storage unavailable: nothing persisted to remove
  }
}

export function getUserId(): string {
  try {
    const existing = localStorage.getItem(USER_ID_KEY);
    if (existing) return existing;
    const created = randomId();
    localStorage.setItem(USER_ID_KEY, created);
    return created;
  } catch {
    fallbackId ??= randomId();
    return fallbackId;
  }
}
