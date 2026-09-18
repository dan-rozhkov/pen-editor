import { create } from "zustand";
import * as mobbinAuth from "@/lib/mobbinAuth";

export type MobbinAuthStatus = "disconnected" | "connecting" | "connected";

interface MobbinAuthState {
  status: MobbinAuthStatus;
  /** Set on a failed `connect()`; cleared on the next connect attempt. Shown
   *  in the Settings menu so an OAuth failure (popup blocked, plan doesn't
   *  support MCP, state mismatch) doesn't silently drop back to "Connect
   *  Mobbin…" with no explanation. */
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Re-derives `status` from storage, refreshing the token if it's expired.
   *  "Connected" in this store means "a token we could actually use right
   *  now", not "something is stored" — an expired token with no refresh
   *  token available reads as disconnected, matching what
   *  `getValidAccessToken()` will do to any chat request anyway. */
  refreshStatus: () => Promise<void>;
}

export const useMobbinAuthStore = create<MobbinAuthState>((set) => ({
  // Optimistic initial value from a synchronous check, corrected shortly by
  // the refreshStatus() call below when something is actually stored — this
  // avoids firing a network refresh call on every module load/test import
  // when there is nothing to refresh.
  status: mobbinAuth.hasStoredCredentials() ? "connected" : "disconnected",
  error: null,
  refreshStatus: async () => {
    const token = await mobbinAuth.getValidAccessToken();
    // Never clobber an in-flight `connect()`. This fires from the
    // out-of-band subscription below on ANY `mobbinAuth.disconnect()` —
    // including one triggered by an unrelated request's failed token
    // refresh while THIS tab's own OAuth popup is still open. Without this
    // guard, that overwrote "connecting" with "disconnected" mid-flow,
    // re-enabling the "Connect Mobbin…" item; a second click reused the
    // named `"mobbin-oauth"` popup window and tore down the authorization
    // already in progress underneath it, while the original `connect()`
    // call was left to hang until its own 5-minute timeout. The functional
    // form of `set` checks status at the moment of the write, not whatever
    // it was when this call started.
    set((state) =>
      state.status === "connecting" ? state : { status: token ? "connected" : "disconnected" },
    );
  },
  connect: async () => {
    set({ status: "connecting", error: null });
    try {
      await mobbinAuth.connect();
      set({ status: "connected", error: null });
    } catch (err) {
      set({
        status: "disconnected",
        error: err instanceof Error ? err.message : "Couldn't connect to Mobbin.",
      });
    }
  },
  disconnect: () => {
    mobbinAuth.disconnect();
    set({ status: "disconnected", error: null });
  },
}));

if (mobbinAuth.hasStoredCredentials()) {
  void useMobbinAuthStore.getState().refreshStatus();
}

// `disconnect()` can happen deep inside `mobbinAuth.ts` — a failed refresh
// during `getValidAccessToken()`/`withMobbinAuthHeader`'s fetch wrapper, for
// instance — with nothing else watching. Without this subscription, that
// path left the Settings menu stuck offering "Disconnect Mobbin" for a
// connection that was already gone until the next reload. `refreshStatus()`
// re-derives `status` the same way it does on module load, so this store
// stays the single place the UI reads connection state from, no matter which
// path actually changed it.
mobbinAuth.subscribeToMobbinAuthChanges(() => {
  void useMobbinAuthStore.getState().refreshStatus();
});
