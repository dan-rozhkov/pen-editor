import { WifiSlashIcon } from "@phosphor-icons/react";
import { StatusPill } from "./StatusPill";

// Small non-blocking status pill shown while the app has no network
// connectivity. It sits above the canvas/UI stack but never intercepts
// pointer events, so canvas tools and sidebars remain fully usable — the
// editor shell keeps working offline, only backend-dependent actions
// (AI chat, image generation, model list refresh) are unavailable.
export function OfflineBanner() {
  return (
    <StatusPill top="top-2" testId="offline-banner">
      <WifiSlashIcon size={14} className="shrink-0" />
      <span>
        Offline. The editor shell is available; AI and backend features are
        disabled.
      </span>
    </StatusPill>
  );
}
