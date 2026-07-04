import { useState } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { getUpdateSW } from "@/pwa/registerServiceWorker";
import { usePwaStore } from "@/store/pwaStore";
import { StatusPill } from "./StatusPill";

// Small toast that appears once a new service worker version has installed
// and is waiting to activate (registerServiceWorker sets pwaStore's
// updateReady when that happens). Reading from pwaStore rather than a
// one-shot event means state set before this component mounts, or while it's
// unmounted (e.g. present mode: `{!isPresent && <PwaUpdateToast />}`), is
// still picked up as soon as it (re)mounts.
//
// Reloading destroys any in-memory scene graph work (there's no autosave —
// only manual .pen export), so "Update" doesn't reload immediately: the
// first click switches the toast into a confirm step; only a second click
// actually reloads. "Not now" dismisses the toast for the rest of this
// session by clearing updateReady — the waiting worker still activates on
// the next natural page load, nothing about the update itself is cancelled.
//
// Placed below OfflineBanner (which sits at top-2) so the two never overlap;
// unlike the banner, this toast is interactive, so it (and only it) accepts
// pointer events.
export function PwaUpdateToast() {
  const updateReady = usePwaStore((s) => s.updateReady);
  const setUpdateReady = usePwaStore((s) => s.setUpdateReady);
  const [confirming, setConfirming] = useState(false);

  // Reset the confirm step whenever the toast goes away (dismissed, or a
  // fresh update-ready cycle starts later) so it doesn't reappear pre-armed.
  // Adjusted during render (React's recommended pattern for resetting state
  // in response to a prop/store change) rather than in an effect, which
  // would cause an extra render pass.
  const [prevUpdateReady, setPrevUpdateReady] = useState(updateReady);
  if (updateReady !== prevUpdateReady) {
    setPrevUpdateReady(updateReady);
    if (!updateReady) {
      setConfirming(false);
    }
  }

  if (!updateReady) {
    return null;
  }

  return (
    <StatusPill top="top-12" interactive gap={3} testId="pwa-update-toast">
      {confirming ? (
        <>
          <span>Reloads the editor; unsaved work will be lost.</span>
          <button
            type="button"
            onClick={() => getUpdateSW()?.(true)}
            className="flex items-center gap-1 rounded-full bg-text-muted/10 px-2 py-1 font-medium text-text-primary hover:bg-text-muted/20"
          >
            <ArrowsClockwiseIcon size={14} className="shrink-0" />
            Update
          </button>
          <button
            type="button"
            onClick={() => setUpdateReady(false)}
            className="rounded-full px-2 py-1 font-medium text-text-muted hover:bg-text-muted/10"
          >
            Not now
          </button>
        </>
      ) : (
        <>
          <span>A new version is available.</span>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1 rounded-full bg-text-muted/10 px-2 py-1 font-medium text-text-primary hover:bg-text-muted/20"
          >
            <ArrowsClockwiseIcon size={14} className="shrink-0" />
            Update
          </button>
        </>
      )}
    </StatusPill>
  );
}
