import { useEffect } from "react";
import { toast } from "sonner";
import { XIcon } from "@phosphor-icons/react";
import { applyUpdateAndReload } from "@/pwa/updateSelfHeal";
import { usePwaStore } from "@/store/pwaStore";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";

// Headless component: once a new service worker version has installed and is
// waiting to activate (registerServiceWorker sets pwaStore's updateReady), it
// fires a persistent sonner toast (rendered by the app-level <Toaster />).
// Reading from pwaStore rather than a one-shot event means state set before
// this component mounts is still picked up as soon as it mounts and the
// subscription reads current state.
//
// Mounted in AppRouter, not in the editor's App: the editor is only one of
// two routes now ("/" is the showcase), and registerServiceWorker runs on
// every entry — so hosting the toast inside App meant an update detected on
// the showcase had nowhere to render. Present mode hides it via pwaStore's
// `toastSuppressed` instead of by unmounting.
//
// The toast shows a single "Update" button that reloads immediately on the
// first click via applyUpdateAndReload() — no confirm step. It reloads rather
// than only messaging the worker because the worker now activates itself
// (vite.config.ts's skipWaiting/clientsClaim): by the time this toast is up
// there is usually nothing left in `waiting` to skip, and the old
// message-only path would have left the button doing nothing at all. Its dismiss (X)
// button clears updateReady so the toast doesn't reappear this session; the
// waiting worker still activates on the next natural page load, nothing about
// the update itself is cancelled. (Custom sonner toasts don't render sonner's
// built-in close button, so we provide our own.)
// Stable id so re-firing (e.g. after this component unmounts/remounts on a
// present-mode toggle while updateReady stays true) reuses the same toast
// instead of stacking a duplicate.
const TOAST_ID = "pwa-update";

export function PwaUpdateToast() {
  const updateReady = usePwaStore((s) => s.updateReady);
  const suppressed = usePwaStore((s) => s.toastSuppressed);
  const setUpdateReady = usePwaStore((s) => s.setUpdateReady);

  useEffect(() => {
    // Suppression turning on mid-toast retracts the visible one: the effect
    // re-runs, its cleanup dismisses, and this bails before re-firing.
    if (!updateReady || suppressed) return;
    toast.custom(
      () => (
          // toast.custom renders unstyled (no sonner background/border/shadow),
          // so the panel chrome lives here. Use the app's own theme-aware
          // surface token (white in light, dark in the dark theme) rather than
          // --popover, which is dark in both themes in this shadcn preset.
          <div
            data-testid="pwa-update-toast"
            className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface-panel px-4 py-3 text-xs text-text-muted shadow-lg"
          >
            <span>A new version is available.</span>
            <Button
              size="sm"
              onClick={() => void applyUpdateAndReload()}
              className="bg-accent-primary text-white hover:bg-accent-primary/90"
            >
              Update
            </Button>
            <IconButton
              tooltip="Dismiss"
              side="top"
              variant="ghost"
              size="icon-sm"
              onClick={() => setUpdateReady(false)}
            >
              <XIcon />
            </IconButton>
          </div>
        ),
        { id: TOAST_ID, duration: Infinity },
      );
    // Dismiss on unmount so the toast doesn't linger in the always-mounted
    // <Toaster /> portal after its owner is gone.
    return () => {
      toast.dismiss(TOAST_ID);
    };
  }, [updateReady, suppressed, setUpdateReady]);

  return null;
}
