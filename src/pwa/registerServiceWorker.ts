import { registerSW } from "virtual:pwa-register";
import { usePwaStore } from "@/store/pwaStore";
import {
  applyUpdateNow,
  autoApplyAlreadyTried,
  getUpdateSW,
  isEditorPath,
  setUpdateSW,
} from "@/pwa/updateSelfHeal";

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  setUpdateSW(
    registerSW({
      immediate: true,
      onNeedRefresh() {
        usePwaStore.getState().setUpdateReady(true);
        // The showcase is a stateless gallery: a prompt there only means the
        // visitor keeps reading a stale bundle until they happen to click a
        // toast — which is exactly how a shipped style change sat unseen
        // behind a refresh that could never pick it up. Apply it for them,
        // right here rather than from a React effect: this callback runs
        // regardless of whether the current render tree is alive, which is
        // the whole point (see updateSelfHeal.ts's module comment for the
        // incident that motivated moving this out of PwaUpdateGate). The
        // editor route keeps the prompt: it may hold an unsaved document.
        if (!isEditorPath(window.location.pathname) && !autoApplyAlreadyTried) {
          applyUpdateNow();
        }
      },
      onOfflineReady() {
        usePwaStore.getState().setOfflineReady(true);
      },
      onRegisterError(error) {
        console.error("Service worker registration failed", error);
      },
    }),
  );
}

export { getUpdateSW };
