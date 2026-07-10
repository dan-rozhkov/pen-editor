import { useEffect } from "react";
import { toast } from "sonner";
import { XIcon } from "@phosphor-icons/react";
import { getUpdateSW } from "@/pwa/registerServiceWorker";
import { usePwaStore } from "@/store/pwaStore";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";

// Headless component: once a new service worker version has installed and is
// waiting to activate (registerServiceWorker sets pwaStore's updateReady), it
// fires a persistent sonner toast (rendered by the app-level <Toaster />).
// Reading from pwaStore rather than a one-shot event means state set before
// this component mounts, or while it's unmounted (e.g. present mode:
// `{!isPresent && <PwaUpdateToast />}`), is still picked up as soon as it
// (re)mounts and the subscription reads current state.
//
// The toast shows a single "Update" button that reloads immediately on the
// first click via getUpdateSW()?.(true) — no confirm step. Its dismiss (X)
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
  const setUpdateReady = usePwaStore((s) => s.setUpdateReady);

  useEffect(() => {
    if (!updateReady) return;
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
              onClick={() => getUpdateSW()?.(true)}
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
    // Dismiss on unmount (e.g. entering present mode) so the toast doesn't
    // linger in the always-mounted <Toaster /> portal after its owner is gone.
    return () => {
      toast.dismiss(TOAST_ID);
    };
  }, [updateReady, setUpdateReady]);

  return null;
}
