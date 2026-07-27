import { create } from "zustand";

// Service-worker lifecycle state, kept separate from scene/UI state. Written
// by registerServiceWorker() (which runs once, outside React, at startup)
// and read by PwaUpdateToast. Using a store instead of a fire-and-forget
// CustomEvent means state set before the toast mounts is still picked up
// whenever it mounts, since a Zustand subscription reads current state
// immediately instead of only future events.
interface PwaState {
  updateReady: boolean;
  offlineReady: boolean;
  /**
   * Set by the editor while it needs a chrome-free screen (present mode) so
   * the update toast stays hidden without unmounting PwaUpdateToast — it now
   * lives in AppRouter, above the route split, so it can also fire on the
   * showcase at "/" where the editor never mounts. The editor can't gate it
   * by unmounting any more, hence this flag; `updateReady` is untouched, so
   * the toast reappears as soon as suppression lifts.
   */
  toastSuppressed: boolean;
  setUpdateReady: (updateReady: boolean) => void;
  setOfflineReady: (offlineReady: boolean) => void;
  setToastSuppressed: (toastSuppressed: boolean) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  updateReady: false,
  offlineReady: false,
  toastSuppressed: false,
  setUpdateReady: (updateReady) => set({ updateReady }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
  setToastSuppressed: (toastSuppressed) => set({ toastSuppressed }),
}));
