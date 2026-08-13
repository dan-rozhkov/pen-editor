import { registerSW } from "virtual:pwa-register";
import { usePwaStore } from "@/store/pwaStore";
import {
  applyUpdateNow,
  autoApplyAlreadyTried,
  getUpdateSW,
  isEditorPath,
  reloadForUpdate,
  setUpdateSW,
} from "@/pwa/updateSelfHeal";

// The service worker activates itself now (workbox skipWaiting/clientsClaim,
// see vite.config.ts), so `onNeedRefresh` — which fires off the *waiting*
// state — is no longer the signal that a new build arrived. `controllerchange`
// is: the freshly activated worker claims this client while the page keeps
// running the assets it loaded from the old one. Everything the page still
// lazy-imports from here on is resolved against the new precache, so this is
// exactly the moment to say "reload to finish updating".
//
// `clientsClaim` also fires this event on a *first* install, when the page
// loaded uncontrolled and the very first worker takes over. That is not an
// update and must not prompt (or, on the showcase, reload) — hence the
// `wasControlled` snapshot, taken before any of it happens.
function watchForActivatedUpdate() {
  const wasControlled = navigator.serviceWorker.controller != null;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!wasControlled) return;
    usePwaStore.getState().setUpdateReady(true);
    // Same split as onNeedRefresh below: the showcase has nothing at stake
    // and applies the update itself; the editor may hold an unsaved document
    // and only gets the prompt. autoApplyAlreadyTried keeps a reload that
    // doesn't take from looping.
    if (!isEditorPath(window.location.pathname) && !autoApplyAlreadyTried) {
      reloadForUpdate();
    }
  });
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  watchForActivatedUpdate();

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
