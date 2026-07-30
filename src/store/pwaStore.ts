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
  /**
   * Set by applyUpdateNow() a few seconds after it fires the update, as a
   * fallback for the showcase toast (see PwaUpdateGate). If the reload it
   * triggered actually happens, the page navigates away and this timer never
   * fires — it only matters when the auto-apply silently didn't take
   * (activation hung, or there was no update function registered yet), which
   * would otherwise leave the visitor with neither a silent update nor a
   * prompt for the rest of the session.
   */
  autoApplyStalled: boolean;
  setUpdateReady: (updateReady: boolean) => void;
  setOfflineReady: (offlineReady: boolean) => void;
  setToastSuppressed: (toastSuppressed: boolean) => void;
  setAutoApplyStalled: (autoApplyStalled: boolean) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  updateReady: false,
  offlineReady: false,
  toastSuppressed: false,
  autoApplyStalled: false,
  setUpdateReady: (updateReady) => set({ updateReady }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
  setToastSuppressed: (toastSuppressed) => set({ toastSuppressed }),
  setAutoApplyStalled: (autoApplyStalled) => set({ autoApplyStalled }),
}));
