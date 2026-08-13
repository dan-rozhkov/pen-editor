import { usePwaStore } from "@/store/pwaStore";

// Manual "Check for updates" entry point (File → Settings). Forces a fresh
// fetch of the SW script instead of waiting for the browser's own polling
// interval, then surfaces the result through the existing update toast
// machinery — no bespoke UI here, just driving usePwaStore the same way
// registerServiceWorker's onNeedRefresh does.

export type CheckForUpdateResult = "update-found" | "up-to-date" | "unsupported" | "error";

const INSTALL_WAIT_TIMEOUT_MS = 10_000;

// Waits for an in-flight installing worker to settle, bounded so a stuck
// worker can't hang the menu action forever. Anything other than "installing"
// counts as settled: the state machine may already have moved past
// "installed" (a skipWaiting worker reaches "activating"/"activated"), and
// waiting for a statechange that will never come would spin the toast for the
// full timeout.
function waitForInstallOutcome(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve) => {
    if (worker.state !== "installing") {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      worker.removeEventListener("statechange", onStateChange);
      resolve();
    }, INSTALL_WAIT_TIMEOUT_MS);
    function onStateChange() {
      if (worker.state !== "installing") {
        clearTimeout(timer);
        worker.removeEventListener("statechange", onStateChange);
        resolve();
      }
    }
    worker.addEventListener("statechange", onStateChange);
  });
}

export async function checkForUpdate(): Promise<CheckForUpdateResult> {
  if (!("serviceWorker" in navigator)) {
    return "unsupported";
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      return "unsupported";
    }

    await reg.update();

    const installing = reg.installing;
    if (installing) {
      await waitForInstallOutcome(installing);
      // The install failed outright (script threw, a precache entry 404'd).
      // Saying "you're on the latest version" here would be the opposite of
      // what happened, so report it as a failed check.
      if (installing.state === "redundant" && !reg.waiting) {
        return "error";
      }
      // A worker installed successfully — that *is* a newer version, whether
      // or not it parks in `waiting`. Since the service worker now activates
      // itself (workbox skipWaiting/clientsClaim, see vite.config.ts), the
      // usual outcome here is "activating"/"activated" with `reg.waiting`
      // permanently null, and the pre-skipWaiting version of this check
      // reported that as "up-to-date" — the opposite of what happened.
      usePwaStore.getState().setUpdateReady(true);
      return "update-found";
    }

    if (reg.waiting || usePwaStore.getState().updateReady) {
      // Re-flip the flag so the toast shows even if onNeedRefresh already
      // fired (and the visitor dismissed it) before this manual check ran.
      // toastSuppressed is deliberately left alone: it is present mode's
      // switch (App.tsx), and popping a banner over a presentation is worse
      // than making the user leave present mode to see it.
      usePwaStore.getState().setUpdateReady(true);
      return "update-found";
    }

    return "up-to-date";
  } catch (error) {
    // A rejected update() is usually just a flaky network — that is an
    // "couldn't check", not "this build has no updates".
    console.warn("checkForUpdate failed", error);
    return "error";
  }
}
