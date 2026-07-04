import { useEffect, useState } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { getUpdateSW } from "@/pwa/registerServiceWorker";

// Small dismiss-free toast that appears once a new service worker version
// has installed and is waiting to activate (registerServiceWorker dispatches
// "pen:pwa-update-ready" when that happens). Clicking "Update" tells the
// waiting worker to skip-waiting and reloads the page with the new build.
//
// Placed below OfflineBanner (which sits at top-2) so the two never overlap;
// unlike the banner, this toast is interactive, so it (and only it) accepts
// pointer events.
export function PwaUpdateToast() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    const onUpdateReady = () => setUpdateReady(true);
    window.addEventListener("pen:pwa-update-ready", onUpdateReady);
    return () => window.removeEventListener("pen:pwa-update-ready", onUpdateReady);
  }, []);

  if (!updateReady) {
    return null;
  }

  return (
    <div
      data-testid="pwa-update-toast"
      className="absolute top-12 inset-x-0 z-50 flex justify-center pointer-events-none px-2"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border-default bg-surface-panel px-3 py-1.5 text-xs text-text-muted shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <span>A new version is available.</span>
        <button
          type="button"
          onClick={() => getUpdateSW()?.(true)}
          className="flex items-center gap-1 rounded-full bg-text-muted/10 px-2 py-1 font-medium text-text-primary hover:bg-text-muted/20"
        >
          <ArrowsClockwiseIcon size={14} className="shrink-0" />
          Update
        </button>
      </div>
    </div>
  );
}
