import { registerSW } from "virtual:pwa-register";

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

// Set by registerServiceWorker() once the SW is registered. Task 4's update
// toast can read the current update function via getUpdateSW() after
// listening for "pen:pwa-update-ready".
let updateSW: UpdateSW | undefined;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent("pen:pwa-update-ready"));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent("pen:pwa-offline-ready"));
    },
    onRegisterError(error) {
      console.error("Service worker registration failed", error);
    },
  });
}

export function getUpdateSW(): UpdateSW | undefined {
  return updateSW;
}
