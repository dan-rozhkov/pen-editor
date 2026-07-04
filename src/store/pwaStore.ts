import { create } from "zustand";

// Service-worker lifecycle state, kept separate from scene/UI state. Written
// by registerServiceWorker() (which runs once, outside React, at startup)
// and read by PwaUpdateToast. Using a store instead of a fire-and-forget
// CustomEvent means state set before the toast mounts — or while it's
// unmounted, e.g. during present mode (`App.tsx`: `{!isPresent &&
// <PwaUpdateToast />}`) — is still picked up whenever it (re)mounts, since a
// Zustand subscription reads current state immediately instead of only
// future events.
interface PwaState {
  updateReady: boolean;
  offlineReady: boolean;
  setUpdateReady: (updateReady: boolean) => void;
  setOfflineReady: (offlineReady: boolean) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  updateReady: false,
  offlineReady: false,
  setUpdateReady: (updateReady) => set({ updateReady }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
}));
