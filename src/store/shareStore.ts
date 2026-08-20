// Thin Zustand wrapper around src/lib/shareCanvas.ts for UI consumers (the
// share dialog/panel a second agent builds on top of this). Owns only status
// bookkeeping — the actual network calls and error-message mapping live in
// shareCanvas.ts, which this store never duplicates.
import { create } from "zustand";
import {
  buildShareUrl,
  loadShareCredentials,
  saveShareCredentials,
  shareCurrentCanvas,
  subscribeToShareCredentials,
  unshareCurrentCanvas,
  type ShareCredentials,
} from "@/lib/shareCanvas";

export type ShareStatus = "idle" | "sharing" | "shared" | "error";

interface ShareState {
  status: ShareStatus;
  shareId: string | null;
  shareUrl: string | null;
  error: string | null;
  share: () => Promise<void>;
  unshare: () => Promise<void>;
  reset: () => void;
}

function fieldsForCredentials(
  credentials: ShareCredentials | null,
): Pick<ShareState, "status" | "shareId" | "shareUrl" | "error"> {
  return credentials
    ? { status: "shared", shareId: credentials.id, shareUrl: buildShareUrl(credentials.id), error: null }
    : { status: "idle", shareId: null, shareUrl: null, error: null };
}

export const useShareStore = create<ShareState>((set) => {
  // Single subscription, for the lifetime of the module: whenever ANY code
  // path calls `saveShareCredentials` (a fresh share, a reset on
  // Open/New/drop, the viewer clearing a visitor's own credentials before
  // loading someone else's document, forking a shared canvas…) this store
  // re-derives its entire status from the result. That's what makes
  // `reset()` below safe to implement as "just clear credentials" instead
  // of every caller having to remember to reset the store too — see
  // shareCanvas.ts's `subscribeToShareCredentials` doc comment for the
  // staleness bugs this closes.
  subscribeToShareCredentials((credentials) => set(fieldsForCredentials(credentials)));

  return {
    // Hydrated from localStorage so reopening the app with an already-shared
    // document shows its existing link instead of a blank "idle" state.
    ...fieldsForCredentials(loadShareCredentials()),

    share: async () => {
      set({ status: "sharing", error: null });
      const result = await shareCurrentCanvas();
      if (result.ok) {
        // shareCurrentCanvas's real implementation already calls
        // saveShareCredentials(...) internally, which the subscription
        // above turns into this same "shared" state — this explicit set is
        // what keeps that true when `shareCurrentCanvas` is replaced by a
        // test double that resolves a result without touching credentials.
        set({ status: "shared", shareId: result.id, shareUrl: result.url, error: null });
      } else {
        set({ status: "error", error: result.error });
      }
    },

    unshare: async () => {
      set({ status: "sharing", error: null });
      const result = await unshareCurrentCanvas();
      if (result.ok) {
        set({ status: "idle", shareId: null, shareUrl: null, error: null });
      } else {
        set({ status: "error", error: result.error });
      }
    },

    // Back to idle and clears the stored credentials — used by Open/New so a
    // link created for the previous document can't be mistaken for (or
    // silently overwritten by re-sharing) the newly loaded one. Local-only:
    // unlike `unshare()`, this never hits the network — Open/New abandoning a
    // link shouldn't fire a DELETE for a share that may still be legitimately
    // live and viewable by others.
    reset: () => {
      saveShareCredentials(null);
    },
  };
});
