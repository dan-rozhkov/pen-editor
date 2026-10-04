import { create } from "zustand";

import { getUserId, peekUserId } from "@/lib/userId";

// Synchronous mirror of the Better Auth session, so non-React code (request
// body builders, the MCP bridge) can ask "is someone signed in?" without
// importing the auth client. Written only by SessionSync (SessionSync.tsx).
// "unknown" = the session has not been resolved (auth off, still loading):
// treated as signed out, which is safe because the backend lets a session win
// over any body userId.
export type AuthStatus = "unknown" | "signed-out" | "signed-in";

interface AuthState {
  status: AuthStatus;
  userId: string | null;
  /** True once GET /api/auth-config said accounts are on (set by authConfig). */
  accountsEnabled: boolean;
  setSession: (userId: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "unknown",
  userId: null,
  accountsEnabled: false,
  setSession: (userId) =>
    set({ status: userId ? "signed-in" : "signed-out", userId }),
}));

export function isSignedIn(): boolean {
  return useAuthStore.getState().status === "signed-in";
}

/** The `userId` to put in a request body or query: the anonymous browser id
 * while signed out, `undefined` (so JSON.stringify drops it) while signed in —
 * the backend then identifies the caller from the session cookie. */
export function getRequestUserId(): string | undefined {
  if (isSignedIn()) return undefined;
  // Accounts on but the session not resolved yet: the browser may be about to
  // turn out signed in, so never MINT an anonymous id here (it would be
  // orphaned, and claim-anon would then try to merge an empty identity).
  if (mintingForbidden()) return peekUserId() ?? undefined;
  return getUserId();
}

function mintingForbidden(): boolean {
  const { status, accountsEnabled } = useAuthStore.getState();
  return accountsEnabled && status !== "signed-out";
}

/** Best-effort actor id for a third party (analytics) that must not cause an
 * anonymous id to be minted while the account state is still unresolved. */
export function peekActorId(): string | undefined {
  const { status, userId } = useAuthStore.getState();
  if (status === "signed-in" && userId) return userId;
  return mintingForbidden() ? (peekUserId() ?? undefined) : getUserId();
}

/** `userId=<anon id>` for a query string while signed out, "" while signed in. */
export function requestUserIdParam(): string {
  const id = getRequestUserId();
  return id ? `userId=${encodeURIComponent(id)}` : "";
}

/** A stable per-person key for client-side storage scoped to "who is using
 * this" (e.g. a cursor): the account id when signed in, else the anon id. */
export function getActorId(): string {
  const { status, userId } = useAuthStore.getState();
  if (status === "signed-in" && userId) return userId;
  return mintingForbidden() ? (peekUserId() ?? "") : getUserId();
}
