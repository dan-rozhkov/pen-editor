import { WifiSlashIcon } from "@phosphor-icons/react";

// Small non-blocking status pill shown while the app has no network
// connectivity. It sits above the canvas/UI stack but never intercepts
// pointer events, so canvas tools and sidebars remain fully usable — the
// editor shell keeps working offline, only backend-dependent actions
// (AI chat, image generation, model list refresh) are unavailable.
export function OfflineBanner() {
  return (
    <div
      data-testid="offline-banner"
      className="absolute top-2 inset-x-0 z-50 flex justify-center pointer-events-none px-2"
    >
      <div className="pointer-events-none flex items-center gap-2 rounded-full border border-border-default bg-surface-panel px-3 py-1.5 text-xs text-text-muted shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <WifiSlashIcon size={14} className="shrink-0" />
        <span>
          Offline. The editor shell is available; AI and backend features are
          disabled.
        </span>
      </div>
    </div>
  );
}
