import { registerSW } from "virtual:pwa-register";
import { usePwaStore } from "@/store/pwaStore";

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

// Set by registerServiceWorker() once the SW is registered. PwaUpdateToast
// reads the current update function via getUpdateSW() once it's ready to
// apply the update. Kept as a plain module-level getter rather than moved
// into pwaStore: it's an imperative action fetched on click, not reactive
// state a component needs to re-render on — putting it in the store would
// add no value over the existing getter.
let updateSW: UpdateSW | undefined;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      usePwaStore.getState().setUpdateReady(true);
    },
    onOfflineReady() {
      usePwaStore.getState().setOfflineReady(true);
    },
    onRegisterError(error) {
      console.error("Service worker registration failed", error);
    },
  });
}

export function getUpdateSW(): UpdateSW | undefined {
  return updateSW;
}
